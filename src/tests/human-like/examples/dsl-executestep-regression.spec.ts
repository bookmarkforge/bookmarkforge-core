/* eslint-disable @typescript-eslint/ban-ts-comment -- deliberate strict-check exemption (see note below) */
// @ts-nocheck
// Human-like harness — self-contained test infrastructure with intentionally
// loose typing (heavy `as any`), so noUncheckedIndexedAccess `!` churn adds
// no assertion value here. Excluded from strict checking; mirrors the
// src/tests/db/encryption.test.ts precedent (tsconfig.json "exclude").
import { test, expect } from '@playwright/test';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';
import { createScenario } from '../core/natural-language-dsl';

test.describe('DSL result recording (regression)', () => {
  test('direct executeStep with a failing verify records it (no false-green)', async ({ page }) => {
    await skipPassword(page);
    // The fail-fast throw is deterministic (no title to assert), so a single
    // attempt is enough — the default maxRetries=2 would only add a 1s retry
    // wait without extra coverage.
    const scenario = createScenario(page, { maxRetries: 1 });

    // This verify targets the bookmark list but no title was captured in a
    // prior 'Enter "X" in the title field' step, so the DSL must fail fast.
    // It is called DIRECTLY (not through execute()) to pin the recording
    // contract: every path of executeStep must register in this.results.
    const result = await scenario.executeStep(
      'Verify the bookmark appears in the list',
    );

    expect(result.success).toBe(false);
    // Regression guard: allPassed() used to return true on an empty results
    // array ([].every() === true) when steps ran through executeStep only.
    expect(scenario.allPassed()).toBe(false);
    expect(scenario.getResults()).toHaveLength(1);
    expect(scenario.getSummary().failed).toBe(1);
    expect(scenario.getSummary().passed).toBe(0);
  });

  test('execute() still records successes after the recording refactor', async ({ page }) => {
    await skipPassword(page);
    const scenario = createScenario(page);

    // Fast, deterministic in-app navigation asserted with real UI state.
    const results = await scenario.execute(['Open the settings']);

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(true);
    expect(scenario.allPassed()).toBe(true);
    expect(scenario.getSummary().passed).toBe(1);
    expect(scenario.getSummary().failed).toBe(0);
  });
});
