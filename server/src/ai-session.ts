import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  applySecurityHeaders,
  readConfiguredBearerTokens,
  sendJson,
  createRateLimiter,
  createRedisClientFromUrl,
  clientIp,
  type RedisValueStore,
} from "./ai-proxy";
import { resolveLicensePublicKeySpki } from "./entitlement";
import {
  createEntitlementGuard,
  resolveEntitlementContext,
  writeGuardDenial,
  type EntitlementGuard,
} from "./entitlement-guard";

const SESSION_COOKIE = "bf_ai_session";
const CSRF_COOKIE = "bf_ai_csrf";
const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_SESSIONS = 50_000;
const MAX_TOKEN_LENGTH = 512;
const SESSION_PATH = "/api/services/ai";

const ENV_TRUTHY = new Set(["1", "true", "yes", "on"]);
const ENV_FALSY = new Set(["0", "false", "no", "off"]);

/**
 * Decide whether creating an AI session requires a verified license proof.
 *
 * Fail closed in EVERY environment. The previous default
 * (`NODE_ENV === "production"`) handed anonymous sessions to every staging,
 * preview or misconfigured deployment — precisely the deployments where
 * cloud AI costs money — and the penetration-test suite flagged it as a
 * licensing bypass. Anonymous sessions now exist only under the explicit
 * `AI_SESSION_REQUIRE_LICENSE=0`, which production refuses outright and any
 * other environment announces on startup (and reports through the health
 * surface) so an unlicensed deployment can never be silent.
 */
function resolveLicensePolicy(): {
  requireLicense: boolean;
  anonymousReason: string | null;
} {
  const raw = process.env.AI_SESSION_REQUIRE_LICENSE?.trim().toLowerCase();
  if (raw === undefined || raw === "" || ENV_TRUTHY.has(raw)) {
    return { requireLicense: true, anonymousReason: null };
  }
  if (ENV_FALSY.has(raw)) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "AI_SESSION_REQUIRE_LICENSE=0 is refused in production: anonymous AI sessions would bypass the license entitlement",
      );
    }
    console.warn(
      "[ai-session] AI_SESSION_REQUIRE_LICENSE=0 — issuing ANONYMOUS AI sessions; every accepted request is unlicensed (non-production only)",
    );
    return { requireLicense: false, anonymousReason: "AI_SESSION_REQUIRE_LICENSE=0" };
  }
  console.warn(
    `[ai-session] unrecognized AI_SESSION_REQUIRE_LICENSE="${raw}" — requiring a verified license (fail closed)`,
  );
  return { requireLicense: true, anonymousReason: null };
}

interface SessionRecord {
  tokenDigest: string;
  csrfToken: string;
  createdAt: number;
  expiresAt: number;
  /**
   * Epoch ms the entitlement backing this session ends (undefined = lifetime
   * license or anonymous session). The cookie TTL is not enough: a license
   * that expires or is revoked mid-session must stop working when it does,
   * not when the 30-minute session happens to end.
   */
  entitlementExpiresAt?: number;
  // Deliberately not bound to IP: client addresses can change legitimately
  // behind load balancers, mobile networks, and rotating IPv6 prefixes.
  identity: string;
}

export interface AiSessionManagerOptions {
  now?: () => number;
  ttlMs?: number;
  sessionStore?: RedisValueStore;
  redisUrl?: string;
  redisKeyPrefix?: string;
  maxSessions?: number;
  allowedOrigins?: string[];
  allowMissingOrigin?: boolean;
  /**
   * Require a client-provided server-signed license proof. Defaults to true
   * in every environment (fail closed); false is an explicit opt-in for
   * isolated test topologies.
   */
  requireLicense?: boolean;
  licensePublicKeySpki?: string;
  sessionRateLimit?: number;
  /** Trust X-Forwarded-For for the session-creation rate limit (mirrors the proxy handlers). */
  trustProxy?: boolean;
  /**
   * The shared entitlement guard. Defaults to one built here from this
   * manager's license policy; inject it to share a single guard instance with
   * the router (see server/src/route-table.ts).
   */
  entitlementGuard?: EntitlementGuard;
}

export interface AiSessionIdentity {
  identity: string;
  csrfToken: string;
}

export interface AiSessionManager {
  createSessionHandler(): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  authenticate(req: IncomingMessage): Promise<AiSessionIdentity | null>;
  prune(): void;
  /** True when a verified license proof is required to create a session. */
  readonly licenseEnforced: boolean;
  /** Set when the deployment explicitly opted into anonymous sessions. */
  readonly anonymousSessionsReason?: string;
  /**
   * The server's single entitlement enforcement point. The router mounts it in
   * front of every paid route, so the session route and the paid routes it
   * mints sessions for answer one policy, not three.
   */
  readonly entitlementGuard: EntitlementGuard;
}

function parseCookies(header: string | undefined): Map<string, string> {
  const result = new Map<string, string>();
  if (!header) return result;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name && value.length <= MAX_TOKEN_LENGTH) result.set(name, value);
  }
  return result;
}

function constantTimeEqual(left: string, right: string): boolean {
  // Always compare the full byte length to avoid truncation: two equal-length
  // strings that differ only after byte 128 would compare as equal with a
  // fixed-size buffer. Use a dynamic size derived from the actual byte lengths.
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  if (a.length !== b.length) {
    // Compare anyway to avoid length-based timing leak, then return false.
    timingSafeEqual(
      Buffer.alloc(a.length, 0),
      Buffer.alloc(b.length, 0),
    );
    return false;
  }
  return timingSafeEqual(a, b);
}

function digest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}


/** Origin of the request, or null when the browser sent none. */
export function requestOrigin(req: IncomingMessage): string | null {
  const origin = req.headers.origin;
  return typeof origin === "string" && origin.length <= 2048 ? origin : null;
}

/** Origin this deployment would serve the request from, derived from Host. */
export function expectedOrigin(req: IncomingMessage): string | null {
  const host = req.headers.host;
  if (!host || /[\u0000-\u001f\u007f-\u009f]/.test(host)) return null;
  const forwardedProto = req.headers["x-forwarded-proto"];
  const encrypted = (req.socket as IncomingMessage["socket"] & { encrypted?: boolean }).encrypted === true;
  const protocol = typeof forwardedProto === "string" && forwardedProto.split(",")[0]?.trim() === "https"
    ? "https"
    : encrypted ? "https" : "http";
  return `${protocol}://${host}`;
}

/** Same-origin/allow-list CSRF check shared by the session and entitlement routes. */
export function hasValidOrigin(req: IncomingMessage, allowedOrigins: ReadonlySet<string>, allowMissingOrigin: boolean): boolean {
  const origin = requestOrigin(req);
  if (!origin) return allowMissingOrigin;
  // Once the operator supplies an allow-list, it is authoritative. Falling
  // back to Host-derived origins would let an untrusted Host header create a
  // valid origin outside the deployment's browser origin.
  if (allowedOrigins.size > 0) return allowedOrigins.has(origin);
  const derived = expectedOrigin(req);
  return derived !== null && origin === derived;
}

function cookieValue(name: string, value: string, maxAgeSeconds: number, httpOnly: boolean, secure: boolean): string {
  return `${name}=${value}; Path=${SESSION_PATH}; Max-Age=${maxAgeSeconds}; SameSite=Strict${httpOnly ? "; HttpOnly" : ""}${secure ? "; Secure" : ""}`;
}

export function createAiSessionManager(options: AiSessionManagerOptions = {}): AiSessionManager {
  const now = options.now ?? Date.now;
  const ttlMs = Math.max(60_000, Math.min(options.ttlMs ?? SESSION_TTL_MS, 24 * 60 * 60 * 1000));
  const maxSessions = Math.max(100, Math.min(options.maxSessions ?? MAX_SESSIONS, 1_000_000));
  const policy = options.requireLicense === undefined
    ? resolveLicensePolicy()
    : {
        requireLicense: options.requireLicense,
        anonymousReason: options.requireLicense ? null : "explicit test policy",
      };
  const requireLicense = policy.requireLicense;
  const publicKeySpki = options.licensePublicKeySpki ?? resolveLicensePublicKeySpki();
  const allowedOrigins = new Set(
    (options.allowedOrigins ?? (process.env.AI_SESSION_ORIGINS ?? "").split(","))
      .map((origin) => origin.trim()).filter(Boolean),
  );
  // When no allow-list is configured, CSRF defense falls back to comparing
  // the Origin header against a Host-derived origin. That derivation trusts
  // the Host header, so surface the risk at startup rather than silently
  // running on the weaker default.
  if (allowedOrigins.size === 0 && process.env.NODE_ENV === "production") {
    console.error(
      "[ai-session] refusing production session manager without explicit AI_SESSION_ORIGINS",
    );
    throw new Error("AI_SESSION_ORIGINS is required in production");
  }
  if (allowedOrigins.size === 0) {
    console.warn(
      "[ai-session] AI_SESSION_ORIGINS is not configured; using Host-derived origin checks outside production.",
    );
  }
  const allowMissingOrigin = options.allowMissingOrigin ?? process.env.NODE_ENV !== "production";
  const trustProxy = options.trustProxy ??
    (process.env.TRUST_PROXY === "1" || process.env.TRUST_PROXY === "true");
  const allowIp = createRateLimiter({ rateLimit: options.sessionRateLimit ?? 20 });
  const sessionStore = options.sessionStore ?? (options.redisUrl
    ? createRedisSessionStore(createRedisClientFromUrl(options.redisUrl), options.redisKeyPrefix)
    : null);
  const sessions = new Map<string, SessionRecord>();
  const sessionKey = (tokenDigest: string): string =>
    `${options.redisKeyPrefix ?? "bf:ai-session"}:${tokenDigest}`;

  // One guard per deployment, owned here because this manager is the authority
  // on the license policy: the router reuses this instance for every paid
  // route, so "does this caller hold a verified entitlement?" is answered by
  // one piece of code. `authenticateSession` defers to `authenticate` below
  // (declared later in this scope, only ever called at request time).
  const entitlementGuard =
    options.entitlementGuard ??
    createEntitlementGuard({
      now,
      requireEntitlement: requireLicense,
      publicKeySpki,
      authenticateSession: (req) => authenticate(req),
      bearerTokens: readConfiguredBearerTokens(),
    });

  const prune = (): void => {
    const timestamp = now();
    for (const [key, session] of sessions) if (session.expiresAt <= timestamp) sessions.delete(key);
    while (sessions.size > maxSessions) {
      const oldest = sessions.keys().next().value as string | undefined;
      if (!oldest) break;
      sessions.delete(oldest);
    }
  };

  const createSessionHandler = () => async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "method not allowed" } });
      return;
    }
    if (!hasValidOrigin(req, allowedOrigins, allowMissingOrigin)) {
      sendJson(res, 403, { error: { code: "CSRF_ORIGIN", message: "browser origin is not allowed" } });
      return;
    }
    // The session-creation rate limit keys on the client IP exactly like the
    // proxy handlers. Behind a reverse proxy, the raw socket address is the
    // proxy itself — every user in the deployment would share one bucket.
    if (!allowIp(clientIp(req, trustProxy))) {
      sendJson(res, 429, { error: { code: "RATE_LIMITED", message: "too many session requests" } });
      return;
    }
    // The entitlement is resolved server-side by the shared guard: the router
    // has normally already run it for this route (both go through the same
    // code), and a standalone caller — unit tests, embedded use — falls through
    // to it here. The body belongs to the guard, so it is read exactly once;
    // the client cannot present an opinion, just a proof this server verifies.
    const decision = await resolveEntitlementContext(req, entitlementGuard, "proof", {
      proofLabel: "session proof",
    });
    if (!decision.ok) {
      writeGuardDenial(res, decision.denial);
      return;
    }
    const { context } = decision;
    const identity = context.identity;
    prune();
    if (sessions.size >= maxSessions) {
      sendJson(res, 503, { error: { code: "SESSION_CAPACITY", message: "AI sessions temporarily unavailable" } });
      return;
    }
    const token = randomBytes(32).toString("base64url");
    const csrfToken = randomBytes(32).toString("base64url");
    const createdAt = now();
    const expiresAt = createdAt + ttlMs;
    const record: SessionRecord = {
      tokenDigest: digest(token),
      csrfToken,
      createdAt,
      expiresAt,
      identity,
      ...(context.entitlementExpiresAt !== undefined
        ? { entitlementExpiresAt: context.entitlementExpiresAt }
        : {}),
    };
    if (sessionStore) {
      try {
        await sessionStore.set(sessionKey(record.tokenDigest), JSON.stringify(record), Math.ceil(ttlMs / 1000));
      } catch {
        sendJson(res, 503, { error: { code: "SESSION_STORE_UNAVAILABLE", message: "AI sessions temporarily unavailable" } });
        return;
      }
    }
    sessions.set(record.tokenDigest, record);
    const forwardedProto = req.headers["x-forwarded-proto"];
    const secure = (req.socket as IncomingMessage["socket"] & { encrypted?: boolean }).encrypted === true ||
      (typeof forwardedProto === "string" && forwardedProto.split(",")[0]?.trim() === "https");
    applySecurityHeaders(res);
    const maxAge = Math.floor(ttlMs / 1000);
    res.setHeader("Set-Cookie", [cookieValue(SESSION_COOKIE, token, maxAge, true, secure), cookieValue(CSRF_COOKIE, csrfToken, maxAge, false, secure)]);
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ csrfToken, expiresAt }));
  };

  const authenticate = async (req: IncomingMessage): Promise<AiSessionIdentity | null> => {
    if (!hasValidOrigin(req, allowedOrigins, allowMissingOrigin)) return null;
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies.get(SESSION_COOKIE);
    const csrfCookie = cookies.get(CSRF_COOKIE);
    const csrfHeader = req.headers["x-csrf-token"];
    if (!token || token.length > MAX_TOKEN_LENGTH || !csrfCookie || typeof csrfHeader !== "string") return null;
    const tokenDigest = digest(token);
    let record = sessions.get(tokenDigest) ?? null;
    if (!record && sessionStore) {
      try {
        const raw = await sessionStore.get(sessionKey(tokenDigest));
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<SessionRecord>;
          if (
            parsed.tokenDigest === tokenDigest &&
            typeof parsed.csrfToken === "string" &&
            typeof parsed.createdAt === "number" &&
            typeof parsed.expiresAt === "number" &&
            typeof parsed.identity === "string" &&
            (parsed.entitlementExpiresAt === undefined ||
              typeof parsed.entitlementExpiresAt === "number")
          ) {
            record = parsed as SessionRecord;
            sessions.set(tokenDigest, record);
          }
        }
      } catch {
        return null;
      }
    }
    // A session outlives its license otherwise: the cookie TTL (30 min) and
    // the entitlement expiry are independent, so both must hold.
    const entitlementExpired =
      record !== null &&
      record.entitlementExpiresAt !== undefined &&
      record.entitlementExpiresAt <= now();
    if (!record || record.expiresAt <= now() || entitlementExpired) {
      if (record) {
        sessions.delete(record.tokenDigest);
        if (sessionStore) {
          // Expiry cleanup is best-effort. Authentication must still fail
          // closed, but a transient Redis delete failure must not turn into
          // an unhandled rejection on the request path.
          try {
            await sessionStore.delete(sessionKey(record.tokenDigest));
          } catch {
            // Redis TTL remains the final cleanup mechanism.
          }
        }
      }
      return null;
    }
    const cookieOk = constantTimeEqual(csrfCookie, record.csrfToken);
    const headerOk = constantTimeEqual(csrfHeader, record.csrfToken);
    if (!cookieOk || !headerOk) return null;
    return { identity: record.identity, csrfToken: record.csrfToken };
  };

  return {
    createSessionHandler,
    authenticate,
    prune,
    entitlementGuard,
    licenseEnforced: requireLicense,
    ...(policy.anonymousReason !== null
      ? { anonymousSessionsReason: policy.anonymousReason }
      : {}),
  };
}

function createRedisSessionStore(client: {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode?: string, ttlSeconds?: number): Promise<unknown>;
  del?(key: string): Promise<unknown>;
}, _prefix = "bf:ai-session"): RedisValueStore {
  return {
    get: (key) => client.get(key),
    set: async (key, value, ttlSeconds) => {
      await client.set(key, value, "EX", ttlSeconds);
    },
    delete: async (key) => {
      if (!client.del) throw new Error("Redis DEL is required for AI session expiry cleanup");
      await client.del(key);
    },
  };
}

export { SESSION_COOKIE, CSRF_COOKIE };
