#!/usr/bin/env node
/**
 * scripts/monitoring-alerts.mjs — 5 precise alerts for production
 *
 * 1. APP CAÍDA — production-smoke (app.html + CSP + COOP + /health +
 *    client-events + WS).
 *    With APP_DOWN_AUTO_ROLLBACK=1, TWO CONSECUTIVE failures of this check
 *    (persisted across cron ticks) trigger rollback.mjs --auto and then
 *    rollback.mjs --verify, which corroborates the recovery BEFORE notifying
 *    the operator: if the verify passes, the cron does not escalate (the
 *    rollback resolved the incident); if the verify fails, it escalates.
 * 2. BUNDLE CORRUPTO — REAL SRI verification: if PROD_BASE_URL serves the
 *    bundle (nginx), download app.html, extract the integrity of the first
 *    script and compare the sha256 of the served resource (what the browser
 *    would do). In environments without a frontend (Docker-free drill / CI),
 *    serve a dist/index.html with BROKEN SRI against an ephemeral static
 *    server and verify that the detector catches the violation — this covers
 *    alert 2 in the drill.
 * 3. MONITORING ACTIVO — verifies monitors, the CSP listener and the nginx proxy
 * 4. CLIENT_CRITICAL — cluster signal: the server logs
 *    `client_events_critical_threshold` when >= 3 distinct clients report a
 *    critical condition in the window (storage-pressure critical, bundle-integrity-spike,
 *    error-spike, csp-violation-spike). This check consumes that log line and
 *    ESCALATES: page (PAGE_CMD) + automatic rollback (AUTO_ROLLBACK=1) with
 *    an anti-loop cooldown.
 * 5. RETRY_DEGRADED — degraded delivery: clients that gave up delivering events
 *    after bounded retries (the server logs `client_events_retry_degraded` on
 *    seeing new drops). When delivery fails, the CLIENT_CRITICAL signal itself
 *    may be blind. It consumes the same log source and PAGES (PAGE_CMD,
 *    cooldown) — never a rollback (it is infra/network delivery health, not a
 *    code regression).
 * 6. API_DEGRADADO — degradation (not an outage): measures the p95 latency and
 *    error-rate of GET /health and of a real business endpoint (by default
 *    POST /api/license/entitlement, the one the app queries at startup to
 *    resolve the plan) over API_PROBE_SAMPLES samples per tick and
 *    persists every measurement in a JSON history bounded to 24h.
 *    Fails if p95 > API_LATENCY_P95_MS or error-rate > API_ERROR_RATE. The p95
 *    over N samples smooths single-request spikes. PAGES (PAGE_CMD,
 *    cooldown) — never a rollback: degradation does not imply a code
 *    regression, and a total outage is already covered by APP_CAIDA.
 *
 * Server usage (cron every 60s):
 *   PROD_BASE_URL=https://your-domain.com SLACK_WEBHOOK=https://hooks.slack.com/... node scripts/monitoring-alerts.mjs
 *   PROD_BASE_URL=http://127.0.0.1:8080 node scripts/monitoring-alerts.mjs --json
 *
 * Env:
 *   CLIENT_EVENTS_WINDOW_MS  cluster window (default 600000 = 10 min)
 *   CLIENT_EVENTS_LOG_FILE   server log path (alternative to docker logs)
 *   CLIENT_EVENTS_LOG_CMD    command to read the log (default: docker compose logs --since <window> api)
 *   AUTO_ROLLBACK=1          runs the automatic rollback when the cluster is detected
 *   APP_DOWN_AUTO_ROLLBACK=1 automatic rollback on APP_CAIDA x2 consecutive
 *   APP_DOWN_THRESHOLD       consecutive APP_CAIDA that trigger it (default 2)
 *   ROLLBACK_CMD             rollback command (default: node scripts/rollback.mjs --auto)
 *   ROLLBACK_COOLDOWN_MS     minimum between page/rollback (default 600000)
 *   PAGE_CMD                 paging command (e.g. /usr/local/bin/bmf-page.sh)
 *   MONITOR_STATE_FILE       dedup state (default .monitor-state.json)
 *   API_PROBE_SAMPLES        /health latency samples per tick (default 10)
 *   API_PROBE_TIMEOUT_MS     timeout per sample (default 5000 ms)
 *   API_LATENCY_P95_MS       p95 latency threshold (default 1000 ms)
 *   API_ERROR_RATE           error-rate threshold (default 0.2 = 20 %)
 *   API_PROBE_BUSINESS_PATH  business endpoint (default /api/license/entitlement)
 *   MONITORING_NGINX_CONFIG  path to the generated nginx config (default public/nginx.conf)
 *   API_HISTORY_FILE         JSON metrics history (default .api-degradation-history.json)
 *
 * Uses the same runApiSurfaceChecks as production-smoke.mjs — it does not
 * duplicate logic.
 */

import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { runCommandLine } from "./command-runner.mjs";

const PROD_BASE_URL = process.env.PROD_BASE_URL ?? "http://127.0.0.1:8080";
const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK ?? "";
const isJson = process.argv.includes("--json");

// ── client-events cluster signal (log → page + rollback) ────────────────
const CLIENT_EVENTS_WINDOW_MS = Number(process.env.CLIENT_EVENTS_WINDOW_MS ?? 600_000);
const LOG_FILE = process.env.CLIENT_EVENTS_LOG_FILE?.trim() ?? "";
const windowMinutes = Math.max(1, Math.round(CLIENT_EVENTS_WINDOW_MS / 60000));
const LOG_CMD =
  process.env.CLIENT_EVENTS_LOG_CMD?.trim() ??
  `docker compose logs --since ${windowMinutes}m api`;
const PAGE_CMD = process.env.PAGE_CMD?.trim() ?? "";
const AUTO_ROLLBACK = process.env.AUTO_ROLLBACK === "1";
const ROLLBACK_CMD = process.env.ROLLBACK_CMD?.trim() ?? "node scripts/rollback.mjs --auto";
const ROLLBACK_VERIFY_CMD = process.env.ROLLBACK_VERIFY_CMD?.trim() ?? "node scripts/rollback.mjs --verify";
const DOCKER_REGISTRY = (process.env.DOCKER_REGISTRY ?? "").trim().replace(/\/+$/, "");
const ROLLBACK_COOLDOWN_MS = Number(process.env.ROLLBACK_COOLDOWN_MS ?? 600_000);
const MONITOR_STATE_FILE = process.env.MONITOR_STATE_FILE ?? ".monitor-state.json";

// ── Degradation (API_DEGRADADO): p95 latency + error-rate of /health ───
// The p95 over N samples per tick smooths isolated spikes. Thresholds
// configurable via env; it NEVER triggers a rollback.
const API_PROBE_SAMPLES = Number(process.env.API_PROBE_SAMPLES ?? 10);
const API_PROBE_TIMEOUT_MS = Number(process.env.API_PROBE_TIMEOUT_MS ?? 5_000);
const API_LATENCY_P95_MS = Number(process.env.API_LATENCY_P95_MS ?? 1_000);
const API_ERROR_RATE = Number(process.env.API_ERROR_RATE ?? 0.2);
// The business probe must hit a route the companion server actually serves.
// `POST /api/license/entitlement` is the real business path: the app calls it
// on startup to resolve Pro vs free, it is public, it answers 200 for any
// caller (an unverifiable proof is an authoritative "free", not an error) and
// it never mutates state.
const API_PROBE_BUSINESS_PATH = process.env.API_PROBE_BUSINESS_PATH ?? "/api/license/entitlement";
const API_HISTORY_FILE = process.env.API_HISTORY_FILE ?? ".api-degradation-history.json";
const API_HISTORY_WINDOW_MS = 24 * 60 * 60 * 1000;
const API_HISTORY_MAX_ENTRIES = 1_440;

// Auto-rollback on APP_CAIDA: when the app check fails TWICE IN A ROW
// (consecutive count persisted across cron ticks), rollback.mjs --auto is
// invoked and then CONFIRMED with `rollback.mjs --verify` BEFORE notifying the
// operator. Fail-closed: only with APP_DOWN_AUTO_ROLLBACK=1.
const APP_DOWN_AUTO_ROLLBACK = process.env.APP_DOWN_AUTO_ROLLBACK === "1";
// Consecutive APP_CAIDA failures that trigger a rollback (2 = two ticks in a row).
const APP_DOWN_THRESHOLD = Number(process.env.APP_DOWN_THRESHOLD ?? 2);

// Kept as the single integration point for future API-surface checks.
async function checkAppDown() {
  try {
    // Use production-smoke's static + api checks
    const { spawnSync } = await import("node:child_process");
    const r = spawnSync(process.execPath, ["scripts/production-smoke.mjs"], {
      encoding: "utf8",
      env: { ...process.env, PROD_BASE_URL },
      // Hard cap: a hung smoke must never block the monitoring cron (a
      // 60s-per-run cron overlapping itself would stack alerts).
      timeout: 60_000,
    });
    const ok = r.status === 0;
    return { name: "APP_CAIDA", ok, detail: ok ? "production-smoke PASS" : (r.stdout + r.stderr).slice(-500) };
  } catch (e) {
    return { name: "APP_CAIDA", ok: false, detail: String(e) };
  }
}

function sha256Base64(bytes) {
  return createHash("sha256").update(bytes).digest("base64");
}

/**
 * Browser integrity algorithm (SRI spec): the resource is accepted if any of
 * the space-separated hashes (sha256/sha384/sha512) matches the digest of the
 * served body. A mismatch = the browser would block the script and report a
 * SecurityPolicyViolation.
 */
export function integrityMatches(integrity, body) {
  for (const spec of integrity.split(/\s+/)) {
    const m = spec.match(/^(sha256|sha384|sha512)-([A-Za-z0-9+/=]+)$/);
    if (!m) continue;
    const actual = createHash(m[1]).update(body).digest("base64");
    if (actual === m[2]) return true;
  }
  return false;
}

/**
 * Verifies the SRI of the served SPA bundle the way the browser would:
 * extract the integrity of the first <script>, download the resource and
 * compare its digest.
 *
 * ADR-028: gate drift — since the marketing/SPA split the bundle lives at
 * /app.html (/index.html is the marketing page and serves no SRI scripts),
 * so probe app.html first and fall back to index.html for older
 * deployments. Returns null if the base does NOT serve an html with
 * scripts (→ the caller uses the Docker-free probe).
 */
export async function verifyBundleSri(baseUrl) {
  let html = null;
  for (const page of ["app.html", "index.html"]) {
    let res;
    try {
      res = await fetch(`${baseUrl}/${page}`);
    } catch {
      return null; // unreachable server: no served bundle
    }
    if (!res.ok) continue;
    const body = await res.text();
    if (body.includes("<script")) {
      html = body;
      break;
    }
  }
  if (html === null) return null;

  let target = null;
  for (const match of html.matchAll(/<script\b([^>]*)>/gi)) {
    const attrs = match[1] ?? "";
    const src = attrs.match(/\bsrc=["']([^"']+)["']/)?.[1];
    const integrity = attrs.match(/\bintegrity=["']([^"']+)["']/)?.[1];
    if (src && integrity) {
      target = { src, integrity };
      break;
    }
  }
  if (!target) {
    return {
      mode: "served",
      ok: false,
      detail: `the served bundle (${baseUrl}/app.html) declares no integrity in its scripts — the browser could not verify SRI`,
    };
  }

  const assetUrl = new URL(target.src, `${baseUrl}/`).href;
  let assetRes;
  try {
    assetRes = await fetch(assetUrl);
  } catch (e) {
    return { mode: "served", ok: false, detail: `could not download ${target.src}: ${String(e)}` };
  }
  if (!assetRes.ok) {
    return { mode: "served", ok: false, detail: `could not download ${target.src} (HTTP ${assetRes.status})` };
  }
  const body = Buffer.from(await assetRes.arrayBuffer());
  const actual = sha256Base64(body);
  const ok = integrityMatches(target.integrity, body);
  return {
    mode: "served",
    ok,
    detail: ok
      ? `served SRI OK (${actual.slice(0, 12)}…)`
      : `BROKEN SRI — integrity=${target.integrity.slice(0, 24)}… actual=${actual.slice(0, 24)}… (the browser would block the script)`,
  };
}

/**
 * Docker-free probe (drill / CI without a frontend): serves a dist/index.html
 * with BROKEN SRI on purpose against an ephemeral static server and runs the
 * same verification. PASS = the detector CATCHES the mismatch (the browser
 * would report the violation); FAIL = the detector is broken.
 */
async function probeBrokenSri() {
  const { createServer } = await import("node:http");
  const GOOD = "/* healthy bundle */";
  const CORRUPTED = "/* CORRUPTED bundle — the browser must block it */";
  const html = `<!doctype html><script src="/app.js" integrity="sha256-${sha256Base64(Buffer.from(GOOD))}"></script>`;
  let server;
  try {
    server = createServer((req, res) => {
      res.setHeader("content-type", req.url === "/app.js" ? "text/javascript" : "text/html");
      res.end(req.url === "/app.js" ? CORRUPTED : html);
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    const result = await verifyBundleSri(`http://127.0.0.1:${port}`);
    const detected = Boolean(result && result.mode === "served" && result.ok === false);
    return {
      mode: "probe",
      ok: detected,
      detail: detected
        ? "SRI probe: served HTML with BROKEN SRI → violation DETECTED (the browser would report it) ✓"
        : `SRI probe FAILED — the detector did not catch the broken SRI (${result?.detail ?? "no result"})`,
    };
  } catch (e) {
    return { mode: "probe", ok: false, detail: `the SRI probe could not run: ${e.message}` };
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
  }
}

async function checkBundleCorrupto() {
  try {
    // Prod mode: verifies the REAL served bundle (nginx → index.html).
    const served = await verifyBundleSri(PROD_BASE_URL);
    if (served) {
      return { name: "BUNDLE_CORRUPTO", ok: served.ok, detail: `[served] ${served.detail}` };
    }
    // Docker-free drill mode: probe with broken SRI (covers alert 2).
    const probe = await probeBrokenSri();
    return { name: "BUNDLE_CORRUPTO", ok: probe.ok, detail: probe.detail };
  } catch (e) {
    return { name: "BUNDLE_CORRUPTO", ok: false, detail: String(e) };
  }
}

/**
 * CLIENT_CRITICAL — cluster signal from the companion server log.
 * The server emits `client_events_critical_threshold` (JSON, with timestamp)
 * when >= CLIENT_EVENTS_CRITICAL_CLIENTS distinct clients reported a
 * critical condition within the window. Source: CLIENT_EVENTS_LOG_FILE (tail
 * of the file) or CLIENT_EVENTS_LOG_CMD (default docker compose logs). Lines
 * are filtered by timestamp within the window; if the timestamp does not
 * parse, they are counted (the source already bounds recency with --since /
 * tail). Fail-closed: if the log CANNOT be read, the check fails (an
 * undetected cluster is worse than a false positive from an unreadable log).
 */
/**
 * Parses server log lines for the structured client critical threshold event.
 * Returns an explicit alert when any fresh threshold line is present. Lines
 * without a parseable timestamp are counted because LOG_CMD already bounds
 * the source with --since; timestamped lines outside the window are ignored.
 */
export function parseClientCriticalLog(text, now = Date.now(), windowMs = CLIENT_EVENTS_WINDOW_MS) {
  const cutoff = now - windowMs;
  let clusterEvents = 0;
  let maxCriticalClients = 0;
  for (const line of String(text ?? "").split("\n")) {
    if (!line.includes("client_events_critical_threshold")) continue;
    let timestamp = now;
    const timestampMatch = line.match(/"timestamp"\s*:\s*"([^"]+)"/);
    const parsed = timestampMatch ? Date.parse(timestampMatch[1]) : NaN;
    if (!Number.isNaN(parsed)) timestamp = parsed;
    if (timestamp < cutoff) continue;
    // Every fresh line collapses into ONE aggregated alert per tick (avoids
    // double paging from re-arms of the same window), but the reported
    // severity is the MAXIMUM of critical clients observed in the window:
    // paging below the worst severity is worse than a redundant detail.
    const clientsMatch = line.match(/"criticalClients"\s*:\s*(\d+)/);
    const criticalClients = clientsMatch ? Number(clientsMatch[1]) : 0;
    clusterEvents = 1;
    if (criticalClients > maxCriticalClients) maxCriticalClients = criticalClients;
  }
  return {
    ok: clusterEvents === 0,
    clusterEvents,
    maxCriticalClients,
  };
}

/**
 * Reads the client-events log source (tail of a file or a docker command).
 * Returns `{ text }` or `{ error }` — shared by CLIENT_CRITICAL and
 * RETRY_DEGRADED so both see exactly the same source.
 */
async function readClientEventsLog(logFile, logCmd) {
  const { existsSync, openSync, readSync, closeSync, statSync } = await import("node:fs");
  if (logFile) {
    if (!existsSync(logFile)) return { error: `log not readable (${logFile}) — fail-closed` };
    const size = statSync(logFile).size;
    const len = Math.min(size, 1_000_000);
    const buf = Buffer.alloc(len);
    const fd = openSync(logFile, "r");
    try {
      let offset = 0;
      while (offset < len) {
        const n = readSync(fd, buf, offset, len - offset, size - len + offset);
        if (n <= 0) break;
        offset += n;
      }
    } finally {
      closeSync(fd);
    }
    return { text: buf.toString("utf8") };
  }
  const r = runCommandLine(logCmd, { encoding: "utf8", timeout: 30_000 });
  if (r.status !== 0 && !(r.stdout ?? "") && !(r.stderr ?? "")) {
    return { error: `log not readable (${logCmd}) — fail-closed` };
  }
  return { text: (r.stdout ?? "") + (r.stderr ?? "") };
}

export async function checkClientCritical({
  logFile = LOG_FILE,
  logCmd = LOG_CMD,
  now = Date.now(),
  windowMs = CLIENT_EVENTS_WINDOW_MS,
} = {}) {
  try {
    const read = await readClientEventsLog(logFile, logCmd);
    if (read.error) {
      return { name: "CLIENT_CRITICAL", ok: false, detail: read.error };
    }

    const parsed = parseClientCriticalLog(read.text, now, windowMs);
    const { ok, clusterEvents, maxCriticalClients } = parsed;
    const sourceWindowMinutes = Math.max(1, Math.round(windowMs / 60000));
    return {
      name: "CLIENT_CRITICAL",
      ok,
      detail: ok
        ? `no client_events_critical_threshold in ${sourceWindowMinutes}min`
        : `${clusterEvents} cluster event(s) in ${sourceWindowMinutes}min — criticalClients>=${maxCriticalClients || 3}`,
      clusterEvents,
    };
  } catch (e) {
    return { name: "CLIENT_CRITICAL", ok: false, detail: String(e) };
  }
}

/**
 * Parses server log lines for `client_events_retry_degraded` (clients gave
 * up delivering events after the bounded retries — the CLIENT_CRITICAL
 * signal itself may be blind). Same window/collapse semantics as
 * parseClientCriticalLog: any fresh line collapses to one alert per tick,
 * reporting the max number of events lost.
 */
export function parseRetryDegradedLog(text, now = Date.now(), windowMs = CLIENT_EVENTS_WINDOW_MS) {
  const cutoff = now - windowMs;
  let degradedEvents = 0;
  let maxNewDropped = 0;
  for (const line of String(text ?? "").split("\n")) {
    if (!line.includes("client_events_retry_degraded")) continue;
    let timestamp = now;
    const timestampMatch = line.match(/"timestamp"\s*:\s*"([^"]+)"/);
    const parsed = timestampMatch ? Date.parse(timestampMatch[1]) : NaN;
    if (!Number.isNaN(parsed)) timestamp = parsed;
    if (timestamp < cutoff) continue;
    const droppedMatch = line.match(/"newDropped"\s*:\s*(\d+)/);
    const newDropped = droppedMatch ? Number(droppedMatch[1]) : 0;
    degradedEvents = 1;
    if (newDropped > maxNewDropped) maxNewDropped = newDropped;
  }
  return {
    ok: degradedEvents === 0,
    degradedEvents,
    maxNewDropped,
  };
}

export async function checkRetryDegraded({
  logFile = LOG_FILE,
  logCmd = LOG_CMD,
  now = Date.now(),
  windowMs = CLIENT_EVENTS_WINDOW_MS,
} = {}) {
  try {
    const read = await readClientEventsLog(logFile, logCmd);
    if (read.error) {
      return { name: "RETRY_DEGRADED", ok: false, detail: read.error };
    }
    const parsed = parseRetryDegradedLog(read.text, now, windowMs);
    const { ok, degradedEvents, maxNewDropped } = parsed;
    const sourceWindowMinutes = Math.max(1, Math.round(windowMs / 60000));
    return {
      name: "RETRY_DEGRADED",
      ok,
      detail: ok
        ? `no client_events_retry_degraded in ${sourceWindowMinutes}min`
        : `${degradedEvents} degraded delivery signal(s) in ${sourceWindowMinutes}min — +${maxNewDropped} events lost`,
      degradedEvents,
    };
  } catch (e) {
    return { name: "RETRY_DEGRADED", ok: false, detail: String(e) };
  }
}

/**
 * API_DEGRADADO — degradation, not an outage: p95 latency + error-rate of
 * GET /health and a business endpoint over `samples` samples per tick.
 * Failure = p95 > latencyThresholdMs
 * or error-rate > errorRateThreshold. Never a rollback: degradation does
 * not imply a code regression; a total outage is covered by APP_CAIDA.
 */
function isApiHistoryEntry(entry) {
  return entry && Number.isFinite(entry.timestamp) && Number.isFinite(entry.p95Ms) && Number.isFinite(entry.errorRate);
}

export function readApiHistory(file = API_HISTORY_FILE, now = Date.now()) {
  try {
    const entries = JSON.parse(readFileSync(file, "utf8"));
    if (!Array.isArray(entries)) return [];
    return entries
      .filter((entry) => isApiHistoryEntry(entry) && now - entry.timestamp <= API_HISTORY_WINDOW_MS)
      .slice(-API_HISTORY_MAX_ENTRIES);
  } catch {
    return [];
  }
}

export function writeApiHistory(entry, file = API_HISTORY_FILE, now = Date.now()) {
  const history = [...readApiHistory(file, now), entry]
    .filter((item) => isApiHistoryEntry(item) && now - item.timestamp <= API_HISTORY_WINDOW_MS)
    .slice(-API_HISTORY_MAX_ENTRIES);
  try {
    const temporary = `${file}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(history, null, 2)}\n`);
    renameSync(temporary, file);
  } catch {
    // Metrics persistence is best-effort; it must never break monitoring.
  }
  return history;
}

export function summarizeApiHistory(history, now = Date.now()) {
  const recent = history.filter((entry) => isApiHistoryEntry(entry) && now - entry.timestamp <= API_HISTORY_WINDOW_MS);
  if (recent.length === 0) return { samples: 0, averageP95Ms: null, maxP95Ms: null, averageErrorRate: null, degradedTicks: 0 };
  const average = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    samples: recent.length,
    averageP95Ms: Math.round(average(recent.map((entry) => entry.p95Ms))),
    maxP95Ms: Math.max(...recent.map((entry) => entry.p95Ms)),
    averageErrorRate: average(recent.map((entry) => entry.errorRate)),
    degradedTicks: recent.filter((entry) => entry.ok === false).length,
    since: new Date(Math.min(...recent.map((entry) => entry.timestamp))).toISOString(),
  };
}

export async function checkApiDegradado({
  baseUrl = PROD_BASE_URL,
  samples = API_PROBE_SAMPLES,
  timeoutMs = API_PROBE_TIMEOUT_MS,
  latencyThresholdMs = API_LATENCY_P95_MS,
  errorRateThreshold = API_ERROR_RATE,
} = {}) {
  const normalizedBase = String(baseUrl).replace(/\/+$/, "");
  const probes = [
    { name: "health", url: `${normalizedBase}/health`, init: { method: "GET" } },
    {
      name: "business",
      url: `${normalizedBase}${API_PROBE_BUSINESS_PATH.startsWith("/") ? API_PROBE_BUSINESS_PATH : `/${API_PROBE_BUSINESS_PATH}`}`,
      init: { method: "POST", headers: { "content-type": "application/json", origin: normalizedBase }, body: JSON.stringify({}), },
    },
  ];
  const latencies = [];
  let errors = 0;
  let businessErrors = 0;
  for (let i = 0; i < samples; i += 1) {
    for (const probe of probes) {
      const started = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(probe.url, { ...probe.init, signal: controller.signal, cache: "no-store" });
        latencies.push(Date.now() - started);
        if (!res.ok) {
          // The business probe is deliberately unauthenticated: a 4xx from
          // /api/license/entitlement (missing/refused origin, rate limit) is
          // policy, not degradation — counting it as an error would page 24/7.
          // Only a 5xx (or a transport failure) is a real degradation.
          const policyResponse = probe.name === "business" && res.status < 500;
          if (!policyResponse) {
            errors += 1;
            if (probe.name === "business") businessErrors += 1;
          }
        }
      } catch {
        errors += 1;
        if (probe.name === "business") businessErrors += 1;
      } finally {
        clearTimeout(timer);
      }
    }
  }
  const sorted = latencies.sort((a, b) => a - b);
  const p95Ms =
    sorted.length > 0 ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * 0.95) - 1))] : 0;
  const totalProbes = samples * probes.length;
  const errorRate = totalProbes > 0 ? errors / totalProbes : 1;
  const ok = p95Ms <= latencyThresholdMs && errorRate <= errorRateThreshold;
  const ratePct = Math.round(errorRate * 100);
  const thresholdPct = Math.round(errorRateThreshold * 100);
  const historyEntry = {
    timestamp: Date.now(),
    ok,
    p95Ms,
    errorRate,
    businessErrors,
    samples,
    totalProbes,
  };
  const history = writeApiHistory(historyEntry);
  const trend = summarizeApiHistory(history);
  return {
    name: "API_DEGRADADO",
    ok,
    detail: ok
      ? `p95 ${p95Ms}ms (threshold ${latencyThresholdMs}ms) · error-rate ${ratePct}% (threshold ${thresholdPct}%) · ${samples} health+business rounds`
      : `DEGRADED — p95 ${p95Ms}ms (threshold ${latencyThresholdMs}ms) · error-rate ${ratePct}% (threshold ${thresholdPct}%) · ${errors}/${totalProbes} failures (${businessErrors} business)`,
    p95Ms,
    errorRate,
    samples,
    totalProbes,
    businessErrors,
    businessPath: API_PROBE_BUSINESS_PATH,
    trend,
  };
}

// API surface is exercised by production-smoke; this monitor only verifies
// the client-side monitoring sources are present.
/**
 * Cooldown gate for page/rollback actions triggered by CLIENT_CRITICAL.
 * Strictly greater-than matches the existing anti-loop behavior: at exactly
 * the cooldown boundary, keep the action suppressed.
 */
export function shouldRunClientCriticalAction(lastActionAt, now = Date.now(), cooldownMs = ROLLBACK_COOLDOWN_MS) {
  return now - (Number(lastActionAt) || 0) > cooldownMs;
}

export async function checkMonitoringActivo({ root = process.cwd(), nginxPath = process.env.MONITORING_NGINX_CONFIG ?? "public/nginx.conf" } = {}) {
  try {
    const { readFileSync, existsSync } = await import("node:fs");
    const { join, resolve } = await import("node:path");
    const checks = [
      ["src/utils/storageMonitor.ts", "startStorageMonitor"],
      ["src/telemetry/productionMonitor.ts", "initProductionMonitor"],
      ["src/utils/bundleIntegrity.ts", "bundle-integrity-failed"],
      // This listener is the bridge from browser CSP reports to client-events.
      ["src/services/clientEventReporter.ts", "csp-violation-spike"],
    ];
    const missing = [];
    for (const [file, token] of checks) {
      const p = join(root, file);
      if (!existsSync(p) || !readFileSync(p, "utf8").includes(token)) missing.push(`${file} (${token})`);
    }

    const nginxFile = resolve(root, nginxPath);
    const nginx = existsSync(nginxFile) ? readFileSync(nginxFile, "utf8") : "";
    const nginxRoute = /location\s*=\s*\/api\/client-events(?:\/retry-stats)?[\s\S]*?proxy_pass\s+http:\/\/bookmarkforge_api:8787\/api\/client-events(?:\/retry-stats)?;/.test(nginx);
    if (!nginxRoute) missing.push(`${nginxPath} (/api/client-events proxy)`);

    const ok = missing.length === 0;
    return {
      name: "MONITORING_ACTIVO",
      ok,
      detail: ok
        ? "4 monitors + csp-violation-spike listener + nginx proxy present"
        : `missing: ${missing.join(", ")}`,
    };
  } catch (e) {
    return { name: "MONITORING_ACTIVO", ok: false, detail: String(e) };
  }
}

/**
 * Orderly process exit — critical on Windows.
 * An immediate `process.exit()` while undici (fetch) keeps keep-alive sockets
 * open triggers a native libuv crash on Windows
 * (exit 0xC0000409 / "Assertion failed ... src\\win\\async.c") because the
 * process teardown closes the network handles mid-close.
 * Instead: close undici's global dispatcher cleanly and let the event loop
 * drain on its own with `process.exitCode` (a 5s failsafe in case
 * something ref'd keeps the loop alive).
 */
let shutdownFailsafeTimer = null;
export async function shutdownExit(code) {
  process.exitCode = code;
  try {
    const { getGlobalDispatcher } = await import("undici");
    await Promise.race([
      getGlobalDispatcher().close().catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, 3_000)),
    ]);
  } catch {
    // undici is not importable: the loop's natural drain will close the
    // sockets via the keep-alive timeout; the failsafe below forces the exit.
  }
  // Failsafe: if something ref'd keeps the loop alive (fs threadpool, timers),
  // we force the exit after a grace period — with no undici sockets left open.
  shutdownFailsafeTimer = setTimeout(() => process.exit(process.exitCode ?? code), 5_000).unref();
}

/** Cancels the shutdownExit failsafe — used by the tests so the unref'd
 * timer does not fire process.exit() halfway through the suite. */
export function cancelShutdownFailsafe() {
  if (shutdownFailsafeTimer) {
    clearTimeout(shutdownFailsafeTimer);
    shutdownFailsafeTimer = null;
  }
}

const isMain =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
const results = [
  await checkAppDown(),
  await checkBundleCorrupto(),
  await checkMonitoringActivo(),
  await checkClientCritical(),
  await checkRetryDegraded(),
  await checkApiDegradado(),
];

const allOk = results.every((r) => r.ok);

// Set to true when APP_CAIDA triggers a rollback + verify and the app
// recovers: in that case the cron does NOT notify the operator (the rollback
// already resolved the incident before the alert arrived).
let skipOperatorNotify = false;

// ── Escalation: APP_CAIDA ×2 consecutive → rollback + verify, then ───
// ── notify the operator only if the verify fails after the rollback ──
// An isolated smoke failure does not trigger a rollback (it may be a momentary
// timeout); TWO in a row DO mean a genuinely down app. The counter is
// persisted in MONITOR_STATE_FILE to survive the 60s cron ticks. On detecting
// the second: rollback.mjs --auto and then rollback.mjs --verify (which runs
// the same smoke). Only if the verify also fails does the cron escalate to the
// operator (Slack).
const appDown = results.find((r) => r.name === "APP_CAIDA");
if (appDown && !appDown.ok) {
  let state = {};
  try {
    state = JSON.parse(readFileSync(MONITOR_STATE_FILE, "utf8"));
  } catch { /* INTENTIONAL SILENCE: state file missing/corrupt — start from empty state; monitoring continues. */ }
  const consecutive = (state.appDownConsecutive ?? 0) + 1;
  state.appDownConsecutive = consecutive;
  try {
    writeFileSync(MONITOR_STATE_FILE, JSON.stringify(state));
  } catch { /* INTENTIONAL SILENCE: state persistence is best-effort; the in-memory decision for this tick still stands. */ }
  console.error(`[monitor] consecutive APP_CAIDA #${consecutive} (rollback triggers at #${APP_DOWN_THRESHOLD})`);

  if (consecutive >= APP_DOWN_THRESHOLD) {
    // Reset the counter (once fired) so an ongoing failure does not trigger
    // on every tick; the verify decides whether to escalate.
    state.appDownConsecutive = 0;
    try {
      writeFileSync(MONITOR_STATE_FILE, JSON.stringify(state));
    } catch { /* INTENTIONAL SILENCE: state persistence is best-effort; the in-memory decision for this tick still stands. */ }

    if (APP_DOWN_AUTO_ROLLBACK) {
      console.error(`[monitor] APP_CAIDA ×${APP_DOWN_THRESHOLD} consecutive → rollback: ${ROLLBACK_CMD}`);
      let rollbackStatus = -1;
      try {
        const r = runCommandLine(ROLLBACK_CMD, {
          encoding: "utf8",
          timeout: 180_000,
          env: { ...process.env, PROD_BASE_URL, ...(DOCKER_REGISTRY ? { DOCKER_REGISTRY } : {}) },
        });
        rollbackStatus = r.status;
      } catch (e) {
        console.error(`[monitor] ROLLBACK FAILED: ${e.message}`);
      }

      if (rollbackStatus === 0) {
        // Post-rollback confirmation: rollback.mjs --verify runs the smoke.
        console.error("[monitor] rollback OK (exit 0) — confirming with --verify...");
        let verifyStatus = -1;
        try {
          const v = runCommandLine(ROLLBACK_VERIFY_CMD, {
            encoding: "utf8",
            stdio: "inherit",
            timeout: 120_000,
            env: { ...process.env, PROD_BASE_URL, ...(DOCKER_REGISTRY ? { DOCKER_REGISTRY } : {}) },
          });
          verifyStatus = v.status;
        } catch (e) {
          console.error(`[monitor] VERIFY FAILED: ${e.message}`);
        }
        if (verifyStatus === 0) {
          // App recovered — do not notify the operator: the rollback resolved
          // the incident before the alert arrived.
          skipOperatorNotify = true;
          console.error("[monitor] VERIFY OK post-rollback — app recovered, no operator notification.");
        } else {
          console.error(
            `[monitor] VERIFY FAIL post-rollback (exit ${verifyStatus}) — the app did NOT recover. ESCALATE manually: ${ROLLBACK_CMD}`,
          );
        }
      } else {
        console.error(`[monitor] ROLLBACK FAILED (exit ${rollbackStatus}) — the app is still down. ESCALATE manually: ${ROLLBACK_CMD}`);
      }
    } else {
      console.error(`[monitor] APP_DOWN_AUTO_ROLLBACK not set — NO rollback was run. Run: ${ROLLBACK_CMD}`);
    }
  }
} else if (appDown) {
  // The app is responding again — reset the counter for the next streak.
  let state = {};
  try {
    state = JSON.parse(readFileSync(MONITOR_STATE_FILE, "utf8"));
  } catch { /* INTENTIONAL SILENCE: state file missing/corrupt — start from empty state; monitoring continues. */ }
  if (state.appDownConsecutive) {
    state.appDownConsecutive = 0;
    try {
      writeFileSync(MONITOR_STATE_FILE, JSON.stringify(state));
    } catch { /* INTENTIONAL SILENCE: state persistence is best-effort; the in-memory decision for this tick still stands. */ }
    console.error("[monitor] APP_CAIDA recovered — consecutive counter reset.");
  }
}

// ── Escalation: CLIENT_CRITICAL → page + automatic rollback ─────────────
// The cluster event is already a strong signal (>= 3 critical clients): it
// escalates on the FIRST occurrence, deduplicated by cooldown so the log
// window (10 min) does not re-trigger on every 60s cron tick.
const clientCritical = results.find((r) => r.name === "CLIENT_CRITICAL");
if (clientCritical && !clientCritical.ok) {
  let state = {};
  try {
    state = JSON.parse(readFileSync(MONITOR_STATE_FILE, "utf8"));
  } catch { /* INTENTIONAL SILENCE: state file missing/corrupt — start from empty state; monitoring continues. */ }
  const now = Date.now();
  const lastAction = state.clientCriticalActionAt ?? 0;

  if (shouldRunClientCriticalAction(lastAction, now, ROLLBACK_COOLDOWN_MS)) {
    state.clientCriticalActionAt = now;
    state.lastClusterDetail = clientCritical.detail;
    try {
      writeFileSync(MONITOR_STATE_FILE, JSON.stringify(state));
    } catch { /* INTENTIONAL SILENCE: state persistence is best-effort; the in-memory decision for this tick still stands. */ }

    // 1) Page (noisy notification) — e.g. /usr/local/bin/bmf-page.sh
    if (PAGE_CMD) {
      try {
        runCommandLine(PAGE_CMD, {
          encoding: "utf8",
          timeout: 30_000,
          env: { ...process.env, CLUSTER_DETAIL: clientCritical.detail },
        });
        console.error(`[monitor] PAGE sent (${PAGE_CMD})`);
      } catch { /* INTENTIONAL SILENCE: a failing page command must not abort escalation or the monitor tick. */ }
    }

    // 2) Automatic rollback (fail-closed: only with AUTO_ROLLBACK=1)
    if (AUTO_ROLLBACK) {
      console.error(`[monitor] CLIENT_CRITICAL → automatic rollback: ${ROLLBACK_CMD}`);
      try {
        const r = runCommandLine(ROLLBACK_CMD, {
          encoding: "utf8",
          timeout: 180_000,
          env: { ...process.env, PROD_BASE_URL, ...(DOCKER_REGISTRY ? { DOCKER_REGISTRY } : {}) },
        });
        if (r.status === 0) {
          console.error("[monitor] rollback OK (exit 0)");
        } else {
          console.error(`[monitor] ROLLBACK FAILED (exit ${r.status}) — escalate manually: ${ROLLBACK_CMD}`);
        }
      } catch (e) {
        console.error(`[monitor] ROLLBACK FAILED: ${e.message}`);
      }
    } else {
      console.error(`[monitor] AUTO_ROLLBACK not set — NO rollback was run. Run: ${ROLLBACK_CMD}`);
    }
  } else {
    console.error(`[monitor] cooldown active (${Math.round((now - lastAction) / 1000)}s since the last action) — no new page/rollback`);
  }
}

// ── Escalation: RETRY_DEGRADED → page (no rollback) ───────────────────
// Clients that gave up delivering events after bounded retries: the
// CLIENT_CRITICAL signal itself may be blind. It is delivery health
// (infra/network), NOT a code regression — page with a cooldown, never an
// automatic rollback.
const retryDegraded = results.find((r) => r.name === "RETRY_DEGRADED");
if (retryDegraded && !retryDegraded.ok) {
  let state = {};
  try {
    state = JSON.parse(readFileSync(MONITOR_STATE_FILE, "utf8"));
  } catch { /* INTENTIONAL SILENCE: state file missing/corrupt — start from empty state; monitoring continues. */ }
  const now = Date.now();
  const lastAction = state.retryDegradedActionAt ?? 0;

  if (shouldRunClientCriticalAction(lastAction, now, ROLLBACK_COOLDOWN_MS)) {
    state.retryDegradedActionAt = now;
    state.lastRetryDegradedDetail = retryDegraded.detail;
    try {
      writeFileSync(MONITOR_STATE_FILE, JSON.stringify(state));
    } catch { /* INTENTIONAL SILENCE: state persistence is best-effort; the in-memory decision for this tick still stands. */ }

    if (PAGE_CMD) {
      try {
        runCommandLine(PAGE_CMD, {
          encoding: "utf8",
          timeout: 30_000,
          env: { ...process.env, CLUSTER_DETAIL: retryDegraded.detail },
        });
        console.error(`[monitor] PAGE sent for degraded delivery (${PAGE_CMD})`);
      } catch { /* INTENTIONAL SILENCE: a failing page command must not abort escalation or the monitor tick. */ }
    } else {
      console.error(`[monitor] RETRY_DEGRADED without PAGE_CMD — define PAGE_CMD to page on degraded delivery`);
    }
  } else {
    console.error(`[monitor] degraded delivery cooldown active (${Math.round((now - lastAction) / 1000)}s) — no new page`);
  }
}

// ── Escalation: API_DEGRADADO → page (no rollback) ────────────────────
// Degradation (p95/error-rate over the threshold), not an outage: page with
// a cooldown — never an automatic rollback (CLIENT_CRITICAL/BUNDLE cover
// code regressions; APP_CAIDA covers a total collapse).
const apiDegraded = results.find((r) => r.name === "API_DEGRADADO");
if (apiDegraded && !apiDegraded.ok) {
  let state = {};
  try {
    state = JSON.parse(readFileSync(MONITOR_STATE_FILE, "utf8"));
  } catch { /* INTENTIONAL SILENCE: state file missing/corrupt — start from empty state; monitoring continues. */ }
  const now = Date.now();
  const lastAction = state.apiDegradedActionAt ?? 0;

  if (shouldRunClientCriticalAction(lastAction, now, ROLLBACK_COOLDOWN_MS)) {
    state.apiDegradedActionAt = now;
    state.lastApiDegradedDetail = apiDegraded.detail;
    try {
      writeFileSync(MONITOR_STATE_FILE, JSON.stringify(state));
    } catch { /* INTENTIONAL SILENCE: state persistence is best-effort; the in-memory decision for this tick still stands. */ }

    if (PAGE_CMD) {
      try {
        runCommandLine(PAGE_CMD, {
          encoding: "utf8",
          timeout: 30_000,
          env: { ...process.env, CLUSTER_DETAIL: apiDegraded.detail },
        });
        console.error(`[monitor] PAGE sent for degradation (${PAGE_CMD})`);
      } catch { /* INTENTIONAL SILENCE: a failing page command must not abort escalation or the monitor tick. */ }
    } else {
      console.error(`[monitor] API_DEGRADADO without PAGE_CMD — define PAGE_CMD to page on degradation`);
    }
  } else {
    console.error(`[monitor] degradation cooldown active (${Math.round((now - lastAction) / 1000)}s) — no new page`);
  }
}

if (isJson) {
  const apiResult = results.find((result) => result.name === "API_DEGRADADO");
  console.log(JSON.stringify({ ok: allOk, at: new Date().toISOString(), baseUrl: PROD_BASE_URL, trend24h: apiResult?.trend ?? summarizeApiHistory(readApiHistory()), results }, null, 2));
} else {
  console.log(`\n📡 MONITORING — ${PROD_BASE_URL} — ${new Date().toISOString()}\n`);
  for (const r of results) {
    console.log(`${r.ok ? "✓ PASS" : "✗ FAIL"} ${r.name} — ${r.detail}`);
  }
  console.log(`\n${allOk ? "✅ ALL OK" : "❌ ALERT — review the FAILs above"}\n`);
  if (!allOk) {
    console.log("Action:");
    console.log("  APP_CAIDA FAIL ×2 consecutive + APP_DOWN_AUTO_ROLLBACK=1 → automatic rollback + verify");
    console.log("  BUNDLE_CORRUPTO FAIL → npm run build:ci && docker compose up -d --build");
    console.log("  MONITORING_ACTIVO FAIL → verify that src/utils/storageMonitor.ts exists");
    console.log("  CLIENT_CRITICAL FAIL → critical client cluster: page + automatic rollback (AUTO_ROLLBACK=1)");
    console.log("  RETRY_DEGRADED FAIL → clients lost events: page (infra/network), review client→server delivery");
    console.log("  API_DEGRADADO FAIL → p95/error-rate over threshold: page (no rollback); review trend24h and raise API_LATENCY_P95_MS if it is a false positive");
  }
}

if (!allOk && SLACK_WEBHOOK && !skipOperatorNotify) {
  const fails = results.filter((r) => !r.ok).map((r) => `${r.name}: ${r.detail}`).join("\n");
  try {
    await fetch(SLACK_WEBHOOK, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: `🚨 BookmarkForge ALERT — ${PROD_BASE_URL}\n${fails}` }),
    });
  } catch { /* INTENTIONAL SILENCE: alert delivery is best-effort; a dead webhook must not crash the cron. */ }
}

await shutdownExit(allOk ? 0 : 1);
}
