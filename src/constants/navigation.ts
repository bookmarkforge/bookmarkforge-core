/**
 * Canonical navigation tab ids — the shared contract behind the app's
 * dynamic `data-tab-id` / `data-bottom-nav-tab` selectors.
 *
 * WHY this file exists: Sidebar.tsx and BottomNav.tsx render their tab
 * attributes via JSX bindings (`data-tab-id={item.id}`), so the attribute
 * never appears as a literal in production source and a selector audit
 * cannot verify E2E usages against `src/` text. Centralizing the ids here
 * gives every consumer — the production renderers, the E2E selector gate
 * (scripts/check-e2e-selectors.mjs imports this file directly under
 * Node 24 type-stripping), and Playwright helpers — the same array to
 * check against, so a renamed or removed tab id fails the gate (or the
 * typecheck) instead of rotting silently in a spec.
 *
 * RULES for edits (same constraints as ./locales.ts):
 * 1. ZERO imports and ZERO side effects: a plain Node process imports this
 *    file directly, so no React, no i18n, no browser globals.
 * 2. Only string-literal arrays and types derived from them.
 * 3. Adding a tab id here is the FIRST step; the component array, the
 *    E2E specs and the typecheck keep the rest honest.
 */

/**
 * Sidebar tab ids, in display order. Mirrors the `sidebarItems` array in
 * Sidebar.tsx (which pairs each id with a label and an icon and must stay
 * in sync).
 */
export const SIDEBAR_TAB_IDS = [
  "dashboard",
  "documents",
  "bookmarks",
  "graph",
  "canvas",
  "database",
  "kanban",
  "calendar",
  "list",
  "gallery",
  "timeline",
  "chatLocal",
  "voiceLocal",
  "collaboration",
  "analytics",
  "security",
  "chat",
] as const;

export type SidebarTabId = (typeof SIDEBAR_TAB_IDS)[number];

/**
 * Mobile bottom-nav tab ids, in display order. Mirrors the `navItems`
 * array in BottomNav.tsx. A strict subset of SIDEBAR_TAB_IDS by design:
 * the mobile bar shows only the primary destinations.
 */
export const BOTTOM_NAV_TAB_IDS = [
  "dashboard",
  "documents",
  "bookmarks",
  "chatLocal",
] as const;

export type BottomNavTabId = (typeof BOTTOM_NAV_TAB_IDS)[number];

/**
 * Support Center (SupportChat.tsx) tab ids. NOTE: these live under the
 * SAME `data-tab-id` attribute as the sidebar tabs but are a separate
 * component's namespace; "chat" deliberately exists in both (the sidebar's
 * Support tab and the support center's AI Assistant tab).
 */
export const SUPPORT_CHAT_TAB_IDS = ["chat", "faq", "diagnostics"] as const;

export type SupportChatTabId = (typeof SUPPORT_CHAT_TAB_IDS)[number];

/**
 * The full value space of the `data-tab-id` attribute: every id any
 * component may render under that attribute. The E2E selector gate checks
 * E2E usages against exactly this union (plus SUPPORTED_LOCALE_CODES for
 * `data-language-code`), so an id that is not exported here cannot be
 * selected by an E2E spec.
 */
export const DATA_TAB_ID_VALUES: ReadonlyArray<SidebarTabId | SupportChatTabId> =
  [...SIDEBAR_TAB_IDS, ...SUPPORT_CHAT_TAB_IDS];

export const BOTTOM_NAV_TAB_ID_VALUES: ReadonlyArray<BottomNavTabId> =
  BOTTOM_NAV_TAB_IDS;

// ---- Machine-readable projections (for tooling, NOT for app code) --------
// The E2E selector gate (scripts/check-e2e-selectors.mjs) must consume this
// value space on any Node runtime, including Node 20 CI which cannot
// type-strip .ts imports, so it parses THIS STRING LITERAL from the file
// text instead of executing the module. The literal MUST stay equal to
// DATA_TAB_ID_VALUES.join(",") — src/tests/constants-vocab.test.ts pins
// that equality, and the gate additionally refuses any CSV entry that is
// not a string literal in the same file. Tooling reads the CSV; app code
// must use the arrays above.

export const DATA_TAB_ID_VALUES_CSV =
  "dashboard,documents,bookmarks,graph,canvas,database,kanban,calendar,list,gallery,timeline,chatLocal,voiceLocal,collaboration,analytics,security,chat,chat,faq,diagnostics";
// NOTE: "chat" appears twice by design — the sidebar's Support tab and the
// support center's AI Assistant tab share the id; the CSV is the exact join
// of DATA_TAB_ID_VALUES and the gate collects it into a Set.
export const BOTTOM_NAV_TAB_ID_VALUES_CSV = "dashboard,documents,bookmarks,chatLocal";
