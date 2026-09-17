#!/usr/bin/env node
/**
 * scripts/monitoring-alerts.mjs — 5 alertas exactas para producción
 *
 * 1. APP CAÍDA — production-smoke (index.html + CSP + COOP + /health +
 *    client-events + WS).
 *    Con APP_DOWN_AUTO_ROLLBACK=1, DOS fallos CONSECUTIVOS de este check
 *    (persistidos entre ticks del cron) disparan rollback.mjs --auto y luego
 *    rollback.mjs --verify que corrobora la recuperación ANTES de notificar
 *    al operador: si el verify pasa, el cron no escala (el rollback resolvió
 *    el incidente); si el verify falla, escala.
 * 2. BUNDLE CORRUPTO — verificación REAL del SRI: si PROD_BASE_URL sirve el
 *    bundle (nginx), descarga index.html, extrae integrity del primer script y
 *    compara el sha256 del recurso servido (lo que haría el navegador). En
 *    entornos sin frontend (drill Docker-free / CI), sirve un dist/index.html
 *    con SRI ROTO contra un server estático efímero y verifica que el detector
 *    detecta la violación — cubre la alerta 2 en el drill.
 * 3. MONITORING ACTIVO — verifica monitores, listener CSP y proxy nginx
 * 4. CLIENT_CRITICAL — cluster signal: el servidor loguea
 *    `client_events_critical_threshold` cuando >= 3 clientes distintos reportan
 *    critical en la ventana (storage-pressure critical, bundle-integrity-spike,
 *    error-spike, csp-violation-spike). Este check consume esa línea del log y
 *    ESCALA: página (PAGE_CMD) + rollback automático (AUTO_ROLLBACK=1) con
 *    cooldown anti-loop.
 * 5. RETRY_DEGRADED — entrega degradada: clientes que abandonaron la entrega de
 *    eventos tras reintentos acotados (el servidor loguea
 *    `client_events_retry_degraded` al ver drops nuevos). Cuando la entrega
 *    falla, la propia señal CLIENT_CRITICAL puede estar ciega. Consume la misma
 *    fuente de log y PAGINA (PAGE_CMD, cooldown) — nunca rollback (es salud de
 *    entrega infra/red, no regresión de código).
 * 6. API_DEGRADADO — degradación (no outage): mide la latencia p95 y el
 *    error-rate de GET /health y de un endpoint real de negocio (por defecto
 *    POST /api/license/entitlement, el que la app consulta al arrancar para
 *    resolver el plan) sobre API_PROBE_SAMPLES muestras por tick y
 *    persiste cada medición en un historial JSON acotado a 24h.
 *    falla si p95 > API_LATENCY_P95_MS o error-rate > API_ERROR_RATE. El p95
 *    sobre N muestras suaviza picos de una sola request. PAGINA (PAGE_CMD,
 *    cooldown) — nunca rollback: la degradación no implica regresión de
 *    código, y el outage total ya lo cubre APP_CAIDA.
 *
 * Uso servidor (cron cada 60s):
 *   PROD_BASE_URL=https://tu-dominio.com SLACK_WEBHOOK=https://hooks.slack.com/... node scripts/monitoring-alerts.mjs
 *   PROD_BASE_URL=http://127.0.0.1:8080 node scripts/monitoring-alerts.mjs --json
 *
 * Env:
 *   CLIENT_EVENTS_WINDOW_MS  ventana del cluster (default 600000 = 10 min)
 *   CLIENT_EVENTS_LOG_FILE   ruta del log del servidor (alternativa a docker logs)
 *   CLIENT_EVENTS_LOG_CMD    comando para leer el log (default: docker compose logs --since <window> api)
 *   AUTO_ROLLBACK=1          ejecuta el rollback automático al detectar el cluster
 *   APP_DOWN_AUTO_ROLLBACK=1 rollback automático ante APP_CAIDA x2 consecutivos
 *   APP_DOWN_THRESHOLD       consecutivos de APP_CAIDA que disparan (default 2)
 *   ROLLBACK_CMD             comando de rollback (default: node scripts/rollback.mjs --auto)
 *   ROLLBACK_COOLDOWN_MS     mínimo entre página/rollback (default 600000)
 *   PAGE_CMD                 comando de página (ej: /usr/local/bin/bmf-page.sh)
 *   MONITOR_STATE_FILE       estado de dedup (default .monitor-state.json)
 *   API_PROBE_SAMPLES        muestras de latencia de /health por tick (default 10)
 *   API_PROBE_TIMEOUT_MS     timeout por muestra (default 5000 ms)
 *   API_LATENCY_P95_MS       umbral p95 de latencia (default 1000 ms)
 *   API_ERROR_RATE           umbral de error-rate (default 0.2 = 20 %)
 *   API_PROBE_BUSINESS_PATH  endpoint de negocio (default /api/license/entitlement)
 *   MONITORING_NGINX_CONFIG  ruta del nginx generado (default public/nginx.conf)
 *   API_HISTORY_FILE         historial JSON de métricas (default .api-degradation-history.json)
 *
 * Usa el mismo runApiSurfaceChecks que production-smoke.mjs — no duplica lógica.
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

// ── Degradación (API_DEGRADADO): latencia p95 + error-rate de /health ───
// El p95 sobre N muestras por tick suaviza picos aislados. Umbrales
// configurables por env; NUNCA dispara rollback.
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

// Auto-rollback en APP_CAIDA: cuando el check de app cae DOS veces SEGUIDAS
// (consecutivo persistido entre ticks del cron), se invoca rollback.mjs --auto
// y luego se CONFIRMA con `rollback.mjs --verify` ANTES de notificar al
// operador. Fail-closed: solo con APP_DOWN_AUTO_ROLLBACK=1.
const APP_DOWN_AUTO_ROLLBACK = process.env.APP_DOWN_AUTO_ROLLBACK === "1";
// Consecutivos de APP_CAIDA que disparan rollback (2 = dos ticks seguidos).
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
 * Algoritmo de integridad del navegador (SRI spec): el recurso se acepta si
 * alguno de los hashes space-separados (sha256/sha384/sha512) coincide con el
 * digest del cuerpo servido. Mismatch = el navegador bloquearía el script y
 * reportaría una SecurityPolicyViolation.
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
 * Verifica el SRI del bundle servido en {baseUrl}/index.html como lo haría el
 * navegador: extrae integrity del primer <script>, descarga el recurso y
 * compara su digest. Devuelve null si la base NO sirve un html con scripts
 * (→ el caller usa el probe Docker-free).
 */
export async function verifyBundleSri(baseUrl) {
  let res;
  try {
    res = await fetch(`${baseUrl}/index.html`);
  } catch {
    return null; // servidor inalcanzable: no hay bundle servido
  }
  if (!res.ok) return null;
  const html = await res.text();
  if (!html.includes("<script")) return null;

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
      detail: `el bundle servido (${baseUrl}/index.html) no declara integrity en sus scripts — el navegador no podría verificar SRI`,
    };
  }

  const assetUrl = new URL(target.src, `${baseUrl}/`).href;
  let assetRes;
  try {
    assetRes = await fetch(assetUrl);
  } catch (e) {
    return { mode: "served", ok: false, detail: `no se pudo descargar ${target.src}: ${String(e)}` };
  }
  if (!assetRes.ok) {
    return { mode: "served", ok: false, detail: `no se pudo descargar ${target.src} (HTTP ${assetRes.status})` };
  }
  const body = Buffer.from(await assetRes.arrayBuffer());
  const actual = sha256Base64(body);
  const ok = integrityMatches(target.integrity, body);
  return {
    mode: "served",
    ok,
    detail: ok
      ? `SRI servido OK (${actual.slice(0, 12)}…)`
      : `SRI ROTO — integrity=${target.integrity.slice(0, 24)}… real=${actual.slice(0, 24)}… (el navegador bloquearía el script)`,
  };
}

/**
 * Probe Docker-free (drill / CI sin frontend): sirve un dist/index.html con
 * SRI ROTO a propósito contra un server estático efímero y ejecuta la misma
 * verificación. PASS = el detector DETECTA el mismatch (el navegador
 * reportaría la violación); FAIL = el detector está roto.
 */
async function probeBrokenSri() {
  const { createServer } = await import("node:http");
  const GOOD = "/* bundle sano */";
  const CORRUPTED = "/* bundle CORRUPTO — el navegador debe bloquear */";
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
        ? "probe SRI: dist/index.html servido con SRI ROTO → violación DETECTADA (el navegador la reportaría) ✓"
        : `probe SRI FALLÓ — el detector no detectó el SRI roto (${result?.detail ?? "sin resultado"})`,
    };
  } catch (e) {
    return { mode: "probe", ok: false, detail: `probe SRI no pudo ejecutarse: ${e.message}` };
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
  }
}

async function checkBundleCorrupto() {
  try {
    // Modo prod: verifica el bundle REAL servido (nginx → index.html).
    const served = await verifyBundleSri(PROD_BASE_URL);
    if (served) {
      return { name: "BUNDLE_CORRUPTO", ok: served.ok, detail: `[servido] ${served.detail}` };
    }
    // Modo drill Docker-free: probe con SRI roto (cubre la alerta 2).
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
 * del archivo) o CLIENT_EVENTS_LOG_CMD (default docker compose logs). Las
 * líneas se filtran por timestamp dentro de la ventana; si el timestamp no
 * parsea, se cuentan (la fuente ya acota recencia con --since / tail).
 * Fail-closed: si el log NO se puede leer, el check falla (un cluster no
 * detectado es peor que un falso positivo de log ilegible).
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
    // Toda línea fresca colapsa a UNA alerta agregada por tick (evita doble
    // paginación por re-arms de la misma ventana), pero la severidad reportada
    // es el MÁXIMO de clientes críticos observado en la ventana: paginar por
    // debajo de la peor severidad es peor que un detalle redundante.
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
 * Lee la fuente del log de client-events (archivo tail o comando docker).
 * Devuelve `{ text }` o `{ error }` — compartido por CLIENT_CRITICAL y
 * RETRY_DEGRADED para que ambos vean exactamente la misma fuente.
 */
async function readClientEventsLog(logFile, logCmd) {
  const { existsSync, openSync, readSync, closeSync, statSync } = await import("node:fs");
  if (logFile) {
    if (!existsSync(logFile)) return { error: `log no legible (${logFile}) — fail-closed` };
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
    return { error: `log no legible (${logCmd}) — fail-closed` };
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
        ? `sin client_events_critical_threshold en ${sourceWindowMinutes}min`
        : `${clusterEvents} cluster event(s) en ${sourceWindowMinutes}min — criticalClients>=${maxCriticalClients || 3}`,
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
        ? `sin client_events_retry_degraded en ${sourceWindowMinutes}min`
        : `${degradedEvents} señal(es) de entrega degradada en ${sourceWindowMinutes}min — +${maxNewDropped} eventos perdidos`,
      degradedEvents,
    };
  } catch (e) {
    return { name: "RETRY_DEGRADED", ok: false, detail: String(e) };
  }
}

/**
 * API_DEGRADADO — degradación, no outage: latencia p95 + error-rate de
 * GET /health y un endpoint de negocio sobre `samples` muestras por tick.
 * Fallo = p95 > latencyThresholdMs
 * O error-rate > errorRateThreshold. Nunca rollback: la degradación no
 * implica regresión de código; el outage total lo cubre APP_CAIDA.
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
      ? `p95 ${p95Ms}ms (umbral ${latencyThresholdMs}ms) · error-rate ${ratePct}% (umbral ${thresholdPct}%) · ${samples} rondas health+business`
      : `DEGRADADO — p95 ${p95Ms}ms (umbral ${latencyThresholdMs}ms) · error-rate ${ratePct}% (umbral ${thresholdPct}%) · ${errors}/${totalProbes} fallos (${businessErrors} business)`,
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
        ? "4 monitores + listener csp-violation-spike + proxy nginx presentes"
        : `faltan: ${missing.join(", ")}`,
    };
  } catch (e) {
    return { name: "MONITORING_ACTIVO", ok: false, detail: String(e) };
  }
}

/**
 * Salida ordenada del proceso — crítico en Windows.
 * `process.exit()` inmediato mientras undici (fetch) mantiene sockets
 * keep-alive abiertos dispara un crash nativo de libuv en Windows
 * (exit 0xC0000409 / "Assertion failed ... src\\win\\async.c") porque el
 * teardown del proceso cierra los handles de red a mitad de cierre.
 * En su lugar: se cierra el dispatcher global de undici limpiamente y se
 * deja que el event loop drene solo con `process.exitCode` (failsafe de
 * 5s por si algo ref'd mantiene el loop vivo).
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
    // undici no es importable: el drain natural del loop cerrará los sockets
    // por keep-alive timeout; el failsafe de abajo fuerza la salida.
  }
  // Failsafe: si algo ref'd mantiene el loop vivo (fs threadpool, timers),
  // forzamos la salida tras un margen — ya sin sockets de undici abiertos.
  shutdownFailsafeTimer = setTimeout(() => process.exit(process.exitCode ?? code), 5_000).unref();
}

/** Cancela el failsafe de shutdownExit — usado por los tests para que el
 * timer unref'd no dispare process.exit() a mitad de la suite. */
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

// Se setea a true cuando APP_CAIDA dispara rollback + verify y la app se
// recupera: en ese caso el cron NO notifica al operador (el rollback ya
// resolvió el incidente antes de que llegara la alerta).
let skipOperatorNotify = false;

// ── Escalation: APP_CAIDA ×2 consecutivos → rollback + verify, luego ───
// ── notificar al operador solo si el verify falla tras el rollback ────
// Un fallo aislado de smoke no dispara rollback (puede ser un timeout
// momentáneo); DOS consecutivos SÍ significan una app realmente abajo. El
// contador se persiste en MONITOR_STATE_FILE para sobrevivir a los ticks
// del cron (60s). Al detectar el segundo: rollback.mjs --auto y después
// rollback.mjs --verify (que corre el mismo smoke). Solo si el verify
// también falla, el cron escala al operador (Slack).
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
  console.error(`[monitor] APP_CAIDA consecutivo #${consecutive} (disparo de rollback en #${APP_DOWN_THRESHOLD})`);

  if (consecutive >= APP_DOWN_THRESHOLD) {
    // Reset del contador (una vez accionado) para que un fallo continuado no
    // dispare en todos los ticks; el verify decidirá si escalar.
    state.appDownConsecutive = 0;
    try {
      writeFileSync(MONITOR_STATE_FILE, JSON.stringify(state));
    } catch { /* INTENTIONAL SILENCE: state persistence is best-effort; the in-memory decision for this tick still stands. */ }

    if (APP_DOWN_AUTO_ROLLBACK) {
      console.error(`[monitor] APP_CAIDA ×${APP_DOWN_THRESHOLD} consecutivos → rollback: ${ROLLBACK_CMD}`);
      let rollbackStatus = -1;
      try {
        const r = runCommandLine(ROLLBACK_CMD, {
          encoding: "utf8",
          timeout: 180_000,
          env: { ...process.env, PROD_BASE_URL, ...(DOCKER_REGISTRY ? { DOCKER_REGISTRY } : {}) },
        });
        rollbackStatus = r.status;
      } catch (e) {
        console.error(`[monitor] ROLLBACK FALLÓ: ${e.message}`);
      }

      if (rollbackStatus === 0) {
        // Confirmación post-rollback: rollback.mjs --verify corre el smoke.
        console.error("[monitor] rollback OK (exit 0) — confirmando con --verify...");
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
          console.error(`[monitor] VERIFY FALLÓ: ${e.message}`);
        }
        if (verifyStatus === 0) {
          // App recuperada — no notificar al operador: el rollback resolvió el
          // incidente antes de que llegara la alerta.
          skipOperatorNotify = true;
          console.error("[monitor] VERIFY OK post-rollback — app recuperada, sin notificación al operador.");
        } else {
          console.error(
            `[monitor] VERIFY FAIL post-rollback (exit ${verifyStatus}) — la app NO se recuperó. ESCALAR manualmente: ${ROLLBACK_CMD}`,
          );
        }
      } else {
        console.error(`[monitor] ROLLBACK FALLÓ (exit ${rollbackStatus}) — la app sigue abajo. ESCALAR manualmente: ${ROLLBACK_CMD}`);
      }
    } else {
      console.error(`[monitor] APP_DOWN_AUTO_ROLLBACK no seteado — NO se ejecutó rollback. Ejecuta: ${ROLLBACK_CMD}`);
    }
  }
} else if (appDown) {
  // La app volvió a responder — reset del contador para la próxima racha.
  let state = {};
  try {
    state = JSON.parse(readFileSync(MONITOR_STATE_FILE, "utf8"));
  } catch { /* INTENTIONAL SILENCE: state file missing/corrupt — start from empty state; monitoring continues. */ }
  if (state.appDownConsecutive) {
    state.appDownConsecutive = 0;
    try {
      writeFileSync(MONITOR_STATE_FILE, JSON.stringify(state));
    } catch { /* INTENTIONAL SILENCE: state persistence is best-effort; the in-memory decision for this tick still stands. */ }
    console.error("[monitor] APP_CAIDA recuperado — contador de consecutivos reseteado.");
  }
}

// ── Escalation: CLIENT_CRITICAL → página + rollback automático ─────────
// El evento de cluster ya es una señal fuerte (>= 3 clientes critical): se
// escala en la PRIMERA aparición, deduplicado por cooldown para que la
// ventana del log (10 min) no re-dispare en cada tick del cron (60s).
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

    // 1) Página (notificación ruidosa) — ej: /usr/local/bin/bmf-page.sh
    if (PAGE_CMD) {
      try {
        runCommandLine(PAGE_CMD, {
          encoding: "utf8",
          timeout: 30_000,
          env: { ...process.env, CLUSTER_DETAIL: clientCritical.detail },
        });
        console.error(`[monitor] PAGE enviada (${PAGE_CMD})`);
      } catch { /* INTENTIONAL SILENCE: a failing page command must not abort escalation or the monitor tick. */ }
    }

    // 2) Rollback automático (fail-closed: solo con AUTO_ROLLBACK=1)
    if (AUTO_ROLLBACK) {
      console.error(`[monitor] CLIENT_CRITICAL → rollback automático: ${ROLLBACK_CMD}`);
      try {
        const r = runCommandLine(ROLLBACK_CMD, {
          encoding: "utf8",
          timeout: 180_000,
          env: { ...process.env, PROD_BASE_URL, ...(DOCKER_REGISTRY ? { DOCKER_REGISTRY } : {}) },
        });
        if (r.status === 0) {
          console.error("[monitor] rollback OK (exit 0)");
        } else {
          console.error(`[monitor] ROLLBACK FALLÓ (exit ${r.status}) — escalar manualmente: ${ROLLBACK_CMD}`);
        }
      } catch (e) {
        console.error(`[monitor] ROLLBACK FALLÓ: ${e.message}`);
      }
    } else {
      console.error(`[monitor] AUTO_ROLLBACK no seteado — NO se ejecutó rollback. Ejecuta: ${ROLLBACK_CMD}`);
    }
  } else {
    console.error(`[monitor] cooldown activo (${Math.round((now - lastAction) / 1000)}s desde la última acción) — sin nueva página/rollback`);
  }
}

// ── Escalation: RETRY_DEGRADED → página (sin rollback) ───────────────
// Clientes que abandonaron la entrega de eventos tras reintentos acotados:
// la señal CLIENT_CRITICAL misma puede estar ciega. Es salud de entrega
// (infra/red), NO una regresión de código — página con cooldown, nunca
// rollback automático.
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
        console.error(`[monitor] PAGE enviada por entrega degradada (${PAGE_CMD})`);
      } catch { /* INTENTIONAL SILENCE: a failing page command must not abort escalation or the monitor tick. */ }
    } else {
      console.error(`[monitor] RETRY_DEGRADED sin PAGE_CMD — define PAGE_CMD para paginar entrega degradada`);
    }
  } else {
    console.error(`[monitor] cooldown de entrega degradada activo (${Math.round((now - lastAction) / 1000)}s) — sin nueva página`);
  }
}

// ── Escalation: API_DEGRADADO → página (sin rollback) ───────────────
// Degradación (p95/error-rate sobre el umbral), no outage: página con
// cooldown — nunca rollback automático (CLIENT_CRITICAL/BUNDLE cubren
// regresiones de código; APP_CAIDA cubre el colapso total).
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
        console.error(`[monitor] PAGE enviada por degradación (${PAGE_CMD})`);
      } catch { /* INTENTIONAL SILENCE: a failing page command must not abort escalation or the monitor tick. */ }
    } else {
      console.error(`[monitor] API_DEGRADADO sin PAGE_CMD — define PAGE_CMD para paginar degradación`);
    }
  } else {
    console.error(`[monitor] cooldown de degradación activo (${Math.round((now - lastAction) / 1000)}s) — sin nueva página`);
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
  console.log(`\n${allOk ? "✅ TODO OK" : "❌ ALERTA — revisa FAIL arriba"}\n`);
  if (!allOk) {
    console.log("Acción:");
    console.log("  APP_CAIDA FAIL ×2 consecutivos + APP_DOWN_AUTO_ROLLBACK=1 → rollback automático + verify");
    console.log("  BUNDLE_CORRUPTO FAIL → npm run build:ci && docker compose up -d --build");
    console.log("  MONITORING_ACTIVO FAIL → verifica que src/utils/storageMonitor.ts existe");
    console.log("  CLIENT_CRITICAL FAIL → cluster de clientes críticos: página + rollback automático (AUTO_ROLLBACK=1)");
    console.log("  RETRY_DEGRADED FAIL → clientes perdieron eventos: página (infra/red), revisa la entrega cliente→servidor");
    console.log("  API_DEGRADADO FAIL → p95/error-rate sobre umbral: página (no rollback); revisa trend24h y sube API_LATENCY_P95_MS si es falso positivo");
  }
}

if (!allOk && SLACK_WEBHOOK && !skipOperatorNotify) {
  const fails = results.filter((r) => !r.ok).map((r) => `${r.name}: ${r.detail}`).join("\n");
  try {
    await fetch(SLACK_WEBHOOK, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: `🚨 BookmarkForge ALERTA — ${PROD_BASE_URL}\n${fails}` }),
    });
  } catch { /* INTENTIONAL SILENCE: alert delivery is best-effort; a dead webhook must not crash the cron. */ }
}

await shutdownExit(allOk ? 0 : 1);
}
