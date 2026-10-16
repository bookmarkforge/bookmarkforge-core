/**
 * Advanced Human-Actions Tests
 *
 * Coverage for human dismissal/cancellation actions that no existing example
 * spec drives. Verified gaps (grep across src/tests/human-like/examples on
 * 2026-09-24):
 *
 *  11. QuickCapture cancel flow: the panel is opened, text is typed, and the
 *      capture is DISMISSED with its own close control instead of saved.
 *      Existing specs only exercise the save path (saveBookmark) or the FAB
 *      toggle in isolation; close-quick-capture-button is never clicked.
 *  12. Settings modal Escape-to-close (WCAG 2.1.2 No Keyboard Trap — the
 *      handler lives in src/components/Settings.tsx). Only touched
 *      incidentally by language-switching-tests, never asserted.
 *  13. Settings modal Close-button path, scoped to the dialog.
 *
 * Every selector is verified against production source and every assertion is
 * unconditional on state the test itself drives, so the ratchet
 * (scripts/check-vacuous-tests.mjs) classifies these tests as `real` — no new
 * vacuous debt is added to the baseline.
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Advanced human actions', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('11. QuickCapture: type a URL and cancel the capture without saving', async ({
    page,
  }) => {
    const human = createHumanBehavior(page, ciBasicOptions);

    // Open the capture panel through its FAB toggle.
    await human.click(page.getByTestId('add-bookmark-button'));
    await expect(page.getByTestId('quick-capture-input')).toBeVisible();

    // Type like a user (keystroke pacing through the basic simulator).
    await human.type(
      page.getByTestId('quick-capture-input'),
      'https://cancel.example.com',
    );

    // Dismiss with the panel's explicit close control (never used by the
    // other example specs).
    await human.click(page.getByTestId('close-quick-capture-button'));

    // The panel is gone and the app shell is intact — no capture happened.
    await expect(page.getByTestId('quick-capture-input')).toBeHidden();
    await expect(page.getByTestId('add-bookmark-button')).toBeVisible();
  });

  test('12. Settings: Escape closes the modal (no keyboard trap)', async ({
    page,
  }) => {
    const human = createHumanBehavior(page, ciBasicOptions);

    await human.click(page.getByTestId('settings-button'));

    const settingsDialog = page.locator('[aria-labelledby="settings-dialog-title"]');
    await expect(settingsDialog).toBeVisible();

    // The Escape handler is window-level; a plain key press must close it.
    await human.pressKey('Escape');
    await expect(settingsDialog).toBeHidden();
  });

  test('13. Settings: the dialog-scoped Close button closes the modal', async ({
    page,
  }) => {
    const human = createHumanBehavior(page, ciBasicOptions);

    await human.click(page.getByTestId('settings-button'));

    const settingsDialog = page.locator('[aria-labelledby="settings-dialog-title"]');
    await expect(settingsDialog).toBeVisible();

    // The dialog hosts two Close controls (header X with aria-label, footer
    // text CTA); the aria-label attribute disambiguates deterministically.
    await human.click(
      settingsDialog.locator('button[aria-label="Close"]'),
    );
    await expect(settingsDialog).toBeHidden();
    await expect(page.getByTestId('settings-button')).toBeVisible();
  });
});
