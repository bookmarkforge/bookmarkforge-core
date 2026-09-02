/**
 * tests/e2e/text-fit.nightly.spec.ts
 *
 * Cross-locale text-fit smoke gate — **nightly** scope.
 *
 * Mirror of `tests/e2e/text-fit.spec.ts` over the 24 locales NOT
 * included in the critical every-CI gate. Per-locale set is sourced
 * from `loadLocaleCodes("nightly")` (see
 * `src/constants/locales.ts`), which derives
 * `NIGHTLY_LOCALE_CODES = SUPPORTED - CRITICAL` at module init so a
 * future addition to the canonical `SUPPORTED_LANGUAGES` is picked up
 * automatically with no second list to keep in sync.
 *
 * Walks the same five key views as the critical spec plus five nightly-only
 * views (editor, chat, canvas, collaboration, onboarding) and a
 * narrow-viewport pass for de + fi, with the same
 * per-locale aggregation (overflow rows collected per view, asserted
 * ONCE at the end — all violations + all offsets in one block):
 *
 *   1. lock-screen        — pre-unlock SecurityConfirmation
 *   2. dashboard          — HomeDashboard at `/app`
 *   3. bookmark-list      — BookmarksTable at `/bookmarks`, POPULATED
 *                          with 8 pathological bookmarks (500-char
 *                          titles, 2000-char URLs, Unicode tags)
 *                          injected directly into IndexedDB (no UI).
 *   4. bookmark-filters   — same table after toggling a Unicode tag
 *                          chip (collapses to a 3-row subset).
 *   5. settings-panel     — Mantine modal opened via `settings-button`
 *
 * Pixel baselines are captured for a single visual-backstop locale only
 * (`fi`: all views incl. narrow; see `VISUAL_BACKSTOP_LOCALES`) as
 * `text-fit-{view}-{locale}.png` in
 * `tests/e2e/text-fit.nightly.spec.ts-snapshots/` — Playwright namespaces
 * by spec filename so the snapshots do NOT collide with the critical
 * spec's baselines. All 24 locales still run the authoritative DOM
 * overflow audit.
 *
 * Why a separate dev-server port (5175): the dedicated
 * `playwright.nightly.config.ts` boots its own Vite so a nightly run
 * cannot contend with the every-CI critical run on port 5173 when
 * both workflows execute back-to-back in the same time window.
 *
 * Run while the dev server is up:
 *   `npm run e2e:nightly` (= `playwright test --config playwright.nightly.config.ts`)
 */
import { test, expect, type Page } from "@playwright/test";
import {
  assertAggregatedOverflow,
  auditViewRows,
  loadLocaleCodes,
  PATHOLOGICAL_TAGS,
  seedLocale,
  seedPathologicalBookmarks,
  stabilizeRender,
  type LocaleCode,
  type ViewAudit,
  type ViewId,
} from "./text-fit-helpers";
import { dismissOverlays, skipPassword } from "./vault-helpers";

/**
 * Visual-backstop policy (ADR-030 note / 2026-09 audit):
 *
 * The pixel screenshots here are a VISUAL BACKSTOP, NOT the gate. The
 * authoritative check is the DOM overflow audit (`assertAggregatedOverflow`),
 * which walks every visible element and reports overflow + pixel offset;
 * it runs for ALL 24 nightly locales. A layout break (element off-canvas,
 * collapsed columns, missing glyph band) breaks EVERY locale's screenshot
 * equally — so capturing the same 9 views × 24 locales stores 17 MB of PNGs
 * without adding coverage, while making fresh-checkout runs fragile when the
 * matrix drifts.
 *
 * Per the audit, only ONE locale gets pixel captures as the backstop:
 * `fi` was chosen because it already has the complete tracked set — 9
 * desktop views + all 4 narrow-viewport captures — so the trimmed set
 * requires zero regeneration and still parks a pixel on every view,
 * including the nightly-only views (editor, chat, canvas, collaboration)
 * that exist in no other suite. The other 23 locales run the DOM audit and
 * deliberately skip the screenshot.
 *
 * Real visual-regression coverage for shared views stays in
 * `tests/e2e/visual-testing.spec.ts` (every-CI, pixelmach) and the
 * critical-scope `text-fit.spec.ts`; the drift gate
 * (`npm run check:baseline-drift`, ci.yml `visual-baseline-drift`) fails
 * if a remaining baseline is ever regenerated with >10% pixel drift.
 */
const VISUAL_BACKSTOP_MAX_DIFF_RATIO = 0.05;
const VISUAL_BACKSTOP_LOCALES: ReadonlySet<LocaleCode> = new Set(["fi"]);

async function captureBaselineAndCollect(
  page: Page,
  locale: LocaleCode,
  view: ViewId,
  nameSuffix = "",
): Promise<ViewAudit> {
  // Stabilize the render BEFORE the DOM audit (and baseline capture when
  // this locale is the visual backstop): wait for the self-hosted font +
  // finite entrance animations to settle, and (for the settings modal) for
  // async spinner-gated sections to load. Fixes intermittent snapshot
  // pixel diffs under parallel load without masking content.
  await stabilizeRender(page, { waitSpinners: view === "settings-panel" });
  if (VISUAL_BACKSTOP_LOCALES.has(locale)) {
    // Playwright auto-places the baseline in
    // `tests/e2e/text-fit.nightly.spec.ts-snapshots/text-fit-${view}-${locale}.png`.
    // The name is just a NAME — passing a directory prefix would create
    // a nested re-run mismatch on subsequent runs. Narrow-viewport
    // passes pass a `-narrow` suffix so their 360px captures never
    // collide with the 1280px desktop baselines of the same views.
    await expect(page).toHaveScreenshot(
      `text-fit-${view}-${locale}${nameSuffix}.png`,
      { maxDiffPixelRatio: VISUAL_BACKSTOP_MAX_DIFF_RATIO },
    );
  }
  const rows = await auditViewRows(page, locale, view);
  return { view, rows };
}

test.describe("Text fit / overflow across locales (nightly)", () => {
  for (const locale of loadLocaleCodes("nightly")) {
    test(`locale=${locale}`, async ({ page }) => {
      // Per-view audit rows accumulate; the SINGLE final assertion (all
      // violations + all offsets in one block) runs at the bottom.
      const audits: ViewAudit[] = [];

      // ------ 1. Lock screen -----------------------------------------
      await seedLocale(page, locale);
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading").first()).toBeVisible({
        timeout: 30_000,
      });
      audits.push(
        await captureBaselineAndCollect(page, locale, "lock-screen"),
      );

      // ------ 2. Dashboard -------------------------------------------
      await skipPassword(page);
      await dismissOverlays(page);
      await expect(page.getByTestId("settings-button")).toBeVisible({
        timeout: 30_000,
      });
      audits.push(await captureBaselineAndCollect(page, locale, "dashboard"));

      // ------ 3. Seed pathological bookmarks (direct IndexedDB) -------
      await seedPathologicalBookmarks(page, { count: 8 });

      // ------ 4. Bookmark list (populated) ---------------------------
      // Stay inside the unlocked SPA. A hard navigation would recreate the
      // security store and correctly return to the lock screen because
      // skip-password is intentionally session-only.
      await page.locator('[data-tab-id="bookmarks"]').click();
      await expect(page.getByTestId("bookmarks-virtual-list")).toBeVisible({
        timeout: 30_000,
      });
      // Virtualized table — wait for the deterministic row count.
      await expect(
        page.getByTestId("bookmarks-virtual-list").getByRole("listitem"),
      ).toHaveCount(8, { timeout: 30_000 });
      audits.push(
        await captureBaselineAndCollect(page, locale, "bookmark-list"),
      );

      // ------ 4b. Tag filter stress ----------------------------------
      await page.getByTestId(`tag-filter-${PATHOLOGICAL_TAGS[1]}`).click();
      await expect(
        page.getByTestId("bookmarks-virtual-list").getByRole("listitem"),
      ).toHaveCount(3, { timeout: 10_000 });
      audits.push(
        await captureBaselineAndCollect(page, locale, "bookmark-filters"),
      );

      // ------ 5. Settings panel (Mantine modal) ----------------------
      // Return to the dashboard through the SPA as well; hard navigation
      // would recreate the intentionally session-only security state.
      await page.locator('[data-tab-id="dashboard"]').click();
      await expect(page.getByTestId("settings-button")).toBeVisible({
        timeout: 30_000,
      });
      await page.getByTestId("settings-button").click();
      await expect(
        page.locator('[aria-labelledby="settings-dialog-title"]'),
      ).toBeVisible({ timeout: 10_000 });
      audits.push(
        await captureBaselineAndCollect(page, locale, "settings-panel"),
      );

      // Close settings modal to continue navigation
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);

      // ------ 6. Editor (documents tab → new document) -----------------
      // Locale-independent testids: the button label is translated in
      // every nightly locale (e.g. fi "Uusi Asiakirja"), so matching by
      // English text would never resolve outside the critical set.
      await page.locator('[data-tab-id="documents"]').click();
      await expect(
        page.getByTestId("new-document-button"),
      ).toBeVisible({ timeout: 15_000 });
      await page.getByTestId("new-document-button").click();
      await expect(
        page.locator('[data-testid="block-editor"]'),
      ).toBeVisible({ timeout: 15_000 });
      await stabilizeRender(page, { waitSpinners: false });
      audits.push(
        await captureBaselineAndCollect(page, locale, "editor"),
      );

      // ------ 7. Chat (chatLocal tab) ----------------------------------
      await page.locator('[data-tab-id="chatLocal"]').click();
      await expect(
        page.getByTestId("chat-input"),
      ).toBeVisible({ timeout: 15_000 });
      await stabilizeRender(page, { waitSpinners: false });
      audits.push(
        await captureBaselineAndCollect(page, locale, "chat"),
      );

      // ------ 8. Canvas -------------------------------------------------
      await page.locator('[data-tab-id="canvas"]').click();
      await expect(
        page.getByTestId("canvas-view"),
      ).toBeVisible({ timeout: 15_000 });
      audits.push(
        await captureBaselineAndCollect(page, locale, "canvas"),
      );

      // ------ 9. Collaboration -----------------------------------------
      await page.locator('[data-tab-id="collaboration"]').click();
      await expect(
        page.getByRole("heading", { level: 2 }).first(),
      ).toBeVisible({ timeout: 15_000 });
      audits.push(
        await captureBaselineAndCollect(page, locale, "collaboration"),
      );

      // ------ 10. Aggregated assertion: ALL violations + ALL offsets ---
      assertAggregatedOverflow(locale, audits);
    });

    // ------ 11. Narrow viewport (360px mobile) smoke for de + fi -------
    test(`locale=${locale} @viewport-narrow`, async ({ page }) => {
      if (locale !== "de" && locale !== "fi") {
        // Only run narrow-viewport on the most overflow-prone locales
        test.skip();
      }

      await page.setViewportSize({ width: 360, height: 740 });

      const audits: ViewAudit[] = [];

      await seedLocale(page, locale);
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading").first()).toBeVisible({
        timeout: 30_000,
      });
      audits.push(
        await captureBaselineAndCollect(page, locale, "lock-screen", "-narrow"),
      );

      await skipPassword(page);
      await dismissOverlays(page);
      await expect(page.getByTestId("settings-button")).toBeVisible({
        timeout: 30_000,
      });
      audits.push(
        await captureBaselineAndCollect(page, locale, "dashboard", "-narrow"),
      );

      // Seed + bookmark list at narrow width. The sidebar is `hidden`
      // below the md breakpoint (768px), so navigate through the mobile
      // BottomNav instead.
      await seedPathologicalBookmarks(page, { count: 8 });
      await page
        .locator('[data-testid="bottom-nav"] [data-bottom-nav-tab="bookmarks"]')
        .click();
      await expect(
        page.getByTestId("bookmarks-virtual-list"),
      ).toBeVisible({ timeout: 30_000 });
      await expect(
        page.getByTestId("bookmarks-virtual-list").getByRole("listitem"),
      ).toHaveCount(8, { timeout: 30_000 });
      audits.push(
        await captureBaselineAndCollect(page, locale, "bookmark-list", "-narrow"),
      );

      // Settings modal at narrow width
      await page
        .locator('[data-testid="bottom-nav"] [data-bottom-nav-tab="dashboard"]')
        .click();
      await expect(page.getByTestId("settings-button")).toBeVisible({
        timeout: 30_000,
      });
      await page.getByTestId("settings-button").click();
      await expect(
        page.locator('[aria-labelledby="settings-dialog-title"]'),
      ).toBeVisible({ timeout: 10_000 });
      audits.push(
        await captureBaselineAndCollect(page, locale, "settings-panel", "-narrow"),
      );

      assertAggregatedOverflow(locale, audits);
    });
  }
});
