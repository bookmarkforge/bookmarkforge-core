# Test hygiene cleanup (last 3 commits) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the dead test scaffolding and strengthen the weakened assertions that commits `75cc0c6`, `295fdf6` and `03df788` left behind, so every affected test proves what its name claims.

**Architecture:** Test-only changes plus one metadata change in the test-timing gate script, and a component fix only if Task 4's measurement demands one. Each task's proof is a measurement or repeat-run (a removed timeout must not hide a flake, and its cost is attributed before the fix) or a mutation of the weakened check (a strengthened assertion must fail on the failure it is meant to catch).

**Tech Stack:** Vitest 4, `@testing-library/user-event` 14, Node 26, bounded ESLint (`scripts/tooling/lint-bounded.mjs`), TypeScript (`tsc`).

**Spec:** No separate spec file. The source of truth is this thread's four-dimension audit of `75cc0c6` / `295fdf6` / `03df788` on `release/v1.0.0`; its findings are reproduced verbatim under Review Focus and in each task.

## Global Constraints

- Repo `bookmarkforge-2026`, branch `release/v1.0.0`. Working tree currently also carries two already-applied fixes (see "Already completed").
- `.ts` / `.tsx` files are CRLF — preserve line endings on every edit.
- Do not weaken any gate, add a type/lint suppression, or skip a test to make something pass.
- No new dependencies.
- Before each commit: `npm run typecheck` (it includes test files) and the affected test file must be green.
- Before finishing the plan: `npm run test:fast` green and `npx eslint <changed files>` clean.
- Never reintroduce a timeout override to make a test pass; a test that needs one is a bug in the test or in the component it exercises.

## Review Focus

- A timeout override can only be removed on evidence, not by deleting it: attribute the cost to the driver or the component first (Task 4), then prove each removal with 10 repeat runs, and if it fails, fix the underlying wait — never restore the override.
- A strengthened CLI assertion must hold on BOTH success paths of `check-english-only.mjs`: the cached line (`[check-english-only] ok (cached):` L546) and the fresh line (`[check-english-only] ok:` L563).
- Deleting a mocked store method must not delete the only proof that `lock()` runs: `mockLock` keeps that assertion, `setForceSetup` does not.
- Removing the write-only `thresholdMs` baseline field must not change the enforced bar: the runner supplies it from `PROFILE_DEFAULTS` (fast 5000 / slow 10000), never from the file.
- Reverting or keeping a timing re-pin must be decided by a fresh measurement, not by the commit message, or a real slowdown stays hidden.

## Context

- The audit that spawned this plan is this session's four-dimension review; the three commits it covered are on `release/v1.0.0`.
- `check:` / lint / typecheck gates were all verified green **before** this plan, so every red result below is caused by a step in this plan unless stated otherwise.
- `check-test-timing.mjs` reads `opts.thresholdMs` (from `optsFromEnv` / `PROFILE_DEFAULTS`), never `baseline.thresholdMs`; `test-bounded.mjs` wires the profile value in. The field in the JSON is therefore write-only.

## File Structure

- Modify: `src/tests/hooks/AutoLockManager.test.tsx` — drop the unused `setForceSetup` mock surface.
- Modify: `src/tests/scripts/check-english-only.test.ts:94` — tighten the success assertion.
- Modify: `src/tests/components/GraphView.test.tsx:541-545` — remove the masked `waitFor` timeout.
- Investigate (modify only if the evidence points there): `src/components/bookmarks/BookmarkToolbar.tsx` — the three O(n) `useMemo` scans are the only component-side cost behind the 10 s override.
- Modify: `src/tests/components/bookmarks/BookmarkToolbar.test.tsx:190` — remove the masked per-test timeout.
- Modify: `scripts/test-timing-baseline.json` and `scripts/check-test-timing.mjs` — drop the write-only `thresholdMs` field and re-measure the repinned outlier.

## Tasks

### Task 1: Remove the dead store mock in AutoLockManager tests

**Files:**
- Modify: `src/tests/hooks/AutoLockManager.test.tsx` (lines 4, 11, 56)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: nothing other tasks rely on (test-only). The `useSecurityStore` mock keeps `isLocked` and `lock`.

- [ ] **Step 1: Confirm the mock is never asserted**

Run: `git grep -n "mockSetForceSetup\|setForceSetup" -- src/tests/hooks/AutoLockManager.test.tsx`
Expected: exactly three lines (declaration L4, store key L11, clear L56) and no `expect(...)`.

- [ ] **Step 2: Delete the three lines**

Remove `const mockSetForceSetup = vi.fn();`, the `setForceSetup: mockSetForceSetup,` entry inside the `useSecurityStore` mock, and `mockSetForceSetup.mockClear();`.

- [ ] **Step 3: Run the test file**

Run: `npx vitest run src/tests/hooks/AutoLockManager.test.tsx`
Expected: `18 passed`. (If any assertion had depended on the deleted mock, it fails here — that is the safety net.)

- [ ] **Step 4: Commit**

```bash
git add src/tests/hooks/AutoLockManager.test.tsx
git commit -m "test(AutoLockManager): remove unused setForceSetup store mock"
```

### Task 2: Tighten the check-english-only success assertion

**Files:**
- Modify: `src/tests/scripts/check-english-only.test.ts:94`

**Interfaces:**
- Consumes: the CLI's success strings in `scripts/check-english-only.mjs` (L546 cached / L563 fresh).
- Produces: nothing other tasks rely on.

- [ ] **Step 1: Prove the current assertion is weak (mutation)**

Edit `scripts/check-english-only.mjs:563` so the fresh-success message reads `[check-english-only] broken:` (the word "broken" contains "ok"). Run: `npx vitest run src/tests/scripts/check-english-only.test.ts -t "exits 0 against the real repo"`.
Expected: PASSES — confirming `toContain("ok")` accepts a broken message. Revert the script edit immediately.

- [ ] **Step 2: Strengthen the assertion**

Change line 94 to:

```ts
expect(stdout).toContain("[check-english-only] ok");
```

- [ ] **Step 3: Prove the strengthened assertion catches the mutation**

Re-apply the Step 1 edit to the script and run the same command.
Expected: FAILS — the exact string is absent. Revert the script edit.

- [ ] **Step 4: Restore and run clean**

Run: `npx vitest run src/tests/scripts/check-english-only.test.ts`
Expected: `8 passed` (the cached and fresh success strings both begin with `[check-english-only] ok`).

- [ ] **Step 5: Commit**

```bash
git add src/tests/scripts/check-english-only.test.ts
git commit -m "test(check-english-only): assert the exact OK marker, not any 'ok' substring"
```

### Task 3: Remove the masked waitFor timeout in GraphView

**Files:**
- Modify: `src/tests/components/GraphView.test.tsx:541-545` (test "removes loading spinner after data loads")

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: nothing other tasks rely on.

- [ ] **Step 1: Establish the with-override baseline**

Run: `for i in $(seq 1 10); do npx vitest run src/tests/components/GraphView.test.tsx -t "removes loading spinner" || break; done`
Expected: 10/10 pass with the `{ timeout: 3000 }` override still present.

- [ ] **Step 2: Remove the override**

Change the call back to a plain `await waitFor(() => { expect(document.querySelector(".animate-spin")).toBeFalsy(); });` (delete the `{ timeout: 3000 },` argument).

- [ ] **Step 3: Repeat-run without the override**

Run the Step 1 command again.
Expected: 10/10 pass. If any run fails, the override was masking a real race: await the data-load promise the spinner depends on inside the test and do NOT restore the override.

- [ ] **Step 4: Run the whole file**

Run: `npx vitest run src/tests/components/GraphView.test.tsx`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/tests/components/GraphView.test.tsx
git commit -m "test(GraphView): drop the masked waitFor timeout"
```

### Task 4: Diagnose the BookmarkToolbar 10 s override at the component layer

**Files:**
- Investigate: `src/components/bookmarks/BookmarkToolbar.tsx` (the three `React.useMemo` scans at L78-88, the only O(n) work in the component)
- Modify only if the evidence points there: `src/components/bookmarks/BookmarkToolbar.tsx`
- Test: `src/tests/components/bookmarks/BookmarkToolbar.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: a recorded decision — component fix, test-driver fix, or "override unjustified" — that Task 5 consumes.

Evidence to confirm, not assume: this test already runs in ~210-250 ms (213 ms inside the file, 249 ms in isolation), the component has NO `useEffect` and NO timers, and `motion/react` is fully mocked by `src/tests/mocks/motion.ts`. The 10000 ms override is not explained by the component's cost yet, so this task must locate the time before changing anything, and must not invent a component change its own measurement does not support.

- [ ] **Step 1: Measure in isolation**

Run: `npx vitest run src/tests/components/bookmarks/BookmarkToolbar.test.tsx -t "enables actions when there are unprocessed bookmarks" --reporter=verbose`
Expected: a per-test time near 210-250 ms. Record the number.

- [ ] **Step 2: Measure inside the profile it runs in**

Run: `npm run test:fast`
Expected: this file's per-test lines stay in the same range and no test in the file approaches 5000 ms. Record the worst-case number.

- [ ] **Step 3: Attribute the cost to the driver versus the component**

In a throwaway copy of the test (do not commit it), time each click with `performance.now()` deltas, once with the bare `userEvent.click` API and once with `const user = userEvent.setup({ delay: null })`.
Expected: both total well under 100 ms. If the bare API dominates (seconds), the cause is `userEvent`'s per-call setup, not the component — Task 5 takes the driver path and the component stays untouched.

- [ ] **Step 4: Stress the component's only O(n) work**

`hasMissingEmbeddings` / `hasMissingSummaries` / `hasMissingContents` (`BookmarkToolbar.tsx:78-88`) are the component's only non-trivial computation: three `bookmarks.some(...)` scans, re-run whenever the parent hands it a new array identity. In a throwaway test, render `<BookmarkToolbar>` with `bookmarks` of 1, 1 000 and 20 000 items, click "Embeddings", and record render+click time for each.
- If the 20 000-item case blocks for seconds, the component is the cause: stop re-scanning on every parent render — hoist the scan to the parent and pass `hasMissingEmbeddings` / `hasMissingSummaries` / `hasMissingContents` (or a single `unprocessedCount`) instead of re-deriving from `bookmarks`. Add a pinning test (large `bookmarks` array, click settles under the default timeout) and re-run Steps 1-2.
- If even 20 000 items stay fast, the component is exonerated — do NOT invent a change.

- [ ] **Step 5: Record the decision**

Choose Task 5's path (component fix, driver fix, or no override needed) and turn the Step 1-4 numbers into the justification. If the component is exonerated, the `Modify` line above becomes a no-op.

- [ ] **Step 6: Commit (only on a component fix)**

If Step 4 produced a component fix plus its pinning test:

```bash
git add src/components/bookmarks/BookmarkToolbar.tsx src/tests/components/bookmarks/BookmarkToolbar.test.tsx
git commit -m "perf(BookmarkToolbar): hoist the unprocessed scans so a large list never re-derives on render"
```

If the component is exonerated, this task produces no commit; its measured numbers travel in Task 5's commit message.

### Task 5: Remove the masked per-test timeout in BookmarkToolbar

**Files:**
- Modify: `src/tests/components/bookmarks/BookmarkToolbar.test.tsx:190` (test "enables actions when there are unprocessed bookmarks")

**Interfaces:**
- Consumes: Task 4's decision and recorded measurements (component fix, driver fix, or no override needed).
- Produces: nothing other tasks rely on.

- [ ] **Step 1: Confirm Task 4's measurement**

Run: `npx vitest run src/tests/components/bookmarks/BookmarkToolbar.test.tsx -t "enables actions when there are unprocessed bookmarks" --reporter=verbose`
Expected: passes in ~210-250 ms — far under the 5000 ms default, which is why the override is removed rather than replaced.

- [ ] **Step 2: Fix the driver and drop the override**

Replace the three bare `await userEvent.click(getByText(...))` calls with one shared instance created at the top of the test body (`const user = userEvent.setup({ delay: null });`) driven by `await user.click(...)`, and drop the trailing `, 10000` so the test ends with `});`.

- [ ] **Step 3: Repeat-run without the override**

Run: `for i in $(seq 1 10); do npx vitest run src/tests/components/bookmarks/BookmarkToolbar.test.tsx -t "enables actions when there are unprocessed bookmarks" || break; done`
Expected: 10/10 pass, each comfortably under the 5000 ms default. If any run exceeds 5000 ms, apply Task 4's component path; never restore the override.

- [ ] **Step 4: Run the whole file**

Run: `npx vitest run src/tests/components/bookmarks/BookmarkToolbar.test.tsx`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/tests/components/bookmarks/BookmarkToolbar.test.tsx
git commit -m "test(BookmarkToolbar): drive user events from one instance, drop the 10s override"
```

### Task 6: Make the test-timing baseline honest

**Files:**
- Modify: `scripts/test-timing-baseline.json`
- Modify: `scripts/check-test-timing.mjs` (the update-mode return object, ~L102)

**Interfaces:**
- Consumes: `evaluateTimings(durations, baseline, mode, opts)` where the enforced bar is `opts.thresholdMs`.
- Produces: a baseline document without a `thresholdMs` field. `optsFromEnv` / `PROFILE_DEFAULTS` remain the only sources of the bar.

- [ ] **Step 1: Re-measure the repinned outlier**

Run: `npx vitest run scripts/__tests__/build-ci-secret-scan.test.mjs` and read its reported ms. If ≤ 48347, keep `48347` (the +43% re-pin was a true measurement). If it lands near 33751, set the entry back to the measured value.

- [ ] **Step 2: Drop the write-only field**

Delete `thresholdMs,` from the object returned in update mode in `scripts/check-test-timing.mjs`, and delete `"thresholdMs": 10000,` from `scripts/test-timing-baseline.json`.

- [ ] **Step 3: Run the script's unit tests**

Run: `npx vitest run scripts/__tests__/check-test-timing.test.mjs`
Expected: all pass (the fixture at L30 may keep its extra field; it is input, not the persisted document).

- [ ] **Step 4: Run the guard end to end**

Run: `npm run test:fast`
Expected: `[test-timing] OK — ... within budgets (slow-file threshold 5000ms, regression budget 2x)` and 170 files pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/test-timing-baseline.json scripts/check-test-timing.mjs
git commit -m "test-timing: drop the unread thresholdMs baseline field, re-verify the repinned outlier"
```

## Already completed (do not redo)

- `src/tests/services/WebRTCSyncService.test.ts` — the broken `$gte` mock filter is removed and the outbound-sync tests assert the payload actually crosses the wire (verified by mutation: with no rows returned, both tests fail).
- `src/components/app/lazyComponents.ts` + `src/tests/components/app/lazyComponents.test.ts` — the unused `ReloadPrompt` lazy export is gone, the dead chunk is no longer emitted, and the barrel test derives its export names from the barrel instead of a duplicated hardcoded list.

## Out of scope (decided, with reason)

- The `cloudSync.test.ts` `driveCalls` filter added by `75cc0c6` matches the file's pre-existing convention (`cloudSync.test.ts:1445`), so it is not a regression — leave it.
- The `Header.test.tsx` `virtual:pwa-register/react` mock is required by the component; it is not dead code.
- The `75cc0c6` message claim "Regenerated landing pages (31 → 33)" is inaccurate (the pages landed in `d86dff9`), but it is a message, not code — no change here.
- Re-exporting these fixes to `bookmarkforge-core` is a separate, deliberate `npm run export-public-repo` step.
