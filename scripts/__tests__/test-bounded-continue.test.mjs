/**
 * scripts/__tests__/test-bounded-continue.test.mjs
 *
 * P-15 (docs/PENDIENTES.md, measured 2026-10-13; reproduced 2026-11-01 with
 * 103 of 187 files skipped): the runner's worker loop was
 * `while (firstFailure === null)`, so one red batch cancelled the whole tail of
 * the profile and an unrun file read as a pass — which is how locale corruption
 * and other regressions reached main while every gate stayed green.
 *
 * The scheduler's failure handling is now a pure module
 * (scripts/schedule-batches.mjs), so this suite exercises the real rule instead
 * of spawning the runner inside itself. The end-to-end shape was verified by
 * hand against a selector-only run on 2026-11-01:
 *
 *   $ BMF_TEST_TIMING=off BMF_TEST_BATCH_SIZE=1 node scripts/test-bounded.mjs \
 *       src/tests/fixtures/bounded-runner/a-red.test.mjs \
 *       src/tests/fixtures/bounded-runner/b-green.test.mjs
 *   [test-bounded] batch 1 failed with status 1
 *   [test-bounded] batch 2 failed with status 1   <- the green file STILL ran
 *   [test-bounded] 2 failure(s) across 2 batch(es) (2 failed batch(es));
 *                     2 of 2 test file(s) executed in 496ms
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  continueAfterFailure,
  createFailureCollector,
  isUnrunFailure,
  summarise,
} from "../schedule-batches.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RUNNER_SRC = readFileSync(join(ROOT, "scripts", "test-bounded.mjs"), "utf8");
const MODULE_SRC = readFileSync(join(ROOT, "scripts", "schedule-batches.mjs"), "utf8");

describe("schedule-batches — a red batch must not hide the rest of the profile", () => {
  it("a red batch never stops the worker, however many failures pile up", () => {
    const collector = createFailureCollector();
    let remaining = 50;
    const batches = [];
    while (continueAfterFailure({ remaining, budgetExhausted: false })) {
      // Each red batch costs at most that batch of retries.
      collector.record({ status: 1, number: batches.length + 1, error: null });
      batches.push(batches.length + 1);
      remaining -= 1;
    }
    // The FIRST failure is surfaced for the exit code…
    expect(collector.first).not.toBeNull();
    expect(collector.first.number).toBe(1);
    // …and the queue drained completely: 50 of 50, not 1 of 50.
    expect(batches).toHaveLength(50);
    expect(collector.all).toHaveLength(50);
  });

  it("only the time budget stops the queue — and only with files still unrun", () => {
    expect(continueAfterFailure({ remaining: 0, budgetExhausted: false })).toBe(false);
    expect(continueAfterFailure({ remaining: 12, budgetExhausted: false })).toBe(true);
    expect(continueAfterFailure({ remaining: 12, budgetExhausted: true })).toBe(false);
  });

  it("separates a not-run tail from a real failed batch", () => {
    const notRun = new Error("2 test file(s) not run: time budget exceeded");
    expect(isUnrunFailure({ status: 1, error: notRun })).toBe(true);
    expect(isUnrunFailure({ status: 1, error: new Error("test failed") })).toBe(false);
    expect(isUnrunFailure({ status: 1, error: null })).toBe(false);
  });

  it("reports the executed count, so an unrun file never reads as a pass", () => {
    expect(
      summarise({ failures: [], batches: 7, executed: 3, total: 3, elapsedMs: 10 }),
    ).toMatch(/all 3 test files passed/);

    const red = summarise({
      failures: [{ status: 1, error: null }],
      batches: 7,
      executed: 3,
      total: 3,
      elapsedMs: 10,
    });
    expect(red).toMatch(/1 failure\(s\) across 7 batch\(es\)/);
    expect(red).toMatch(/3 of 3 test file\(s\) executed/);

    const tail = summarise({
      failures: [{ status: 1, error: new Error("2 test file(s) not run: x") }],
      batches: 7,
      executed: 1,
      total: 3,
      elapsedMs: 10,
    });
    expect(tail).toMatch(/1 failure\(s\)/);
    expect(tail).toMatch(/1 of 3 test file\(s\) executed/);
  });

  it("wires the rule into the runner: no firstFailure stop, every file counts", () => {
    // The abort that hid 103 files was `while (firstFailure === null)`.
    expect(RUNNER_SRC).not.toMatch(/while\s*\(\s*firstFailure\s*===\s*null\s*\)/);
    // A red batch is recorded without cancelling the queue.
    expect(RUNNER_SRC).toContain("recordFailure");
    expect(RUNNER_SRC).toMatch(/for\s*\(\s*;\s*;\s*\)/);
    // The unrun tail is a first-class failure, not a silent pass.
    expect(RUNNER_SRC).toMatch(/test file\(s\) were not run \(time budget/);
    // The report itself is owned by schedule-batches.mjs, which this suite
    // exercises directly — so the count below is the real one, not a copy.
    expect(RUNNER_SRC).toContain("summarise(");
    expect(MODULE_SRC).toMatch(/test file\(s\) executed in/);
  });
});
