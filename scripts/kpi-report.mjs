#!/usr/bin/env node
/**
 * scripts/kpi-report.mjs — reporte de KPIs de negocio (analítica opt-in).
 *
 * Consulta GET /api/analytics/kpis del companion server y muestra:
 *   - DAU / WAU / MAU (installs activos en 1/7/30 días)
 *   - Retención por cohorte (D1/D7/D30) de los últimos 30 días
 *   - Funnel de activación (totales por tipo de evento)
 *   - Contadores del collector (accepted/rejected/rate-limited)
 *
 * Uso:
 *   ANALYTICS_ADMIN_TOKEN=... node scripts/kpi-report.mjs
 *   ANALYTICS_ADMIN_TOKEN=... node scripts/kpi-report.mjs --base http://127.0.0.1:8787
 *   ANALYTICS_ADMIN_TOKEN=... node scripts/kpi-report.mjs --json
 *
 * Env:
 *   ANALYTICS_ADMIN_TOKEN   token admin (requerido; el endpoint es 401/503 sin él)
 *   ANALYTICS_BASE_URL      base del servidor (default http://127.0.0.1:8787)
 */
const BASE = process.env.ANALYTICS_BASE_URL ?? process.env.PROD_BASE_URL ?? "http://127.0.0.1:8787";
const TOKEN = process.env.ANALYTICS_ADMIN_TOKEN ?? "";
const JSON_OUT = process.argv.includes("--json");
const baseArgIdx = process.argv.indexOf("--base");
const base = baseArgIdx !== -1 && process.argv[baseArgIdx + 1] ? process.argv[baseArgIdx + 1] : BASE;

if (!TOKEN) {
  console.error("[kpi-report] ANALYTICS_ADMIN_TOKEN is required (the KPI endpoint is fail-closed).");
  process.exit(2);
}

async function main() {
  const response = await fetch(`${base.replace(/\/$/, "")}/api/analytics/kpis`, {
    headers: { "x-analytics-admin-token": TOKEN },
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 503) {
    console.error("[kpi-report] KPIs disabled on the server (ANALYTICS_ADMIN_TOKEN not configured there).");
    process.exit(3);
  }
  if (response.status === 401) {
    console.error("[kpi-report] Unauthorized — check ANALYTICS_ADMIN_TOKEN.");
    process.exit(4);
  }
  if (!response.ok) {
    console.error(`[kpi-report] Server responded ${response.status}.`);
    process.exit(5);
  }
  const kpis = await response.json();

  if (JSON_OUT) {
    console.log(JSON.stringify(kpis, null, 2));
    return;
  }

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
}

main().catch((error) => {
  console.error(`[kpi-report] failed: ${String(error)}`);
  process.exit(1);
});
