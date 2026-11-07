/**
 * scripts/sw-navigation-policy.js — the service worker's navigation contract.
 *
 * Single source of truth for `navigateFallback` + `navigateFallbackDenylist`:
 * `vite.config.ts` hands both to the VitePWA workbox block, and
 * `scripts/__tests__/sw-navigation-policy.test.mjs` evaluates them against the
 * real `workbox-routing` router the build ships. They live here, not inline in
 * the config, so the test asserts the very array production uses instead of a
 * re-typed copy that can drift.
 *
 * WHY THE `(?:\?|$)` ENDINGS — the bug this encodes. Workbox's NavigationRoute
 * matches the denylist against `url.pathname + url.search`, NOT the pathname
 * alone (workbox-routing: `const pathnameAndSearch = url.pathname + url.search`).
 * A rule anchored with `$` therefore stops matching the moment the URL carries a
 * query, and the landings are reached through query-carrying links: the language
 * menu of every landing links `/<lang>/?lang=<lang>` (and `/?lang=en` for
 * English), because `public/landing.js` records that choice in the `bf_lang` /
 * `nf_lang` cookies *before* the edge negotiates `Accept-Language`.
 *
 * The shipped rule was `/^\/(?:ar|bg|…|zh)\/?$/`, so `/es/` went to the network
 * (correct) while `/es/?lang=es` — what the menu actually links — fell through
 * to the precached `/app.html` shell: the visitor landed inside the private SPA
 * instead of the Spanish landing, and with no vault yet that is the "set up a
 * password / skip password" screen. Rules here either end in `(?:\?|$)` or are
 * prefix matches, so no public URL can be answered by the shell just because it
 * carries a query.
 *
 * The locale alternation is DERIVED from `scripts/landing-registry.mjs` (the
 * repo's single source for the 30-locale set, EN at the root included): the
 * hand-typed 29-code list that used to sit in `vite.config.ts` is exactly the
 * per-layer drift the registry was created to prevent.
 *
 * Node-core only (no deps, no filesystem reads): a config module and a unit
 * test both import it.
 */
import { LOCALIZED_LANDING_CODES } from "./landing-registry.mjs";

/** The precached SPA shell. Every client route is served from it. */
export const NAVIGATE_FALLBACK = "/app.html";

/** `ar|bg|…|zh` — every landing language except English (which is the root). */
const LANGUAGE_ROOTS = `(?:${LOCALIZED_LANDING_CODES.join("|")})`;

/**
 * Navigations matching any of these go to the network: the SW never answers
 * them with the precached shell (or its offline cache). Order is irrelevant —
 * the list is a set of independent tests.
 */
export const NAVIGATE_FALLBACK_DENYLIST = [
  // Error/offline pages: static HTML, never the app shell.
  /^\/404/,
  /^\/offline/,

  // Public legal + Help Center pages. `/privacy` and `/terms` are deliberately
  // NOT here: they are also real client routes (AppRoutes.tsx), so denying them
  // would break in-app navigation offline; the private app serves its own copy.
  /^\/privacy-and-terms/,
  /^\/[a-z]{2}\/privacy-and-terms/,
  /^\/help/,

  // SEO: the landing pages (served at `/` and `/<lang>/` with a 200 rewrite)
  // are the only indexable content. If the SW precached shell answered these
  // navigations, users with the SW installed would see the private SPA instead
  // of the marketing page — and crawlers executing the SW would index an empty
  // shell. Always go to the network for them.
  //
  // English landing: `/`, `/?lang=en`, `/landing.html`, `/landing.html?…`.
  /^\/(?:landing\.html)?(?:\?|$)/,
  // Every localized landing in every shape a visitor arrives by: `/es`, `/es/`,
  // `/es/<path>` (the hosts rewrite the subtree to the localized page),
  // `/es.html`, each with or without `?lang=xx`.
  new RegExp(`^\\/${LANGUAGE_ROOTS}(?:\\/|\\.html|\\?|$)`),

  /^\/pocket-alternative/,
];
