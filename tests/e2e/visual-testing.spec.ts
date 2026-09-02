import { test, expect, type Page } from "@playwright/test";
import { skipPassword, dismissOverlays } from "./vault-helpers";

/**
 * Pre-seed overlay state so transient UI (WelcomeTour guided tour, the
 * once-per-day QuickTips tip) never renders during screenshots. Escape-based
 * dismissals are unreliable here: the tour mounts ~800ms after AppContent
 * renders and settings-button is visible regardless, so dismissOverlays
 * returns too early. Pre-seeding storage before the app boots keeps the
 * screenshots deterministic.
 */
async function disableTransientOverlays(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // WelcomeTour: never render the guided tour overlay.
    window.localStorage.setItem("forge_welcome_tour_complete", "true");
    // QuickTips: the dashboard tip shows once per day per context and would
    // appear in screenshots nondeterministically. Mark today's tip as shown
    // so the overlay never renders.
    window.localStorage.setItem(
      `forge_tip_shown_${new Date().toDateString()}`,
      "true",
    );
    window.localStorage.setItem("forge_dismissed_tips", "[]");
  });
}

test.describe("Visual Regression Testing", () => {
  test("vault lock screen visual consistency", async ({ page }) => {
    // Navigate to app without unlocking to see the lock screen
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Secure your vault" }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveScreenshot("vault-lock-screen.png", {
      // Tolerate sub-pixel rendering fluctuations (antialiasing, sync status
      // pill) without masking real regressions, which shift far more pixels.
      maxDiffPixelRatio: 0.05,
    });
  });

  test("main app layout visual consistency", async ({ page }) => {
    // Disable transient overlays before the app boots so the screenshot
    // captures the app shell deterministically.
    await disableTransientOverlays(page);
    // Skip password and go to main app
    await skipPassword(page);
    await dismissOverlays(page);
    await expect(page).toHaveScreenshot("main-app-layout.png", {
      // Tolerate font fallback timing, dynamic content, and React concurrent
      // rendering differences without masking real regressions (which shift
      // 10%+ of pixels).
      maxDiffPixelRatio: 0.05,
    });
  });

  test("settings panel visual consistency", async ({ page }) => {
    // Disable transient overlays before the app boots so the tour/tip never
    // covers the settings panel.
    await disableTransientOverlays(page);
    // Skip password and open settings
    await skipPassword(page);
    await dismissOverlays(page);
    await page.getByTestId("settings-button").click();
    // The Settings component is a lazy chunk; on first open the modal mounts
    // asynchronously. Wait for it so the screenshot captures the panel itself
    // instead of racing the chunk load (which previously produced a "Loading…"
    // splash baseline — byte-identical "passes" that never showed the panel).
    await expect(
      page.locator('[aria-labelledby="settings-dialog-title"]'),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveScreenshot("settings-panel.png", {
      // The sync-status pill races between "Connecting…" / "Disconnected";
      // 5% tolerance absorbs this transient state without masking real
      // regressions.
      maxDiffPixelRatio: 0.05,
    });
  });

  test("bookmark list empty state visual", async ({ page }) => {
    // Disable transient overlays before the app boots.
    await disableTransientOverlays(page);
    // Skip password to see empty bookmark list
    await skipPassword(page);
    await dismissOverlays(page);
    await expect(page).toHaveScreenshot("bookmark-list-empty.png", {
      // Tolerate font fallback timing and rendering differences without
      // masking real regressions.
      maxDiffPixelRatio: 0.05,
    });
  });

  test("search interface visual consistency", async ({ page }) => {
    // Disable transient overlays before the app boots so the screenshot
    // captures the search interface deterministically.
    await disableTransientOverlays(page);
    // Skip password to unlock vault
    await skipPassword(page);
    await dismissOverlays(page);
    // Navigate to bookmarks (stays in SPA, avoids full reload). The sidebar
    // and bottom-nav items are <button>s, not links, so target the
    // data-tab-id attribute instead of getByRole("link") — the reason this
    // test was originally skipped.
    await page.locator('[data-tab-id="bookmarks"]').first().click();
    // Wait for the search input to be visible using placeholder text
    const searchInput = page.getByPlaceholder(/search by title/i).first();
    await searchInput.waitFor({ state: "visible", timeout: 30_000 });
    await searchInput.fill("test");
    await expect(page).toHaveScreenshot("search-interface.png", {
      // Tolerate font fallback timing and rendering differences without
      // masking real regressions.
      maxDiffPixelRatio: 0.05,
    });
  });
});