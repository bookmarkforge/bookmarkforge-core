import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";

const MAX_REQUEST_BODY_BYTES = 256 * 1024;
const MAX_AUTH_TOKEN_LENGTH = 4_096;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 60;
const MAX_RATE_ENTRIES = 10_000;

export function readBoundedInteger(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number(raw ?? fallback);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

export function constantTimeUtf8Equal(expected: string, actual: string): boolean {
  const expectedBytes = Buffer.from(expected, "utf8");
  const actualBytes = Buffer.from(actual, "utf8");
  if (expectedBytes.length !== actualBytes.length) return false;
  return timingSafeEqual(expectedBytes, actualBytes);
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

export function applySecurityHeaders(
  res: ServerResponse,
  options: { includeInterestCohort?: boolean } = {},
): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  const permissions = "camera=(), geolocation=(), microphone=()" +
    (options.includeInterestCohort === false ? "" : ", interest-cohort=()");
  res.setHeader("Permissions-Policy", permissions);
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
    const onAborted = (): void => fail(new Error("request_aborted"))
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

function requestOrigin(req: IncomingMessage): string | null {
  const origin = req.headers.origin;
  return typeof origin === "string" && origin.length <= 2048 ? origin : null;
}

function expectedOrigin(req: IncomingMessage): string | null {
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
