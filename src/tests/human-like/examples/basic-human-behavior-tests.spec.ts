/**
 * Basic HumanBehavior E2E Example
 *
 * Coverage parity for the BASIC simulator class: the advanced class has its
 * own example spec (advanced-human-tests.spec.ts), so this spec exercises
 * the basic HumanBehavior (utils/human-behavior.ts) against the real
 * BookmarkForge app with ciBasicOptions (config.ts's ciBehavior profile:
 * baseDelay 30, mouseSpeed fast, no natural scrolling/mistakes), keeping the
 * suite inside the 90s per-test CI budget.
 *
 * The flow mirrors bookmark-app-tests.spec.ts but drives every interaction
 * through the basic simulator's human click/type, asserting on real UI
 * state (capture toast, Bookmarks tab, search results) instead of naked
 * sleeps.
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import {
  goToBookmarks,
  createBookmarkViaCapture,
  expectCapturedToast,
} from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Basic HumanBehavior — bookmark save flow', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to app and skip password setup
    await skipPassword(page);
  });

  test('saves a bookmark via the basic simulator and shows it in the list', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);

    // The whole capture is driven by the BASIC simulator (human click/type
    // with natural delays); the helper resets the FAB-toggle panel first.
    await createBookmarkViaCapture(
      page,
      human,
      'https://basic-human.example.com',
      'Basic Human Bookmark',
    );

    // Save confirmation toast (generous budget: local AI races the insert)
    await expectCapturedToast(page);

    // The app does NOT auto-navigate after a save — open the Bookmarks tab.
    await goToBookmarks(page);

    // Real UI assertion: the saved bookmark renders in the list.
    await expect(page.getByText('Basic Human Bookmark')).toBeVisible();
  });

  test('finds the basic-simulator bookmark via search', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);

    // Two bookmarks so the search can prove real filtering: the non-match
    // must disappear while the match stays visible.
    await createBookmarkViaCapture(
      page,
      human,
      'https://basic-search.example.com',
      'Basic Search Bookmark',
    );
    await createBookmarkViaCapture(
      page,
      human,
      'https://unrelated.example.com',
      'Unrelated Bookmark',
    );

    await goToBookmarks(page);
    await expect(page.getByText('Basic Search Bookmark')).toBeVisible();
    await expect(page.getByText('Unrelated Bookmark')).toBeVisible();

    // Search by title (the search bar only exists on the Bookmarks tab).
    const searchInput = page.getByTestId('search-input');
    await human.type(searchInput, 'Basic Search');

    // Real filtering: the match stays, the non-match is hidden.
    await expect(page.getByText('Basic Search Bookmark')).toBeVisible();
    await expect(page.getByText('Unrelated Bookmark')).toBeHidden();
  });

  test('search with no results shows the empty state', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);

    await createBookmarkViaCapture(
      page,
      human,
      'https://quasar-fixture.example.com',
      'Quasar Fixture Bookmark',
    );

    await goToBookmarks(page);

    const searchInput = page.getByTestId('search-input');
    // The query must not share substrings with the fixture title/URL so the
    // filter provably removes it (useBookmarkSearch debounces 400ms). The
    // fixture name deliberately avoids "empty"/"no results"/"no bookmarks"
    // so the empty-state assertion can never strict-mode-collide with the
    // saved bookmark's own title/URL (observed in the flaky run).
    await human.type(searchInput, 'zzz-nothing-here-987654');

    // The filter removes the bookmark row (auto-waits past the debounce)...
    await expect(page.getByText('Quasar Fixture Bookmark')).toBeHidden();
    // ...and the empty state ("No results found", app_noResultsFound) renders.
    await expect(page.getByText('No results found')).toBeVisible();
  });
});
