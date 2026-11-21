import { test, expect } from "@playwright/test";
import { setupVault, lockVault, unlockVault } from "./vault-helpers";

/**
 * vault-lock-button: the Header lock button locks the vault (accessible
 * confirmation modal accepted), then the correct password unlocks it again.
 */
test("lock button locks the vault and correct password unlocks it", async ({
  page,
}) => {
  await setupVault(page);

  await lockVault(page);

  // The vault stays locked after a reload; the lock flag is persisted in
  // localStorage and the database itself is exercised through Dexie.
  await page.reload();
  await expect(page.getByTestId("vault-locked-screen")).toBeVisible({
    timeout: 30_000,
  });

  await unlockVault(page);
});
