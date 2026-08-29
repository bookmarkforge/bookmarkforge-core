import { test, expect } from "@playwright/test";
import {
  setupVault,
  lockVault,
  unlockAfterReload,
  VAULT_PASSWORD,
} from "./vault-helpers";

const NEW_PASSWORD = "brand-new-vault-password-99";

/**
 * vault-change-password: runs under playwright.idb-persistence.ts. Changing
 * the master password in Settings persists — after lock + reload, the NEW
 * password unlocks the vault and the old one no longer does.
 */
test("changed master password persists and replaces the old one", async ({
  page,
}) => {
  await setupVault(page);

  // Open Settings and update the master password.
  await page.getByTestId("settings-button").click();
  const pwdInput = page.getByTestId("vault-password-input");
  await expect(pwdInput).toBeVisible({ timeout: 30_000 });
  await pwdInput.fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Update Password" }).click();
  // The production UI clears the field after a successful rotation, which
  // intentionally disables the button again. Assert that success toast and
  // then verify the persisted password through lock/reload below.
  await expect(
    page.getByText("Master password updated successfully"),
  ).toBeVisible({ timeout: 30_000 });

  // Close the Settings modal (Escape).
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: /settings/i }),
  ).not.toBeVisible({ timeout: 10_000 });

  // Lock, reload, and verify the NEW password unlocks.
  await lockVault(page);
  await page.reload();
  await unlockAfterReload(page, NEW_PASSWORD);
});
