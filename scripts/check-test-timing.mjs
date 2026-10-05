#!/usr/bin/env node
/**
 * scripts/check-test-timing.mjs — test-timing regression guard.
 *
 * Fails when a test file becomes slower than its recorded budget or crosses
 * the absolute slow-file threshold, with a message naming the culprit and
 * the escape hatch. Selection is data-driven: it covers whatever the
 * invoking profile actually ran, so a file that turns slow only fails the
 * profiles that run it. Adapted from the ADR-028 baseline pattern used by
 * check-docs-markdown (fail-closed on hygiene paths, --update to re-pin,
 * baseline reviewed in the PR diff).
 *
 * Detection is two-layer:
 *   1. absolute threshold (BMF_TEST_TIMING_MS, default 5000 ms): a NEW file
 *      (not in the baseline) at or above it is a finding;
 *   2. baseline budget (BMF_TEST_TIMING_BUDGET × the pinned duration,
 *      default 2×): a pinned file that regresses past that fails. Pinned
 *      files are exempt from layer 1 — they are pinned precisely because
 *      they sit over the threshold.
 *
 * Noise tolerance: a run must exercise at least BMF_TEST_TIMING_MINCOV
 * (default 80%) of the baseline files to be judgeable — a partially parsed
 * run is reported as "not judged" instead of failing on absent files.
 * Baseline entries far below the absolute threshold are pruned by default
 * on --update (they only add churn); keep them with --prune=false.
 *
 * Env:
 *   BMF_TEST_TIMING=1|update   1 = enforce; update = regenerate baseline
 *   BMF_TEST_TIMING_OFF=1      disable the guard entirely (visible opt-out)
 *
 * Usage:
 *   node scripts/check-test-timing.mjs --log <file>   # evaluate a run log
 *   node scripts/check-test-timing.mjs --update       # regenerate baseline
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const TIMING_SCHEMA_LABEL = "bmf.test-timing/1";
const BASELINE_PATH = join(process.cwd(), "scripts", "test-timing-baseline.json");

// Same line grammar as scripts/test-timing-report.mjs (vitest default
// reporter, ANSI stripped): "✓ src/tests/... (12 tests) 345ms".
const FILE_LINE =
  /^\s*[✓✗×❯]\s+(\S+\.test\.(?:ts|tsx|mjs))\s+\((\d+) tests?(?:\s*\|\s*\d+ failed)?\)\s+(\d+)ms$/gm;

/** Extract per-file durations from a bounded-runner log. */
export function parseTimings(logText) {
  const clean = String(logText).replace(/\x1b\[[0-9;]*m/g, "");
  const map = new Map();
  for (const m of clean.matchAll(FILE_LINE)) {
    map.set(m[1].replaceAll("\\", "/"), {
      tests: Number.parseInt(m[2], 10),
      ms: Number.parseInt(m[3], 10),
    });
  }
  return map;
}

/**
 * Evaluate parsed durations against the baseline.
 * modes: "enforce" | "update". Returns { ok, exitCode, violations, lines }
 * plus `baseline` (the freshly built document) only in update mode.
 */
export function evaluateTimings(durations, baseline, mode = "enforce", opts = {}) {
  const thresholdMs = opts.thresholdMs ?? 5000;
  const budgetFactor = opts.budgetFactor ?? 2;
  const minCoveragePct = opts.minCoveragePct ?? 80;
  const lines = [];

  if (mode !== "update" && (!baseline || typeof baseline !== "object" || !baseline.files)) {
    const violations = [
      "no baseline at scripts/test-timing-baseline.json — record one with BMF_TEST_TIMING=update (review it in the PR)",
    ];
    return { ok: false, exitCode: 1, violations, lines };
  }
  if (mode !== "update" && baseline.schema !== TIMING_SCHEMA_LABEL) {
    const violations = [
      `baseline schema mismatch (expected ${TIMING_SCHEMA_LABEL}, got ${baseline.schema ?? "none"}) — regenerate with BMF_TEST_TIMING=update`,
    ];
    return { ok: false, exitCode: 1, violations, lines };
  }

  if (mode === "update") {
    const files = {};
    for (const [file, { ms }] of durations) {
      // Pin files at/over the threshold, plus anything already pinned (so
      // --prune=false style pinning survives a regeneration of this entry).
      if (ms >= thresholdMs || (baseline?.files?.[file] ?? 0) >= thresholdMs) {
        files[file] = ms;
        lines.push(`[test-timing] pinned ${file}: ${ms}ms (budget ${budgetFactor}x = ${ms * budgetFactor}ms)`);
      }
    }
    return {
      ok: true,
      exitCode: 0,
      violations: [],
      lines,
      baseline: {
        schema: TIMING_SCHEMA_LABEL,
        updated: new Date().toISOString().slice(0, 10),
        thresholdMs,
        budgetFactor,
        files,
      },
    };
  }

  if (durations.size === 0) {
    return {
      ok: false,
      exitCode: 1,
      violations: ["no per-file timings parsed — was this a real test run?"],
      lines,
    };
  }

  // Coverage gate: enough of the baseline exercised for this run to be
  // judgeable. Only baseline files that belong to the run's own file list
  // (opts.expectedFiles, when provided) count — a profile running a subset
  // of the baseline (e.g. test:fast vs the full suite) is still judged on
  // its own coverage. A partially parsed run (runner crash, reporter
  // change) is reported as "not judged" instead of failing on absent files.
  const relevantEntries = Object.entries(baseline.files).filter(
    ([file]) => !opts.expectedFiles || opts.expectedFiles.has(file),
  );
  const missing = relevantEntries.filter(([file]) => !durations.has(file));
  const coveragePct = relevantEntries.length === 0
    ? 100
    : ((relevantEntries.length - missing.length) / relevantEntries.length) * 100;
  if (coveragePct < minCoveragePct) {
    lines.push(
      `[test-timing] run reported ${durations.size} file(s); baseline covers ${relevantEntries.length} ` +
        `(${coveragePct.toFixed(0)}% exercised < ${minCoveragePct}% minimum) — run not judged`,
    );
    return { ok: true, exitCode: 0, violations: [], lines };
  }

  const violations = [];
  for (const [file, { ms }] of durations) {
    const pinned = baseline.files[file];
    if (pinned === undefined) {
      // Layer 1 — absolute threshold: only for files the baseline does
      // not know. Pinned files are judged by their own budget below
      // (they are pinned precisely because they sit over the threshold).
      if (ms >= thresholdMs) {
        violations.push(`${file}: ${ms}ms ≥ ${thresholdMs}ms slow-file threshold (new file)`);
      }
    } else if (ms > pinned * budgetFactor) {
      // Layer 2 — per-file regression budget.
      violations.push(
        `${file}: ${ms}ms exceeds ${budgetFactor}x its pinned ${pinned}ms budget`,
      );
    }
  }

  if (violations.length > 0) {
    lines.push("[test-timing] SLOW TEST REGRESSION — files slow or regressed:");
    for (const v of violations) lines.push(`  x ${v}`);
    lines.push(
      "  Fix the test (split it, trim waits, avoid real sleeps) or, if the new",
      "  time is intended, re-pin with BMF_TEST_TIMING=update — the baseline",
      "  diff is reviewed in the PR.",
    );
  } else {
    lines.push(
      `[test-timing] OK — ${durations.size} file(s) within budgets ` +
        `(slow-file threshold ${thresholdMs}ms, regression budget ${budgetFactor}x)`,
    );
  }
  return { ok: violations.length === 0, exitCode: violations.length === 0 ? 0 : 1, violations, lines };
}

/** Shared env->opts mapping for both the runner wiring and the CLI. */
export function optsFromEnv(env = process.env) {
  return {
    thresholdMs: Number.parseInt(env.BMF_TEST_TIMING_MS ?? "5000", 10) || 5000,
    budgetFactor: Number.parseInt(env.BMF_TEST_TIMING_BUDGET ?? "2", 10) || 2,
    minCoveragePct: Number.parseInt(env.BMF_TEST_TIMING_MINCOV ?? "80", 10) || 0,
  };
}

/** Resolve BMF_TEST_TIMING into a mode. Default: enforce on CI, warn locally. */
export function resolveTimingMode(env = process.env, { isCI = false } = {}) {
  if (env.BMF_TEST_TIMING_OFF === "1") return "off";
  const raw = env.BMF_TEST_TIMING ?? (isCI ? "1" : "");
  if (raw === "update") return "update";
  if (raw === "1" || raw === "true") return "enforce";
  return "warn";
}

export function baselinePath() {
  return BASELINE_PATH;
}

export function loadBaseline(path = BASELINE_PATH) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    console.error(`[test-timing] baseline unreadable: ${error.message}`);
    return null;
  }
}

export function saveBaseline(baseline, path = BASELINE_PATH) {
  writeFileSync(path, `${JSON.stringify(baseline, null, 2)}\n`);
}

function main() {
  const args = process.argv.slice(2);
  const update = args.includes("--update");
  const keepAll = args.includes("--prune=false");
  const logIndex = args.indexOf("--log");
  if (!update && logIndex === -1) {
    console.error("usage: node scripts/check-test-timing.mjs --log <file> | --update [--prune=false]");
    process.exit(2);
  }
  if (!update && !existsSync(args[logIndex + 1] ?? "")) {
    console.error(`[test-timing] log not found: ${args[logIndex + 1]}`);
    process.exit(2);
  }
  const durations = update
    ? new Map()
    : parseTimings(readFileSync(args[logIndex + 1], "utf8"));
  const previous = loadBaseline();
  const result = evaluateTimings(durations, previous, update ? "update" : "enforce", optsFromEnv(process.env));
  for (const line of result.lines) console.log(line);
  if (update) {
    const next = result.baseline;
    if (keepAll && previous?.files) {
      for (const [file, ms] of Object.entries(previous.files)) {
        if (next.files[file] === undefined) next.files[file] = ms;
      }
    }
    saveBaseline(next);
    console.log(`[test-timing] baseline written: ${Object.keys(next.files).length} file(s)`);
  }
  process.exit(result.exitCode);
}

const isMain =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main();
}
