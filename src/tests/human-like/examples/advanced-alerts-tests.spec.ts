/**
 * Advanced Alerts Tests
 *
 * REWRITTEN 2026-09-24 (debt payment, first advanced-* file out of the
 * vacuous baseline). The original 10 tests asserted only inside
 * `if (await loc.isVisible({timeout: 5000}).catch(() => false))` guards aimed
 * at `data-testid="alert"` — an attribute no production component renders —
 * so they passed exactly when the alert system was absent. 74.3 even asserted
 * the close button stayed visible AFTER clicking it.
 *
 * The real alert surface of this app is sonner (verified against
 * node_modules/sonner/dist and src/components/app/MainApp.tsx):
 *   - <Toaster position="bottom-right"> renders section[aria-live="polite"]
 *     with data-sonner-toaster;
 *   - each toast is [data-sonner-toast] carrying data-type
 *     (success|error|info|warning);
 *   - the per-toast close button only renders when the `closeButton` prop is
 *     set, which this app does NOT do — dismissal happens by auto-timeout
 *     (default 4s) or swipe, never by a rendered button.
 *
 * The five tests below assert that contract unconditionally on state the test
 * itself drives (a real capture). A second system toast ("No AI provider is
 * configured", data-type="warning") can share the layer, so every locator is
 * scoped by the text the capture itself produces — never a bare
 * [data-sonner-toast]. All classified as `real` by the ratchet
 * (scripts/check-vacuous-tests.mjs).
 */

import { test, expect, type Page } from '@playwright/test';
import type { HumanBehavior } from '../utils/human-behavior';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

/** The success toast text the app itself renders (QuickCapture onSuccess). */
const CAPTURED_RE = /bookmark captured|note captured|saved successfully/i;

test.describe('Advanced Alerts Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  /**
   * Drives one real capture through the QuickCapture panel and returns once
   * the success toast is on screen. Every test asserts on this state.
   */
  async function captureAndAwaitToast(
    page: Page,
    human: HumanBehavior,
  ): Promise<import('@playwright/test').Locator> {
    await human.click(page.getByTestId('add-bookmark-button'));
    await expect(page.getByTestId('quick-capture-input')).toBeVisible();
    await human.type(
      page.getByTestId('quick-capture-input'),
      'https://alerts.example.com',
    );
    await expect(page.getByTestId('save-bookmark-button')).toBeEnabled({
      timeout: 15_000,
    });
    await human.click(page.getByTestId('save-bookmark-button'));
    // Scope to the capture toast itself: a system warning toast ("No AI
    // provider is configured") may join the layer and a bare
    // [data-sonner-toast] would strict-violate.
    const toast = page
      .locator('[data-sonner-toast]')
      .filter({ hasText: CAPTURED_RE })
      .first();
    await expect(toast).toBeVisible({ timeout: 30_000 });
    return toast;
  }

  test('74.1 Alert displays: capture success renders a sonner toast', async ({
    page,
  }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    const toast = await captureAndAwaitToast(page, human);

    // The toast exists in the sonner layer (not a fabricated data-testid).
    await expect(toast).toBeVisible();
  });

  test('74.2 Alert variants: success toast carries data-type="success"', async ({
    page,
  }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    const toast = await captureAndAwaitToast(page, human);

    // sonner types every toast; the capture success path must surface as
    // success — a variant regression (e.g. everything rendering as info)
    // fails here.
    await expect(toast).toHaveAttribute('data-type', 'success');
  });

  test('74.3 Alert dismissal: the toast auto-dismisses (lifecycle)', async ({
    page,
  }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    const toast = await captureAndAwaitToast(page, human);

    // Real dismissal contract: the app does not enable sonner's closeButton,
    // so the toast leaves by auto-timeout. The element the test asserted
    // visible must become hidden — the inverse of what the original 74.3
    // (close button still visible after clicking it) claimed.
    await expect(toast).toBeHidden({ timeout: 15_000 });
  });

  test('74.4 Alert accessibility: toast lives in a polite live region', async ({
    page,
  }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    const toast = await captureAndAwaitToast(page, human);

    // Screen-reader contract: sonner mounts a section[aria-live="polite"] and
    // the toast text must be reachable inside it.
    const liveRegion = page.locator('section[aria-live="polite"]');
    await expect(liveRegion).toBeVisible();
    await expect(liveRegion.filter({ has: toast })).toBeVisible();
  });

  test('74.5 Alert dismissal contract: no per-toast close button is rendered', async ({
    page,
  }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    const toast = await captureAndAwaitToast(page, human);

    // Pins the Toaster configuration: without the closeButton prop sonner
    // renders no [data-close-button] inside any toast. If someone enables it
    // deliberately, this test fails and forces the dismissal contract
    // (auto-timeout only) to be revisited instead of drifting silently.
    await expect(toast.locator('[data-close-button]')).toHaveCount(0);
  });
});
