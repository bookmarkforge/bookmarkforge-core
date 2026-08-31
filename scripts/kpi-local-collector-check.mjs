#!/usr/bin/env node
/**
 * scripts/kpi-local-collector-check.mjs — valida el collector de analítica
 * contra un servidor LOCAL, sin depender de staging.
 *
 * Arranca el handler real del collector (`createAnalyticsHandler` de
 * server/src/business-analytics.ts) sobre un HTTP server en 127.0.0.1, siembra
 * un dataset determinista vía ANALYTICS_STATE_FILE (installs con cohorte de
 * retención D7/D30 madura), hace un POST /api/analytics/events en vivo para
 * validar la ingesta, y ejecuta el gate `kpi-report` contra localhost con
 * umbrales exactos.
 *
 * Uso:
 *   npx tsx scripts/kpi-local-collector-check.mjs [--json]
 *
 * Salida: 0 si el collector agrega/cuenta lo esperado y el gate pasa; 1 si no.
 * No requiere ningún secreto ni red externa.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DAY_MS = 86_400_000;
const TODAY = Math.floor(Date.now() / DAY_MS) * DAY_MS;
const utcDayHere = (ts) => Math.floor(ts / DAY_MS);

const iid = (seed) => createHash("sha256").update(`kpi-local-${seed}`).digest("hex");

// ── Dataset determinista (installs + cohortes de retención) ────────────
// instalar → [firstDay][lastDay] relativo a hoy
const SEED = [
  ["dau-a", 1, 0],
  ["dau-b", 1, 0],
  ["wau-1", 5, 5],
  ["wau-2", 5, 5],
  ["wau-3", 5, 5],
  ["mau-1", 25, 25],
  ["mau-2", 25, 25],
  ["mau-3", 25, 25],
  ["r7-1", 8, 8],
  ["r7-2", 8, 0],
  ["r30-1", 30, 30],
  ["r30-2", 30, 0],
];
// r7-2 y r30-2 "vuelven" hoy → suman a DAU.
const installs = SEED.map(([seed, firstAgo, lastAgo]) => [
  iid(seed),
  { firstDay: utcDayHere(TODAY) - firstAgo, lastDay: utcDayHere(TODAY) - lastAgo },
]);

const daily = {
  [utcDayHere(TODAY) - 1]: { vault_created: 2, session_start: 2 },
  [utcDayHere(TODAY) - 5]: { search_used: 3 },
  [utcDayHere(TODAY) - 8]: { vault_created: 2 },
  [utcDayHere(TODAY) - 25]: { import_used: 3 },
  [utcDayHere(TODAY) - 30]: { vault_created: 2 },
};

// KPIs esperados: DAU=5 (dau-a/b + r7-2 + r30-2 + probe en vivo), WAU=8,
// MAU=12 (todo lo anterior + wau-1..3 + mau-1..3 + r7-1). Retención D7=1/2
// de la cohorte madura (firstDay = hace 8 días). La retención D30 no se
// podría validar con un ventana de 30 días (el collector solo abre cohortes
// hasta 29 días atrás), así que ese umbral queda desactivado.
const EXPECTED = { dau: 5, wau: 8, mau: 12, d7Pct: 0.5 };

async function main() {
  // Todo log informativo (collector + kpi-report) va a stderr; el stdout queda
  // reservado para la evidencia JSON única.
  const logOut = console.log;
  console.log = (...args) => console.error(...args);

  const dataDir = mkdtempSync(join(tmpdir(), "kpi-local-"));
  const stateFile = join(dataDir, "state.json");
  const token = `local-${createHash("sha256").update(String(Date.now())).digest("hex").slice(0, 16)}`;

  writeFileSync(stateFile, JSON.stringify({ installs, daily }));

  process.env.ANALYTICS_ADMIN_TOKEN = token;
  process.env.ANALYTICS_STATE_FILE = stateFile;

  const { createAnalyticsHandler } = await import("../server/src/business-analytics.ts");
  const { runKpiReport, buildAlertPayload } = await import("./kpi-report.mjs");
  const { createServer } = await import("node:http");

  const handler = createAnalyticsHandler({ serverInstanceId: "kpi-local-collector-check" });
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  let sentinel = { accepted: false, status: 0 };
  try {
    const probe = await fetch(`${baseUrl}/api/analytics/events`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "127.0.0.2" },
      body: JSON.stringify({ iid: iid("probe-live"), counts: { session_end: 1 } }),
    });
    sentinel = { accepted: probe.status === 204, status: probe.status };
  } finally {
    /* keep server up for the report */
  }

  const run = await runKpiReport({
    token,
    baseUrl,
    json: false,
    webhookUrl: "",
    thresholds: {
      minDau: EXPECTED.dau,
      minWau: EXPECTED.wau,
      minMau: EXPECTED.mau,
      minD7Pct: EXPECTED.d7Pct,
      minD30Pct: undefined,
    },
  });

  const kpisRaw = await fetch(`${baseUrl}/api/analytics/kpis`, {
    headers: { "x-analytics-admin-token": token },
  });
  const kpis = await kpisRaw.json();

  const dauOk = EXPECTED.dau <= kpis.dau;
  const wauOk = EXPECTED.wau <= kpis.wau;
  const mauOk = EXPECTED.mau <= kpis.mau;
  const matches = dauOk && wauOk && mauOk && sentinel.accepted && run.code === 0;

  server.close();
  // Se deja el directorio temporal en su sitio: el handler persiste el estado
  // de forma asíncrona (timer) y borrarlo aquí dispararía un persist fallido.
  // En CI el job es efímero; el SO limpia /tmp.

  console.log = logOut;

  const result = {
    event: "kpi_local_collector_check",
    collector: {
      liveProbeAccepted: sentinel.accepted,
      liveProbeStatus: sentinel.status,
      persisted: Boolean(process.env.ANALYTICS_STATE_FILE),
    },
    observed: { dau: kpis.dau, wau: kpis.wau, mau: kpis.mau, activeInstalls: kpis.activeInstalls },
    expected: EXPECTED,
    retention: {
      d7Pct: Number(
        kpis.cohorts[String(utcDayHere(TODAY) - 8)]
          ? kpis.cohorts[String(utcDayHere(TODAY) - 8)].d7 / kpis.cohorts[String(utcDayHere(TODAY) - 8)].cohortSize
          : null,
      ),
    },
    gate: { exitCode: run.code, passed: matches },
    alertPayload: buildAlertPayload(kpis, run.code === 0 ? [] : ["collector mismatch"]),
  };

  console.log(JSON.stringify(result, null, 2));
  return matches ? 0 : 1;
}

main().then((code) => {
  process.exitCode = code;
});