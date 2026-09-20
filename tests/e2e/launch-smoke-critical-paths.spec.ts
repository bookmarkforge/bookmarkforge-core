import { existsSync, readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { dismissOverlays, expectUnlockedApp, lockVault, setupVault, unlockVault } from "./vault-helpers";
import { assertDurableBackend } from "./storage-backend-guard";
import { seedProEntitlement } from "./pro-entitlement-helpers";

/**
 * launch-smoke-critical-paths — the paths whose failure costs the product its
 * reputation, exercised through the REAL UI end to end:
 *
 *   1. vault create with a 12+ character password (mirroring
 *      SECURITY_CONFIG.MIN_PASSWORD_LENGTH), lock/unlock round-trip;
 *   2. an 11-character password rejected at the UI gate before any vault work;
 *   3. recovery with the exact 24-word phrase the setup screen displayed;
 *   4. a truncated 23-word phrase rejected fail-closed (and the full phrase
 *      still recovering afterwards — negative control);
 *   5. Pro license activation through the real signing service
 *      (Whop-adapter mock → RSA-PSS entitlement → client verification);
 *   6. an invalid license key failing closed with a visible error;
 *   7. an encrypted .bmf backup round-trip after a simulated total data loss
 *      (Settings → Export Backup → disaster → F0-2 restore-first wizard).
 *
 * Everything is UI-driven ON PURPOSE: the same spec runs in two profiles
 * (see playwright.launch-smoke.config.ts) — the fast `--mode test` dev server
 * and `vite preview` over the real production build — so launch day exercises
 * exactly the bundle users get. Service-level shortcuts (page.evaluate
 * importing /src modules) cannot run on a built bundle, so none are used.
 */

/** 15 chars — comfortably above SECURITY_CONFIG.MIN_PASSWORD_LENGTH (12). */
const LAUNCH_PASSWORD = "launch-smoke-12";

/**
 * License tests activate against the REAL signing service, which needs the
 * gitignored dev key (server/.license-signing-key.pkcs8). Without it the
 * tests SKIP with an explicit marker instead of failing — CI runners have no
 * signing key, and a missing key must be visible (skip), never silent-pass
 * nor a red herring masking an actual regression. With a key present
 * (developer machine, launch day) they always run.
 */
const HAS_SIGNING_KEY =
  existsSync("server/.license-signing-key.pkcs8") ||
  Boolean(process.env.LICENSE_SIGNING_PRIVATE_KEY_FILE) ||
  Boolean(process.env.LICENSE_SIGNING_PRIVATE_KEY_PKCS8);

/** Value the Whop-adapter mock accepts (scripts/license-mock.mjs). */
const LICENSE_KEY =
  process.env.BMF_LAUNCH_SMOKE_LICENSE_KEY ?? "license-mock-key";
/** Value the Whop-adapter mock rejects. */
const INVALID_LICENSE_KEY = "INVALID";

const SMOKE_URL = "https://example.com/launch-smoke";
const SMOKE_TITLE = "Launch smoke bookmark";

/** True when the persisted lock flag puts the app on the locked screen. */
async function vaultIsLocked(page: Page): Promise<boolean> {
  return page.getByTestId("vault-locked-screen").isVisible();
}

/** Open the settings modal and return the Pro section locator. */
async function openProSection(page: Page) {
  await page.getByTestId("settings-button").click();
  await expect(
    page.locator('[aria-labelledby="settings-dialog-title"]'),
  ).toBeVisible();
  const pro = page.getByTestId("settings-pro");
  await expect(pro).toBeVisible();
  return pro;
}

/** Capture a bookmark through the QuickCapture UI (works offline: no AI). */
async function addBookmarkViaUi(page: Page, url: string, title: string) {
  await page.getByTestId("add-bookmark-button").click();
  const input = page.getByTestId("quick-capture-input");
  await expect(input).toBeVisible();
  await input.fill(url);
  await page.getByTestId("bookmark-title-input").fill(title);
  await page.getByTestId("save-bookmark-button").click();
  // onSuccess closes the capture panel — the deterministic completion signal
  // (a row-visibility assertion would race the async capture pipeline).
  await expect(page.getByTestId("close-quick-capture-button")).toBeHidden({
    timeout: 60_000,
  });
  // Verify through the user's own path: the vault opens on Dashboard, the
  // bookmark lives in the Bookmarks view — navigate there via the sidebar.
  await page
    .getByRole("navigation", { name: "Sidebar sections" })
    .getByRole("button", { name: "Bookmarks", exact: true })
    .click();
  await expect(page.getByTestId("search-input")).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    page.getByText(title, { exact: true }).first(),
  ).toBeVisible({ timeout: 30_000 });
}

/**
 * Wipe EVERY trace of the vault (localStorage + IndexedDB namespaces), the
 * real "cleared all site data" disaster. After this the app boots as first
 * use: SecurityConfirmation → (empty vault) F0-2 restore-first wizard.
 */
async function totalDisaster(page: Page): Promise<void> {
  await page.evaluate(() => localStorage.clear());
  await page.evaluate(async () => {
    const prefixes = ["bookmarkforge", "vault"];
    let databases: Array<{ name?: string }> = [];
    try {
      databases = (await indexedDB.databases?.()) ?? [];
    } catch {
      databases = [];
    }
    for (const { name } of databases) {
      if (!name || !prefixes.some((p) => name.startsWith(p))) {
        continue;
      }
      await new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = request.onerror = request.onblocked = () =>
          resolve();
      });
    }
  });
  await page.reload();
}

test.describe("critical path: vault create", () => {
  test("12-character password passes the UI gate and creates a working vault", async ({
    page,
  }) => {
    await setupVault(page, { password: LAUNCH_PASSWORD });
    await expectUnlockedApp(page);
    await assertDurableBackend(page);

    // Lock and unlock again with the SAME password: proves it was really
    // persisted as the vault credential, not just accepted once.
    await lockVault(page);
    await unlockVault(page, LAUNCH_PASSWORD);
  });

  test("an 11-character password is rejected at the UI before any vault work", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Secure your vault" }),
    ).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Set up password" }).click();
    await expect(
      page.getByRole("heading", { name: "Setup Secure Vault" }),
    ).toBeVisible({ timeout: 30_000 });

    // The kit download enables the confirmation checkbox, which enables
    // Create Vault — the same preconditions a real attempt passes.
    const download = page.waitForEvent("download", { timeout: 30_000 });
    await page.getByRole("button", { name: "Download Recovery Kit" }).click();
    await download;
    const confirmCheckbox = page.getByRole("checkbox", {
      name: "I have safely saved the recovery phrase",
    });
    await expect(confirmCheckbox).toBeEnabled({ timeout: 10_000 });
    // Playwright can report the checkbox as covered; invoke the accessible
    // control directly (same workaround as drill-backup-restore).
    await confirmCheckbox.evaluate((el) => (el as HTMLInputElement).click());

    await page.getByLabel("Master Password").fill("short-11-ch");
    await page.getByRole("button", { name: "Create Vault" }).click();

    // UI gate (SECURITY_CONFIG.MIN_PASSWORD_LENGTH): fail-closed before any
    // KDF work, error banner visible, setup screen still up, shell locked.
    await expect(page.locator(".security-error-in")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator(".security-error-in")).toContainText(
      "at least 12 characters",
    );
    await expect(
      page.getByRole("heading", { name: "Setup Secure Vault" }),
    ).toBeVisible();
    await expect(page.getByTestId("settings-button")).toHaveCount(0);
  });
});

test.describe("critical path: recovery", () => {
  test("recover with the exact 24-word phrase the setup screen displayed", async ({
    page,
  }) => {
    test.setTimeout(300_000); // two full KDF round-trips + lock/unlock

    let shownPhrase = "";
    await setupVault(page, {
      password: LAUNCH_PASSWORD,
      onRecoveryPhrase: (phrase) => {
        shownPhrase = phrase;
      },
    });
    await expectUnlockedApp(page);

    // The shown phrase must BE the contract: 24 lowercase BIP39 words.
    const words = shownPhrase.split(/\s+/).filter(Boolean);
    expect(words, "setup screen must display a 24-word phrase").toHaveLength(
      24,
    );
    expect(
      words.every((w) => /^[a-z]+$/.test(w)),
      `phrase must be lowercase BIP39 words, got: ${shownPhrase}`,
    ).toBe(true);

    await lockVault(page);

    // Forgot password? → recovery screen → phrase → Recover Vault.
    await page.getByRole("button", { name: "Forgot password?" }).click();
    await page
      .getByLabel("Enter your recovery phrase")
      .fill(shownPhrase);
    await page.getByRole("button", { name: "Recover Vault" }).click();

    await expectUnlockedApp(page);
    await assertDurableBackend(page);
  });

  test("a 23-word phrase is rejected without unlocking the vault", async ({
    page,
  }) => {
    test.setTimeout(300_000);

    let shownPhrase = "";
    await setupVault(page, {
      password: LAUNCH_PASSWORD,
      onRecoveryPhrase: (phrase) => {
        shownPhrase = phrase;
      },
    });
    await expectUnlockedApp(page);
    await lockVault(page);

    await page.getByRole("button", { name: "Forgot password?" }).click();
    await page
      .getByLabel("Enter your recovery phrase")
      .fill(shownPhrase.split(/\s+/).slice(0, 23).join(" "));
    await page.getByRole("button", { name: "Recover Vault" }).click();

    // Fail-closed: visible error, vault stays locked. A single wrong attempt
    // stays well under RecoveryService's MAX_ATTEMPTS lockout cap.
    await expect(page.locator(".security-error-in")).toBeVisible({
      timeout: 90_000,
    });
    await expect(page.getByTestId("vault-locked-screen")).toBeVisible();

    // Negative control the other direction: the CORRECT phrase from the same
    // screen still recovers — proving the rejection was caused by the
    // truncation, not by a broken recovery path in general. RecoveryService
    // throttles attempts to one per MIN_INTERVAL_MS (2s), so wait out the
    // window before the next submission instead of firing into the limiter.
    await page.waitForTimeout(2_500);
    await page.getByLabel("Enter your recovery phrase").fill(shownPhrase);
    await page.getByRole("button", { name: "Recover Vault" }).click();
    await expectUnlockedApp(page);
  });
});

test.describe("critical path: license activation", () => {
  test.skip(
    !HAS_SIGNING_KEY,
    "license signing key not available (CI) — activation tests skip with a marker, never fail nor silently pass",
  );

  test("activate with a valid key through the real signing service", async ({
    page,
  }) => {
    await setupVault(page);
    await dismissOverlays(page);

    const pro = await openProSection(page);
    await pro.locator("#license-key-input").fill(LICENSE_KEY);
    await pro.getByRole("button", { name: "Activate" }).click();

    // Pro state renders after the signed entitlement is verified locally.
    // Current entitlements expose the canonical device status; legacy signing
    // responses may only expose activationsLeft, so keep this smoke contract
    // compatible with both payload shapes during migration.
    await expect(
      pro.getByText(/^(Devices:|Activations left:)/),
    ).toBeVisible({ timeout: 60_000 });
    await expect(pro.getByRole("button", { name: "Deactivate" })).toBeVisible();
  });

  test("an invalid key fails closed with a visible error", async ({ page }) => {
    await setupVault(page);
    await dismissOverlays(page);

    const pro = await openProSection(page);
    await pro.locator("#license-key-input").fill(INVALID_LICENSE_KEY);
    await pro.getByRole("button", { name: "Activate" }).click();

    await expect(pro.locator('p[role="alert"]')).toBeVisible({
      timeout: 60_000,
    });
    // Still on the activate form — no Pro state was granted.
    await expect(pro.getByRole("button", { name: "Activate" })).toBeVisible();
    await expect(pro.getByRole("button", { name: "Deactivate" })).toHaveCount(
      0,
    );
  });
});

test.describe("critical path: encrypted backup round-trip", () => {
  test(".bmf backup restores data after a simulated total data loss", async ({
    page,
  }) => {
    test.setTimeout(600_000); // full disaster drill: 4 KDF round-trips

    // Chromium's native save dialog (File System Access API) never resolves
    // in headless, so force the classic anchor-download fallback that
    // BackupService uses when the picker fails — the path every non-FSA
    // browser already takes. addInitScript BEFORE any goto so the stub is
    // installed at document creation, across every reload in this test.
    await page.addInitScript(() => {
      Object.defineProperty(window, "showSaveFilePicker", {
        configurable: true,
        value: () =>
          Promise.reject(new Error("e2e: use anchor-download fallback")),
      });
    });

    // 1. BASELINE — real vault + one bookmark captured through the UI.
    //    Pro-gated surface: seed the entitlement through the real signing
    //    stack (license-mock) so the export is not stopped by the gate.
    await setupVault(page, { password: LAUNCH_PASSWORD });
    await seedProEntitlement(page);
    await dismissOverlays(page);
    await addBookmarkViaUi(page, SMOKE_URL, SMOKE_TITLE);

    // 2. EXPORT — Settings → Storage: encrypted .bmf via the real UI
    //    (confirm() = yes, prompt() = backup password).
    await page.getByTestId("settings-button").click();
    await expect(
      page.locator('[aria-labelledby="settings-dialog-title"]'),
    ).toBeVisible();
    const exportButton = page
      .getByRole("button", { name: "Export Backup" })
      .first();
    await expect(exportButton).toBeEnabled();
    page.on("dialog", (dialog) => {
      if (dialog.type() === "prompt") {
        void dialog.accept(LAUNCH_PASSWORD);
      } else {
        void dialog.accept();
      }
    });
    const download = page.waitForEvent("download", { timeout: 60_000 });
    await exportButton.click();
    const downloadObj = await download;
    const backupPath = await downloadObj.path();
    if (!backupPath) {
      throw new Error("expected the encrypted .bmf download to be saved");
    }

    // 3. DISASTER — total data loss: localStorage + every vault namespace.
    await page.keyboard.press("Escape"); // close settings before the wipe
    await totalDisaster(page);

    // 4. RE-CREATE — first-run state: the SAME password (the .bmf is
    //    encrypted with the master password, so the restored vault must be
    //    opened with it — exactly what the kit warning tells users).
    //    dismissOnboarding:false keeps the F0-2 restore-first wizard open.
    //    totalDisaster wiped localStorage, so the entitlement must be
    //    re-seeded for the restore-side import path.
    await setupVault(page, {
      password: LAUNCH_PASSWORD,
      dismissOnboarding: false,
    });
    await expect(
      page.getByRole("heading", { name: "Your vault is empty" }),
    ).toBeVisible({ timeout: 30_000 });
    await seedProEntitlement(page); // second seed after totalDisaster

    // 5. RESTORE — through the real wizard file input (accepts .bmf and
    //    prompts for the password itself). The handler reloads the app when
    //    the import resolves; wait for that load explicitly.
    const dialog = page.locator('[aria-labelledby="onboarding-dialog-title"]');
    const fileInput = dialog.locator('input[type="file"][accept=".json,.bmf"]');
    await expect(fileInput).toBeAttached();
    const reload = page.waitForEvent("load", { timeout: 120_000 });
    await fileInput.setInputFiles({
      name: "launch-smoke.bmf",
      mimeType: "application/octet-stream",
      buffer: readFileSync(backupPath),
    });
    await reload;

    // 6. VERIFY — the vault unlocks with the ORIGINAL password (proving the
    //    password survived inside the encrypted backup) and the bookmark is
    //    back, found through the same search UI a user would use.
    await expect(
      page
        .getByTestId("vault-locked-screen")
        .or(page.getByRole("heading", { name: "Secure your vault" }))
        .or(page.getByTestId("settings-button")),
    ).toBeVisible({ timeout: 60_000 });
    if (await vaultIsLocked(page)) {
      await unlockVault(page, LAUNCH_PASSWORD);
    }
    await expectUnlockedApp(page);
    await assertDurableBackend(page);
    await dismissOverlays(page);

    // The restored bookmark must be findable through the user's own path —
    // the Bookmarks view's search (the vault opens on the Dashboard).
    await page
      .getByRole("navigation", { name: "Sidebar sections" })
      .getByRole("button", { name: "Bookmarks", exact: true })
      .click();
    const searchInput = page.getByTestId("search-input");
    await expect(searchInput).toBeVisible({ timeout: 30_000 });
    await searchInput.fill(SMOKE_TITLE);
    await expect(
      page.getByText(SMOKE_TITLE, { exact: true }).first(),
    ).toBeVisible({ timeout: 30_000 });
  });
});
