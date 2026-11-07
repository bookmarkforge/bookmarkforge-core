/**
 * tests/e2e/landing-visual.spec.ts
 *
 * The landing's *appearance* contract, as opposed to its fit: the mobile header
 * and the price card carrying both badges, reviewed as pixels and as resolved
 * style properties.
 *
 * `tests/e2e/landing-responsive.spec.ts` measures boxes — nothing there notices
 * a badge that keeps its width while losing its brand accent, an open menu that
 * stops swapping the hamburger for a close cross, or a header that keeps
 * fitting while its divider and surface disappear. This file owns that half.
 *
 * ── WHY BOTH KINDS OF CHECK ────────────────────────────────────────────────
 *   1. STYLE PROPERTIES (run on every platform). The values are READ FROM THE
 *      BROWSER, not from the stylesheet: a probe element styled with
 *      `var(--accent-primary)` is compared against the badge's computed
 *      background, so a broken or renamed token fails here even though the CSS
 *      text still says the right thing. This is the half that has teeth on
 *      Linux CI today.
 *   2. PIXEL BASELINES (Windows-captured). The two committed PNGs are the
 *      artifact a reviewer looks at when a change is visual but not
 *      expressible as one property. They are what AGENTS.md §9 means by
 *      "regenerating baselines is an intentional act".
 *
 * ── THE PLATFORM BOUNDARY, STATED PLAINLY ──────────────────────────────────
 * Pixel baselines are captured on the platform that has a browser AND a
 * checkout: this one (win32). Playwright's default snapshot path carries the
 * platform token, so on Linux it looks for `-chromium-linux.png`, does not find
 * it and FAILS ("a snapshot doesn't exist"). Every runner in
 * .github/workflows is ubuntu-latest, so those baselines are compared on
 * Windows checkouts and skipped elsewhere — the same documented boundary
 * `tests/e2e/text-fit.spec.ts` carries, and for the same reason. The skip is
 * explicit and reasoned rather than a silent pass, and the debt is registered
 * as P-33 in docs/PENDIENTES.md (§3, verification gaps).
 *
 * To close it, capture the Linux variants on a Linux box (or the
 * `mcr.microsoft.com/playwright` image) with:
 *
 *   npx playwright test tests/e2e/landing-visual.spec.ts \
 *     --config=playwright.config.ts --project=chromium --update-snapshots
 *
 * and commit the resulting `*-chromium-linux.png` files next to the win32 ones;
 * then drop the skip below and the baselines are enforced in CI as well.
 *
 * ── DETERMINISM ────────────────────────────────────────────────────────────
 *   - the colour scheme is pinned to `light` (the landing reads
 *     `prefers-color-scheme` unless a theme is saved) and no theme is saved;
 *   - `stabilizeRender` waits for the self-hosted font and finite animations;
 *   - the reveal-on-scroll animation is waited out explicitly: the captured
 *     card starts at opacity 0 and only fades in once the observer fires, so a
 *     capture taken too early is a faded card, not a smaller diff;
 *   - the diff budget is ABSOLUTE (`maxDiffPixels`), not a ratio, because these
 *     captures are large and a ratio hides local change: measured on this
 *     checkout (2026-10-13, two forced captures with `-u=all`, pixelmatched) the
 *     run-to-run jitter is 0 px on both images, while enlarging the badge pill
 *     from 0.72rem to 0.95rem moves 7,839 px of the 755,520-px price capture
 *     (1.04%). A `maxDiffPixelRatio: 0.02` budget therefore PASSED that change;
 *     250 px (~31x below the signal, and still far above the jitter) fails it.
 *     The header capture is 329,160 px and the same budget applies.
 */
import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stabilizeRender } from "./text-fit-helpers";

/** The two committed pixel baselines (name arguments, without the PNG suffix). */
const HEADER_BASELINE = "landing-mobile-header-en";
const PRICE_BASELINE = "landing-price-badges-two-en";

/** Phone geometry: the header baseline is captured at the top of a phone view. */
const PHONE = { width: 390, height: 844 };

/** Narrow width where the pricing grid is a single column. */
const NARROW = { width: 360, height: 900 };

/** The second badge injected for the two-badge capture (no locale ships both). */
const SECOND_BADGE_TEXT = "Early Bird — First 200 buyers";

/** Playwright's default snapshot directory for this spec. */
const SNAPSHOT_DIR = join("tests", "e2e", "landing-visual.spec.ts-snapshots");

/** Where Playwright will look for a baseline on this platform/project. */
function baselinePath(name: string, info: TestInfo): string {
  return join(SNAPSHOT_DIR, `${name}-${info.project.name}-${process.platform}.png`);
}

/** Load the EN landing with a pinned theme and language, then settle it. */
async function openLanding(page: Page, size: { width: number; height: number }): Promise<void> {
  await page.addInitScript(() => {
    // Pin the served language and clear any saved theme, so the capture is the
    // default appearance rather than whatever the runner's OS prefers.
    window.localStorage.setItem("bf_lang", "en");
    window.localStorage.removeItem("bmf_landing_theme");
  });
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize(size);
  await page.goto("/landing.html", { waitUntil: "load" });
  await stabilizeRender(page);
}

/**
 * Wait until an element has been revealed (the landing fades its cards in from
 * `opacity: 0` when they scroll into view) and no animation is still running.
 */
async function revealAndSettle(page: Page, selector: string): Promise<void> {
  await page.locator(selector).first().scrollIntoViewIfNeeded();
  await page.waitForFunction(
    (target) => {
      const el = document.querySelector(target);
      if (!el) return false;
      const style = window.getComputedStyle(el);
      const running = document.getAnimations().filter((a) => a.playState === "running");
      return style.opacity === "1" && running.length === 0;
    },
    selector,
    { timeout: 15_000 },
  );
}

/** Add the `badgeEarly` badge the template supports but no locale ships yet. */
async function injectSecondBadge(page: Page): Promise<void> {
  const injected = await page.evaluate((text) => {
    const ribbon = document.querySelector(".price-card.popular .price-badges");
    if (!ribbon) return 0;
    const badge = document.createElement("span");
    badge.className = "badge badge-early";
    badge.textContent = text;
    ribbon.appendChild(badge);
    return ribbon.querySelectorAll(".badge").length;
  }, SECOND_BADGE_TEXT);
  expect(injected, "the popular card must expose a badge ribbon to extend").toBe(2);
}

/**
 * Resolved colour of a brand token, read from a probe element rather than from
 * the stylesheet, so `rgb()`/`color-mix()` shapes do not have to be parsed here.
 */
async function tokenColor(page: Page, token: string): Promise<string> {
  return page.evaluate((value) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${value})`;
    probe.style.display = "none";
    document.body.appendChild(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    return resolved;
  }, token);
}

test.describe("landing appearance: resolved style properties (every platform)", () => {
  test("the open mobile menu swaps the hamburger for a close cross", async ({ page }) => {
    await openLanding(page, PHONE);

    const closed = await page.evaluate(() => ({
      menu: getComputedStyle(document.querySelector(".nav-toggle .icon-menu")!).display,
      close: getComputedStyle(document.querySelector(".nav-toggle .icon-close")!).display,
    }));
    expect(closed.menu, "closed header must show the hamburger").not.toBe("none");
    expect(closed.close, "closed header must not show the close cross").toBe("none");

    await page.locator("#navToggle").click();

    const opened = await page.evaluate(() => ({
      menu: getComputedStyle(document.querySelector(".nav-toggle .icon-menu")!).display,
      close: getComputedStyle(document.querySelector(".nav-toggle .icon-close")!).display,
    }));
    expect(opened.menu, "open header must hide the hamburger").toBe("none");
    expect(opened.close, "open header must show the close cross").not.toBe("none");
  });

  test("the menu panel keeps its surface, divider and link rhythm", async ({ page }) => {
    await openLanding(page, PHONE);
    await page.locator("#navToggle").click();
    await revealAndSettle(page, "#navLinks");

    const surface = await tokenColor(page, "--bg-primary");
    const divider = await tokenColor(page, "--divider");

    const panel = await page.evaluate(() => {
      const el = document.getElementById("navLinks")!;
      const style = getComputedStyle(el);
      const links = Array.from(el.querySelectorAll("a"));
      return {
        background: style.backgroundColor,
        borderBottomColor: style.borderBottomColor,
        borderBottomWidth: style.borderBottomWidth,
        flexDirection: style.flexDirection,
        linkPadding: links.length > 0 ? getComputedStyle(links[0]!).paddingTop : null,
        linkFontSize: links.length > 0 ? getComputedStyle(links[0]!).fontSize : null,
      };
    });

    expect(panel.background, "panel surface must be the page background token").toBe(surface);
    expect(panel.borderBottomColor, "panel divider must be the divider token").toBe(divider);
    expect(panel.borderBottomWidth, "panel keeps its 1px divider").toBe("1px");
    expect(panel.flexDirection, "panel links stack vertically on a phone").toBe("column");
    // The phone panel gives each link a tappable rhythm instead of the desktop
    // 8px/16px inline row.
    expect(panel.linkPadding, "panel links need the larger tap padding").toBe("12px");
    expect(panel.linkFontSize, "panel links step up to 1rem").toBe("16px");
  });

  test("the price badge keeps the brand accent, its pill shape and the stack offset", async ({
    page,
  }) => {
    await openLanding(page, NARROW);
    await revealAndSettle(page, ".price-card.popular");
    await injectSecondBadge(page);

    const accent = await tokenColor(page, "--accent-primary");

    const badge = await page.evaluate(() => {
      const ribbon = document.querySelector(".price-card.popular .price-badges")!;
      const ribbonStyle = getComputedStyle(ribbon);
      const badges = Array.from(ribbon.querySelectorAll(".badge"));
      return {
        ribbonTop: ribbonStyle.top,
        ribbonGap: ribbonStyle.gap,
        ribbonFlexDirection: ribbonStyle.flexDirection,
        ribbonAlignItems: ribbonStyle.alignItems,
        badges: badges.map((el) => {
          const style = getComputedStyle(el);
          return {
            background: style.backgroundColor,
            color: style.color,
            borderRadius: style.borderRadius,
            fontWeight: style.fontWeight,
            whiteSpace: style.whiteSpace,
          };
        }),
      };
    });

    expect(badge.badges.length, "both badges must be present for this check").toBe(2);
    for (const [index, value] of badge.badges.entries()) {
      expect(value.background, `badge ${index} background must be the accent token`).toBe(accent);
      expect(value.borderRadius, `badge ${index} is a pill`).toBe("999px");
      expect(value.fontWeight, `badge ${index} keeps the bold weight`).toBe("700");
      // The unbreakable rule is what let a translated badge run past its card.
      expect(value.whiteSpace, `badge ${index} must be allowed to wrap`).toBe("normal");
    }
    expect(badge.ribbonTop, "the ribbon keeps its -12px overhang").toBe("-12px");
    expect(badge.ribbonGap, "stacked badges keep the 6px gap").toBe("6px");
    expect(badge.ribbonFlexDirection, "badges stack in one column").toBe("column");
    expect(badge.ribbonAlignItems, "badges stay centred in the ribbon").toBe("center");
  });
});

test.describe("landing appearance: committed pixel baselines", () => {
  // See the file header: the PNGs are captured on win32 and Playwright looks
  // for a platform-suffixed file, so elsewhere this is skipped explicitly
  // instead of failing on a baseline that was never captured. The resolved
  // style contract above still runs everywhere.
  test.skip(
    process.platform !== "win32",
    "landing baselines are committed for chromium-win32 only; capture the -chromium-linux set (see file header) before running this part on Linux",
  );

  // Serial on purpose: these captures share one dev server, and the last test
  // reads the two PNGs the first two write — running them in parallel let the
  // reader start before the files existed (observed ENOENT on the first
  // --update-snapshots run).
  test.describe.configure({ mode: "serial" });

  test("the mobile header with the menu open matches its baseline", async ({ page }) => {
    await openLanding(page, PHONE);
    await page.locator("#navToggle").click();
    await revealAndSettle(page, "#navLinks");

    await expect(page).toHaveScreenshot(`${HEADER_BASELINE}.png`, {
      maxDiffPixels: 250,
    });
  });

  test("the price card carrying both badges matches its baseline", async ({ page }) => {
    await openLanding(page, NARROW);
    await revealAndSettle(page, ".price-card.popular");
    await injectSecondBadge(page);
    await revealAndSettle(page, ".price-card.popular");

    // The ribbon is positioned 12px ABOVE the card's top edge on purpose, so an
    // element capture of the card would clip the very thing this baseline is
    // about; the grid box contains the overhang and is captured instead.
    await expect(page.locator(".pricing-cards")).toHaveScreenshot(`${PRICE_BASELINE}.png`, {
      maxDiffPixels: 250,
    });
  });

  test("the two baselines are distinct captures", async ({}, testInfo) => {
    // AGENTS.md §9: two views sharing a byte-identical baseline is a bug
    // (previously found: bookmark-list-empty == main-app-layout). Both of these
    // captures used to be at risk of degenerating into "the same page top".
    const header = readFileSync(baselinePath(HEADER_BASELINE, testInfo));
    const price = readFileSync(baselinePath(PRICE_BASELINE, testInfo));
    expect(header.length, "header baseline must not be empty").toBeGreaterThan(0);
    expect(price.length, "price baseline must not be empty").toBeGreaterThan(0);
    expect(
      header.equals(price),
      "the header and price-card baselines must be different images",
    ).toBe(false);
  });
});
