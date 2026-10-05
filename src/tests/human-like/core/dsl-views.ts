/**
 * Pure, dependency-free helpers for the natural-language DSL.
 *
 * Kept free of any Playwright import so they unit-test cleanly under Vitest
 * (the DSL itself pulls in `@playwright/test` and a real Page).
 */

export type AppView = 'bookmarks' | 'dashboard' | 'documents' | 'settings';

/**
 * Does a natural-language phrase reference the bookmark list?
 *
 * Deliberately tight: only explicit list references count. Generic
 * "appears" / "is visible" phrases (toasts, modals, focus) must NOT trigger
 * a Bookmarks-tab navigation — that was a false-positive bug where
 * "Verify the toast is visible" opened the wrong view and timed out.
 */
export function mentionsBookmarkListText(phrase: string): boolean {
  // Two anchors cover every list reference the DSL specs use. The extra
  // "appears in the list"/"shown in the list" spellings are subsumed by
  // "in the list" — kept out to avoid dead alternatives.
  //
  // Word-boundary after "list" so substring false positives are rejected:
  // 'in the listing' / 'a bookmark listed below' must NOT match. This also
  // deliberately rejects the plural 'bookmark lists' (a boundary sits
  // before 's'), which the specs never use.
  return /(?:in the list|bookmark list)\b/i.test(phrase);
}

/**
 * Should a verify step land on the Bookmarks tab?
 *
 * True when the phrase explicitly references the list, OR when it asserts
 * a quoted bookmark title with "appears" — BookmarkForge never
 * auto-navigates after a QuickCapture save, so the quoted-title case must
 * also open the list to be assertable. Generic "is visible" phrases without
 * a quoted title stay on the current view.
 */
export function shouldOpenBookmarksTab(
  phrase: string,
  hasQuotedTitle: boolean,
): boolean {
  if (mentionsBookmarkListText(phrase)) return true;
  return hasQuotedTitle && /appears/i.test(phrase);
}

/**
 * Which title should a verify-list step assert?
 *
 * Prefer the title quoted in the step itself; otherwise fall back to the
 * MOST RECENT title captured by a prior 'Enter "X" in the title field'
 * step (the scenario's latest save). Returns undefined when neither exists
 * so the caller can fail fast.
 */
export function selectVerifyTitle(
  quotedValue: string | undefined,
  capturedTitles: readonly string[],
): string | undefined {
  // An empty quoted value ('') is treated as absent, matching the DSL where
  // extractQuotedString never yields '' (regex requires 1+ chars).
  if (quotedValue) return quotedValue;
  return capturedTitles[capturedTitles.length - 1];
}

/**
 * Map a natural-language phrase or tab id to a BookmarkForge view.
 *
 * - Settings is a MODAL opened by the Header settings button, not a sidebar
 *   tab.
 * - Bookmarks / dashboard / documents are sidebar tabs ([data-tab-id=...]).
 * - The DSL's documented first step is `'Open the app'`; it must resolve to
 *   the dashboard instead of clicking a non-existent selector.
 *
 * Throws a descriptive error for unmapped phrases so the DSL fails fast
 * with a clear message instead of a confusing 5s selector timeout.
 */
export function resolveAppTab(phrase: string): AppView {
  const lower = phrase.toLowerCase();
  if (/settings/.test(lower)) return 'settings';
  if (/bookmark|library/.test(lower)) return 'bookmarks';
  if (/document|note/.test(lower)) return 'documents';
  if (/open the app|the app|main page|dashboard|home|start/.test(lower)) {
    return 'dashboard';
  }
  throw new Error(
    `resolveAppTab: no view mapping for "${phrase}". Known views: bookmarks, dashboard, documents, settings.`,
  );
}
