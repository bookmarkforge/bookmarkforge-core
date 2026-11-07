/**
 * scripts/schedule-batches.mjs
 *
 * The failure-handling half of the bounded runner's scheduler
 * (scripts/test-bounded.mjs), extracted so it can be reasoned about and tested
 * without spawning the runner — the runner's own test suite runs inside it.
 *
 * P-15 (docs/PENDIENTES.md, measured 2026-10-13; reproduced 2026-11-01 with
 * 103 of 187 files skipped): the scheduler used to stop scheduling at the first
 * red batch (`while (firstFailure === null)`), so one failing file silently
 * dropped the whole tail of the profile. An unrun file read as a pass, which is
 * how locale corruption and other regressions reached main while every gate
 * stayed green. The budget, not a failure, is the only legitimate reason to
 * leave files unrun — and even then the tail is reported as FAIL.
 */

/**
 * The collector the worker loop consults before taking the next batch.
 *
 * P-15's abort was `while (firstFailure === null)`: a red batch flipped the
 * flag and every worker returned, so one failing file silently dropped the
 * whole tail of the profile. The loop now drains the queue whatever the exit
 * status was — each worker keeps taking batches while work remains, and the
 * time budget is the only thing allowed to stop it.
 */
export function createFailureCollector() {
  const failures = [];
  let firstFailure = null;
  return {
    record(result) {
      failures.push(result);
      if (firstFailure === null) {firstFailure = result;}
    },
    get first() {
      return firstFailure;
    },
    get all() {
      return failures;
    },
  };
}

/**
 * Whether the worker takes another batch.
 *
 * Returns false only when the queue is drained, or when the time budget is
 * spent. A red batch never stops it: the loop drains the queue whatever the
 * exit status was, because a failing batch costs at most that batch of
 * retries — never the whole tail. That was P-15: the old
 * `while (firstFailure === null)` let one red file hide 103 of 187 files.
 * The tail left unrun by an exhausted budget is reported as FAIL below, never
 * as a pass.
 */
export function continueAfterFailure({ remaining = 0, budgetExhausted = false } = {}) {
  if (remaining <= 0) {return false;}
  return !budgetExhausted;
}

/** True when a failure is the "time budget exhausted" tail, not a real batch. */
export function isUnrunFailure(failure) {
  return Boolean(failure?.error?.message?.includes("not run"));
}

/**
 * The closing report. Every shape names the executed count, so an unrun file
 * can never be mistaken for a passing one.
 */
export function summarise({ failures, batches, executed, total, elapsedMs }) {
  if (failures.length === 0) {
    return `[test-bounded] all ${total} test files passed in ${elapsedMs}ms`;
  }
  const failedBatches = failures.filter((f) => !isUnrunFailure(f));
  return (
    `[test-bounded] ${failures.length} failure(s) across ${batches} batch(es) ` +
    `(${failedBatches.length} failed batch(es)); ` +
    `${executed} of ${total} test file(s) executed in ${elapsedMs}ms`
  );
}
