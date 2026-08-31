import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash, createPublicKey, randomBytes, timingSafeEqual, verify } from "node:crypto";
import {
  applySecurityHeaders,
  readBody,
  sendJson,
  createRateLimiter,
  createRedisClientFromUrl,
  clientIp,
  type RedisValueStore,
} from "./ai-proxy";

const SESSION_COOKIE = "bf_ai_session";
const CSRF_COOKIE = "bf_ai_csrf";
const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_SESSIONS = 50_000;
const MAX_TOKEN_LENGTH = 512;
const MAX_PROOF_BYTES = 32 * 1024;
const SESSION_PATH = "/api/services/ai";
const LICENSE_PUBLIC_KEY_SPKI = process.env.LICENSE_PUBLIC_KEY_SPKI ??
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwZzwxnhR4fVnzIp6Tw6867D9t2IgCTHWmNWIm8/JP+W3fbD9QKxepUm5OZL/2lIPHe3eDqJ9j0IayJsVN5jv3R0m0Xdbcn43yow5pY72i+AvuMtFildPrVMYUb9/RjoZttOXST1Ngqd5FfV9kGcUCvt+tEiGE6A1onToY7oe4F1OEBmDA33GIiR0YRWw6D3AVFJSaVPDi3/6HBvorfpQOI2vNDZinO2m6WqZqzK69b1mJFhAwVHPui+bntuz61GB/fPHxt7L4KQ5f+I7b0GYtUyrAMDho2thcqM5bqeHTiH3FytHGGTGi5ZUpeaXKwnyGIh7UOBr9hNL4XEn0oHBsQIDAQAB";

interface SessionRecord {
  tokenDigest: string;
  csrfToken: string;
  createdAt: number;
  expiresAt: number;
  // Deliberately not bound to IP: client addresses can change legitimately
  // behind load balancers, mobile networks, and rotating IPv6 prefixes.
  identity: string;
}

interface LicenseProof {
  payload?: unknown;
  signature?: unknown;
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
  /** Require a client-provided server-signed license state. Defaults on in production. */
  requireLicense?: boolean;
  licensePublicKeySpki?: string;
  sessionRateLimit?: number;
  /** Trust X-Forwarded-For for the session-creation rate limit (mirrors the proxy handlers). */
  trustProxy?: boolean;
}

export interface AiSessionIdentity {
  identity: string;
  csrfToken: string;
}

export interface AiSessionManager {
  createSessionHandler(): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
  authenticate(req: IncomingMessage): Promise<AiSessionIdentity | null>;
  prune(): void;
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
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function digest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function canonicalLicenseJson(payload: Record<string, unknown>): string {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(payload).sort()) {
    if (payload[key] !== undefined) sorted[key] = payload[key];
  }
  return JSON.stringify(sorted);
}

function validLicenseProof(proof: LicenseProof, now: number, publicKeySpki: string): string | null {
  if (typeof proof.signature !== "string" || proof.signature.length < 32 || proof.signature.length > 4096) return null;
  if (typeof proof.payload !== "object" || proof.payload === null || Array.isArray(proof.payload)) return null;
  const payload = proof.payload as Record<string, unknown>;
  if (payload.v !== 1 || typeof payload.deviceId !== "string" || payload.deviceId.length === 0 || payload.deviceId.length > 256) return null;
  if (typeof payload.validatedAt !== "number" || !Number.isFinite(payload.validatedAt)) return null;
  if (payload.validatedAt > now + 5 * 60_000 || payload.validatedAt < now - 30 * 24 * 60 * 60_000) return null;
  if (payload.expiresAt !== undefined &&
      (typeof payload.expiresAt !== "number" || !Number.isFinite(payload.expiresAt) || payload.expiresAt <= now)) return null;
  try {
    const publicKey = createPublicKey({ key: Buffer.from(publicKeySpki, "base64"), format: "der", type: "spki" });
    const valid = verify(
      "sha256",
      Buffer.from(canonicalLicenseJson(payload), "utf8"),
      { key: publicKey, padding: 6, saltLength: 32 },
      Buffer.from(proof.signature, "base64"),
    );
    return valid ? digest(`${payload.deviceId}:${proof.signature}`) : null;
  } catch {
    return null;
  }
}

function requestOrigin(req: IncomingMessage): string | null {
  const origin = req.headers.origin;
  return typeof origin === "string" && origin.length <= 2048 ? origin : null;
}

function expectedOrigin(req: IncomingMessage): string | null {
  const host = req.headers.host;
  if (!host || /[\u0000-\u001f\u007f-\u009f]/.test(host)) return null;
  const forwardedProto = req.headers["x-forwarded-proto"];
  const encrypted = (req.socket as IncomingMessage["socket"] & { encrypted?: boolean }).encrypted === true;
  const protocol = typeof forwardedProto === "string" && forwardedProto.split(",")[0]?.trim() === "https"
    ? "https"
    : encrypted ? "https" : "http";
  return `${protocol}://${host}`;
}

function hasValidOrigin(req: IncomingMessage, allowedOrigins: ReadonlySet<string>, allowMissingOrigin: boolean): boolean {
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
  const requireLicense = options.requireLicense ??
    (process.env.AI_SESSION_REQUIRE_LICENSE !== "0" && process.env.NODE_ENV === "production");
  const publicKeySpki = options.licensePublicKeySpki ?? LICENSE_PUBLIC_KEY_SPKI;
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
    let proof: LicenseProof = {};
    try {
      const raw = await readBody(req);
      if (raw.length > MAX_PROOF_BYTES) throw new Error("proof_too_large");
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) proof = parsed as LicenseProof;
    } catch {
      sendJson(res, 400, { error: { code: "INVALID_REQUEST", message: "session proof is invalid" } });
      return;
    }
    const identity = requireLicense ? validLicenseProof(proof, now(), publicKeySpki) : "anonymous";
    if (!identity) {
      sendJson(res, 401, { error: { code: "LICENSE_REQUIRED", message: "a valid active license is required" } });
      return;
    }
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
            typeof parsed.identity === "string"
          ) {
            record = parsed as SessionRecord;
            sessions.set(tokenDigest, record);
          }
        }
      } catch {
        return null;
      }
    }
    if (!record || record.expiresAt <= now()) {
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
    if (!constantTimeEqual(csrfCookie, record.csrfToken) || !constantTimeEqual(csrfHeader, record.csrfToken)) return null;
    return { identity: record.identity, csrfToken: record.csrfToken };
  };

  return { createSessionHandler, authenticate, prune };
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
