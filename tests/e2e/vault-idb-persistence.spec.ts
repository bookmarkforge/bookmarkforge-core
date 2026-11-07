import { test, expect } from "@playwright/test";
import { setupVault, unlockAfterReload, VAULT_PASSWORD } from "./vault-helpers";
import { humanE2E } from "./human-behavior";

/**
 * vault-idb-persistence runs with VITE_FORCE_DEXIE_STORAGE and exercises
 * real IndexedDB. A Quick Capture note is written
 * to the database; after a full reload the vault still holds it — the
 * document appears again in the Documents list.
 */
test("captured note survives a reload", async ({ page }) => {
  await setupVault(page);
  const human = humanE2E(page);

  // Open Quick Capture and save a plain-text note (no URL → no network).
  await human.click(page.getByRole("button", { name: "Open quick capture" }));
  await human.type(
    page.getByTestId("quick-capture-input"),
    "persistence-check-note-42",
  );
  await human.click(page.getByRole("button", { name: "Submit capture" }));

  // Success toast confirms the write completed.
  await expect(
    page.getByText(/note captured and processed/i),
  ).toBeVisible({ timeout: 30_000 });

  // Full reload — the vault relocks, then unlocks with the same password.
  await page.reload();
  await unlockAfterReload(page, VAULT_PASSWORD);

  // Navigate to Documents and verify the note is still there.
  // exact:true avoids the bento-card button whose accessible name also
  // starts with "Documents" (strict-mode violation).
  await page
    .getByRole("button", { name: "Documents", exact: true })
    .click();
  await expect(
    page.getByText("persistence-check-note-42", { exact: false }),
  ).toBeVisible({ timeout: 30_000 });
});
