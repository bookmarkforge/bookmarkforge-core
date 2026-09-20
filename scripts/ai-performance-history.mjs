#!/usr/bin/env node
/**
 * Record and gate AI performance metrics from a nightly or emulated run.
 *
 * Input is a JSON object produced by the AI E2E suites or the calibration
 * runner. Only numeric performance metrics are persisted; device identifiers,
 * prompts, URLs and other potentially sensitive fields are discarded.
 *
 * Usage:
 *   node scripts/ai-performance-history.mjs --metrics metrics.json --history .nightly-history/ai-performance.jsonl
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const HISTORY_SCHEMA = "bmf.ai-performance-history/1";
export const DEFAULT_RATIO = 1.25;
export const MIN_BASELINE_SAMPLES = 2;

const METRIC_BUDGETS = {
  firstSummaryLatencyMs: 30_000,
  coldInitMs: 90_000,
  warmFirstMs: 5_000,
  warmCacheReinitMs: 15_000,
  heapDeltaMb: 15,
};

export function numericMetrics(input) {
  const source = input?.metrics ?? input?.pass1 ?? input ?? {};
  const pass1 = input?.pass1 ?? {};
  const pass2 = input?.pass2 ?? {};
  const values = {
    firstSummaryLatencyMs:
      input?.firstSummaryLatencyMs ?? input?.aggregate?.maxMs,
    coldInitMs: source.coldInitMs ?? pass1.coldInitMs,
    warmFirstMs: source.warmFirstMs ?? pass1.warmFirstMs,
    warmCacheReinitMs: source.warmCacheReinitMs ?? pass2.warmCacheReinitMs,
    heapDeltaMb: source.heapDeltaMb ?? input?.heapDeltaMb,
  };
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => Number.isFinite(value) && value >= 0),
  );
}

export function parseHistory(raw) {
  if (!raw) return [];
  const entries = [];
  for (const line of String(raw).split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line);
      if (value?.schema === HISTORY_SCHEMA && value.metrics && typeof value.metrics === "object") {
        entries.push(value);
      }
    } catch {
      // A damaged telemetry line is ignored; it must not block a later run.
    }
  }
  return entries;
}

export function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function evaluateMetrics(metrics, history, {
  budgets = METRIC_BUDGETS,
  ratio = DEFAULT_RATIO,
  minBaselineSamples = MIN_BASELINE_SAMPLES,
} = {}) {
  const failures = [];
  const checks = {};
  for (const [name, actual] of Object.entries(metrics)) {
    const budget = budgets[name];
    const prior = history
      .map((entry) => entry.metrics?.[name])
      .filter((value) => Number.isFinite(value) && value >= 0);
    const baseline = prior.length >= minBaselineSamples ? median(prior) : null;
    const overBudget = Number.isFinite(budget) && actual > budget;
    const regressed = baseline !== null && baseline > 0 && actual >= baseline * ratio;
    checks[name] = {
      actual,
      budget: Number.isFinite(budget) ? budget : null,
      baseline,
      overBudget,
      regressed,
      ok: !overBudget && !regressed,
    };
    if (overBudget) failures.push(`${name}: ${actual} exceeds hard budget ${budget}`);
    if (regressed) failures.push(`${name}: ${actual} is >= ${ratio}x historical median ${baseline}`);
  }
  return { ok: failures.length === 0, checks, failures };
}

export function createEntry(metrics, { measuredAt = new Date(), source = "unknown", commit = null } = {}) {
  return {
    schema: HISTORY_SCHEMA,
    measuredAt: new Date(measuredAt).toISOString(),
    source,
    commit: typeof commit === "string" && commit.length <= 128 ? commit : null,
    metrics,
  };
}

export function appendHistoryFile({ metrics, historyFile, source = "unknown", commit = null, measuredAt = new Date() }) {
  const normalized = numericMetrics(metrics);
  if (Object.keys(normalized).length === 0) {
    throw new Error("[ai-performance-history] no numeric AI metrics found");
  }
  const existing = existsSync(historyFile)
    ? parseHistory(readFileSync(historyFile, "utf8"))
    : [];
  const evaluation = evaluateMetrics(normalized, existing);
  mkdirSync(dirname(historyFile), { recursive: true });
  appendFileSync(historyFile, `${JSON.stringify(createEntry(normalized, { measuredAt, source, commit }))}\n`);
  return { normalized, evaluation, entryCount: existing.length + 1 };
}

function arg(name, fallback = undefined) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

function main() {
  const metricsPath = arg("--metrics");
  const historyFile = resolve(arg("--history", ".nightly-history/ai-performance.jsonl"));
  if (!metricsPath || !existsSync(metricsPath)) {
    throw new Error("[ai-performance-history] --metrics must point to an existing JSON file");
  }
  const metrics = JSON.parse(readFileSync(metricsPath, "utf8"));
  const result = appendHistoryFile({
    metrics,
    historyFile,
    source: arg("--source", "cli"),
    commit: process.env.GITHUB_SHA ?? null,
  });
  for (const [name, check] of Object.entries(result.evaluation.checks)) {
    console.log(`[ai-performance-history] ${check.ok ? "PASS" : "FAIL"} ${name}: ${check.actual} (budget=${check.budget ?? "n/a"}, baseline=${check.baseline ?? "n/a"})`);
  }
  console.log(`[ai-performance-history] ${result.evaluation.ok ? "pass" : "fail"}: ${result.entryCount} samples`);
  if (!result.evaluation.ok) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
