import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { connect as connectNet, type Socket } from "node:net";
import { connect as connectTls } from "node:tls";
import { accessSync, constants as fsConstants, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { AiSessionManager } from "./ai-session";

const DEFAULT_GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const MAX_REQUEST_BODY_BYTES = 256 * 1024;
const MAX_PROMPT_CHARS = 100_000;
const MAX_SYSTEM_PROMPT_CHARS = 50_000;
const MAX_RESPONSE_BODY_CHARS = 1_000_000;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_AUTH_TOKEN_LENGTH = 4_096;
const MODEL_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const REDIS_COMMAND_TIMEOUT_MS = 5_000;
const REDIS_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const REDIS_MAX_BULK_BYTES = 4 * 1024 * 1024;
const REDIS_MAX_ARRAY_ITEMS = 10_000;
const REDIS_MAX_INLINE_BYTES = 64 * 1024;
// Startup hydration across a misbehaving or sharded Redis: bound the SCAN
// enumeration so a stuck cursor cannot hang `init()` forever. Real Redis
// always advances the cursor, so this is purely defensive.
const MAX_SCAN_PAGES = 10_000;
// Per-identity state keys auto-expire after this long without any write, so
// tokens that stop being used cannot accumulate Redis keys forever. Every
// quota increment refreshes the TTL, so active identities keep sliding.
const IDENTITY_TTL_SECONDS = 3 * 24 * 60 * 60;
// Bounded sliding-window of upstream latency samples for the metrics
// histogram — an unbounded array would grow without limit on a long-running
// proxy.
const MAX_LATENCY_SAMPLES = 4_096;

// Coarse per-IP admission floor. This is defense-in-depth against a single
// source flooding the server; the authoritative per-account budget is the
// per-identity policy below, so a distributed flood cannot defeat it by
// rotating source addresses.
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 60;
const MAX_RATE_ENTRIES = 10_000;

// Per-authenticated-identity policy. The identity is the validated bearer
// token (hashed in memory), so every token has an independent budget.
const IDENTITY_RATE_WINDOW_MS = 60_000;
const IDENTITY_RATE_LIMIT = 60;
const IDENTITY_DAILY_QUOTA = 10_000;
const CIRCUIT_BREAKER_THRESHOLD = 5;
const CIRCUIT_BREAKER_COOLDOWN_MS = 30_000;
const MAX_IDENTITY_ENTRIES = 10_000;

interface CircuitBreakerOptions {
  /** Consecutive upstream failures before the breaker opens. */
  threshold?: number | string;
  /** How long the breaker stays open before a half-open probe is allowed. */
  cooldownMs?: number | string;
}

interface GeminiProxyOptions {
  apiKey?: string;
  apiBase?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Per-IP requests per minute (coarse floor). */
  rateLimit?: number;
  /** Single shared deployment token (backward-compatible). */
  authToken?: string;
  /** Additional identity tokens, each with its own budget. */
  authTokens?: string[];
  /** Per-identity requests per minute. */
  identityRateLimit?: number | string;
  /** Per-identity requests per UTC day (global default). */
  dailyQuota?: number | string;
  /**
   * Per-token daily quotas: `{ token: quota }`. Tokens not listed fall back
   * to `dailyQuota` (or the `AI_PROXY_DAILY_QUOTA` env var). Keys are raw
   * bearer tokens; only their SHA-256 hashes are retained by the policy.
   * The comma-separated `AI_PROXY_TOKEN_QUOTAS` env var (`token:limit,pairs`)
   * is merged in with the same semantics.
   */
  identityQuotas?: Record<string, number | string>;
  /**
   * Per-token per-minute rate limits: `{ token: limit }`. Tokens not listed
   * fall back to `identityRateLimit` (or the `AI_PROXY_IDENTITY_RATE_LIMIT`
   * env var). Keys are raw bearer tokens; only their SHA-256 hashes are
   * retained by the policy.
   */
  identityRateLimits?: Record<string, number | string>;
  circuitBreaker?: CircuitBreakerOptions;
  /** Trust X-Forwarded-For only when the reverse proxy is operator-controlled. */
  trustProxy?: boolean;
  /**
   * Persistence for the durable identity state (daily quota + open breaker).
   * Defaults to in-memory unless `AI_PROXY_STATE_FILE` is set.
   */
  stateStore?: ProxyStateStore;
  /**
   * Optional metrics collector. When provided, the handler records counters
   * for requests, breaker events, quota exhaustion, and upstream latency.
   * A GET to `/api/services/ai/metrics` returns Prometheus text format.
   */
  metrics?: ProxyMetrics;
  /**
   * Admin token for the GET /admin diagnostic endpoint. When set, a GET to
   * `/api/services/ai/admin` with `Authorization: Bearer <adminToken>`
   * returns per-identity state (hash, quota, usage, breaker). Without it,
   * the endpoint is disabled (503).
   */
  adminToken?: string;
  /**
   * Redis URL for distributed state sharing between multiple proxy instances.
   * When set (or `AI_PROXY_REDIS_URL` env var), the durable state store uses
   * Redis instead of in-memory or file, so daily quotas and circuit-breaker
   * state are shared across all instances sharing the same Redis key.
   */
  redisUrl?: string;
  /** Same-origin session authenticator. When set, bearer auth is disabled. */
  sessionManager?: AiSessionManager;
  /** Shared admission policy used by text, TTS and image handlers. */
  accessPolicy?: AiAccessPolicy;
  /** Redis errors fail closed by default; fail-open is an explicit trade-off. */
  redisFailureMode?: "fail-open" | "fail-closed";
}

interface GenerateRequest {
  prompt?: unknown;
  systemPrompt?: unknown;
  model?: unknown;
  stream?: unknown;
  responseMimeType?: unknown;
  responseSchema?: unknown;
  tools?: unknown;
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: unknown }> };
    groundingMetadata?: unknown;
  }>;
  error?: { message?: unknown };
}

interface RateWindow {
  count: number;
  windowStart: number;
}

interface IdentityState {
  rateWindow: RateWindow;
  dayKey: string;
  dayCount: number;
  breakerFailures: number;
  breakerOpenedAt: number | null;
  /** True while the single half-open probe is in flight. */
  probeInFlight: boolean;
}

export type PolicyDecision =
  | { allowed: true; probe?: boolean }
  | { allowed: false; status: number; code: string; message: string };

export interface AiAccessPolicy {
  prepare(identity: string): Promise<void>;
  check(identity: string): PolicyDecision;
  reserveQuota(identity: string, bypass?: boolean): Promise<boolean>;
  readonly quotaFailureMode: "fail-open" | "fail-closed";
  recordSuccess(identity: string): void;
  recordFailure(identity: string): void;
  releaseProbe(identity: string): void;
  getStats: () => Array<{
    identity: string;
    configuredDailyQuota: number;
    configuredRateLimit: number;
    dayKey: string;
    dayCount: number;
    breakerFailures: number;
    breakerState: "healthy" | "open" | "half-open";
    probeInFlight: boolean;
  }>;
}

/**
 * Durable per-identity state: the daily-quota counter (with its UTC day key)
 * and the circuit-breaker open state. Transient fields — the per-minute rate
 * window and the in-flight half-open probe latch — are deliberately excluded:
 * they are meaningless across a process restart.
 */
export interface PersistedIdentityState {
  dayKey: string;
  dayCount: number;
  breakerFailures: number;
  breakerOpenedAt: number | null;
}

/**
 * A store for the durable identity state. The default is in-memory (a
 * stateless proxy, the pre-persistence behavior); set `AI_PROXY_STATE_FILE`
 * or pass a custom store to keep daily quotas and an open breaker across
 * process restarts.
 */
export interface ProxyStateStore {
  load(): Record<string, PersistedIdentityState>;
  save(state: Record<string, PersistedIdentityState>): void;
  /**
   * Optional per-identity read. Used by stores that keep per-identity keys
   * (Redis) so the admission policy can merge another instance's counter
   * before applying the quota. Synchronous by contract; implementations
   * return their cached copy (see `refresh` for the async read-through).
   */
  loadIdentity?(identity: string): PersistedIdentityState | null | undefined;
  /**
   * Optional per-identity write; stores that support it avoid clobbering
   * unrelated identities when persisting a single counter update.
   */
  saveIdentity?(identity: string, state: PersistedIdentityState): void;
  /**
   * Optional async read-through for a single identity, called by the
   * handler before each admission check. Lets multi-instance deployments
   * (Redis) converge quota counters across processes.
   */
  refresh?(identity: string): Promise<void>;
  /** Atomically reserve one daily-quota unit when backed by Redis. */
  reserveQuota?(identity: string, dayKey: string, quota: number): Promise<boolean>;
}

/** Concrete contract of the Redis store: it implements every optional hook. */
export interface RedisStateStore extends ProxyStateStore {
  init(): Promise<void>;
  loadIdentity(identity: string): PersistedIdentityState | null;
  saveIdentity(identity: string, state: PersistedIdentityState): void;
  refresh(identity: string): Promise<void>;
  reserveQuota(identity: string, dayKey: string, quota: number): Promise<boolean>;
}

/** In-memory store — the default; resets when the process restarts. */
export function createMemoryStateStore(): ProxyStateStore {
  let data: Record<string, PersistedIdentityState> = {};
  return {
    load: () => ({ ...data }),
    save: (state) => {
      data = { ...state };
    },
  };
}

/**
 * Atomic JSON-file store. Writes go to `<file>.tmp` and are renamed over the
 * target, so a crash mid-write cannot corrupt the persisted state. A missing
 * or corrupt file loads as empty (fail-open): the proxy keeps serving and the
 * affected budgets resume from zero rather than bricking the endpoint.
 */
export function validateStateFilePath(filePath: string): void {
  const directory = filePath.replace(/[\\/][^\\/]*$/, "") || ".";
  try {
    accessSync(directory, fsConstants.W_OK);
  } catch (error) {
    throw new Error(
      `[ai-proxy] AI_PROXY_STATE_FILE directory is not writable: ${directory}`,
      { cause: error },
    );
  }
}

export function createFileStateStore(filePath: string): ProxyStateStore {
  validateStateFilePath(filePath);
  return {
    load(): Record<string, PersistedIdentityState> {
      try {
        const raw = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
        if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
        const out: Record<string, PersistedIdentityState> = {};
        for (const [key, value] of Object.entries(raw)) {
          if (typeof value !== "object" || value === null) continue;
          const entry = value as Record<string, unknown>;
          const dayCount = Math.floor(Number(entry.dayCount));
          const breakerFailures = Math.floor(Number(entry.breakerFailures));
          const breakerOpenedAt =
            entry.breakerOpenedAt === null || entry.breakerOpenedAt === undefined
              ? null
              : Math.floor(Number(entry.breakerOpenedAt));
          if (!Number.isFinite(dayCount) || dayCount < 0) continue;
          if (!Number.isFinite(breakerFailures) || breakerFailures < 0) continue;
          if (breakerOpenedAt !== null && !Number.isFinite(breakerOpenedAt)) continue;
          out[key] = {
            dayKey: typeof entry.dayKey === "string" ? entry.dayKey : "",
            dayCount,
            breakerFailures,
            breakerOpenedAt,
          };
        }
        return out;
      } catch {
        // Missing or corrupt state file: start fresh (fail-open).
        return {};
      }
    },
    save(state): void {
      try {
        const tmp = `${filePath}.tmp`;
        writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
        renameSync(tmp, filePath);
      } catch (error) {
        // Persistence is best-effort: a disk failure must never fail a
        // legitimate AI request. The operator is warned so a misconfigured
        // store surfaces in the server logs.
        console.error(
          `[ai-proxy] failed to persist state to ${filePath}:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    },
  };
}

/**
 * A minimal Redis-compatible client interface. Pass any object with `get`
 * and `set` methods (ioredis, redis, or a custom wrapper). No Redis
 * dependency is bundled — the caller provides the client.
 */
export interface RedisLikeClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode?: string, ttlSeconds?: number): Promise<unknown>;
  del?(key: string): Promise<unknown>;
  /** Optional cursor-based enumeration for startup state hydration. */
  scan?(cursor: string, pattern: string, count?: number): Promise<{ cursor: string; keys: string[] }>;
  /** Optional EVAL support used for atomic quota reservation. */
  eval?(script: string, keys: string[], args: string[]): Promise<unknown>;
}

/** Minimal distributed value store used by AI session authentication. */
export interface RedisValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Create a Redis client for shared state consumers without bundling a dependency. */
export interface RedisClientOptions {
  commandTimeoutMs?: number;
  maxResponseBytes?: number;
}

export function createRedisClientFromUrl(
  redisUrl: string,
  options: RedisClientOptions = {},
): RedisLikeClient {
  const parsed = new URL(redisUrl);
  if (parsed.protocol !== "redis:" && parsed.protocol !== "rediss:") {
    throw new Error(`[ai-proxy] unsupported Redis URL scheme: ${parsed.protocol}`);
  }
  const host = parsed.hostname || "127.0.0.1";
  const port = Number(parsed.port || 6379);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`[ai-proxy] invalid Redis port: ${parsed.port}`);
  }
  const password = parsed.password ? decodeURIComponent(parsed.password) : undefined;
  const database = parsed.pathname.length > 1 ? Number(parsed.pathname.slice(1)) : 0;
  if (!Number.isInteger(database) || database < 0) throw new Error("[ai-proxy] invalid Redis database");

  const commandTimeoutMs = Math.max(100, Math.min(options.commandTimeoutMs ?? REDIS_COMMAND_TIMEOUT_MS, 120_000));
  const maxResponseBytes = Math.max(64 * 1024, Math.min(options.maxResponseBytes ?? REDIS_MAX_RESPONSE_BYTES, 64 * 1024 * 1024));
  let socket: Socket | null = null;
  let buffer = Buffer.alloc(0);
  let connecting: Promise<Socket> | null = null;
  type PendingCommand = {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  };
  let pending: PendingCommand[] = [];

  const closeSocket = (error: Error): void => {
    const current = pending;
    pending = [];
    const active = socket;
    socket = null;
    buffer = Buffer.alloc(0);
    active?.destroy();
    for (const item of current) {
      clearTimeout(item.timer);
      item.reject(error);
    }
  };
  const rejectPending = (error: Error): void => {
    const current = pending;
    pending = [];
    for (const item of current) {
      clearTimeout(item.timer);
      item.reject(error);
    }
  };
  const protocolError = (message: string): Error => new Error(`[ai-proxy] ${message}`);
  type ParsedReply = { value: unknown; next: number; error?: boolean } | null;
  const parseReplyAt = (offset: number): ParsedReply => {
    if (offset >= buffer.length) return null;
    const lineEnd = buffer.indexOf("\r\n", offset);
    if (lineEnd < 0) {
      if (buffer.length - offset > REDIS_MAX_INLINE_BYTES) throw protocolError("Redis response line is too large");
      return null;
    }
    const prefix = buffer[offset];
    if (prefix === 36) {
      const length = Number(buffer.subarray(offset + 1, lineEnd).toString());
      if (length === -1) return { value: null, next: lineEnd + 2 };
      if (!Number.isInteger(length) || length < 0 || length > REDIS_MAX_BULK_BYTES || length > maxResponseBytes) {
        throw protocolError("Redis bulk response is too large or invalid");
      }
      const end = lineEnd + 2 + length + 2;
      if (buffer.length < end) return null;
      if (buffer[end - 2] !== 13 || buffer[end - 1] !== 10) throw protocolError("invalid Redis bulk terminator");
      return { value: buffer.subarray(lineEnd + 2, lineEnd + 2 + length).toString(), next: end };
    }
    if (prefix === 43 || prefix === 45 || prefix === 58) {
      const value = buffer.subarray(offset + 1, lineEnd).toString();
      if (Buffer.byteLength(value) > REDIS_MAX_INLINE_BYTES) throw protocolError("Redis response line is too large");
      if (prefix === 58 && !/^-?\d+$/.test(value)) throw protocolError("invalid Redis integer response");
      return {
        value: prefix === 58 ? Number(value) : value,
        next: lineEnd + 2,
        ...(prefix === 45 ? { error: true } : {}),
      };
    }
    if (prefix === 42) {
      const count = Number(buffer.subarray(offset + 1, lineEnd).toString());
      if (!Number.isInteger(count) || count < 0 || count > REDIS_MAX_ARRAY_ITEMS) {
        throw protocolError("invalid Redis array length");
      }
      const values: unknown[] = [];
      let cursor = lineEnd + 2;
      for (let i = 0; i < count; i += 1) {
        const parsedReply = parseReplyAt(cursor);
        if (!parsedReply) return null;
        if (parsedReply.error) return parsedReply;
        values.push(parsedReply.value);
        cursor = parsedReply.next;
      }
      return { value: values, next: cursor };
    }
    throw protocolError("invalid Redis response");
  };
  const parseReply = (): unknown | undefined => {
    const parsedReply = parseReplyAt(0);
    if (!parsedReply) return undefined;
    buffer = buffer.subarray(parsedReply.next);
    if (parsedReply.error) throw new Error(String(parsedReply.value));
    return parsedReply.value;
  };
  const commandOnSocket = (target: Socket, parts: string[]): Promise<unknown> => new Promise((resolve, reject) => {
    const payload = Buffer.from(`*${parts.length}\r\n${parts.map((part) => `$${Buffer.byteLength(part)}\r\n${part}\r\n`).join("")}`);
    const timer = setTimeout(() => {
      closeSocket(protocolError(`Redis command timed out after ${commandTimeoutMs}ms`));
    }, commandTimeoutMs);
    pending.push({ resolve, reject, timer });
    if (!target.write(payload)) target.once("drain", () => undefined);
  });
  const ensure = async (): Promise<Socket> => {
    if (socket && !socket.destroyed) return socket;
    if (connecting) return connecting;
    connecting = new Promise<Socket>((resolve, reject) => {
      const candidate = (parsed.protocol === "rediss:" ? connectTls({ host, port }) : connectNet({ host, port })) as Socket;
      socket = candidate;
      candidate.on("data", (chunk) => {
        if (buffer.length + chunk.length > maxResponseBytes) {
          closeSocket(protocolError("Redis response exceeds the configured limit"));
          return;
        }
        buffer = Buffer.concat([buffer, chunk]);
        while (pending.length) {
          try {
            const value = parseReply();
            if (value === undefined) break;
            const item = pending.shift()!;
            clearTimeout(item.timer);
            item.resolve(value);
          } catch (error) {
            closeSocket(error instanceof Error ? error : new Error(String(error)));
            break;
          }
        }
      });
      candidate.on("error", (error) => {
        if (connecting) reject(error);
        rejectPending(error instanceof Error ? error : new Error(String(error)));
      });
      candidate.on("close", () => {
        if (socket === candidate) socket = null;
        rejectPending(new Error("Redis connection closed"));
      });
      candidate.once("connect", () => {
        void (async () => {
          if (password) await commandOnSocket(candidate, ["AUTH", password]);
          if (database) await commandOnSocket(candidate, ["SELECT", String(database)]);
          resolve(candidate);
        })().catch((error: unknown) => {
          closeSocket(error instanceof Error ? error : new Error(String(error)));
          reject(error);
        });
      });
    }).finally(() => {
      connecting = null;
    });
    return await connecting;
  };
  const commandOnce = async (parts: string[]): Promise<unknown> => {
    const target = await ensure();
    return commandOnSocket(target, parts);
  };
  /**
   * Execute one command, transparently reconnecting once when the connection
   * dropped before a reply arrived. `retryOnDrop: false` opts out for
   * non-idempotent commands (EVAL with server-side INCR): a reply dropped
   * after Redis executed the script must not run it a second time, which
   * would double-charge the quota counter.
   */
  const command = async (parts: string[], { retryOnDrop = true }: { retryOnDrop?: boolean } = {}): Promise<unknown> => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await commandOnce(parts);
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        if (retryOnDrop && attempt === 0 && /Redis connection closed|timed out|ECONNRESET|EPIPE|socket hang up|connection reset|Not running/i.test(message)) {
          continue;
        }
        throw error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  };
  return {
    get: async (key: string) => {
      const value = await command(["GET", key]);
      return typeof value === "string" ? value : null;
    },
    set: async (key: string, value: string, mode?: string, ttlSeconds?: number) => {
      const parts = ["SET", key, value];
      if (mode && ttlSeconds !== undefined) parts.push(mode, String(ttlSeconds));
      await command(parts);
    },
    del: async (key: string) => { await command(["DEL", key]); },
    scan: async (cursor: string, pattern: string, count = 100) => {
      const value = await command(["SCAN", cursor, "MATCH", pattern, "COUNT", String(count)]);
      if (!Array.isArray(value) || value.length !== 2) throw new Error("[ai-proxy] invalid Redis SCAN response");
      const nextCursor = typeof value[0] === "string" || typeof value[0] === "number" ? String(value[0]) : "";
      const keys = Array.isArray(value[1])
        ? value[1].filter((entry): entry is string => typeof entry === "string")
        : [];
      if (nextCursor === "" || !Array.isArray(value[1])) throw new Error("[ai-proxy] invalid Redis SCAN result");
      return { cursor: nextCursor, keys };
    },
    eval: async (script: string, keys: string[], args: string[]) => command(["EVAL", script, String(keys.length), ...keys, ...args], { retryOnDrop: false }),
  } satisfies RedisLikeClient;
}

/**
 * Redis-backed durable state store. Shares daily quotas and circuit-breaker
 * state across multiple instances. Each identity lives under its own key
 * (`<keyPrefix>:identity:<sha256(identity)>`) so a single-instance write
 * never clobbers another identity's counters; the legacy single-key form
 * (`<keyPrefix>:state`, pre-multi-key deployments) is still read on init.
 *
 * Design: read-through cache. The in-process Map is always up-to-date
 * (satisfying the synchronous `ProxyStateStore.load()` contract). Reads
 * round-trip Redis at startup via `init()`; per-identity refreshes are
 * served by `refresh()` (called by the handler before each admission
 * check), and writes update the local cache immediately and fire-and-forget
 * the identity key to Redis so every other instance converges on its next
 * refresh.
 *
 * Fail-open: Redis errors are caught and logged; the proxy keeps serving
 * with whatever state it has in memory. Corrupt or absent Redis payloads
 * seed an empty map.
 */
export function createRedisStateStore(
  client: RedisLikeClient,
  options: { keyPrefix?: string } = {},
): RedisStateStore {
  const prefix = options.keyPrefix ?? "bf:ai-proxy";
  const legacyKey = `${prefix}:state`;
  // The identity is already a SHA-256 hex digest of the bearer token, so it
  // is safe to use directly as a Redis key suffix — and it must be, so the
  // store can map a scanned key back to the identity without reversing a
  // second hash.
  const identityRedisKey = (identity: string): string => `${prefix}:identity:${identity}`;
  let cache: Record<string, PersistedIdentityState> = {};
  let initialized = false;

  function parseEntry(raw: string | null): PersistedIdentityState | null {
    if (!raw) return null;
    try {
      const entry = JSON.parse(raw) as unknown;
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return null;
      const record = entry as Record<string, unknown>;
      const dayCount = Math.floor(Number(record.dayCount));
      const breakerFailures = Math.floor(Number(record.breakerFailures));
      const breakerOpenedAt =
        record.breakerOpenedAt === null || record.breakerOpenedAt === undefined
          ? null
          : Math.floor(Number(record.breakerOpenedAt));
      if (!Number.isFinite(dayCount) || dayCount < 0) return null;
      if (!Number.isFinite(breakerFailures) || breakerFailures < 0) return null;
      if (breakerOpenedAt !== null && !Number.isFinite(breakerOpenedAt)) return null;
      return {
        dayKey: typeof record.dayKey === "string" ? record.dayKey : "",
        dayCount,
        breakerFailures,
        breakerOpenedAt,
      };
    } catch {
      return null;
    }
  }

  function parseMap(raw: string | null): Record<string, PersistedIdentityState> {
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
      const out: Record<string, PersistedIdentityState> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v !== "object" || v === null) continue;
        const entry = v as Record<string, unknown>;
        const dayCount = Math.floor(Number(entry.dayCount));
        const breakerFailures = Math.floor(Number(entry.breakerFailures));
        const breakerOpenedAt =
          entry.breakerOpenedAt === null || entry.breakerOpenedAt === undefined
            ? null
            : Math.floor(Number(entry.breakerOpenedAt));
        if (!Number.isFinite(dayCount) || dayCount < 0) continue;
        if (!Number.isFinite(breakerFailures) || breakerFailures < 0) continue;
        if (breakerOpenedAt !== null && !Number.isFinite(breakerOpenedAt)) continue;
        out[k] = {
          dayKey: typeof entry.dayKey === "string" ? entry.dayKey : "",
          dayCount,
          breakerFailures,
          breakerOpenedAt,
        };
      }
      return out;
    } catch {
      return {};
    }
  }

  const logFailure = (action: string, error: unknown): void => {
    console.error(
      `[ai-proxy] failed to ${action} state in Redis:`,
      error instanceof Error ? error.message : String(error),
    );
  };

  async function loadAll(): Promise<Record<string, PersistedIdentityState>> {
    const merged: Record<string, PersistedIdentityState> = {};
    try {
      // Legacy single-key snapshot from pre-per-identity-key deployments.
      Object.assign(merged, parseMap(await client.get(legacyKey)));
    } catch (error) {
      logFailure("load legacy", error);
    }
    if (client.scan) {
      try {
        const identityPrefix = `${prefix}:identity:`;
        let cursor = "0";
        let pages = 0;
        do {
          const page = await client.scan(cursor, `${identityPrefix}*`, 100);
          // A real Redis SCAN always advances its cursor; a server that
          // returns the same non-zero cursor forever would hang this loop.
          // Bail out (state hydrates lazily via refresh()) instead. The
          // first page legitimately returns "0" (empty keyspace), so only
          // a repeated non-zero cursor is treated as stuck.
          if (page.cursor === cursor && cursor !== "0") break;
          cursor = page.cursor;
          const entries = await Promise.all(
            page.keys.map(async (key) => {
              try {
                return { key, raw: await client.get(key) };
              } catch (error) {
                logFailure("load identity", error);
                return { key, raw: null };
              }
            }),
          );
          for (const { key, raw } of entries) {
            const entry = parseEntry(raw);
            if (entry && key.startsWith(identityPrefix)) {
              merged[key.slice(identityPrefix.length)] = entry;
            }
          }
          pages += 1;
        } while (cursor !== "0" && pages < MAX_SCAN_PAGES);
      } catch (error) {
        logFailure("scan identities", error);
      }
    }
    return merged;
  }

  const setIdentity = (identity: string, entry: PersistedIdentityState): void => {
    cache[identity] = entry;
    initialized = true;
    // Bound Redis retention: the key expires after IDENTITY_TTL_SECONDS of
    // inactivity (every quota write renews it), so identities that stop
    // being used do not accumulate keys forever.
    client.set(identityRedisKey(identity), JSON.stringify(entry), "EX", IDENTITY_TTL_SECONDS).catch((error) => {
      logFailure("persist", error);
    });
  };

  return {
    /**
     * Seed the local cache from Redis (legacy key + per-identity keys).
     * Safe to call multiple times; re-reads everything each time.
     */
    async init(): Promise<void> {
      cache = await loadAll();
      initialized = true;
    },

    load(): Record<string, PersistedIdentityState> {
      // First call before init() completes: return empty (fail-open).
      // After init(), return the seeded cache.
      if (!initialized) return {};
      return { ...cache };
    },

    save(state): void {
      cache = { ...cache, ...state };
      initialized = true;
      for (const [identity, entry] of Object.entries(state)) {
        setIdentity(identity, entry);
      }
    },

    loadIdentity(identity: string): PersistedIdentityState | null {
      return cache[identity] ?? null;
    },

    saveIdentity(identity: string, entry: PersistedIdentityState): void {
      setIdentity(identity, entry);
    },

    async refresh(identity: string): Promise<void> {
      try {
        const raw = await client.get(identityRedisKey(identity));
        const entry = parseEntry(raw);
        if (entry) {
          cache[identity] = entry;
        }
        initialized = true;
      } catch (error) {
        logFailure("refresh", error);
      }
    },

    async reserveQuota(identity: string, dayKey: string, quota: number): Promise<boolean> {
      if (!client.eval) {
        throw new Error("Redis EVAL is required for atomic AI quota reservation");
      }
      const key = `${prefix}:quota:${identity}:${dayKey}`;
      const result = await client.eval(
        "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],172800) end; if n>tonumber(ARGV[1]) then redis.call('DECR',KEYS[1]); return 0 end; return 1",
        [key],
        [String(quota)],
      );
      return Number(result) === 1;
    },
  };
}

/**
 * Prometheus-compatible metrics collector for the AI proxy. All values are
 * in-process counters; they reset on restart. Secrets (API keys, tokens)
 * are never exposed.
 */
export interface ProxyMetrics {
  requestsTotal: number;
  requestsByStatus: Map<number, number>;
  breakerOpens: number;
  breakerProbes: number;
  breakerProbeSuccesses: number;
  breakerProbeReleases: number;
  quotaExhausted: number;
  rateLimited: number;
  upstreamLatencyMs: number[];
  upstreamRequests: number;
}

export function createMetricsCollector(): ProxyMetrics {
  return {
    requestsTotal: 0,
    requestsByStatus: new Map(),
    breakerOpens: 0,
    breakerProbes: 0,
    breakerProbeSuccesses: 0,
    breakerProbeReleases: 0,
    quotaExhausted: 0,
    rateLimited: 0,
    upstreamLatencyMs: [],
    upstreamRequests: 0,
  };
}

function renderPrometheusMetrics(m: ProxyMetrics): string {
  const lines: string[] = [];
  const push = (name: string, help: string, type: string, value: string): void => {
    lines.push(`# HELP ${name} ${help}`);
    lines.push(`# TYPE ${name} ${type}`);
    lines.push(`${name} ${value}`);
  };

  push("bf_ai_proxy_requests_total", "Total proxy requests", "counter", String(m.requestsTotal));
  for (const [status, count] of m.requestsByStatus) {
    lines.push(`bf_ai_proxy_requests_total{status="${status}"} ${count}`);
  }
  push("bf_ai_proxy_breaker_opens_total", "Circuit breaker open events", "counter", String(m.breakerOpens));
  push("bf_ai_proxy_breaker_probes_total", "Half-open probes admitted", "counter", String(m.breakerProbes));
  push("bf_ai_proxy_breaker_probe_successes_total", "Half-open probes that closed the circuit", "counter", String(m.breakerProbeSuccesses));
  push("bf_ai_proxy_breaker_probe_releases_total", "Probes released before upstream (body reject, abort)", "counter", String(m.breakerProbeReleases));
  push("bf_ai_proxy_quota_exhausted_total", "Daily quota rejections", "counter", String(m.quotaExhausted));
  push("bf_ai_proxy_rate_limited_total", "Rate limit rejections (IP + identity)", "counter", String(m.rateLimited));
  push("bf_ai_proxy_upstream_requests_total", "Upstream requests attempted", "counter", String(m.upstreamRequests));

  // Latency histogram (buckets in ms)
  if (m.upstreamLatencyMs.length > 0) {
    const sorted = [...m.upstreamLatencyMs].sort((a, b) => a - b);
    const buckets = [50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000];
    let cumulative = 0;
    for (const boundary of buckets) {
      while (cumulative < sorted.length && sorted[cumulative]! <= boundary) cumulative++;
      lines.push(`bf_ai_proxy_upstream_latency_ms_bucket{le="${boundary}"} ${cumulative}`);
    }
    lines.push(`bf_ai_proxy_upstream_latency_ms_bucket{le="+Inf"} ${sorted.length}`);
    const sum = sorted.reduce((a, b) => a + b, 0);
    lines.push(`bf_ai_proxy_upstream_latency_ms_sum ${sum}`);
    lines.push(`bf_ai_proxy_upstream_latency_ms_count ${sorted.length}`);
  }

  return lines.join("\n") + "\n";
}

/** Clamp a raw config value (env string or option number) to a safe integer. */
export function readBoundedInteger(
  raw: string | number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) return fallback;
  return n;
}

export function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.length > 0) {
      const first = forwarded.split(",")[0]?.trim();
      if (first && first.length <= 128) return first;
    }
    const realIp = req.headers["x-real-ip"];
    if (typeof realIp === "string" && realIp.length > 0 && realIp.length <= 128) {
      return realIp.trim();
    }
  }
  return req.socket.remoteAddress ?? "unknown";
}

/** Extract a well-formed bearer token, or null when absent/malformed. */
export function readBearerToken(req: IncomingMessage): string | null {
  const authorization = req.headers.authorization;
  if (typeof authorization !== "string" || !/^Bearer [^\s]+$/.test(authorization)) {
    return null;
  }
  const token = authorization.slice("Bearer ".length);
  if (
    !token ||
    token.length > MAX_AUTH_TOKEN_LENGTH ||
    /[\u0000-\u001f\u007f-\u009f]/.test(token)
  ) {
    return null;
  }
  return token;
}

/**
 * Compare a presented token against every configured identity token without
 * early-exiting, so the comparison time does not reveal which identity (if
 * any) matched.
 */
export function matchesAnyToken(actual: string, expected: ReadonlySet<string>): boolean {
  const actualBytes = Buffer.from(actual, "utf8");
  let matched = false;
  for (const exp of expected) {
    const expectedBytes = Buffer.from(exp, "utf8");
    if (
      expectedBytes.length === actualBytes.length &&
      timingSafeEqual(expectedBytes, actualBytes)
    ) {
      matched = true;
    }
  }
  return matched;
}

/** Memory key for per-identity state; never retains the raw token. */
export function identityKey(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Tokens shipped as documented dry-run defaults. Accepting any of them in a
 * production process would let anyone who read the docs spend the operator's
 * AI budget, so the proxy refuses to start with them.
 */
const KNOWN_INSECURE_TOKENS = new Set([
  "local-prod-token",
  "ai-mock-key",
  "license-mock-key",
  "proxy-secret",
  "change-me",
]);
const MIN_PRODUCTION_TOKEN_LENGTH = 16;

/**
 * Fail-fast startup guard for production: the AI proxy refuses to boot with
 * a weak/default bearer token or an http:// upstream base, so a production
 * operator cannot silently deploy with the documented dry-run defaults.
 * Non-production environments (dev/test/staging) are unaffected.
 */
export function assertProductionProxyConfig(
  configuredTokens: ReadonlySet<string>,
  apiBase: string,
): void {
  if (process.env.NODE_ENV !== "production") return;
  for (const token of configuredTokens) {
    if (token.length < MIN_PRODUCTION_TOKEN_LENGTH || KNOWN_INSECURE_TOKENS.has(token)) {
      throw new Error(
        "[ai-proxy] refusing to start in production: AI_PROXY_AUTH_TOKEN must be a unique secret of at least 16 characters, not a documented default",
      );
    }
  }
  let parsed: URL;
  try {
    parsed = new URL(apiBase);
  } catch {
    throw new Error(
      "[ai-proxy] refusing to start in production: GEMINI_API_BASE is not a valid URL",
    );
  }
  if (parsed.protocol !== "https:") {
    throw new Error(
      "[ai-proxy] refusing to start in production: GEMINI_API_BASE must use https://",
    );
  }
}

export function applySecurityHeaders(res: ServerResponse): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), geolocation=(), microphone=(), interest-cohort=()");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  );
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.writableEnded) return;
  applySecurityHeaders(res);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

export function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;

    const cleanup = (): void => {
      req.removeListener("data", onData);
      req.removeListener("end", onEnd);
      req.removeListener("error", onError);
      req.removeListener("aborted", onAborted);
    };
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onData = (chunk: Buffer): void => {
      size += chunk.length;
      if (size > MAX_REQUEST_BODY_BYTES) {
        req.resume();
        fail(new Error("body_too_large"));
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(Buffer.concat(chunks).toString("utf8"));
    };
    const onError = (): void => fail(new Error("request_aborted"));
    const onAborted = (): void => fail(new Error("request_aborted"));

    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
    req.on("aborted", onAborted);
  });
}

function extractText(body: GeminiResponse): string {
  return (body.candidates?.[0]?.content?.parts ?? [])
    .map((part) => typeof part.text === "string" ? part.text : "")
    .join("");
}

function normalizeModel(value: unknown): string {
  const raw = typeof value === "string" && value.length > 0
    ? value.replace(/^models\//, "")
    : "gemini-2.0-flash";
  return MODEL_PATTERN.test(raw) ? raw : "";
}

function buildGeminiBody(input: GenerateRequest): Record<string, unknown> | null {
  if (typeof input.prompt !== "string" || input.prompt.length === 0 || input.prompt.length > MAX_PROMPT_CHARS) {
    return null;
  }
  if (input.systemPrompt !== undefined &&
      (typeof input.systemPrompt !== "string" || input.systemPrompt.length > MAX_SYSTEM_PROMPT_CHARS)) {
    return null;
  }

  const body: Record<string, unknown> = {
    contents: [{
      role: "user",
      parts: [{ text: input.prompt }],
    }],
  };
  if (typeof input.systemPrompt === "string" && input.systemPrompt.length > 0) {
    body.systemInstruction = { parts: [{ text: input.systemPrompt }] };
  }
  const generationConfig: Record<string, unknown> = {};
  if (typeof input.responseMimeType === "string") {
    generationConfig.responseMimeType = input.responseMimeType.slice(0, 128);
  }
  if (input.responseSchema && typeof input.responseSchema === "object") {
    generationConfig.responseSchema = input.responseSchema;
  }
  if (Object.keys(generationConfig).length > 0) {
    body.generationConfig = generationConfig;
  }
  if (Array.isArray(input.tools)) {
    body.tools = input.tools;
  }
  return body;
}

function pruneRateWindows(rateWindows: Map<string, RateWindow>, now: number): void {
  const cutoff = now - RATE_WINDOW_MS;
  while (rateWindows.size > 0) {
    const oldest = rateWindows.entries().next().value as
      | [string, RateWindow]
      | undefined;
    if (!oldest || oldest[1].windowStart >= cutoff) break;
    rateWindows.delete(oldest[0]);
  }
}

export function createRateLimiter(options: { now?: () => number; rateLimit?: number }): (ip: string) => boolean {
  const rateWindows = new Map<string, RateWindow>();
  const now = options.now ?? Date.now;
  const limit = options.rateLimit ?? RATE_LIMIT;
  return (ip: string): boolean => {
    const current = now();
    pruneRateWindows(rateWindows, current);
    const window = rateWindows.get(ip);
    if (!window || current - window.windowStart >= RATE_WINDOW_MS) {
      if (!window && rateWindows.size >= MAX_RATE_ENTRIES) return false;
      rateWindows.set(ip, { count: 1, windowStart: current });
      return true;
    }
    if (window.count >= limit) return false;
    window.count += 1;
    return true;
  };
}

function utcDayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * Per-identity admission policy: circuit breaker, per-minute rate limit, and
 * per-day quota. State is keyed by the identity hash; the breaker tracks
 * consecutive upstream failures and transitions closed → open → half-open.
 * The half-open probe is single-flight: only one request is admitted per
 * cooldown and every concurrent request is rejected until that probe
 * resolves (a success closes the breaker, a failure re-opens it) — a
 * recovery burst cannot slip through as simultaneous "probes".
 */
export function createIdentityPolicy(
  options: Pick<GeminiProxyOptions, "identityRateLimit" | "dailyQuota" | "circuitBreaker" | "now"> & {
    store?: ProxyStateStore;
    /** State-store initialization barrier shared by all AI modalities. */
    ready?: Promise<void>;
    quotaFailureMode?: "fail-open" | "fail-closed";
    /** Per-identity daily quotas keyed by identity hash; unlisted identities use `dailyQuota`. */
    identityQuotas?: ReadonlyMap<string, number>;
    /** Per-identity per-minute rate limits keyed by identity hash; unlisted identities use `identityRateLimit`. */
    identityRateLimits?: ReadonlyMap<string, number>;
    /**
     * Optional metrics collector; the policy increments the breaker counters
     * at the moment the transitions happen (open, probe success, probe
     * release) so the Prometheus counters never stay zero.
     */
    metrics?: ProxyMetrics;
  },
): AiAccessPolicy {
  const states = new Map<string, IdentityState>();
  const now = options.now ?? Date.now;
  const dailyQuota = readBoundedInteger(options.dailyQuota, IDENTITY_DAILY_QUOTA, 1, 100_000_000);
  const identityQuotas = options.identityQuotas ?? new Map<string, number>();
  const identityRateLimits = options.identityRateLimits ?? new Map<string, number>();
  const globalRateLimit = readBoundedInteger(options.identityRateLimit, IDENTITY_RATE_LIMIT, 1, 1_000_000);
  const threshold = readBoundedInteger(options.circuitBreaker?.threshold, CIRCUIT_BREAKER_THRESHOLD, 1, 1_000);
  const cooldownMs = readBoundedInteger(options.circuitBreaker?.cooldownMs, CIRCUIT_BREAKER_COOLDOWN_MS, 1, 86_400_000);
  const store = options.store ?? createMemoryStateStore();
  const ready = options.ready ?? Promise.resolve();
  const metrics = options.metrics ?? null;

  // Seed from the persisted snapshot; transient fields (rate window, probe
  // latch) always start fresh after a restart.
  for (const [identity, persisted] of Object.entries(store.load())) {
    states.set(identity, {
      rateWindow: { count: 0, windowStart: 0 },
      dayKey: persisted.dayKey,
      dayCount: persisted.dayCount,
      breakerFailures: persisted.breakerFailures,
      breakerOpenedAt: persisted.breakerOpenedAt,
      probeInFlight: false,
    });
  }

  /**
   * Write the durable projection to the store. Entries with no outstanding
   * quota and a healthy breaker are pruned, so the file does not grow with
   * one-time identities. Called synchronously on every durable transition,
   * so the file is up to date before the response is sent — a crash right
   * after a request cannot lose its quota increment. Stores that support
   * per-identity writes (Redis) also persist just the touched identity so
   * concurrent instances never clobber unrelated counters.
   */
  const persist = (identity: string): void => {
    const durable: Record<string, PersistedIdentityState> = {};
    for (const [id, s] of states) {
      if (s.dayCount > 0 || s.breakerFailures > 0 || s.breakerOpenedAt !== null) {
        durable[id] = {
          dayKey: s.dayKey,
          dayCount: s.dayCount,
          breakerFailures: s.breakerFailures,
          breakerOpenedAt: s.breakerOpenedAt,
        };
      }
    }
    store.save(durable);
    const entry = durable[identity];
    if (entry && store.saveIdentity) {
      store.saveIdentity(identity, entry);
    }
  };

  const state = (identity: string): IdentityState | null => {
    let s = states.get(identity);
    if (!s) {
      if (states.size >= MAX_IDENTITY_ENTRIES) return null; // fail closed
      s = {
        rateWindow: { count: 0, windowStart: 0 },
        dayKey: "",
        dayCount: 0,
        breakerFailures: 0,
        breakerOpenedAt: null,
        probeInFlight: false,
      };
      states.set(identity, s);
    }
    return s;
  };

  return {
    quotaFailureMode: options.quotaFailureMode ?? "fail-closed",

    async prepare(identity: string): Promise<void> {
      await ready;
      if (store.refresh) await store.refresh(identity);
    },

    async reserveQuota(identity: string, bypass = false): Promise<boolean> {
      const s = state(identity);
      if (!s || bypass) return Boolean(s);
      const current = now();
      const dayKey = utcDayKey(current);
      if (s.dayKey !== dayKey) {
        s.dayKey = dayKey;
        s.dayCount = 0;
      }
      const quota = identityQuotas.get(identity) ?? dailyQuota;
      if (store.reserveQuota) {
        const reserved = await store.reserveQuota(identity, dayKey, quota);
        if (reserved) s.dayCount += 1;
        return reserved;
      }
      if (s.dayCount >= quota) return false;
      s.dayCount += 1;
      persist(identity);
      return true;
    },

    check(identity: string): PolicyDecision {
      const current = now();
      const s = state(identity);
      if (!s) {
        return { allowed: false, status: 429, code: "RATE_LIMITED", message: "too many identities" };
      }

      // Merge durable state observed by another instance (Redis read-through
      // cache refreshed by the handler before this call). Only ever adopt
      // larger counters so a stale local copy cannot roll a quota back.
      const persisted = store.loadIdentity?.(identity);
      if (persisted) {
        if (persisted.dayKey === utcDayKey(current) && persisted.dayCount > s.dayCount) {
          s.dayKey = persisted.dayKey;
          s.dayCount = persisted.dayCount;
        }
        if (persisted.breakerFailures > s.breakerFailures) {
          s.breakerFailures = persisted.breakerFailures;
        }
        if (
          persisted.breakerOpenedAt !== null &&
          (s.breakerOpenedAt === null || persisted.breakerOpenedAt > s.breakerOpenedAt)
        ) {
          s.breakerOpenedAt = persisted.breakerOpenedAt;
        }
      }

      // Daily quota rollover on the UTC date boundary.
      const dayKey = utcDayKey(current);
      if (s.dayKey !== dayKey) {
        s.dayKey = dayKey;
        s.dayCount = 0;
      }

      // Circuit breaker: reject fast while open. Once the cooldown elapses,
      // admit a SINGLE half-open probe; while it is in flight every other
      // request is rejected so a burst cannot pass as concurrent probes.
      if (s.probeInFlight) {
        return { allowed: false, status: 503, code: "CIRCUIT_OPEN", message: "AI provider is temporarily unavailable" };
      }
      if (s.breakerOpenedAt !== null) {
        if (current - s.breakerOpenedAt < cooldownMs) {
          return { allowed: false, status: 503, code: "CIRCUIT_OPEN", message: "AI provider is temporarily unavailable" };
        }
        // Cooldown elapsed — admit the single probe. It bypasses the
        // per-identity rate/quota budgets (it is a controlled health check,
        // not billable traffic) and is released by recordSuccess/
        // recordFailure, or by the handler when the request is rejected
        // before reaching the upstream.
        s.breakerOpenedAt = null;
        s.probeInFlight = true;
        return { allowed: true, probe: true };
      }

      // Per-identity minute window — per-token override when configured,
      // otherwise the global per-identity default.
      const identityRateLimit = identityRateLimits.get(identity) ?? globalRateLimit;
      if (!s.rateWindow.windowStart || current - s.rateWindow.windowStart >= IDENTITY_RATE_WINDOW_MS) {
        s.rateWindow = { count: 1, windowStart: current };
      } else if (s.rateWindow.count >= identityRateLimit) {
        return { allowed: false, status: 429, code: "RATE_LIMITED", message: "too many requests" };
      } else {
        s.rateWindow.count += 1;
      }

      // The daily quota is reserved by the handler after circuit/rate
      // admission. Redis-backed stores perform that reservation atomically.
      return { allowed: true };
    },

    recordSuccess(identity: string): void {
      const s = states.get(identity);
      if (!s) return;
      const wasProbe = s.probeInFlight;
      s.breakerFailures = 0;
      s.breakerOpenedAt = null;
      s.probeInFlight = false;
      if (wasProbe && metrics) metrics.breakerProbeSuccesses += 1;
      persist(identity);
    },

    recordFailure(identity: string): void {
      const s = states.get(identity);
      if (!s) return;
      s.breakerFailures += 1;
      s.probeInFlight = false;
      if (s.breakerFailures >= threshold && s.breakerOpenedAt === null) {
        s.breakerOpenedAt = now();
        if (metrics) metrics.breakerOpens += 1;
      }
      persist(identity);
    },

    releaseProbe(identity: string): void {
      const s = states.get(identity);
      if (!s) return;
      if (s.probeInFlight) {
        s.probeInFlight = false;
        if (metrics) metrics.breakerProbeReleases += 1;
      }
    },

    getStats() {
      const current = now();
      return Array.from(states.entries()).map(([id, s]) => ({
        identity: id,
        configuredDailyQuota: identityQuotas.get(id) ?? dailyQuota,
        configuredRateLimit: identityRateLimits.get(id) ?? globalRateLimit,
        dayKey: s.dayKey,
        dayCount: s.dayCount,
        breakerFailures: s.breakerFailures,
        breakerState: s.probeInFlight
          ? ("half-open" as const)
          : s.breakerOpenedAt !== null
            ? (current - s.breakerOpenedAt < cooldownMs ? ("open" as const) : ("half-open" as const))
            : ("healthy" as const),
        probeInFlight: s.probeInFlight,
      }));
    },
  };
}

async function readUpstreamJson(response: Response): Promise<GeminiResponse | null> {
  const length = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(length) && length > MAX_RESPONSE_BODY_CHARS) return null;
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BODY_CHARS) return null;
  try {
    return JSON.parse(text) as GeminiResponse;
  } catch {
    return null;
  }
}

function extractStreamText(payload: GeminiResponse): string {
  return extractText(payload);
}

/** Returns true when the stream completed cleanly; false when it failed. */
async function pipeGeminiStream(
  response: Response,
  res: ServerResponse,
  requestSignal: AbortSignal,
): Promise<{ completed: boolean; clientAborted: boolean }> {
  const reader = response.body?.getReader();
  if (!reader) {
    sendJson(res, 502, { error: { code: "UPSTREAM", message: "AI provider stream unavailable" } });
    return { completed: false, clientAborted: requestSignal.aborted };
  }

  applySecurityHeaders(res);
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const decoder = new TextDecoder();
  let buffer = "";
  let failed = false;
  try {
    while (!requestSignal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > MAX_RESPONSE_BODY_CHARS) {
        throw new Error("upstream_stream_too_large");
      }
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (!raw || raw === "[DONE]") continue;
        try {
          const payload = JSON.parse(raw) as GeminiResponse;
          const text = extractStreamText(payload);
          if (text) {
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
          }
        } catch {
          // Ignore malformed upstream event data; never forward provider error
          // bodies or arbitrary bytes to the browser.
        }
      }
    }
    if (!res.writableEnded) {
      res.write("data: [DONE]\n\n");
      res.end();
    }
  } catch {
    failed = true;
    if (!res.writableEnded) res.destroy();
  } finally {
    try { await reader.cancel(); } catch { /* best effort */ }
    reader.releaseLock?.();
  }
  return { completed: !failed, clientAborted: requestSignal.aborted };
}

export function createGeminiProxyHandler(options: GeminiProxyOptions = {}) {
  const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_GEMINI_API_KEY ?? "";
  const apiBase = (options.apiBase ?? process.env.GEMINI_API_BASE ?? DEFAULT_GEMINI_API_BASE).replace(/\/+$/, "");
  const trustProxy = options.trustProxy ??
    (process.env.TRUST_PROXY === "1" || process.env.TRUST_PROXY === "true");
  const fetchImpl = options.fetchImpl ?? fetch;

  // Identity tokens: a single shared token (backward-compatible) plus an
  // optional comma-separated list for multi-tenant deployments.
  const configuredTokens = new Set<string>();
  for (const token of [options.authToken, ...(options.authTokens ?? [])]) {
    if (typeof token === "string" && token.length > 0) configuredTokens.add(token);
  }
  for (const token of (process.env.AI_PROXY_AUTH_TOKEN ?? "").split(",")) {
    if (token.trim()) configuredTokens.add(token.trim());
  }
  for (const token of (process.env.AI_PROXY_AUTH_TOKENS ?? "").split(",")) {
    if (token.trim()) configuredTokens.add(token.trim());
  }
  assertProductionProxyConfig(configuredTokens, apiBase);

  const ipRateLimit = readBoundedInteger(
    options.rateLimit ?? process.env.AI_PROXY_IP_RATE_LIMIT,
    RATE_LIMIT,
    1,
    1_000_000,
  );
  const allowIp = createRateLimiter({ now: options.now, rateLimit: ipRateLimit });

  // Per-token daily quotas: the `{ token: quota }` option plus the
  // comma-separated `token:limit` env form (`AI_PROXY_TOKEN_QUOTAS`). Only
  // identity hashes reach the policy — raw tokens are never retained.
  // Unlisted tokens fall back to the global dailyQuota at check time.
  const identityQuotas = new Map<string, number>();
  const rawQuotaTokens = new Set<string>();
  {
    const rawQuotas = new Map<string, number | string>();
    for (const [token, quota] of Object.entries(options.identityQuotas ?? {})) {
      if (token.length > 0) rawQuotas.set(token, quota);
    }
    for (const pair of (process.env.AI_PROXY_TOKEN_QUOTAS ?? "").split(",")) {
      const sep = pair.indexOf(":");
      if (sep <= 0) continue;
      const token = pair.slice(0, sep).trim();
      const raw = pair.slice(sep + 1).trim();
      if (token.length === 0 || raw === "") continue;
      rawQuotas.set(token, raw);
    }
    for (const [token, quota] of rawQuotas) {
      rawQuotaTokens.add(token);
      identityQuotas.set(
        identityKey(token),
        readBoundedInteger(quota, IDENTITY_DAILY_QUOTA, 1, 100_000_000),
      );
    }
  }

  // Per-token per-minute rate limits: the `{ token: limit }` option plus the
  // comma-separated `token:limit` env form (`AI_PROXY_TOKEN_RATE_LIMITS`).
  // Only identity hashes reach the policy — raw tokens are never retained.
  // Unlisted tokens fall back to the global identityRateLimit at check time.
  const identityRateLimits = new Map<string, number>();
  const rawRateLimitTokens = new Set<string>();
  {
    const rawLimits = new Map<string, number | string>();
    for (const [token, limit] of Object.entries(options.identityRateLimits ?? {})) {
      if (token.length > 0) rawLimits.set(token, limit);
    }
    for (const pair of (process.env.AI_PROXY_TOKEN_RATE_LIMITS ?? "").split(",")) {
      const sep = pair.indexOf(":");
      if (sep <= 0) continue;
      const token = pair.slice(0, sep).trim();
      const raw = pair.slice(sep + 1).trim();
      if (token.length === 0 || raw === "") continue;
      rawLimits.set(token, raw);
    }
    for (const [token, limit] of rawLimits) {
      rawRateLimitTokens.add(token);
      identityRateLimits.set(
        identityKey(token),
        readBoundedInteger(limit, IDENTITY_RATE_LIMIT, 1, 1_000_000),
      );
    }
  }

  // ── Startup validation: orphaned quota/rate-limit tokens ────────────
  // Tokens listed in AI_PROXY_TOKEN_QUOTAS or AI_PROXY_TOKEN_RATE_LIMITS
  // that are NOT in the configured auth set can never authenticate, so their
  // quotas/limits are dead config. Warn loudly so the operator can fix the
  // mismatch instead of wondering why a token "has a limit" but never hits it.
  {
    const allConfigured = new Set(configuredTokens);
    for (const token of rawQuotaTokens) {
      if (!allConfigured.has(token)) {
        console.warn(
          `[ai-proxy] WARNING: AI_PROXY_TOKEN_QUOTAS contains a token that is not in AI_PROXY_AUTH_TOKENS — quota for "${token.slice(0, 8)}…${token.slice(-4)}" will never be enforced (token cannot authenticate)`,
        );
      }
    }
    for (const token of rawRateLimitTokens) {
      if (!allConfigured.has(token)) {
        console.warn(
          `[ai-proxy] WARNING: AI_PROXY_TOKEN_RATE_LIMITS contains a token that is not in AI_PROXY_AUTH_TOKENS — rate limit for "${token.slice(0, 8)}…${token.slice(-4)}" will never be enforced (token cannot authenticate)`,
        );
      }
    }
  }

  // Durable state (daily quota + open breaker) survives restarts only when a
  // store is configured; otherwise the proxy stays stateless as before.
  // Priority: explicit stateStore > Redis (AI_PROXY_REDIS_URL) > file > memory.
  const redisUrl = options.redisUrl ?? process.env.AI_PROXY_REDIS_URL ?? "";
  const stateFile = process.env.AI_PROXY_STATE_FILE?.trim();
  if (stateFile && !options.stateStore && !redisUrl) {
    // Fail hard at construction/startup: silently falling back to memory would
    // make quota and breaker state disappear after a restart.
    validateStateFilePath(stateFile);
  }
  const redisFailureMode = options.redisFailureMode ??
    (process.env.AI_PROXY_REDIS_FAILURE_MODE === "fail-open" ? "fail-open" : "fail-closed");
  const stateStore = options.stateStore
    ?? (redisUrl
      ? createRedisStateStore(createRedisClientFromUrl(redisUrl))
      : stateFile
        ? createFileStateStore(stateFile)
        : createMemoryStateStore());

  // Redis-backed stores need a startup seed before the first admission
  // check, otherwise the first requests would run against an empty quota
  // snapshot. Resolved lazily on the first request so file/memory stores
  // (no init) are untouched.
  const stateStoreReady =
    (stateStore as { init?: () => Promise<void> }).init?.() ?? Promise.resolve();

  const metrics = options.metrics ?? null;

  // Append one upstream latency sample, keeping a bounded sliding window so
  // the histogram render cannot grow without limit.
  const recordUpstreamLatency = (ms: number): void => {
    if (!metrics) return;
    const samples = metrics.upstreamLatencyMs;
    samples.push(ms);
    if (samples.length > MAX_LATENCY_SAMPLES) {
      samples.splice(0, samples.length - MAX_LATENCY_SAMPLES);
    }
  };

  // Admin token: a separate credential for the diagnostic endpoint so that
  // AI generation tokens cannot escalate to read identity budgets.
  const adminToken = options.adminToken ?? process.env.AI_PROXY_ADMIN_TOKEN ?? "";

  const identityPolicy: AiAccessPolicy = options.accessPolicy ?? createIdentityPolicy({
    identityRateLimit: options.identityRateLimit ?? process.env.AI_PROXY_IDENTITY_RATE_LIMIT,
    dailyQuota: options.dailyQuota ?? process.env.AI_PROXY_DAILY_QUOTA,
    identityQuotas,
    identityRateLimits,
    circuitBreaker: options.circuitBreaker ?? {
      threshold: process.env.AI_PROXY_CIRCUIT_BREAKER_THRESHOLD,
      cooldownMs: process.env.AI_PROXY_CIRCUIT_BREAKER_COOLDOWN_MS,
    },
    now: options.now,
    store: stateStore,
    ready: stateStoreReady,
    quotaFailureMode: redisFailureMode,
    metrics: metrics ?? undefined,
  });

  const handleGeminiProxy = async function handleGeminiProxy(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    // GET /metrics — Prometheus text format. No secrets exposed, but the
    // counters reveal traffic patterns, so gate them behind the same
    // credentials as /admin (admin token, or any configured generation
    // token) instead of leaving them world-readable.
    const pathname = req.url ? new URL(req.url, "http://localhost").pathname : "";
    if (req.method === "GET" && pathname === "/api/services/ai/metrics" && metrics) {
      if (!adminToken && configuredTokens.size === 0) {
        sendJson(res, 503, { error: { code: "METRICS_DISABLED", message: "metrics endpoint is not configured" } });
        return;
      }
      // Accept both the legacy x-admin-token header and a standard
      // Authorization: Bearer <token> (the documented contract).
      const legacyHeader = req.headers["x-admin-token"];
      const bearerHeader = (() => {
        const auth = req.headers.authorization;
        if (typeof auth === "string" && /^Bearer [^\s]+$/.test(auth)) {
          return auth.slice("Bearer ".length);
        }
        return undefined;
      })();
      const presented = typeof legacyHeader === "string" ? legacyHeader : bearerHeader;
      const adminValid = (() => {
        if (!adminToken || typeof presented !== "string") return false;
        const adminTokenBytes = Buffer.from(adminToken, "utf8");
        const headerBytes = Buffer.from(presented, "utf8");
        return headerBytes.length === adminTokenBytes.length && timingSafeEqual(adminTokenBytes, headerBytes);
      })();
      const tokenValid = typeof bearerHeader === "string" && matchesAnyToken(bearerHeader, configuredTokens);
      if (!presented || (!adminValid && !tokenValid)) {
        sendJson(res, 401, { error: { code: "UNAUTHORIZED", message: "metrics token required" } });
        return;
      }
      applySecurityHeaders(res);
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(renderPrometheusMetrics(metrics));
      return;
    }

    // GET /admin — per-identity diagnostic snapshot. Requires a separate
    // admin token so AI generation tokens cannot escalate to read budgets.
    // Identity hashes are exposed (not raw tokens) so the operator can
    // correlate with logs without revealing secrets.
    if (req.method === "GET" && pathname === "/api/services/ai/admin") {
      if (!adminToken) {
        sendJson(res, 503, { error: { code: "ADMIN_DISABLED", message: "admin endpoint is not configured" } });
        return;
      }
      // Accept both the legacy x-admin-token header and a standard
      // Authorization: Bearer <adminToken> (the documented contract).
      const legacyHeader = req.headers["x-admin-token"];
      const bearerHeader = (() => {
        const auth = req.headers.authorization;
        if (typeof auth === "string" && /^Bearer [^\s]+$/.test(auth)) {
          return auth.slice("Bearer ".length);
        }
        return undefined;
      })();
      const adminHeader = typeof legacyHeader === "string" ? legacyHeader : bearerHeader;
      const adminTokenBytes = Buffer.from(adminToken, "utf8");
      const headerBytes = typeof adminHeader === "string" ? Buffer.from(adminHeader, "utf8") : null;
      const adminValid = headerBytes !== null && headerBytes.length === adminTokenBytes.length && timingSafeEqual(adminTokenBytes, headerBytes);
      if (!adminValid) {
        sendJson(res, 401, { error: { code: "UNAUTHORIZED", message: "admin token required" } });
        return;
      }
      const stats = identityPolicy.getStats();
      applySecurityHeaders(res);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ identities: stats }));
      return;
    }

    if (req.method !== "POST") {
      sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "method not allowed" } });
      return;
    }
    if (metrics) metrics.requestsTotal += 1;
    if (!apiKey || (!options.sessionManager && configuredTokens.size === 0)) {
      sendJson(res, 503, { error: { code: "NOT_CONFIGURED", message: "AI proxy is not configured" } });
      return;
    }

    const session = options.sessionManager ? await options.sessionManager.authenticate(req) : null;
    const token = session ? null : readBearerToken(req);
    if (!session && (!token || !matchesAnyToken(token, configuredTokens))) {
      sendJson(res, 401, { error: { code: "UNAUTHORIZED", message: "AI proxy authentication required" } });
      return;
    }
    const identity = session?.identity ?? identityKey(token!);

    // The shared policy refreshes durable state before every modality.
    await identityPolicy.prepare(identity);

    // Coarse per-IP floor first (cheap), then the authoritative per-identity
    // budget including the circuit breaker. Authenticated malformed requests
    // intentionally consume this minute-rate admission slot as abuse defense;
    // daily quota is reserved only after the body passes full validation.
    if (!allowIp(clientIp(req, trustProxy))) {
      if (metrics) { metrics.rateLimited += 1; metrics.requestsByStatus.set(429, (metrics.requestsByStatus.get(429) ?? 0) + 1); }
      sendJson(res, 429, { error: { code: "RATE_LIMITED", message: "too many requests" } });
      return;
    }
    const decision = identityPolicy.check(identity);
    if (!decision.allowed) {
      if (metrics) {
        metrics.requestsByStatus.set(decision.status, (metrics.requestsByStatus.get(decision.status) ?? 0) + 1);
        if (decision.code === "RATE_LIMITED") metrics.rateLimited += 1;
        if (decision.code === "QUOTA_EXCEEDED") metrics.quotaExhausted += 1;
        if (decision.code === "CIRCUIT_OPEN" && decision.status === 503) {
          // Only count breaker rejections that are not probe-related
        }
      }
      sendJson(res, decision.status, {
        error: { code: decision.code, message: decision.message },
      });
      return;
    }
    if (metrics && decision.probe) metrics.breakerProbes += 1;

    // If this request is the single half-open probe, release the latch on
    // every path that ends before the upstream call — otherwise a probe
    // rejected by body validation would leave the breaker stuck half-open.
    const releaseProbe = (): void => {
      if (decision.probe) identityPolicy.releaseProbe(identity);
    };

    let rawBody: string;
    try {
      rawBody = await readBody(req);
    } catch (error) {
      releaseProbe();
      sendJson(res, error instanceof Error && error.message === "body_too_large" ? 413 : 400, {
        error: { code: "INVALID_REQUEST", message: "request body is invalid or too large" },
      });
      return;
    }

    let input: GenerateRequest;
    try {
      input = JSON.parse(rawBody) as GenerateRequest;
    } catch {
      releaseProbe();
      sendJson(res, 400, { error: { code: "INVALID_REQUEST", message: "malformed JSON" } });
      return;
    }
    const body = buildGeminiBody(input);
    const model = normalizeModel(input.model);
    if (!body || !model) {
      releaseProbe();
      sendJson(res, 400, { error: { code: "INVALID_REQUEST", message: "prompt, systemPrompt, or model is invalid" } });
      return;
    }

    // Reserve quota only after the complete request body has been read and
    // validated. Invalid or oversized requests must not consume daily budget.
    try {
      const quotaReserved = await identityPolicy.reserveQuota(identity, decision.probe === true);
      if (!quotaReserved) {
        identityPolicy.releaseProbe(identity);
        if (metrics) {
          metrics.quotaExhausted += 1;
          metrics.requestsByStatus.set(429, (metrics.requestsByStatus.get(429) ?? 0) + 1);
        }
        sendJson(res, 429, { error: { code: "QUOTA_EXCEEDED", message: "daily quota exceeded" } });
        return;
      }
    } catch (error) {
      identityPolicy.releaseProbe(identity);
      if (redisFailureMode === "fail-open") {
        console.error("[ai-proxy] quota store unavailable; continuing in explicit fail-open mode", error instanceof Error ? error.message : String(error));
      } else {
        sendJson(res, 503, { error: { code: "QUOTA_UNAVAILABLE", message: "AI quota service temporarily unavailable" } });
        return;
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const onAborted = (): void => controller.abort();
    req.once("aborted", onAborted);
    try {
      const endpoint = `${apiBase}/${encodeURIComponent(model)}:${input.stream === true ? "streamGenerateContent?alt=sse" : "generateContent"}`;
      if (metrics) metrics.upstreamRequests += 1;
      const upstreamStart = performance.now();
      const upstream = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!upstream.ok) {
        recordUpstreamLatency(performance.now() - upstreamStart);
        identityPolicy.recordFailure(identity);
        await upstream.body?.cancel();
        const status = upstream.status === 429 ? 429 : 502;
        if (metrics) metrics.requestsByStatus.set(status, (metrics.requestsByStatus.get(status) ?? 0) + 1);
        sendJson(res, status, {
          error: { code: status === 429 ? "RATE_LIMITED" : "UPSTREAM", message: "AI provider request failed" },
        });
        return;
      }
      if (input.stream === true) {
        const streamed = await pipeGeminiStream(upstream, res, controller.signal);
        recordUpstreamLatency(performance.now() - upstreamStart);
        if (streamed.completed) {
          identityPolicy.recordSuccess(identity);
          if (metrics) { metrics.requestsByStatus.set(200, (metrics.requestsByStatus.get(200) ?? 0) + 1); }
        } else if (streamed.clientAborted || req.aborted || !res.writable || res.destroyed) {
          // The caller closed the response/request. This is not evidence that
          // Gemini failed, so do not increment the circuit-breaker failure
          // counter or turn a user cancellation into an outage.
          if (metrics) { metrics.requestsByStatus.set(499, (metrics.requestsByStatus.get(499) ?? 0) + 1); }
        } else {
          identityPolicy.recordFailure(identity);
          if (metrics) { metrics.requestsByStatus.set(502, (metrics.requestsByStatus.get(502) ?? 0) + 1); }
        }
        return;
      }
      const payload = await readUpstreamJson(upstream);
      recordUpstreamLatency(performance.now() - upstreamStart);
      const text = payload ? extractText(payload) : "";
      if (!payload || !text) {
        identityPolicy.recordFailure(identity);
        if (metrics) { metrics.requestsByStatus.set(502, (metrics.requestsByStatus.get(502) ?? 0) + 1); }
        sendJson(res, 502, { error: { code: "UPSTREAM", message: "AI provider returned no text" } });
        return;
      }
      identityPolicy.recordSuccess(identity);
      if (metrics) { metrics.requestsByStatus.set(200, (metrics.requestsByStatus.get(200) ?? 0) + 1); }
      sendJson(res, 200, {
        text,
        groundingMetadata: payload.candidates?.[0]?.groundingMetadata,
      });
    } catch (error) {
      // A client disconnect aborts the controller too. It is not an upstream
      // failure: do not poison the breaker with user cancellations or a
      // response socket that has already been closed.
      const clientAborted = req.aborted || controller.signal.aborted && (res.destroyed || !res.writable);
      if (!clientAborted) {
        identityPolicy.recordFailure(identity);
      }
      if (!res.writableEnded && !res.destroyed && res.writable) {
        const errStatus = error instanceof Error && error.name === "AbortError" ? 504 : 502;
        if (metrics) { metrics.requestsByStatus.set(errStatus, (metrics.requestsByStatus.get(errStatus) ?? 0) + 1); }
        sendJson(res, errStatus, {
          error: { code: "UPSTREAM", message: "AI provider request failed" },
        });
      }
    } finally {
      clearTimeout(timeout);
      req.removeListener("aborted", onAborted);
      releaseProbe();
    }
  };
  type GeminiProxyHandler = typeof handleGeminiProxy & { accessPolicy: AiAccessPolicy };
  return Object.assign(handleGeminiProxy, { accessPolicy: identityPolicy }) as GeminiProxyHandler;
}
