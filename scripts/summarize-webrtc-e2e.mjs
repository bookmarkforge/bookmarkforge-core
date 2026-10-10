import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import recoveryBudgets from "./webrtc-recovery-budgets.json" with { type: "json" };

const REPORT_PATH = resolve(
  process.env.WEBRTC_PLAYWRIGHT_REPORT ?? "playwright-report-nightly/results.json",
);
const OUTPUT_PATH = resolve(
  process.env.WEBRTC_CONVERGENCE_SUMMARY ??
    "playwright-report-nightly/webrtc-convergence-summary.json",
);
const EXPECTED_CASES = [
  "initial-chunk",
  "intermediate-chunk",
  "indexeddb-persistence",
];

function collectResults(suites, output = []) {
  for (const suite of suites ?? []) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        for (const [attempt, result] of (test.results ?? []).entries()) {
          for (const attachment of result.attachments ?? []) {
            if (attachment.name !== "webrtc-convergence-metrics.json") continue;
            const attachmentText =
              attachment.body !== undefined
                ? Buffer.from(attachment.body, "base64").toString("utf8")
                : attachment.path && existsSync(attachment.path)
                  ? readFileSync(attachment.path, "utf8")
                  : null;
            if (attachmentText === null) continue;
            try {
              const metrics = JSON.parse(attachmentText);
              output.push({
                ...metrics,
                spec: spec.title,
                test: test.title,
                attempt,
                resultStatus: result.status,
              });
            } catch (error) {
              output.push({
                caseId: "unknown",
                status: "failed",
                converged: false,
                spec: spec.title,
                test: test.title,
                attempt,
                resultStatus: result.status,
                metricsError: error instanceof Error ? error.message : String(error),
              });
            }
          }
        }
      }
    }
    collectResults(suite.suites, output);
  }
  return output;
}

function collectTestStatuses(suites, output = []) {
  for (const suite of suites ?? []) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        // Only the final attempt matters: an intermediate failed attempt that
        // was retried into a pass (Playwright "flaky") is not a suite
        // failure, so counting every attempt would mislabel the run.
        const results = test.results ?? [];
        const finalStatus =
          results.at(-1)?.status ??
          (test.status === "skipped" ? "skipped" : "missing");
        output.push(finalStatus);
      }
    }
    collectTestStatuses(suite.suites, output);
  }
  return output;
}

function latestByCase(metrics) {
  const latest = new Map();
  for (const metric of metrics) {
    const previous = latest.get(metric.caseId);
    if (!previous || metric.attempt >= previous.attempt) {
      latest.set(metric.caseId, metric);
    }
  }
  return [...latest.values()].sort((left, right) =>
    String(left.caseId).localeCompare(String(right.caseId)),
  );
}

function average(values) {
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function maxOf(values) {
  return values.length > 0 ? Math.max(...values) : null;
}

/**
 * Render the convergence summary as a compact Markdown table for PR comments
 * and human review. Null latencies (phases a case did not reach) become "—".
 */
export function formatWebRtcSummaryMarkdown(summary) {
  const cases = summary?.reportedCases ?? [];
  const aggregate = summary?.summary ?? {};
  const fmtMs = (value) =>
    value === null || value === undefined || !Number.isFinite(value)
      ? "—"
      : `${Math.round(value)} ms`;
  const budgets = summary?.budgets ?? evaluateRecoveryBudgets(summary);
  const lines = [
    "## ⚡ WebRTC convergence (nightly sync contract)",
    "",
    `**Status:** ${summary?.status ?? "unknown"} · ` +
      `${aggregate.passedCases ?? 0}/${aggregate.totalCases ?? cases.length} case(s) passed · ` +
      `${aggregate.convergedCases ?? 0} converged · ` +
      `avg recovery ${fmtMs(aggregate.averageRecoveryMs)} · max ${fmtMs(aggregate.maxRecoveryMs)}`,
    "",
  ];
  if (budgets?.policy === "informative") {
    const rows = Object.entries(budgets.metrics ?? {})
      .filter(([, metric]) => metric.tier !== null)
      .map(
        ([key, metric]) =>
          `${TIER_ICONS[metric.tier]} ${key}: ${fmtMs(metric.valueMs)}`,
      );
    lines.push(
      `**Budgets (informative, not gating):** ${rows.join(" · ") || "no data"}`,
      "",
    );
  }
  if (cases.length === 0) {
    lines.push("No WebRTC convergence metrics were attached by this run.");
    return lines.join("\n");
  }
  lines.push(
    "| Case | Status | Converged | Recovery | Interruption | Persistence | Retry | Completion |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const metric of cases) {
    const icon =
      metric.status === "passed" && metric.converged === true ? "✅" : "❌";
    lines.push(
      `| ${String(metric.caseId).replaceAll("|", "\\|")} | ` +
        `${icon} ${metric.status ?? "unknown"} | ` +
        `${metric.converged === true ? "yes" : "no"} | ` +
        `${fmtMs(metric.recoveryMs)} | ` +
        `${fmtMs(metric.interruptionObservedMs)} | ` +
        `${fmtMs(metric.persistenceFinishedMs)} | ` +
        `${fmtMs(metric.retryStartedMs)} | ` +
        `${fmtMs(metric.completedMs)} |`,
    );
  }
  const missing = summary?.missingCases ?? [];
  if (missing.length > 0) {
    lines.push("", `Missing expected case(s): ${missing.join(", ")}`);
  }
  return lines.join("\n");
}

const TIER_ICONS = { green: "🟢", amber: "🟡", red: "🔴" };

/**
 * Grade one latency value against the graded (non-strict) budgets.
 * Returns the tier name and the boundary the value falls under.
 */
export function gradeRecoveryBudget(metricKey, valueMs) {
  const budget = recoveryBudgets.metrics?.[metricKey];
  if (!budget || valueMs === null || valueMs === undefined || !Number.isFinite(valueMs)) {
    return { tier: null, boundaryMs: null };
  }
  if (valueMs <= budget.green) return { tier: "green", boundaryMs: budget.green };
  if (valueMs <= budget.amber) return { tier: "amber", boundaryMs: budget.amber };
  return { tier: "red", boundaryMs: budget.red };
}

/**
 * Evaluate every configured budget metric against the run's aggregate
 * latencies. Informative only: this never fails a run, it just makes the
 * tier visible to the summary, the PR comment and the trend chart.
 */
export function evaluateRecoveryBudgets(summary) {
  const aggregates = summary?.summary ?? {};
  const samples = {
    recoveryMs: aggregates.averageRecoveryMs,
    interruptionObservedMs: aggregates.phaseLatency?.average?.interruptionObservedMs,
    completionMs: aggregates.phaseLatency?.average?.completedMs,
  };
  const metrics = {};
  let worst = "green";
  for (const [key, value] of Object.entries(samples)) {
    const { tier, boundaryMs } = gradeRecoveryBudget(key, value);
    metrics[key] = { valueMs: value, tier, boundaryMs };
    if (tier === "amber" && worst === "green") worst = "amber";
    if (tier === "red") worst = "red";
  }
  return { policy: recoveryBudgets.policy, version: recoveryBudgets.version, worst, metrics };
}

function emptySummary(reason) {
  return {
    generatedAt: new Date().toISOString(),
    status: "unavailable",
    reason,
    expectedCases: EXPECTED_CASES,
    reportedCases: [],
    missingCases: EXPECTED_CASES,
    summary: {
      totalCases: EXPECTED_CASES.length,
      passedCases: 0,
      failedCases: 0,
      convergedCases: 0,
      averageRecoveryMs: null,
      maxRecoveryMs: null,
      phaseLatency: {
        average: {
          interruptionObservedMs: null,
          persistenceStartedMs: null,
          persistenceFinishedMs: null,
          retryStartedMs: null,
          completedMs: null,
        },
        max: {
          interruptionObservedMs: null,
          persistenceStartedMs: null,
          persistenceFinishedMs: null,
          retryStartedMs: null,
          completedMs: null,
        },
      },
    },
    budgets: evaluateRecoveryBudgets({ summary: {} }),
  };
}

let summary;
if (!existsSync(REPORT_PATH)) {
  summary = emptySummary(`Playwright JSON report not found: ${REPORT_PATH}`);
  console.warn(`[summarize-webrtc-e2e] ${summary.reason}`);
} else {
  const report = JSON.parse(readFileSync(REPORT_PATH, "utf8"));
  const allMetrics = collectResults(report.suites);
  const cases = latestByCase(allMetrics);
  const reportedIds = new Set(cases.map((metric) => metric.caseId));
  const missingCases = EXPECTED_CASES.filter((caseId) => !reportedIds.has(caseId));
  const passed = cases.filter(
    (metric) => metric.status === "passed" && metric.converged === true,
  );
  const failed = cases.filter(
    (metric) => metric.status !== "passed" || metric.converged !== true,
  );
  const recoveryTimes = cases
    .map((metric) => metric.recoveryMs)
    .filter((value) => Number.isFinite(value));
  // Phase timestamps are measured as ms from the case start (see the spec's
  // ConvergenceMetrics attachment). Aggregate the same per-phase latencies
  // across all reported cases so the nightly JSON shows the interruption,
  // persistence, retry and completion phases without extra tooling.
  const phaseLatency = (key) =>
    cases
      .map((metric) => metric[key])
      .filter((value) => Number.isFinite(value));
  const reportHasFailure = collectTestStatuses(report.suites).some(
    (status) => status !== "passed" && status !== "skipped",
  );

  summary = {
    generatedAt: new Date().toISOString(),
    status:
      missingCases.length === 0 && failed.length === 0
        ? "passed"
        : reportHasFailure
          ? "incomplete_due_to_test_failure"
          : "metrics_incomplete",
    expectedCases: EXPECTED_CASES,
    reportedCases: cases,
    missingCases,
    summary: {
      totalCases: EXPECTED_CASES.length,
      passedCases: passed.length,
      failedCases: failed.length,
      convergedCases: cases.filter((metric) => metric.converged === true).length,
      averageRecoveryMs: average(recoveryTimes),
      maxRecoveryMs: maxOf(recoveryTimes),
      phaseLatency: {
        average: {
          interruptionObservedMs: average(phaseLatency("interruptionObservedMs")),
          persistenceStartedMs: average(phaseLatency("persistenceStartedMs")),
          persistenceFinishedMs: average(phaseLatency("persistenceFinishedMs")),
          retryStartedMs: average(phaseLatency("retryStartedMs")),
          completedMs: average(phaseLatency("completedMs")),
        },
        max: {
          interruptionObservedMs: maxOf(phaseLatency("interruptionObservedMs")),
          persistenceStartedMs: maxOf(phaseLatency("persistenceStartedMs")),
          persistenceFinishedMs: maxOf(phaseLatency("persistenceFinishedMs")),
          retryStartedMs: maxOf(phaseLatency("retryStartedMs")),
          completedMs: maxOf(phaseLatency("completedMs")),
        },
      },
    },
  };
  summary.budgets = evaluateRecoveryBudgets(summary);
}

mkdirSync(resolve(OUTPUT_PATH, ".."), { recursive: true });
writeFileSync(OUTPUT_PATH, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));

// PR-comment rendering: `--markdown <path>` writes the Markdown table so the
// CI comment step posts exactly what the summary computes.
const markdownIndex = process.argv.indexOf("--markdown");
if (markdownIndex !== -1) {
  const markdownPath = process.argv[markdownIndex + 1];
  if (markdownPath) {
    writeFileSync(markdownPath, `${formatWebRtcSummaryMarkdown(summary)}\n`, "utf8");
    console.log(`[summarize-webrtc-e2e] wrote PR comment Markdown to ${markdownPath}`);
  }
}

// A failed Playwright test remains the authoritative nightly failure. When
// the suite itself is green, missing metrics are a harness regression and must
// fail the summary step instead of silently producing a false green report.
// A missing report is the same class of regression: the summary and markdown
// files above are still written, but the step must not exit 0 as if the run
// had been observed.
if (
  summary.status === "metrics_incomplete" ||
  summary.status === "unavailable"
) {
  process.exit(1);
}
