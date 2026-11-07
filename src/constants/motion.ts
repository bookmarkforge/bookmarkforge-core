/**
 * Shared motion tokens — single source of truth for animation values.
 *
 * Mirrors the CSS tokens in src/index.css (:root). Values follow the
 * emilkowalski/skills audit bar (AUDIT.md): strong custom curves, UI
 * animations under 300ms.
 */

/** Strong ease-out for UI entrances/exits: cubic-bezier(0.23, 1, 0.32, 1). */
export const EASE_OUT: [number, number, number, number] = [0.23, 1, 0.32, 1];


/** Tooltips, small popovers: 125–200ms. */
export const DURATION_TOOLTIP = 0.18;

/** Dropdowns, selects: 150–250ms. */
export const DURATION_MENU = 0.2;

/**
 * Collapsible surfaces (banner collapse/expand): 200ms. The single source of
 * truth for both halves of the motion — the CSS height transition that
 * collapses the box and the opacity fade inside it — so the box and its
 * contents can never finish at different times.
 */
export const DURATION_COLLAPSE = 0.2;

/** `DURATION_COLLAPSE` in milliseconds, for CSS transitions (not motion). */
export const COLLAPSE_MS = DURATION_COLLAPSE * 1000;

