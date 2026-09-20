#!/usr/bin/env node
/**
 * scripts/calibrate-first-summary.mjs
 *
 * F1-D reference-device calibration runner. Executes the real WebLLM
 * first-boot budget spec (`tests/e2e/ai-first-boot.nightly.spec.ts`) N
 * times on the host that runs this command and aggregates the per-run
 * `first-summary-metrics.json` attachments into a percentile summary —
 * the same report-attachment pattern as `scripts/summarize-webrtc-e2e.mjs`,
 * but inverted: THIS script drives the runs, it does not consume a
 * pre-existing report.
 *
 * Usage (on the reference device, i.e. a machine with a hardware WebGPU
 * adapter and >= 8 GB device memory — the spec self-skips elsewhere):
 *
 *   npm run calibrate:first-summary                 # default: 3 runs
 *   BMF_CALIB_RUNS=5 npm run calibrate:first-summary
 *   BMF_FIRST_SUMMARY_BUDGET_MS=25000 npm run calibrate:first-summary
 *
 * Behaviour:
 *   - Runs the nightly spec with the JSON reporter to stdout (CLI
 *     `--reporter=json` overrides the config reporters) and one repeat
 *     per run, single worker so runs never contend for GPU/RAM.
 *   - Collects `first-summary-metrics.json` attachments from every result.
 *   - Prints a per-run table (latency, budget, pass/fail, device info)
 *     and the p50/p95/max latency across runs.
 *   - Writes `playwright-report-nightly/first-summary-calibration.json`
 *     with the full record for trend review.
 *   - Exit code: non-zero if any run failed or a measured latency exceeds
 *     the budget (the nightly spec already fails per-run; this is the
 *     aggregate gate for the calibration session).
 *   - If every run was skipped (no hardware WebGPU on this host), it
 *     exits 2 with a clear "not a reference device" message — the budget
 *     is NOT asserted on this host.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { appendHistoryFile } from "./ai-performance-history.mjs";

const RUNS = Number.parseInt(process.env.BMF_CALIB_RUNS ?? "3", 10);
const BUDGET_MS = Number.parseInt(
  process.env.BMF_FIRST_SUMMARY_BUDGET_MS ?? "30000",
  10,
);
const REPORT_DIR = resolve("playwright-report-nightly");
const SIDECAR = resolve(
  process.env.BMF_FIRST_SUMMARY_SIDECAR ??
    `${REPORT_DIR}/first-summary-calibration.json`,
);

const SPEC = "tests/e2e/ai-first-boot.nightly.spec.ts";
const CONFIG = "playwright.nightly.config.ts";

if (!Number.isInteger(RUNS) || RUNS < 1 || RUNS > 10) {
  console.error(
    `[calibrate-first-summary] BMF_CALIB_RUNS must be 1..10 (got ${RUNS})`,
  );
  process.exit(2);
}

// `--report=<path>`: aggregate an already-written Playwright JSON report
// (e.g. a nightly CI artifact) instead of driving a fresh run — the same
// consume-existing-report mode as scripts/summarize-webrtc-e2e.mjs. Also
// useful for validating the aggregator on synthetic reports.
const reportArg = process.argv.find((a) => a.startsWith("--report="));
const reportPath = reportArg ? reportArg.slice("--report=".length) : null;

let child = null;
if (!reportPath) {
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  const args = [
    "--no-install",
    "playwright",
    "test",
    `--config=${CONFIG}`,
    SPEC,
    "--reporter=json",
    `--repeat-each=${RUNS}`,
    "--workers=1",
  ];

  console.log(
    `[calibrate-first-summary] running ${SPEC} ${RUNS}x ` +
      `(budget ${BUDGET_MS} ms), workers=1 — real WebGPU + model download`,
  );

  child = spawnSync(npx, args, {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024, // JSON report with N base64 attachments is big
    env: { ...process.env },
  });

  if (child.error) {
    console.error(
      `[calibrate-first-summary] failed to spawn playwright: ${child.error.message}`,
    );
    process.exit(2);
  }
} else {
  console.log(
    `[calibrate-first-summary] aggregating existing report: ${reportPath}`,
  );
}

/** Collect every `first-summary-metrics.json` attachment from the report. */
function collectMetrics(report) {
  const out = [];
  for (const suite of report.suites ?? []) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        for (const result of test.results ?? []) {
          const entry = {
            title: test.title,
            status: result.status,
            retry: result.retry,
            metrics: null,
          };
          for (const attachment of result.attachments ?? []) {
            if (attachment.name !== "first-summary-metrics.json") continue;
            const body = attachment.body
              ? Buffer.from(attachment.body, "base64").toString("utf8")
              : attachment.path
                ? readFileSync(attachment.path, "utf8")
                : null;
            if (body) {
              try {
                entry.metrics = JSON.parse(body);
              } catch (err) {
                entry.metrics = {
                  parseError: err instanceof Error ? err.message : String(err),
                };
              }
            }
          }
          out.push(entry);
        }
      }
    }
  }
  return out;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(
    sorted.length - 1,
    Math.ceil((p / 100) * sorted.length) - 1,
  );
  return sorted[Math.max(0, idx)];
}

let report;
try {
  report = reportPath
    ? JSON.parse(readFileSync(reportPath, "utf8"))
    : JSON.parse(child.stdout);
} catch {
  console.error(
    `[calibrate-first-summary] could not parse the Playwright JSON report; ` +
      (reportPath
        ? `path=${reportPath}`
        : `child exit=${child.status ?? "n/a"}\n--- stderr tail ---\n` +
          String(child.stderr ?? "").slice(-2000)),
  );
  process.exit(child.status ?? 1);
}

const entries = collectMetrics(report);
const skipped = entries.filter((e) => e.status === "skipped");
const failureCount = entries.filter(
  (e) => e.status === "failed" || e.status === "timedOut",
).length;
const measured = entries
  .filter((e) => e.metrics && typeof e.metrics.firstSummaryLatencyMs === "number")
  .map((e) => ({
    latency: e.metrics.firstSummaryLatencyMs,
    device: e.metrics.device,
    cardObserved: e.metrics.downloadCardObserved,
  }));

console.log("");
console.log("── per-run ──────────────────────────────────────────────");
for (const e of entries) {
  if (e.status === "skipped") {
    console.log("  skipped   (not a hardware-WebGPU reference device)");
    continue;
  }
  const lat = e.metrics?.firstSummaryLatencyMs ?? "?";
  const verdict =
    typeof lat === "number" && lat < BUDGET_MS ? "PASS" : "OVER BUDGET";
  console.log(
    `  ${String(lat).padStart(10)} ms  ${verdict}  ` +
      `card=${e.metrics?.downloadCardObserved ?? "?"}`,
  );
}

const latencies = measured.map((m) => m.latency).sort((a, b) => a - b);

console.log("");
console.log("── aggregate (ms) ────────────────────────────────────────");
console.log(
  `  runs      ${entries.length} (${skipped.length} skipped, ${failureCount} failed)`,
);
console.log(`  p50       ${percentile(latencies, 50) ?? "n/a"}`);
console.log(`  p95       ${percentile(latencies, 95) ?? "n/a"}`);
console.log(`  max       ${latencies[latencies.length - 1] ?? "n/a"}`);
console.log(`  budget    ${BUDGET_MS}`);

mkdirSync(REPORT_DIR, { recursive: true });
writeFileSync(
  SIDECAR,
  JSON.stringify(
    {
      timestamp: new Date().toISOString(),
      runs: RUNS,
      budgetMs: BUDGET_MS,
      entries,
      aggregate: {
        n: latencies.length,
        skipped,
        failed: failureCount,
        p50Ms: percentile(latencies, 50),
        p95Ms: percentile(latencies, 95),
        maxMs: latencies[latencies.length - 1] ?? null,
      },
    },
    null,
    2,
  ),
);
console.log("");
console.log(`[calibrate-first-summary] sidecar written: ${SIDECAR}`);

// Optional durable history integration. The sidecar remains the full evidence
// artifact; history stores only the aggregate numeric metrics and is enabled
// explicitly by the nightly job/reference-device runner.
const historyFile = process.env.BMF_FIRST_SUMMARY_HISTORY_FILE?.trim();
if (historyFile && latencies.length > 0) {
  const historyResult = appendHistoryFile({
    metrics: {
      aggregate: {
        maxMs: latencies[latencies.length - 1],
      },
    },
    historyFile: resolve(historyFile),
    source: "calibrate-first-summary",
    commit: process.env.GITHUB_SHA ?? null,
  });
  console.log(
    `[calibrate-first-summary] history ${historyResult.evaluation.ok ? "pass" : "fail"}: ` +
      `${resolve(historyFile)}`,
  );
  if (!historyResult.evaluation.ok) {
    process.exitCode = 1;
  }
}

if (latencies.length === 0) {
  console.error(
    "[calibrate-first-summary] no measurement captured on this host — " +
      "run on the reference device (hardware WebGPU, >= 8 GB). " +
      "The < 30 s budget was NOT asserted here.",
  );
  process.exit(2);
}
const over = latencies.filter((l) => l >= BUDGET_MS).length;
if (over > 0 || failureCount > 0) {
  console.error(
    `[calibrate-first-summary] FAIL: ${over} run(s) over budget, ` +
      `${failureCount} run(s) failed.`,
  );
  process.exit(1);
}
console.log(
  `[calibrate-first-summary] PASS: max ${latencies[latencies.length - 1]} ms < ` +
    `${BUDGET_MS} ms across ${latencies.length} run(s).`,
);