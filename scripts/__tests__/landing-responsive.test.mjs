// @vitest-environment node
/**
 * scripts/__tests__/landing-responsive.test.mjs
 *
 * "The landing stays usable on a phone, and in Arabic/Hebrew."
 *
 * Three real defects, each measured in a browser before the fix, are pinned here
 * so they cannot come back silently:
 *
 *   1. MOBILE NAVIGATION. The `@media (max-width: 768px)` rule set
 *      `.nav-links a:not(.nav-cta) { display: none; }` with no control to bring
 *      them back, so Features, Pricing and Help were unreachable on a phone —
 *      the only things left in the header were the language picker and the CTA.
 *
 *   2. HEADER OVERFLOW. With those anchors hidden but the language dropdown and
 *      the CTA still in the flex row, `.nav-inner` measured a scrollWidth of
 *      425 px inside a 374 px viewport (390 px device) and the theme toggle sat
 *      at right: 425 — entirely off-screen and untappable. In RTL it was worse:
 *      the theme toggle landed at left: -35 px.
 *
 *   3. PRICE BADGE. `.badge` was `position: absolute; left: 50%; translateX(-50%)
 *      ; white-space: nowrap`, so a long or translated badge grew past the card
 *      (measured: 311 px of text in a 280 px card → 15 px off each side), and a
 *      plan carrying BOTH badges absolutely centred them on top of each other.
 *
 * RTL additionally relied on physical properties: `.nav-cta` and
 * `.language-dropdown` used `margin-left`, which mirrors onto the wrong side
 * under `dir="rtl"` and is what pushed the theme toggle off the left edge.
 *
 *   4. MENU BUTTON LABEL. The control shipped `aria-label="Open menu"` as a
 *      literal in the template, so it read English on all 29 localized pages
 *      (its sibling, the theme toggle, already carried a translated label), and
 *      the name never followed the state — it still said "Open menu" with
 *      `aria-expanded="true"` and a close cross on screen.
 *
 * These assertions read the shipped files (public/landing.css, public/landing.js
 * and the generated public/*.html), so they are offline and fast; the browser
 * measurements they encode are recorded above for the reviewer.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LANDING_CODES } from "../landing-registry.mjs";

const ROOT = process.cwd();
const PUBLIC = join(ROOT, "public");
const TRANSLATIONS = join(ROOT, "scripts", "translations");
const CSS = readFileSync(join(PUBLIC, "landing.css"), "utf8");
const JS = readFileSync(join(PUBLIC, "landing.js"), "utf8");
const readPage = (name) => readFileSync(join(PUBLIC, name), "utf8");
const translation = (file) =>
  JSON.parse(readFileSync(join(TRANSLATIONS, file), "utf8"));
const translationFiles = () =>
  readdirSync(TRANSLATIONS).filter((file) => file.endsWith(".json"));

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The `{ … }` body starting at `braceIndex`, by brace matching. */
function bodyAt(css, braceIndex) {
  let depth = 0;
  for (let i = braceIndex; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(braceIndex + 1, i);
    }
  }
  return null;
}

/** Body of `selector { … }` where the selector is the whole selector list. */
function ruleBody(css, selector) {
  const re = new RegExp(`(^|[\\s,])${escapeRe(selector)}\\s*\\{`, "m");
  const match = re.exec(css);
  if (!match) return null;
  return bodyAt(css, match.index + match[0].length - 1);
}

/** Body of `@media <query> { … }`. */
function mediaBody(query) {
  const index = CSS.indexOf(`@media ${query}`);
  if (index === -1) return null;
  return bodyAt(CSS, CSS.indexOf("{", index));
}

// The inline header row was measured at 1036 px of content (Arabic page, 769 px
// viewport: `.nav-inner` scrollWidth 1036 against a 753 px viewport), so the
// panel has to take over at that width — not at 768 px, which left every tablet
// in landscape with a header running off the screen.
const NAV_PANEL_MAX_WIDTH = 1100;
const HEADER_ROW_REQUIRED_PX = 1036;
const NAV = mediaBody(`(max-width: ${NAV_PANEL_MAX_WIDTH}px)`);
const MOBILE = mediaBody("(max-width: 768px)");

describe("the mobile menu exists and is reachable", () => {
  it("declares a toggle that is hidden at desktop width", () => {
    const body = ruleBody(CSS, ".nav-toggle");
    expect(body, ".nav-toggle rule missing").not.toBeNull();
    expect(body).toMatch(/display:\s*none/);
  });

  it("shows the toggle at a width the inline row can no longer fit", () => {
    expect(NAV, `@media (max-width: ${NAV_PANEL_MAX_WIDTH}px) missing`).not.toBeNull();
    expect(ruleBody(NAV, ".nav-toggle")).toMatch(/display:\s*inline-flex/);
    // The panel must start at or above the width the header row actually needs.
    expect(NAV_PANEL_MAX_WIDTH).toBeGreaterThanOrEqual(HEADER_ROW_REQUIRED_PX);
  });

  it("hides the inline links at that width … and restores them when open", () => {
    const closed = ruleBody(NAV, ".nav-links");
    expect(closed, "`.nav-links` must be collapsed below the fit width").toMatch(/display:\s*none/);
    // The regression this pins: the old rule hid only the anchors and left no
    // way back, so the panel must be brought back by the open state.
    expect(ruleBody(NAV, ".nav.is-open .nav-links")).toMatch(/display:\s*flex/);
  });

  it("lays the panel out below the fixed header, inside the viewport", () => {
    const body = ruleBody(NAV, ".nav-links");
    expect(body).toMatch(/position:\s*absolute/);
    expect(body).toMatch(/top:\s*100%/);
    // Logical, so the panel spans the same two edges in LTR and RTL.
    expect(body).toMatch(/inset-inline:\s*0/);
    expect(body).not.toMatch(/(^|\s)(left|right):\s*0/);
  });

  it("keeps the panel rules out of the narrower content breakpoint", () => {
    // The 768px block owns the content grids; the header must not be re-hidden
    // there, or the two queries would disagree about the menu's state.
    expect(ruleBody(MOBILE, ".nav-toggle")).toBeNull();
    expect(ruleBody(MOBILE, ".nav-links")).toBeNull();
  });

  it("drops the old rule that hid the anchors with no replacement", () => {
    for (const body of [NAV, MOBILE]) {
      expect(body).not.toMatch(/\.nav-links a:not\(\.nav-cta\)\s*\{\s*display:\s*none/);
    }
  });

  it("swaps the hamburger for a close icon while open", () => {
    expect(ruleBody(CSS, ".nav-toggle .icon-close")).toMatch(/display:\s*none/);
    expect(ruleBody(CSS, ".nav.is-open .nav-toggle .icon-menu")).toMatch(/display:\s*none/);
    expect(ruleBody(CSS, ".nav.is-open .nav-toggle .icon-close")).toMatch(/display:\s*block/);
  });

  it("wires the button to aria-expanded/aria-controls in both templates' output", () => {
    for (const page of ["landing.html", "pocket-alternative.html"]) {
      const html = readPage(page);
      expect(html, `${page}: nav toggle missing`).toMatch(
        /<button[^>]*class="nav-toggle"[^>]*>/,
      );
      const button = /<button[^>]*class="nav-toggle"[^>]*>/.exec(html)[0];
      expect(button, `${page}: aria-expanded`).toMatch(/aria-expanded="false"/);
      expect(button, `${page}: aria-controls`).toMatch(/aria-controls="navLinks"/);
      expect(html, `${page}: the controlled nav must carry that id`).toMatch(
        /<nav[^>]*class="nav-links"[^>]*\bid="navLinks"/,
      );
    }
  });

  it("keeps the toggle reachable in the accessibility tree (not display:none on mobile)", () => {
    // The button must be a real, focusable control in the markup.
    const html = readPage("landing.html");
    expect(html).toMatch(/class="nav-toggle"[^>]*aria-label="/);
    // And it must not be `hidden`/`aria-hidden`, which would drop it.
    const button = /<button[^>]*class="nav-toggle"[^>]*>/.exec(html)[0];
    expect(button).not.toMatch(/aria-hidden/);
    expect(button).not.toMatch(/\bhidden\b/);
  });
});

describe("the menu button is labelled for its locale and its state", () => {
  it("asks every locale for both labels, not a hardcoded English one", () => {
    // The builder runs with throwOnUndefined, so a locale without these keys
    // fails the landing build outright — this pins the other half: that the
    // template actually reads them.
    for (const file of translationFiles()) {
      const t = translation(file);
      expect(typeof t.navToggleAria, `${file}: navToggleAria`).toBe("string");
      expect(typeof t.navToggleAriaClose, `${file}: navToggleAriaClose`).toBe("string");
      expect(t.navToggleAria.trim().length, `${file}: empty navToggleAria`).toBeGreaterThan(0);
      expect(t.navToggleAriaClose.trim().length, `${file}: empty navToggleAriaClose`).toBeGreaterThan(0);
      // A label that does not change cannot describe the open state.
      expect(t.navToggleAriaClose, `${file}: close label equals the open one`).not.toBe(
        t.navToggleAria,
      );
    }
  });

  it("emits both labels, localized, in the generated pages", () => {
    const pages = [
      ["landing.html", "en.json"],
      ["ar.html", "ar.json"],
      ["he.html", "he.json"],
      ["de.html", "de.json"],
      ["pocket-alternative.html", "pocket-alternative-en.json"],
    ];
    for (const [page, file] of pages) {
      const t = translation(file);
      const button = /<button[^>]*class="nav-toggle"[^>]*>/.exec(readPage(page))[0];
      expect(button, `${page}: open label`).toContain(`aria-label="${t.navToggleAria}"`);
      expect(button, `${page}: close label`).toContain(`data-label-close="${t.navToggleAriaClose}"`);
    }
  });

  it("ships no English label on a localized page", () => {
    for (const page of ["ar.html", "he.html", "de.html"]) {
      expect(readPage(page), `${page}: hardcoded English label`).not.toMatch(
        /aria-label="Open menu"/,
      );
    }
  });

  it("swaps the accessible name with the expanded state", () => {
    expect(JS).toMatch(/data-label-close/);
    expect(JS).toMatch(/setAttribute\('aria-label', open \? navCloseLabel : navOpenLabel\)/);
  });
});

describe("landing.js drives the menu accessibly", () => {
  it("reads the button and the panel by id", () => {
    expect(JS).toMatch(/getElementById\('navToggle'\)/);
    expect(JS).toMatch(/getElementById\('navLinks'\)/);
  });

  it("toggles aria-expanded on click", () => {
    expect(JS).toMatch(/setAttribute\('aria-expanded', String\(open\)\)/);
  });

  it("closes on Escape and returns focus to the button", () => {
    expect(JS).toMatch(/addEventListener\('keydown'/);
    expect(JS).toMatch(/e\.key !== 'Escape'/);
    expect(JS).toMatch(/navToggle\.focus\(\)/);
  });

  it("closes when the pointer lands outside the header", () => {
    expect(JS).toMatch(/navRoot\.contains\(e\.target\)/);
  });

  it("collapses after a link is followed", () => {
    expect(JS).toMatch(/closest\('a'\)\) setNavOpen\(false\)/);
  });

  it("resets the open state when the viewport returns to desktop width", () => {
    // One pixel above the panel's breakpoint, so the two stay in step.
    expect(JS).toMatch(new RegExp(`matchMedia\\('\\(min-width: ${NAV_PANEL_MAX_WIDTH + 1}px\\)'\\)`));
  });
});

describe("the header no longer overflows the viewport", () => {
  it("keeps every remaining direction-sensitive offset logical", () => {
    // `margin-left`/`margin-right` do not mirror under dir="rtl": they were
    // what pushed the theme toggle to left: -35px on the Arabic page.
    expect(CSS.match(/(^|[\s;{])(margin|padding)-(left|right)\s*:/g) ?? []).toEqual([]);

    // The only physical `left`/`right` the sheet may keep is the full-bleed
    // fixed header bar (`.nav`), which spans both edges in either direction.
    // Take it out and nothing directional may remain.
    const navBody = ruleBody(CSS, ".nav");
    expect(navBody, ".nav rule missing").not.toBeNull();
    const withoutHeaderBar = CSS.replace(navBody, "");
    const positional = [...withoutHeaderBar.matchAll(/(^|[\s;{])(left|right)\s*:/g)].map(
      (m) => m[0].trim(),
    );
    expect(positional).toEqual([]);
  });

  it("drops the RTL override the logical anchor made redundant", () => {
    // `.language-menu` now uses `inset-inline-end: 0`, which already flips.
    expect(CSS).not.toMatch(/\[dir="rtl"\]\s*\.language-menu/);
    expect(ruleBody(CSS, ".language-menu")).toMatch(/inset-inline-end:\s*0/);
  });

  it("anchors the CTA and the language dropdown with logical spacing", () => {
    expect(ruleBody(CSS, ".nav-cta")).toMatch(/margin-inline-start/);
    expect(ruleBody(CSS, ".language-dropdown")).toMatch(/margin-inline-start/);
  });

  it("keeps the skip link and the demo-tour counters on the reading edge", () => {
    expect(ruleBody(CSS, ".skip-link")).toMatch(/inset-inline-start/);
    expect(ruleBody(CSS, ".demo-tour-step::before")).toMatch(/inset-inline-start/);
  });
});

describe("the price badge stays inside its card", () => {
  it("stacks the badges in one ribbon bounded by the card", () => {
    const body = ruleBody(CSS, ".price-badges");
    expect(body, ".price-badges rule missing").not.toBeNull();
    expect(body).toMatch(/position:\s*absolute/);
    expect(body).toMatch(/inset-inline:\s*0/);
    expect(body).toMatch(/flex-direction:\s*column/);
    // Padding keeps the ribbon clear of the card border, and `top` keeps the
    // negative overhang that used to be applied per-badge.
    expect(body).toMatch(/padding:\s*0 12px/);
    expect(body).toMatch(/top:\s*-12px/);
  });

  it("bounds the badge instead of letting nowrap run past the card", () => {
    const badge = ruleBody(CSS, ".price-card .badge");
    expect(badge).toMatch(/max-width:\s*100%/);
    expect(badge).toMatch(/white-space:\s*normal/);
    expect(badge, "nowrap is what let the badge overflow").not.toMatch(/white-space:\s*nowrap/);
    expect(badge).toMatch(/text-align:\s*center/);
    // The old absolute-centring is what overlapped the two badges.
    expect(badge).not.toMatch(/position:\s*absolute/);
    expect(badge).not.toMatch(/translateX/);
  });

  it("emits the wrapper in the generated pages", () => {
    for (const page of ["landing.html", "ar.html", "he.html"]) {
      const html = readPage(page);
      expect(html, `${page}: .price-badges wrapper missing`).toMatch(/class="price-badges"/);
      expect(html, `${page}: badges must be inside the wrapper`).toMatch(
        /<div class="price-badges">[\s\S]*?<span class="badge"/,
      );
    }
  });

  it("keeps the badge inside the card even when a plan carries both", () => {
    // The wrapper is the only positioned ancestor of the badges, so two badges
    // stack instead of both being centred at the same point.
    const body = ruleBody(CSS, ".price-badges");
    expect(body).toMatch(/gap:\s*6px/);
    expect(ruleBody(CSS, ".price-card .badge.badge-early")).toMatch(/top:\s*auto/);
  });
});

describe("Arabic and Hebrew are laid out RTL", () => {
  it("sets dir=rtl on both RTL pages", () => {
    for (const code of ["ar", "he"]) {
      const html = readPage(`${code}.html`);
      expect(html, `${code}.html must declare dir="rtl"`).toMatch(/<html[^>]*\bdir="rtl"/);
      expect(html).toMatch(new RegExp(`<html lang="${code}"`));
    }
  });

  it("has no direction-sensitive rule left to mirror by hand", () => {
    // Every directional declaration in the sheet is logical, so nothing needs
    // a [dir="rtl"] companion rule — and the sheet carries none.
    expect(CSS).not.toMatch(/\[dir="rtl"\]/);
  });

  it("declares the text direction per locale, with ar/he the only RTL pair", () => {
    // Read from the translation sources rather than restated here: the `dir`
    // attribute the pages ship is exactly this field.
    const rtl = [];
    const ltr = [];
    for (const file of translationFiles()) {
      const t = translation(file);
      if (!t.hero?.badge && !file.startsWith("pocket-alternative")) continue;
      (t.dir === "rtl" ? rtl : ltr).push(t.lang);
    }
    expect([...new Set(rtl)].sort()).toEqual(["ar", "he"]);
    expect(ltr).toContain("en");
    expect(ltr).toContain("es");

    // And every locale the registry publishes has such a source.
    const declared = new Set([...rtl, ...ltr]);
    for (const code of LANDING_CODES) {
      expect(declared, `${code}: no translation declares its direction`).toContain(code);
    }
  });
});
