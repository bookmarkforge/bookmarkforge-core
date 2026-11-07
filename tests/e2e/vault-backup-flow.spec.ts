import { test, expect } from "@playwright/test";
import { setupVault, unlockAfterReload, VAULT_PASSWORD } from "./vault-helpers";
import { seedProEntitlement } from "./pro-entitlement-helpers";

/**
 * vault-backup-flow: after first-time setup, the Home dashboard shows the
 * backup reminder banner; exporting a physical backup completes successfully
 * (success toast). The download event itself is not asserted — headless
 * blob downloads are flaky, but the completion toast is the UI contract.
 */
test("export backup from dashboard banner completes", async ({ page }) => {
  // keepBackupNotice: the banner IS this test's subject. Without the opt-out,
  // the fixture's generic "Got it, remind me later" click writes the 48 h
  // snooze (BACKUP_BANNER_DISMISSED_UNTIL) and the banner this test exercises
  // can never appear — the spec would pass while measuring nothing. Guarded
  // against future regressions by scripts/check-e2e-fixture-neutralization.mjs.
  await setupVault(page, { keepBackupNotice: true });
  // Export goes through BackupService (Pro-gated): seed the entitlement
  // through the real signing stack before exercising the banner flow.
  await seedProEntitlement(page);

  // Reload so the banner is exercised from a fresh boot (the tour stays out of
  // the way); the banner survives it because nothing snoozed it above.
  await page.evaluate(() => {
    localStorage.setItem("forge_welcome_tour_complete", "true");
  });
  await page.reload();
  await unlockAfterReload(page, VAULT_PASSWORD);

  // BackupReminderBanner appears on Home because no manual backup exists.
  const exportBtn = page.getByRole("button", {
    name: "Export Physical Backup File",
  });
  await expect(exportBtn).toBeVisible({ timeout: 30_000 });

  // The banner button uses hover:scale-105 / active:scale-95 transforms and
  // sits under a sticky header; Playwright's auto-click unstable-element
  // checks can misreport these as pointer interceptors even though the
  // control is genuinely visible and clickable. Invoke the accessible click
  // directly after the visibility assertion (same pattern as lockVault).
  await exportBtn.evaluate((el) => (el as HTMLButtonElement).click());

  // Success toast — "Backup complete" / fallback text.
  await expect(
    page.getByText(/backup.*(complete|successful|exported)|exported.*backup/i),
  ).toBeVisible({ timeout: 30_000 });
});

test("rejects a truncated backup without changing the vault", async ({ page }) => {
  await setupVault(page);

  const beforeCount = await page.evaluate(async () => {
    const { initDB } = await import("/src/db/database.ts");
    const db = await initDB();
    return db.bookmarks.count().exec();
  });

  await page.getByTestId("settings-button").click();
  const storage = page.getByTestId("settings-storage");
  await expect(storage).toBeVisible({ timeout: 15_000 });

  const fileInput = storage.locator('input[type="file"][accept=".json,.bmf"]');
  await fileInput.setInputFiles({
    name: "truncated-backup.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"bookmarks":[{"id":"partial"}'),
  });

  // Exact match on the error title — the looser regex also matched the
  // settings dialog wrapper that contains the message (strict-mode conflict).
  await expect(
    page.getByText("Error importing backup", { exact: true }),
  ).toBeVisible({ timeout: 15_000 });

  const afterCount = await page.evaluate(async () => {
    const { initDB } = await import("/src/db/database.ts");
    const db = await initDB();
    return db.bookmarks.count().exec();
  });
  expect(afterCount).toBe(beforeCount);
});
