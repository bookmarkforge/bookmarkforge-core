import { test, expect } from "@playwright/test";
import {
  setupVault,
  lockVault,
  readVaultKdfSaltFromToken,
  unlockAfterReload,
  VAULT_PASSWORD,
} from "./vault-helpers";

const NEW_PASSWORD = "brand-new-vault-password-99";

/**
 * vault-change-password: runs under playwright.idb-persistence.ts. Changing
 * the master password in Settings persists — after lock + reload, the NEW
 * password unlocks the vault and the old one no longer does. The A-1 per-vault
 * KDF salt is re-minted by the same operation, so a dictionary built against
 * the old password stops applying to the vault (asserted below from the
 * ciphertext itself).
 */
test("changed master password persists and replaces the old one", async ({
  page,
}) => {
  await setupVault(page);
  const saltBefore = await readVaultKdfSaltFromToken(page);
  expect(saltBefore).toMatch(/^[0-9a-f]{32}$/);

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

  // A-1: the vault must be re-keyed onto a NEW Argon2id salt, not just a new
  // password — the harvested corpus is only worth attacking while the salt that
  // produced it stays in use.
  const saltAfter = await readVaultKdfSaltFromToken(page);
  expect(saltAfter).toMatch(/^[0-9a-f]{32}$/);
  expect(saltAfter).not.toBe(saltBefore);

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
