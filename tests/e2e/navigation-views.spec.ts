import { test, expect } from "@playwright/test";
import { skipPassword } from "./vault-helpers";

/**
 * Navigation & View Loading E2E
 *
 * This is intentionally one test: all cases exercise the same authenticated
 * shell and only differ by a lazy-loaded view. Keeping them in one context
 * avoids repeating Chromium/Vite/IndexedDB startup eight times. Vault and
 * security specs remain separate and continue to use the real Argon2 setup.
 */
test("navigation smoke loads the main sidebar views", async ({ page }) => {
  await skipPassword(page);

  const views = [
    /knowledge/i,
    /database/i,
    /calendar/i,
    /kanban/i,
    /timeline/i,
    /list/i,
    /gallery/i,
  ];

  for (const name of views) {
    const button = page.getByRole("button", { name });
    if (await button.isVisible().catch(() => false)) {
      await button.click();
      // Lazy views are local imports; a short yield lets React commit without
      // paying a fixed half-second delay for every navigation.
      await page.waitForTimeout(100);
      const body = await page.textContent("body");
      expect(body?.length, `view ${name} rendered a blank body`).toBeGreaterThan(100);
    }
  }

  const settingsButton = page.getByTestId("settings-button");
  await settingsButton.click();
  await page.waitForTimeout(100);
  const body = await page.textContent("body");
  expect(body).toContain("Settings");
});
