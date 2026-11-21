/**
 * Persistence & Data Integrity Round-Trip Tests
 *
 * Deterministic end-to-end flows that prove the real app behavior behind
 * the capture pipeline: save -> list render -> search filtering -> reload
 * persistence -> capture reuse. Every step asserts on actual UI state via
 * the shared app-flow helpers (saveBookmark, goToBookmarks), so no naked
 * waitForTimeout pacing sleeps exist here.
 */

import { test, expect } from '@playwright/test';
import { saveBookmark, goToBookmarks } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Persistence & Data Integrity Round-Trip', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('1. Bookmark round-trip: save renders in the Bookmarks list', async ({ page }) => {
    await saveBookmark(
      page,
      'https://roundtrip.example.com',
      'Roundtrip Fixture Bookmark',
    );

    await goToBookmarks(page);

    // The saved bookmark renders in the list (title-based assertion).
    await expect(page.getByText('Roundtrip Fixture Bookmark')).toBeVisible();
  });

  test('2. Bookmark persists across a full page reload', async ({ page }) => {
    await saveBookmark(
      page,
      'https://persist.example.com',
      'Persist Fixture Bookmark',
    );

    // Full reload: the vault skip flag is in-memory, so the app lands back
    // on SecurityConfirmation — re-skip and re-open the list.
    await page.reload();
    await skipPassword(page);
    await goToBookmarks(page);

    // IndexedDB-backed data survives the reload.
    await expect(page.getByText('Persist Fixture Bookmark')).toBeVisible();
  });

  test('3. Search filtering keeps the match and hides the non-match', async ({ page }) => {
    await saveBookmark(
      page,
      'https://filter-match.example.com',
      'Filter Match Bookmark',
    );
    await saveBookmark(
      page,
      'https://filter-other.example.com',
      'Filter Other Bookmark',
    );

    await goToBookmarks(page);
    await expect(page.getByText('Filter Match Bookmark')).toBeVisible();
    await expect(page.getByText('Filter Other Bookmark')).toBeVisible();

    // The search bar only exists on the Bookmarks tab; the debounce (400ms)
    // is auto-waited by the assertions below.
    await page.getByTestId('search-input').fill('Filter Match');

    await expect(page.getByText('Filter Match Bookmark')).toBeVisible();
    await expect(page.getByText('Filter Other Bookmark')).toBeHidden();
  });

  test('4. QuickCapture is reusable after a save (FAB toggle reset)', async ({ page }) => {
    await saveBookmark(page, 'https://reuse-one.example.com', 'Reuse One');
    await saveBookmark(page, 'https://reuse-two.example.com', 'Reuse Two');

    // The capture panel is fully closed after the second save...
    await expect(page.getByTestId('quick-capture-input')).toBeHidden();

    // ...and the FAB opens it again for a third capture.
    await page.getByTestId('add-bookmark-button').click();
    await expect(page.getByTestId('quick-capture-input')).toBeVisible();
    await page.getByTestId('quick-capture-input').fill('https://reuse-three.example.com');

    // The save button becomes actionable once the previous AI processing
    // finished (the helper already waited for it before closing the panel).
    await expect(page.getByTestId('save-bookmark-button')).toBeEnabled();
  });
});
