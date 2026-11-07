/**
 * scripts/baseline-no-unbounded-text.mjs — unbounded-text lint baseline gate.
 *
 * Counts `bmf/no-unbounded-text` + `bmf/no-unbounded-card-header` violations
 * reported by the project's own ESLint flat config across the same file
 * scope the rules are registered for (every `.tsx` file under `src/`) and
 * fails when the count is GREATER than the committed baseline in
 * scripts/no-unbounded-text-baseline.json.
 *
 * Rationale: both rules ship at `error` and the tree is clean today
 * (baseline 0). `npm run lint` already breaks on any regression; this gate
 * is the second ceiling that converts the error debt into a tracked number
 * with a rebaseline workflow: any NEW case (delta > 0) fails the check,
 * while fixes that reduce the count pass freely. Rebaselining is a
 * deliberate, reviewed action — run `--fix` only when a batch of new cases
 * is accepted on purpose.
 *
 * Mirrors the pattern of scripts/check-i18n-quality.mjs:
 *   node scripts/baseline-no-unbounded-text.mjs            # gate
 *   node scripts/baseline-no-unbounded-text.mjs --fix      # rebaseline
 *   node scripts/baseline-no-unbounded-text.mjs --no-cache # always fresh
 *
 * Performance: the ESLint run is the gate's entire cost (~13.4 s cold over
 * the 350 `.tsx` files under `src/`; measured 2026-09-17), so it shares the EXACT
 * cache that scripts/tooling/lint-bounded.mjs maintains
 * (node_modules/.cache/bookmarkforge-eslint, same flat config → the same
 * per-file cache entries are valid for both). `npm run lint` and the other
 * gates keep that cache warm, which brings repeat runs to ~1-2 s. Cache
 * correctness is ESLint's own contract: entries are keyed per file and
 * invalidated on mtime/size change, and cached results include the rule
 * messages, so the counted violations are identical cold or warm. The
 * --no-cache flag (and any failure to READ or write the cache) falls back
 * to the always-fresh behaviour — the verdict never depends on the cache
 * being available.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ESLint } from "eslint";

const ROOT = process.cwd();
const BASELINE_PATH = join(ROOT, "scripts", "no-unbounded-text-baseline.json");
// Both project rules share the same scope + defense contract; the gate
// tracks them together so a regression in EITHER breaks the ceiling.
const RULE_IDS = new Set([
  "bmf/no-unbounded-text",
  "bmf/no-unbounded-card-header",
]);
// Keep in sync with eslint.config.js: the rule block scopes the plugin to
// `src/**/*.tsx`. Restricting the count to that same glob avoids counting
// non-source files and keeps the baseline stable across tooling changes.
const LINT_PATTERNS = ["src/**/*.tsx"];

// Same flat config, same cache file as lint-bounded → both tools reuse each
// other's entries (see the header note).
const SHARED_CACHE_LOCATION = join(ROOT, "node_modules", ".cache", "bookmarkforge-eslint");

const isFix = process.argv.includes("--fix");
const useCache = !process.argv.includes("--no-cache");

/**
 * Run ESLint programmatically (same flat config as `npm run lint`, no
 * subprocess) and count only the project unbounded-text rule messages.
 * ESLint 9 reports error-severity rule messages in the result object; no
 * legacy `throwOnError`/`throwOnWarning` constructor options are needed.
 * @param {boolean} withCache share the lint-bounded cache location
 * @returns {Promise<{count: number, byFile: Array<{file: string, count: number}>}>}
 */
async function countViolations(withCache) {
  const eslint = new ESLint(
    withCache
      ? { cache: true, cacheLocation: SHARED_CACHE_LOCATION }
      : {},
  );
  const results = await eslint.lintFiles(LINT_PATTERNS);
  let total = 0;
  const perFile = new Map();
  for (const result of results) {
    let fileCount = 0;
    for (const message of result.messages) {
      if (!RULE_IDS.has(message.ruleId)) continue;
      fileCount += 1;
    }
    if (fileCount > 0) perFile.set(result.filePath, fileCount);
    total += fileCount;
  }
  const byFile = [...perFile.entries()]
    .map(([file, count]) => ({ file, count }))
    .sort((a, b) => b.count - a.count);
  return { count: total, byFile };
}

let current;
try {
  current = await countViolations(useCache);
} catch (err) {
  console.error(`[baseline-no-unbounded-text] FAIL: could not run ESLint: ${err.message}`);
  process.exit(1);
}

let baseline = { count: null, updatedAt: null };
try {
  baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
} catch (error) {
  if (error?.code !== "ENOENT") {
    console.error(
      `[baseline-no-unbounded-text] FAIL: ${BASELINE_PATH} is not valid JSON — fix or re-run with --fix`,
    );
    process.exit(1);
  }
}

if (isFix) {
  const next = { count: current.count, updatedAt: new Date().toISOString() };
  writeFileSync(BASELINE_PATH, JSON.stringify(next, null, 2) + "\n");
  console.log(
    `[baseline-no-unbounded-text] baseline updated: ${current.count} violation(s) in ${current.byFile.length} file(s)`,
  );
  process.exit(0);
}

if (baseline.count === null) {
  console.error(
    `[baseline-no-unbounded-text] FAIL: no baseline found at ${BASELINE_PATH}. ` +
      `Run \`npm run check:no-unbounded-text:fix\` once to establish it.`,
  );
  process.exit(1);
}

const delta = current.count - baseline.count;
if (delta > 0) {
  const offenders = current.byFile
    .slice(0, 5)
    .map((f) => `    ${f.file}: ${f.count}`)
    .join("\n");
  console.error(
    `[baseline-no-unbounded-text] FAIL: ${current.count} violation(s) (baseline ${baseline.count}, delta +${delta}) — ` +
      `new unbounded-text / unbounded-card-header case(s) introduced. Add truncate/line-clamp-N/max-w-* or rebaseline with --fix.\n` +
      `  Top offenders:\n${offenders}`,
  );
  process.exit(1);
}

console.log(
  `[baseline-no-unbounded-text] ok: ${current.count} violation(s) (baseline ${baseline.count}, delta ${delta})`,
);
process.exit(0);
