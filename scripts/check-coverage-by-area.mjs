/**
 * scripts/check-coverage-by-area.mjs — per-directory coverage budgets.
 *
 * The aggregate thresholds in scripts/coverage-area-budgets.json are a floor
 * over the WHOLE src/ tree, so a single untested component can hide inside
 * the average. vitest.config.ts imports that same global object, and this
 * gate enforces the per-area budgets on top of the same v8 coverage output
 * (coverage/coverage-final.json produced by `npm run test:coverage`),
 * following the audit 2026-08-13 "mejora de alto impacto" #2.
 *
 * Budgets live in scripts/coverage-area-budgets.json:
 *   { "global": { "statements": 90, "branches": 82, "functions": 85,
 *                 "lines": 90 }, "areas": { "src/services": { ... } } }
 *
 * Rules:
 *  - A file belongs to the area with the longest matching directory prefix.
 *  - Percentages are computed per metric over the union of the area's files
 *    (sum(covered) / sum(total)), matching how vitest reports aggregates.
 *  - Only metrics explicitly listed in a budget are gated; areas absent
 *    from the budgets file are reported but never fail the gate.
 *
 * Usage:
 *   node scripts/check-coverage-by-area.mjs            # gate (exit 1 on regression)
 *   node scripts/check-coverage-by-area.mjs --report   # print all areas, never fails
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const DEFAULT_COVERAGE_FILE = join(ROOT, "coverage", "coverage-final.json");
const DEFAULT_BUDGETS_FILE = join(ROOT, "scripts", "coverage-area-budgets.json");

// ── Pure logic (unit-testable with in-memory fixtures) ───────────────

/**
 * Normalize an absolute coverage-file path to a project-relative
 * `src/...` key. Handles forward/back slashes and any drive prefix.
 */
export function toRelativeKey(absPath) {
  const norm = String(absPath).replace(/\\/g, "/");
  const idx = norm.lastIndexOf("/src/");
  if (idx === -1) return norm;
  return norm.slice(idx + 1);
}

/**
 * Extract per-metric {total, covered} from one coverage-final.json entry.
 * Handles both the v8 object form ({ statements: { total, covered }, ... })
 * and the istanbul map form ({ s, statementMap, f, fnMap, b, branchMap, l }).
 */
export function fileMetrics(entry) {
  const out = { statements: [0, 0], branches: [0, 0], functions: [0, 0], lines: [0, 0] };
  const add = (metric, total, covered) => {
    out[metric][0] += total;
    out[metric][1] += covered;
  };
  // v8 object form.
  if (entry && typeof entry.statements === "object" && entry.statements !== null) {
    for (const metric of ["statements", "branches", "functions", "lines"]) {
      const m = entry[metric];
      if (m && typeof m.total === "number") {
        add(metric, m.total, m.covered ?? 0);
      }
    }
    return out;
  }
  // istanbul map form (s/f/b/l counters + *Map position maps).
  if (entry && entry.statementMap) {
    add("statements", Object.keys(entry.statementMap).length,
      Object.values(entry.s ?? {}).filter((v) => v > 0).length);
    if (entry.fnMap) {
      add("functions", Object.keys(entry.fnMap).length,
        Object.values(entry.f ?? {}).filter((v) => v > 0).length);
    }
    if (entry.branchMap) {
      let total = 0;
      let covered = 0;
      for (const counts of Object.values(entry.b ?? {})) {
        if (Array.isArray(counts)) {
          total += counts.length;
          covered += counts.filter((c) => c > 0).length;
        }
      }
      add("branches", total, covered);
    }
    if (entry.lineMap) {
      add("lines", Object.keys(entry.lineMap).length,
        Object.values(entry.l ?? {}).filter((v) => v > 0).length);
    } else {
      // The v8 provider does not emit lineMap/l — lines are derived from
      // statement start lines (istanbul convention): a line is executable
      // when a statement starts on it, and covered when ANY statement
      // starting on it was hit.
      const lineCovered = new Map(); // line -> boolean
      for (const [stmtId, stmt] of Object.entries(entry.statementMap ?? {})) {
        const line = stmt?.start?.line;
        if (typeof line !== "number") continue;
        const hit = (entry.s?.[stmtId] ?? 0) > 0;
        if (hit) {
          lineCovered.set(line, true);
        } else if (!lineCovered.has(line)) {
          lineCovered.set(line, false);
        }
      }
      add("lines", lineCovered.size,
        [...lineCovered.values()].filter(Boolean).length);
    }
    return out;
  }
  return out;
}

/**
 * Aggregate all instrumented files using the same metric math as the area
 * gate. This is also the source used to mirror Vitest's global thresholds.
 */
export function aggregateCoverage(coverageMap) {
  const totals = { statements: 0, branches: 0, functions: 0, lines: 0 };
  const covered = { statements: 0, branches: 0, functions: 0, lines: 0 };
  for (const entry of Object.values(coverageMap)) {
    const metrics = fileMetrics(entry);
    for (const metric of Object.keys(totals)) {
      totals[metric] += metrics[metric][0];
      covered[metric] += metrics[metric][1];
    }
  }
  return Object.fromEntries(
    Object.keys(totals).map((metric) => [
      metric,
      totals[metric] > 0 ? (covered[metric] / totals[metric]) * 100 : null,
    ]),
  );
}

/**
 * Evaluate the aggregate thresholds from coverage-area-budgets.json.
 */
export function evaluateGlobalCoverage(coverageMap, thresholds) {
  const percents = aggregateCoverage(coverageMap);
  const failures = [];
  for (const [metric, min] of Object.entries(thresholds ?? {})) {
    const value = percents[metric];
    if (typeof value === "number" && value < min) {
      failures.push(`${metric} ${value.toFixed(2)}% < ${min}% (global budget)`);
    }
  }
  return { ok: failures.length === 0, failures, percents };
}

/**
 * Evaluate per-area coverage against budgets.
 *
 * @param {Record<string, unknown>} coverageMap coverage-final.json contents
 * @param {Record<string, Record<string, number>>} budgets { areas: { "src/x": { statements: 80 } } }
 * @returns {{ ok: boolean, oks: string[], failures: string[], report: Array<{area, percents, gated}> }}
 */
export function evaluateAreaCoverage(coverageMap, budgets) {
  const areas = budgets.areas ?? {};
  // Group relative keys by the most specific matching area prefix.
  // The report covers EVERY discovered top-level src/<layer> area (so
  // `--report` doubles as the calibration view); budgets only gate the
  // areas explicitly listed in the budgets file.
  const areaKeys = new Map(); // area -> Set<relativeKey>
  const areaOrder = [];
  const addArea = (area) => {
    if (!areaKeys.has(area)) {
      areaKeys.set(area, new Set());
      areaOrder.push(area);
    }
  };
  for (const area of Object.keys(areas)) addArea(area);

  // Precompute a relative-key -> entry map once (avoids a linear scan per
  // file in the aggregation loop below) and discover report-only areas.
  const relToEntry = new Map();
  for (const [absPath, entry] of Object.entries(coverageMap)) {
    const rel = toRelativeKey(absPath);
    relToEntry.set(rel, entry);
    const layer = rel.match(/^src\/[^/]+/);
    if (layer) addArea(layer[0]);
  }

  // Attach each relative key to the most specific budgeted area it matches.
  for (const absPath of Object.keys(coverageMap)) {
    const rel = toRelativeKey(absPath);
    let best = null;
    let bestLen = -1;
    for (const area of Object.keys(areas)) {
      const prefix = `${area.replace(/\/+$/, "")}/`;
      if (rel.startsWith(prefix) && prefix.length > bestLen) {
        best = area;
        bestLen = prefix.length;
      }
    }
    if (best !== null) {
      if (!areaKeys.has(best)) addArea(best);
      areaKeys.get(best).add(rel);
    } else {
      // No budgeted prefix matched: report-only areas get their files too
      // so `--report` shows real numbers for calibration.
      const layer = rel.match(/^src\/[^/]+/);
      if (layer) {
        addArea(layer[0]);
        areaKeys.get(layer[0]).add(rel);
      }
    }
  }

  const failures = [];
  const oks = [];
  const report = [];

  for (const area of areaOrder) {
    const budget = areas[area];
    const files = areaKeys.get(area);
    if (!budget) {
      // Discovered-only area: report it, never gate it.
      const percents = {};
      if (files && files.size > 0) {
        const totals = { statements: 0, branches: 0, functions: 0, lines: 0 };
        const covered = { statements: 0, branches: 0, functions: 0, lines: 0 };
        for (const rel of files) {
          const metrics = fileMetrics(relToEntry.get(rel));
          for (const metric of Object.keys(totals)) {
            totals[metric] += metrics[metric][0];
            covered[metric] += metrics[metric][1];
          }
        }
        for (const metric of Object.keys(totals)) {
          percents[metric] = totals[metric] > 0 ? (covered[metric] / totals[metric]) * 100 : null;
        }
      }
      report.push({ area, percents, gated: false });
      continue;
    }
    if (!files || files.size === 0) {
      const label = Object.keys(budget).map((m) => `${m}>=${budget[m]}`).join(" ");
      failures.push(`${area}: no files matched (budget ${label})`);
      report.push({ area, percents: {}, gated: true });
      continue;
    }
    const totals = { statements: 0, branches: 0, functions: 0, lines: 0 };
    const covered = { statements: 0, branches: 0, functions: 0, lines: 0 };
    for (const rel of files) {
      const metrics = fileMetrics(relToEntry.get(rel));
      for (const metric of Object.keys(totals)) {
        totals[metric] += metrics[metric][0];
        covered[metric] += metrics[metric][1];
      }
    }
    const percents = {};
    for (const metric of Object.keys(totals)) {
      percents[metric] = totals[metric] > 0 ? (covered[metric] / totals[metric]) * 100 : null;
    }
    let gated = false;
    for (const [metric, min] of Object.entries(budget)) {
      const value = percents[metric];
      // A null value means the metric has no data for this area (e.g. no
      // instrumented lines) — skip it rather than report a misleading 100%.
      if (typeof value !== "number") {
        continue;
      }
      if (value < min) {
        failures.push(
          `${area}: ${metric} ${value.toFixed(1)}% < ${min}% (budget)`,
        );
        gated = true;
      }
    }
    if (!gated) {
      oks.push(
        `${area}: ${Object.entries(budget)
          .map(([m, v]) =>
            typeof percents[m] === "number"
              ? `${m} ${percents[m].toFixed(1)}% >= ${v}%`
              : `${m} n/a (no data)`,
          )
          .join(", ")}`,
      );
    }
    report.push({ area, percents, gated });
  }

  return { ok: failures.length === 0, oks, failures, report };
}

/**
 * Combine the aggregate Vitest-equivalent gate and every per-area gate.
 * Both CLI entry points consume this result so they cannot disagree about
 * the effective pass/fail status for the same coverage map.
 */
export function evaluateCoverageGates(coverageMap, budgets) {
  const global = evaluateGlobalCoverage(coverageMap, budgets.global);
  const areas = evaluateAreaCoverage(coverageMap, budgets);
  return {
    ok: global.ok && areas.ok,
    global,
    areas,
    failures: [
      ...global.failures.map((failure) => `global: ${failure}`),
      ...areas.failures,
    ],
  };
}

// ── CLI wrapper ──────────────────────────────────────────────────────

const isMain =
  process.argv[1] &&
  import.meta.url ===
    new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;

if (isMain) {
  const reportOnly = process.argv.includes("--report");
  const idxCov = process.argv.indexOf("--coverage-file");
  const coverageFile =
    (idxCov !== -1 ? process.argv[idxCov + 1] : undefined) || DEFAULT_COVERAGE_FILE;
  const idxBud = process.argv.indexOf("--budgets");
  const budgetsFile =
    (idxBud !== -1 ? process.argv[idxBud + 1] : undefined) || DEFAULT_BUDGETS_FILE;

  if (!existsSync(coverageFile)) {
    if (reportOnly) {
      console.log(`[check-coverage-by-area] ${coverageFile} absent — nothing to report (${reportOnly ? "report mode" : "gate skipped"})`);
      process.exit(0);
    }
    console.error(
      `[check-coverage-by-area] FAIL ${coverageFile} missing — run \`npm run test:coverage\` first`,
    );
    process.exit(1);
  }
  if (!existsSync(budgetsFile)) {
    console.error(
      `[check-coverage-by-area] FAIL ${budgetsFile} missing — create scripts/coverage-area-budgets.json`,
    );
    process.exit(1);
  }

  const coverageMap = JSON.parse(readFileSync(coverageFile, "utf8"));
  const budgets = JSON.parse(readFileSync(budgetsFile, "utf8"));
  const result = evaluateCoverageGates(coverageMap, budgets);
  const globalResult = result.global;
  const areaResult = result.areas;

  const globalPercents = Object.entries(globalResult.percents)
    .map(([metric, value]) => (typeof value === "number" ? `${metric} ${value.toFixed(2)}%` : `${metric} n/a`))
    .join(" ");
  console.log(
    `[check-coverage-by-area] global: ${globalPercents}` +
      (globalResult.ok ? "" : "  [GATED]"),
  );

  for (const row of areaResult.report) {
    const percents = Object.entries(row.percents)
      .map(([m, v]) => (typeof v === "number" ? `${m} ${v.toFixed(1)}%` : `${m} n/a`))
      .join(" ");
    console.log(
      `[check-coverage-by-area] ${row.area}: ${percents || "no files"}` +
        (row.gated ? "  [GATED]" : ""),
    );
  }
  for (const o of areaResult.oks) console.log(`[check-coverage-by-area] ok ${o}`);
  for (const f of result.failures)  console.error(`[check-coverage-by-area] FAIL ${f}`);

  if (!reportOnly && result.failures.length > 0) {
    console.error(
      `[check-coverage-by-area] ${result.failures.length} coverage gate failure(s) — add tests or update scripts/coverage-area-budgets.json`,
    );
    process.exit(1);
  }
  console.log(
    `[check-coverage-by-area] ${result.ok ? "all area budgets met" : "failures found"} (report-only: ${reportOnly})`,
  );
}
