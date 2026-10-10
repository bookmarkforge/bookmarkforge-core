import {
  checkNetworkRequest,
  firewalledWebSocket,
} from "../../utils/networkFirewall";
import { logger } from "../../utils/logger";

/**
 * SECURITY (audit #2): enforce secure WebSocket transport. Remote signaling
 * servers MUST use wss:// — plain ws:// is only tolerated for loopback/local
 * development hosts. Defense-in-depth: the network firewall already gates
 * origins, but this rejects plaintext ws:// even if the URL entered the
 * code through another path or the firewall were bypassed.
 * @returns the (validated) URL unchanged, or throws a descriptive error.
 */
function assertSecureWsUrl(raw: string, context: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`[SyncService] Invalid ${context} URL: "${raw}"`);
  }
  if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
    throw new Error(
      `[SyncService] ${context} must use ws:// or wss:// (received "${parsed.protocol}//")`,
    );
  }
  const host = parsed.hostname;
  const isLocal =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "[::1]" ||
    host.endsWith(".local") ||
    host.endsWith(".localhost");
  if (parsed.protocol === "ws:" && !isLocal) {
    throw new Error(
      `[SyncService] ${context} must use wss:// (secure) for remote host "${host}"`,
    );
  }
  return raw;
}
// ─── Signal HMAC signing (ENFORCE_SIGNAL_HMAC on the self-hosted server) ──
//
// Server enforces HMAC auth on every `signal` payload. WebSocket.send is
// sync while crypto.subtle.sign is async, so sends flow through a serial
// promise chain that signs each signal before the native send — preserving
// SDP handshake order. The signed JSON must be byte-identical to what the
// server re-derives: JSON.stringify({ type: "signal", senderPeerId,
// receiverPeerId, data }) with `String(receiverPeerId ?? "")` and
// `data ?? null` normalization. Public signaling servers ignore the field.

const TEXT_ENCODER = new TextEncoder();

function isBoundedSignalFrame(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_SIGNAL_FRAME_CHARS &&
    TEXT_ENCODER.encode(value).byteLength <= MAX_SIGNAL_FRAME_BYTES
  );
}

/**
 * Bounded wait for the signaling server's `init` frame. If the server accepts
 * the socket but never sends `init` (and never errors/closes), queued `signal`
 * frames are released to the raw native send after this timeout instead of
 * accumulating in the serial chain indefinitely (audit: sync client).
 * Exported for the unit tests.
 */
/** Options for {@link createSignalingSocketFactory}. */
interface SignalingSocketFactoryOptions {
  /** WebSocket constructor to instantiate. Injectable for tests. */
  webSocketImpl?: typeof WebSocket;
  /**
   * The self-hosted signaling server this deployment configured
   * (`VITE_P2P_SIGNALING_URL`). The room secret is sent only to this origin;
   * `null`/absent means public-relay mode and no secret is sent at all.
   */
  selfHostedSignalingUrl?: string | null;
}

export const SIGNAL_INIT_TIMEOUT_MS = 10_000;
/** Maximum number of signal frames retained while waiting for server init. */
export const SIGNAL_QUEUE_LIMIT = 64;
const MAX_SIGNAL_FRAME_CHARS = 256 * 1024;
const MAX_SIGNAL_FRAME_BYTES = 256 * 1024;
const MAX_SIGNAL_ROOM_ID_LENGTH = 64;
const MAX_SIGNAL_SECRET_LENGTH = 128;
const MAX_SIGNAL_PEER_ID_LENGTH = 128;
const SIGNAL_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;
/** WebSocket schemes accepted for the "is this the configured server?" match. */
const WS_PROTOCOLS = new Set(["ws:", "wss:"]);
function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

/**
 * Derive the per-room signal HMAC key exactly like the server:
 * HMAC-SHA256(key=roomSecret, data=`bookmarkforge-signal-auth:${roomId}`).
 * @internal exported for tests
 */
export async function deriveClientSignalKey(
  roomSecret: string,
  roomId: string,
): Promise<CryptoKey> {
  const secretKey = await crypto.subtle.importKey(
    "raw",
    TEXT_ENCODER.encode(roomSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const derived = await crypto.subtle.sign(
    "HMAC",
    secretKey,
    TEXT_ENCODER.encode(`bookmarkforge-signal-auth:${roomId}`),
  );
  return crypto.subtle.importKey(
    "raw",
    derived,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

/**
 * Domain separator for the room-name HMAC. Distinct from
 * `bookmarkforge-signal-auth:` so the same room secret can never produce the
 * same value for both purposes. The `v1` tag is a migration hook: a future
 * derivation change can ship a `v2` topic alongside `v1` instead of silently
 * splitting live rooms.
 */
export const SYNC_TOPIC_DOMAIN = "bookmarkforge-sync-topic:v1";

/**
 * SECURITY (A-2): derive the signaling room name (RxDB `topic`) as
 * HMAC-SHA256(roomSecret, `${SYNC_TOPIC_DOMAIN}:${roomId}:${collectionName}`)
 * hex-encoded, instead of the readable `${roomId}-${collectionName}`.
 *
 * Why the topic must not be derivable from the room ID alone: the topic IS the
 * room name handed to the signaling server, and the public RxDB/PubNub relays
 * treat the room name as the whole capability — any peer that learns it can
 * join the mesh and receive replicated documents. Sending the raw room ID
 * therefore published the capability to a third party (and let anyone who saw
 * it correlate, or join, the session). Keyed with the shared 256-bit room
 * secret, the topic is indistinguishable from random to the relay, to passive
 * observers, and to peers that know only the room ID.
 *
 * The collection name stays inside the HMAC input (never in the clear) so each
 * collection still replicates in its own room and peers never exchange
 * documents from different schemas.
 *
 * The output is exactly 64 lowercase hex characters, which satisfies both the
 * client credential guard (`MAX_SIGNAL_ROOM_ID_LENGTH`) and the server's
 * `ROOM_ID_PATTERN`.
 */
export async function deriveSyncTopic(
  roomSecret: string,
  roomId: string,
  collectionName: string,
): Promise<string> {
  const secretKey = await crypto.subtle.importKey(
    "raw",
    TEXT_ENCODER.encode(roomSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    secretKey,
    TEXT_ENCODER.encode(`${SYNC_TOPIC_DOMAIN}:${roomId}:${collectionName}`),
  );
  return toHex(signature);
}

/**
 * Canonical payload the server re-derives for verification (signal branch in
 * server/src/index.ts). Key order and `?? ""` / `?? null` normalization MUST
 * match the server exactly or the HMAC never verifies.
 * @internal exported for tests
 */
export function canonicalSignalPayload(
  peerId: string,
  msg: Record<string, unknown>,
): string {
  return JSON.stringify({
    type: "signal",
    senderPeerId: peerId,
    receiverPeerId: String(msg.receiverPeerId ?? ""),
    data: msg.data ?? null,
  });
}

/**
 * True when `socketUrl` targets EXACTLY the self-hosted signaling server this
 * deployment configured — the only origin allowed to receive the room secret.
 *
 * Compared by origin (scheme + host + port), never by string equality: the
 * room name normally travels in the path or query, so `wss://host` and
 * `wss://host/<topic>` are the same server. Any other origin — a different
 * host, a different port, a scheme change, the public rxdb.info/PubNub relays,
 * or an unparseable URL — is not that server and must not receive the secret.
 *
 * @internal exported for tests
 */
export function isSelfHostedSignalingUrl(
  socketUrl: string,
  configuredUrl: string | null | undefined,
): boolean {
  if (!configuredUrl) {return false;}
  let socket: URL;
  let configured: URL;
  try {
    socket = new URL(socketUrl);
    configured = new URL(configuredUrl);
  } catch {
    // A URL we cannot parse is never "the configured server".
    return false;
  }
  if (!WS_PROTOCOLS.has(socket.protocol)) {return false;}
  if (!WS_PROTOCOLS.has(configured.protocol)) {return false;}
  return (
    socket.protocol === configured.protocol &&
    socket.hostname === configured.hostname &&
    socket.port === configured.port
  );
}

/**
 * SECURITY (audit #4): WebSocket constructor (callable with `new`, as RxDB's
 * simple-peer handler requires) that signs every outgoing `signal` with an
 * HMAC-SHA256 `signalAuth` derived from the per-session room secret,
 * preventing forged-SDP injection by peers that know the room ID. Sends flow
 * through a per-socket serial promise chain so async signing never reorders
 * the handshake; signals racing the server's `init` frame (which carries the
 * peerId the HMAC is bound to) are queued until it arrives; a closed socket
 * invalidates queued work instead of sending stale frames.
 *
 * SECURITY (A-3): the room secret is injected into the `join` frame ONLY when
 * the socket's origin is the configured self-hosted signaling server
 * (`options.selfHostedSignalingUrl`, see `isSelfHostedSignalingUrl`). The
 * secret is the room capability — it keys the derived room name (A-2) and every
 * `signalAuth` — so a third-party relay that receives it would hold the room.
 * Public relays never get it; the derived room name alone keeps them working.
 *
 * @param options.webSocketImpl Injectable for tests (default: global WebSocket).
 * @param options.selfHostedSignalingUrl The deployment's self-hosted signaling
 *   server, or null/undefined for public-relay mode — in which case no secret
 *   is ever sent (fail closed).
 */
export function createSignalingSocketFactory(
  roomSecret: string,
  roomId: string,
  options: SignalingSocketFactoryOptions = {},
): (url: string) => WebSocket {
  const webSocketImpl = options.webSocketImpl ?? globalThis.WebSocket;
  const selfHostedSignalingUrl = options.selfHostedSignalingUrl ?? null;
  return function makeSignalingSocket(url: string): WebSocket {
    if (
      roomId.length === 0 ||
      roomId.length > MAX_SIGNAL_ROOM_ID_LENGTH ||
      SIGNAL_CONTROL_CHARACTERS.test(roomId) ||
      roomSecret.length === 0 ||
      roomSecret.length > MAX_SIGNAL_SECRET_LENGTH ||
      SIGNAL_CONTROL_CHARACTERS.test(roomSecret)
    ) {
      throw new Error("[SyncService] Invalid signaling room credentials");
    }
    // SECURITY (audit #2): defense-in-depth — never open a plaintext ws://
    // socket to a remote signaling host, regardless of how the URL reached
    // this constructor.
    assertSecureWsUrl(url, "signaling");
    // SECURITY (A-3): decided once per socket, from the URL the socket is
    // actually opened against — not from a flag the caller could get wrong. A
    // relay that is not the configured self-hosted server never sees the room
    // secret, even if a future caller hands this factory its URL by mistake.
    const shareRoomSecret = isSelfHostedSignalingUrl(
      url,
      selfHostedSignalingUrl,
    );
    const ws = new webSocketImpl(url);
    const nativeSend = ws.send.bind(ws);

    let serverPeerId: string | null = null;
    let released = false;
    let socketClosed = false;
    let signalKeyPromise: Promise<CryptoKey> | null = null;
    let queueTail: Promise<void> = Promise.resolve();
    let queuedSignalFrames = 0;
    let initResolve: () => void = () => {};
    let initWatchdog: ReturnType<typeof setTimeout> | null = null;
    const initReady = new Promise<void>((resolve) => {
      initResolve = resolve;
    });

    const handleMessage = (raw?: unknown): void => {
      if (!isBoundedSignalFrame(raw)) {
        logger.warn("[SyncService] Signaling frame from server exceeds the safe limit");
        markSocketClosed();
        try {
          ws.close();
        } catch {
          /* INTENTIONAL SILENCE: protocol-error close is best-effort. */
        }
        return;
      }
      try {
        const msg = JSON.parse(raw) as Record<string, unknown>;
        if (msg?.type === "init") {
          if (
            typeof msg.yourPeerId !== "string" ||
            msg.yourPeerId.length === 0 ||
            msg.yourPeerId.length > MAX_SIGNAL_PEER_ID_LENGTH ||
            SIGNAL_CONTROL_CHARACTERS.test(msg.yourPeerId)
          ) {
            logger.warn("[SyncService] Signaling server sent an invalid peer id");
            markSocketClosed();
            try {
              ws.close();
            } catch {
              /* INTENTIONAL SILENCE: protocol-error close is best-effort. */
            }
            return;
          }
          if (serverPeerId === null) {
            serverPeerId = msg.yourPeerId;
            if (initWatchdog) {
              clearTimeout(initWatchdog);
              initWatchdog = null;
            }
            initResolve();
          }
        }
      } catch (error) {
        logger.warn("[SyncService] Signaling server sent invalid JSON", { error });
        markSocketClosed();
        try {
          ws.close();
        } catch {
          /* INTENTIONAL SILENCE: protocol-error close is best-effort. */
        }
      }
    };

    // Release queued signals on the bounded watchdog, but distinguish that
    // path from a real socket close. A closed socket must never receive work
    // that was still waiting in the async signing chain.
    const release = () => {
      if (serverPeerId === null && !released) {
        released = true;
        if (initWatchdog) {
          clearTimeout(initWatchdog);
          initWatchdog = null;
        }
        initResolve();
      }
    };
    const markSocketClosed = () => {
      socketClosed = true;
      release();
    };

    // Attach listeners defensively: the real WebSocket supports
    // addEventListener; minimal sockets (unit-test mocks exposing only
    // send/close) fall back to the on* slots.
    const attach = (type: "message" | "error" | "close", fn: (e?: unknown) => void): void => {
      if (typeof ws.addEventListener === "function") {
        ws.addEventListener(type, fn as EventListener);
        return;
      }
      const prop = type === "message" ? "onmessage" : type === "error" ? "onerror" : "onclose";
      const anyWs = ws as unknown as Record<string, unknown>;
      if (typeof anyWs[prop] === "function") {
        const existing = anyWs[prop] as (e?: unknown) => void;
        anyWs[prop] = (e?: unknown) => {
          existing.call(ws, e);
          fn.call(ws, e);
        };
      } else if (anyWs[prop] === undefined || anyWs[prop] === null) {
        anyWs[prop] = fn;
      }
    };
    attach("message", (e) => handleMessage((e as { data?: unknown } | undefined)?.data));
    attach("error", markSocketClosed);
    attach("close", markSocketClosed);

    // Watchdog (audit: sync client): if the server accepts the socket but
    // never sends `init` (and never errors/closes), release the queued
    // signals after a bounded wait so the serial chain can never accumulate
    // indefinitely. Only this legacy no-init path may use the raw native send;
    // actual close/error events discard queued work.
    initWatchdog = setTimeout(() => release(), SIGNAL_INIT_TIMEOUT_MS);

    async function signSignal(msg: Record<string, unknown>): Promise<string> {
      signalKeyPromise ??= deriveClientSignalKey(roomSecret, roomId);
      const key = await signalKeyPromise;
      const payload = canonicalSignalPayload(serverPeerId!, msg);
      const signature = await crypto.subtle.sign(
        "HMAC",
        key,
        TEXT_ENCODER.encode(payload),
      );
      return JSON.stringify({ ...msg, signalAuth: toHex(signature) });
    }

    ws.send = ((data: string) => {
      if (typeof data === "string" && !isBoundedSignalFrame(data)) {
        logger.warn("[SyncService] Signaling frame exceeds the safe limit");
        return;
      }
      let msg: Record<string, unknown> | null = null;
      try {
        msg = JSON.parse(data) as Record<string, unknown>;
      } catch {
        /* INTENTIONAL SILENCE: non-JSON frames pass through raw. */
      }

      if (msg && typeof msg === "object") {
        if (msg.type === "join" && typeof msg.room === "string") {
          if (!shareRoomSecret) {
            // SECURITY (A-3): public relay (or any origin that is not the
            // configured self-hosted signaling server). Forward the join
            // UNCHANGED — re-serializing it without the secret would be equal
            // today but would start leaking the moment a field is added. The
            // relay only gets the opaque derived room name; the room stays
            // unopened to it because it holds no secret to key anything with.
            try {
              nativeSend(data);
            } catch (sendError) {
              logger.warn("[SyncService] Signaling send failed", {
                error: sendError,
              });
            }
            return;
          }
          // Synchronous fast path: inject roomSecret and forward
          // immediately (the contract RxDB's simple-peer handler and the
          // signaling server rely on).
          try {
            const joined = JSON.stringify({ ...msg, roomSecret });
            if (!isBoundedSignalFrame(joined)) {
              logger.warn("[SyncService] Signaling join exceeds the safe limit");
              return;
            }
            nativeSend(joined);
          } catch (sendError) {
            logger.warn("[SyncService] Signaling send failed", {
              error: sendError,
            });
          }
          return;
        }
        if (msg.type === "signal") {
          // Async path (HMAC signing is crypto.subtle): serialized per
          // socket so the handshake never reorders. Signals that race the
          // server's `init` frame wait for the peerId the HMAC is bound to;
          // if the socket fails first, queued work is discarded so it cannot
          // send stale frames or keep the chain alive indefinitely.
          if (queuedSignalFrames >= SIGNAL_QUEUE_LIMIT) {
            logger.warn("[SyncService] Signaling queue is full; dropping frame");
            return;
          }
          queuedSignalFrames += 1;
          queueTail = queueTail
            .catch(() => undefined)
            .then(async () => {
              try {
                if (socketClosed) {return;}
                let outgoing = data;
                try {
                  if (serverPeerId === null) {
                    await initReady;
                  }
                  if (socketClosed) {return;}
                  if (serverPeerId !== null) {
                    outgoing = await signSignal(msg as Record<string, unknown>);
                  }
                } catch (signError) {
                  // Once the server identity is known, an unsigned signal must
                  // never be sent as a fallback. The server's HMAC gate is a
                  // defense boundary, not a reason for the client to leak a
                  // malformed handshake. Raw fallback remains only for legacy
                  // peers that never sent `init` before the watchdog.
                  if (serverPeerId !== null) {
                    logger.warn("[SyncService] Signaling HMAC failed", {
                      error: signError,
                    });
                    return;
                  }
                }
                if (socketClosed) {return;}
                if (!isBoundedSignalFrame(outgoing)) {
                  logger.warn("[SyncService] Signed signaling frame exceeds the safe limit");
                  return;
                }
                try {
                  nativeSend(outgoing);
                } catch (sendError) {
                  logger.warn("[SyncService] Signaling send failed", {
                    error: sendError,
                  });
                }
              } finally {
                queuedSignalFrames -= 1;
              }
            });
          return;
        }
      }

      // Non-signal frames (pings, invalid JSON, …) pass through
      // synchronously, preserving the legacy send contract.
      try {
        nativeSend(data);
      } catch (sendError) {
        logger.warn("[SyncService] Signaling send failed", {
          error: sendError,
        });
      }
    }) as typeof ws.send;
    return ws;
  };
}
/**
 * S5/ADR-018: Pre-probe a signaling server to extract TURN credentials
 * from the init message. This avoids hardcoding TURN credentials in the
 * frontend and lets the signaling server distribute them dynamically.
 *
 * The probe opens a lightweight WebSocket, reads the first message (init),
 * and closes. Returns the ICE server array if present, or falls back to
 * the default STUN servers.
 */
const MAX_REMOTE_ICE_SERVERS = 16;
export const MAX_ICE_URL_LENGTH = 2_048;
export const MAX_ICE_CREDENTIAL_LENGTH = 1_024;
const ICE_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;

export function isSafeIceString(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    !ICE_CONTROL_CHARACTERS.test(value)
  );
}

function isBoundedIceServer(value: unknown): value is RTCIceServer {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const server = value as Record<string, unknown>;
  const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
  if (
    urls.length === 0 ||
    urls.length > 8 ||
    !urls.every(
      (candidate) =>
        isSafeIceString(candidate, MAX_ICE_URL_LENGTH) &&
        /^(stun|stuns|turn|turns):/i.test(candidate),
    )
  ) {
    return false;
  }
  return ["username", "credential"].every((key) => {
    const field = server[key];
    return field === undefined || isSafeIceString(field, MAX_ICE_CREDENTIAL_LENGTH);
  });
}

export async function fetchIceServersFromSignaling(
  url: string,
): Promise<RTCIceServer[]> {
  // SECURITY (audit #2): reject plaintext ws:// for remote hosts before
  // anything else, then validate against the firewall as usual.
  assertSecureWsUrl(url, "TURN probe");
  await checkNetworkRequest(url, "TURN_Probe");

  return new Promise((resolve) => {
    let settled = false;
    const finish = (servers: RTCIceServer[]) => {
      if (settled) return;
      settled = true;
      resolve(servers);
    };

    void firewalledWebSocket(url, undefined, "TURN_Probe")
      .then((ws) => {
        const timeout = setTimeout(() => {
          ws.close();
          finish([]);
        }, 3000);
        ws.onmessage = (event) => {
          clearTimeout(timeout);
          ws.close();
          try {
            const rawData =
              typeof event.data === "string" ? event.data : "";
            if (rawData.length > 64 * 1024) {
              finish([]);
              return;
            }
            const msg = JSON.parse(rawData) as Record<string, unknown>;
            const iceServers = msg.type === "init" && Array.isArray(msg.iceServers)
              ? msg.iceServers
              : [];
            if (iceServers.length > MAX_REMOTE_ICE_SERVERS) {
              finish([]);
              return;
            }
            finish(iceServers.filter(isBoundedIceServer));
          } catch (_err) {
            finish([]);
          }
        };
        ws.onerror = () => {
          clearTimeout(timeout);
          finish([]);
        };
      })
      .catch(() => finish([]));
  });
}
