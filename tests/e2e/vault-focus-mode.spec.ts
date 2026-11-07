import { test, expect } from "@playwright/test";
import { setupVault, VAULT_PASSWORD } from "./vault-helpers";

/**
 * vault-focus-mode: the Omnibar (Ctrl+K) is an aria-modal dialog with a
 * keyboard focus trap — Tab cycles inside the dialog and never reaches the
 * page behind it; Escape closes it.
 */
test("omnibar traps focus and closes on Escape", async ({ page }) => {
  await setupVault(page);

  // Open the Omnibar via the Ctrl+K shortcut.
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: /search anything/i });
  await expect(dialog).toBeVisible({ timeout: 15_000 });

  // The search input receives focus on open.
  const input = page.getByRole("combobox", { name: /search anything/i });
  await expect(input).toBeFocused({ timeout: 5_000 });

  // Tab repeatedly — focus must stay within the dialog (focus trap).
  const dialogEl = dialog.locator("..");
  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press("Tab");
    const inside = await page.evaluate((sel) => {
      const active = document.activeElement;
      const container = document.querySelector(sel);
      return !!active && !!container && container.contains(active);
    }, `[role="dialog"]`);
    expect(inside).toBe(true);
  }

  // Escape closes the dialog and returns focus to the page.
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible({ timeout: 5_000 });
});
