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

