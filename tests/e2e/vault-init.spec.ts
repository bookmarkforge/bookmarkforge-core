import { test, expect } from "@playwright/test";
import { setupVault, expectUnlockedApp, VAULT_PASSWORD } from "./vault-helpers";

/**
 * vault-init: first-time setup flow. Pristine context (memory storage) →
 * SecurityConfirmation → recovery kit → master password → Create Vault →
 * unlocked MainApp shell.
 */
test("first-time setup creates a vault and unlocks the app", async ({ page }) => {
  await setupVault(page);

  // Unlocked shell is visible and the vault is usable.
  await expectUnlockedApp(page);

  // Revisit within the same context: the vault now has a master password,
  // so the lock screen (not the setup wizard) is shown.
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Vault is locked." }),
  ).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Master Password").fill(VAULT_PASSWORD);
  await page.getByRole("button", { name: "Unlock" }).click();
  await expectUnlockedApp(page);
});
