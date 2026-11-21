/**
 * Append one nightly WebRTC recovery summary to webrtc-recovery-history.json.
 *
 * Mirrors scripts/test-coverage-history.mjs: the history is one JSON document
 * that grows one run per nightly, keyed by the summary's generatedAt so a
 * re-run of the same nightly does not duplicate the record. The document is
 * deliberately gitignored (it is local trend evidence, not a gate input); the
 * chart renderer (render-webrtc-recovery-charts.mjs) reads it to produce an
 * HTML trend view.
 *
 * Usage:
 *   node scripts/webrtc-recovery-history.mjs
 *   node scripts/webrtc-recovery-history.mjs --summary playwright-report-nightly/webrtc-convergence-summary.json --history webrtc-recovery-history.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const DEFAULT_SUMMARY_FILE = resolve(
  ROOT,
  "playwright-report-nightly/webrtc-convergence-summary.json",
);
const DEFAULT_HISTORY_FILE = resolve(ROOT, "webrtc-recovery-history.json");
const HISTORY_VERSION = 1;

function optionValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1] || fallback;
}

/** Reduce a converged summary to the per-case and aggregate trend record. */
export function summarizeRun(summary) {
  const cases = (summary.reportedCases ?? []).map((metric) => ({
    caseId: metric.caseId,
    status: metric.status,
    phase: metric.phase,
    recoveryMs: Number.isFinite(metric.recoveryMs) ? metric.recoveryMs : null,
    interruptionObservedMs: Number.isFinite(metric.interruptionObservedMs)
      ? metric.interruptionObservedMs
      : null,
    persistenceStartedMs: Number.isFinite(metric.persistenceStartedMs)
      ? metric.persistenceStartedMs
      : null,
    persistenceFinishedMs: Number.isFinite(metric.persistenceFinishedMs)
      ? metric.persistenceFinishedMs
      : null,
    retryStartedMs: Number.isFinite(metric.retryStartedMs)
      ? metric.retryStartedMs
      : null,
    completedMs: Number.isFinite(metric.completedMs)
      ? metric.completedMs
      : null,
    converged: metric.converged === true,
  }));
  return {
    timestamp:
      typeof summary.generatedAt === "string" ? summary.generatedAt : new Date().toISOString(),
    status: summary.status ?? "unknown",
    missingCases: summary.missingCases ?? [],
    summary: summary.summary ?? {},
    cases,
  };
}

/** Create a new history document or validate an existing one's shape. */
export function createOrValidateHistory(history) {
  if (history === null || history === undefined) {
    return { version: HISTORY_VERSION, runs: [] };
  }
  if (history.version !== HISTORY_VERSION || !Array.isArray(history.runs)) {
    throw new Error(
      "[webrtc-recovery-history] existing history has a different version or runs shape",
    );
  }
  return history;
}

/**
 * Append one run, replacing a previous record with the same timestamp (a
 * re-run of the same nightly must not accumulate duplicates).
 */
export function appendRecoveryHistory(history, run) {
  const timestamp = run.timestamp;
  const retained = (history.runs ?? []).filter((entry) => entry.timestamp !== timestamp);
  return {
    ...history,
    runs: [...retained, run].sort((left, right) =>
      String(left.timestamp).localeCompare(String(right.timestamp)),
    ),
  };
}

/** Read a summary and append one entry to the configured history file. */
export function appendRecoveryHistoryFile({
  summaryFile = DEFAULT_SUMMARY_FILE,
  historyFile = DEFAULT_HISTORY_FILE,
} = {}) {
  let summaryRaw;
  try {
    summaryRaw = readFileSync(summaryFile, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(
        `[webrtc-recovery-history] ${summaryFile} missing — run the nightly WebRTC suite and the summary step first`,
      );
    }
    throw error;
  }
  const summary = JSON.parse(summaryRaw);
  let existing;
  try {
    existing = JSON.parse(readFileSync(historyFile, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const history = createOrValidateHistory(existing);
  const run = summarizeRun(summary);
  const next = appendRecoveryHistory(history, run);
  writeFileSync(historyFile, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return { history: next, run, historyFile };
}

const isMain =
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;

if (isMain) {
  try {
    const result = appendRecoveryHistoryFile({
      summaryFile: resolve(ROOT, optionValue("--summary", DEFAULT_SUMMARY_FILE)),
      historyFile: resolve(ROOT, optionValue("--history", DEFAULT_HISTORY_FILE)),
    });
    console.log(
      `[webrtc-recovery-history] appended ${result.run.timestamp} (${result.run.cases.length} case(s), status ${result.run.status}) to ${result.historyFile}`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
