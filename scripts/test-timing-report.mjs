// Test timing report — aggregates per-file durations from the bounded runner's
// output so the slowest test areas are visible at a glance.
//
//   node scripts/test-timing-report.mjs                  # runs `npm test` and reports
//   node scripts/test-timing-report.mjs --log <file>     # parses an existing run's log
//
// The log is the stdout of `npm test` (scripts/test-bounded.mjs): vitest's
// default reporter prints one line per test file with its duration in ms.
// ANSI color codes are stripped before parsing, so both TTY and redirected
// output work. Durations are the per-file wall time inside each batch, which
// is the right signal for "where does the suite spend its time".
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();

const args = process.argv.slice(2);
const logIndex = args.indexOf("--log");
let logPath = null;
if (logIndex !== -1 && args[logIndex + 1]) {
  logPath = args[logIndex + 1];
}

function captureSuiteOutput() {
  console.log("[test-timing-report] running `npm test` (this can take several minutes)...");
  const result = spawnSync(
    process.execPath,
    ["scripts/test-bounded.mjs"],
    { cwd: ROOT, env: process.env, encoding: "utf8", maxBuffer: 1024 * 1024 * 64 },
  );
  if (result.error) {
    throw result.error;
  }
  return result.stdout;
}

const raw = logPath
  ? (() => {
      const absolute = isAbsolute(logPath) ? logPath : join(ROOT, logPath);
      if (!existsSync(absolute)) {
        console.error(`[test-timing-report] log not found: ${absolute}`);
        process.exit(1);
      }
      return readFileSync(absolute, "utf8");
    })()
  : captureSuiteOutput();

// Strip ANSI escapes, then match vitest's per-file line:
//   ✓ src/tests/components/Foo.test.tsx (12 tests) 345ms
//   × src/tests/... (6 tests | 2 failed) 16ms
const clean = raw.replace(/\x1b\[[0-9;]*m/g, "");
const FILE_LINE =
  /^\s*[✓✗×❯]\s+(\S+\.test\.(?:ts|tsx|mjs))\s+\((\d+) tests?(?:\s*\|\s*\d+ failed)?\)\s+(\d+)ms$/gm;

const entries = [];
for (const match of clean.matchAll(FILE_LINE)) {
  entries.push({
    file: match[1].replace(/\\/g, "/"),
    tests: Number.parseInt(match[2], 10),
    ms: Number.parseInt(match[3], 10),
  });
}

if (entries.length === 0) {
  console.error("[test-timing-report] no per-file duration lines found in the input");
  process.exit(1);
}

const totalMs = entries.reduce((sum, e) => sum + e.ms, 0);
const totalTests = entries.reduce((sum, e) => sum + e.tests, 0);

// Aggregate by area: src/tests/<area>, src/<area> or <root>/<area>.
const areaOf = (file) => {
  const parts = file.split("/");
  const testsIndex = parts.indexOf("tests");
  if (
    testsIndex >= 0 &&
    parts[testsIndex - 1] === "src" &&
    parts[testsIndex + 1] &&
    !parts[testsIndex + 1].includes(".test.")
  ) {
    return `src/tests/${parts[testsIndex + 1]}`;
  }
  if (parts[0] === "src" && parts[1] === "tests") {
    return "src/tests (root)";
  }
  return parts.slice(0, 2).join("/");
};

const areas = new Map();
for (const e of entries) {
  const area = areaOf(e.file);
  const acc = areas.get(area) ?? { files: 0, tests: 0, ms: 0 };
  acc.files += 1;
  acc.tests += e.tests;
  acc.ms += e.ms;
  areas.set(area, acc);
}

const areaRows = [...areas.entries()]
  .map(([name, a]) => ({ name, ...a, pct: (a.ms / totalMs) * 100 }))
  .sort((a, b) => b.ms - a.ms);

const slowest = [...entries].sort((a, b) => b.ms - a.ms).slice(0, 25);

const pad = (s, n) => String(s).padEnd(n);

console.log("\n=== Test timing report ===");
console.log(
  `${entries.length} test files, ${totalTests} tests, ` +
    `${(totalMs / 1000).toFixed(1)}s total reported file time` +
    (logPath ? ` (parsed from ${logPath})` : ""),
);
console.log("\n--- Slowest areas (reported file time) ---");
console.log(`${pad("area", 24)} ${pad("files", 6)} ${pad("tests", 7)} ${pad("time", 10)} ${pad("share", 7)}`);
let cumulative = 0;
for (const row of areaRows) {
  cumulative += row.pct;
  const marker = cumulative <= 80 ? " *" : "";
  console.log(
    `${pad(row.name, 24)} ${pad(row.files, 6)} ${pad(row.tests, 7)} ` +
      `${pad(`${(row.ms / 1000).toFixed(1)}s`, 10)} ${pad(`${row.pct.toFixed(1)}%`, 7)}${marker}`,
  );
}
console.log("\n* = contributes to the first 80% of reported time (optimization focus)");

console.log("\n--- 25 slowest test files ---");
console.log(`${pad("file", 58)} ${pad("tests", 7)} ${pad("time", 10)}`);
for (const e of slowest) {
  console.log(
    `${pad(e.file, 58)} ${pad(e.tests, 7)} ${pad(`${(e.ms / 1000).toFixed(1)}s`, 10)}`,
  );
}
console.log("\nNote: file time is execution inside its batch; setup/teardown per batch is not included.");
