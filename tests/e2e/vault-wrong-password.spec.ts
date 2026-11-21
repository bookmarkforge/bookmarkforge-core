import { test, expect } from "@playwright/test";
import {
  setupVault,
  lockVault,
  unlockExpectingError,
  VAULT_PASSWORD,
} from "./vault-helpers";

/**
 * vault-wrong-password: a wrong master password must surface the localized
 * error banner and keep the vault locked; the correct password then unlocks.
 */
test("wrong password shows error and keeps the vault locked", async ({ page }) => {
  await setupVault(page);
  await lockVault(page);

  await unlockExpectingError(page, "definitely-not-the-password");

  // Vault is still locked after the failed attempt.
  await expect(
    page.getByRole("heading", { name: "Vault is locked." }),
  ).toBeVisible();

  // The correct password recovers from the error state.
  await page.getByLabel("Master Password").fill(VAULT_PASSWORD);
  await page.getByRole("button", { name: "Unlock" }).click();
  await expect(page.getByTestId("settings-button")).toBeVisible({
    timeout: 30_000,
  });
});
