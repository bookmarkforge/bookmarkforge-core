import { test, expect } from "@playwright/test";
import { setupVault, unlockAfterReload, VAULT_PASSWORD } from "./vault-helpers";

/**
 * vault-theme-switch: runs under playwright.idb-persistence.ts. The theme
 * preference persists (zustand persist → localStorage) — after a reload the
 * same data-theme attribute is applied.
 */
test("theme choice persists across reload", async ({ page }) => {
  await setupVault(page);

  const toggle = page.getByTestId("theme-toggle");
  await expect(toggle).toBeVisible({ timeout: 30_000 });
  await toggle.click();

  // Read the applied theme after the first click.
  const themeAfterClick = await page.evaluate(() =>
    document.documentElement.getAttribute("data-theme"),
  );

  await page.reload();
  // The vault relocks after reload — unlock before asserting the theme.
  await unlockAfterReload(page, VAULT_PASSWORD);
  await expect(toggle).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.getAttribute("data-theme")), {
      timeout: 10_000,
    })
    .toBe(themeAfterClick);
});
