import { test, expect } from "@playwright/test";
import { hash } from "node:crypto";
import { setupVault, unlockVault } from "./vault-helpers";
import { seedProEntitlement } from "./pro-entitlement-helpers";

/**
 * vault-recovery-restore — F0-2 end to end.
 *
 * After first-time setup the vault is empty, so the onboarding wizard opens
 * on the restore-first recovery screen. Restoring a plain `.json` backup
 * must replace the empty vault and make the imported data visible in the
 * bookmarks panel — no new blank vault is created silently.
 *
 * The backup file is a minimal-but-valid unversioned envelope: the importer
 * accepts a flat `{ bookmarks: [...] }` object (validateBackupEnvelope),
 * and each bookmark only needs the schema's required fields.
 */
test("empty vault → recovery screen → restore from file → data visible", async ({
  page,
}) => {
  // Capture app-side errors so a restore failure reports the root cause
  // instead of a bare "toast never appeared" timeout.
  const appErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {appErrors.push(msg.text());}
  });
  page.on("pageerror", (err) => appErrors.push(err.message));

  // Keep the onboarding wizard open so the recovery screen is what we assert
  // against (setupVault otherwise auto-dismisses it).
  await setupVault(page, { dismissOnboarding: false });

  // Restore goes through BackupService (Pro-gated): seed the entitlement on
  // the already-loaded page — no navigation, the wizard must stay open.
  await seedProEntitlement(page);

  // F0-2: the empty vault opens the wizard on the restore-first screen.
  await expect(
    page.getByRole("heading", { name: "Your vault is empty" }),
  ).toBeVisible({ timeout: 30_000 });

  // Restore via the hidden file input inside the onboarding dialog
  // (same interaction the real button triggers, without the native chooser).
  const dialog = page.locator('[aria-labelledby="onboarding-dialog-title"]');
  const fileInput = dialog.locator('input[type="file"][accept=".json,.bmf"]');
  await expect(fileInput).toBeAttached();

  // `setInputFiles()` dispatches the change event but does not await the
  // component's async handler. The successful handler calls
  // `window.location.reload()` only after importBackup resolves, so wait for
  // the NEXT load event explicitly; otherwise the old unlocked shell remains
  // visible behind the onboarding modal and the test can race the reload.
  const reload = page.waitForEvent("load", { timeout: 30_000 });
  await fileInput.setInputFiles({
    name: "bookmarkforge-restore.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        bookmarks: [
          {
            id: "e2e-restore-bookmark-1",
            url: "https://example.com/restored",
            // `urlHash` is required by the current bookmark schema and is
            // emitted by real exports. Omitting it makes RxDB reject the
            // imported row, which was the original false diagnosis of a
            // restore/reload product failure.
            urlHash: hash("sha256", "https://example.com/restored"),
            title: "Restored Bookmark E2E",
            processed: true,
            isPrivate: false,
            isDeleted: false,
            createdAt: "2026-08-16T00:00:00.000Z",
            updatedAt: "2026-08-16T00:00:00.000Z",
          },
        ],
      }),
    ),
  });
  await reload;

  // Success path reloads immediately. A password-protected vault returns to
  // the lock screen, while a passwordless first-run vault returns to the
  // security confirmation screen. Wait for either before continuing.
  const successGate = page.locator(
    '[aria-labelledby="security-confirmation-title"]',
  );
  const lockedScreen = page.getByTestId("vault-locked-screen");
  const settingsButton = page.getByTestId("settings-button");
  const errorToast = page.getByText(
    "Could not restore the backup. Check the file and password.",
  );
  await expect(
    successGate.or(lockedScreen).or(settingsButton),
  ).toBeVisible({ timeout: 30_000 });
  expect(
    await errorToast.isVisible(),
    `restore failed. app errors:\n${appErrors.join("\n")}`,
  ).toBe(false);

  if (await lockedScreen.isVisible().catch(() => false)) {
    await unlockVault(page);
  } else if (await successGate.isVisible().catch(() => false)) {
    await successGate.getByRole("button").last().click();
  }
  await expect(settingsButton).toBeVisible({ timeout: 30_000 });
  const onboarding = page.locator(
    '[aria-labelledby="onboarding-dialog-title"]',
  );
  if (await onboarding.isVisible().catch(() => false)) {
    // The successful restore reloads a new app boot. Because setupVault kept
    // onboarding open, the restored vault can return on either the
    // restore-first screen or the normal welcome step. Skip the modal through
    // its own accessible control so its backdrop cannot intercept navigation.
    const skipOnboarding = onboarding.getByRole("button", {
      name: "Skip onboarding",
    });
    await expect(skipOnboarding).toBeVisible({ timeout: 10_000 });
    await skipOnboarding.click();
    await expect(onboarding).not.toBeVisible({ timeout: 10_000 });
  }
  // Navigate through the live sidebar without a full-page reload. A direct
  // `page.goto("/bookmarks")` would intentionally restart the app and lock the
  // vault again, so it cannot be used after the post-restore unlock.
  await page.keyboard.press("Escape");
  const bookmarksNav = page.locator(
    'aside button[data-tab-id="bookmarks"]',
  );
  await expect(bookmarksNav).toBeVisible({ timeout: 10_000 });
  await bookmarksNav.click();
  await expect(page).toHaveURL(/\/bookmarks$/);
  await expect(page.getByTestId("bookmarks-virtual-list")).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByText("Restored Bookmark E2E", { exact: false }),
  ).toBeVisible({ timeout: 30_000 });
});
