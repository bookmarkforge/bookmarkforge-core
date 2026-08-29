import LZString from "lz-string";
import { validateIceServers } from "../utils/networkFirewall";
import { logger } from "../utils/logger";
import { initDB } from "../db/database";
import type { RxDocument } from "rxdb";
import type { BookmarkDocType, DocumentDocType } from "../db/schema";
import {
  MAX_CHUNK_SIZE,
  MAX_COMPLETED_SYNC_SESSIONS,
  MAX_DESCRIPTION_ENCODED_CHARS,
  MAX_INCOMING_MESSAGE_CHARS,
  MAX_SDP_CHARS,
  MAX_SYNC_CURSOR_LENGTH,
  MAX_SYNC_DOCS_PER_BATCH,
  MAX_TOTAL_PAYLOAD,
} from "./webrtc-sync/protocol";
import {
  isOptionalSyncCursor,
  isSyncStartMessage,
  isValidSessionDescription,
  isValidSyncDoc,
  type SyncAckMessage,
  type SyncChunkMessage,
  type SyncStartMessage,
} from "./webrtc-sync/validation";
import { compareSyncVersions, constantTimeStringEqual } from "./webrtc-sync/compare";

// Re-exported for backward compatibility — the canonical definitions live in
// webrtc-sync/compare.ts (refactor, no behavior change).
export { compareSyncVersions, constantTimeStringEqual } from "./webrtc-sync/compare";

const SYNC_BATCH_SIZE = 500;
const SYNC_ACK_TIMEOUT_MS = 10_000;
const SYNC_CAPABILITY_TIMEOUT_MS = 250;
const LEGACY_SYNC_BATCH_LIMIT = 10_000;
// Durable cursor for the incremental QR sync: the latest `updatedAt` bound
// this device can safely ask a peer to resume from. Not a secret — a bare
// ISO timestamp — so it lives in localStorage rather than the encrypted
// vault, and survives app restarts (the point of the feature). Wiped only
// when the peer resends a full snapshot or this device's own data advances.
const SYNC_CURSOR_STORAGE_KEY = "bmf_webrtc_sync_last_at";
// A peer may send chunks slowly, but it cannot reserve the receiver forever by
// sending sync_start and then going silent. The timer is refreshed only after
// accepted chunks and is cleared once verification/persistence begins.
const SYNC_TRANSFER_TIMEOUT_MS = 30_000;



export type SyncState =
  | "disconnected"
  | "gathering"
  | "ready_to_share"
  | "connecting"
  | "connected"
  | "syncing"
  | "completed"
  | "error";


async function hmacSha256(key: string, data: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(data));
  return Array.from(new Uint8Array(sig), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

async function sha256(data: string): Promise<string> {
  const hashBuffer = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(data),
  );
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Thrown when the runtime does not expose the WebRTC peer-connection API
 * (e.g. the Playwright WebKit build or some embedded WebViews). Callers can
 * feature-detect with `isWebRTCSupported()` to render a graceful fallback UI
 * instead of surfacing a raw ReferenceError from `new RTCPeerConnection`.
 */
export class WebRTCUnsupportedError extends Error {
  constructor() {
    super("WebRTC is not supported by this browser");
    this.name = "WebRTCUnsupportedError";
  }
}

/**
 * True when the runtime exposes the WebRTC peer-connection API. The P2P sync
 * feature degrades gracefully (typed error + UI fallback) when false, so the
 * rest of the app still works on engines without WebRTC.
 */
export function isWebRTCSupported(): boolean {
  return typeof globalThis.RTCPeerConnection !== "undefined";
}

class WebRTCSyncService {
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private onStateChange: ((state: SyncState, message?: string) => void) | null =
    null;
  private onProgress: ((progress: number) => void) | null = null;
  private hostFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private clientFallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private incomingTransferTimer: ReturnType<typeof setTimeout> | null = null;

  private currentState: SyncState = "disconnected";

  private setState(state: SyncState, message?: string) {
    this.currentState = state;
    if (this.onStateChange) {
      this.onStateChange(state, message);
    }
    logger.info(
      `[WebRTCSync] State changed to: ${state}`,
      message ? { message } : undefined,
    );
  }

  public registerCallbacks(
    stateCallback: (state: SyncState, message?: string) => void,
    progressCallback: (progress: number) => void,
  ) {
    this.onStateChange = stateCallback;
    this.onProgress = progressCallback;
  }

  private minimizeSDP(sdp: string): string {
    const lines = sdp.split("\r\n");
    const filtered = lines.filter((line) => {
      if (
        line.startsWith("v=") ||
        line.startsWith("o=") ||
        line.startsWith("s=") ||
        line.startsWith("t=") ||
        line.startsWith("m=application") ||
        line.startsWith("c=")
      )
        {return true;}
      if (
        line.startsWith("a=group:") ||
        line.startsWith("a=extmap-allow-mixed") ||
        line.startsWith("a=msid-semantic:") ||
        line.startsWith("a=ice-options:") ||
        line.startsWith("a=mid:") ||
        line.startsWith("a=sctp-port:") ||
        line.startsWith("a=max-message-size:") ||
        line.startsWith("a=setup:")
      )
        {return true;}
      if (
        line.startsWith("a=fingerprint:") ||
        line.startsWith("a=ice-ufrag:") ||
        line.startsWith("a=ice-pwd:")
      )
        {return true;}
      if (line.startsWith("a=candidate:")) {
        // Only keep local host candidates (no srflx or relay for 100% privacy)
        if (line.includes("typ host")) {return true;}
        return false;
      }
      return false;
    });
    return `${filtered.join("\r\n")}\r\n`;
  }

  private encodeLocalDescription(): string {
    if (!this.peerConnection?.localDescription) {return "";}
    const desc = {
      type: this.peerConnection.localDescription.type,
      sdp: this.minimizeSDP(this.peerConnection.localDescription.sdp),
    };
    if (!isValidSessionDescription(desc)) {
      logger.warn("[WebRTCSync] Refused to encode an invalid SDP description");
      return "";
    }
    const jsonStr = JSON.stringify(desc);
    const encoded = LZString.compressToEncodedURIComponent(jsonStr);
    if (encoded.length > MAX_DESCRIPTION_ENCODED_CHARS) {
      logger.warn("[WebRTCSync] Refused to encode an oversized SDP description");
      return "";
    }
    return encoded;
  }

  public decodeDescription(encoded: string): RTCSessionDescriptionInit | null {
    try {
      if (
        typeof encoded !== "string" ||
        encoded.length === 0 ||
        encoded.length > MAX_DESCRIPTION_ENCODED_CHARS
      ) {
        throw new Error("Encoded description exceeds the safe limit");
      }
      const jsonStr = LZString.decompressFromEncodedURIComponent(encoded);
      if (!jsonStr || jsonStr.length > MAX_SDP_CHARS + 128) {
        throw new Error("Decoded description exceeds the safe limit");
      }
      const description: unknown = JSON.parse(jsonStr);
      if (!isValidSessionDescription(description)) {
        throw new Error("Decoded description has an invalid shape");
      }
      return description;
    } catch (error) {
      logger.error("[WebRTCSync] Failed to decode description", { error });
      return null;
    }
  }

  private setupDataChannel() {
    const channel = this.dataChannel;
    if (!channel) {return;}

    channel.onopen = () => {
      // An old channel can finish opening after a retry created a new one.
      if (this.dataChannel !== channel) {return;}
      this.setState("connected");
      void this.startSync();
    };

    channel.onclose = () => {
      // Ignore lifecycle events from a superseded session. Without this guard,
      // a late close from teardownPreviousSession could overwrite the state of
      // a freshly established connection.
      if (this.dataChannel !== channel) {return;}
      this.dataChannel = null;
      this.clearPendingBatchAcks();
      this.resetPaginationSession();
      this.resetBuffer();
      this.supportsPaginatedSync = false;
      this.capabilitiesNegotiated = false;
      this.peerLastSyncAt = null;
      this.advertisedCursor = undefined;
      if (this.capabilityWaiter) {
        clearTimeout(this.capabilityWaiter.timer);
        this.capabilityWaiter.resolve(false);
        this.capabilityWaiter = null;
      }
      if (this.peerConnection) {
        try {
          this.peerConnection.close();
        } catch {
          /* INTENTIONAL SILENCE: closing a broken peer connection is best-effort teardown. */
        }
        this.peerConnection = null;
      }
      this.setState("disconnected");
    };

    channel.onmessage = async (event) => {
      if (this.dataChannel !== channel) {return;}
      try {
        if (
          typeof event.data !== "string" ||
          event.data.length > MAX_INCOMING_MESSAGE_CHARS
        ) {
          logger.warn("[WebRTCSync] Rejected oversized or non-text message");
          this.setState("error", "Incoming sync message exceeds the safe limit");
          this.resetBuffer();
          return;
        }
        const message = JSON.parse(event.data);
        await this.handleIncomingMessage(message);
      } catch (error) {
        logger.error("[WebRTCSync] Error handling message", { error });
      }
    };
  }

  /**
   * Close any previous session's peer connection and clear stale session
   * timers before starting a fresh one. Direct teardown (not disconnect())
   * so the fresh session's setup — fallback timers, capability detection,
   * pagination flags — is not clobbered. Without the timer clears, a
   * disconnectTimer left by a completed sync could fire disconnect()
   * mid-gathering of the new session.
   */
  private teardownPreviousSession(): void {
    if (this.peerConnection) {
      try {
        this.peerConnection.close();
      } catch {
        /* INTENTIONAL SILENCE: closing a possibly-broken peer connection is best-effort. */
      }
      this.peerConnection = null;
    }
    // RTCPeerConnection.close() tears down its data channels per spec, so
    // dropping the reference here is sufficient — no separate close needed.
    this.dataChannel = null;
    this.clearPendingBatchAcks();
    this.resetPaginationSession();
    this.supportsPaginatedSync = false;
    this.capabilitiesNegotiated = false;
    this.peerLastSyncAt = null;
    this.advertisedCursor = undefined;
    if (this.capabilityWaiter) {
      clearTimeout(this.capabilityWaiter.timer);
      this.capabilityWaiter.resolve(false);
      this.capabilityWaiter = null;
    }
    this.resetBuffer();
    if (this.hostFallbackTimer) {
      clearTimeout(this.hostFallbackTimer);
      this.hostFallbackTimer = null;
    }
    if (this.clientFallbackTimer) {
      clearTimeout(this.clientFallbackTimer);
      this.clientFallbackTimer = null;
    }
    if (this.disconnectTimer) {
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
    }
    this.outboundSyncActive = false;
  }

  public async startHost(): Promise<string> {
    // A retry (host again, or host after a failed client attempt) must not
    // leak the old RTCPeerConnection's ICE agents/sockets nor inherit stale
    // session timers. Direct teardown (not disconnect()) keeps the fresh
    // session's setup untouched.
    this.teardownPreviousSession();
    // Graceful degradation when the engine has no WebRTC API (WebKit build,
    // embedded WebView): fail with a typed error and a clear state instead of
    // a raw ReferenceError mid-handshake.
    if (!isWebRTCSupported()) {
      this.setState("error", "WebRTC is not supported by this browser");
      throw new WebRTCUnsupportedError();
    }
    this.setState("gathering");
    await validateIceServers({ iceServers: [] }, "WebRTC_P2P_Host");
    this.peerConnection = new RTCPeerConnection({
      iceServers: [], // Empty array forces NO STUN/TURN, absolute LAN only (Air-Gapped)
    });

    this.dataChannel = this.peerConnection.createDataChannel(
      "bmf-sync-channel",
      {
        ordered: true,
      },
    );
    this.setupDataChannel();

    const pc = this.peerConnection!;
    return new Promise((resolve, reject) => {
      // L-10: `resolved` is closure-scoped per call. Without it, a stale timer
      // from a previous session (whose promise already resolved via ICE) would
      // see the NEW session still in "gathering" and resolve it early with a
      // stale description. The flag makes the fallback a no-op once this
      // session's promise has settled, the timer is cleared eagerly, and the
      // `this.peerConnection === pc` identity check keeps a stale timer or
      // handler from ever touching a newer session's connection.
      let resolved = false;
      pc.onicecandidate = (event) => {
        if (!event.candidate && !resolved && this.peerConnection === pc) {
          resolved = true;
          if (this.hostFallbackTimer) {
            clearTimeout(this.hostFallbackTimer);
            this.hostFallbackTimer = null;
          }
          // Gathering completed
          this.setState("ready_to_share");
          resolve(this.encodeLocalDescription());
        }
      };

      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .catch((err: unknown) => {
          if (resolved) {return;}
          resolved = true;
          if (this.hostFallbackTimer) {
            clearTimeout(this.hostFallbackTimer);
            this.hostFallbackTimer = null;
          }
          const message = err instanceof Error ? err.message : String(err);
          this.setState("error", "Failed to create offer: " + message);
          reject(err instanceof Error ? err : new Error(message));
        });

      // Fallback if ICE takes too long
      this.hostFallbackTimer = setTimeout(() => {
        if (
          this.currentState === "gathering" &&
          !resolved &&
          this.peerConnection === pc
        ) {
          resolved = true;
          this.hostFallbackTimer = null;
          this.setState("ready_to_share");
          resolve(this.encodeLocalDescription());
        }
      }, 3000);
    });
  }

  public async processClientAnswer(encodedAnswer: string) {
    if (!this.peerConnection) {return;}
    this.setState("connecting");    const answer = this.decodeDescription(encodedAnswer);
    if (!answer || answer.type !== "answer") {
      this.setState("error", "Invalid QR code");
      return;
    }

    try {
      await this.peerConnection.setRemoteDescription(answer);
    } catch (error: unknown) {
      this.setState(
        "error",
        "Failed to connect: " +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  }

  public async startClient(encodedOffer: string): Promise<string> {
    // Retry safety — see startHost note.
    this.teardownPreviousSession();
    // Graceful degradation — see startHost note.
    if (!isWebRTCSupported()) {
      this.setState("error", "WebRTC is not supported by this browser");
      return Promise.reject(new WebRTCUnsupportedError());
    }
    this.setState("gathering");
    const offer = this.decodeDescription(encodedOffer);
    if (!offer || offer.type !== "offer") {
      const error = new Error("Invalid Host QR code");
      this.setState("error", error.message);
      return Promise.reject(error);
    }

    await validateIceServers({ iceServers: [] }, "WebRTC_P2P_Client");
    this.peerConnection = new RTCPeerConnection({
      iceServers: [], // LAN only
    });

    this.peerConnection.ondatachannel = (event) => {
      this.dataChannel = event.channel;
      this.setupDataChannel();
    };

    const pc = this.peerConnection!;
    return new Promise((resolve, reject) => {
      // L-10: same resolved-flag + identity guard as startHost (see note).
      let resolved = false;
      pc.onicecandidate = (event) => {
        if (!event.candidate && !resolved && this.peerConnection === pc) {
          resolved = true;
          if (this.clientFallbackTimer) {
            clearTimeout(this.clientFallbackTimer);
            this.clientFallbackTimer = null;
          }
          this.setState("ready_to_share");
          resolve(this.encodeLocalDescription());
        }
      };

      pc.setRemoteDescription(offer)
        .then(() => pc.createAnswer())
        .then((answer) => pc.setLocalDescription(answer))
        .catch((err: unknown) => {
          if (resolved) {return;}
          resolved = true;
          if (this.clientFallbackTimer) {
            clearTimeout(this.clientFallbackTimer);
            this.clientFallbackTimer = null;
          }
          const message = err instanceof Error ? err.message : String(err);
          this.setState("error", "Failed to create answer: " + message);
          reject(err instanceof Error ? err : new Error(message));
        });

      // Fallback
      this.clientFallbackTimer = setTimeout(() => {
        if (
          this.currentState === "gathering" &&
          !resolved &&
          this.peerConnection === pc
        ) {
          resolved = true;
          this.clientFallbackTimer = null;
          this.setState("ready_to_share");
          resolve(this.encodeLocalDescription());
        }
      }, 3000);
    });
  }

  // --- Database Sync Logic ---
  // Encryption: WebRTC mandates DTLS (RFC 8827 §6) which encrypts all data
  // channels automatically. No additional AES-GCM layer is needed — and a
  // locally-derived key (random seed per peer) would never match on both sides.

  private sendOrThrow(data: string): void {
    if (!this.dataChannel || this.dataChannel.readyState !== "open") {
      throw new Error("Data channel is not open");
    }
    const MAX_BUFFER = 16 * 1024 * 1024;
    if (this.dataChannel.bufferedAmount > MAX_BUFFER) {
      throw new Error("Data channel buffer full, cannot send");
    }
    this.dataChannel.send(data);
  }

  private async startSync() {
    // Monotonic generation token: closing and reopening the modal (or a
    // retry) starts a NEW session that supersedes this run. A superseded
    // startSync must never touch shared state — its catch would otherwise
    // paint the new session's UI with the old channel's error, and its
    // clearPendingBatchAcks() would drop the new session's batch ACKs.
    const generation = ++this.syncGeneration;
    // Mark the outbound transfer as in flight. The peer may finish receiving
    // our payload before we finish sending theirs; the post-completion
    // disconnect must be deferred until this flag is cleared (see
    // maybeScheduleDisconnectAfterSync), or the channel would close mid-send.
    this.outboundSyncActive = true;
    this.setState("syncing");
    if (this.onProgress) {this.onProgress(10);}

    try {
      // Negotiate before querying. New peers unlock bounded pagination; an
      // older peer that ignores this control frame falls back to the legacy
      // single payload instead of receiving an ACK-dependent batch.
      await this.negotiateCapabilities();
      if (generation !== this.syncGeneration) {return;}
      const db = await initDB();
      if (generation !== this.syncGeneration) {return;}
      // Incremental resume: when the peer advertised a cursor ("I already have
      // everything with updatedAt >= this"), only re-send documents changed
      // since then instead of the full vault snapshot. null (first pairing /
      // peer without the feature / empty vault) means a full snapshot. The
      // bound is on the peer's clock by construction — it is the value the
      // peer stored from a previous sync — and `$gte` makes boundary re-sends
      // idempotent under LWW.
      const since = this.peerLastSyncAt;
      const syncStartedAt = new Date().toISOString();
      let batchIndex = 0;
      const syncSessionId = crypto.randomUUID();
      let lastDocumentId = "";
      let lastBookmarkId = "";

      // Query one bounded page at a time using keyset pagination. The
      // start-time upper bound prevents records created during this run from
      // appearing in a later page. This is bounded and deterministic for the
      // captured set, though it is not a transactional database snapshot.
      const pageLimit = this.supportsPaginatedSync
        ? SYNC_BATCH_SIZE
        : LEGACY_SYNC_BATCH_LIMIT;
      // Defense-in-depth cap on sync pages (pruneVersions OOM class): keyset
      // pagination strictly advances lastDocumentId/lastBookmarkId, so
      // progress is data-guaranteed, but a DB quirk that stopped advancing
      // the cursor would otherwise loop forever. 10k batches x 500 docs
      // covers 5M records — far beyond the vault scale target.
      const MAX_SYNC_BATCHES = 10_000;
      while (true) {
        // A superseded run bails at the first checkpoint instead of wasting
        // DB/send work or reporting progress into the new session's UI.
        if (generation !== this.syncGeneration) {return;}
        if (batchIndex >= MAX_SYNC_BATCHES) {
          throw new Error(
            `Sync exceeded ${MAX_SYNC_BATCHES} batches; aborting to avoid an unbounded loop`,
          );
        }
        // P-1: private content is never synced to a peer. Deleted docs
        // (isDeleted: true) ARE sent as tombstones: without them a peer's
        // stale mirror would resurrect a locally deleted bookmark, and
        // removals would never propagate. The receiver applies tombstones
        // with last-write-wins by updatedAt, so only genuinely newer
        // deletions land. Note: the selector no longer matches the
        // ["isPrivate", "isDeleted", "createdAt"] index.
        const documentSelector = {
          isPrivate: false,
          createdAt: { $lte: syncStartedAt },
          ...(since ? { updatedAt: { $gte: since } } : {}),
          ...(lastDocumentId ? { id: { $gt: lastDocumentId } } : {}),
        } as never;
        const bookmarkSelector = {
          isPrivate: false,
          createdAt: { $lte: syncStartedAt },
          ...(since ? { updatedAt: { $gte: since } } : {}),
          ...(lastBookmarkId ? { id: { $gt: lastBookmarkId } } : {}),
        } as never;
        const [documentsPlusOne, bookmarksPlusOne] = await Promise.all([
          db.documents
            .find({
              selector: documentSelector,
              sort: [{ id: "asc" }],
              limit: pageLimit + 1,
            })
            .exec(),
          db.bookmarks
            .find({
              selector: bookmarkSelector,
              sort: [{ id: "asc" }],
              limit: pageLimit + 1,
            })
            .exec(),
        ]);

        const exceededLegacyLimit =
          !this.supportsPaginatedSync &&
          (documentsPlusOne.length > pageLimit || bookmarksPlusOne.length > pageLimit);
        if (exceededLegacyLimit) {
          throw new Error(
            "Peer does not support paginated WebRTC sync; update the other device and retry",
          );
        }
        const hasMore =
          this.supportsPaginatedSync &&
          (documentsPlusOne.length > pageLimit || bookmarksPlusOne.length > pageLimit);
        const documents = documentsPlusOne.slice(0, pageLimit);
        const bookmarks = bookmarksPlusOne.slice(0, pageLimit);
        if (documents.length > 0) {
          lastDocumentId = String(
            (documents[documents.length - 1] as RxDocument<DocumentDocType>).toJSON().id,
          );
        }
        if (bookmarks.length > 0) {
          lastBookmarkId = String(
            (bookmarks[bookmarks.length - 1] as RxDocument<BookmarkDocType>).toJSON().id,
          );
        }

        // Always send one final empty batch for an empty vault, preserving the
        // old protocol's completed behavior.
        const payload = {
          type: "sync_data",
          documents: documents.map((d: RxDocument<DocumentDocType>) =>
            d.toJSON(),
          ),
          bookmarks: bookmarks.map((b: RxDocument<BookmarkDocType>) =>
            b.toJSON(),
          ),
        };
        const payloadStr = JSON.stringify(payload);
        const checksum = await sha256(payloadStr);

        // Ephemeral per-batch HMAC key delivered over the DTLS-encrypted
        // channel. Each batch has its own id so acknowledgements cannot be
        // confused across pages.
        const syncAuth = crypto.randomUUID();
        const payloadHmac = await hmacSha256(syncAuth, payloadStr);
        const batchId = crypto.randomUUID();
        const totalChunks = Math.ceil(payloadStr.length / MAX_CHUNK_SIZE);
        if (totalChunks < 1 || totalChunks > 2000) {
          throw new Error(
            "Sync batch exceeds the safe WebRTC payload limit; reduce document size and retry",
          );
        }
        // Install the waiter before sending anything. The receiver may
        // process a tiny batch immediately, so ACKs with no active waiter are
        // intentionally ignored rather than retained in an unbounded cache.
        const ackPromise = hasMore ? this.waitForBatchAck(batchId) : null;

        if (this.onProgress) {
          this.onProgress(Math.min(95, 30 + batchIndex * 5));
        }

        this.sendOrThrow(
          JSON.stringify({
            type: "sync_start",
            totalChunks,
            checksum,
            auth: syncAuth,
            hmac: payloadHmac,
            batchId,
            batchIndex,
            hasMore,
            syncSessionId,
          }),
        );

        for (let i = 0; i < totalChunks; i++) {
          const chunk = payloadStr.slice(i * MAX_CHUNK_SIZE, (i + 1) * MAX_CHUNK_SIZE);
          this.sendOrThrow(
            JSON.stringify({ type: "sync_chunk", index: i, data: chunk }),
          );
          if (this.onProgress) {
            this.onProgress(Math.min(95, 30 + batchIndex * 5 + (i / Math.max(totalChunks, 1)) * 5));
          }
          await new Promise((r) => setTimeout(r, 5));
        }

        if (ackPromise) {
          await ackPromise;
        }
        if (!hasMore) {break;}
        batchIndex++;
      }
      if (generation !== this.syncGeneration) {return;}
      if (this.onProgress) {this.onProgress(100);}
    } catch (err: unknown) {
      // A stale run's failure belongs to the OLD channel: never poison the
      // current session with its error state or drop its pending ACKs.
      if (generation !== this.syncGeneration) {return;}
      this.clearPendingBatchAcks();
      this.setState(
        "error",
        "Sync failed: " + (err instanceof Error ? err.message : String(err)),
      );
    } finally {
      // Only the latest startSync owns the outbound flag. A stale run
      // superseded by a newer session must not clear the new session's flag.
      if (generation === this.syncGeneration) {
        this.outboundSyncActive = false;
        // If the inbound transfer already completed while we were still
        // sending, the disconnect was deferred; schedule it now that our
        // outbound transfer is done.
        this.maybeScheduleDisconnectAfterSync();
      }
    }
  }

  private incomingBuffer: string[] = [];
  private expectedChunks: number = 0;
  private expectedChecksum: string = "";
  private expectedSyncAuth: string | null = null;
  private expectedPayloadHmac: string | null = null;
  private receivedPayloadBytes = 0;
  private expectedBatchId: string | null = null;
  private expectedBatchIndex: number | null = null;
  private expectedSyncSessionId: string | null = null;
  private expectedHasMore = false;
  private nextExpectedBatchIndex = 0;
  private paginatedSessionActive = false;
  private paginatedSessionId: string | null = null;
  private supportsPaginatedSync = false;
  private capabilitiesNegotiated = false;
  private completedSyncSessions = new Set<string>();
  /** True while a complete payload is being verified and persisted. */
  private processingIncoming = false;
  /** True while this peer is still sending its own payload (startSync in
   * flight). The 2s post-completion disconnect must be deferred while it is
   * active, or the channel would close mid-send and truncate the outbound
   * transfer (the peer would receive a partial vault). */
  private outboundSyncActive = false;
  /** Monotonic token so a stale startSync (superseded by a newer session)
   * can tell it no longer owns the outbound flag and must not clear it. */
  private syncGeneration = 0;
  private pendingBatchAcks = new Map<
    string,
    {
      resolve: () => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private capabilityWaiter: {
    resolve: (supported: boolean) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  /** Incremental-sync cursor the PEER advertised in the capability handshake
   * ("everything I have with updatedAt >= this"). null = first pairing or a
   * peer without the incremental feature (full snapshot). Reset per session. */
  private peerLastSyncAt: string | null = null;
  /** Session-scoped cache of the cursor WE advertise to the peer. undefined
   * = not read yet this session; read lazily so the 250ms capability timeout
   * does not wait on IndexedDB twice. Reset per session. */
  private advertisedCursor: string | null | undefined;

  private async handleIncomingMessage(msg: unknown) {
    if (typeof msg === "object" && msg !== null && "type" in msg) {
      const typedMsg = msg as { type: string };

      if (typedMsg.type === "sync_capabilities") {
        const capabilities = msg as { paginated?: unknown; lastSyncAt?: unknown };
        if (typeof capabilities.paginated !== "boolean") {
          this.setState("error", "Invalid sync capability metadata");
          return;
        }
        if (!isOptionalSyncCursor(capabilities.lastSyncAt)) {
          this.setState("error", "Invalid sync capability cursor");
          return;
        }
        // The peer's advertised cursor is the resume bound for OUR outbound
        // incremental sync. Capture it before any negotiation-state check so
        // an already-negotiated session (frame arriving after our ACK) still
        // records it — both frames carry it, so either order is safe.
        if (typeof capabilities.lastSyncAt === "string") {
          this.peerLastSyncAt = capabilities.lastSyncAt;
        }
        // Capability negotiation is one-shot per data-channel session. A
        // later downgrade would let a peer switch framing rules mid-transfer.
        if (this.capabilitiesNegotiated) {return;}
        this.capabilitiesNegotiated = true;
        this.supportsPaginatedSync = capabilities.paginated;
        if (this.capabilityWaiter) {
          clearTimeout(this.capabilityWaiter.timer);
          const waiter = this.capabilityWaiter;
          this.capabilityWaiter = null;
          waiter.resolve(capabilities.paginated);
        }
        if (this.supportsPaginatedSync && this.dataChannel?.readyState === "open") {
          this.sendOrThrow(
            JSON.stringify({
              type: "sync_capabilities_ack",
              paginated: true,
              lastSyncAt: await this.getAdvertisedCursor(),
            }),
          );
        }
        return;
      }

      if (typedMsg.type === "sync_capabilities_ack") {
        const capabilities = msg as { paginated?: unknown; lastSyncAt?: unknown };
        if (typeof capabilities.paginated !== "boolean") {
          this.setState("error", "Invalid sync capability acknowledgement");
          return;
        }
        if (!isOptionalSyncCursor(capabilities.lastSyncAt)) {
          this.setState("error", "Invalid sync capability cursor");
          return;
        }
        if (typeof capabilities.lastSyncAt === "string") {
          this.peerLastSyncAt = capabilities.lastSyncAt;
        }
        if (this.capabilitiesNegotiated) {
          if (this.capabilityWaiter) {
            clearTimeout(this.capabilityWaiter.timer);
            const waiter = this.capabilityWaiter;
            this.capabilityWaiter = null;
            waiter.resolve(capabilities.paginated);
          }
          return;
        }
        this.capabilitiesNegotiated = true;
        const supported = capabilities.paginated;
        this.supportsPaginatedSync = supported;
        if (this.capabilityWaiter) {
          clearTimeout(this.capabilityWaiter.timer);
          const waiter = this.capabilityWaiter;
          this.capabilityWaiter = null;
          waiter.resolve(supported);
        }
        return;
      }

      if (typedMsg.type === "sync_ack") {
        const ack = msg as Partial<SyncAckMessage>;
        if (
          typeof ack.batchId !== "string" ||
          ack.batchId.length === 0 ||
          ack.batchId.length > 100
        ) {
          this.setState("error", "Invalid sync batch acknowledgement");
          return;
        }
        const pending = this.pendingBatchAcks.get(ack.batchId);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingBatchAcks.delete(ack.batchId);
          pending.resolve();
        }
        // Ignore stale or unsolicited acknowledgements. They are not retained
        // because they carry no useful state and must not become a memory
        // growth vector.
        return;
      }

      if (typedMsg.type === "sync_start") {
        const startMsg = msg as SyncStartMessage;
        if (!isSyncStartMessage(startMsg)) {
          this.setState("error", "Invalid sync batch metadata");
          this.resetPaginationSession();
          this.resetBuffer();
          return;
        }
        const incomingBatchId = startMsg.batchId ?? null;
        const incomingSessionId = startMsg.syncSessionId ?? null;
        if (
          incomingSessionId !== null &&
          this.completedSyncSessions.has(incomingSessionId)
        ) {
          this.setState("error", "Replayed sync session");
          this.resetBuffer();
          return;
        }
        const duplicateActiveBatch =
          this.expectedChunks > 0 &&
          (incomingBatchId !== null || incomingSessionId !== null) &&
          this.expectedBatchId === incomingBatchId &&
          this.expectedSyncSessionId === incomingSessionId &&
          this.expectedBatchIndex === (startMsg.batchIndex ?? null);
        if (duplicateActiveBatch) {
          this.setState("error", "Duplicate sync batch start");
          return;
        }
        if (this.disconnectTimer) {
          clearTimeout(this.disconnectTimer);
          this.disconnectTimer = null;
        }
        // A fresh sync_start supersedes an interrupted transfer. Reset the
        // previous buffer before rejecting the new start; otherwise a dropped
        // final chunk leaves expectedChunks > 0 forever and every later sync
        // is rejected until the page reloads. The sender can retry the new
        // transfer after observing the error state.
        if (this.expectedChunks > 0) {
          if (this.processingIncoming) {
            // Do not reset fields while processReceivedData is awaiting
            // checksum/HMAC/IndexedDB work; it owns this transfer's state.
            // The sender can retry once that operation has finished.
            this.setState(
              "error",
              "Sync already being processed — retry after completion",
            );
            return;
          }
          this.setState(
            "error",
            "Previous sync interrupted — replacing it with a clean retry",
          );
          this.resetPaginationSession();
          this.resetBuffer();
        }
        const isPaginated = startMsg.batchId !== undefined;
        if (isPaginated) {
          const batchIndex = startMsg.batchIndex!;
          const sessionId = startMsg.syncSessionId!;
          if (!this.paginatedSessionActive) {
            if (batchIndex !== 0) {
              this.setState("error", "Paginated sync must start at batch zero");
              this.resetPaginationSession();
              this.resetBuffer();
              return;
            }
            this.paginatedSessionActive = true;
            this.paginatedSessionId = sessionId;
            this.nextExpectedBatchIndex = 0;
          }
          if (sessionId !== this.paginatedSessionId || batchIndex !== this.nextExpectedBatchIndex) {
            this.setState("error", "Out-of-order or duplicate sync batch");
            this.resetPaginationSession();
            this.resetBuffer();
            return;
          }
          this.expectedBatchIndex = batchIndex;
        } else if (this.paginatedSessionActive) {
          this.setState("error", "Unpaginated batch interrupted paginated sync");
          this.resetPaginationSession();
          this.resetBuffer();
          return;
        }
        const total = startMsg.totalChunks;
        this.expectedChunks = total;
        this.expectedChecksum = startMsg.checksum ?? "";
        this.expectedSyncAuth = startMsg.auth ?? null;
        this.expectedPayloadHmac = startMsg.hmac ?? null;
        this.receivedPayloadBytes = 0;
        this.expectedBatchId = startMsg.batchId ?? null;
        this.expectedSyncSessionId = startMsg.syncSessionId ?? null;
        this.expectedHasMore = startMsg.hasMore === true;
        this.incomingBuffer = new Array(total);
        this.armIncomingTransferTimeout();
      } else if (typedMsg.type === "sync_chunk") {
        if (this.processingIncoming) {
          // The current transfer owns its snapshot until checksum, HMAC and
          // IndexedDB work finish. Ignore late/replayed chunks rather than
          // mutating state that processReceivedData already captured.
          logger.warn("[WebRTCSync] Ignored chunk while payload was processing");
          return;
        }
        const chunkMsg = msg as SyncChunkMessage;
        const idx = chunkMsg.index;
        const isStringChunk = typeof chunkMsg.data === "string";
        const dataLen = isStringChunk ? chunkMsg.data.length : 0;
        const previousChunk = this.incomingBuffer[idx];
        const nextPayloadBytes = this.receivedPayloadBytes + dataLen;
        if (
          !Number.isInteger(idx) ||
          idx < 0 ||
          idx >= this.expectedChunks ||
          !Array.isArray(this.incomingBuffer) ||
          !isStringChunk ||
          dataLen > MAX_CHUNK_SIZE ||
          nextPayloadBytes > MAX_TOTAL_PAYLOAD
        ) {
          this.setState("error", "Invalid chunk index or size");
          this.resetBuffer();
          return;
        }
        if (previousChunk !== undefined) {
          if (previousChunk === chunkMsg.data) {return;}
          this.setState("error", "Conflicting duplicate sync chunk");
          this.resetBuffer();
          return;
        }
        this.incomingBuffer[idx] = chunkMsg.data;
        this.receivedPayloadBytes = nextPayloadBytes;
        this.armIncomingTransferTimeout();

        const receivedChunks = this.incomingBuffer.filter(
          (c) => c !== undefined,
        ).length;
        if (receivedChunks === this.expectedChunks) {
          await this.processReceivedData();
        }
      }
    }
  }

  private clearIncomingTransferTimeout(): void {
    if (this.incomingTransferTimer) {
      clearTimeout(this.incomingTransferTimer);
      this.incomingTransferTimer = null;
    }
  }

  private armIncomingTransferTimeout(): void {
    this.clearIncomingTransferTimeout();
    this.incomingTransferTimer = setTimeout(() => {
      this.incomingTransferTimer = null;
      if (this.processingIncoming || this.expectedChunks === 0) return;
      this.setState("error", "Incoming sync transfer timed out");
      this.resetPaginationSession();
      this.resetBuffer();
    }, SYNC_TRANSFER_TIMEOUT_MS);
  }

  private resetBuffer(): void {
    this.clearIncomingTransferTimeout();
    this.incomingBuffer = [];
    this.expectedChunks = 0;
    this.expectedChecksum = "";
    this.expectedSyncAuth = null;
    this.expectedPayloadHmac = null;
    this.receivedPayloadBytes = 0;
    this.expectedBatchId = null;
    this.expectedBatchIndex = null;
    this.expectedSyncSessionId = null;
    this.expectedHasMore = false;
  }

  private resetPaginationSession(): void {
    this.nextExpectedBatchIndex = 0;
    this.paginatedSessionActive = false;
    this.paginatedSessionId = null;
  }

  private negotiateCapabilities(): Promise<boolean> {
    // Capability is scoped to the current data-channel session. Never carry
    // an earlier peer's answer into a new negotiation.
    this.supportsPaginatedSync = false;
    this.capabilitiesNegotiated = false;
    const existingWaiter = this.capabilityWaiter;
    if (existingWaiter) {
      return new Promise((resolve) => {
        this.capabilityWaiter = {
          resolve: (supported) => {
            existingWaiter.resolve(supported);
            resolve(supported);
          },
          timer: existingWaiter.timer,
        };
      });
    }
    return new Promise((resolve) => {
      // Arm the waiter synchronously so an acknowledgement arriving while the
      // (async) cursor read below is still pending cannot be dropped.
      const timer = setTimeout(() => {
        if (this.capabilityWaiter?.timer === timer) {
          this.capabilityWaiter = null;
          this.capabilitiesNegotiated = true;
          resolve(false);
        }
      }, SYNC_CAPABILITY_TIMEOUT_MS);
      this.capabilityWaiter = { resolve, timer };
      void (async () => {
        let advertised: string | null = null;
        try {
          advertised = await this.getAdvertisedCursor();
        } catch {
          // Unreadable cursor falls back to a full snapshot (null).
        }
        try {
          this.sendOrThrow(
            JSON.stringify({
              type: "sync_capabilities",
              paginated: true,
              lastSyncAt: advertised,
            }),
          );
        } catch {
          // Send failure: the session is broken either way. Resolve (never
          // reject) so a failure after the timeout already settled the
          // promise cannot surface as an unhandled rejection; the subsequent
          // send in startSync fails identically and reports the error state.
          clearTimeout(timer);
          if (this.capabilityWaiter?.timer === timer) {
            this.capabilityWaiter = null;
            this.capabilitiesNegotiated = true;
          }
          resolve(false);
        }
      })();
    });
  }

  /** Read the durable incremental-sync cursor once per session. The peer uses
   * it to resume its transfer from the last `updatedAt` we acknowledged,
   * instead of re-sending its full vault. */
  private async getAdvertisedCursor(): Promise<string | null> {
    if (this.advertisedCursor !== undefined) {return this.advertisedCursor;}
    this.advertisedCursor = await this.readAdvertisedCursor();
    return this.advertisedCursor;
  }

  private async readAdvertisedCursor(): Promise<string | null> {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(SYNC_CURSOR_STORAGE_KEY);
    } catch {
      return null;
    }
    if (!stored || stored.length > MAX_SYNC_CURSOR_LENGTH) {return null;}
    // Fresh/recreated vault guard: a stored cursor only means "the peer has
    // sent me everything >= this" if this device still holds that data. After
    // a vault reset the local store is empty but the cursor survives, and the
    // peer would otherwise send only deltas — silently leaving the restored
    // device with a partial vault. Treat an empty local store as a first
    // pairing so the peer resends its full snapshot.
    try {
      const db = await initDB();
      const [docCount, bookmarkCount] = await Promise.all([
        db.documents.count().exec(),
        db.bookmarks.count().exec(),
      ]);
      if (docCount === 0 && bookmarkCount === 0) {return null;}
    } catch {
      // Best effort: if the DB is unavailable we cannot prove emptiness, so
      // keep the stored cursor (a full resend is safe but wasteful; a stale
      // cursor is only dangerous when the store is provably empty).
    }
    return stored;
  }

  /** Advance the durable cursor after a fully-applied inbound session. The
   * advance is clamped to this device's own clock: a peer whose clock runs
   * ahead would otherwise push our cursor past timestamps our own clock can
   * still produce, silently starving our own future outbound sends. The clamp
   * only ever causes idempotent re-sends, never a missed document. */
  private persistSyncCursor(maxReceivedUpdatedAt: string): void {
    const now = new Date().toISOString();
    const cursor = maxReceivedUpdatedAt <= now ? maxReceivedUpdatedAt : now;
    try {
      localStorage.setItem(SYNC_CURSOR_STORAGE_KEY, cursor);
    } catch {
      // Non-fatal: a failed persistence only means the next pairing resends
      // the full snapshot instead of a delta.
    }
  }

  private waitForBatchAck(batchId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingBatchAcks.delete(batchId);
        reject(new Error("Timed out waiting for WebRTC sync batch acknowledgement"));
      }, SYNC_ACK_TIMEOUT_MS);
      this.pendingBatchAcks.set(batchId, { resolve, reject, timer });
    });
  }

  private clearPendingBatchAcks(): void {
    for (const [batchId, pending] of this.pendingBatchAcks) {
      clearTimeout(pending.timer);
      pending.reject(new Error("WebRTC sync stopped"));
      this.pendingBatchAcks.delete(batchId);
    }

  }

  private async processReceivedData() {
    if (this.processingIncoming) {return;}
    this.processingIncoming = true;
    this.clearIncomingTransferTimeout();
    if (this.onProgress) {this.onProgress(80);}
    // Snapshot all transfer fields before the first await. Incoming events
    // are independent async callbacks, so mutable buffer fields must not be
    // read after another event has started a reset or retry.
    const receivedBuffer = this.incomingBuffer.slice();
    const expectedChecksum = this.expectedChecksum;
    const expectedSyncAuth = this.expectedSyncAuth;
    const expectedPayloadHmac = this.expectedPayloadHmac;
    const expectedBatchId = this.expectedBatchId;
      const expectedBatchIndex = this.expectedBatchIndex;

    const expectedSyncSessionId = this.expectedSyncSessionId;
    const expectedHasMore = this.expectedHasMore;
    try {
      const fullStr = receivedBuffer.join("");

      // Verify payload integrity via SHA-256 checksum
      if (expectedChecksum) {
        const actualChecksum = await sha256(fullStr);
        if (!constantTimeStringEqual(actualChecksum, expectedChecksum)) {
          throw new Error("Checksum mismatch");
        }
      }

      // Verify authenticity via HMAC. A peer that received the ephemeral
      // sync-auth key over the DTLS channel can authenticate; an external
      // attacker injecting into the room cannot forge the HMAC.
      // HMAC is mandatory for any real sync payload: if a checksum was
      // provided but the HMAC fields are absent, treat it as tampering
      // (a manipulated sync_start could otherwise skip authentication and
      // rely only on the weaker checksum).
      if ((expectedSyncAuth === null) !== (expectedPayloadHmac === null)) {
        throw new Error("Incomplete payload HMAC metadata");
      }
      if (expectedSyncAuth !== null && expectedPayloadHmac !== null) {
        const actualHmac = await hmacSha256(expectedSyncAuth, fullStr);
        if (!constantTimeStringEqual(actualHmac, expectedPayloadHmac)) {
          throw new Error("Payload HMAC authentication failed");
        }
      } else if (expectedChecksum) {
        // Legacy peers may provide integrity-only checksums. Keep this path
        // for backward compatibility; authenticated batches are still
        // required to provide both HMAC fields by sync_start validation.
      }

      const data = JSON.parse(fullStr) as {
        type?: unknown;
        documents?: unknown;
        bookmarks?: unknown;
      };
      if (
        typeof data !== "object" ||
        data === null ||
        data.type !== "sync_data" ||
        !Array.isArray(data.documents) ||
        !Array.isArray(data.bookmarks)
      ) {
        throw new Error("Invalid sync payload shape");
      }
      const maxDocs = expectedBatchId !== null
        ? SYNC_BATCH_SIZE
        : MAX_SYNC_DOCS_PER_BATCH;
      if (
        data.documents.length > maxDocs ||
        data.bookmarks.length > maxDocs
      ) {
        throw new Error(`Sync batch exceeds ${maxDocs} documents per collection`);
      }

      const db = await initDB();

      // SECURITY (F13): validate shape and bounded field types before upsert
      // to prevent DB poisoning from a compromised/authenticated peer. The
      // Legacy payloads retain their historical permissive shape only when
      // they omit authentication metadata. Current authenticated batches use
      // collection-specific required fields before any RxDB write.
      // A checksum proves the payload was not altered in transit, while HMAC
      // additionally authenticates the sender. Both current and checksum-only
      // legacy payloads must still satisfy the collection schema; authentication
      // must never be used as the validation gate.
      const strictSync = expectedChecksum.length > 0;
      const BATCH_SIZE = 50;
      const validateBatch = (docs: unknown[], label: "doc" | "bookmark"): Record<string, unknown>[] => {
        const valid = docs.filter((doc) =>
          isValidSyncDoc(doc, label === "doc" ? "documents" : "bookmarks", strictSync),
        );
        if (valid.length !== docs.length) {
          const rejected = docs.length - valid.length;
          logger.warn(`Sync rejected ${rejected} invalid ${label} doc(s)`);
          throw new Error(`Sync payload contains ${rejected} invalid ${label} doc(s)`);
        }
        return valid;
      };
      const upsertBatch = async (
        collection: {
          findOne: (id: string) => {
            exec: () => Promise<{ get: (field: string) => unknown } | null>;
          };
          upsert: (doc: Record<string, unknown>) => Promise<unknown>;
        },
        valid: Record<string, unknown>[],
        label: "doc" | "bookmark",
      ): Promise<void> => {
        for (let i = 0; i < valid.length; i += BATCH_SIZE) {
          const batch = valid.slice(i, i + BATCH_SIZE);
          try {
            await Promise.all(
              batch.map(async (doc) => {
                // Deterministic LWW is updatedAt -> _rev -> id. A stale peer
                // snapshot must never regress a newer local edit, and a local
                // delete is protected the same way: an incoming tombstone only
                // applies when the remote version is genuinely newer. The
                // schema requires updatedAt, so a missing value only occurs on
                // legacy non-strict payloads and falls through to the later
                // revision/id comparison.
                // Known limitation (documented, accepted): LWW only protects
                // docs that still EXIST locally. If GarbageCollectionService
                // hard-purged the local tombstone (>30 days of retention) and
                // a peer that was offline since before the deletion re-pairs,
                // its stale live copy re-inserts here — there is no local
                // record left to compare against. A tombstone ledger (or
                // syncing the purge) would close it; the 30-day window +
                // manual QR pairing makes it a deliberate tradeoff.
                const local = await collection
                  .findOne(String(doc.id))
                  .exec();
                if (local) {
                  if (local.get("isPrivate") === true) {
                    // A remote peer must never overwrite a local-only record,
                    // including with a newer tombstone or a same-id live copy.
                    return;
                  }
                  const localState: Record<string, unknown> = {
                    id: local.get("id") ?? doc.id,
                    _rev: local.get("_rev"),
                    updatedAt: local.get("updatedAt"),
                  };
                  if (typeof (local as { toJSON?: unknown }).toJSON === "function") {
                    Object.assign(
                      localState,
                      (local as unknown as { toJSON: () => Record<string, unknown> }).toJSON(),
                    );
                  }
                  // Deterministic LWW: equal timestamps do not depend on peer
                  // arrival order. This mirrors the database conflict handler's
                  // updatedAt -> _rev -> id contract.
                  if (compareSyncVersions(doc, localState) <= 0) {
                    return;
                  }
                }
                await collection.upsert(doc);
              }),
            );
          } catch (error) {
            logger.error(`Sync upsert failed (${label})`, { error });
            throw new Error(`Sync failed to persist ${label} batch`);
          }
        }
      };

      // Validate both collections before writing either one. This prevents a
      // malformed bookmark from leaving a partially applied document batch.
      const validDocuments = validateBatch(data.documents, "doc");
      const validBookmarks = validateBatch(data.bookmarks, "bookmark");
      await upsertBatch(
        db.documents as unknown as Parameters<typeof upsertBatch>[0],
        validDocuments,
        "doc",
      );

      await upsertBatch(
        db.bookmarks as unknown as Parameters<typeof upsertBatch>[0],
        validBookmarks,
        "bookmark",
      );

      // Incremental-sync cursor: the highest updatedAt the peer actually sent
      // (validated docs, whether applied or LWW-skipped — a skipped stale doc
      // still means the peer no longer needs to resend it because we hold a
      // newer version). Persisted only when the whole session applied cleanly
      // (final batch), so a failed transfer resends everything next time.
      let maxReceivedUpdatedAt = "";
      for (const docs of [validDocuments, validBookmarks]) {
        for (const doc of docs) {
          const updatedAt = doc.updatedAt;
          if (
            typeof updatedAt === "string" &&
            updatedAt.length > 0 &&
            updatedAt > maxReceivedUpdatedAt
          ) {
            maxReceivedUpdatedAt = updatedAt;
          }
        }
      }

      if (expectedHasMore) {
        this.nextExpectedBatchIndex = (expectedBatchIndex ?? 0) + 1;
        this.paginatedSessionActive = true;
        this.paginatedSessionId = expectedSyncSessionId;
      } else {
        if (expectedSyncSessionId) {
          this.completedSyncSessions.add(expectedSyncSessionId);
          while (this.completedSyncSessions.size > MAX_COMPLETED_SYNC_SESSIONS) {
            const oldest = this.completedSyncSessions.values().next().value;
            if (typeof oldest === "string") {
              this.completedSyncSessions.delete(oldest);
            } else {
              break;
            }
          }
        }
        this.resetPaginationSession();
      }
      this.resetBuffer();
      if (expectedHasMore) {
        // Do not declare completion or disconnect between pages. The sender
        // is blocked until this acknowledgement, preventing the next batch
        // from overwriting the receiver while IndexedDB is still writing.
        this.sendOrThrow(
          JSON.stringify({ type: "sync_ack", batchId: expectedBatchId }),
        );
        this.setState("syncing");
        return;
      }
      if (this.onProgress) {this.onProgress(100);}
      if (maxReceivedUpdatedAt) {
        this.persistSyncCursor(maxReceivedUpdatedAt);
      }
      this.setState("completed");

      // The 2s disconnect grace must not fire while we are still sending our
      // own payload: closing the channel mid-send would truncate the outbound
      // transfer and leave the peer with a partial vault. When our outbound
      // sync is still in flight the helper defers the disconnect to
      // startSync's finally, which schedules it as soon as the send finishes.
      this.maybeScheduleDisconnectAfterSync();
    } catch (error: unknown) {
      if (this.disconnectTimer) {
        clearTimeout(this.disconnectTimer);
        this.disconnectTimer = null;
      }
      this.resetBuffer();
      this.setState(
        "error",
        "Failed to process received data: " +
          (error instanceof Error ? error.message : String(error)),
      );
    } finally {
      this.processingIncoming = false;
    }
  }

  /**
   * Schedule the post-completion disconnect unless one is already pending or
   * our own outbound transfer is still in flight. When the outbound sync is
   * active, startSync's finally calls this again once the send completes, so
   * the channel is only torn down after both directions have finished.
   */
  private maybeScheduleDisconnectAfterSync(): void {
    if (this.currentState !== "completed") {return;}
    if (this.outboundSyncActive) {return;}
    if (this.disconnectTimer) {return;}
    this.disconnectTimer = setTimeout(() => {
      this.disconnect();
    }, 2000);
  }

  public disconnect() {
    if (this.hostFallbackTimer) {
      clearTimeout(this.hostFallbackTimer);
      this.hostFallbackTimer = null;
    }
    if (this.clientFallbackTimer) {
      clearTimeout(this.clientFallbackTimer);
      this.clientFallbackTimer = null;
    }
    if (this.disconnectTimer) {
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
    }
    this.outboundSyncActive = false;
    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
    this.clearPendingBatchAcks();
    this.resetPaginationSession();
    this.supportsPaginatedSync = false;
    this.capabilitiesNegotiated = false;
    this.peerLastSyncAt = null;
    this.advertisedCursor = undefined;
    if (this.capabilityWaiter) {
      clearTimeout(this.capabilityWaiter.timer);
      this.capabilityWaiter.resolve(false);
      this.capabilityWaiter = null;
    }
    this.setState("disconnected");
    this.resetBuffer();
  }
}

export const webRTCSyncService = new WebRTCSyncService();


