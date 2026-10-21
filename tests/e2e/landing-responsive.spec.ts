/**
 * tests/e2e/landing-responsive.spec.ts
 *
 * The landing header and the price badge must not leave the viewport, in any
 * direction, at any width we ship for — measured in a real browser instead of
 * read out of the stylesheet.
 *
 * ── THE DEFECT CLASS ───────────────────────────────────────────────────────
 * The public landings (`public/landing.html`, the 29 localized `<lang>.html`,
 * `pocket-alternative.html`) are generated from
 * `scripts/templates/landing/*.njk` with `public/landing.css`. Three real
 * defects were measured there on 2026-10-13, and unit-level CSS assertions
 * (scripts/__tests__/landing-responsive.test.mjs) cannot see any of them,
 * because they only exist once a layout engine resolves the sheet:
 *
 *   1. Above the phone breakpoint the header row overflowed the viewport and
 *      pushed the theme toggle off the screen entirely: `.nav-inner` measured
 *      scrollWidth 425 against a 374 viewport (390 px device), and 1036 against
 *      753 at 769 px — i.e. every tablet in landscape as well.
 *   2. In RTL (ar/he) the same row left the toggle at `left: -35px`, because
 *      the offsets were physical (`margin-left`) and mirrored onto the wrong
 *      edge.
 *   3. A long price badge ran past its card (311 px of text in a 280 px card),
 *      and a plan with BOTH badges stacked them on top of each other.
 *
 * ── WHAT IS ASSERTED, AND WHY EACH WIDTH IS HERE ───────────────────────────
 *   320/360  the narrowest phones in use; 320 is where a fixed-width control
 *            or an unbreakable badge shows up first.
 *   768      the old (too narrow) header breakpoint: the width below which the
 *            panel took over while the row above it still could not fit.
 *   1100     the widest viewport that still uses the collapsed menu panel.
 *   1101     one pixel past it: the width where the inline row must be back,
 *            with no stale open state on `.nav`.
 *   1440     desktop reference, so a "fix" that only works at one size fails.
 *
 * The horizontal-overflow check is deliberately scoped, not a blanket "any
 * element wider than the viewport is a bug": on the Pocket comparison page the
 * feature table is MEANT to be wider than a phone and scrolls inside its own
 * `.table-wrap` (overflow-x: auto), so it must not be reported. Four contracts
 * are asserted per width instead — the DOCUMENT never scrolls sideways, the
 * HEADER row fits its own box with every visible control inside the viewport,
 * every label in that row stays on ONE LINE, and every BADGE stays inside its
 * price card.
 *
 * The one-line contract is not redundant with the row-overflow one. Before the
 * 2026-10-13 header fix `.nav-inner` was a `nowrap` flex row of shrinkable
 * items inside a container capped at 1200px, and the row's natural width is
 * 1228-1588px across the 30 locales — so it SQUEEZED its links until their
 * text wrapped instead of overflowing. `scrollWidth` reported no overflow at
 * all while the header doubled up (a French nav label ran to five lines and
 * out of the header; the CTA was clipped), which a box check cannot see. The
 * row now wraps the LINK BLOCK into rows and grows past its 72px minimum
 * instead, and this contract is what stops a longer future translation from
 * going back to squeezing a label.
 *
 * RTL is not a separate idea here: the same three contracts run on `/ar.html`
 * and `/he.html` with `dir="rtl"`, which is what fails when an offset is
 * written in physical terms.
 *
 * ── THE 30 GENERATED LOCALES ───────────────────────────────────────────────
 * The describes above walk four pages with the full contract. A translation,
 * however, is a per-locale defect: the longest string wins, and the locale
 * whose badge or CTA happens to overflow is not the one an author would pick
 * to look at. The last describe therefore walks EVERY landing the generator
 * emits (the registry's 30 codes, EN included) at five widths, reusing the
 * same three contracts. Two things make that cheap enough for the PR e2e job:
 *   - no pixel baselines, so it runs on every platform instead of only win32;
 *   - one page load per locale, resized through the widths in place, so a
 *     locale costs one navigation rather than five.
 * Plus one contract the curated describes do not need, because it only shows
 * up once a real translation is on screen: a badge that WRAPS grows DOWNWARD
 * (the ribbon starts 12px above the card edge) and lands on the plan name
 * below it. That is a long translation breaking the card without the badge
 * ever leaving its own box, so box containment alone would call it sound.
 *
 * Two surfaces, one specification. The DEV surface is
 * `npx playwright test tests/e2e/landing-responsive.spec.ts`: playwright.config.ts
 * boots the Vite dev server (no vault, no Argon2id, no companion server). The
 * PACKAGED surface is `npm run test:landing:dist`: it builds `dist/`, serves the
 * build with `vite preview` through playwright.preview.config.ts — the config
 * `npm run e2e:preview` already uses — and runs the same walk against the
 * packaged output, which is what actually ships. The landing HTML/CSS are copied
 * verbatim rather than minified, so both surfaces serve the same bytes for these
 * pages today; what the packaged run adds is the artefact itself: a landing the
 * build stops emitting, or a path that only resolves because `public/` is served
 * from disk, fails here while the dev surface stays green.
 */
import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * One specification, two servers: the describes below run unchanged against the
 * Vite dev server (default config) and against the packaged build
 * (`test:landing:dist`), so production gets its own independent run. The walk of
 * the 30 generated locales matters most there, because vite's build may reorder
 * or escape strings differently than the dev server.
 */

/** Viewports that matter for this header, narrowest first. */
const VIEWPORT_WIDTHS = [320, 360, 768, 1100, 1101, 1440] as const;

/** A phone width used for the interactive menu assertions. */
const PHONE_WIDTH = 390;

/** The width under which the collapsed menu panel owns the header. */
const MENU_PANEL_MAX_WIDTH = 1100;

/**
 * Pages under test, with the language/direction each one must serve. The
 * `bf_lang` preference is pinned before boot so a host that negotiates by
 * Accept-Language cannot hand us a different page than the one asserted.
 */
const PAGES = [
  { path: "/landing.html", label: "EN landing", lang: "en", dir: "ltr" },
  { path: "/ar.html", label: "Arabic landing", lang: "ar", dir: "rtl" },
  { path: "/he.html", label: "Hebrew landing", lang: "he", dir: "rtl" },
  { path: "/pocket-alternative.html", label: "Pocket comparison", lang: "en", dir: "ltr" },
] as const;

/**
 * Pages that ship a pricing grid (the Pocket comparison page does not), so the
 * badge assertions have a subject. Pairing the two lists is deliberate: running
 * the badge test on a page with no price card would pass while measuring
 * nothing, and the per-width `measured` counter below turns that into a red.
 */
const PAGES_WITH_PRICING = PAGES.filter((page) => page.path !== "/pocket-alternative.html");

/**
 * Widths for the 30-locale walk. Five, not the curated six: what differs
 * between locales is STRING LENGTH, so the widths are the four structural
 * regimes plus the one width where a long inline row is at its tightest.
 *   320   the narrowest phone: where a wrapping badge first reaches the plan
 *         name, and where the longest nav link shows up in the panel;
 *   360   the phone the curated badge check uses, so the two agree;
 *   768   the collapsed-panel breakpoint, the widest panel header;
 *   1101  one pixel past the breakpoint — the LEAST room the inline row ever
 *         has, which is where a long CTA (`navCta`) or nav link overflows;
 *   1440  desktop, so a locale whose strings only fit one size still fails.
 */
const LOCALE_WALK_WIDTHS = [320, 360, 768, 1101, 1440] as const;

/** The two RTL landing locales (their `<html dir>` is generated, not inherited). */
const RTL_LANGS: ReadonlySet<string> = new Set(["ar", "he"]);

/**
 * Every landing the generator emits, derived from the registry that owns the
 * list (`scripts/landing-registry.mjs` → `LANDING_LANGS`) rather than copied
 * into this file: a new locale is walked without touching the spec, and one
 * that stops being generated cannot silently drop out of the walk either —
 * the guard test below fails when the set shrinks below the 30 that ship.
 *
 * Parsed, not imported: the registry is ESM for the build scripts and this
 * checkout's tsconfig has no `allowJs`, so importing it here would trade a
 * working walk for a typecheck error.
 */
interface LocaleLanding {
  code: string;
  path: string;
  file: string;
}

const LOCALE_LANDINGS: LocaleLanding[] = (() => {
  const registry = readFileSync(join("scripts", "landing-registry.mjs"), "utf8");
  const block = registry.slice(registry.indexOf("export const LANDING_LANGS"));
  // Group 1 is always present: the pattern only matches when the code is there.
  const codes = [...block.matchAll(/hreflang: "([a-z]{2})"/g)].map((match) => match[1]!);
  return codes.map((code) => ({
    code,
    // EN's landing is the root document; every other code has its own page.
    path: code === "en" ? "/landing.html" : `/${code}.html`,
    file: code === "en" ? "landing.html" : `${code}.html`,
  }));
})();

interface Box {
  left: number;
  right: number;
  width: number;
  visible: boolean;
}

interface HeaderSnapshot {
  lang: string;
  dir: string;
  viewportWidth: number;
  documentScrollWidth: number;
  documentOverflows: boolean;
  headerScrollWidth: number;
  headerClientWidth: number;
  toggle: Box;
  themeToggle: Box;
  visibleInlineLinks: number;
  /** Visible inline-row labels and how many lines each one's text occupies. */
  inlineItems: { text: string; lines: number }[];
  panelVisible: boolean;
}

interface CardSnapshot {
  cardLeft: number;
  cardRight: number;
  cardTop: number;
  cardBottom: number;
  /** First element of the card body (the plan name) — what a wrapping badge lands on. */
  contentTop: number;
  contentName: string;
  badges: { text: string; left: number; right: number; top: number; bottom: number }[];
}

/** Load a landing and wait until its webfont is in (metrics shift until then). */
async function gotoLanding(page: Page, path: string, lang: string): Promise<void> {
  await page.addInitScript((code) => {
    // The landing remembers a manual language choice; write it before any app
    // script runs so the page served is the page under test.
    window.localStorage.setItem("bf_lang", code as string);
  }, lang);
  await page.goto(path, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

/** Header + document geometry at the current viewport. */
async function measureHeader(page: Page): Promise<HeaderSnapshot> {
  return page.evaluate(() => {
    const isVisible = (el: Element | null): boolean => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden"
      );
    };
    const box = (el: Element | null) => {
      const rect = el!.getBoundingClientRect();
      return {
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        width: Math.round(rect.width),
        visible: isVisible(el),
      };
    };
    const documentElement = document.documentElement;
    const header = document.querySelector(".nav-inner")!;
    const inlineLinks = Array.from(document.querySelectorAll(".nav-links > a"));
    return {
      lang: documentElement.lang,
      dir: documentElement.dir,
      viewportWidth: documentElement.clientWidth,
      documentScrollWidth: documentElement.scrollWidth,
      documentOverflows: documentElement.scrollWidth > documentElement.clientWidth + 1,
      headerScrollWidth: header.scrollWidth,
      headerClientWidth: header.clientWidth,
      toggle: box(document.getElementById("navToggle")),
      themeToggle: box(document.querySelector(".theme-toggle")),
      visibleInlineLinks: inlineLinks.filter(isVisible).length,
      // Line boxes, not height: `line-height` resolves to `normal` here, so the
      // only reliable count is how many rects the text is laid out in.
      inlineItems: inlineLinks.filter(isVisible).map((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return { text: (el.textContent ?? "").trim(), lines: range.getClientRects().length };
      }),
      panelVisible: isVisible(document.getElementById("navLinks")),
    };
  });
}

/** Every price card and the badges currently inside it. */
async function measurePriceCards(page: Page): Promise<CardSnapshot[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll(".price-card")).map((card) => {
      const cardRect = card.getBoundingClientRect();
      const ribbon = card.querySelector(".price-badges");
      const badges = ribbon ? Array.from(ribbon.querySelectorAll(".badge")) : [];
      const content = card.querySelector("h3");
      const contentRect = content?.getBoundingClientRect();
      return {
        cardLeft: Math.round(cardRect.left),
        cardRight: Math.round(cardRect.right),
        cardTop: Math.round(cardRect.top),
        cardBottom: Math.round(cardRect.bottom),
        contentTop: Math.round(contentRect?.top ?? Number.NaN),
        contentName: (content?.textContent ?? "").trim(),
        badges: badges.map((badge) => {
          const rect = badge.getBoundingClientRect();
          return {
            text: (badge.textContent ?? "").trim(),
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            top: Math.round(rect.top),
            bottom: Math.round(rect.bottom),
          };
        }),
      };
    }),
  );
}

/** One line per violation, and an empty array when the layout is sound. */
function headerViolations(snapshot: HeaderSnapshot, width: number): string[] {
  const problems: string[] = [];
  const panelOwnsHeader = width <= MENU_PANEL_MAX_WIDTH;

  if (snapshot.documentOverflows) {
    problems.push(
      `document scrolls sideways: scrollWidth ${snapshot.documentScrollWidth} > clientWidth ${snapshot.viewportWidth}`,
    );
  }
  if (snapshot.headerScrollWidth > snapshot.headerClientWidth + 1) {
    problems.push(
      `header row overflows its own box: scrollWidth ${snapshot.headerScrollWidth} > clientWidth ${snapshot.headerClientWidth}`,
    );
  }

  const controls: [string, Box][] = [
    ["menu button", snapshot.toggle],
    ["theme toggle", snapshot.themeToggle],
  ];
  for (const [name, control] of controls) {
    if (!control.visible) continue;
    if (control.left < 0 || control.right > width + 1) {
      problems.push(`${name} is outside the viewport: [${control.left}, ${control.right}] vs 0..${width}`);
    }
  }

  // The breakpoint contract: the panel owns the header at or below 1100, the
  // inline row above it. Both halves are asserted explicitly, so neither a
  // never-shown button nor a permanently hidden row can pass.
  if (panelOwnsHeader) {
    if (!snapshot.toggle.visible) {
      problems.push(`menu button is not reachable at ${width}px (panel width)`);
    }
    if (snapshot.visibleInlineLinks > 0) {
      problems.push(
        `inline links (${snapshot.visibleInlineLinks}) are still shown at ${width}px instead of the panel`,
      );
    }
    if (snapshot.panelVisible) {
      problems.push(`menu panel is open before any interaction at ${width}px`);
    }
  } else {
    if (snapshot.toggle.visible) {
      problems.push(`menu button is still shown at ${width}px (inline header width)`);
    }
    if (snapshot.visibleInlineLinks === 0) {
      problems.push(`no inline navigation link is reachable at ${width}px`);
    }
  }

  // One line per inline label. At panel widths the links are `display: none`
  // and the list is empty, so this only judges the inline-row regime.
  for (const item of snapshot.inlineItems) {
    if (item.lines > 1) {
      problems.push(
        `inline item "${item.text}" wraps onto ${item.lines} lines — the row must keep every label on one line`,
      );
    }
  }
  return problems;
}

test.describe("landing header and price badge stay inside the viewport", () => {
  for (const target of PAGES) {
    test(`${target.label} fits every critical width`, async ({ page }) => {
      await page.setViewportSize({ width: VIEWPORT_WIDTHS[0], height: 800 });
      await gotoLanding(page, target.path, target.lang);

      const report: string[] = [];

      // The served page is the page we asked for, in the direction we asked for.
      const first = await measureHeader(page);
      expect(`${first.lang}/${first.dir}`, `${target.path}: served lang/dir`).toBe(
        `${target.lang}/${target.dir}`,
      );

      for (const width of VIEWPORT_WIDTHS) {
        await page.setViewportSize({ width, height: 800 });
        const snapshot = await measureHeader(page);
        // clientWidth excludes the scrollbar; compare against what the engine
        // reports rather than the requested width.
        for (const problem of headerViolations(snapshot, snapshot.viewportWidth)) {
          report.push(`@${width}px: ${problem}`);
        }
      }

      expect(report.join("\n"), `${target.label}: header violations`).toBe("");
    });
  }

  for (const target of PAGES_WITH_PRICING) {
    test(`${target.label} keeps every price badge inside its card`, async ({ page }) => {
      const report: string[] = [];
      await gotoLanding(page, target.path, target.lang);

      for (const width of [320, 360, 768, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        const cards = await measurePriceCards(page);
        let measured = 0;
        for (const card of cards) {
          for (const badge of card.badges) {
            measured += 1;
            if (badge.left < card.cardLeft - 1 || badge.right > card.cardRight + 1) {
              report.push(
                `@${width}px: badge "${badge.text}" leaves its card: [${badge.left}, ${badge.right}] vs card [${card.cardLeft}, ${card.cardRight}]`,
              );
            }
            if (badge.left < 0 || badge.right > width + 1) {
              report.push(
                `@${width}px: badge "${badge.text}" leaves the viewport: [${badge.left}, ${badge.right}]`,
              );
            }
          }
        }
        // No badge at a width means nothing was verified there: a page that
        // loses its pricing grid must fail this spec, not quietly satisfy it.
        expect(measured, `${target.label} @${width}px: no price badge to measure`).toBeGreaterThan(0);
      }

      expect(report.join("\n"), `${target.label}: badge violations`).toBe("");
    });
  }

  test("a plan carrying both badges stacks them instead of overlapping", async ({ page }) => {
    // No locale ships `badge` and `badgeEarly` on the same plan today, but the
    // template supports it and the CSS owns that path: the ribbon is the only
    // positioned ancestor, so two badges must stack inside the card.
    await page.setViewportSize({ width: 360, height: 900 });
    await gotoLanding(page, "/landing.html", "en");

    const cards = await page.evaluate(() => {
      const injected: { text: string; top: number; bottom: number; left: number; right: number }[][] =
        [];
      document.querySelectorAll(".price-card").forEach((card) => {
        const ribbon = card.querySelector(".price-badges");
        if (!ribbon || ribbon.querySelector(".badge.badge-early")) return;
        const early = document.createElement("span");
        early.className = "badge badge-early";
        early.textContent = "Early Bird — First 200 buyers";
        ribbon.appendChild(early);
        injected.push(
          Array.from(ribbon.querySelectorAll(".badge")).map((badge) => {
            const rect = badge.getBoundingClientRect();
            return {
              text: (badge.textContent ?? "").trim(),
              top: Math.round(rect.top),
              bottom: Math.round(rect.bottom),
              left: Math.round(rect.left),
              right: Math.round(rect.right),
            };
          }),
        );
      });
      return injected;
    });

    // The page must actually have a card with a badge ribbon to measure.
    expect(cards.length, "no price card exposed a badge ribbon to measure").toBeGreaterThan(0);

    const problems: string[] = [];
    cards.forEach((badges, index) => {
      for (const [position, badge] of badges.entries()) {
        const above = badges[position - 1];
        // The first badge has nothing stacked above it to overlap with.
        if (!above) continue;
        if (badge.top < above.bottom) {
          problems.push(
            `card ${index}: badge "${badge.text}" overlaps "${above.text}" (top ${badge.top} < previous bottom ${above.bottom})`,
          );
        }
      }
      const cardRect = badges.reduce(
        (acc, badge) => ({
          left: Math.min(acc.left, badge.left),
          right: Math.max(acc.right, badge.right),
        }),
        { left: Number.POSITIVE_INFINITY, right: Number.NEGATIVE_INFINITY },
      );
      if (cardRect.left < 0 || cardRect.right > 360 + 1) {
        problems.push(`card ${index}: badges leave the viewport [${cardRect.left}, ${cardRect.right}]`);
      }
    });

    expect(problems.join("\n"), "badges overlap or leave the viewport").toBe("");
  });

  test("the menu is reachable, fits, and closes with the keyboard on a phone", async ({ page }) => {
    const problems: string[] = [];
    await page.setViewportSize({ width: PHONE_WIDTH, height: 844 });

    for (const target of PAGES) {
      await gotoLanding(page, target.path, target.lang);

      const toggle = page.locator("#navToggle");
      const openLabel = await toggle.getAttribute("aria-label");
      const closeLabel = await toggle.getAttribute("data-label-close");

      await toggle.click();

      const opened = await page.evaluate(() => {
        const panel = document.getElementById("navLinks")!;
        const rect = panel.getBoundingClientRect();
        const links = Array.from(panel.querySelectorAll("a")).filter(
          (a) => a.getBoundingClientRect().height > 0,
        );
        return {
          expanded: document.getElementById("navToggle")!.getAttribute("aria-expanded"),
          label: document.getElementById("navToggle")!.getAttribute("aria-label"),
          isOpen: document.querySelector(".nav")!.classList.contains("is-open"),
          panelLeft: Math.round(rect.left),
          panelRight: Math.round(rect.right),
          reachableLinks: links.length,
          viewportWidth: document.documentElement.clientWidth,
        };
      });

      if (!opened.isOpen || opened.expanded !== "true") {
        problems.push(`${target.path}: menu did not open (is-open=${opened.isOpen}, aria-expanded=${opened.expanded})`);
      }
      if (opened.reachableLinks < 4) {
        problems.push(`${target.path}: only ${opened.reachableLinks} menu link(s) reachable — the phone menu must restore navigation`);
      }
      if (opened.panelLeft < -1 || opened.panelRight > opened.viewportWidth + 1) {
        problems.push(
          `${target.path}: panel leaves the viewport [${opened.panelLeft}, ${opened.panelRight}] vs 0..${opened.viewportWidth}`,
        );
      }
      // The accessible name has to describe the state it is in.
      if (opened.label !== closeLabel) {
        problems.push(`${target.path}: open menu is still announced as "${opened.label}" (expected "${closeLabel}")`);
      }

      await page.keyboard.press("Escape");

      const closed = await page.evaluate(() => ({
        expanded: document.getElementById("navToggle")!.getAttribute("aria-expanded"),
        label: document.getElementById("navToggle")!.getAttribute("aria-label"),
        isOpen: document.querySelector(".nav")!.classList.contains("is-open"),
        focusedToggle: document.activeElement === document.getElementById("navToggle"),
      }));

      if (closed.isOpen || closed.expanded !== "false") {
        problems.push(`${target.path}: Escape left the menu open (is-open=${closed.isOpen})`);
      }
      if (closed.label !== openLabel) {
        problems.push(`${target.path}: closed menu is announced as "${closed.label}" (expected "${openLabel}")`);
      }
      if (!closed.focusedToggle) {
        problems.push(`${target.path}: Escape did not return focus to the menu button`);
      }
    }

    expect(problems.join("\n"), "menu behaviour on a phone").toBe("");
  });

  test("crossing the breakpoint clears the open state", async ({ page }) => {
    await page.setViewportSize({ width: MENU_PANEL_MAX_WIDTH, height: 844 });
    await gotoLanding(page, "/landing.html", "en");

    await page.locator("#navToggle").click();
    expect(
      await page.locator("#navToggle").getAttribute("aria-expanded"),
      "menu must open below the breakpoint",
    ).toBe("true");

    // One pixel past the panel's breakpoint the inline row is back; a lingering
    // `.is-open` would ship the close icon and a trap state to desktop.
    await page.setViewportSize({ width: MENU_PANEL_MAX_WIDTH + 1, height: 900 });

    const afterResize = await page.evaluate(() => ({
      expanded: document.getElementById("navToggle")!.getAttribute("aria-expanded"),
      isOpen: document.querySelector(".nav")!.classList.contains("is-open"),
      toggleVisible: getComputedStyle(document.getElementById("navToggle")!).display !== "none",
      inlineLinks: Array.from(document.querySelectorAll(".nav-links > a")).filter(
        (a) => a.getBoundingClientRect().height > 0,
      ).length,
    }));

    expect(afterResize.expanded, "aria-expanded must be reset at desktop width").toBe("false");
    expect(afterResize.isOpen, ".nav must not keep is-open at desktop width").toBe(false);
    expect(afterResize.toggleVisible, "the menu button belongs to the panel widths only").toBe(false);
    expect(afterResize.inlineLinks, "the inline row must be back above the breakpoint").toBeGreaterThan(0);
  });
});


/**
 * One line per defect in one card's badge stack at one width. Box containment
 * is only half of it: `wrapDamage` is the contract a translation triggers,
 * where the badge stays inside its card and still breaks the card by growing
 * down onto the plan name.
 */
function badgeViolations(card: CardSnapshot, width: number): string[] {
  const problems: string[] = [];

  for (const badge of card.badges) {
    if (badge.left < card.cardLeft - 1 || badge.right > card.cardRight + 1) {
      problems.push(
        `badge "${badge.text}" leaves its card: [${badge.left}, ${badge.right}] vs card [${card.cardLeft}, ${card.cardRight}]`,
      );
    }
    if (badge.left < 0 || badge.right > width + 1) {
      problems.push(
        `badge "${badge.text}" leaves the viewport: [${badge.left}, ${badge.right}] vs 0..${width}`,
      );
    }
  }

  // The ribbon starts 12px ABOVE the card and the card body starts at its
  // 32px padding, so a badge stack taller than ~44px reaches the plan name
  // (measured: 1 line ≈ 24px, 2 lines ≈ 39px, 3 lines ≈ 55px). A translated
  // badge that wraps to a third line at a narrow width lands here.
  if (card.badges.length > 0) {
    const lowest = card.badges.reduce((acc, badge) => Math.max(acc, badge.bottom), Number.NEGATIVE_INFINITY);
    if (lowest > card.contentTop + 1) {
      problems.push(
        `badge stack (${card.badges.map((badge) => `"${badge.text}"`).join(" + ")}) lands on the plan ` +
          `name: lowest bottom ${lowest} > "${card.contentName}" top ${card.contentTop}`,
      );
    }
  }
  return problems;
}

test.describe("every generated locale keeps its header and badges inside the viewport", () => {
  test("the registry declares the 30 shipping locales, each with a generated page", () => {
    // A tripwire, not a mirror: locale 31 can be added freely, but the walk
    // must never quietly shrink because a generator rule changed.
    expect(
      LOCALE_LANDINGS.map((landing) => landing.code).length,
      "scripts/landing-registry.mjs declares fewer landing locales than the 30 that ship",
    ).toBeGreaterThanOrEqual(30);

    const missing = LOCALE_LANDINGS.filter((landing) => !existsSync(join("public", landing.file)));
    expect(
      missing.map((landing) => landing.file).join(", "),
      "locales declared by the registry have no generated page in public/",
    ).toBe("");
  });

  for (const landing of LOCALE_LANDINGS) {
    test(`locale=${landing.code}`, async ({ page }) => {
      const problems: string[] = [];
      await page.setViewportSize({ width: LOCALE_WALK_WIDTHS[0], height: 800 });
      await gotoLanding(page, landing.path, landing.code);

      // The served page is the page we asked for, in the direction we asked for.
      const served = await measureHeader(page);
      expect(`${served.lang}/${served.dir}`, `${landing.path}: served lang/dir`).toBe(
        `${landing.code}/${RTL_LANGS.has(landing.code) ? "rtl" : "ltr"}`,
      );

      let measuredBadges = 0;
      for (const width of LOCALE_WALK_WIDTHS) {
        await page.setViewportSize({ width, height: 800 });

        const header = await measureHeader(page);
        for (const problem of headerViolations(header, header.viewportWidth)) {
          problems.push(`@${width}px header: ${problem}`);
        }

        for (const card of await measurePriceCards(page)) {
          measuredBadges += card.badges.length;
          for (const problem of badgeViolations(card, width)) {
            problems.push(`@${width}px ${problem}`);
          }
        }
      }

      // A locale whose pricing grid vanished would satisfy every badge check
      // by measuring nothing; that is a red, not a pass.
      expect(
        measuredBadges,
        `${landing.code}: no price badge measured at any width — the pricing grid must exist on every locale`,
      ).toBeGreaterThan(0);

      expect(problems.join("\n"), `${landing.code}: header or badge broken by a translation`).toBe("");
    });
  }
});
