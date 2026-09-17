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
 * Idempotency: new clients include a batchId. The server applies each
 * (install, batchId) once, so partial flushes add up and retries never
 * double-count. Payloads without batchId keep the legacy per-day replace
 * semantics for older clients.
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
import { createHash } from "node:crypto";
import { applySecurityHeaders, constantTimeUtf8Equal, readBoundedInteger } from "./proxy-utils";
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
const BATCH_ID_RE = /^[A-Za-z0-9._-]{1,128}$/;
const DEFAULT_MAX_BATCHES_PER_INSTALL = 2_048;
const DEFAULT_MAX_BATCHES_TOTAL = 500_000;

interface RateWindow {
  count: number;
  windowStart: number;
}

interface BatchContribution {
  day: number;
  counts: Map<string, number>;
}

interface InstallBucket {
  /** Bounded contributions used for idempotency and historical totals. */
  batches: Map<string, BatchContribution>;
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
  const MAX_BATCHES_PER_INSTALL = readBoundedInteger(
    process.env.ANALYTICS_MAX_BATCHES_PER_INSTALL,
    DEFAULT_MAX_BATCHES_PER_INSTALL,
    32,
    16_384,
  );
  const MAX_BATCHES_TOTAL = readBoundedInteger(
    process.env.ANALYTICS_MAX_BATCHES_TOTAL,
    DEFAULT_MAX_BATCHES_TOTAL,
    1_000,
    5_000_000,
  );
  const STATE_FILE = process.env.ANALYTICS_STATE_FILE?.trim() ?? "";
  const IP_HASH_SALT = process.env.ANALYTICS_IP_HASH_SALT || serverInstanceId;

  // ── State ────────────────────────────────────────────────────────────
  /** iid → first/last active UTC epoch-day (cohort retention). */
  const installs = new Map<string, { firstDay: number; lastDay: number }>();
  /** iid → bounded batch contributions. Bounded by MAX_INSTALLS. */
  const buckets = new Map<string, InstallBucket>();
  /** UTC epoch-day → event type → total count. Pruned to MAX_DAYS. */
  const dailyTotals = new Map<number, Map<string, number>>();
  /** Reverse index used to prune old batch ids without scanning every install. */
  const batchRefsByDay = new Map<number, Set<string>>();
  const rateWindows = new Map<string, RateWindow>();
  let accepted = 0;
  let rejected = 0;
  let rateLimited = 0;
  let totalBatchCount = 0;
  let stateDirty = false;
  let persistTimer: ReturnType<typeof setTimeout> | null = null;

  function parseCounts(raw: Record<string, unknown>): Map<string, number> {
    const counts = new Map<string, number>();
    for (const [type, count] of Object.entries(raw)) {
      if (
        !ANALYTICS_EVENT_TYPES.has(type) ||
        typeof count !== "number" ||
        !Number.isInteger(count) ||
        count < 1 ||
        count > MAX_COUNT
      ) {
        return new Map();
      }
      counts.set(type, count);
    }
    return counts.size <= 32 ? counts : new Map();
  }

  function batchRef(iid: string, batchId: string): string {
    return `${iid}\u0000${batchId}`;
  }

  function splitBatchRef(ref: string): [string, string] | null {
    const separator = ref.indexOf("\u0000");
    if (separator <= 0) return null;
    return [ref.slice(0, separator), ref.slice(separator + 1)];
  }

  function registerBatchRef(iid: string, batchId: string, day: number): void {
    let refs = batchRefsByDay.get(day);
    if (!refs) {
      refs = new Set<string>();
      batchRefsByDay.set(day, refs);
    }
    refs.add(batchRef(iid, batchId));
  }

  function unregisterBatchRef(iid: string, batchId: string, day: number): void {
    const refs = batchRefsByDay.get(day);
    if (!refs) return;
    refs.delete(batchRef(iid, batchId));
    if (refs.size === 0) batchRefsByDay.delete(day);
  }

  function removeContribution(iid: string, bucket: InstallBucket, batchId: string): void {
    const contribution = bucket.batches.get(batchId);
    if (!contribution) return;
    const totals = dailyTotals.get(contribution.day);
    if (totals) {
      for (const [type, count] of contribution.counts) {
        const next = (totals.get(type) ?? 0) - count;
        if (next <= 0) totals.delete(type);
        else totals.set(type, next);
      }
      if (totals.size === 0) dailyTotals.delete(contribution.day);
    }
    bucket.batches.delete(batchId);
    totalBatchCount = Math.max(0, totalBatchCount - 1);
    unregisterBatchRef(iid, batchId, contribution.day);
    if (bucket.batches.size === 0) buckets.delete(iid);
  }

  function pruneOldDays(currentDay: number): void {
    const cutoff = currentDay - MAX_DAYS;
    for (const [day, refs] of [...batchRefsByDay.entries()]) {
      if (day >= cutoff) continue;
      for (const ref of [...refs]) {
        const parsed = splitBatchRef(ref);
        if (!parsed) continue;
        const [iid, batchId] = parsed;
        const bucket = buckets.get(iid);
        if (bucket) removeContribution(iid, bucket, batchId);
      }
      dailyTotals.delete(day);
      batchRefsByDay.delete(day);
    }
    for (const day of [...dailyTotals.keys()]) {
      if (day < cutoff) dailyTotals.delete(day);
    }
  }

  function enforceInstallCap(): void {
    if (installs.size <= MAX_INSTALLS) return;
    const sorted = [...installs.entries()].sort((a, b) => a[1].lastDay - b[1].lastDay);
    let excess = installs.size - MAX_INSTALLS;
    for (const [iid] of sorted) {
      if (excess <= 0) break;
      const bucket = buckets.get(iid);
      if (bucket) {
        for (const batchId of [...bucket.batches.keys()]) {
          removeContribution(iid, bucket, batchId);
        }
      }
      installs.delete(iid);
      excess -= 1;
    }
  }

  // ── State file persistence (atomic write: tmp + rename) ──────────────
  function loadState(): void {
    if (!STATE_FILE) return;
    try {
      if (!existsSync(STATE_FILE)) return;
      const raw = JSON.parse(readFileSync(STATE_FILE, "utf8")) as {
        installs?: Array<[string, { firstDay: number; lastDay: number }]>;
        buckets?: Array<[string, unknown]>;
        daily?: Array<[number, Record<string, number>]>;
      };
      for (const [iid, value] of raw.installs ?? []) {
        if (typeof iid === "string" && IID_RE.test(iid) && Number.isInteger(value?.firstDay) && Number.isInteger(value?.lastDay)) {
          installs.set(iid, { firstDay: value.firstDay, lastDay: value.lastDay });
        }
      }
      for (const [iid, value] of raw.buckets ?? []) {
        if (typeof iid !== "string" || !IID_RE.test(iid) || !value || typeof value !== "object") continue;
        const bucket = value as {
          day?: unknown;
          counts?: unknown;
          batches?: unknown;
        };
        const installBucket: InstallBucket = { batches: new Map() };
        // Current format: all bounded batch contributions for the install.
        if (Array.isArray(bucket.batches)) {
          for (const entry of bucket.batches) {
            if (!Array.isArray(entry) || entry.length !== 2) continue;
            const [batchId, contribution] = entry as [unknown, unknown];
            if (typeof batchId !== "string" || !BATCH_ID_RE.test(batchId) || !contribution || typeof contribution !== "object") continue;
            const record = contribution as { day?: unknown; counts?: unknown };
            if (!Number.isInteger(record.day) || !record.counts || typeof record.counts !== "object" || Array.isArray(record.counts)) continue;
            const counts = parseCounts(record.counts as Record<string, unknown>);
            if (counts.size === 0) continue;
            if (installBucket.batches.size >= MAX_BATCHES_PER_INSTALL || totalBatchCount >= MAX_BATCHES_TOTAL) continue;
            installBucket.batches.set(batchId, { day: record.day as number, counts });
            totalBatchCount += 1;
            registerBatchRef(iid, batchId, record.day as number);
          }
        // Legacy format: one latest bucket. Preserve it as a per-day entry so
        // a later day cannot erase the historical totals that were retained.
        } else if (Number.isInteger(bucket.day) && bucket.counts && typeof bucket.counts === "object" && !Array.isArray(bucket.counts)) {
          const counts = parseCounts(bucket.counts as Record<string, unknown>);
          if (counts.size > 0) {
            const batchId = `legacy:${bucket.day as number}`;
            if (totalBatchCount < MAX_BATCHES_TOTAL) {
              installBucket.batches.set(batchId, { day: bucket.day as number, counts });
              totalBatchCount += 1;
              registerBatchRef(iid, batchId, bucket.day as number);
            }
          }
        }
        if (installBucket.batches.size > 0) buckets.set(iid, installBucket);
      }
      for (const [day, map] of raw.daily ?? []) {
        if (!Number.isInteger(day) || !map || typeof map !== "object" || Array.isArray(map)) continue;
        const totals = parseCounts(map);
        if (totals.size > 0) dailyTotals.set(day, totals);
      }
      enforceInstallCap();
    } catch (error) {
      console.error(JSON.stringify({ event: "analytics_state_load_failed", reason: String(error) }));
    }
  }

  function persistState(): void {
    if (!STATE_FILE) return;
    stateDirty = true;
    if (persistTimer) return;
    // Debounce bursts of buckets into one atomic write.
    // .unref() prevents the timer from delaying graceful shutdown.
    persistTimer = setTimeout(() => {
      persistTimer = null;
      if (!stateDirty) return;
      try {
        const tmp = `${STATE_FILE}.tmp`;
        writeFileSync(tmp, JSON.stringify({
          installs: [...installs.entries()],
          buckets: [...buckets.entries()].map(([iid, bucket]) => [
            iid,
            {
              batches: [...bucket.batches.entries()].map(([batchId, contribution]) => [
                batchId,
                { day: contribution.day, counts: Object.fromEntries(contribution.counts) },
              ]),
            },
          ]),
          daily: [...dailyTotals.entries()].map(([day, map]) => [day, Object.fromEntries(map)]),
        }));
        renameSync(tmp, STATE_FILE);
        // Clear the dirty flag ONLY after the atomic rename succeeds.
        // If a crash occurs between writeFileSync and renameSync, the flag
        // stays true and the next startup re-persists the latest state.
        stateDirty = false;
      } catch (error) {
        stateDirty = true;
        console.error(JSON.stringify({ event: "analytics_state_persist_failed", reason: String(error) }));
      }
    }, 2_000);
    persistTimer?.unref();
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

  type ApplyResult = "applied" | "duplicate" | "capacity";

  function applyBucket(
    iid: string,
    counts: Map<string, number>,
    currentDay: number,
    batchId: string | undefined,
  ): ApplyResult {
    pruneOldDays(currentDay);
    const existingInstall = installs.get(iid);
    const bucket = buckets.get(iid) ?? { batches: new Map<string, BatchContribution>() };
    const effectiveBatchId = batchId ?? `legacy:${currentDay}`;
    const previous = bucket.batches.get(effectiveBatchId);

    // A new batch is additive. A duplicate is a successful no-op, which makes
    // retries safe even when the original 204 response was lost in transit.
    if (batchId && previous) {
      accepted += 1;
      return "duplicate";
    }

    // Legacy payloads cannot distinguish partial flushes. Keep their old
    // replace semantics for the same server day, while new batchId payloads
    // retain every partial contribution independently.
    if (
      !previous &&
      (bucket.batches.size >= MAX_BATCHES_PER_INSTALL || totalBatchCount >= MAX_BATCHES_TOTAL)
    ) {
      return "capacity";
    }
    if (previous) {
      removeContribution(iid, bucket, effectiveBatchId);
    }

    const nextInstall = {
      firstDay: existingInstall ? Math.min(existingInstall.firstDay, currentDay) : currentDay,
      lastDay: currentDay,
    };
    installs.set(iid, nextInstall);
    const targetBucket = buckets.get(iid) ?? bucket;
    targetBucket.batches.set(effectiveBatchId, { day: currentDay, counts });
    buckets.set(iid, targetBucket);
    totalBatchCount += 1;
    registerBatchRef(iid, effectiveBatchId, currentDay);

    let totals = dailyTotals.get(currentDay);
    if (!totals) {
      totals = new Map<string, number>();
      dailyTotals.set(currentDay, totals);
    }
    for (const [type, count] of counts) {
      totals.set(type, (totals.get(type) ?? 0) + count);
    }

    enforceInstallCap();
    accepted += 1;
    persistState();
    return "applied";
  }

  /** Validate and normalize a daily bucket; null when invalid. */
  function validateBucket(payload: Record<string, unknown>): { iid: string; counts: Map<string, number>; batchId?: string } | null {
    if (typeof payload.iid !== "string" || !IID_RE.test(payload.iid)) return null;
    if (!payload.counts || typeof payload.counts !== "object" || Array.isArray(payload.counts)) return null;
    const counts = new Map<string, number>();
    for (const [type, value] of Object.entries(payload.counts as Record<string, unknown>)) {
      if (!ANALYTICS_EVENT_TYPES.has(type)) return null;
      if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > MAX_COUNT) return null;
      counts.set(type, value);
    }
    if (counts.size === 0 || counts.size > 32) return null;
    let batchId: string | undefined;
    if (payload.batchId !== undefined) {
      if (typeof payload.batchId !== "string" || !BATCH_ID_RE.test(payload.batchId)) return null;
      batchId = payload.batchId;
    }
    return { iid: payload.iid, counts, batchId };
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
    applySecurityHeaders(res, { includeInterestCohort: false });

    const pathname = req.url
      ? new URL(req.url, "http://localhost").pathname
      : "";
    if (req.method === "GET" && pathname === "/api/analytics/kpis") {
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

    if (req.method !== "POST" || pathname !== "/api/analytics/events") {
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
        const result = applyBucket(validated.iid, validated.counts, day, validated.batchId);
        if (result === "capacity") {
          res.writeHead(503, {
            "Content-Type": "text/plain",
            "Retry-After": "60",
          });
          res.end("Analytics batch capacity temporarily unavailable");
          return;
        }
        console.log(JSON.stringify({
          event: result === "duplicate" ? "analytics_bucket_duplicate" : "analytics_bucket_accepted",
          timestamp: new Date(current).toISOString(),
          day: String(day),
          installs: installs.size,
          types: validated.counts.size,
          hasBatchId: validated.batchId !== undefined,
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


