import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { connect as connectNet, type Socket } from "node:net";
import { connect as connectTls } from "node:tls";
import { accessSync, constants as fsConstants } from "node:fs";

const MAX_REQUEST_BODY_BYTES = 256 * 1024;
const MAX_AUTH_TOKEN_LENGTH = 4_096;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 60;
const MAX_RATE_ENTRIES = 10_000;

export interface RedisValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode?: string, ttlSeconds?: number): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface RedisClientOptions {
  commandTimeoutMs?: number;
  maxResponseBytes?: number;
}

export function createRedisClientFromUrl(
  redisUrl: string,
  options: RedisClientOptions = {},
): RedisValueStore & { scan?: (cursor: string, pattern: string, count?: number) => Promise<{ cursor: string; keys: string[] }>; eval?: (script: string, keys: string[], args: string[]) => Promise<unknown> } {
  const parsed = new URL(redisUrl);
  if (parsed.protocol !== "redis:" && parsed.protocol !== "rediss:") {
    throw new Error(`[proxy-utils] unsupported Redis URL scheme: ${parsed.protocol}`);
  }
  const host = parsed.hostname || "127.0.0.1";
  const port = Number(parsed.port || 6379);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`[proxy-utils] invalid Redis port: ${parsed.port}`);
  }
  const password = parsed.password ? decodeURIComponent(parsed.password) : undefined;
  const database = parsed.pathname.length > 1 ? Number(parsed.pathname.slice(1)) : 0;
  if (!Number.isInteger(database) || database < 0) throw new Error("[proxy-utils] invalid Redis database");

  const commandTimeoutMs = Math.max(100, Math.min(options.commandTimeoutMs ?? 5_000, 120_000));
  const maxResponseBytes = Math.max(64 * 1024, Math.min(options.maxResponseBytes ?? 8 * 1024 * 1024, 64 * 1024 * 1024));
  let socket: Socket | null = null;
  let buffer = Buffer.alloc(0);
  let connecting: Promise<Socket> | null = null;
  type PendingCommand = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
  let pending: PendingCommand[] = [];

  const closeSocket = (error: Error): void => {
    const current = pending;
    pending = [];
    const active = socket;
    socket = null;
    buffer = Buffer.alloc(0);
    active?.destroy();
    for (const item of current) { clearTimeout(item.timer); item.reject(error); }
  };
  const rejectPending = (error: Error): void => {
    const current = pending;
    pending = [];
    for (const item of current) { clearTimeout(item.timer); item.reject(error); }
  };
  const protocolError = (message: string): Error => new Error(`[proxy-utils] ${message}`);
  type ParsedReply = { value: unknown; next: number; error?: boolean } | null;
  const parseReplyAt = (offset: number): ParsedReply => {
    if (offset >= buffer.length) return null;
    const lineEnd = buffer.indexOf("\r\n", offset);
    if (lineEnd < 0) {
      if (buffer.length - offset > 64 * 1024) throw protocolError("Redis response line is too large");
      return null;
    }
    const prefix = buffer[offset];
    if (prefix === 36) {
      const length = Number(buffer.subarray(offset + 1, lineEnd).toString());
      if (length === -1) return { value: null, next: lineEnd + 2 };
      if (!Number.isInteger(length) || length < 0 || length > 4 * 1024 * 1024 || length > maxResponseBytes) {
        throw protocolError("Redis bulk response is too large or invalid");
      }
      const end = lineEnd + 2 + length + 2;
      if (buffer.length < end) return null;
      if (buffer[end - 2] !== 13 || buffer[end - 1] !== 10) throw protocolError("invalid Redis bulk terminator");
      return { value: buffer.subarray(lineEnd + 2, lineEnd + 2 + length).toString(), next: end };
    }
    if (prefix === 43 || prefix === 45 || prefix === 58) {
      const value = buffer.subarray(offset + 1, lineEnd).toString();
      if (Buffer.byteLength(value) > 64 * 1024) throw protocolError("Redis response line is too large");
      if (prefix === 58 && !/^-?\d+$/.test(value)) throw protocolError("invalid Redis integer response");
      return { value: prefix === 58 ? Number(value) : value, next: lineEnd + 2, ...(prefix === 45 ? { error: true } : {}) };
    }
    if (prefix === 42) {
      const count = Number(buffer.subarray(offset + 1, lineEnd).toString());
      if (!Number.isInteger(count) || count < 0 || count > 10_000) throw protocolError("invalid Redis array length");
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
    const timer = setTimeout(() => { closeSocket(protocolError(`Redis command timed out after ${commandTimeoutMs}ms`)); }, commandTimeoutMs);
    pending.push({ resolve, reject, timer });
    target.write(payload);
  });
  const ensure = async (): Promise<Socket> => {
    if (socket && !socket.destroyed) return socket;
    if (connecting) return connecting;
    connecting = new Promise<Socket>((resolve, reject) => {
      const candidate = (parsed.protocol === "rediss:" ? connectTls({ host, port }) : connectNet({ host, port })) as Socket;
      socket = candidate;
      candidate.on("data", (chunk: Buffer) => {
        if (buffer.length + chunk.length > maxResponseBytes) { closeSocket(protocolError("Redis response exceeds the configured limit")); return; }
        buffer = Buffer.concat([buffer, chunk]);
        while (pending.length) {
          try {
            const value = parseReply();
            if (value === undefined) break;
            const item = pending.shift()!;
            clearTimeout(item.timer);
            item.resolve(value);
          } catch (error) { closeSocket(error instanceof Error ? error : new Error(String(error))); break; }
        }
      });
      candidate.on("error", (error: Error) => { if (connecting) reject(error); closeSocket(error instanceof Error ? error : new Error(String(error))); });
      candidate.on("close", () => { if (socket === candidate) socket = null; rejectPending(new Error("Redis connection closed")); });
      candidate.once("connect", () => {
        void (async () => { if (password) await commandOnSocket(candidate, ["AUTH", password]); if (database) await commandOnSocket(candidate, ["SELECT", String(database)]); resolve(candidate); })().catch((error: unknown) => { closeSocket(error instanceof Error ? error : new Error(String(error))); reject(error); });
      });
    }).finally(() => { connecting = null; });
    return await connecting;
  };
  const commandOnce = async (parts: string[]): Promise<unknown> => { const target = await ensure(); return commandOnSocket(target, parts); };
  const command = async (parts: string[], { retryOnDrop = true }: { retryOnDrop?: boolean } = {}): Promise<unknown> => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try { return await commandOnce(parts); } catch (error) { lastError = error; const message = error instanceof Error ? error.message : String(error); if (retryOnDrop && attempt === 0 && /Redis connection closed|timed out|ECONNRESET|EPIPE|socket hang up|connection reset|Not running/i.test(message)) { continue; } throw error; }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  };
  return {
    get: async (key: string) => { const value = await command(["GET", key]); return typeof value === "string" ? value : null; },
    set: async (key: string, value: string, mode?: string, ttlSeconds?: number) => { const parts = ["SET", key, value]; if (mode && ttlSeconds !== undefined) parts.push(mode, String(ttlSeconds)); await command(parts); },
    delete: async (key: string) => { await command(["DEL", key]); },
    scan: async (cursor: string, pattern: string, count = 100) => { const value = await command(["SCAN", cursor, "MATCH", pattern, "COUNT", String(count)]); if (!Array.isArray(value) || value.length !== 2) throw new Error("[proxy-utils] invalid Redis SCAN response"); const nextCursor = typeof value[0] === "string" || typeof value[0] === "number" ? String(value[0]) : ""; const keys = Array.isArray(value[1]) ? value[1].filter((entry: unknown): entry is string => typeof entry === "string") : []; if (nextCursor === "" || !Array.isArray(value[1])) throw new Error("[proxy-utils] invalid Redis SCAN result"); return { cursor: nextCursor, keys }; },
    eval: async (script: string, keys: string[], args: string[]) => command(["EVAL", script, String(keys.length), ...keys, ...args], { retryOnDrop: false }),
  } as RedisValueStore & { scan?: (cursor: string, pattern: string, count?: number) => Promise<{ cursor: string; keys: string[] }>; eval?: (script: string, keys: string[], args: string[]) => Promise<unknown> };
}

export function readBoundedInteger(raw: string | number | undefined, fallback: number, min: number, max: number): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) return fallback;
  return n;
}

export function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.length > 0) { const first = forwarded.split(",")[0]?.trim(); if (first && first.length <= 128) return first; }
    const realIp = req.headers["x-real-ip"];
    if (typeof realIp === "string" && realIp.length > 0 && realIp.length <= 128) return realIp.trim();
  }
  return req.socket.remoteAddress ?? "unknown";
}

export function readBearerToken(req: IncomingMessage): string | null {
  const authorization = req.headers.authorization;
  if (typeof authorization !== "string" || !/^Bearer [^\s]+$/.test(authorization)) return null;
  const token = authorization.slice("Bearer ".length);
  if (!token || token.length > MAX_AUTH_TOKEN_LENGTH || /[\u0000-\u001f\u007f-\u009f]/.test(token)) return null;
  return token;
}

export function matchesAnyToken(actual: string, expected: ReadonlySet<string>): boolean {
  const actualBytes = Buffer.from(actual, "utf8");
  let matched = false;
  for (const exp of expected) { const expectedBytes = Buffer.from(exp, "utf8"); if (expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes)) { matched = true; } }
  return matched;
}

export function identityKey(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function readConfiguredBearerTokens(options: { authToken?: string; authTokens?: readonly string[] } = {}, env: NodeJS.ProcessEnv = process.env): Set<string> {
  const tokens = new Set<string>();
  for (const token of [options.authToken, ...(options.authTokens ?? [])]) { if (typeof token === "string" && token.length > 0) tokens.add(token); }
  for (const token of (env.AI_PROXY_AUTH_TOKEN ?? "").split(",")) { if (token.trim()) tokens.add(token.trim()); }
  for (const token of (env.AI_PROXY_AUTH_TOKENS ?? "").split(",")) { if (token.trim()) tokens.add(token.trim()); }
  return tokens;
}

export function assertProductionProxyConfig(configuredTokens: ReadonlySet<string>, apiBase: string): void {
  if (process.env.NODE_ENV !== "production") return;
  for (const token of configuredTokens) { if (token.length < 16 || new Set(["local-prod-token","ai-mock-key","license-mock-key","proxy-secret","change-me"]).has(token)) { throw new Error("[proxy-utils] refusing to start in production: AI_PROXY_AUTH_TOKEN must be a unique secret of at least 16 characters, not a documented default"); } }
  let parsed: URL;
  try { parsed = new URL(apiBase); } catch { throw new Error("[proxy-utils] refusing to start in production: GEMINI_API_BASE is not a valid URL"); }
  if (parsed.protocol !== "https:") { throw new Error("[proxy-utils] refusing to start in production: GEMINI_API_BASE must use https://"); }
}

export function applySecurityHeaders(res: ServerResponse): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), geolocation=(), microphone=(), interest-cohort=()");
  res.setHeader("Content-Security-Policy", "default-src 'none'; base-uri 'none'; frame-ancestors 'none'");
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
    const cleanup = (): void => { req.removeListener("data", onData); req.removeListener("end", onEnd); req.removeListener("error", onError); req.removeListener("aborted", onAborted); };
    const fail = (error: Error): void => { if (settled) return; settled = true; cleanup(); reject(error); };
    const onData = (chunk: Buffer): void => { size += chunk.length; if (size > MAX_REQUEST_BODY_BYTES) { req.resume(); fail(new Error("body_too_large")); return; } chunks.push(chunk); };
    const onEnd = (): void => { if (settled) return; settled = true; cleanup(); resolve(Buffer.concat(chunks).toString("utf8")); };
    const onError = (): void => fail(new Error("request_aborted"));
    const onAborted = (): void => fail(new Error("request_aborted"));
    req.on("data", onData); req.on("end", onEnd); req.on("error", onError); req.on("aborted", onAborted);
  });
}

export function createRateLimiter(options: { now?: () => number; rateLimit?: number }): (ip: string) => boolean {
  const rateWindows = new Map<string, { count: number; windowStart: number }>();
  const now = options.now ?? Date.now;
  const limit = options.rateLimit ?? RATE_LIMIT;
  return (ip: string): boolean => {
    const current = now();
    const cutoff = current - RATE_WINDOW_MS;
    while (rateWindows.size > 0) { const oldest = rateWindows.entries().next().value as [string, { count: number; windowStart: number }] | undefined; if (!oldest || oldest[1].windowStart >= cutoff) break; rateWindows.delete(oldest[0]); }
    const window = rateWindows.get(ip);
    if (!window || current - window.windowStart >= RATE_WINDOW_MS) { if (!window && rateWindows.size >= MAX_RATE_ENTRIES) return false; rateWindows.set(ip, { count: 1, windowStart: current }); return true; }
    if (window.count >= limit) return false;
    window.count += 1;
    return true;
  };
}

export function requestOrigin(req: IncomingMessage): string | null {
  const origin = req.headers.origin;
  return typeof origin === "string" && origin.length <= 2048 ? origin : null;
}

export function expectedOrigin(req: IncomingMessage): string | null {
  const host = req.headers.host;
  if (!host || /[\u0000-\u001f\u007f-\u009f]/.test(host)) return null;
  const forwardedProto = req.headers["x-forwarded-proto"];
  const encrypted = (req.socket as IncomingMessage["socket"] & { encrypted?: boolean }).encrypted === true;
  const protocol = typeof forwardedProto === "string" && forwardedProto.split(",")[0]?.trim() === "https" ? "https" : encrypted ? "https" : "http";
  return `${protocol}://${host}`;
}

export function hasValidOrigin(req: IncomingMessage, allowedOrigins: ReadonlySet<string>, allowMissingOrigin: boolean): boolean {
  const origin = requestOrigin(req);
  if (!origin) return allowMissingOrigin;
  if (allowedOrigins.size > 0) return allowedOrigins.has(origin);
  const derived = expectedOrigin(req);
  return derived !== null && origin === derived;
}

export function validateStateFilePath(filePath: string): void {
  const directory = filePath.replace(/[\\/][^\\/]*$/, "") || ".";
  try { accessSync(directory, fsConstants.W_OK); } catch (error) { throw new Error(`[proxy-utils] AI_PROXY_STATE_FILE directory is not writable: ${directory}`, { cause: error }); }
}
