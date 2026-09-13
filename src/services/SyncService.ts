// ADR-019: Argon2id migration / Security hardening (firewall + roomSecret)
import {
  replicateWebRTC,
  getConnectionHandlerSimplePeer,
} from "rxdb/plugins/replication-webrtc";
import { RxDatabase, RxCollection } from "rxdb";
import { Subscription } from "rxjs";
import {
  validateIceServers,
  checkNetworkRequest,
} from "../utils/networkFirewall";
import { logger } from "../utils/logger";
import { SYNC_CONFIG } from "../constants/config";
import { getEnvVar } from "../utils/env";
import {
  SYNC_ALLOWED_COLLECTIONS,
  SYNC_REPLICATION_BATCH_SIZE,
  syncReplicationModifier,
} from "./sync/replication";
import {
  MAX_ICE_CREDENTIAL_LENGTH,
  MAX_ICE_URL_LENGTH,
  createSignalingSocketFactory,
  deriveSyncTopic,
  fetchIceServersFromSignaling,
  isSafeIceString,
} from "./sync/signaling";

// Re-exported for backward compatibility — the canonical definitions live in
// sync/signaling.ts and sync/replication.ts (refactor, no behavior change).
export {
  SIGNAL_INIT_TIMEOUT_MS,
  SIGNAL_QUEUE_LIMIT,
  SYNC_TOPIC_DOMAIN,
  createSignalingSocketFactory,
  canonicalSignalPayload,
  deriveClientSignalKey,
  deriveSyncTopic,
} from "./sync/signaling";
export { SYNC_ALLOWED_COLLECTIONS } from "./sync/replication";

interface SyncOperation {
  id: string;
  collection: string;
  documentId: string;
  operation: "insert" | "update" | "delete";
  timestamp: number;
  hash: string;
}

interface DedupeConfig {
  windowMs: number;
  maxSize: number;
}

/**
 * SyncService - P2P replication manager between devices: WebRTC
 * direct, operation deduplication, timestamp-based reconciliation
 * and TURN support (S5/ADR-018).
 *
 * @example
 * ```typescript
 * await syncService.startP2PSync(database, "room_id");
 * console.log(syncService.isSyncing, syncService.syncHealth);
 * syncService.stopAll();
 * ```
 */
export class SyncService {
  private replications: Map<string, unknown> = new Map();
  private startPromise: Promise<void> | null = null;
  // Room targeted by the in-flight startPromise. startP2PSync dedupes only
  // against a startup of the SAME room; a different-room request supersedes
  // the in-flight one instead of silently receiving its promise.
  private startPromiseRoomId: string | null = null;
  private roomSecret: string | null = null;
  public isSyncing = false;
  public currentRoomId: string | null = null;
  public connectedPeers = 0;
  public lastSyncTime: number | null = null;
  public syncHealth: "healthy" | "warning" | "error" | "connecting" =
    "connecting";
  public onSyncStateChange:
    | ((
        syncing: boolean,
        roomId: string | null,
        peers: number,
        health: string,
        lastSync: number | null,
      ) => void)
    | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  private onlineListener: (() => void) | null = null;
  private subscriptions: Subscription[] = [];
  private privacyGuardSubscriptions: Subscription[] = [];

  private operationCache: Map<string, SyncOperation> = new Map();
  private dedupeConfig: DedupeConfig = {
    windowMs: SYNC_CONFIG.DEDUPE_WINDOW_MS,
    maxSize: SYNC_CONFIG.DEDUPE_MAX_SIZE,
  };
  private lastProcessedHashes: Set<string> = new Set();
  // Audit (sync client): timestamps for every hash in lastProcessedHashes,
  // including cross-tab hashes that have NO operationCache entry. The old
  // expiry sweep only removed hashes tied to expired operationCache entries,
  // so hashes received via BroadcastChannel lived forever — a per-tab memory
  // leak in long sessions. Tracking arrival time lets the sweep bound them.
  private hashTimestamps: Map<string, number> = new Map();
  // Audit M-04: hashes are kept alive past the configured window so an
  // inbound event processed late (beyond windowMs) still hits the duplicate
  // guard instead of being re-applied.
  private static readonly DEDUPE_GRACE_MS = 30_000;

  // Cross-tab deduplication: BroadcastChannel shares operation hashes
  // between tabs so two tabs processing the same sync event don't both
  // apply it. Falls back gracefully if BroadcastChannel is unavailable
  // (SSR, legacy browsers) — the per-instance dedupe still runs.
  private dedupeChannel: BroadcastChannel | null = null;
  private dedupeChannelName: string | null = null;
  // Audit M-03: the full room ID is embedded in the channel payload. A short
  // prefix would let two deliberately chosen rooms collide and suppress a
  // legitimate operation; old unscoped hashes are intentionally ignored.
  private dedupeRoomId: string | null = null;

  /**
   * Notifica cambio de estado a los listeners.
   */
  private notify() {
    if (this.onSyncStateChange) {
      this.onSyncStateChange(
        this.isSyncing,
        this.currentRoomId,
        this.connectedPeers,
        this.syncHealth,
        this.lastSyncTime,
      );
    }
  }

  /**
   * Generates a deterministic SHA-256 hash for the operation.
   * CRITICAL: do not include Date.now() — that would make the hash unique
   * every time and break deduplication. Only collection+docId+operation matter.
   */
  private async generateOperationHash(
    collection: string,
    docId: string,
    operation: string,
  ): Promise<string> {
    const data = `${collection}:${docId}:${operation}`;
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest(
      "SHA-256",
      encoder.encode(data),
    );
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray
      .slice(0, 16)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  /**
   * Opens (or reopens) the BroadcastChannel for cross-tab dedup.
   * Uses a name derived from the roomId so different rooms do not
   * share the deduplication cache.
   */
  private openDedupeChannel(roomId: string): void {
    this.closeDedupeChannel();
    if (typeof BroadcastChannel === "undefined") return;
    try {
      this.dedupeRoomId = roomId;
      this.dedupeChannelName = `bmf_sync_dedupe_${roomId}`;
      this.dedupeChannel = new BroadcastChannel(this.dedupeChannelName);
      this.dedupeChannel.onmessage = (event: MessageEvent<string>) => {
        const raw = event.data;
        if (typeof raw !== "string") return;
        // Only accept the current full-room namespace. Unscoped legacy hashes
        // are rejected: any same-origin producer could otherwise inject a
        // valid-looking hash and suppress a real operation (audit M-03).
        const ns = `bmf:${this.dedupeRoomId}:`;
        if (!raw.startsWith(ns)) return;
        const hash = raw.slice(ns.length);
        if (hash.length === 32 && /^[0-9a-f]{32}$/i.test(hash)) {
          this.lastProcessedHashes.add(hash);
          this.hashTimestamps.set(hash, Date.now());
          // Audit (sync client): cross-tab-only hashes have no operationCache
          // entry, so the maxSize eviction in recordOperation never applies
          // to them. Cap this path too — a flooding sender pushing valid
          // hashes faster than the age purge keeps up must not grow the set
          // beyond maxSize. Evict the oldest (insertion order) when over.
          if (this.hashTimestamps.size > this.dedupeConfig.maxSize) {
            const oldest = this.hashTimestamps.keys().next().value as string;
            this.hashTimestamps.delete(oldest);
            this.lastProcessedHashes.delete(oldest);
          }
        }
      };
    } catch (_err) {
      this.dedupeChannel = null;
    }
  }

  private closeDedupeChannel(): void {
    const channel = this.dedupeChannel;
    this.dedupeChannel = null;
    this.dedupeChannelName = null;
    this.dedupeRoomId = null;
    if (!channel) {return;}
    channel.onmessage = null;
    try {
      channel.close();
    } catch {
      /* INTENTIONAL SILENCE: closing a completed channel is best-effort. */
    }
  }

  /**
   * Broadcast a dedupe hash to other tabs via BroadcastChannel.
   * Non-blocking — failures are silently ignored (the hash is already
   * in this tab's in-memory set, so local dedup still works).
   */
  private broadcastDedupeHash(hash: string): void {
    if (!this.dedupeChannel) return;
    const ns = this.dedupeRoomId ? `bmf:${this.dedupeRoomId}:` : "";
    try {
      // Emit only the full-room namespace. Compatibility with an old tab is
      // intentionally secondary to preventing an unscoped same-origin hash
      // from suppressing a real sync operation.
      if (ns) { this.dedupeChannel.postMessage(ns + hash); }
    } catch {
      /* INTENTIONAL SILENCE: local BroadcastChannel failure does not affect local dedupe. */
    }
  }

  /**
   * Checks whether the operation is a duplicate.
   * Consults both the local cache and the cross-tab one (via BroadcastChannel).
   */
  private isOperationDuplicate(hash: string): boolean {
    const now = Date.now();
    // Audit M-04: purge only past windowMs + grace so an inbound event
    // processed a few seconds after the window still dedupes correctly.
    const expireAfter = this.dedupeConfig.windowMs + SyncService.DEDUPE_GRACE_MS;
    const expiredKeys: string[] = [];
    const expiredHashes: string[] = [];
    for (const [key, op] of this.operationCache) {
      if (now - op.timestamp > expireAfter) {
        expiredKeys.push(key);
        expiredHashes.push(op.hash);
      }
    }
    for (const k of expiredKeys) {this.operationCache.delete(k);}
    for (const h of expiredHashes) {
      this.lastProcessedHashes.delete(h);
      this.hashTimestamps.delete(h);
    }

    // Audit (sync client): purge cross-tab-only hashes by age too. They have
    // no operationCache entry, so the sweep above can never expire them —
    // this bound prevents unbounded growth of lastProcessedHashes in a
    // long-lived tab receiving many cross-tab events.
    const expiredCrossTab: string[] = [];
    for (const [hash, ts] of this.hashTimestamps) {
      if (now - ts > expireAfter) {
        expiredCrossTab.push(hash);
      }
    }
    for (const h of expiredCrossTab) {
      this.hashTimestamps.delete(h);
      this.lastProcessedHashes.delete(h);
    }

    // Check only after expiry cleanup; otherwise an old hash would remain a
    // permanent duplicate whenever no unrelated operation triggered a sweep.
    return this.lastProcessedHashes.has(hash);
  }

  /**
   * Records an operation for deduplication.
   * Cleans the oldest operations if the cache is full.
   */
  private async recordOperation(
    collection: string,
    docId: string,
    operation: string,
  ): Promise<string> {
    const hash = await this.generateOperationHash(collection, docId, operation);

    // Clean oldest entries if cache is full (collect keys first, then delete)
    if (this.operationCache.size >= this.dedupeConfig.maxSize) {
      const entriesToRemove = Math.floor(this.dedupeConfig.maxSize * 0.2);
      const keysToRemove: string[] = [];
      for (const [key] of this.operationCache) {
        if (keysToRemove.length >= entriesToRemove) {break;}
        keysToRemove.push(key);
      }
      for (const k of keysToRemove) {
        const op = this.operationCache.get(k);
        if (op) {
          this.operationCache.delete(k);
          this.lastProcessedHashes.delete(op.hash);
          this.hashTimestamps.delete(op.hash);
        }
      }
    }

    const op: SyncOperation = {
      id: `op_${Date.now()}_${crypto.randomUUID().replace(/-/g, "").slice(0, 9)}`,
      collection,
      documentId: docId,
      operation: operation as "insert" | "update" | "delete",
      timestamp: Date.now(),
      hash,
    };

    this.operationCache.set(op.id, op);
    this.lastProcessedHashes.add(hash);
    this.hashTimestamps.set(hash, op.timestamp);
    // Cross-tab: notify other tabs so they also mark this hash as seen.
    this.broadcastDedupeHash(hash);
    return hash;
  }

  /**
   * Clears the deduplication cache.
   */
  clearDedupeCache(): void {
    this.operationCache.clear();
    this.lastProcessedHashes.clear();
    this.hashTimestamps.clear();
  }

  /**
   * Returns cache statistics.
   */
  getDedupeStats(): { cacheSize: number; uniqueHashes: number } {
    return {
      cacheSize: this.operationCache.size,
      uniqueHashes: this.lastProcessedHashes.size,
    };
  }

  /**
   * Refuse to start replication while private records exist. RxDB's WebRTC
   * replication protocol has no server-side selector, so allowing a normal
   * collection to replicate would eventually transfer every document in it.
   * The guard is deliberately fail-closed for real collections and permissive
   * for the tiny collection mocks used by unit tests.
   */
  private async assertNoPrivateRecords(db: RxDatabase): Promise<void> {
    for (const name of ["bookmarks", "documents"]) {
      const collection = (db.collections as Record<string, unknown>)[name] as
        | {
            find?: (query?: unknown) => {
              exec: () => Promise<unknown[]>;
            };
          }
        | undefined;
      if (!collection?.find) {continue;}
      const privateDocs = await collection.find({
        selector: { isPrivate: true },
        limit: 1,
      }).exec();
      if (privateDocs.length > 0) {
        throw new Error(
          `[SyncService] P2P sync disabled: ${name} contains private data`,
        );
      }
    }
  }

  /** Stop replication as soon as a local record becomes private. */
  private installPrivacyGuards(db: RxDatabase): void {
    for (const sub of this.privacyGuardSubscriptions) {
      try {
        sub.unsubscribe();
      } catch (error) {
        logger.warn("[SyncService] Failed to remove privacy guard", { error });
      }
    }
    this.privacyGuardSubscriptions = [];
    for (const name of ["bookmarks", "documents"]) {
      const collection = (db.collections as Record<string, unknown>)[name] as
        | {
            $?: { subscribe: (fn: (event: unknown) => void) => Subscription };
          }
        | undefined;
      if (!collection?.$) {continue;}
      const subscription = collection.$.subscribe((event: unknown) => {
        const change = event as {
          documentData?: { isPrivate?: boolean };
          previousDocumentData?: { isPrivate?: boolean };
        };
        if (
          change.documentData?.isPrivate === true ||
          change.previousDocumentData?.isPrivate === true
        ) {
          logger.warn("[SyncService] Private data detected; stopping P2P sync");
          this.stopAll();
        }
      });
      this.privacyGuardSubscriptions.push(subscription);
    }
  }

  /**
   * Starts P2P replication for all collections.
   * @param db - RxDB database instance
   * @param roomId - Unique session ID (e.g. vault hash)
   * @param sharedRoomSecret - Secret carried in the collaboration link fragment.
   */
  async startP2PSync(
    db: RxDatabase,
    roomId: string,
    sharedRoomSecret?: string,
  ): Promise<void> {
    // Dedupe only against an in-flight startup of the SAME room. A caller
    // requesting a different room while a startup is in flight must not
    // silently receive the first room's promise — the new room would never
    // start while the caller believes it joined it (the stale-session
    // suppresses-new-session pattern, same family as the WebRTCSyncService
    // fix). Supersede the in-flight startup instead: stopAll() bumps the
    // session generation, the old operation self-cancels at its next
    // checkpoint, and its identity-checked finally leaves the new promise
    // alone.
    if (this.startPromise && this.startPromiseRoomId === roomId) {
      return this.startPromise;
    }
    if (this.startPromise) {
      this.stopAll();
    }
    const operation = this.startP2PSyncInternal(db, roomId, sharedRoomSecret);
    this.startPromise = operation;
    this.startPromiseRoomId = roomId;
    try {
      await operation;
    } finally {
      if (this.startPromise === operation) {
        this.startPromise = null;
        this.startPromiseRoomId = null;
      }
    }
  }

  private async startP2PSyncInternal(
    db: RxDatabase,
    roomId: string,
    sharedRoomSecret?: string,
  ) {
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(roomId) || roomId === "." || roomId === "..") {
      throw new Error("[SyncService] Invalid room ID");
    }
    if (
      sharedRoomSecret !== undefined &&
      !/^[0-9a-f]{64}$/i.test(sharedRoomSecret)
    ) {
      throw new Error("[SyncService] Invalid shared room secret");
    }
    if (
      this.isSyncing &&
      this.currentRoomId === roomId &&
      this.syncHealth !== "error"
    ) {
      return;
    }

    if (this.isSyncing) {
      this.stopAll();
    }

    const sessionGeneration = ++this.sessionGeneration;
    const isCurrentSession = () =>
      this.sessionGeneration === sessionGeneration;

    await this.assertNoPrivateRecords(db);
    if (!isCurrentSession()) {return;}

    this.isSyncing = true;
    this.currentRoomId = roomId;
    this.syncHealth = "connecting";
    // S9: cross-tab dedup channel — shares operation hashes with other tabs
    // so they don't process the same sync event redundantly.
    this.openDedupeChannel(roomId);
    this.notify();

    logger.info("[SyncService] Starting P2P Zero-Knowledge sync", { roomId });

    // Signaling servers: a configured VITE_P2P_SIGNALING_URL is the
    // self-hosted companion server — the ONLY server that enforces the
    // room secret (the A2 guarantee). When it is configured, use ONLY it:
    // falling back to the public rxdb.info/PubNub relays would silently
    // downgrade a secret room to unauthenticated signaling. Without a
    // configured server, the public relays are the intended mode and the
    // room ID itself (128-bit random) is the capability that keeps the
    // room unguessable.
    const customUrl = getEnvVar("VITE_P2P_SIGNALING_URL");
    const signalingServers = customUrl
      ? [customUrl]
      : [
          "wss://signaling.rxdb.info/",
          "wss://signaling.pubnub.com/v1/subscribe",
        ];

    // SECURITY (C1): every signaling URL must pass the network firewall
    // before we hand it to RxDB's WebSocket. This closes the gap where the
    // WebRTC signaling socket bypassed the whitelist.
    // A blocked custom URL fails the whole sync (no public fallback): a
    // deployment that configured private signaling must never downgrade to
    // an unauthenticated public relay.
    const allowedSignalingServers: string[] = [];
    for (const sig of signalingServers) {
      try {
        await checkNetworkRequest(sig, "P2P_Signaling");
        allowedSignalingServers.push(sig);
      } catch (fwErr) {
        logger.error("[SyncService] Signaling server blocked by firewall", {
          server: sig,
          error: fwErr instanceof Error ? fwErr.message : String(fwErr),
        });
      }
    }
    if (!isCurrentSession()) {return;}
    if (allowedSignalingServers.length === 0) {
      const error = new Error(
        signalingServers.length === 0
          ? "[SyncService] No signaling servers configured"
          : "[SyncService] All signaling servers blocked by network firewall",
      );
      this.stopAll();
      this.syncHealth = "error";
      this.notify();
      throw error;
    }

    // S5/ADR-018: Probe the primary signaling server for TURN credentials.
    // Falls back to env vars (VITE_TURN_URL etc.) if the probe fails.
    const DEFAULT_STUN: RTCIceServer[] = [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
    ];

    let ICE_SERVERS: RTCIceServer[];
    try {
      // Probe the first firewall-passing server. Blocked URLs are never
      // handed to either the probe or RxDB's internal WebSocket.
      const remoteIce = await fetchIceServersFromSignaling(
        allowedSignalingServers[0]!,
      );
      if (remoteIce.length > 0) {
        ICE_SERVERS = [...remoteIce, ...DEFAULT_STUN];
        logger.info("[SyncService] Using TURN servers from signaling server", {
          turnCount: remoteIce.length,
        });
      } else {
        ICE_SERVERS = this.buildIceServersFromEnv(DEFAULT_STUN);
      }
    } catch (err) {
      logger.warn("[SyncService] Failed to probe signaling server for ICE", {
        error: err,
      });
      ICE_SERVERS = this.buildIceServersFromEnv(DEFAULT_STUN);
    }
    if (!isCurrentSession()) {return;}

    // SECURITY (A2): derive a per-session room secret so self-hosted
    // BookmarkForge signaling servers (server/src/index.ts) can enforce
    // access control. The RxDB simple-peer handler only sends `{type:'join',
    // room}`; we inject `roomSecret` by wrapping the WebSocket constructor
    // and augmenting the outgoing `join` message.
    // A host creates the secret; a joiner receives the same high-entropy
    // value from the URL fragment (never sent to the HTTP server). This makes
    // self-hosted signaling rooms usable without putting the secret in query
    // logs or Referer headers.
    //
    // SECURITY (A-3): that injection is scoped to the self-hosted server below
    // (`customUrl`). The secret is the room capability — it keys the derived
    // room name (A-2) and every `signalAuth` — so a public rxdb.info/PubNub
    // relay must never receive it, and "the relay ignores the extra field" was
    // never a reason to hand it over. Public relays get the opaque room name
    // and nothing else.
    if (sharedRoomSecret !== undefined) {
      this.roomSecret = sharedRoomSecret.toLowerCase();
    } else {
      this.roomSecret = Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    }
    const roomSecret = this.roomSecret;
    // SECURITY (audit #2 + #4): the socket constructor enforces wss:// for
    // remote hosts, injects the room secret into `join` when (and only when)
    // the socket targets the configured self-hosted server, and signs every
    // `signal` with an HMAC (signalAuth) so the server can enforce
    // ENFORCE_SIGNAL_HMAC (public relays ignore the extra field, which carries
    // no secret). The returned factory is callable with `new` (RxDB's
    // simple-peer handler instantiates it as `new webSocketConstructor(url)`;
    // an arrow function would throw "is not a constructor" at runtime).
    // The factory is created PER COLLECTION with a collection-scoped topic:
    // sharing one RxDB `topic` across collections would make every peer's
    // replications exchange data with each other's, so the bookmarks
    // collection would receive documents (and vice versa) and fail schema
    // validation on every pull (the multiuser e2e caught this). The topic is
    // also the room the HMAC is bound to, so it must match the `join` room.
    //
    // SECURITY (A-2): the topic is NOT the readable room ID. It is derived as
    // HMAC-SHA256(roomSecret, `${SYNC_TOPIC_DOMAIN}:${roomId}:${collection}`)
    // (see deriveSyncTopic), so the room name a relay, an observer or a peer
    // that only knows the room ID sees is an opaque 64-hex string. Both peers
    // hold the same room secret and therefore derive the same room; the public
    // rxdb.info/PubNub relays learn nothing that identifies or opens the room.

    if (!isCurrentSession()) {return;}
    this.installPrivacyGuards(db);
    // A-3: state the secret policy once per sync session. "Why does /admin
    // report secretPresent: false?" is answered by this line: without a
    // configured self-hosted server the vault runs over public relays, which
    // are never given the room secret.
    logger.info("[SyncService] Signaling room-secret policy", {
      sharesSecretWithServer: Boolean(customUrl),
    });

    // P0: do not derive the sync set from every RxDB collection. A new
    // collection may contain private conversations or memory records and
    // must stay local until it receives an explicit security review.
    const collections = Object.values(db.collections).filter(
      (c): c is RxCollection =>
        SYNC_ALLOWED_COLLECTIONS.has((c as { name?: string })?.name ?? ""),
    );

    for (const collection of collections) {
      if (!isCurrentSession()) {return;}
      try {
        await validateIceServers(
          { iceServers: ICE_SERVERS },
          `P2P_Sync_${collection.name}`,
        );
        if (!isCurrentSession()) {return;}
        type ReplicationState = {
          error$: { subscribe: (fn: (err: unknown) => void) => Subscription };
          peerStates$?: {
            subscribe: (
              fn: (peers: Map<unknown, unknown>) => void,
            ) => Subscription;
          };
          cancel: () => void;
        };

        // Collection-scoped signaling room: each collection replicates in its
        // own room so peers never mix schemas. The room secret is shared (it
        // is the session capability), and the HMAC key is bound to this exact
        // topic so the server's deriveSignalKey(topic, secret) matches.
        // The room name itself is keyed by that secret (A-2), so neither the
        // signaling server nor any relay can read the room ID off the wire.
        const syncTopic = await deriveSyncTopic(
          roomSecret,
          roomId,
          collection.name,
        );
        // Stale-session checkpoint after the async key derivation.
        if (!isCurrentSession()) {return;}
        const makeSignalingSocket = createSignalingSocketFactory(
          roomSecret,
          syncTopic,
          // A-3: only the configured self-hosted server may receive the room
          // secret; `null` (public-relay mode) means it is never sent, and the
          // factory re-checks the socket URL against this origin per socket.
          { selfHostedSignalingUrl: customUrl ?? null },
        );

        let replicationState: ReplicationState | undefined;
        for (let attempt = 0; attempt < allowedSignalingServers.length; attempt++) {
          try {
            // RxDB's WebRTC plugin uses pull/push modifiers at the storage
            // boundary. Keep them present and bounded: omitting them makes the
            // plugin create a pool with no replication handlers, while relying
            // only on the collection observer would allow a private record to
            // cross the boundary before stopAll() runs. The modifiers reject
            // private records on both directions; isPeerValid repeats the
            // fail-closed local preflight for every new peer.
            // The `as unknown as ReplicationState` only narrows the pool to the
            // observables this service actually subscribes to.
            replicationState = (await replicateWebRTC({
              collection,
              topic: syncTopic,
              pull: {
                batchSize: SYNC_REPLICATION_BATCH_SIZE,
                modifier: syncReplicationModifier,
              },
              push: {
                batchSize: SYNC_REPLICATION_BATCH_SIZE,
                modifier: syncReplicationModifier,
              },
              isPeerValid: async () => {
                try {
                  await this.assertNoPrivateRecords(db);
                  return isCurrentSession();
                } catch (peerError) {
                  logger.warn("[SyncService] Peer rejected: private data boundary", {
                    error: peerError,
                  });
                  return false;
                }
              },
              connectionHandlerCreator: getConnectionHandlerSimplePeer({
                signalingServerUrl: allowedSignalingServers[attempt]!,
                config: {
                  iceServers: ICE_SERVERS,
                },
                // RxDB types the option as `{ new(url: string): WebSocket }`;
                // a function declaration is callable with `new` at runtime,
                // but TS only assigns construct-signature types explicitly.
                webSocketConstructor: makeSignalingSocket as unknown as {
                  new (url: string): WebSocket;
                },
              }),
            })) as unknown as ReplicationState;
            break;
          } catch (signalingErr) {
            if (attempt < allowedSignalingServers.length - 1) {
              logger.warn(
                `[SyncService] Signaling server ${allowedSignalingServers[attempt]} failed, trying next`,
                { error: signalingErr },
              );
            } else {
              throw signalingErr;
            }
          }
        }

        if (!replicationState) {
          throw new Error(
            "Failed to create replication state for " + collection.name,
          );
        }
        if (!isCurrentSession()) {
          replicationState.cancel();
          return;
        }

        // Track active state - Using a more robust check for RxDB WebRTC
        // We'll monitor peer count and errors instead of active$ if not available

        // Log errors and update health
        const errorSub = replicationState.error$.subscribe((err: unknown) => {
          // Stale-session guard: a replication whose session was superseded
          // must not write health or arm a reconnect against the new session.
          // stopAll()'s unsubscribe covers the normal path; the guard also
          // covers emissions racing a generation bump before the unsubscribe
          // runs (e.g. simulatePartition bumps without unsubscribing).
          if (!isCurrentSession()) {return;}
          logger.error("[SyncService] Replication error", {
            collection: (collection as { name: string }).name,
            error: err,
          });
          this.syncHealth = "error";
          this.notify();
          this.scheduleReconnect(db);
        });
        this.subscriptions.push(errorSub);

        // Track connected peers
        const peerStates$ = replicationState.peerStates$;
        if (peerStates$) {
          const peerSub = peerStates$.subscribe(
            (peers: Map<unknown, unknown>) => {
              // Stale-session guard (same rationale as error$): a peer-count
              // emission from a superseded replication must not resurrect
              // "healthy" on the new session or move lastSyncTime.
              if (!isCurrentSession()) {return;}
              const oldPeers = this.connectedPeers;
              this.connectedPeers = peers.size;

              if (this.connectedPeers > 0) {
                this.syncHealth = "healthy";
                this.lastSyncTime = Date.now();
              } else if (this.isSyncing) {
                this.syncHealth = "connecting";
              }

              if (oldPeers !== this.connectedPeers) {
                this.notify();
              }
            },
          );
          this.subscriptions.push(peerSub);
        }

        this.replications.set(`${roomId}-${collection.name}`, replicationState);
      } catch (err) {
        logger.error("[SyncService] Failed to start replication", {
          collection: (collection as { name: string }).name,
          error: err,
        });
        if (!isCurrentSession()) {return;}
        this.syncHealth = "error";
        this.notify();
      }
    }

    if (isCurrentSession()) {
      this.startHealthCheck(db);
      this.registerOnlineListener(db);
    }
  }

  /**
   * Reconnect immediately when the browser reports connectivity is back.
   * Without this, a restored network waits for the next backoff retry (up to
   * RECONNECT_MAX_DELAY_MS) or the health-check restart, so the sync could
   * stall for a minute after the user comes back online.
   */
  private registerOnlineListener(db: RxDatabase): void {
    if (this.onlineListener || typeof window === "undefined") {return;}
    const listener = () => {
      if (!this.isSyncing || !this.currentRoomId) {return;}
      // Cancel any pending backoff and retry now: the connection is back.
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      this.reconnectAttempts = 0;
      logger.info("[SyncService] Online — triggering immediate reconnect");
      this.restartSync(db).catch((err) => {
        logger.error("[SyncService] Immediate reconnect failed", { error: err });
        this.scheduleReconnect(db);
      });
    };
    this.onlineListener = listener;
    window.addEventListener("online", listener);
  }

  /**
   * Simulates a network partition for stress testing.
   * Only available in non-production builds (Vite dev/test mode).
   */
  async simulatePartition(db: RxDatabase) {
    if (import.meta.env?.PROD) {
      logger.warn(
        "[SyncService] simulatePartition is not available in production",
      );
      return;
    }
    logger.warn("[SyncService] !!! SIMULATING NETWORK PARTITION !!!");
    // Invalidate any startup currently awaiting signaling/ICE work; the
    // partition must not let that stale startup install fresh replications.
    this.sessionGeneration++;
    this.syncHealth = "error";
    this.connectedPeers = 0;
    this.notify();

    // Force cancel all replications without stopping the service intent
    for (const rep of this.replications.values()) {
      try {
        const cancel = (rep as { cancel?: unknown }).cancel;
        if (typeof cancel === "function") {cancel.call(rep);}
      } catch (error) {
        logger.warn("[SyncService] Failed to cancel partitioned replication", {
          error,
        });
      }
    }
    this.replications.clear();

    // Trigger the auto-reconnect logic
    this.scheduleReconnect(db);
  }

  private reconnectAttempts = 0;
  // Monotonically identifies the active async start/stop lifecycle. Any
  // in-flight startup that is superseded by stopAll() must stop before it can
  // install subscriptions or replication handles into the new session.
  private sessionGeneration = 0;

  private scheduleReconnect(db: RxDatabase) {
    if (this.reconnectTimer) {
      return;
    }
    const scheduledGeneration = this.sessionGeneration;
    const scheduledRoomId = this.currentRoomId;

    // Exponential backoff: 2s, 4s, 8s, 16s, max 60s
    const delay = Math.min(
      SYNC_CONFIG.RECONNECT_MAX_DELAY_MS,
      SYNC_CONFIG.RECONNECT_BASE_DELAY_MS * Math.pow(2, this.reconnectAttempts),
    );
    this.reconnectAttempts++;

    logger.info("[SyncService] Scheduling auto-reconnect", {
      delay: delay / 1000,
      attempt: this.reconnectAttempts,
    });
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (
        this.sessionGeneration !== scheduledGeneration ||
        this.currentRoomId !== scheduledRoomId
      ) {
        return;
      }
      // The replication may have recovered on its own while the backoff was
      // ticking (peers reconnected after the error). Restarting a healthy
      // session would cancel in-flight push batches — a data-loss window —
      // and churn LWW reconciliation for nothing.
      if (this.syncHealth === "healthy" && this.connectedPeers > 0) {
        return;
      }
      if (this.isSyncing && this.currentRoomId) {
        try {
          await this.restartSync(db);
        } catch (err) {
          // Audit (sync client): a failed restart (e.g. all signaling
          // servers blocked) must NOT become an unhandled promise rejection
          // that silently kills the retry loop. Log and schedule the next
          // attempt — the backoff counter survives via restartSync's
          // preservation below, so a persistent failure ramps 2s→4s→8s…
          logger.error("[SyncService] Reconnect attempt failed, will retry", {
            error: err,
          });
          this.syncHealth = "error";
          this.notify();
          this.scheduleReconnect(db);
        }
      }
    }, delay);
  }

  private startHealthCheck(_db: RxDatabase) {
    void _db; // parameter kept for API compatibility
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }
    this.healthCheckTimer = setInterval(() => {
      if (this.isSyncing && this.connectedPeers === 0) {
        logger.warn(
          "[SyncService] Health check: No peers connected, attempting soft restart",
        );
        // We don't full restart, just notify UI we are still looking
        this.syncHealth = "connecting";
        this.notify();
      } else if (this.isSyncing && this.connectedPeers > 0) {
        // Reset reconnect attempts if we are healthy
        this.reconnectAttempts = 0;
      }
    }, SYNC_CONFIG.HEALTH_CHECK_INTERVAL_MS);
  }

  /**
   * Restarts the synchronization process.
   */
  async restartSync(db: RxDatabase) {
    logger.info("[SyncService] Restarting sync process");
    const roomId = this.currentRoomId || (await this.generateRoomId());
    // Preserve the room credential across a transport reconnect. stopAll()
    // intentionally clears the in-memory secret, but regenerating it here
    // would make the restarted peer incompatible with an existing room whose
    // server-side secret is still alive.
    const roomSecret = this.roomSecret;
    // Audit (sync client): preserve the backoff counter across stopAll().
    // stopAll() resets reconnectAttempts to 0, which would collapse the
    // exponential ramp (2s→4s→8s→16s→60s) to a flat 2s on every retry — the
    // documented backoff only worked in isolation, not in the real
    // error→reconnect cycle. The counter resets naturally on success via the
    // health check (peers > 0).
    const backoffAttempts = this.reconnectAttempts;
    // Preserve dedup cache across reconnect to the same room — only clear
    // on explicit room switch to prevent re-application of recently-seen
    // operations that the peer didn't receive ACKs for.
    this.stopAll(false);
    this.reconnectAttempts = backoffAttempts;
    if (roomId) {
      await this.startP2PSync(db, roomId, roomSecret ?? undefined);
    }
  }

  /**
   * Stops all active replications.
   * Clears all timers, subscriptions and replication handles.
   * @param clearDedupe - Whether to clear the deduplication cache. Pass
   *   `false` when reconnecting to the same room to prevent re-application
   *   of recently-seen operations. Default `true` (full cleanup).
   */
  stopAll(clearDedupe = true) {
    // Invalidate every pending async startup before releasing resources.
    this.sessionGeneration++;
    // Allow a new caller to start a fresh session while an invalidated startup
    // unwinds. The old operation cannot clear or overwrite the new promise
    // because its finally block checks identity.
    this.startPromise = null;
    this.startPromiseRoomId = null;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }
    if (this.onlineListener) {
      window.removeEventListener("online", this.onlineListener);
      this.onlineListener = null;
    }
    this.reconnectTimer = null;
    this.healthCheckTimer = null;
    this.reconnectAttempts = 0;

    for (const sub of this.subscriptions) {
      try {
        sub.unsubscribe();
      } catch (error) {
        logger.warn("[SyncService] Failed to unsubscribe sync listener", { error });
      }
    }
    this.subscriptions = [];

    for (const rep of this.replications.values()) {
      try {
        const cancel = (rep as { cancel?: unknown }).cancel;
        if (typeof cancel === "function") {
          cancel.call(rep);
        }
      } catch (error) {
        logger.warn("[SyncService] Failed to cancel replication", { error });
      }
    }
    this.replications.clear();
    for (const sub of this.privacyGuardSubscriptions) {
      try {
        sub.unsubscribe();
      } catch (error) {
        logger.warn("[SyncService] Failed to unsubscribe privacy guard", { error });
      }
    }
    this.privacyGuardSubscriptions = [];
    this.closeDedupeChannel();
    // Dedupe hashes are scoped to one replication session. Retaining them
    // across a room switch can suppress a legitimate operation in the new
    // session when it has the same collection/id/action tuple. On reconnect
    // to the same room, preserve them to prevent re-application of
    // operations the peer didn't receive ACKs for.
    if (clearDedupe) {
      this.clearDedupeCache();
    }
    this.isSyncing = false;
    this.currentRoomId = null;
    this.roomSecret = null;
    this.connectedPeers = 0;
    this.lastSyncTime = null;
    this.syncHealth = "connecting";
    this.notify();
  }

  /** Secret for the active collaboration session, if any. */
  getRoomSecret(): string | null {
    return this.roomSecret;
  }

  /**
   * S5/ADR-018: Build ICE server config from environment variables.
   * Falls back to the provided default STUN servers if no TURN is configured.
   */
  private buildIceServersFromEnv(
    defaultStun: RTCIceServer[],
    /** Optional env override for testing. Falls back to import.meta.env. */
    env?: Record<string, string | undefined>,
  ): RTCIceServer[] {
    const e = env ?? { VITE_TURN_URL: getEnvVar("VITE_TURN_URL"), VITE_TURN_USERNAME: getEnvVar("VITE_TURN_USERNAME"), VITE_TURN_CREDENTIAL: getEnvVar("VITE_TURN_CREDENTIAL") };
    const turnUrl = e?.VITE_TURN_URL?.trim();
    if (!turnUrl) {return defaultStun;}

    const turnUsername = e?.VITE_TURN_USERNAME ?? "";
    const turnCredential = e?.VITE_TURN_CREDENTIAL ?? "";

    if (!turnUsername || !turnCredential) {
      logger.warn(
        "[SyncService] VITE_TURN_URL set but VITE_TURN_USERNAME/VITE_TURN_CREDENTIAL missing; skipping TURN",
      );
      return defaultStun;
    }

    // Static TURN values are the only credential-bearing path that can be
    // compiled into the client. Reject malformed values before they reach
    // WebRTC; in particular, control characters must never cross a network
    // boundary or be retained by a browser connection object.
    if (
      !isSafeIceString(turnUrl, MAX_ICE_URL_LENGTH) ||
      !isSafeIceString(turnUsername, MAX_ICE_CREDENTIAL_LENGTH) ||
      !isSafeIceString(turnCredential, MAX_ICE_CREDENTIAL_LENGTH) ||
      !/^(stun|stuns|turn|turns):/i.test(turnUrl)
    ) {
      logger.warn(
        "[SyncService] Invalid static TURN configuration; skipping TURN credentials",
      );
      return defaultStun;
    }

    // SECURITY (audit #1): static TURN credentials embedded in the bundle are
    // readable by ANYONE — a determined attacker can mine the relay. Prefer
    // the dynamic probe (fetchIceServersFromSignaling), which mints
    // short-lived coturn REST credentials via the self-hosted signaling
    // server (TURN_RELAY_HOST + TURN_STATIC_AUTH_SECRET). This fallback
    // exists only for deployments that must keep static credentials.
    logger.warn(
      "[SyncService] Using STATIC TURN credentials from env vars — these are " +
        "exposed to anyone who downloads the bundle. Prefer dynamic TURN via " +
        "the signaling server (TURN_RELAY_HOST + TURN_STATIC_AUTH_SECRET on " +
        "server/src/index.ts).",
    );
    return [
      { urls: turnUrl, username: turnUsername, credential: turnCredential },
      ...defaultStun,
    ];
  }

  /**
   * Generates a random room ID using crypto.getRandomValues.
   * Not derived from the session token or the master password.
   *
   * S0/R5 fix: Returns ALL 32 hex characters (16 bytes = 128 bits of entropy).
   * The previous implementation truncated with `.substring(0, 16)`, reducing
   * entropy to 64 bits and exposing room IDs to birthday-paradox collisions
   * and external signaling-server brute-force enumeration.
   */
  async generateRoomId(): Promise<string> {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
  }
}

export const syncService = new SyncService();

