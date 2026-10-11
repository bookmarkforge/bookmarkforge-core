// @vitest-environment node
/**
 * Contract tests for scripts/sw-navigation-policy.js (the VitePWA workbox
 * `navigateFallback` + `navigateFallbackDenylist` the production build ships).
 *
 * The rules are evaluated through the REAL router: `NavigationRoute` from the
 * same `workbox-routing` the plugin bundles. That matters because the bug this
 * file pins came from the library's matching semantics, not from the patterns
 * being "wrong" in isolation — Workbox tests the denylist against
 * `url.pathname + url.search`, so a rule anchored with `$` silently stops
 * applying as soon as the URL carries a query.
 *
 * The reported failure (2026-10-11): on a browser where the installed SW
 * controls the landing, choosing a language opened the private app — with no
 * vault yet, the "set up a password / skip password" screen. The landings link
 * `/<lang>/?lang=<lang>` (`/?lang=en` for English) so that `public/landing.js`
 * can record the choice in the `bf_lang` / `nf_lang` cookies before the edge
 * negotiates `Accept-Language`; the denylist had `/^\/(?:ar|…|zh)\/?$/`, so
 * `/es/` reached the network but `/es/?lang=es` fell through to the precached
 * `/app.html`. `e2e` cannot cover this cheaply (it needs an activated SW), and
 * a hand-typed copy of the list is what drifted in the first place — so the
 * test drives the exported array and derives the locale set from the registry.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LOCALIZED_LANDING_CODES } from "../landing-registry.mjs";
import { NAVIGATE_FALLBACK, NAVIGATE_FALLBACK_DENYLIST } from "../sw-navigation-policy.js";

const ORIGIN = "https://bookmarkforgeapp.com";

// workbox-routing's production build is a plain script that publishes itself on
// the worker global; give it one before requiring it (the sandbox has none).
globalThis.self = globalThis;
globalThis.workbox = { core: createRequire(import.meta.url)("workbox-core") };
const { NavigationRoute } = createRequire(import.meta.url)("workbox-routing");

const route = new NavigationRoute(async () => new Response("app shell"), {
  denylist: NAVIGATE_FALLBACK_DENYLIST,
});

/** true = the SW answers this navigation with the precached shell. */
function shellAnswers(path) {
  return Boolean(
    route.match({
      url: new URL(path, ORIGIN),
      sameOrigin: true,
      request: { mode: "navigate" },
      event: {},
    }),
  );
}

const toNetwork = (path) => {
  expect(shellAnswers(path), `${path} must reach the network, not the app shell`).toBe(false);
};

describe("sw navigation policy", () => {
  it("leaves every localized landing to the network, in every link shape", () => {
    expect(LOCALIZED_LANDING_CODES.length).toBeGreaterThan(20);
    for (const code of LOCALIZED_LANDING_CODES) {
      toNetwork(`/${code}`);
      toNetwork(`/${code}/`);
      toNetwork(`/${code}.html`);
      toNetwork(`/${code}?lang=${code}`);
      toNetwork(`/${code}/?lang=${code}`);
      toNetwork(`/${code}/deeper/path`);
    }
  });

  it("regression: the language menu's own href never opens the app shell", () => {
    // The exact navigation observed live, plus the English entry and the
    // `.html` twin of a landing.
    toNetwork("/es/?lang=es");
    toNetwork("/de/?lang=de");
    toNetwork("/?lang=en");
    toNetwork("/");
    toNetwork("/es.html");
    toNetwork("/landing.html");
    toNetwork("/landing.html?lang=en");
  });

  it("leaves the rest of the public surface to the network", () => {
    toNetwork("/privacy-and-terms");
    toNetwork("/privacy-and-terms.html");
    toNetwork("/es/privacy-and-terms.html");
    toNetwork("/help");
    toNetwork("/help-es.html");
    toNetwork("/404.html");
    toNetwork("/offline");
    toNetwork("/pocket-alternative");
    toNetwork("/pocket-alternative?lang=es");
  });

  it("keeps serving the private app from the precached shell", () => {
    for (const appPath of ["/app", "/app/settings", "/settings", "/security", "/privacy", "/terms", "/deep/route"]) {
      expect(shellAnswers(appPath), `${appPath} should be served by ${NAVIGATE_FALLBACK}`).toBe(true);
    }
  });

  it("is the array vite.config.ts hands to workbox (no inline copy to drift)", () => {
    const viteConfig = readFileSync(new URL("../../vite.config.ts", import.meta.url), "utf8");
    expect(viteConfig).toContain("navigateFallback: NAVIGATE_FALLBACK");
    expect(viteConfig).toContain("navigateFallbackDenylist: NAVIGATE_FALLBACK_DENYLIST");
    expect(viteConfig).not.toMatch(/navigateFallbackDenylist:\s*\[/);
  });
});
