/**
 * BookmarkForge — Client events collector (storage-pressure / bundle-integrity-spike)
 *
 * The PWA dispatches the operational window events that this endpoint collects
 * from clients and turns into a server-side alert:
 *
 *   - storage-pressure        { level, pct, usage, quota, persisted }
 *   - bundle-integrity-spike  { count, reason }
 *   - error-spike             { count, reason }
 *   - csp-violation-spike     { count, reason }
 *   - client-event-retry-stats { attempts, coalesced, dropped } — diagnostics
 *     channel (not stored): each new drop logs `client_events_retry_degraded`
 *     so the monitoring cron can page when clients lost events — the
 *     CLIENT_CRITICAL signal itself may be blind.
 *
 * Alert rule (matches the monitoring plan): when >= CLIENT_EVENTS_CRITICAL_CLIENTS
 * distinct clients report a CRITICAL condition within CLIENT_EVENTS_WINDOW_MS,
 * the server emits a structured error log (the primary alerting signal that the
 * monitoring cron picks up) and fires one webhook notification. A
 * bundle-integrity-spike, an error-spike and a csp-violation-spike are
 * inherently critical (rollback / app-degradation candidates); a
 * storage-pressure event is critical only when level === "critical".
 *
 * Privacy (same policy as the CSP collector): the raw client IP is never
 * stored or forwarded — only a salted one-way hash used to count DISTINCT
 * clients for the threshold. No vault content ever leaves the client: the
 * payload carries storage percentages and integrity counters only.
 *
 * POST stays unauthenticated (browsers cannot attach an admin token to a
 * background fetch); the diagnostics GET is fail-closed behind an admin token.
 *
 * Routes:
 *   POST /api/client-events   accept a client event (204)
 *   GET  /api/client-events   diagnostics dashboard (token required)
 *
 * Env overrides (all fail-safe, invalid values fall back to the documented
 * default — see readBoundedInteger):
 *   CLIENT_EVENTS_MAX                   ring-buffer cap (default 200)
 *   CLIENT_EVENTS_LIMIT                 per-IP events per window (default 30)
 *   CLIENT_EVENTS_WINDOW_MS             rate + critical window (default 600_000 = 10 min)
 *   CLIENT_EVENTS_BODY_MAX_BYTES        max request body (default 16_384)
 *   CLIENT_EVENTS_RATE_MAX_ENTRIES      per-IP window map cap (default 10_000)
 *   CLIENT_EVENTS_CRITICAL_CLIENTS      threshold (default 3)
 *   CLIENT_EVENTS_ADMIN_TOKEN           GET diagnostics token (default none → 503)
 *   CLIENT_EVENTS_IP_HASH_SALT          salt for the one-way IP hash
 *   CLIENT_EVENTS_WEBHOOK_URL           HTTPS-only alert webhook (default none)
 *   CLIENT_EVENTS_WEBHOOK_ALLOW_HTTP    permit http webhook outside production
 *   CLIENT_EVENTS_WEBHOOK_TIMEOUT_MS    webhook request timeout (default 5_000)
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { applySecurityHeaders, constantTimeUtf8Equal, readBoundedInteger } from "./proxy-utils";

const MAX_FORWARDED_IP_LENGTH = 128;
const EVENT_TYPES = new Set(["storage-pressure", "bundle-integrity-spike", "error-spike", "csp-violation-spike", "client-event-retry-stats"]);
const STORAGE_LEVELS = new Set(["ok", "pressure", "critical"]);

interface ClientEventsOptions {
  serverInstanceId: string;
}

interface RateWindow {
  count: number;
  windowStart: number;
}

interface RetryStatsSnapshot {
  attempts: number;
  coalesced: number;
  dropped: number;
}

type ClientEventType = "storage-pressure" | "bundle-integrity-spike" | "error-spike" | "csp-violation-spike" | "client-event-retry-stats";

interface StoredClientEvent {
  timestamp: string;
  /** One-way IP fingerprint for distinct-client counting; never the IP itself. */
  ipHash: string;
  type: ClientEventType;
  level?: "ok" | "pressure" | "critical";
  pct?: number;
  persisted?: boolean;
  count?: number;
  /** Retry-stats diagnostics (client-event-retry-stats): never critical. */
  attempts?: number;
  coalesced?: number;
  dropped?: number;
  critical: boolean;
}

export function createClientEventsHandler(options: ClientEventsOptions) {
  const serverInstanceId = options.serverInstanceId;
  const now = (): number => Date.now();

  // ── Fail-safe configuration ──────────────────────────────────────────
  const MAX_EVENTS = readBoundedInteger(process.env.CLIENT_EVENTS_MAX, 200, 1, 10_000);
  const RATE_LIMIT = readBoundedInteger(process.env.CLIENT_EVENTS_LIMIT, 30, 1, 10_000);
  const WINDOW_MS = readBoundedInteger(process.env.CLIENT_EVENTS_WINDOW_MS, 600_000, 1_000, 86_400_000);
  const BODY_MAX_BYTES = readBoundedInteger(process.env.CLIENT_EVENTS_BODY_MAX_BYTES, 16_384, 1_024, 4 * 1024 * 1024);
  const RATE_MAX_ENTRIES = readBoundedInteger(process.env.CLIENT_EVENTS_RATE_MAX_ENTRIES, 10_000, 100, 100_000);
  const CRITICAL_CLIENTS = readBoundedInteger(process.env.CLIENT_EVENTS_CRITICAL_CLIENTS, 3, 2, 100_000);
  const ADMIN_TOKEN = process.env.CLIENT_EVENTS_ADMIN_TOKEN ?? "";
  const IP_HASH_SALT = process.env.CLIENT_EVENTS_IP_HASH_SALT || serverInstanceId;
  const WEBHOOK_ALLOW_HTTP =
    process.env.CLIENT_EVENTS_WEBHOOK_ALLOW_HTTP === "1" &&
    process.env.NODE_ENV !== "production";
  const WEBHOOK_URL = (() => {
    const raw = process.env.CLIENT_EVENTS_WEBHOOK_URL?.trim() ?? "";
    if (!raw) return "";
    const protocolOk =
      /^https:\/\//i.test(raw) ||
      (WEBHOOK_ALLOW_HTTP && /^http:\/\//i.test(raw));
    if (!protocolOk) {
      console.error(JSON.stringify({
        event: "client_events_webhook_url_rejected",
        reason: "only https is accepted" +
          (WEBHOOK_ALLOW_HTTP ? "" : " (set CLIENT_EVENTS_WEBHOOK_ALLOW_HTTP=1 outside production to permit http)"),
      }));
      return "";
    }
    return raw;
  })();
  const WEBHOOK_TIMEOUT_MS = readBoundedInteger(process.env.CLIENT_EVENTS_WEBHOOK_TIMEOUT_MS, 5_000, 1_000, 60_000);

  // ── State ────────────────────────────────────────────────────────────
  const recentEvents: StoredClientEvent[] = [];
  const rateWindows = new Map<string, RateWindow>();
  // Distinct clients currently in a critical condition within the window.
  const criticalClients = new Map<string, { lastCriticalAt: number }>();
  let alertFired = false;
  let accepted = 0;
  let rejected = 0;
  let rateLimited = 0;
  let criticalAccepted = 0;
  let alertsFired = 0;
  let webhookDelivered = 0;
  let webhookFailed = 0;
  let clientRetryAttempts = 0;
  let clientRetryCoalesced = 0;
  let clientRetryDropped = 0;
  // The browser sends cumulative counters. Keep the last snapshot per hashed
  // client so repeated reports count only deltas and one noisy client cannot
  // suppress or inflate another client's diagnostics. The map is bounded by
  // the same cardinality cap as the rate limiter.
  const retryStatsByClient = new Map<string, RetryStatsSnapshot>();

  // ── Helpers ──────────────────────────────────────────────────────────
  function clientIp(req: IncomingMessage): string {
    if (process.env.TRUST_PROXY === "1" || process.env.TRUST_PROXY === "true") {
      const fwd = req.headers["x-forwarded-for"];
      if (typeof fwd === "string" && fwd.length > 0) {
        const first = fwd.split(",")[0]?.trim();
        if (first && first.length <= MAX_FORWARDED_IP_LENGTH) return first;
      }
    }
    return req.socket.remoteAddress ?? "unknown";
  }

  function hashClientIp(ip: string): string {
    return createHash("sha256")
      .update(`${IP_HASH_SALT}:${ip}`)
      .digest("hex")
      .slice(0, 24);
  }

  function pruneRateWindows(current: number): void {
    const cutoff = current - WINDOW_MS;
    while (rateWindows.size > 0) {
      const oldest = rateWindows.entries().next().value as
        | [string, RateWindow]
        | undefined;
      if (!oldest || oldest[1].windowStart >= cutoff) break;
      rateWindows.delete(oldest[0]);
    }
  }

  function allowEvent(ip: string, current: number): boolean {
    pruneRateWindows(current);
    const window = rateWindows.get(ip);
    if (!window || current - window.windowStart >= WINDOW_MS) {
      if (!window && rateWindows.size >= RATE_MAX_ENTRIES) return false;
      rateWindows.set(ip, { count: 1, windowStart: current });
      return true;
    }
    if (window.count >= RATE_LIMIT) return false;
    window.count += 1;
    return true;
  }

  function sweepCriticalClients(current: number): void {
    const cutoff = current - WINDOW_MS;
    for (const [hash, entry] of criticalClients) {
      if (entry.lastCriticalAt < cutoff) criticalClients.delete(hash);
    }
    // Re-arm the alert once the window no longer holds the threshold.
    if (criticalClients.size < CRITICAL_CLIENTS) {
      alertFired = false;
    }
  }

  function sanitizeString(value: unknown, max: number): string | undefined {
    if (typeof value !== "string" || value.length === 0) return undefined;
    return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").slice(0, max);
  }

  function sanitizeNumber(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number | undefined {
    if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
    if (value < min || value > max) return undefined;
    return Math.round(value * 100) / 100;
  }

  function sanitizeBool(value: unknown): boolean | undefined {
    if (typeof value === "boolean") return value;
    if (value === "true") return true;
    if (value === "false") return false;
    return undefined;
  }

  function retryStatsDelta(
    clientHash: string,
    current: RetryStatsSnapshot,
  ): RetryStatsSnapshot {
    const previous = retryStatsByClient.get(clientHash);
    if (!previous && retryStatsByClient.size >= RATE_MAX_ENTRIES) {
      const oldest = retryStatsByClient.keys().next().value as string | undefined;
      if (oldest) retryStatsByClient.delete(oldest);
    }
    retryStatsByClient.set(clientHash, current);
    if (!previous) return current;
    return {
      // A lower value means the browser counters reset after a restart; count
      // the new snapshot as a fresh contribution rather than losing it.
      attempts: current.attempts >= previous.attempts
        ? current.attempts - previous.attempts
        : current.attempts,
      coalesced: current.coalesced >= previous.coalesced
        ? current.coalesced - previous.coalesced
        : current.coalesced,
      dropped: current.dropped >= previous.dropped
        ? current.dropped - previous.dropped
        : current.dropped,
    };
  }

  /** Fire-and-forget threshold webhook. The structured error log is the
   *  durable alert; the webhook is an immediate, best-effort notification. */
  function fireAlertWebhook(payload: Record<string, unknown>): void {
    if (!WEBHOOK_URL) return;
    void (async () => {
      try {
        const response = await fetch(WEBHOOK_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json", "User-Agent": "bookmarkforge-signaling-server" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
        });
        if (!response.ok) throw new Error(`webhook responded ${response.status}`);
        webhookDelivered += 1;
      } catch (error: unknown) {
        webhookFailed += 1;
        console.error(JSON.stringify({
          event: "client_events_webhook_failed",
          reason: String(error),
        }));
      }
    })();
  }

  function recordEvent(stored: StoredClientEvent, current: number): void {
    // Retry-stats is a diagnostics channel, not a stored/critical event: the
    // browser reports cumulative counters, so aggregate only per-client
    // deltas and emit one signal for each newly dropped event.
    if (stored.type === "client-event-retry-stats") {
      accepted += 1;
      const delta = retryStatsDelta(stored.ipHash, {
        attempts: stored.attempts ?? 0,
        coalesced: stored.coalesced ?? 0,
        dropped: stored.dropped ?? 0,
      });
      clientRetryAttempts += delta.attempts;
      clientRetryCoalesced += delta.coalesced;
      clientRetryDropped += delta.dropped;
      if (delta.dropped > 0) {
        const newDropped = delta.dropped;
        const attempts = delta.attempts;
        const coalesced = delta.coalesced;
        const dropped = delta.dropped;
        console.error(JSON.stringify({
          event: "client_events_retry_degraded",
          timestamp: stored.timestamp,
          newDropped,
          attempts,
          coalesced,
          dropped,
        }));
        fireAlertWebhook({
          serverInstanceId,
          alert: "client-events-retry-degraded",
          generatedAt: stored.timestamp,
          newDropped,
          attempts,
          coalesced,
          dropped,
        });
      }
      return;
    }

    if (recentEvents.length >= MAX_EVENTS) {
      recentEvents.splice(0, recentEvents.length - MAX_EVENTS + 1);
    }
    recentEvents.push(stored);
    accepted += 1;

    if (stored.critical) {
      criticalAccepted += 1;
      criticalClients.set(stored.ipHash, { lastCriticalAt: current });
      sweepCriticalClients(current);
      console.error(JSON.stringify({
        event: "client_event_critical",
        timestamp: stored.timestamp,
        type: stored.type,
        level: stored.level,
        pct: stored.pct,
        criticalClients: criticalClients.size,
        threshold: CRITICAL_CLIENTS,
      }));

      if (!alertFired && criticalClients.size >= CRITICAL_CLIENTS) {
        alertFired = true;
        alertsFired += 1;
        const payload = {
          serverInstanceId,
          alert: "client-events-critical-threshold",
          generatedAt: new Date().toISOString(),
          criticalClients: criticalClients.size,
          threshold: CRITICAL_CLIENTS,
          windowMs: WINDOW_MS,
          events: recentEvents
            .filter((e) => e.critical)
            .slice(-10)
            .map((e) => ({
              type: e.type,
              level: e.level,
              pct: e.pct,
              count: e.count,
              timestamp: e.timestamp,
            })),
        };
        console.error(JSON.stringify({
          event: "client_events_critical_threshold",
          // Timestamp makes the log line self-describing for consumers
          // (monitoring-alerts.mjs filters threshold events by window).
          timestamp: new Date().toISOString(),
          criticalClients: criticalClients.size,
          threshold: CRITICAL_CLIENTS,
          windowMs: WINDOW_MS,
        }));
        fireAlertWebhook(payload);
      }
    } else {
      console.log(JSON.stringify({
        event: "client_event",
        timestamp: stored.timestamp,
        type: stored.type,
        level: stored.level,
        pct: stored.pct,
      }));
    }
  }

  // ── HTTP handler ─────────────────────────────────────────────────────
  return function clientEventsHandler(req: IncomingMessage, res: ServerResponse): void {
    applySecurityHeaders(res, { includeInterestCohort: false });

    if (req.method === "GET") {
      const token = req.headers["x-client-events-admin-token"];
      const tokenMatches =
        typeof token === "string" && constantTimeUtf8Equal(ADMIN_TOKEN, token);
      if (!ADMIN_TOKEN || !tokenMatches) {
        res.writeHead(ADMIN_TOKEN ? 401 : 503, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
        res.end(ADMIN_TOKEN ? "Unauthorized" : "Diagnostics unavailable");
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify({
        recent: recentEvents.slice(-50),
        total: accepted,
        critical: criticalAccepted,
        rejected,
        rateLimited,
        alertsFired,
        criticalClientsActive: criticalClients.size,
        criticalThreshold: CRITICAL_CLIENTS,
        windowMs: WINDOW_MS,
        webhook: Boolean(WEBHOOK_URL),
        webhookDelivered,
        webhookFailed,
        clientRetryAttempts,
        clientRetryCoalesced,
        clientRetryDropped,
        serverInstanceId,
      }));
      return;
    }

    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "text/plain" });
      res.end("Method Not Allowed");
      return;
    }

    const ip = clientIp(req);
    const current = now();
    if (!allowEvent(ip, current)) {
      rateLimited += 1;
      res.writeHead(429, { "Content-Type": "text/plain" });
      res.end("Too Many Requests");
      return;
    }

    const declaredLength = Number(req.headers["content-length"] ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > BODY_MAX_BYTES) {
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
      settle();
      req.resume();
      res.writeHead(413, { "Content-Type": "text/plain" });
      res.end("Payload Too Large");
      res.once("finish", () => req.destroy());
    };
    const onData = (chunk: Buffer) => {
      bodyBytes += chunk.length;
      if (bodyBytes > BODY_MAX_BYTES) {
        rejectOversizedBody();
        return;
      }
      chunks.push(chunk);
    };
    // A client that disconnects mid-body must not crash the server (an
    // unhandled 'error' event on the request stream would be a remote DoS).
    const onRequestError = () => {
      settle();
      if (!res.writableEnded) res.destroy();
    };
    const onAborted = () => {
      settle();
      if (!res.writableEnded) res.destroy();
    };
    const onEnd = () => {
      if (bodyTooLarge || settled) return;
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        const payload = JSON.parse(raw) as Record<string, unknown>;
        if (!payload || typeof payload !== "object") {
          rejected += 1;
          res.writeHead(400, { "Content-Type": "text/plain" });
          res.end("Bad Request: expected a JSON object");
          return;
        }
        const validated = validateEvent(payload);
        if (!validated) {
          rejected += 1;
          res.writeHead(400, { "Content-Type": "text/plain" });
          res.end("Bad Request: invalid client event");
          return;
        }
        const stored: StoredClientEvent = {
          ...validated,
          ipHash: hashClientIp(ip),
          timestamp: new Date().toISOString(),
        };
        recordEvent(stored, now());
        res.writeHead(204);
        res.end();
      } catch {
        rejected += 1;
        console.error(JSON.stringify({ event: "client_event_rejected", reason: "invalid_json" }));
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Bad Request: invalid JSON");
      }
    };
    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onRequestError);
    req.on("aborted", onAborted);
  };

  /** Validate and normalize a client event; returns null when invalid. */
  function validateEvent(payload: Record<string, unknown>): Omit<StoredClientEvent, "ipHash" | "timestamp"> | null {
    const type = sanitizeString(payload.type, 32);
    if (!type || !EVENT_TYPES.has(type)) return null;
    const eventType = type as ClientEventType;

    if (eventType === "client-event-retry-stats") {
      const attempts = sanitizeNumber(payload.attempts, 0, 1_000_000);
      const coalesced = sanitizeNumber(payload.coalesced, 0, 1_000_000);
      const dropped = sanitizeNumber(payload.dropped, 0, 1_000_000);
      if (attempts === undefined || coalesced === undefined || dropped === undefined) return null;
      // Accepted as a valid (non-stored) diagnostics event; recordEvent
      // accumulates the counters and emits the degraded-delivery signal.
      return {
        type: eventType,
        attempts,
        coalesced,
        dropped,
        critical: false,
      };
    }

    if (eventType === "storage-pressure") {
      const level = sanitizeString(payload.level, 16);
      if (!level || !STORAGE_LEVELS.has(level)) return null;
      const pct = sanitizeNumber(payload.pct, 0, 100);
      const persisted = sanitizeBool(payload.persisted);
      return {
        type: eventType,
        level: level as "ok" | "pressure" | "critical",
        pct,
        persisted,
        critical: level === "critical",
      };
    }

    // bundle-integrity-spike / error-spike / csp-violation-spike are
    // inherently critical (rollback / app-degradation candidates).
    const count = sanitizeNumber(payload.count, 1, 1_000_000);
    return {
      type: eventType,
      count,
      critical: true,
    };
  }
}

