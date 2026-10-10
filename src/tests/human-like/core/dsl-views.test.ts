/**
 * Unit tests for the pure view-routing helpers of the natural-language DSL.
 *
 * These cover the latent bugs fixed in the harness refactor:
 *   1. `mentionsBookmarkListText` no longer matches generic "appears" /
 *      "is visible" phrases (false positives that navigated to Bookmarks
 *      on toast/modal verifies) nor substring look-alikes ("in the
 *      listing" must NOT match).
 *   2. `shouldOpenBookmarksTab` still lands on the Bookmarks tab when a
 *      quoted title is asserted with "appears" (the app never
 *      auto-navigates after a QuickCapture save).
 *   3. `resolveAppTab` maps the DSL's documented 'Open the app' step to the
 *      dashboard and fails fast with a descriptive error for unmapped
 *      phrases instead of timing out on a non-existent selector.
 *   4. `selectVerifyTitle` prefers the quoted title and falls back to the
 *      most recent captured title.
 */
import { describe, it, expect } from 'vitest';
import {
  mentionsBookmarkListText,
  shouldOpenBookmarksTab,
  resolveAppTab,
  selectVerifyTitle,
} from './dsl-views';

describe('mentionsBookmarkListText', () => {
  it('matches explicit list references', () => {
    expect(mentionsBookmarkListText('Verify the bookmark appears in the list')).toBe(true);
    expect(mentionsBookmarkListText('Verify the bookmark list renders')).toBe(true);
    expect(mentionsBookmarkListText('Assert it is shown in the list')).toBe(true);
    expect(mentionsBookmarkListText('it appears in the list')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(mentionsBookmarkListText('VERIFY THE BOOKMARK APPEARS IN THE LIST')).toBe(true);
    expect(mentionsBookmarkListText('Verify The Bookmark List Renders')).toBe(true);
  });

  it('does NOT match generic "appears" / "is visible" phrases', () => {
    // Regression: these used to open the Bookmarks tab and time out.
    expect(mentionsBookmarkListText('Verify the toast is visible')).toBe(false);
    expect(mentionsBookmarkListText('Verify the settings modal appears')).toBe(false);
    expect(mentionsBookmarkListText('Verify focus is visible')).toBe(false);
  });

  it('does NOT match substring look-alikes (word boundary after "list")', () => {
    // Regression guard: 'in the listing' / 'bookmark listed' must not match.
    expect(mentionsBookmarkListText('Verify it appears in the listing')).toBe(false);
    expect(mentionsBookmarkListText('The bookmark listed below is gone')).toBe(false);
    expect(mentionsBookmarkListText('in the listings')).toBe(false);
    // Deliberate boundary narrowing: the plural is pinned as NOT a match
    // (the specs always use the singular 'bookmark list').
    expect(mentionsBookmarkListText('the bookmark lists')).toBe(false);
  });
});

describe('shouldOpenBookmarksTab', () => {
  it('opens Bookmarks for explicit list references even without a quoted title', () => {
    expect(shouldOpenBookmarksTab('Verify the bookmark appears in the list', false)).toBe(true);
    expect(shouldOpenBookmarksTab('Verify the bookmark list renders', false)).toBe(true);
  });

  it('opens Bookmarks for a quoted title asserted with "appears"', () => {
    // Regression: 'Verify "Natural Language Bookmark" appears' must land on
    // the list (the app does not auto-navigate after a save).
    expect(shouldOpenBookmarksTab('Verify "Natural Language Bookmark" appears', true)).toBe(true);
  });

  it('stays on the current view for generic visibility phrases', () => {
    expect(shouldOpenBookmarksTab('Verify the toast is visible', false)).toBe(false);
    expect(shouldOpenBookmarksTab('Verify the toast is visible', true)).toBe(false);
  });
});

describe('resolveAppTab', () => {
  it('maps the documented "Open the app" step to the dashboard', () => {
    // Regression: 'Open the app' used to fall through to a non-existent
    // [data-tab-id="open the app"] selector and time out after 5s.
    expect(resolveAppTab('Open the app')).toBe('dashboard');
    expect(resolveAppTab('Go to the main page')).toBe('dashboard');
    expect(resolveAppTab('open the home page')).toBe('dashboard');
  });

  it('maps known tabs and phrases', () => {
    expect(resolveAppTab('bookmarks')).toBe('bookmarks');
    expect(resolveAppTab('the bookmark list')).toBe('bookmarks');
    expect(resolveAppTab('documents')).toBe('documents');
    expect(resolveAppTab('open a note')).toBe('documents');
    expect(resolveAppTab('open the settings')).toBe('settings');
  });

  it('throws a descriptive error for unmapped phrases (no silent timeout)', () => {
    const message = 'resolveAppTab: no view mapping for "do the hokey pokey". Known views: bookmarks, dashboard, documents, settings.';
    expect(() => resolveAppTab('do the hokey pokey')).toThrow(message);
    expect(() => resolveAppTab('')).toThrow(/no view mapping/i);
  });
});

describe('selectVerifyTitle', () => {
  it('prefers the quoted title over captured titles', () => {
    expect(selectVerifyTitle('Quoted Title', ['First', 'Second'])).toBe('Quoted Title');
  });

  it('falls back to the most recent captured title', () => {
    expect(selectVerifyTitle(undefined, ['First', 'Second'])).toBe('Second');
    expect(selectVerifyTitle(undefined, ['Only One'])).toBe('Only One');
  });

  it('returns undefined when neither a quoted title nor captured titles exist', () => {
    expect(selectVerifyTitle(undefined, [])).toBeUndefined();
    expect(selectVerifyTitle('', [])).toBeUndefined();
  });

  it('treats an empty quoted value as absent (fallback to captured)', () => {
    expect(selectVerifyTitle('', ['First'])).toBe('First');
  });
});
