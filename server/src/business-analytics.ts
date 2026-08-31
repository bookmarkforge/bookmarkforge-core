/**
 * BookmarkForge — Business analytics collector (opt-in, pseudonymous, no content)
 *
 * The PWA's AnalyticsService keeps product events LOCAL by default. When the
 * user opts in via the consent banner (forge_consent_analytics), the client
 * forwards a single daily, aggregated, NON-PII bucket per install to this
 * endpoint:
 *
 *   { "iid": "<sha256 hex of a per-install random id>", "counts": { "vault_created": 1, ... } }
 *
 * The server stamps the UTC day at ingest (client clocks are not trusted) and
 * aggregates:
 *
 *   - daily totals per event type   (activation funnel, engagement)
 *   - per-install first/last active day  (cohort retention D1/D7/D30)
 *   - DAU / WAU / MAU               (distinct installs active in 1/7/30 days)
 *
 * Privacy contract (same policy as the CSP/events collectors):
 *   - The raw install id NEVER leaves the client; only a SHA-256 hash arrives.
 *   - No IP is stored — only a salted one-way hash for the per-IP rate limit.
 *   - No vault content, prompts, URLs, titles, timestamps of user actions or
 *     free-form fields: only counts of a fixed allow-list of event types.
 *   - Nothing is sent unless the user opted in (consent is enforced
 *     client-side; the server is a dumb aggregator for opted-in data).
 *   - Per-install state is bounded (ANALYTICS_MAX_INSTALLS); day data is
 *     retained for MAX_DAYS_RETAINED days, then pruned.
 *
 * Idempotency: the server keeps only the LATEST bucket per (install, day), so
 * a client retry of the same day REPLACES the previous bucket instead of
 * double-counting — clients may safely retry transient failures.
 *
 * POST stays unauthenticated (browsers cannot attach an admin token to a
 * background fetch; payloads are bounded and non-sensitive); the diagnostics
 * GET is fail-closed behind an admin token, exactly like /api/client-events.
 *
 * Routes:
 *   POST /api/analytics/events   accept a daily bucket (204)
 *   GET  /api/analytics/kpis     KPI report (admin token required)
 *
 * Env overrides (all fail-safe, invalid values fall back to documented
 * defaults — see readBoundedInteger):
 *   ANALYTICS_RATE_LIMIT          per-IP buckets per window (default 60)
 *   ANALYTICS_WINDOW_MS           rate window (default 600_000 = 10 min)
 *   ANALYTICS_MAX_INSTALLS        per-install state cap (default 200_000)
 *   ANALYTICS_RATE_MAX_ENTRIES    per-IP window map cap (default 10_000)
 *   ANALYTICS_BODY_MAX_BYTES      max request body (default 16_384)
 *   ANALYTICS_ADMIN_TOKEN         GET /kpis token (default none -> 503)
 *   ANALYTICS_STATE_FILE          optional JSON persistence (default none =
 *                                 in-memory only; atomic writes when set)
 *   ANALYTICS_MAX_DAYS            retained day history (default 180)
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

/** Fixed allow-list of product event types the collector will accept. */
const ANALYTICS_EVENT_TYPES = new Set([
  "vault_created",
  "vault_unlocked",
  "first_capture",
  "first_document",
  "session_start",
  "session_end",
  "bookmark_created",
  "bookmark_deleted",
  "document_created",
  "document_deleted",
  "search_used",
  "import_used",
  "export_used",
  "ai_chat_used",
  "ai_summary_generated",
  "p2p_sync_started",
  "p2p_sync_completed",
  "extension_captured",
]);

const DAY_MS = 86_400_000;
const MAX_FORWARDED_IP_LENGTH = 128;
const IID_RE = /^[0-9a-f]{64}$/;
const MAX_COUNT = 1_000_000;

interface RateWindow {
  count: number;
  windowStart: number;
}

interface InstallBucket {
  /** UTC epoch-day of the LATEST submitted bucket (replace semantics). */
  day: number;
  counts: Map<string, number>;
}

export interface AnalyticsKpis {
  generatedAt: string;
  activeInstalls: number;
  dau: number;
  wau: number;
  mau: number;
  /** Cohort retention: firstDay → { cohortSize, d1, d7, d30 } for the last N days. */
  cohorts: Record<string, { cohortSize: number; d1: number; d7: number; d30: number }>;
  /** Activation funnel (total events of each type across retained days). */
  funnel: Record<string, number>;
  /** Daily totals per event type (last MAX_DAYS days). */
  daily: Record<string, Record<string, number>>;
  counters: {
    accepted: number;
    rejected: number;
    rateLimited: number;
    installsTracked: number;
    persisted: boolean;
  };
  serverInstanceId: string;
}

export function createAnalyticsHandler(options: { serverInstanceId: string }) {
  const serverInstanceId = options.serverInstanceId;

  // ── Fail-safe configuration ──────────────────────────────────────────
  const RATE_LIMIT = readBoundedInteger(process.env.ANALYTICS_RATE_LIMIT, 60, 1, 100_000);
  const WINDOW_MS = readBoundedInteger(process.env.ANALYTICS_WINDOW_MS, 600_000, 1_000, 86_400_000);
  const MAX_INSTALLS = readBoundedInteger(process.env.ANALYTICS_MAX_INSTALLS, 200_000, 100, 5_000_000);
  const RATE_MAX_ENTRIES = readBoundedInteger(process.env.ANALYTICS_RATE_MAX_ENTRIES, 10_000, 100, 100_000);
  const BODY_MAX_BYTES = readBoundedInteger(process.env.ANALYTICS_BODY_MAX_BYTES, 16_384, 1_024, 4 * 1024 * 1024);
  const ADMIN_TOKEN = process.env.ANALYTICS_ADMIN_TOKEN ?? "";
  const MAX_DAYS = readBoundedInteger(process.env.ANALYTICS_MAX_DAYS, 180, 30, 730);
  const STATE_FILE = process.env.ANALYTICS_STATE_FILE?.trim() ?? "";
  const IP_HASH_SALT = process.env.ANALYTICS_IP_HASH_SALT || serverInstanceId;

  // ── State ────────────────────────────────────────────────────────────
  /** iid → first/last active UTC epoch-day (cohort retention). */
  const installs = new Map<string, { firstDay: number; lastDay: number }>();
  /** iid → latest bucket (idempotent replace per day). Bounded by MAX_INSTALLS. */
  const buckets = new Map<string, InstallBucket>();
  /** UTC epoch-day → event type → total count. Pruned to MAX_DAYS. */
  const dailyTotals = new Map<number, Map<string, number>>();
  const rateWindows = new Map<string, RateWindow>();
  let accepted = 0;
  let rejected = 0;
  let rateLimited = 0;
  let stateDirty = false;
  let persistTimer: ReturnType<typeof setTimeout> | null = null;

  // ── State file persistence (atomic write: tmp + rename) ──────────────
  function loadState(): void {
    if (!STATE_FILE) return;
    try {
      if (!existsSync(STATE_FILE)) return;
      const raw = JSON.parse(readFileSync(STATE_FILE, "utf8")) as {
        installs?: Array<[string, { firstDay: number; lastDay: number }]>;
        buckets?: Array<[string, { day: number; counts: Record<string, number> }]>;
        daily?: Array<[number, Record<string, number>]>;
      };
      for (const [iid, value] of raw.installs ?? []) {
        if (typeof iid === "string" && IID_RE.test(iid) && Number.isInteger(value?.firstDay) && Number.isInteger(value?.lastDay)) {
          installs.set(iid, { firstDay: value.firstDay, lastDay: value.lastDay });
        }
      }
      for (const [iid, value] of raw.buckets ?? []) {
        if (typeof iid === "string" && IID_RE.test(iid) && value && Number.isInteger(value.day) && value.counts && typeof value.counts === "object") {
          const counts = new Map<string, number>();
          for (const [type, count] of Object.entries(value.counts)) {
            if (typeof count === "number" && Number.isInteger(count) && count >= 0) counts.set(type, count);
          }
          if (counts.size > 0) buckets.set(iid, { day: value.day, counts });
        }
      }
      for (const [day, map] of raw.daily ?? []) {
        if (!Number.isInteger(day) || !map || typeof map !== "object") continue;
        const totals = new Map<string, number>();
        for (const [type, count] of Object.entries(map)) {
          if (typeof count === "number" && Number.isInteger(count) && count >= 0) totals.set(type, count);
        }
        dailyTotals.set(day, totals);
      }
    } catch (error) {
      console.error(JSON.stringify({ event: "analytics_state_load_failed", reason: String(error) }));
    }
  }

  function persistState(): void {
    if (!STATE_FILE) return;
    stateDirty = true;
    if (persistTimer) return;
    // Debounce bursts of buckets into one atomic write.
    persistTimer = setTimeout(() => {
      persistTimer = null;
      if (!stateDirty) return;
      stateDirty = false;
      try {
        const tmp = `${STATE_FILE}.tmp`;
        writeFileSync(tmp, JSON.stringify({
          installs: [...installs.entries()],
          buckets: [...buckets.entries()].map(([iid, b]) => [iid, { day: b.day, counts: Object.fromEntries(b.counts) }]),
          daily: [...dailyTotals.entries()].map(([day, map]) => [day, Object.fromEntries(map)]),
        }));
        renameSync(tmp, STATE_FILE);
      } catch (error) {
        stateDirty = true;
        console.error(JSON.stringify({ event: "analytics_state_persist_failed", reason: String(error) }));
      }
    }, 2_000);
  }

  loadState();

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
    return createHash("sha256").update(`${IP_HASH_SALT}:${ip}`).digest("hex").slice(0, 24);
  }

  function utcDay(timestamp: number): number {
    return Math.floor(timestamp / DAY_MS);
  }

  function pruneRateWindows(current: number): void {
    const cutoff = current - WINDOW_MS;
    while (rateWindows.size > 0) {
      const oldest = rateWindows.entries().next().value as [string, RateWindow] | undefined;
      if (!oldest || oldest[1].windowStart >= cutoff) break;
      rateWindows.delete(oldest[0]);
    }
  }

  function allowBucket(ipHash: string, current: number): boolean {
    pruneRateWindows(current);
    const window = rateWindows.get(ipHash);
    if (!window || current - window.windowStart >= WINDOW_MS) {
      if (!window && rateWindows.size >= RATE_MAX_ENTRIES) return false;
      rateWindows.set(ipHash, { count: 1, windowStart: current });
      return true;
    }
    if (window.count >= RATE_LIMIT) return false;
    window.count += 1;
    return true;
  }

  /** Drop per-install state beyond the cap, oldest lastDay first. */
  function enforceInstallCap(_currentDay: number): void {
    if (installs.size <= MAX_INSTALLS) return;
    const sorted = [...installs.entries()].sort((a, b) => a[1].lastDay - b[1].lastDay);
    let excess = installs.size - MAX_INSTALLS;
    for (const [iid] of sorted) {
      if (excess <= 0) break;
      const bucket = buckets.get(iid);
      if (bucket) {
        const totals = dailyTotals.get(bucket.day);
        if (totals) {
          for (const [type, count] of bucket.counts) {
            const next = (totals.get(type) ?? 0) - count;
            if (next <= 0) totals.delete(type);
            else totals.set(type, next);
          }
        }
        buckets.delete(iid);
      }
      installs.delete(iid);
      excess -= 1;
    }
  }

  function pruneOldDays(currentDay: number): void {
    const cutoff = currentDay - MAX_DAYS;
    for (const day of dailyTotals.keys()) {
      if (day < cutoff) dailyTotals.delete(day);
    }
  }

  function applyBucket(iid: string, counts: Map<string, number>, currentDay: number): void {
    const existingInstall = installs.get(iid);
    installs.set(iid, {
      firstDay: existingInstall ? Math.min(existingInstall.firstDay, currentDay) : currentDay,
      lastDay: currentDay,
    });

    // Idempotent replace: subtract the previous bucket for this install (if
    // any) before adding the new one, so a retried day (same OR different)
    // never double-counts.
    const previous = buckets.get(iid);
    if (previous) {
      const totals = dailyTotals.get(previous.day);
      if (totals) {
        for (const [type, count] of previous.counts) {
          const next = (totals.get(type) ?? 0) - count;
          if (next <= 0) totals.delete(type);
          else totals.set(type, next);
        }
      }
    }
    buckets.set(iid, { day: currentDay, counts });

    let totals = dailyTotals.get(currentDay);
    if (!totals) {
      totals = new Map<string, number>();
      dailyTotals.set(currentDay, totals);
    }
    for (const [type, count] of counts) {
      totals.set(type, (totals.get(type) ?? 0) + count);
    }

    pruneOldDays(currentDay);
    enforceInstallCap(currentDay);
    accepted += 1;
    persistState();
  }

  /** Validate and normalize a daily bucket; null when invalid. */
  function validateBucket(payload: Record<string, unknown>): { iid: string; counts: Map<string, number> } | null {
    if (typeof payload.iid !== "string" || !IID_RE.test(payload.iid)) return null;
    if (!payload.counts || typeof payload.counts !== "object" || Array.isArray(payload.counts)) return null;
    const counts = new Map<string, number>();
    for (const [type, value] of Object.entries(payload.counts as Record<string, unknown>)) {
      if (!ANALYTICS_EVENT_TYPES.has(type)) return null;
      if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > MAX_COUNT) return null;
      counts.set(type, value);
    }
    if (counts.size === 0 || counts.size > 32) return null;
    return { iid: payload.iid, counts };
  }

  // ── KPI computation ──────────────────────────────────────────────────
  function computeKpis(now: number): AnalyticsKpis {
    const today = utcDay(now);
    const days: number[] = [];
    const installList: Array<{ firstDay: number; lastDay: number }> = [];
    for (const install of installs.values()) {
      const lastActiveDaysAgo = today - install.lastDay;
      days.push(lastActiveDaysAgo);
      installList.push(install);
    }
    const dau = days.filter((d) => d <= 0).length;
    const wau = days.filter((d) => d < 7).length;
    const mau = days.filter((d) => d < 30).length;

    const cohorts: Record<string, { cohortSize: number; d1: number; d7: number; d30: number }> = {};
    const cohortDays = Math.min(30, MAX_DAYS);
    for (let offset = cohortDays - 1; offset >= 0; offset -= 1) {
      const firstDay = today - offset;
      const members = installList.filter((m) => m.firstDay === firstDay);
      if (members.length === 0) continue;
      cohorts[String(firstDay)] = {
        cohortSize: members.length,
        d1: members.filter((m) => m.lastDay >= firstDay + 1).length,
        d7: members.filter((m) => m.lastDay >= firstDay + 7).length,
        d30: members.filter((m) => m.lastDay >= firstDay + 30).length,
      };
    }

    const funnel: Record<string, number> = {};
    const daily: Record<string, Record<string, number>> = {};
    for (const [day, totals] of dailyTotals) {
      if (day < today - MAX_DAYS) continue;
      daily[String(day)] = Object.fromEntries(totals);
      for (const [type, count] of totals) {
        funnel[type] = (funnel[type] ?? 0) + count;
      }
    }

    return {
      generatedAt: new Date(now).toISOString(),
      activeInstalls: installs.size,
      dau,
      wau,
      mau,
      cohorts,
      funnel,
      daily,
      counters: {
        accepted,
        rejected,
        rateLimited,
        installsTracked: installs.size,
        persisted: Boolean(STATE_FILE),
      },
      serverInstanceId,
    };
  }

  // ── HTTP handler ─────────────────────────────────────────────────────
  return function analyticsHandler(req: IncomingMessage, res: ServerResponse): void {
    applySecurityHeaders(res);

    if (req.method === "GET" && req.url === "/api/analytics/kpis") {
      const token = req.headers["x-analytics-admin-token"];
      const tokenMatches = typeof token === "string" && constantTimeUtf8Equal(ADMIN_TOKEN, token);
      if (!ADMIN_TOKEN || !tokenMatches) {
        res.writeHead(ADMIN_TOKEN ? 401 : 503, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
        res.end(ADMIN_TOKEN ? "Unauthorized" : "Analytics diagnostics unavailable");
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify(computeKpis(Date.now())));
      return;
    }

    if (req.method !== "POST" || req.url !== "/api/analytics/events") {
      res.writeHead(405, { "Content-Type": "text/plain" });
      res.end("Method Not Allowed");
      return;
    }

    const ipHash = hashClientIp(clientIp(req));
    const current = Date.now();
    if (!allowBucket(ipHash, current)) {
      rateLimited += 1;
      res.writeHead(429, { "Content-Type": "text/plain" });
      res.end("Too Many Requests");
      return;
    }

    const declaredLength = Number(req.headers["content-length"] ?? 0);
    if (Number.isFinite(declaredLength) && declaredLength > BODY_MAX_BYTES) {
      req.resume();
      rejected += 1;
      res.writeHead(413, { "Content-Type": "text/plain" });
      res.end("Payload Too Large");
      return;
    }

    const chunks: Buffer[] = [];
    let bodyBytes = 0;
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      req.removeListener("data", onData);
      req.removeListener("end", onEnd);
      req.removeListener("error", onRequestError);
      req.removeListener("aborted", onAborted);
    };
    const onData = (chunk: Buffer) => {
      bodyBytes += chunk.length;
      if (bodyBytes > BODY_MAX_BYTES) {
        settle();
        req.resume();
        rejected += 1;
        res.writeHead(413, { "Content-Type": "text/plain" });
        res.end("Payload Too Large");
        res.once("finish", () => req.destroy());
        return;
      }
      chunks.push(chunk);
    };
    const onRequestError = () => {
      settle();
      if (!res.writableEnded) res.destroy();
    };
    const onAborted = () => {
      settle();
      if (!res.writableEnded) res.destroy();
    };
    const onEnd = () => {
      if (settled) return;
      settle();
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        const payload = JSON.parse(raw) as Record<string, unknown>;
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
          rejected += 1;
          res.writeHead(400, { "Content-Type": "text/plain" });
          res.end("Bad Request: expected a JSON object");
          return;
        }
        const validated = validateBucket(payload);
        if (!validated) {
          rejected += 1;
          res.writeHead(400, { "Content-Type": "text/plain" });
          res.end("Bad Request: invalid analytics bucket");
          return;
        }
        const day = utcDay(current);
        applyBucket(validated.iid, validated.counts, day);
        console.log(JSON.stringify({
          event: "analytics_bucket_accepted",
          timestamp: new Date(current).toISOString(),
          day: String(day),
          installs: installs.size,
          types: validated.counts.size,
        }));
        res.writeHead(204);
        res.end();
      } catch {
        rejected += 1;
        console.error(JSON.stringify({ event: "analytics_bucket_rejected", reason: "invalid_json" }));
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("Bad Request: invalid JSON");
      }
    };
    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onRequestError);
    req.on("aborted", onAborted);
  };
}

function readBoundedInteger(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(raw ?? fallback);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

function constantTimeUtf8Equal(expected: string, actual: string): boolean {
  const expectedBytes = Buffer.from(expected, "utf8");
  const actualBytes = Buffer.from(actual, "utf8");
  if (expectedBytes.length !== actualBytes.length) return false;
  return timingSafeEqual(expectedBytes, actualBytes);
}

function applySecurityHeaders(res: ServerResponse): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), geolocation=(), microphone=()");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  );
}

