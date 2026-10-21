/**
 * Shared app-flow helpers for the human-like E2E examples.
 *
 * These encode the *actual* BookmarkForge behaviors that the example specs
 * originally assumed away:
 *  - The app does NOT auto-navigate to the bookmark list after a QuickCapture
 *    save; tests must open the Bookmarks tab explicitly.
 *  - QuickCapture has no Escape handler (only the Settings modal does); the
 *    panel is closed with its FAB toggle.
 *  - The capture toast ("Bookmark captured and processed!") can take a few
 *    seconds to appear while local AI (embedding) processing finishes, so
 *    toast waits are generous (15s) instead of a CI-fragile 5s.
 */
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import type { HumanBehavior } from './human-behavior';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

/**
 * Re-establish the unlocked app shell if the vault dialog reappeared.
 *
 * The skip flag from `skipPassword` is in-memory: a page reload (or a
 * renderer crash/recovery under load) brings the SecurityConfirmation
 * dialog back mid-test. Tests that continue interacting must re-skip
 * instead of assuming the shell survived.
 */
export async function ensureUnlocked(page: Page): Promise<void> {
  await expect(
    page
      .getByTestId('settings-button')
      .or(page.getByRole('heading', { name: 'Secure your vault' })),
  ).toBeVisible({ timeout: 15_000 });
  if (await page.getByRole('heading', { name: 'Secure your vault' }).isVisible()) {
    await skipPassword(page);
  }
  await expect(page.getByTestId('settings-button')).toBeVisible({
    timeout: 15_000,
  });
}

/** Minimal human-like interaction surface used by the save helper. */
type HumanLike = Pick<HumanBehavior, 'click' | 'type'>;

/**
 * Save a bookmark through the real QuickCapture UI.
 *
 * The panel is a FAB toggle and STAYS OPEN after a save, so this helper
 * resets it before opening — otherwise the second save in a loop would
 * toggle the panel closed and hang on the next visibility wait.
 */
export async function createBookmarkViaCapture(
  page: Page,
  human: HumanLike,
  url: string,
  title?: string,
): Promise<void> {
  // A renderer crash/reload under load can drop the in-memory skip flag and
  // bring the vault dialog back mid-loop; re-establish the unlocked shell
  // before touching the FAB.
  await ensureUnlocked(page);
  // Fully close any open panel first (waits for the exit animation) so the
  // FAB toggle below starts from a deterministic closed state.
  await closeQuickCapture(page);
  await human.click(page.getByTestId('add-bookmark-button'));
  await human.type(page.getByTestId('quick-capture-input'), url);
  if (title) {
    await human.type(page.getByTestId('bookmark-title-input'), title);
  }
  // The save button is disabled while the previous capture's AI processing
  // is still running (isProcessing) or while the panel is mid-animation;
  // wait for it to become actionable instead of racing a fixed timeout.
  await expect(page.getByTestId('save-bookmark-button')).toBeEnabled({
    timeout: 15_000,
  });
  await human.click(page.getByTestId('save-bookmark-button'));
  await expectCapturedToast(page);
  // The app closes the QuickCapture panel only after the capture's AI
  // processing finishes and the bookmark is inserted, so "panel hidden" is
  // the deterministic processing-complete signal. Without it, a still-visible
  // toast from the previous save makes the next loop iteration advance early
  // and its fill races the disabled (isProcessing) input until the 90s budget.
  await expect(page.getByTestId('quick-capture-input')).toBeHidden({
    timeout: 30_000,
  });
}

/**
 * Raw fail-fast save: click add → panel visible → fill → save → toast.
 * No human simulator — plain Playwright actions with UI assertions, so it
 * is safe inside loops (the FAB-toggle panel is reset before opening) and
 * fast in CI.
 */
export async function saveBookmark(
  page: Page,
  url: string,
  title?: string,
): Promise<void> {
  // A renderer crash/reload under load can drop the in-memory skip flag and
  // bring the vault dialog back mid-loop; re-establish the unlocked shell
  // before touching the FAB.
  await ensureUnlocked(page);
  // Fully close any open panel first (waits for the exit animation) so the
  // FAB toggle below starts from a deterministic closed state.
  await closeQuickCapture(page);
  await page.getByTestId('add-bookmark-button').click({ timeout: 2_000 });
  await expect(page.getByTestId('quick-capture-input')).toBeVisible({
    timeout: 5_000,
  });
  await page.getByTestId('quick-capture-input').fill(url);
  if (title) {
    await page.getByTestId('bookmark-title-input').fill(title);
  }
  // The save button is disabled while the previous capture's AI processing
  // is still running (isProcessing) or while the panel is mid-animation;
  // wait for it to become actionable instead of racing a fixed timeout.
  await expect(page.getByTestId('save-bookmark-button')).toBeEnabled({
    timeout: 15_000,
  });
  await page.getByTestId('save-bookmark-button').click({ timeout: 5_000 });
  await expectCapturedToast(page);
  // The app closes the QuickCapture panel only after the capture's AI
  // processing finishes and the bookmark is inserted, so "panel hidden" is
  // the deterministic processing-complete signal. Without it, a still-visible
  // toast from the previous save makes the next loop iteration advance early
  // and its fill races the disabled (isProcessing) input until the 90s budget.
  await expect(page.getByTestId('quick-capture-input')).toBeHidden({
    timeout: 30_000,
  });
}

/** Fast fill-based variant for stress/performance loops. */
export async function createBookmarkFast(
  page: Page,
  url: string,
  title?: string,
): Promise<void> {
  await saveBookmark(page, url, title);
}

/** Open the Bookmarks tab (sidebar nav) and wait for the list toolbar. */
export async function goToBookmarks(page: Page): Promise<void> {
  await page.locator('[data-tab-id="bookmarks"]').first().click();
  await expect(page.getByTestId('search-input')).toBeVisible({ timeout: 10_000 });
}

/** Close the QuickCapture panel with its FAB toggle (no Escape handler). */
export async function closeQuickCapture(page: Page): Promise<void> {
  // Wait out any closing animation (AnimatePresence keeps the panel in the
  // DOM for ~200ms after a save closes it) so a mid-exit panel is never
  // mistaken for an open one and toggled back open.
  await page.waitForTimeout(300);
  // If the input is already hidden the panel is closed (or closing) —
  // return immediately so we never accidentally toggle it back open.
  const inputVisible = await page
    .getByTestId('quick-capture-input')
    .isVisible()
    .catch(() => false);
  if (!inputVisible) return;
  // Prefer the panel's explicit close control (unique testid, never ambiguous
  // with the FAB, which shares the "Close quick capture" accessible name
  // while open). Fall back to the FAB toggle if the close control is gone.
  const closeButton = page.getByTestId('close-quick-capture-button');
  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.evaluate((button) => (button as HTMLButtonElement).click());
  } else {
    await page
      .getByTestId('add-bookmark-button')
      .evaluate((el) => (el as HTMLButtonElement).click());
  }
  await expect(page.getByTestId('quick-capture-input')).toBeHidden({
    timeout: 5_000,
  });
}

/**
 * Wait for the capture-confirmation toast. Local AI processing (hierarchy
 * suggestion + a 3s embedding race) runs before the insert, so the toast can
 * legitimately take several seconds — 30s matches the core E2E budget.
 */
export async function expectCapturedToast(
  page: Page,
  timeout = 30_000,
): Promise<void> {
  // Two rapid captures (stress loops) can overlap the toast lifetime, leaving
  // two identical "captured" toasts on screen; scope to the first instead of
  // strict-violating on the duplicate. The authoritative completion signal is
  // the panel closing — the app closes QuickCapture only after the insert.
  await expect(
    page.getByText(/bookmark captured|note captured|saved successfully/i).first(),
  ).toBeVisible({ timeout });
}
