import { existsSync } from "node:fs";
import os from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import {
  evaluateTimings,
  optsFromEnv,
  loadBaseline,
  parseTimings,
  resolveTimingMode,
  saveBaseline,
} from "./check-test-timing.mjs";
import { PROFILE_DEFAULTS } from "./test-profiles.mjs";
// Which files a profile schedules is owned by scripts/test-files.mjs (shared
// with scripts/check-audit-freshness.mjs, which re-derives the fast-profile
// count docs/audit.md publishes); this runner must not grow a second walk.
import {
  allTestFiles as collectAllTestFiles,
  collectRequestedTestFiles,
  fastProfileFiles as collectFastProfileFiles,
  isProjectPathArg,
  normalizeProjectPath,
  slowSurfaceFiles as collectSlowSurfaceFiles,
} from "./test-files.mjs";
import { runPreflight } from "./drift-preflight.mjs";

const ROOT = process.cwd();
// Cores-aware default concurrency (2026-09-04 measurement matrix on the full
// ~524-file suite in src/tests/):
//   batch 80 + 2 workers = 482 s (worker B idled 56 s; straggler batch 201 s)
//   batch 40 + 3 workers = 312 s (35% faster; 14 batches over 3 lanes,
//   last batch 24 s). The default is deliberately capped at 2: some contract
//   tests launch full Vite builds and three simultaneous Node process trees
//   proved unreliable on Windows (spawn UNKNOWN / native child exit). Opt in
//   to 3 only on a runner with measured headroom via
//   BMF_TEST_CONCURRENCY=3. Formula min(2, max(1, cores - 2)) keeps 2 workers
//   on CI-class 4-vCPU runners and 1 on tiny machines; batch 40 balances the
//   per-batch vitest boot (~1.1 s) against a short straggler tail. Each
//   child stays single-worker (per-process memory bound, shared
//   browser/crypto/IndexedDB shims isolated per child). Lower with
//   BMF_TEST_CONCURRENCY=1 / BMF_TEST_BATCH_SIZE=20 on constrained machines.
// ── Profile selection ──────────────────────────────────────────────────────
// `--profile fast|slow` picks a predefined file surface plus its timing and
// batching defaults (scripts/test-profiles.mjs): fast is the curated smoke +
// critical-area set, slow is every other test file. Without --profile the
// behavior is unchanged: explicit selectors run as given (5 s bar), and
// `npm test` with no selectors runs the whole tree with the slow profile's
// semantics (it IS the slow surface, which CI's slow-tests job enforces).
const PROFILE_ARGS = process.argv.slice(2);
let profile = null;
let cleanedArgs = PROFILE_ARGS;
const profileArgIndex = PROFILE_ARGS.indexOf("--profile");
if (profileArgIndex !== -1) {
  const value = PROFILE_ARGS[profileArgIndex + 1];
  if (value !== "fast" && value !== "slow") {
    console.error(
      `[test-bounded] unknown --profile "${value ?? ""}" (expected fast|slow)`,
    );
    process.exit(2);
  }
  profile = value;
  cleanedArgs = [...PROFILE_ARGS];
  cleanedArgs.splice(profileArgIndex, 2);
}

// Drift preflight (AGENTS.md §9): warn at the top of the run when a drift
// gate's script is newer than its generated baseline — a half-updated batch
// (script edited, baseline pending) is indistinguishable from a real
// regression once tests execute. Advisory: it never fails the run; the drift
// gates themselves decide. See scripts/drift-preflight.mjs;
// BMF_DRIFT_PREFLIGHT=off disables (gate:refresh sets it: it WRITES the
// artifacts and would warn about itself).
const preflightExit = runPreflight({ argv: [] });
if (preflightExit !== 0) process.exit(preflightExit);

const configuredBatchSize = Number.parseInt(
  process.env.BMF_TEST_BATCH_SIZE ??
    String(PROFILE_DEFAULTS[profile ?? "slow"].batchSize),
  10,
);
const BATCH_SIZE =
  Number.isInteger(configuredBatchSize) && configuredBatchSize > 0
    ? Math.min(configuredBatchSize, 100)
    : 40;
const configuredConcurrency = Number.parseInt(
  process.env.BMF_TEST_CONCURRENCY ??
    String(Math.min(2, Math.max(1, (os.availableParallelism?.() ?? os.cpus().length) - 2)) || 2),
  10,
);
const CONCURRENCY =
  Number.isInteger(configuredConcurrency) && configuredConcurrency > 0
    ? Math.min(configuredConcurrency, 4)
    : 2;
// Time-budget fallback: once the suite has consumed SHRINK_AT of its budget,
// halve the remaining batch size so both children pick up fresh files sooner
// (shortens the straggler tail without raising total concurrency), warn at
// WARN_AT, and stop scheduling new batches once the budget is exhausted.
const SHRINK_AT = 0.8;
const WARN_AT = 0.9;
const MIN_BATCH_SIZE = 10;

const allTestFiles = collectAllTestFiles(ROOT);

if (allTestFiles.length === 0) {
  console.error("[test-bounded] no test files found");
  process.exit(1);
}

const selectorArgs = new Set(
  cleanedArgs.filter((arg) => {
    if (!isProjectPathArg(arg)) {return false;}
    return existsSync(resolve(ROOT, normalizeProjectPath(arg)));
  }),
);
// Do not pass selectors through to every batch: doing so would make Vitest
// re-expand the directory for each child and defeat the memory bound. Worker
// flags are owned by this runner as well; otherwise a caller's `--maxWorkers`
// could silently defeat the process-level memory bound.
const isWorkerOption = (arg) =>
  /^--(?:maxWorkers|minWorkers|fileParallelism)=/.test(arg) ||
  arg === "--no-file-parallelism";
const passthrough = [];
for (let i = 0; i < cleanedArgs.length; i += 1) {
  const arg = cleanedArgs[i];
  if (arg === "--maxWorkers" || arg === "--minWorkers" || arg === "--fileParallelism") {
    i += 1; // discard the separate value owned by this runner
    continue;
  }
  if (
    arg === "--run" ||
    selectorArgs.has(arg) ||
    isWorkerOption(arg)
  ) {
    continue;
  }
  passthrough.push(arg);
}
const requestedFiles = collectRequestedTestFiles([...selectorArgs], ROOT);
if (profile !== null && selectorArgs.size > 0) {
  console.error(
    "[test-bounded] --profile cannot be combined with explicit test selectors " +
      `(got: ${[...selectorArgs].join(", ")})`,
  );
  process.exit(2);
}
const testOutputMode = process.env.BMF_TEST_LOGS ?? "quiet";
const shouldSilencePassedTests =
  testOutputMode !== "full" &&
  !cleanedArgs.some((arg) => arg === "--silent" || arg.startsWith("--silent="));

function testOutputArgs() {
  return shouldSilencePassedTests ? ["--silent=passed-only"] : [];
}

// ── Slow-file-first scheduling ─────────────────────────────────────────────
// The queue is consumed FIFO as consecutive batches of BATCH_SIZE files, so
// list order decides which batch owns each file. With plain alphabetical
// order a pinned slow file can land in the last batch, where it runs alone on
// one worker after the others have drained — the straggler tail batch
// measured on 2026-09-04 (one 201 s batch at batch 80 / 2 workers). The fix
// is to move the timing baseline's pinned files to the HEADS of the first
// wave of batches, balanced across those batches by pinned duration, so all
// workers absorb the long work up front and every tail batch is pure fast.
// The layout stays deterministic: slow files round-robin into the leading
// batches (pinned ms descending), fast files fill every other slot in their
// original order. No pinned file can ever reach the final batch, so the tail
// drains in seconds. Skipped entirely when nothing is pinned or the whole
// run is pinned.
function orderSlowFilesFirst(files) {
  const baseline = loadBaseline();
  const pinned = baseline?.files;
  if (!pinned || files.length === 0) {return files;}
  const toPosix = (f) => f.replaceAll("\\", "/");
  const slow = files.filter((f) => pinned[toPosix(f)] !== undefined);
  const fast = files.filter((f) => pinned[toPosix(f)] === undefined);
  if (slow.length === 0 || fast.length === 0) {return files;}
  const batchCount = Math.ceil(files.length / BATCH_SIZE);
  // Lead batches = the first concurrent wave, widened so no lead batch is
  // asked to hold more slow files than its BATCH_SIZE capacity. The final
  // batch is never a lead batch: keeping it fast is the whole point. When
  // slow files outnumber every non-final slot, no ordering can keep the tail
  // fast — keep the original order rather than pretend otherwise.
  const waveBatches = Math.min(CONCURRENCY, Math.max(1, batchCount - 1));
  const leadBatches = Math.min(
    Math.max(1, batchCount - 1),
    Math.max(waveBatches, Math.ceil(slow.length / BATCH_SIZE)),
  );
  if (leadBatches * BATCH_SIZE < slow.length) {return files;}
  // Round-robin slow files (slowest first) across the lead batches, then fill
  // every remaining slot with fast files in their original order.
  const sortedSlow = slow.sort((a, b) => (pinned[toPosix(b)] ?? 0) - (pinned[toPosix(a)] ?? 0));
  const ordered = new Array(files.length);
  sortedSlow.forEach((file, index) => {
    ordered[(index % leadBatches) * BATCH_SIZE + Math.floor(index / leadBatches)] = file;
  });
  let fastIndex = 0;
  for (let i = 0; i < ordered.length; i += 1) {
    if (ordered[i] !== undefined) {continue;}
    ordered[i] = fast[fastIndex];
    fastIndex += 1;
  }
  return ordered;
}
// The slow surface is the whole tree minus the fast profile minus the files
// vitest excludes (see vitest.config.ts test.exclude) — scheduled ==
// executed must hold so the runner's "all N passed" is truthful. `npm test`
// with no selectors runs the same surface with the same semantics.
const slowSurfaceFiles = collectSlowSurfaceFiles(ROOT);
const isSlowSurface =
  profile === "slow" || (profile === null && requestedFiles.length === 0);
let filesToRun;
if (profile === "fast") {
  filesToRun = collectFastProfileFiles(ROOT);
} else if (isSlowSurface) {
  filesToRun = slowSurfaceFiles;
} else {
  filesToRun = requestedFiles;
}
filesToRun = orderSlowFilesFirst(filesToRun);
// The slow surface gets a 15-minute budget: the ~480-file tail legitimately
// needs 5-8 min, and the shrink-at-80% logic would otherwise start halving
// batches mid-run on slow runners. The selector-only path keeps the original
// 10-minute default.
const SUITE_TIME_LIMIT_MS = (() => {
  const parsed = Number.parseInt(
    process.env.BMF_TEST_TIME_LIMIT_MS ??
      (isSlowSurface ? "900000" : "600000"),
    10,
  );
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : isSlowSurface
      ? 900000
      : 600000;
})();
// The profile's own new-file bar (5 s fast / 10 s slow); an explicit
// BMF_TEST_TIMING_MS still wins for ad-hoc tuning.
const TIMING_THRESHOLD_MS = process.env.BMF_TEST_TIMING_MS
  ? optsFromEnv(process.env).thresholdMs
  : PROFILE_DEFAULTS[isSlowSurface ? "slow" : "fast"].thresholdMs;

console.log(
  `[test-bounded] ${profile ?? (isSlowSurface ? "slow" : "custom")} profile: ` +
    `${filesToRun.length} file(s), new-file bar ${TIMING_THRESHOLD_MS}ms, ` +
    `time budget ${SUITE_TIME_LIMIT_MS}ms`,
  );
const vitestBin = join(ROOT, "node_modules", "vitest", "vitest.mjs");
const suiteStartedAt = Date.now();
// The queue is consumed dynamically (rather than pre-sliced) so the batch
// size can shrink mid-run when the suite approaches its time budget.
let nextFileIndex = 0;
let batchNumber = 0;
let batchSizeShrunk = false;
let warnedAt90 = false;
let timeLimitHit = false;
let firstFailure = null;

function runBatch(batch, number) {
  const batchStartedAt = Date.now();
  const remaining = filesToRun.length - nextFileIndex;
  console.log(
    `[test-bounded] batch ${number} (${batch.length} files, ${remaining} remaining) started ` +
      `(concurrency ${CONCURRENCY}, suite elapsed ${Date.now() - suiteStartedAt}ms)`,
  );

  return new Promise((resolveBatch) => {
    const child = spawn(
      process.execPath,
      [
        vitestBin,
        "run",
        ...passthrough,
        ...testOutputArgs(),
        "--maxWorkers=1",
        ...batch,
      ],
      {
        cwd: ROOT,
        env: {
          ...process.env,
          // One shared Vite transform cache for every child (persists across
          // runs; see the cacheDir note in vitest.config.ts). Override with
          // BMF_TEST_CACHE_DIR to isolate a run.
          BMF_TEST_CACHE_DIR:
            process.env.BMF_TEST_CACHE_DIR ?? "node_modules/.vite-test-bounded",
        },
        stdio: TIMING_MODE === "off" ? "inherit" : ["ignore", "pipe", "inherit"],
      },
    );

    if (TIMING_MODE !== "off" && child.stdout) {
      child.stdout.pipe(process.stdout);
      child.stdout.on("data", captureChunk);
    }
    child.once("error", (error) => {
      resolveBatch({ status: 1, signal: null, error });
    });
    child.once("exit", (status, signal) => {
      resolveBatch({ status: status ?? 1, signal, error: null });
    });
  }).then((result) => {
    const batchElapsed = Date.now() - batchStartedAt;
    console.log(
      `[test-bounded] batch ${number} finished in ${batchElapsed}ms ` +
        `(suite elapsed ${Date.now() - suiteStartedAt}ms)`,
    );
    if (result.error) {
      console.error(`[test-bounded] failed to start batch ${number}:`, result.error);
    } else if (result.status !== 0) {
      const signal = result.signal ? ` (${result.signal})` : "";
      console.error(
        `[test-bounded] batch ${number} failed with status ${result.status}${signal}`,
      );
    }
    return { ...result, number };
  });
}

// ── test-timing guard wiring (scripts/check-test-timing.mjs) ───────────────
// The guard is data-driven: it judges whatever this run actually executed.
// Modes via BMF_TEST_TIMING: "1" enforce, "update" re-pin, unset = warn
// locally (CI defaults to enforce); BMF_TEST_TIMING_OFF=1 disables. A guard
// failure in enforce mode escalates the exit code without ever masking a
// real test failure (firstFailure wins).
const TIMING_MODE = resolveTimingMode(process.env, { isCI: Boolean(process.env.CI) });
let suiteOutput = "";
const SUITE_OUTPUT_CAP = 32 * 1024 * 1024;
function captureChunk(chunk) {
  if (suiteOutput.length < SUITE_OUTPUT_CAP) {suiteOutput += chunk;}
}

function runTimingGuard() {
  if (TIMING_MODE === "off") {return;}
  const baseline = loadBaseline();
  const durations = parseTimings(suiteOutput);
  const result = evaluateTimings(durations, baseline, TIMING_MODE === "update" ? "update" : "enforce", {
    ...optsFromEnv(process.env),
    thresholdMs: TIMING_THRESHOLD_MS,
    expectedFiles: new Set(filesToRun.map((f) => f.replaceAll("\\", "/"))),
  });
  for (const line of result.lines) {console.log(line);}
  if (TIMING_MODE === "update") {
    if (result.baseline && baseline?.files) {
      for (const [file, ms] of Object.entries(baseline.files)) {
        if (result.baseline.files[file] === undefined) {result.baseline.files[file] = ms;}
      }
    }
    if (result.baseline) {
      saveBaseline(result.baseline);
      console.log(`[test-timing] baseline written: ${Object.keys(result.baseline.files).length} file(s)`);
    }
    return;
  }
  if (TIMING_MODE === "enforce" && !result.ok && firstFailure === null) {
    firstFailure = { status: 1, signal: null, error: new Error("test-timing guard failed") };
  }
  // warn mode: report only — never affects the exit code.
}

async function runSuite() {
  function effectiveBatchSize(elapsedMs) {
    // Shrink never exceeds the current batch size: it halves it (down to
    // MIN_BATCH_SIZE) so both children pick up fresh files more often.
    const shrunkSize = Math.min(
      BATCH_SIZE,
      Math.max(MIN_BATCH_SIZE, Math.floor(BATCH_SIZE / 2)),
    );
    if (!batchSizeShrunk && elapsedMs >= SUITE_TIME_LIMIT_MS * SHRINK_AT) {
      batchSizeShrunk = true;
      if (shrunkSize < BATCH_SIZE) {
        console.warn(
          `[test-bounded] suite at ${Math.round((elapsedMs / SUITE_TIME_LIMIT_MS) * 100)}% ` +
            `of time budget (${SUITE_TIME_LIMIT_MS}ms); shrinking remaining batches ` +
            `from ${BATCH_SIZE} to ${shrunkSize} files`,
        );
      }
      return shrunkSize;
    }
    return batchSizeShrunk ? shrunkSize : BATCH_SIZE;
  }

  // Returns true when the budget is exhausted and unrun files remain — the
  // caller must stop scheduling. Files that completed before the budget ran
  // out are reported normally; only the unrun tail fails the suite.
  function checkTimeBudget(elapsedMs) {
    const remaining = filesToRun.length - nextFileIndex;
    if (elapsedMs >= SUITE_TIME_LIMIT_MS) {
      if (!timeLimitHit) {
        timeLimitHit = true;
        if (remaining > 0) {
          console.error(
            `[test-bounded] TIME LIMIT exceeded (${SUITE_TIME_LIMIT_MS}ms); ` +
              `${remaining} test file(s) were not run`,
          );
        }
      }
      return remaining > 0;
    }
    if (!warnedAt90 && elapsedMs >= SUITE_TIME_LIMIT_MS * WARN_AT) {
      warnedAt90 = true;
      console.warn(
        `[test-bounded] suite at ${Math.round((elapsedMs / SUITE_TIME_LIMIT_MS) * 100)}% ` +
          `of time budget (${SUITE_TIME_LIMIT_MS}ms)`,
      );
    }
    return false;
  }

  async function worker() {
    while (firstFailure === null) {
      const elapsedMs = Date.now() - suiteStartedAt;
      if (checkTimeBudget(elapsedMs)) {
        if (firstFailure === null) {
          firstFailure = {
            status: 1,
            signal: null,
            error: new Error("suite time limit exceeded"),
          };
        }
        return;
      }
      if (nextFileIndex >= filesToRun.length) {return;}
      const batch = filesToRun.slice(
        nextFileIndex,
        nextFileIndex + effectiveBatchSize(elapsedMs),
      );
      nextFileIndex += batch.length;
      batchNumber += 1;
      const result = await runBatch(batch, batchNumber);
      if (result.status !== 0 && firstFailure === null) {
        firstFailure = result;
      }
    }
  }

  const workerCount = Math.min(CONCURRENCY, filesToRun.length);
  await Promise.all(
    Array.from({ length: workerCount }, () => worker()),
  );

  runTimingGuard();

  if (firstFailure !== null) {
    process.exitCode = firstFailure.status || 1;
    return;
  }

  console.log(
    `[test-bounded] all ${filesToRun.length} test files passed in ` +
      `${Date.now() - suiteStartedAt}ms`,
  );
}

await runSuite();
