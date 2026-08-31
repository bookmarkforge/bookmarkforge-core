#!/usr/bin/env node
/**
 * scripts/kpi-report.mjs — reporte de KPIs de negocio (analítica opt-in) + gate.
 *
 * Consulta GET /api/analytics/kpis del companion server y muestra:
 *   - DAU / WAU / MAU (installs activos en 1/7/30 días)
 *   - Retención por cohorte (D1/D7/D30) de los últimos 30 días
 *   - Funnel de activación (totales por tipo de evento)
 *   - Contadores del collector (accepted/rejected/rate-limited)
 *
 * Gate con umbrales (paginación): cuando una métrica configurada cae por
 * debajo de su umbral el script emite un log estructurado de error
 * (evento `analytics_kpi_below_threshold`), dispara un webhook HTTPS opcional
 * y sale con código 1 — la run de CI queda en FAIL y eso es la página durable;
 * el webhook (p. ej. Slack) es la notificación inmediata.
 *
 * Umbrales por env (desactivados por defecto; número entero ≥ 0 para
 * DAU/WAU/MAU, proporción 0..1 para retención):
 *   KPI_MIN_DAU        DAU mínimo
 *   KPI_MIN_WAU        WAU mínimo
 *   KPI_MIN_MAU        MAU mínimo
 *   KPI_MIN_D7_PCT     retención D7 mínima de la cohorte más reciente con
 *                      ≥ 7 días de antigüedad
 *   KPI_MIN_D30_PCT    retención D30 mínima (cohorte ≥ 30 días)
 *   ANALYTICS_ALERT_WEBHOOK_URL  webhook HTTPS (rechaza http, como el resto
 *                      de canales de alerta del repo). Si la URL es un
 *                      Incoming Webhook de Slack (`hooks.slack.com/services`),
 *                      envía automáticamente un payload nativo `{ text, blocks }`;
 *                      cualquier otro webhook HTTPS recibe el JSON estructurado.
 *
 * La retención de una cohorte es d7/cohortSize (o d30/cohortSize): el script
 * elige la cohorte MÁS RECIENTE que ya tenga la antigüedad necesaria, de modo
 * que el gate no mide a una cohorte demasiado joven.
 *
 * Uso:
 *   ANALYTICS_ADMIN_TOKEN=... node scripts/kpi-report.mjs
 *   ANALYTICS_ADMIN_TOKEN=... node scripts/kpi-report.mjs --base http://127.0.0.1:8787
 *   ANALYTICS_ADMIN_TOKEN=... KPI_MIN_DAU=10 KPI_MIN_D7_PCT=0.15 node scripts/kpi-report.mjs
 *   ANALYTICS_ADMIN_TOKEN=... node scripts/kpi-report.mjs --json
 *
 * Env:
 *   ANALYTICS_ADMIN_TOKEN   token admin (requerido; el endpoint es 401/503 sin él)
 *   ANALYTICS_BASE_URL      base del servidor (default http://127.0.0.1:8787)
 */
import { pathToFileURL } from "node:url";

const BASE = process.env.ANALYTICS_BASE_URL ?? process.env.PROD_BASE_URL ?? "http://127.0.0.1:8787";
const TOKEN = process.env.ANALYTICS_ADMIN_TOKEN ?? "";
const JSON_OUT = process.argv.includes("--json");
const baseArgIdx = process.argv.indexOf("--base");
const base = baseArgIdx !== -1 && process.argv[baseArgIdx + 1] ? process.argv[baseArgIdx + 1] : BASE;

const DAY_MS = 86_400_000;

// ── Thresholds (pure, testable) ────────────────────────────────────────

export function parseNonNegativeInt(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === "") return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) return undefined;
  return parsed;
}

export function parsePct(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === "") return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) return undefined;
  return parsed;
}

export function parseThresholds(env) {
  return {
    minDau: parseNonNegativeInt(env.KPI_MIN_DAU),
    minWau: parseNonNegativeInt(env.KPI_MIN_WAU),
    minMau: parseNonNegativeInt(env.KPI_MIN_MAU),
    minD7Pct: parsePct(env.KPI_MIN_D7_PCT),
    minD30Pct: parsePct(env.KPI_MIN_D30_PCT),
  };
}

/** The KPI report stamps epoch-day keys ("20696"). Convert an ISO timestamp
 *  to the same epoch-day so cohort day comparisons match the server's math. */
export function isoToEpochDay(iso) {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return undefined;
  return Math.floor(ts / DAY_MS);
}

/** Latest cohort with day <= today - dayOffset; returns its retention rate. */
export function latestCohortRetention(cohorts, todayDay, dayOffset) {
  const cutoff = todayDay - dayOffset;
  let best = null;
  for (const [dayKey, cohort] of Object.entries(cohorts ?? {})) {
    const day = Number(dayKey);
    if (!Number.isInteger(day) || day > cutoff) continue;
    const size = Number(cohort.cohortSize);
    if (!size || size <= 0) continue;
    const metric = dayOffset >= 30 ? Number(cohort.d30) : Number(cohort.d7);
    if (!Number.isFinite(metric)) continue;
    if (best === null || day > best.day) {
      best = { day, rate: metric / size, size };
    }
  }
  return best;
}

export function evaluateKpis(kpis, thresholds) {
  const violations = [];
  const checks = [];
  const check = (name, actual, minimum, suffix = "") => {
    if (minimum === undefined) return;
    const ok = actual >= minimum;
    checks.push({ name, actual, minimum, ok });
    if (!ok) violations.push(`${name}=${actual} por debajo del umbral ${minimum}${suffix}`);
  };
  check("DAU", Number(kpis.dau ?? 0), thresholds.minDau);
  check("WAU", Number(kpis.wau ?? 0), thresholds.minWau);
  check("MAU", Number(kpis.mau ?? 0), thresholds.minMau);

  const todayDay = isoToEpochDay(kpis.generatedAt);
  if (todayDay !== undefined) {
    const d7 = latestCohortRetention(kpis.cohorts, todayDay, 7);
    const d30 = latestCohortRetention(kpis.cohorts, todayDay, 30);
    check("retD7", d7 ? d7.rate : 0, thresholds.minD7Pct, " (cohorte más reciente ≥ 7 días)");
    check("retD30", d30 ? d30.rate : 0, thresholds.minD30Pct, " (cohorte más reciente ≥ 30 días)");
  } else if (thresholds.minD7Pct !== undefined || thresholds.minD30Pct !== undefined) {
    violations.push("generatedAt inválido — no se pudo evaluar la retención");
  }
  return { ok: violations.length === 0, violations, checks };
}

// ── Webhook (HTTPS-only, same policy as the other alert channels) ──────

export function buildAlertPayload(kpis, violations) {
  return {
    event: "analytics_kpi_below_threshold",
    generatedAt: kpis.generatedAt,
    dau: kpis.dau,
    wau: kpis.wau,
    mau: kpis.mau,
    activeInstalls: kpis.activeInstalls,
    violations,
  };
}

// True cuando la URL apunta a un Incoming Webhook real de Slack (que solo
// acepta el shape `{ text, blocks }`). Cualquier otro webhook HTTPS recibe el
// payload estructurado `buildAlertPayload`.
export function isSlackWebhook(raw) {
  return /^https:\/\/(hooks\.slack\.com\/services|api\.slack\.com)/i.test(raw?.trim() ?? "");
}

// Payload nativo de Slack (Incoming Webhook): text + blocks, sin datos PII.
export function buildSlackPayload(kpis, violations) {
  const lines = [
    `generatedAt  ${kpis.generatedAt}`,
    `installs     ${kpis.activeInstalls}`,
    `DAU/WAU/MAU  ${kpis.dau} / ${kpis.wau} / ${kpis.mau}`,
    ...violations.map((v) => `• ${v}`),
  ].join("\n");
  return {
    text: "⚠️ BookmarkForge — KPIs por debajo del umbral",
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: "⚠️ *KPIs por debajo del umbral*" },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: ["```", lines, "```"].join("\n") },
      },
    ],
  };
}

function resolveWebhook(raw) {
  const value = raw?.trim() ?? "";
  if (!value) return "";
  if (/^https:\/\//i.test(value)) return value;
  console.error(JSON.stringify({
    event: "analytics_webhook_url_rejected",
    reason: "only https is accepted",
  }));
  return "";
}

async function fireAlertWebhook(url, payload) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "bookmarkforge-kpi-report" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`webhook responded ${response.status}`);
    console.error(JSON.stringify({ event: "analytics_kpi_webhook_delivered" }));
  } catch (error) {
    console.error(JSON.stringify({
      event: "analytics_kpi_webhook_failed",
      reason: String(error),
    }));
  }
}

// ── Main ──────────────────────────────────────────────────────────────

const IS_CLI = Boolean(
  process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url,
);

export async function runKpiReport(options = {}) {
  const {
    token = TOKEN,
    baseUrl = base,
    json = JSON_OUT,
    thresholds = parseThresholds(process.env),
    webhookUrl = process.env.ANALYTICS_ALERT_WEBHOOK_URL ?? "",
  } = options;

  if (!token) {
    console.error("[kpi-report] ANALYTICS_ADMIN_TOKEN is required (the KPI endpoint is fail-closed).");
    return { code: 2, reason: "no-token" };
  }

  let kpis;
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/analytics/kpis`, {
      headers: { "x-analytics-admin-token": token },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 503) {
      console.error("[kpi-report] KPIs disabled on the server (ANALYTICS_ADMIN_TOKEN not configured there).");
      return { code: 3, reason: "kpis-disabled" };
    }
    if (response.status === 401) {
      console.error("[kpi-report] Unauthorized — check ANALYTICS_ADMIN_TOKEN.");
      return { code: 4, reason: "unauthorized" };
    }
    if (!response.ok) {
      console.error(`[kpi-report] Server responded ${response.status}.`);
      return { code: 5, reason: `http-${response.status}` };
    }
    kpis = await response.json();
  } catch (error) {
    console.error(`[kpi-report] failed to reach ${baseUrl}: ${String(error)}`);
    return { code: 6, reason: "unreachable" };
  }

  const evaluation = evaluateKpis(kpis, thresholds);
  const report = { kpis, evaluation };

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHumanReport(kpis, evaluation);
  }

  if (!evaluation.ok) {
    for (const violation of evaluation.violations) {
      console.error(`[kpi-report] ❌ ${violation}`);
    }
    const payload = buildAlertPayload(kpis, evaluation.violations);
    console.error(JSON.stringify(payload));
    const webhook = resolveWebhook(webhookUrl);
    if (webhook) {
      // Slack Incoming Webhooks solo entienden `{ text, blocks }`; cualquier
      // otro webhook HTTPS recibe el JSON estructurado del evento.
      const slack = isSlackWebhook(webhook) ? buildSlackPayload(kpis, evaluation.violations) : payload;
      await fireAlertWebhook(webhook, slack);
    }
    return { code: 1, reason: "below-threshold", violations: evaluation.violations };
  }

  console.log("[kpi-report] ✅ KPIs por encima de los umbrales configurados");
  return { code: 0, reason: "ok", evaluation };
}

function printHumanReport(kpis, evaluation) {
  const pct = (part, whole) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—");
  console.log("══════════════════════════════════════════════");
  console.log("  BookmarkForge — KPI de negocio (opt-in, no PII)");
  console.log("══════════════════════════════════════════════");
  console.log(`generatedAt      ${kpis.generatedAt}`);
  console.log(`installs         ${kpis.activeInstalls}`);
  console.log(`DAU / WAU / MAU  ${kpis.dau} / ${kpis.wau} / ${kpis.mau}`);
  console.log("");
  console.log("Retención por cohorte (D1/D7/D30):");
  const cohortDays = Object.keys(kpis.cohorts ?? {}).sort();
  for (const day of cohortDays.slice(-10)) {
    const c = kpis.cohorts[day];
    console.log(
      `  ${day}  n=${c.cohortSize.toString().padStart(5)}  ` +
        `D1=${pct(c.d1, c.cohortSize)} D7=${pct(c.d7, c.cohortSize)} D30=${pct(c.d30, c.cohortSize)}`,
    );
  }
  console.log("");
  console.log("Funnel de activación (totales):");
  for (const [type, count] of Object.entries(kpis.funnel ?? {}).sort()) {
    console.log(`  ${type.padEnd(22)} ${count}`);
  }
  console.log("");
  const counters = kpis.counters ?? {};
  console.log(
    `counters: accepted=${counters.accepted} rejected=${counters.rejected} rateLimited=${counters.rateLimited} persisted=${counters.persisted}`,
  );
  console.log(`serverInstanceId ${kpis.serverInstanceId}`);
  console.log("");
  console.log("Gate de umbrales:");
  if (evaluation.checks.length === 0) {
    console.log("  (sin umbrales configurados — solo informe)");
  }
  for (const check of evaluation.checks) {
    console.log(
      `  ${check.ok ? "PASS" : "FAIL"}  ${check.name.padEnd(8)} actual=${check.actual} umbral=${check.minimum}`,
    );
  }
}

if (IS_CLI) {
  runKpiReport().then(
    ({ code }) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(`[kpi-report] failed: ${String(error)}`);
      process.exitCode = 1;
    },
  );
}
