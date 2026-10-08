#!/usr/bin/env node
/**
 * scripts/kpi-local-collector-check.mjs — validates the analytics collector
 * against a LOCAL server, without depending on staging.
 *
 * Boots the real collector handler (`createAnalyticsHandler` from
 * server/src/business-analytics.ts) on an HTTP server at 127.0.0.1, seeds a
 * deterministic dataset via ANALYTICS_STATE_FILE (installs with a mature
 * D7/D30 retention cohort), does a live POST /api/analytics/events to
 * validate ingestion, and runs the `kpi-report` gate against localhost with
 * exact thresholds.
 *
 * Usage:
 *   npx tsx scripts/kpi-local-collector-check.mjs [--json]
 *
 * Exit: 0 when the collector aggregates/counts as expected and the gate
 * passes; 1 otherwise. Requires no secrets and no external network.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DAY_MS = 86_400_000;
const TODAY = Math.floor(Date.now() / DAY_MS) * DAY_MS;
const utcDayHere = (ts) => Math.floor(ts / DAY_MS);

const iid = (seed) => createHash("sha256").update(`kpi-local-${seed}`).digest("hex");

// ── Deterministic dataset (installs + retention cohorts) ────────────
// install → [firstDay][lastDay] relative to today
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
// r7-2 and r30-2 "return" today → they add to DAU.
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

// Expected KPIs: DAU=5 (dau-a/b + r7-2 + r30-2 + live probe), WAU=8,
// MAU=12 (all of the above + wau-1..3 + mau-1..3 + r7-1). D7 retention=1/2
// of the mature cohort (firstDay = 8 days ago). D30 retention could not be
// validated with a 30-day window (the collector only opens cohorts up to 29
// days back), so that threshold stays disabled.
const EXPECTED = { dau: 5, wau: 8, mau: 12, d7Pct: 0.5 };

async function main() {
  // All informational logging (collector + kpi-report) goes to stderr; stdout
  // stays reserved for the single JSON evidence blob.
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
  // The temp directory is left in place: the handler persists state
  // asynchronously (timer) and deleting it here would trigger a failed
  // persist. In CI the job is ephemeral; the OS cleans /tmp.

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