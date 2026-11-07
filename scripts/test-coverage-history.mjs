/**
 * Append one coverage run to coverage-history.json.
 *
 * The history is deliberately one JSON document rather than JSONL: the area
 * order is stored once at the top level and every run contains exactly one
 * line-coverage number per configured area. Line coverage is the headline
 * trend metric; the full statements/branches/functions report remains in
 * coverage/coverage-final.json and is enforced by check-coverage-by-area.mjs.
 *
 * Usage:
 *   node scripts/test-coverage-history.mjs
 *   node scripts/test-coverage-history.mjs --coverage-file coverage/coverage-final.json --history-file coverage-history.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { evaluateAreaCoverage } from "./check-coverage-by-area.mjs";

const ROOT = process.cwd();
const DEFAULT_COVERAGE_FILE = join(ROOT, "coverage", "coverage-final.json");
const DEFAULT_BUDGETS_FILE = join(ROOT, "scripts", "coverage-area-budgets.json");
const DEFAULT_HISTORY_FILE = join(ROOT, "coverage-history.json");
const HISTORY_VERSION = 1;
const HISTORY_METRIC = "lines";

function optionValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1] || fallback;
}

/**
 * Calculate one line-coverage percentage for every configured area.
 *
 * @param {Record<string, unknown>} coverageMap coverage-final.json contents
 * @param {{ areas: Record<string, unknown> }} budgets coverage budget document
 * @returns {Record<string, number>}
 */
export function calculateAreaLineCoverage(coverageMap, budgets) {
  const configuredAreas = Object.keys(budgets.areas ?? {});
  const report = evaluateAreaCoverage(coverageMap, { areas: budgets.areas ?? {} }).report;
  const byArea = new Map(report.map((row) => [row.area, row.percents.lines]));
  const values = {};

  for (const area of configuredAreas) {
    const value = byArea.get(area);
    if (typeof value !== "number") {
      throw new Error(`[coverage-history] ${area} has no executable line coverage`);
    }
    values[area] = Number(value.toFixed(2));
  }

  return values;
}

/**
 * Create a new history document or validate an existing document's schema.
 */
export function createOrValidateHistory(history, areas) {
  if (history === null || history === undefined) {
    return { version: HISTORY_VERSION, metric: HISTORY_METRIC, areas, runs: [] };
  }
  if (
    history.version !== HISTORY_VERSION ||
    history.metric !== HISTORY_METRIC ||
    JSON.stringify(history.areas) !== JSON.stringify(areas) ||
    !Array.isArray(history.runs)
  ) {
    throw new Error(
      "[coverage-history] existing history has a different version, metric, area catalog, or runs shape",
    );
  }
  return history;
}

/**
 * Append one run without mutating the caller's parsed history object.
 */
export function appendCoverageHistory(history, values, timestamp = new Date()) {
  const areaNames = history.areas;
  const missing = areaNames.filter((area) => typeof values[area] !== "number");
  if (missing.length > 0) {
    throw new Error(`[coverage-history] missing numeric values for: ${missing.join(", ")}`);
  }
  return {
    ...history,
    runs: [
      ...history.runs,
      {
        timestamp: new Date(timestamp).toISOString(),
        values: Object.fromEntries(areaNames.map((area) => [area, values[area]])),
      },
    ],
  };
}

/**
 * Read coverage and append one entry to the configured JSON history file.
 */
export function appendCoverageHistoryFile({
  coverageFile = DEFAULT_COVERAGE_FILE,
  budgetsFile = DEFAULT_BUDGETS_FILE,
  historyFile = DEFAULT_HISTORY_FILE,
  now = new Date(),
} = {}) {
  let coverageRaw;
  let budgetsRaw;
  try {
    coverageRaw = readFileSync(coverageFile, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(`[coverage-history] ${coverageFile} missing — run coverage first`);
    throw error;
  }
  try {
    budgetsRaw = readFileSync(budgetsFile, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(`[coverage-history] ${budgetsFile} missing`);
    throw error;
  }

  const coverageMap = JSON.parse(coverageRaw);
  const budgets = JSON.parse(budgetsRaw);
  const areas = Object.keys(budgets.areas ?? {});
  if (areas.length !== 15) {
    throw new Error(`[coverage-history] expected 15 configured areas, found ${areas.length}`);
  }

  let existing;
  try {
    existing = JSON.parse(readFileSync(historyFile, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const history = createOrValidateHistory(existing, areas);
  const values = calculateAreaLineCoverage(coverageMap, budgets);
  const next = appendCoverageHistory(history, values, now);
  writeFileSync(historyFile, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return { history: next, values, historyFile };
}

const isMain =
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;

if (isMain) {
  try {
    const result = appendCoverageHistoryFile({
      coverageFile: resolve(ROOT, optionValue("--coverage-file", DEFAULT_COVERAGE_FILE)),
      budgetsFile: resolve(ROOT, optionValue("--budgets-file", DEFAULT_BUDGETS_FILE)),
      historyFile: resolve(ROOT, optionValue("--history-file", DEFAULT_HISTORY_FILE)),
    });
    console.log(
      `[coverage-history] appended ${result.history.runs.at(-1).timestamp} ` +
        `(${Object.keys(result.values).length} areas) to ${result.historyFile}`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
