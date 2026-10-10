#!/usr/bin/env node
/**
 * scripts/analyze-vacuous-tests.mjs — AST-based vacuous-test detector.
 *
 * Purpose: quantify how many tests in a Playwright suite can never fail for
 * the behavior they claim to cover — the `if (await x.isVisible().catch(..
 * )) { await expect(x).toBeVisible(); }` pattern, where the assertion is
 * skipped (and the test passes) exactly when the feature under test is
 * absent.
 *
 * The classification itself lives in `scripts/tooling/vacuous-tests.mjs` and
 * is shared with the ratchet (`scripts/check-vacuous-tests.mjs`): the number a
 * maintainer reads here and the number the gate enforces must be produced by
 * the same code, or the gate measures something other than the report says.
 * This script keeps the human surface — the table, the top-20 list, the JSON
 * export — and adds nothing of its own to the classification.
 *
 * Usage:
 *   node scripts/analyze-vacuous-tests.mjs                 # table + top-20
 *   node scripts/analyze-vacuous-tests.mjs <suite-dir>     # another directory
 *   node scripts/analyze-vacuous-tests.mjs --json out.json # write JSON
 */
import { writeFileSync } from "node:fs";
import {
  analyzeSuite,
  collectSpecFiles,
  toRepoPath,
} from "./tooling/vacuous-tests.mjs";

let ROOT = "src/tests/human-like/examples";
let OUT = null;
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === "--json") OUT = process.argv[++i];
  else ROOT = process.argv[i];
}

const { files, totals } = analyzeSuite(ROOT, { root: process.cwd() });

const report = {
  files: files.map(({ details: _details, ...summary }) => summary),
  totals,
};

if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 2));

const pct = (n) => (totals.tests ? ((n / totals.tests) * 100).toFixed(1) : "0");
console.log(`\nSuite: ${ROOT}`);
console.log(`Files: ${totals.files} · Tests: ${totals.tests}`);
console.log(`  empty   (0 expects)              : ${String(totals.empty).padStart(5)}  (${pct(totals.empty)}%)`);
console.log(`  guarded (all asserts conditional) : ${String(totals.guarded).padStart(5)}  (${pct(totals.guarded)}%)`);
console.log(`  mixed                             : ${String(totals.mixed).padStart(5)}  (${pct(totals.mixed)}%)`);
console.log(`  real                              : ${String(totals.real).padStart(5)}  (${pct(totals.real)}%)`);
console.log(`VACUOUS = empty + guarded           : ${totals.vacuous} (${pct(totals.vacuous)}%)`);

const worst = [...files]
  .filter((f) => f.tests > 0 && f.vacuous === f.tests)
  .sort((a, b) => b.tests - a.tests);
console.log(`\n100% vacuous files (top 20 by test count):`);
for (const f of worst.slice(0, 20)) {
  console.log(`  ${String(f.tests).padStart(3)} tests  ${f.lines.toString().padStart(4)} lines  ${f.file}`);
}

// Sanity net, not documentation: these two assertions pin the shared module to
// this script's own filesystem walk, so a future edit to either side that
// makes the report disagree with the suite fails loudly here instead of
// quietly producing a number the gate does not enforce.
const walked = collectSpecFiles(ROOT).length;
const repoRelative = new Set(files.map((f) => f.file));
const missing = collectSpecFiles(ROOT)
  .map((file) => toRepoPath(process.cwd(), file))
  .filter((path) => !repoRelative.has(path));
if (walked !== totals.files || missing.length > 0) {
  console.error(
    `[analyze-vacuous-tests] internal error: walked ${walked} file(s) but ` +
      `classified ${totals.files}${missing.length ? `; unclassified: ${missing.join(", ")}` : ""}`,
  );
  process.exit(1);
}
