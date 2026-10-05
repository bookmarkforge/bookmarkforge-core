// Fast local test profile: smoke + critical areas only. The file list lives
// in scripts/test-profiles.mjs (FAST_SELECTORS) — a single owner shared with
// the bounded runner, which derives the slow profile as its complement — and
// the batched run delegates to `scripts/test-bounded.mjs --profile fast` so
// it keeps the same batching, slow-file-first scheduling, per-process memory
// bound, time-budget guard and test-timing enforcement as `npm test`.
// Intended for local dev loops — it must stay well under a couple of minutes.
//
// `--watch` runs the same profile through vitest's native watch mode (single
// process, no batching): vitest walks its module graph and re-runs only the
// critical-area tests affected by the file you save.
import { join } from "node:path";
import { spawn } from "node:child_process";
import { FAST_SELECTORS } from "./test-profiles.mjs";
import { runPreflight } from "./drift-preflight.mjs";

const ROOT = process.cwd();
const WATCH = process.argv.slice(2).includes("--watch");

// Drift preflight: advisory warning before tests start (see drift-preflight.mjs;
// in watch mode there is no bounded-runner hook to do it for us).
runPreflight({ argv: [] });

const env = {
  ...process.env,
  // Keep the vitest transform cache isolated from `vite build` cleanup in
  // watch mode (see the cacheDir note in vitest.config.ts). The bounded
  // runner applies this itself for batched runs.
  BMF_TEST_CACHE_DIR:
    process.env.BMF_TEST_CACHE_DIR ?? "node_modules/.vite-test-bounded",
};

const child = WATCH
  ? spawn(
      process.execPath,
      [
        join(ROOT, "node_modules", "vitest", "vitest.mjs"),
        ...FAST_SELECTORS,
        "--watch",
      ],
      { cwd: ROOT, env, stdio: "inherit" },
    )
  : // Batching defaults (batch 28, cores-aware concurrency) live in
    // PROFILE_DEFAULTS.fast inside test-profiles.mjs; env overrides
    // (BMF_TEST_CONCURRENCY / BMF_TEST_BATCH_SIZE) still win there.
    spawn(
      process.execPath,
      ["scripts/test-bounded.mjs", "--profile", "fast"],
      { cwd: ROOT, env, stdio: "inherit" },
    );
child.once("error", (error) => {
  console.error(
    `[test-fast] failed to start ${WATCH ? "vitest watch" : "the bounded runner"}:`,
    error,
  );
  process.exit(1);
});
child.once("exit", (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});