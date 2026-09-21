/**
 * BookmarkForge — self-hosted P2P signaling server.
 *
 * Security model — Continuous P2P (online rooms):
 * every session generates a fresh 32-byte `roomSecret` client-side and
 * injects it into the `join` message. This server is the enforcement point
 * for that secret: once a room is created with a secret, any joiner that
 * does not present the matching secret is disconnected. Public signaling
 * servers (rxdb.info / PubNub) ignore the extra field, which is why the
 * self-hosted server is the only place the A2 guarantee actually holds.
 *
 * Protocol (matches src/tests/sync/signaling-server.test.ts NET-01..07):
 *   server → client: { type: "init", yourPeerId }
 *   client → server: { type: "join", room, roomSecret? }
 *   server → client: { type: "joined", otherPeerIds: [...] }
 *   client → server: { type: "signal", senderPeerId, room, receiverPeerId, data }
 *   server → client: { type: "signal", senderPeerId, receiverPeerId, data }
 *
 * DoS hardening (self-hosted = fully exposed to the internet):
 *   - maxPayload: cap frame size (ws default is 100 MiB — far too generous
 *     for ~KiB SDP/ICE payloads). Client sync chunks go over the WebRTC data
 *     channel, never through this server.
 *   - Connection / room / peers-per-room caps.
 *   - Per-IP join rate limit (token window) so one address cannot exhaust
 *     the room table.
 *   - One `join` per connection (prevents room-hopping that would leave
 *     stale peer entries behind).
 *   - Anti-spoofing: the server is authoritative about the sender. A client
 *     that claims a different `senderPeerId` is an impersonation attempt and
 *     is disconnected. All tunables are env-overridable (useful in tests).
 *
 * Run:
 *   npx tsx server/src/index.ts   # PORT (default 8787), HOST (default 0.0.0.0)
 */
import { WebSocketServer, type WebSocket } from "ws";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  randomUUID,
  createHmac,
  createHash,
  timingSafeEqual,
} from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { performance } from "node:perf_hooks";
import { createLicenseHandler } from "./license-server";
import { createEntitlementHandler } from "./entitlement-endpoint";
import { createGuardedDispatcher } from "./route-table";
import { createClientEventsHandler } from "./client-events";
import { createAnalyticsHandler } from "./business-analytics";
import { applySecurityHeaders, cspCorsHeaders } from "./middleware/security";
import { createEntitlementGuard } from "./entitlement-guard";
import { constantTimeUtf8Equal, readBoundedInteger } from "./proxy-utils";

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "0.0.0.0";

// Random server instance ID regenerated on every restart. Clients cache
// the last-seen instance ID and use a change to detect that the server
// restarted (rooms lost) so they can proactively rejoin.
const SERVER_INSTANCE_ID = randomUUID();
const SIGNALING_IP_HASH_SALT = process.env.SIGNALING_IP_HASH_SALT || SERVER_INSTANCE_ID;

function hashSignalingIp(ip: string): string {
  return createHash("sha256")
    .update(`${SIGNALING_IP_HASH_SALT}:${ip}`)
    .digest("hex")
    .slice(0, 24);
}

/** Monotonic milliseconds for all in-memory rate/replay windows. */
const monotonicNow = (): number => performance.now();

// Every integer override is fail-safe: malformed, fractional, negative, or
// unexpectedly huge values fall back to the documented default instead of
// reaching ws/Map allocation paths with an unsafe configuration.
const MAX_CONNECTIONS = readBoundedInteger(
  process.env.MAX_CONNECTIONS,
  512,
  1,
  10_000,
);
const MAX_ROOMS = readBoundedInteger(
  process.env.MAX_ROOMS,
  2_048,
  1,
  100_000,
);
const MAX_PEERS_PER_ROOM = Math.min(
  readBoundedInteger(
    process.env.MAX_PEERS_PER_ROOM,
    64,
    1,
    1_024,
  ),
  MAX_CONNECTIONS,
);
const MAX_PAYLOAD_BYTES = readBoundedInteger(
  process.env.MAX_PAYLOAD_BYTES,
  1024 * 1024,
  1_024,
  4 * 1024 * 1024,
);
const JOIN_LIMIT = readBoundedInteger(
  process.env.JOIN_LIMIT,
  120,
  1,
  10_000,
);
const MAX_ROOM_SECRET_LENGTH = 128;
const MAX_PEER_ID_LENGTH = 128;
const MAX_SIGNAL_AUTH_LENGTH = 64;
const MAX_SIGNAL_DATA_BYTES = 256 * 1024;
// Suppress exact duplicate relay frames during the short handshake window.
// This is a bounded duplicate guard, not a full replay authority: old or
// modified signals still require the peer/session protections described in the
// threat model.
const SIGNAL_REPLAY_WINDOW_MS = readBoundedInteger(
  process.env.SIGNAL_REPLAY_WINDOW_MS,
  30_000,
  1_000,
  300_000,
);
const MAX_RECENT_SIGNALS_PER_ROOM = readBoundedInteger(
  process.env.MAX_RECENT_SIGNALS_PER_ROOM,
  256,
  16,
  4_096,
);
const JOIN_WINDOW_MS = readBoundedInteger(
  process.env.JOIN_WINDOW_MS,
  60_000,
  1_000,
  86_400_000,
);
// Bound the cardinality of the per-IP window as well as each IP's count.
// With TRUST_PROXY enabled, an attacker can otherwise rotate spoofed/real
// addresses faster than the periodic expiry sweep and grow this Map without
// bound. A full map fails closed for new identities until an old window expires.
const MAX_JOIN_RATE_ENTRIES = readBoundedInteger(
  process.env.MAX_JOIN_RATE_ENTRIES,
  10_000,
  1,
  100_000,
);

// Optional admin diagnostic endpoint (disabled by default).
const SIGNALING_ADMIN_TOKEN = process.env.SIGNALING_ADMIN_TOKEN ?? "";

// Dead-socket reaping: connections that vanish without a FIN (laptop
// suspend, network drop, NAT timeout) would otherwise stay in the rooms
// maps forever — stale peer entries get re-broadcast in `otherPeerIds` and
// count against MAX_CONNECTIONS. A periodic ping/pong sweep terminates
// sockets that miss one round-trip. Env-tunable (HEARTBEAT_INTERVAL_MS).
const HEARTBEAT_INTERVAL_MS = (() => {
  const raw = Number(process.env.HEARTBEAT_INTERVAL_MS ?? 30_000);
  if (!Number.isFinite(raw)) return 30_000;
  return Math.min(Math.max(Math.round(raw), 1_000), 86_400_000);
})();

// Only trust `x-forwarded-for` when this server sits behind a reverse proxy
// that overwrites the header (nginx/caddy). With the default HOST=0.0.0.0
// direct exposure, trusting it would let a client rotate its per-IP identity
// and bypass the JOIN_LIMIT rate limit entirely.
const TRUST_PROXY = process.env.TRUST_PROXY === "1" || process.env.TRUST_PROXY === "true";

// When WS_ALLOWED_ORIGINS is set, the WebSocket server rejects upgrades from
// origins outside the list. Empty = no origin check (local dev). Comma-separated.
const WS_ALLOWED_ORIGINS = new Set(
  (process.env.WS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
);

// ── TURN REST relay (coturn `use-auth-secret` / Google TURN REST API) ────
// When TURN_RELAY_HOST + TURN_STATIC_AUTH_SECRET are configured, the server
// mints short-lived TURN credentials and ships them inside the `init`
// message. Clients (SyncService.fetchIceServersFromSignaling) read
// `init.iceServers` and never need static credentials embedded in their
// bundle — the static VITE_TURN_* fallback stays as a last resort for
// deployments that don't run this server with a TURN secret.
//
// Credential format (coturn REST): username = "<expiry-epoch>:turn",
// credential = base64(HMAC-SHA1(staticAuthSecret, username)). The TURN
// server validates them without any per-user state.
function sanitizeTurnHost(raw: string | undefined): string {
  const host = raw?.trim() ?? "";
  // The value is interpolated into ICE URLs. Reject whitespace, delimiters,
  // and control characters instead of allowing malformed config to produce
  // ambiguous relay targets or leak into protocol metadata.
  const isDnsOrIpv4 = /^[A-Za-z0-9.-]+$/.test(host);
  const isBracketedIpv6 = /^\[[0-9A-Fa-f:]+\]$/.test(host);
  if (
    host.length === 0 ||
    host.length > 253 ||
    (!isDnsOrIpv4 && !isBracketedIpv6)
  ) {
    return "";
  }
  return host;
}

const TURN_RELAY_HOST = sanitizeTurnHost(process.env.TURN_RELAY_HOST);
const TURN_STATIC_AUTH_SECRET = process.env.TURN_STATIC_AUTH_SECRET ?? "";
const TURN_PORT = readBoundedInteger(process.env.TURN_PORT, 3478, 1, 65_535);
const TURN_TLS_PORT = readBoundedInteger(
  process.env.TURN_TLS_PORT,
  5349,
  1,
  65_535,
);
// TTL clamp: 5 minutes .. 1 hour (default 15 minutes). Short-lived
// credentials limit relay abuse after a leaked client-side init frame.
const TURN_TTL_SECONDS = readBoundedInteger(
  process.env.TURN_TTL,
  15 * 60,
  5 * 60,
  60 * 60,
);

interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/** Build ephemeral TURN credentials; empty array when not configured. */
function buildTurnIceServers(): IceServer[] {
  if (
    !TURN_RELAY_HOST ||
    !TURN_STATIC_AUTH_SECRET ||
    TURN_STATIC_AUTH_SECRET.length > 4_096 ||
    /[\u0000-\u001f\u007f-\u009f]/.test(TURN_STATIC_AUTH_SECRET)
  ) {
    return [];
  }
  const expiry = Math.floor(Date.now() / 1000) + TURN_TTL_SECONDS;
  const username = `${expiry}:turn`;
  const credential = createHmac("sha1", TURN_STATIC_AUTH_SECRET)
    .update(username)
    .digest("base64");
  return [
    {
      urls: [
        `turn:${TURN_RELAY_HOST}:${TURN_PORT}?transport=udp`,
        `turn:${TURN_RELAY_HOST}:${TURN_PORT}?transport=tcp`,
        `turns:${TURN_RELAY_HOST}:${TURN_TLS_PORT}?transport=tcp`,
      ],
      username,
      credential,
    },
  ];
}

/** Room id rules: alphanumeric + . _ -, 1..64 chars, no path traversal. */
const ROOM_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * Derive a per-room HMAC key from the room secret so signal payloads can be
 * authenticated. Without this, any peer who knows the room ID (including a
 * MitM on an open network) can inject forged SDP offers.
 *
 * HKDF-SHA256(roomSecret, salt=roomId, info="bookmarkforge-signal-auth").
 * The derived key is 32 bytes (SHA-256 output).
 */
function deriveSignalKey(roomId: string, roomSecret: string): Buffer {
  return createHmac("sha256", roomSecret)
    .update(`bookmarkforge-signal-auth:${roomId}`)
    .digest();
}

/**
 * Constant-time HMAC verification of signal payloads.
 * `auth` is the hex-encoded HMAC-SHA256 sent by the client;
 * `payload` is the raw JSON string of the signal message.
 */
function verifySignalAuth(
  signalKey: Buffer,
  payload: string,
  auth: string,
): boolean {
  try {
    const expected = createHmac("sha256", signalKey).update(payload).digest();
    const received = Buffer.from(auth, "hex");
    if (expected.length !== received.length) return false;
    return timingSafeEqual(expected, received);
  } catch {
    return false;
  }
}

// HMAC signal authentication is ON by default (defense-in-depth): any room
// with a secret requires every signal payload to carry a valid `signalAuth`
// HMAC. Without it, a peer who knows the room ID (e.g. a MitM on an open
// network) could inject forged SDP offers. The legacy opt-out is accepted only
// in explicitly non-production environments for interoperability testing;
// production and an unset NODE_ENV fail closed and keep HMAC mandatory.
const signalHmacOptOutRequested =
  process.env.ENFORCE_SIGNAL_HMAC === "0" ||
  process.env.ENFORCE_SIGNAL_HMAC === "false";
const signalHmacRelaxationAllowed =
  process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";
if (signalHmacOptOutRequested && !signalHmacRelaxationAllowed) {
  console.error(
    JSON.stringify({
      event: "signaling_hmac_opt_out_rejected",
      reason: "HMAC opt-out is allowed only in development/test environments",
    }),
  );
}
const ENFORCE_SIGNAL_HMAC =
  !signalHmacOptOutRequested || !signalHmacRelaxationAllowed;
const CLOSE_POLICY = 1008;
const CLOSE_OVERLOAD = 1013;

interface RoomState {
  /** Secret set by the first joiner; null means an open (public) room. */
  secret: string | null;
  peers: Map<string, WebSocket>;
  /** Hashes of recently relayed normalized signal payloads. */
  recentSignals: Map<string, number>;
}

const rooms = new Map<string, RoomState>();

/** Per-IP join token window: ip → { count, windowStart }. */
const joinWindows = new Map<string, { count: number; windowStart: number }>();

function isValidRoomId(id: string): boolean {
  return ROOM_ID_PATTERN.test(id) && id !== "." && id !== "..";
}

// Cap the forwarded-IP length so an oversized X-Forwarded-For cannot grow
// the rate-window Map keys or the CSP ip-hash input beyond a bounded size.
// Node already caps total header size; keep all implementations consistent.
const MAX_FORWARDED_IP_LENGTH = 128;

function clientIp(req: IncomingMessage): string {
  if (TRUST_PROXY) {
    const fwd = req.headers["x-forwarded-for"];
    if (typeof fwd === "string" && fwd.length > 0) {
      const first = fwd.split(",")[0]?.trim();
      if (first && first.length <= MAX_FORWARDED_IP_LENGTH) return first;
    }
  }
  return req.socket.remoteAddress ?? "unknown";
}

function pruneJoinWindows(now = monotonicNow()): void {
  const cutoff = now - JOIN_WINDOW_MS;
  // Entries are inserted in monotonic first-seen order and existing entries
  // only increment their counters. Expired windows are therefore a FIFO prefix.
  while (joinWindows.size > 0) {
    const oldest = joinWindows.entries().next().value as
      | [string, { count: number; windowStart: number }]
      | undefined;
    if (!oldest || oldest[1].windowStart >= cutoff) break;
    joinWindows.delete(oldest[0]);
  }
}

function allowJoin(ip: string): boolean {
  const now = monotonicNow();
  const window = joinWindows.get(ip);
  if (!window || now - window.windowStart >= JOIN_WINDOW_MS) {
    if (!window) {
      pruneJoinWindows(now);
      if (joinWindows.size >= MAX_JOIN_RATE_ENTRIES) return false;
    }
    joinWindows.set(ip, { count: 1, windowStart: now });
    return true;
  }
  // Deterrent, not a hard per-IP cap: a single address can still hold up to
  // JOIN_LIMIT connections per window (each joins once); MAX_CONNECTIONS and
  // MAX_ROOMS bound the blast radius. Behind a proxy, set TRUST_PROXY=1 so
  // the real client IP is seen instead of the proxy's.
  if (window.count >= JOIN_LIMIT) {return false;}
  window.count += 1;
  return true;
}

// Keep the join-window map bounded: prune stale entries. unref() so this
// interval alone never keeps the process alive (tests kill it anyway).
const pruneTimer = setInterval(
  () => pruneJoinWindows(),
  Math.max(JOIN_WINDOW_MS, 60_000),
);
pruneTimer.unref();

// ── HTTP healthcheck endpoint ─────────────────────────────────────
// Nginx reverse-proxies GET /health to verify the signaling server is
// alive (not just the reverse proxy itself). The WebSocket upgrade
// path is handled by ws on the same HTTP server.
function healthHandler(_req: IncomingMessage, res: ServerResponse): void {
  // no-store: a proxy/CDN that caches the 200 would keep reporting "ok"
  // after the signaling server has died, masking the outage from the
  // healthcheck that nginx fronts with this endpoint.
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  // Keep the unauthenticated liveness probe deliberately minimal. Connection
  // counts, room cardinality and the restart identifier are reconnaissance
  // material; the identifier is already delivered to authenticated signaling
  // clients in the WebSocket init frame where it is operationally needed.
  res.end(JSON.stringify({ status: "ok" }));
}

// ── Admin diagnostics endpoint (disabled by default) ───────────
// Exposes operational metrics only when SIGNALING_ADMIN_TOKEN is set.
// Without it, requests fail closed with 503 so the endpoint is not
// accidentally left public in deployments that forget to configure it.
function signalingAdminHandler(req: IncomingMessage, res: ServerResponse): void {
  const adminToken = req.headers["x-signaling-admin-token"];
  const tokenMatches =
    typeof adminToken === "string" &&
    constantTimeUtf8Equal(SIGNALING_ADMIN_TOKEN, adminToken);
  if (!SIGNALING_ADMIN_TOKEN || !tokenMatches) {
    res.writeHead(SIGNALING_ADMIN_TOKEN ? 401 : 503, {
      "Content-Type": "text/plain",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(SIGNALING_ADMIN_TOKEN ? "Unauthorized" : "Admin diagnostics unavailable");
    return;
  }
  const roomMetrics = Array.from(rooms.entries()).map(([roomId, room]) => ({
    roomId,
    peers: room.peers.size,
    secretPresent: room.secret !== null,
  }));
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...cspCorsHeaders(req),
  });
  res.end(
    JSON.stringify({
      serverInstanceId: SERVER_INSTANCE_ID,
      connections: wss.clients.size,
      maxConnections: MAX_CONNECTIONS,
      rooms: roomMetrics.length,
      maxRooms: MAX_ROOMS,
      roomMetrics,
      trustProxy: TRUST_PROXY,
    }),
  );
}

// ── CSP report collector ──────────────────────────────────────────
// Browsers POST JSON violation reports to /csp-report when the
// Content-Security-Policy blocks a resource. This collector logs
// them and keeps a bounded in-memory ring of recent reports for
// diagnostics. Rate-limited per IP to prevent abuse.

const CSP_REPORT_MAX = readBoundedInteger(
  process.env.CSP_REPORT_MAX,
  200,
  1,
  10_000,
);
const CSP_REPORT_LIMIT = readBoundedInteger(
  process.env.CSP_REPORT_LIMIT,
  30,
  1,
  10_000,
); // per IP per window
const CSP_REPORT_WINDOW_MS = readBoundedInteger(
  process.env.CSP_REPORT_WINDOW_MS,
  60_000,
  1_000,
  86_400_000,
);
// Optional JSONL persistence. It is disabled by default so the companion
// server remains stateless; operators can set CSP_REPORT_FILE to retain a
// bounded report history across restarts.
const CSP_REPORT_FILE = process.env.CSP_REPORT_FILE ?? "";
// POST remains unauthenticated because browsers cannot attach an admin token
// to CSP violation reports. The diagnostics GET is fail-closed: without a
// configured token it is unavailable rather than publicly exposing report
// metadata.
const CSP_REPORT_ADMIN_TOKEN = process.env.CSP_REPORT_ADMIN_TOKEN ?? "";
const CSP_REPORT_IP_HASH_SALT =
  process.env.CSP_REPORT_IP_HASH_SALT || SERVER_INSTANCE_ID;
const CSP_REPORT_BODY_MAX_BYTES = readBoundedInteger(
  process.env.CSP_REPORT_BODY_MAX_BYTES,
  16_384,
  1_024,
  4 * 1024 * 1024,
);
const CSP_REPORT_RATE_MAX_ENTRIES = readBoundedInteger(
  process.env.CSP_REPORT_RATE_MAX_ENTRIES,
  10_000,
  100,
  100_000,
);
// Optional webhook alerting (audit plan 5.2.2): accepted violations are
// batched and POSTed to this URL at most once per interval, so a burst of
// reports collapses into one notification. The payload carries ONLY the
// redacted StoredCspReport fields — never the client IP, never raw
// script-sample content. Unset by default: the server stays stateless.
// HTTPS only, mirroring the license adapter's policy: HTTP is accepted
// only with an explicit non-production opt-out, so a production deployment
// can never leak the redacted payloads in plaintext or point the webhook
// at a non-HTTP scheme. A rejected URL is logged at startup and disabled
// (fail-closed — no webhook rather than a promiscuous one).
const CSP_REPORT_WEBHOOK_ALLOW_HTTP =
  process.env.CSP_REPORT_WEBHOOK_ALLOW_HTTP === "1" &&
  process.env.NODE_ENV !== "production";
const CSP_REPORT_WEBHOOK_URL = (() => {
  const raw = process.env.CSP_REPORT_WEBHOOK_URL?.trim() ?? "";
  if (!raw) return "";
  const protocolOk =
    /^https:\/\//i.test(raw) ||
    (CSP_REPORT_WEBHOOK_ALLOW_HTTP && /^http:\/\//i.test(raw));
  if (!protocolOk) {
    console.error(JSON.stringify({
      event: "csp_webhook_url_rejected",
      reason: "only https is accepted" +
        (CSP_REPORT_WEBHOOK_ALLOW_HTTP
          ? ""
          : " (set CSP_REPORT_WEBHOOK_ALLOW_HTTP=1 outside production to permit http)"),
    }));
    return "";
  }
  return raw;
})();
const CSP_REPORT_WEBHOOK_INTERVAL_MS = readBoundedInteger(
  process.env.CSP_REPORT_WEBHOOK_INTERVAL_MS,
  15_000,
  250,
  86_400_000,
);
const CSP_REPORT_WEBHOOK_BATCH_MAX = readBoundedInteger(
  process.env.CSP_REPORT_WEBHOOK_BATCH_MAX,
  20,
  1,
  1_000,
);
// A webhook entry that keeps failing is dropped after this many attempts,
// keeping the queue bounded even against a permanently dead endpoint.
const CSP_REPORT_WEBHOOK_MAX_ATTEMPTS = readBoundedInteger(
  process.env.CSP_REPORT_WEBHOOK_MAX_ATTEMPTS,
  3,
  1,
  10,
);
// Absolute cap on the number of undelivered reports retained in memory.
// MAX_ATTEMPTS bounds the LIFETIME of each entry, but while the endpoint is
// down, accepted reports keep arriving (rate-limited per IP) — without this
// cap the pending queue would grow without limit. On overflow the oldest
// entries are dropped (counted in webhookDropped), never new ones, so the
// most recent violations are the ones that survive.
const CSP_REPORT_WEBHOOK_QUEUE_MAX = readBoundedInteger(
  process.env.CSP_REPORT_WEBHOOK_QUEUE_MAX,
  1_000,
  1,
  100_000,
);
const CSP_REPORT_WEBHOOK_TIMEOUT_MS = readBoundedInteger(
  process.env.CSP_REPORT_WEBHOOK_TIMEOUT_MS,
  5_000,
  1_000,
  60_000,
);

interface CspViolation {
  "blocked-uri"?: string;
  "document-uri"?: string;
  "violated-directive"?: string;
  "effective-directive"?: string;
  "original-policy"?: string;
  disposition?: string;
  "script-sample"?: string;
  "source-file"?: string;
  "line-number"?: number;
  "column-number"?: number;
}

interface CspReport {
  "csp-report": CspViolation;
}

interface StoredCspReport {
  timestamp: string;
  /** One-way IP fingerprint for aggregation; never the client IP itself. */
  ipHash: string;
  /** Origin-only metadata; paths, queries and fragments are discarded. */
  blockedOrigin?: string;
  documentOrigin?: string;
  violatedDirective?: string;
  disposition?: string;
}

const cspReports: StoredCspReport[] = [];
let cspReportsAccepted = 0;
let cspReportsRejected = 0;
let cspReportsRateLimited = 0;
const cspRateWindows = new Map<string, { count: number; windowStart: number }>();
let cspPersistenceQueue = Promise.resolve();

function hashCspIp(ip: string): string {
  return createHash("sha256")
    .update(`${CSP_REPORT_IP_HASH_SALT}:${ip}`)
    .digest("hex")
    .slice(0, 24);
}

function redactCspOrigin(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  try {
    return new URL(value).origin;
  } catch {
    return "opaque";
  }
}

function pruneCspRateWindows(now = monotonicNow()): void {
  const cutoff = now - CSP_REPORT_WINDOW_MS;
  // Windows are inserted in monotonic first-seen order and never move while
  // their counters are incremented. Expired windows therefore form a FIFO
  // prefix; remove only that prefix instead of scanning every tracked IP on
  // every report. The hot path is O(K), where K is the number expired.
  while (cspRateWindows.size > 0) {
    const oldest = cspRateWindows.entries().next().value as
      | [string, { count: number; windowStart: number }]
      | undefined;
    if (!oldest || oldest[1].windowStart >= cutoff) break;
    cspRateWindows.delete(oldest[0]);
  }
}

async function loadPersistedCspReports(): Promise<void> {
  if (!CSP_REPORT_FILE) return;
  try {
    const raw = await readFile(CSP_REPORT_FILE, "utf8");
    // The separator is a REAL newline ("\n", one byte 0x0A), never the
    // two-char sequence backslash+n. JSON.stringify escapes an actual newline
    // inside a string value to "\n" (backslash+n), so splitting on a raw
    // 0x0A byte is unambiguous: it can never cut through a record, no matter
    // what the violation payload contains. Using "\\n" here would corrupt
    // (and silently lose) the whole persisted history whenever a report
    // carried a newline in script-sample / original-policy.
    // Backward compatibility: files written by older versions used the
    // 2-char "\\n" separator (no raw newlines anywhere — JSON.stringify
    // escapes real ones). Such a file arrives as ONE physical line whose
    // JSON.parse fails; split it on the legacy separator and parse each
    // fragment.
    const parseLine = (line: string): StoredCspReport[] => {
      try {
        const report = JSON.parse(line) as StoredCspReport;
        return [report];
      } catch {
        if (line.includes("\\n")) {
          return line
            .split("\\n")
            .filter(Boolean)
            .map((fragment) => JSON.parse(fragment) as StoredCspReport);
        }
        throw new Error("Not valid JSONL line");
      }
    };
    const loaded = raw
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => parseLine(line))
      .filter((report) =>
        report &&
        typeof report.timestamp === "string" &&
        typeof report.ipHash === "string",
      )
      .slice(-CSP_REPORT_MAX);
    cspReports.push(...loaded);
    cspReportsAccepted = loaded.length;
  } catch (error: unknown) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      console.error(JSON.stringify({ event: "csp_persistence_load_failed", error: String(error) }));
    }
  }
}

function persistCspReports(): void {
  if (!CSP_REPORT_FILE) return;
  const snapshot = cspReports
    .slice(-CSP_REPORT_MAX)
    .map((report) => JSON.stringify(report))
    .join("\n");
  cspPersistenceQueue = cspPersistenceQueue
    .then(async () => {
      await mkdir(dirname(CSP_REPORT_FILE), { recursive: true });
      await writeFile(CSP_REPORT_FILE, snapshot ? `${snapshot}\n` : "", "utf8");
    })
    .catch((error: unknown) => {
      console.error(JSON.stringify({ event: "csp_persistence_write_failed", error: String(error) }));
    });
}

// ── CSP webhook alerting ────────────────────────────────────────────
// Fire-and-forget batching: accepted violations are queued, then flushed at
// most once per interval with at most BATCH_MAX reports per delivery. A
// failed delivery is retried up to MAX_ATTEMPTS with one interval of
// backoff, and the pending queue is hard-capped at QUEUE_MAX entries
// (oldest dropped on overflow) — bounded even against a permanently dead
// endpoint. Delivery never blocks the request handler.
interface CspWebhookEntry {
  report: StoredCspReport;
  attempts: number;
}
const cspWebhookQueue: CspWebhookEntry[] = [];
let cspWebhookTimer: NodeJS.Timeout | null = null;
let cspWebhookDeliveryInFlight = false;
let cspWebhookDelivered = 0;
let cspWebhookFailed = 0;
let cspWebhookDropped = 0;

function scheduleCspWebhookFlush(delayMs: number): void {
  if (cspWebhookTimer !== null) return;
  cspWebhookTimer = setTimeout(() => {
    cspWebhookTimer = null;
    void flushCspWebhook();
  }, delayMs);
  // Never keep the process alive for a notification alone.
  cspWebhookTimer.unref();
}

function enqueueCspWebhook(report: StoredCspReport): void {
  if (!CSP_REPORT_WEBHOOK_URL) return;
  cspWebhookQueue.push({ report, attempts: 0 });
  // Bounded queue: if the endpoint is down, drop the OLDEST pending report
  // (never the new one) so the most recent violations are retained and the
  // queue can never exceed the cap.
  if (cspWebhookQueue.length > CSP_REPORT_WEBHOOK_QUEUE_MAX) {
    const overflow = cspWebhookQueue.length - CSP_REPORT_WEBHOOK_QUEUE_MAX;
    cspWebhookQueue.splice(0, overflow);
    cspWebhookDropped += overflow;
  }
  scheduleCspWebhookFlush(CSP_REPORT_WEBHOOK_INTERVAL_MS);
}

async function flushCspWebhook(): Promise<void> {
  if (!CSP_REPORT_WEBHOOK_URL || cspWebhookDeliveryInFlight) return;
  if (cspWebhookQueue.length === 0) return;
  const batch = cspWebhookQueue.splice(0, CSP_REPORT_WEBHOOK_BATCH_MAX);
  cspWebhookDeliveryInFlight = true;
  try {
    const response = await fetch(CSP_REPORT_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "bookmarkforge-signaling-server",
      },
      body: JSON.stringify({
        serverInstanceId: SERVER_INSTANCE_ID,
        generatedAt: new Date().toISOString(),
        count: batch.length,
        reports: batch.map((entry) => entry.report),
      }),
      signal: AbortSignal.timeout(CSP_REPORT_WEBHOOK_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`webhook responded ${response.status}`);
    }
    cspWebhookDelivered += batch.length;
  } catch (error: unknown) {
    const retryable = batch.filter((entry) => entry.attempts + 1 < CSP_REPORT_WEBHOOK_MAX_ATTEMPTS);
    // Entries that exhausted their attempts are dropped. A delivery failure
    // also counts as a failed delivery (not a dropped one) — failure and
    // drop are separate signals: failed = delivery attempts that failed,
    // dropped = entries discarded by the attempts cap or queue overflow.
    const dropped = batch.length - retryable.length;
    cspWebhookFailed += batch.length;
    if (dropped > 0) {
      cspWebhookDropped += dropped;
    }
    if (retryable.length > 0) {
      cspWebhookQueue.unshift(
        ...retryable.map((entry) => ({ report: entry.report, attempts: entry.attempts + 1 })),
      );
      // Requeued entries still count against the cap: if the queue is full,
      // drop the oldest pending entry to make room.
      if (cspWebhookQueue.length > CSP_REPORT_WEBHOOK_QUEUE_MAX) {
        const overflow = cspWebhookQueue.length - CSP_REPORT_WEBHOOK_QUEUE_MAX;
        cspWebhookQueue.splice(0, overflow);
        cspWebhookDropped += overflow;
      }
      scheduleCspWebhookFlush(CSP_REPORT_WEBHOOK_INTERVAL_MS);
    }
    console.error(JSON.stringify({
      event: "csp_webhook_failed",
      reason: String(error),
      retrying: retryable.length,
      dropped,
    }));
  } finally {
    cspWebhookDeliveryInFlight = false;
    // A partial flush (batch cap reached) must not strand the rest of the
    // queue: schedule the next flush if entries remain.
    if (cspWebhookQueue.length > 0) {
      scheduleCspWebhookFlush(CSP_REPORT_WEBHOOK_INTERVAL_MS);
    }
  }
}

function cspReportHandler(req: IncomingMessage, res: ServerResponse): void {
  // Only POST — GET returns the recent-reports dashboard.
  if (req.method === "GET") {
    const adminToken = req.headers["x-csp-admin-token"];
    // Constant-time comparison (same pattern as the room-secret check): the
    // admin token is a shared secret, so a naive `!==` would leak match
    // position through timing to a remote attacker probing the dashboard.
    const tokenMatches =
      typeof adminToken === "string" &&
      constantTimeUtf8Equal(CSP_REPORT_ADMIN_TOKEN, adminToken);
    if (!CSP_REPORT_ADMIN_TOKEN || !tokenMatches) {
      res.writeHead(CSP_REPORT_ADMIN_TOKEN ? 401 : 503, {
        "Content-Type": "text/plain",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(CSP_REPORT_ADMIN_TOKEN ? "Unauthorized" : "Diagnostics unavailable");
      return;
    }
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...cspCorsHeaders(req),
    });
    res.end(JSON.stringify({
      recent: cspReports.slice(-50),
      total: cspReportsAccepted,
      rejected: cspReportsRejected,
      rateLimited: cspReportsRateLimited,
      persisted: Boolean(CSP_REPORT_FILE),
      webhook: Boolean(CSP_REPORT_WEBHOOK_URL),
      webhookDelivered: cspWebhookDelivered,
      webhookFailed: cspWebhookFailed,
      webhookDropped: cspWebhookDropped,
      serverInstanceId: SERVER_INSTANCE_ID,
    }));
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405, { "Content-Type": "text/plain" });
    res.end("Method Not Allowed");
    return;
  }

  // Per-IP rate limiting for CSP reports.
  const ip = clientIp(req);
  const now = monotonicNow();
  pruneCspRateWindows(now);
  const win = cspRateWindows.get(ip);
  if (win && now - win.windowStart < CSP_REPORT_WINDOW_MS) {
    if (win.count >= CSP_REPORT_LIMIT) {
      cspReportsRateLimited += 1;
      res.writeHead(429, { "Content-Type": "text/plain" });
      res.end("Too Many Requests");
      return;
    }
    win.count++;
  } else {
    if (cspRateWindows.size >= CSP_REPORT_RATE_MAX_ENTRIES) {
      pruneCspRateWindows(now);
    }
    if (cspRateWindows.size >= CSP_REPORT_RATE_MAX_ENTRIES) {
      cspReportsRateLimited += 1;
      res.writeHead(429, { "Content-Type": "text/plain" });
      res.end("Too Many Requests");
      return;
    }
    cspRateWindows.set(ip, { count: 1, windowStart: now });
  }

  // Reject oversized bodies before buffering them. Content-Length is only an
  // early check; chunked requests are bounded while streaming below.
  const declaredLength = Number(req.headers["content-length"] ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > CSP_REPORT_BODY_MAX_BYTES) {
    req.resume();
    res.writeHead(413, { "Content-Type": "text/plain" });
    res.end("Payload Too Large");
    return;
  }

  const chunks: Buffer[] = [];
  let bodyBytes = 0;
  let bodyTooLarge = false;
  let oversizedResponseSent = false;
  let settled = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    req.removeListener("data", onData);
    req.removeListener("end", onEnd);
    req.removeListener("error", onRequestError);
    req.removeListener("aborted", onAborted);
  };
  const rejectOversizedBody = () => {
    if (oversizedResponseSent) return;
    oversizedResponseSent = true;
    bodyTooLarge = true;
    // Stop retaining data immediately. Resume just long enough for Node to
    // drain the parser, then close the request after the 413 is flushed so a
    // chunked attacker cannot keep this connection open indefinitely.
    settle();
    req.resume();
    res.writeHead(413, { "Content-Type": "text/plain" });
    res.end("Payload Too Large");
    res.once("finish", () => req.destroy());
  };
  const onData = (chunk: Buffer) => {
    bodyBytes += chunk.length;
    if (bodyBytes > CSP_REPORT_BODY_MAX_BYTES) {
      rejectOversizedBody();
      return;
    }
    chunks.push(chunk);
  };
  // A client that disconnects mid-body (RST after headers, tab close) emits
  // 'error'/'aborted' on the request stream. Without these listeners the
  // 'error' event is an uncaught exception in Node — a remote DoS against
  // the whole signaling server — and the partial body is retained forever.
  const onRequestError = (_err: Error) => {
    settle();
    if (!res.writableEnded) {
      res.destroy();
    }
  };
  const onAborted = () => {
    settle();
    if (!res.writableEnded) {
      res.destroy();
    }
  };
  const onEnd = () => {
    if (bodyTooLarge || settled) return;
    try {
      const raw = Buffer.concat(chunks).toString("utf8");
      const report = JSON.parse(raw) as CspReport;
      const v = report?.["csp-report"];
      if (!v || typeof v !== "object") {
        cspReportsRejected += 1;
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Bad Request: missing csp-report");
        return;
      }

      const stored: StoredCspReport = {
        timestamp: new Date().toISOString(),
        ipHash: hashCspIp(ip),
        blockedOrigin: redactCspOrigin(v["blocked-uri"]),
        documentOrigin: redactCspOrigin(v["document-uri"]),
        violatedDirective: (v["effective-directive"] ??
          v["violated-directive"] ?? "").slice(0, 200),
        disposition: typeof v.disposition === "string"
          ? v.disposition.slice(0, 32)
          : "enforce",
      };

      // Evict oldest if over capacity.
      if (cspReports.length >= CSP_REPORT_MAX) {
        cspReports.splice(0, cspReports.length - CSP_REPORT_MAX + 1);
      }
      cspReports.push(stored);
      cspReportsAccepted += 1;
      persistCspReports();
      enqueueCspWebhook(stored);

      console.error(JSON.stringify({
        event: "csp_violation",
        timestamp: stored.timestamp,
        ipHash: stored.ipHash,
        blockedOrigin: stored.blockedOrigin,
        documentOrigin: stored.documentOrigin,
        violatedDirective: stored.violatedDirective,
        disposition: stored.disposition,
      }));

      res.writeHead(204);
      res.end();
    } catch (error: unknown) {
      cspReportsRejected += 1;
      console.error(JSON.stringify({ event: "csp_report_rejected", reason: "invalid_json", error: String(error) }));
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("Bad Request: invalid JSON");
    }
  };
  req.on("data", onData);
  req.on("end", onEnd);
  req.on("error", onRequestError);
  req.on("aborted", onAborted);
}

// Load the optional bounded JSONL history before requests arrive. The server
// remains usable if the file is absent or unreadable.
void loadPersistedCspReports();

// Prune stale CSP rate-limit windows periodically.
setInterval(() => pruneCspRateWindows(), Math.max(CSP_REPORT_WINDOW_MS, 60_000)).unref();

const entitlementGuard = createEntitlementGuard();

const licenseHandler = createLicenseHandler();
// Server-authoritative entitlement answer. Unlike the signing service it needs
// no private key and no license key from the caller — just the signed proof the
// client already holds — so any deployment that serves the app can enforce or
// confirm Pro.
const entitlementHandler = createEntitlementHandler({
  trustProxy: process.env.TRUST_PROXY === "1" || process.env.TRUST_PROXY === "true",
});
// Client events collector (storage-pressure / bundle-integrity-spike) with
// the 3-distinct-clients-in-10-min critical threshold alert.
const clientEventsHandler = createClientEventsHandler({
  serverInstanceId: SERVER_INSTANCE_ID,
});
// Business analytics collector (opt-in, pseudonymous, no content) — daily
// aggregated buckets → DAU/WAU/MAU + cohort retention + activation funnel.
const analyticsHandler = createAnalyticsHandler({
  serverInstanceId: SERVER_INSTANCE_ID,
});

/**
 * The unguarded HTTP dispatch.
 *
 * The name is deliberately uninviting: `scripts/check-pro-routes.mjs` proves
 * this function has exactly one caller — the entitlement-guarded dispatcher
 * below — so a new route cannot be mounted without passing through the route
 * policy table. Call it directly and a paid route becomes reachable by anyone.
 */
const dispatchUnGuardedRequest = (req: IncomingMessage, res: ServerResponse): void => {
  if (
    req.url === "/api/license/health" ||
    req.url === "/api/license/activate" ||
    req.url === "/api/license/validate" ||
    req.url === "/api/license/deactivate"
  ) {
    void licenseHandler(req, res);
    return;
  }
  if (req.url === "/api/license/entitlement") {
    void entitlementHandler(req, res);
    return;
  }
  if (req.method === "GET" && req.url === "/health") {
    return healthHandler(req, res);
  }
  if (req.method === "GET" && req.url === "/admin") {
    return signalingAdminHandler(req, res);
  }
  if (
    req.url === "/csp-report" ||
    req.url?.startsWith("/csp-report?")
  ) {
    return cspReportHandler(req, res);
  }
  if (
    req.url === "/api/client-events" ||
    req.url?.startsWith("/api/client-events?") ||
    // Diagnostics subpaths (e.g. /api/client-events/retry-stats) go to the
    // same collector — without this the reporter's retry-stats telemetry
    // landed on the 426 catch-all and the degraded-delivery signal was dead.
    req.url?.startsWith("/api/client-events/")
  ) {
    return clientEventsHandler(req, res);
  }
  if (
    req.url === "/api/analytics/events" ||
    req.url?.startsWith("/api/analytics/events?") ||
    req.url === "/api/analytics/kpis" ||
    req.url?.startsWith("/api/analytics/kpis?")
  ) {
    return analyticsHandler(req, res);
  }
  // Any other HTTP request gets a 426 Upgrade Required — the server
  // only speaks WebSocket beyond /health, /admin, /csp-report and
  // /api/client-events.
  res.writeHead(426, { "Content-Type": "text/plain" });
  res.end("Upgrade Required — this is a WebSocket signaling server.");
};

// Every HTTP request goes through the entitlement-guarded dispatcher, which
// reads the route policy (server/src/route-table.ts) and resolves the
// entitlement for a paid route before its handler is allowed to run. Routes the
// table does not declare fall through unchanged, so the 426 catch-all above and
// the handlers' own 405s keep their exact behaviour.
const settleHttpRequest = createGuardedDispatcher({
  guard: entitlementGuard,
  dispatch: dispatchUnGuardedRequest,
});

const httpServer = createServer((req, res) => {
  // Apply the same non-sensitive response hardening to health, admin, CSP reports,
  // and unsupported routes before any handler can finish the response.
  applySecurityHeaders(res);
  void settleHttpRequest(req, res);
});

// Start listening and only then announce readiness. The signaling test waits
// for the "Server running" marker on stdout before connecting; printing before
// the socket is actually bound would race the first connection under load.
let wss: WebSocketServer;
httpServer.listen(PORT, HOST, () => {
  wss = new WebSocketServer({
    server: httpServer,
    maxPayload: MAX_PAYLOAD_BYTES,
    verifyClient: ({ origin }, cb) => {
      // When WS_ALLOWED_ORIGINS is configured, reject WebSocket upgrades
      // from unknown origins to prevent unauthenticated DoS via connection
      // exhaustion. Skip verification when the list is empty (local dev).
      if (WS_ALLOWED_ORIGINS.size === 0) { cb(true); return; }
      if (!origin || typeof origin !== "string") { cb(false, 403, "origin required"); return; }
      cb(WS_ALLOWED_ORIGINS.has(origin));
    },
  });
  console.log(`Server running on ws://${HOST}:${PORT}`);

  // TRUST_PROXY guard: when the server binds to 0.0.0.0 (public) and
  // TRUST_PROXY is off, a reverse proxy in front (nginx/Caddy) will
  // forward connections with its own IP — all clients share the same
  // remoteAddress, collapsing the per-IP join rate limit. Operators
  // must set TRUST_PROXY=1 so x-forwarded-for is honoured.
  if (HOST === "0.0.0.0" && !TRUST_PROXY) {
    console.warn(
      "[signaling] HOST=0.0.0.0 and TRUST_PROXY is off. " +
        "If this server sits behind a reverse proxy, all clients will " +
        "appear to share the same IP — collapsing the per-IP join rate " +
        "limit. Set TRUST_PROXY=1 in the environment.",
    );
  }

  setupWebSocketHandlers(wss);
});

// Sockets that have answered a ping since the last sweep. The ws client
// (and any RFC 6455 peer) auto-replies with a pong, so a healthy socket
// re-registers on every sweep and an unresponsive one is terminated after
// one missed round-trip. A WeakSet avoids extending the ws type.
const aliveSockets = new WeakSet<WebSocket>();

function setupWebSocketHandlers(wss: WebSocketServer): void {
  wss.on("connection", (ws, req) => {
    const peerId = randomUUID();
    const ip = clientIp(req);
    const ipHash = hashSignalingIp(ip);

    // A socket error (e.g. maxPayload exceeded, aborted handshake) must never
    // crash the process: log and swallow. Without a listener, an 'error' event
    // on a ws socket is an uncaught exception in Node.
    ws.on("error", (err) => {
      console.error(
        JSON.stringify({
          event: "signaling_socket_error",
          peerId,
          ipHash,
          message: err.message,
          serverInstanceId: SERVER_INSTANCE_ID,
        }),
      );
    });

    // Heartbeat: mark the socket alive now and on every pong. The sweep
    // below flips the flag off before pinging, so a missing pong means the
    // socket dies (terminate → close event → room cleanup runs normally).
    aliveSockets.add(ws);
    ws.on("pong", () => {
      aliveSockets.add(ws);
    });

    // Global connection cap.
    // The ws library adds the new socket to clients before this callback.
    // Reject only after the configured maximum has actually been exceeded;
    // this allows exactly MAX_CONNECTIONS live sockets.
    if (wss.clients.size > MAX_CONNECTIONS) {
      console.error(
        JSON.stringify({
          event: "signaling_connection_rejected_overload",
          peerId,
          ipHash,
          clients: wss.clients.size,
          max: MAX_CONNECTIONS,
          serverInstanceId: SERVER_INSTANCE_ID,
        }),
      );
      ws.close(CLOSE_OVERLOAD, "server at capacity");
      return;
    }

    let roomId: string | null = null;
    const turnIceServers = buildTurnIceServers();
    console.error(
      JSON.stringify({
        event: "signaling_connection_accepted",
        peerId,
        ipHash,
        turnConfigured: turnIceServers.length > 0,
        serverInstanceId: SERVER_INSTANCE_ID,
      }),
    );
    ws.send(
      JSON.stringify(
        turnIceServers.length > 0
          ? {
              type: "init",
              yourPeerId: peerId,
              iceServers: turnIceServers,
              serverInstanceId: SERVER_INSTANCE_ID,
            }
          : {
              type: "init",
              yourPeerId: peerId,
              serverInstanceId: SERVER_INSTANCE_ID,
            },
      ),
    );

    ws.on("close", () => {
      if (!roomId) {return;}
      const room = rooms.get(roomId);
      if (room) {
        room.peers.delete(peerId);
        if (room.peers.size === 0) {
          console.error(
            JSON.stringify({
              event: "signaling_room_closed",
              roomId,
              serverInstanceId: SERVER_INSTANCE_ID,
              peersRemaining: 0,
            }),
          );
          rooms.delete(roomId);
        }
      }
      console.error(
        JSON.stringify({
          event: "signaling_peer_left",
          roomId,
          peerId,
          serverInstanceId: SERVER_INSTANCE_ID,
        }),
      );
    });

    ws.on("message", (raw) => {
      let msg: unknown;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        ws.close(CLOSE_POLICY, "invalid JSON");
        return;
      }
      if (typeof msg !== "object" || msg === null) {return;}
      const m = msg as Record<string, unknown>;

      if (m.type === "join") {
        // One join per connection: room-hopping would leave this peer in the
        // previous room's map (stale entry) and is never legitimate.
        if (roomId) {
          ws.close(CLOSE_POLICY, "already joined");
          return;
        }
        const rid = String(m.room ?? "");
        if (!isValidRoomId(rid)) {
          ws.close(CLOSE_POLICY, "invalid room id");
          return;
        }
        if (
          m.roomSecret !== undefined &&
          (typeof m.roomSecret !== "string" ||
            m.roomSecret.length > MAX_ROOM_SECRET_LENGTH ||
            /[\u0000-\u001f\u007f-\u009f]/.test(m.roomSecret))
        ) {
          ws.close(CLOSE_POLICY, "invalid room secret");
          return;
        }
        if (!allowJoin(ip)) {
          console.error(
            JSON.stringify({
              event: "signaling_join_rate_limited",
              roomId: rid,
              peerId,
              ipHash,
              serverInstanceId: SERVER_INSTANCE_ID,
            }),
          );
          ws.close(CLOSE_OVERLOAD, "join rate limit exceeded");
          return;
        }
        let room = rooms.get(rid);
        if (!room) {
          if (rooms.size >= MAX_ROOMS) {
            console.error(
              JSON.stringify({
                event: "signaling_max_rooms_reached",
                peerId,
                ipHash,
                rooms: rooms.size,
                max: MAX_ROOMS,
                serverInstanceId: SERVER_INSTANCE_ID,
              }),
            );
            ws.close(CLOSE_OVERLOAD, "server at capacity");
            return;
          }
          room = {
            secret:
              typeof m.roomSecret === "string" && m.roomSecret.length > 0
                ? m.roomSecret
                : null,
            peers: new Map(),
            recentSignals: new Map(),
          };
          rooms.set(rid, room);
          console.error(
            JSON.stringify({
              event: "signaling_room_created",
              roomId: rid,
              secretPresent: room.secret !== null,
              serverInstanceId: SERVER_INSTANCE_ID,
            }),
          );
        }
        if (room.peers.size >= MAX_PEERS_PER_ROOM) {
          console.error(
            JSON.stringify({
              event: "signaling_room_full",
              roomId: rid,
              peerId,
              ipHash,
              peersInRoom: room.peers.size,
              max: MAX_PEERS_PER_ROOM,
              serverInstanceId: SERVER_INSTANCE_ID,
            }),
          );
          ws.close(CLOSE_OVERLOAD, "room full");
          return;
        }
        // Enforce the room secret if one was set by the host. Constant-time
        // comparison (same timing-safe pattern as verifySignalAuth): the
        // secret is high-entropy, but a naive `!==` leaks match position
        // through timing and costs nothing to fix. The UTF-8 helper also keeps
        // byte-length handling identical to the admin-token path.
        if (
          room.secret !== null &&
          !constantTimeUtf8Equal(room.secret, String(m.roomSecret ?? ""))
        ) {
          console.error(
            JSON.stringify({
              event: "signaling_invalid_room_secret",
              roomId: rid,
              peerId,
              ipHash,
              serverInstanceId: SERVER_INSTANCE_ID,
            }),
          );
          ws.close(CLOSE_POLICY, "invalid room secret");
          return;
        }
        room.peers.set(peerId, ws);
        roomId = rid;
        // Broadcast the new room state to EVERY live member (including the
        // joiner), matching RxDB's official signaling server protocol. A
        // joiner-only `joined` leaves existing peers blind to new members:
        // they never create a peer connection for the newcomer and throw on
        // the newcomer's relayed signals (getFromMapOrThrow), so a 3+ device
        // mesh can never form. The multiuser e2e caught exactly this.
        const roomPeerIds = [...room.peers.keys()];
        for (const [, memberSocket] of room.peers) {
          if (memberSocket.readyState === memberSocket.OPEN) {
            memberSocket.send(
              JSON.stringify({ type: "joined", otherPeerIds: roomPeerIds }),
            );
          }
        }
        console.error(
          JSON.stringify({
            event: "signaling_peer_joined",
            roomId: rid,
            peerId,
            ipHash,
            peersInRoom: room.peers.size,
            secretPresent: room.secret !== null,
            serverInstanceId: SERVER_INSTANCE_ID,
          }),
        );
      } else if (m.type === "signal") {
        if (!roomId) {return;}
        const room = rooms.get(roomId);
        if (!room) {return;}
        if (
          typeof m.receiverPeerId !== "string" ||
          m.receiverPeerId.length === 0 ||
          m.receiverPeerId.length > MAX_PEER_ID_LENGTH
        ) {
          console.error(
            JSON.stringify({
              event: "signaling_invalid_receiver",
              roomId,
              peerId,
              serverInstanceId: SERVER_INSTANCE_ID,
            }),
          );
          ws.close(CLOSE_POLICY, "invalid receiver peer id");
          return;
        }
        let signalDataBytes = 0;
        try {
          const serializedData = JSON.stringify(m.data ?? null);
          signalDataBytes = Buffer.byteLength(serializedData ?? "", "utf8");
        } catch {
          ws.close(CLOSE_POLICY, "invalid signal data");
          return;
        }
        if (signalDataBytes > MAX_SIGNAL_DATA_BYTES) {
          console.error(
            JSON.stringify({
              event: "signaling_signal_too_large",
              roomId,
              peerId,
              signalDataBytes,
              serverInstanceId: SERVER_INSTANCE_ID,
            }),
          );
          ws.close(CLOSE_OVERLOAD, "signal data too large");
          return;
        }
        // Anti-spoofing: only the socket's own peerId may be claimed as the
        // sender. A client impersonating another peer is disconnected.
        if (m.senderPeerId !== undefined && String(m.senderPeerId) !== peerId) {
          console.error(
            JSON.stringify({
              event: "signaling_spoofed_sender",
              roomId,
              peerId,
              claimedSender: String(m.senderPeerId),
              serverInstanceId: SERVER_INSTANCE_ID,
            }),
          );
          ws.close(CLOSE_POLICY, "spoofed senderPeerId");
          return;
        }
        // HMAC authentication (defense-in-depth, mandatory in production and
        // enforced by default whenever the room has a secret; the opt-out is
        // test/development-only):
        // every signal payload MUST carry a valid signalAuth HMAC to prevent
        // signal injection by peers who know the room ID but not the secret.
        // The client signs automatically (see SyncService.ts
        // createSignalingSocketFactory); public rxdb.info / PubNub servers
        // ignore the extra field, so signed messages are safe there too.
        if (ENFORCE_SIGNAL_HMAC && room.secret !== null) {
          const signalKey = deriveSignalKey(roomId, room.secret);
          const payloadRaw = JSON.stringify({
            type: "signal",
            senderPeerId: peerId,
            receiverPeerId: String(m.receiverPeerId ?? ""),
            data: m.data ?? null,
          });
          const clientAuth = typeof m.signalAuth === "string" ? m.signalAuth : "";
          const hmacOk =
            clientAuth.length === MAX_SIGNAL_AUTH_LENGTH &&
            /^[a-f0-9]{64}$/i.test(clientAuth) &&
            verifySignalAuth(signalKey, payloadRaw, clientAuth);
          if (!hmacOk) {
            console.error(
              JSON.stringify({
                event: "signaling_invalid_hmac",
                roomId,
                peerId,
                serverInstanceId: SERVER_INSTANCE_ID,
              }),
            );
            ws.close(CLOSE_POLICY, "invalid signal HMAC");
            return;
          }
        }
        const receiverPeerId = String(m.receiverPeerId ?? "");
        const receiver = room.peers.get(receiverPeerId);
        // Do not consume the duplicate/replay slot until a live receiver is
        // actually available. A sender may legitimately transmit while the
        // target has received `init` but has not joined yet; caching that
        // undelivered frame would suppress the retry after the target joins.
        if (!receiver || receiver.readyState !== receiver.OPEN) {
          return;
        }

        // Replay windows are process-local durations, so wall-clock jumps
        // must not extend or prematurely expire them. performance.now() is
        // monotonic and cannot be adjusted by NTP/manual clock changes.
        const now = performance.now();
        const expiryCutoff = now - SIGNAL_REPLAY_WINDOW_MS;
        // Map preserves insertion order and entries are inserted with the
        // current timestamp, so expired signals form a FIFO prefix. Popping
        // only that prefix avoids scanning the whole room cache on every
        // signal (an attacker can otherwise turn a 4,096-entry cache into an
        // avoidable O(N) CPU cost per frame).
        while (room.recentSignals.size > 0) {
          const oldest = room.recentSignals.entries().next().value as
            | [string, number]
            | undefined;
          if (!oldest || oldest[1] >= expiryCutoff) break;
          room.recentSignals.delete(oldest[0]);
        }
        const replayKey = createHash("sha256")
          .update(JSON.stringify({
            senderPeerId: peerId,
            receiverPeerId,
            data: m.data ?? null,
          }))
          .digest("hex");
        if (room.recentSignals.has(replayKey)) {
          return;
        }
        while (room.recentSignals.size >= MAX_RECENT_SIGNALS_PER_ROOM) {
          const oldest = room.recentSignals.keys().next().value;
          if (typeof oldest !== "string") break;
          room.recentSignals.delete(oldest);
        }
        const relayPayload = JSON.stringify({
          type: "signal",
          senderPeerId: peerId,
          receiverPeerId,
          data: m.data ?? null,
        });
        // Record the key only after ws.send accepts the frame. If the socket
        // closes in the readyState/send race and send throws, a retry must not
        // be suppressed as though the signal had been delivered.
        try {
          receiver.send(relayPayload);
        } catch {
          console.error(
            JSON.stringify({
              event: "signaling_relay_failed",
              roomId,
              peerId,
              receiverPeerId,
              serverInstanceId: SERVER_INSTANCE_ID,
            }),
          );
          return;
        }
        room.recentSignals.set(replayKey, now);
        console.error(
          JSON.stringify({
            event: "signaling_relay",
            roomId,
            peerId,
            receiverPeerId,
            signalDataBytes,
            serverInstanceId: SERVER_INSTANCE_ID,
          }),
        );
      }
    });
  });

  // Server-level error handler (binding failures, etc.).
  wss.on("error", (err) => {
    console.error(
      JSON.stringify({
        event: "signaling_server_error",
        message: err.message,
        serverInstanceId: SERVER_INSTANCE_ID,
      }),
    );
  });

  // Dead-socket sweep. unref() so the interval alone never keeps the
  // process alive (tests SIGTERM the child; a failed beforeAll must not
  // hang vitest on a lingering timer).
  const heartbeatTimer = setInterval(() => {
    for (const client of wss.clients) {
      if (!aliveSockets.has(client)) {
        client.terminate();
        continue;
      }
      aliveSockets.delete(client);
      client.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref();
}

// ── Process-level fail-closed guards ────────────────────────────────
// Without these, an uncaught exception or unhandled promise rejection
// kills the Node process silently — no logging, no graceful shutdown,
// no WebSocket cleanup. Docker restarts the container, but peers lose
// their connections without a clean close frame.

process.on("uncaughtException", (err) => {
  console.error(JSON.stringify({
    event: "uncaught_exception",
    message: err.message,
    stack: err.stack?.slice(0, 500),
    serverInstanceId: SERVER_INSTANCE_ID,
  }));
  // Fail-closed: exit so Docker/kubernetes restarts the container
  // rather than continuing in an undefined state.
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error(JSON.stringify({
    event: "unhandled_rejection",
    reason: reason instanceof Error
      ? { message: reason.message, stack: reason.stack?.slice(0, 500) }
      : String(reason),
    serverInstanceId: SERVER_INSTANCE_ID,
  }));
  // Fail-closed: same as uncaughtException
  process.exit(1);
});

function gracefulShutdown(signal: string): void {
  console.error(JSON.stringify({
    event: "shutdown",
    signal,
    serverInstanceId: SERVER_INSTANCE_ID,
  }));
  // Close all WebSocket connections with going-away code 1001
  if (typeof wss !== "undefined") {
    for (const client of wss.clients) {
      client.close(1001, "server shutting down");
    }
    wss.close(() => {
      httpServer.close(() => {
        process.exit(0);
      });
    });
  } else {
    httpServer.close(() => {
      process.exit(0);
    });
  }
  // Force exit after 5s if graceful shutdown hangs
  setTimeout(() => {
    console.error(JSON.stringify({
      event: "shutdown_forced",
      signal,
      serverInstanceId: SERVER_INSTANCE_ID,
    }));
    process.exit(1);
  }, 5_000).unref();
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
