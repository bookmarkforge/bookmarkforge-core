/**
 * Run the coverage-producing Vitest command and the per-area gate as one
 * coverage contract. The Vitest config and check-coverage-by-area.mjs both
 * read scripts/coverage-area-budgets.json, so this command is the single CI
 * entry point for aggregate and per-area coverage. Each completed coverage
 * artifact is also appended to coverage-history.json for trend reporting.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const vitestEntrypoint = resolve("node_modules/vitest/vitest.mjs");
if (!existsSync(vitestEntrypoint)) {
  console.error("[coverage] FAIL node_modules/vitest/vitest.mjs is missing — run npm ci first");
  process.exit(1);
}

const vitest = spawnSync(process.execPath, [vitestEntrypoint, "run", "--coverage"], {
  stdio: "inherit",
});
const vitestStatus = vitest.error ? 1 : (vitest.status ?? 1);

// Vitest does not emit coverage artifacts when any test fails. Avoid running
// the history and per-area consumers against missing/invalid output; the
// Vitest failure is already the authoritative coverage-gate failure and the
// shorter path makes CI diagnostics and feedback faster.
if (vitestStatus !== 0) {
  console.error("[coverage] skipping history and per-area checks because Vitest failed");
  process.exit(1);
}

const historyRun = spawnSync(process.execPath, [resolve("scripts/test-coverage-history.mjs")], {
  stdio: "inherit",
});
const historyStatus = historyRun.error ? 1 : (historyRun.status ?? 1);

const areaGate = spawnSync(process.execPath, [resolve("scripts/check-coverage-by-area.mjs")], {
  stdio: "inherit",
});
const areaStatus = areaGate.error ? 1 : (areaGate.status ?? 1);

const status = vitestStatus === 0 && historyStatus === 0 && areaStatus === 0 ? 0 : 1;
console.log(
  `[coverage] aggregate=${vitestStatus === 0 ? "pass" : "fail"} ` +
    `history=${historyStatus === 0 ? "pass" : "fail"} ` +
    `per-area=${areaStatus === 0 ? "pass" : "fail"} exit=${status}`,
);
process.exit(status);
