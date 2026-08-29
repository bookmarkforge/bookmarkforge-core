import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { spawn } from "node:child_process";

const ROOT = process.cwd();
const configuredBatchSize = Number.parseInt(
  process.env.BMF_TEST_BATCH_SIZE ?? "80",
  10,
);
const BATCH_SIZE =
  Number.isInteger(configuredBatchSize) && configuredBatchSize > 0
    ? Math.min(configuredBatchSize, 100)
    : 80;
const configuredConcurrency = Number.parseInt(
  process.env.BMF_TEST_CONCURRENCY ?? "2",
  10,
);
// Each child remains single-worker to preserve the per-process memory bound.
// Defaults of 2 concurrent children and batches of 80 keep the full suite
// under 10 minutes on a typical dev machine (validated against the current suite in ~8 min).
// Each child still runs with a single Vitest worker, so shared
// browser/crypto/IndexedDB shims are isolated per child process. Lower with
// BMF_TEST_CONCURRENCY=1 / BMF_TEST_BATCH_SIZE=40 on constrained machines.
const CONCURRENCY =
  Number.isInteger(configuredConcurrency) && configuredConcurrency > 0
    ? Math.min(configuredConcurrency, 4)
    : 2;
const SUITE_TIME_LIMIT_MS = (() => {
  const parsed = Number.parseInt(
    process.env.BMF_TEST_TIME_LIMIT_MS ?? "600000",
    10,
  );
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 600000;
})();
// Time-budget fallback: once the suite has consumed SHRINK_AT of its budget,
// halve the remaining batch size so both children pick up fresh files sooner
// (shortens the straggler tail without raising total concurrency), warn at
// WARN_AT, and stop scheduling new batches once the budget is exhausted.
const SHRINK_AT = 0.8;
const WARN_AT = 0.9;
const MIN_BATCH_SIZE = 10;
const TEST_FILE_PATTERN = /\.test\.(?:ts|tsx|mjs)$/;

function collectTests(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== "dist") {
        files.push(...collectTests(path));
      }
      continue;
    }
    if (TEST_FILE_PATTERN.test(entry.name)) {
      files.push(relative(ROOT, path));
    }
  }
  return files;
}

function normalizeProjectPath(arg) {
  return arg.replace(/\\/g, "/").replace(/^\.\//, "");
}

function isProjectPathArg(arg) {
  const normalized = normalizeProjectPath(arg);
  return (
    normalized.startsWith("src/") ||
    normalized.startsWith("eslint-rules/") ||
    // Quality-gate script tests (scripts/__tests__/check-*.test.mjs) are
    // first-class unit tests: selectable like any other project path. Accept
    // both the bare dir and a nested path (the src/ prefixes above share the
    // same shape: `src` alone is not a selector).
    normalized === "scripts/__tests__" ||
    normalized.startsWith("scripts/__tests__/")
  );
}

function collectRequestedTests(args) {
  const requested = [];
  for (const arg of args) {
    // Only treat existing project paths as selectors. This avoids mistaking a
    // value belonging to an option such as `--reporter dot` for a file.
    if (!isProjectPathArg(arg)) {
      continue;
    }
    const normalized = normalizeProjectPath(arg);
    const absolute = resolve(ROOT, normalized);
    if (!existsSync(absolute)) {
      continue;
    }
    if (statSync(absolute).isDirectory()) {
      requested.push(...collectTests(absolute));
    } else if (TEST_FILE_PATTERN.test(absolute)) {
      requested.push(relative(ROOT, absolute));
    }
  }
  return [...new Set(requested)].sort();
}

const allTestFiles = [
  ...collectTests(join(ROOT, "src")),
  ...collectTests(join(ROOT, "eslint-rules")),
  // Quality-gate script tests live under scripts/__tests__/ (vitest include
  // glob in vitest.config.ts matches them); collect them here so the bounded
  // suite — not just ad-hoc `npx vitest run scripts/__tests__` — runs them.
  ...collectTests(join(ROOT, "scripts", "__tests__")),
].sort();

if (allTestFiles.length === 0) {
  console.error("[test-bounded] no test files found");
  process.exit(1);
}

const rawArgs = process.argv.slice(2);
const selectorArgs = new Set(
  rawArgs.filter((arg) => {
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
for (let i = 0; i < rawArgs.length; i += 1) {
  const arg = rawArgs[i];
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
const requestedFiles = collectRequestedTests([...selectorArgs]);
const filesToRun = requestedFiles.length > 0 ? requestedFiles : allTestFiles;
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
        stdio: "inherit",
      },
    );

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
