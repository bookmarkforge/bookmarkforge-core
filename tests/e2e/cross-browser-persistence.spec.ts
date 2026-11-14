import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { firefox, webkit } from "playwright";
import {
  dismissOverlays,
  expectUnlockedApp,
  safeReload,
  setupVault,
  unlockVault,
} from "./vault-helpers";
import { seedProEntitlement } from "./pro-entitlement-helpers";

/**
 * cross-browser-persistence — vault persistence across browser engines.
 * Runs once on the chromium project and launches Firefox/WebKit manually;
 * those legs SKIP when the engine binaries are not installed (the default
 * e2e surface only guarantees Chromium).
 *
 * Proves two things the per-engine batteries cannot:
 *
 *   1. RELOAD PERSISTENCE per engine — vault created in Chromium, Firefox and
 *      WebKit independently; after a full page reload the vault must be LOCKED
 *      (not wiped) and unlock with the same password, i.e. IndexedDB +
 *      localStorage survived. Also records navigator.storage.persisted().
 *
 *   2. CROSS-ENGINE PORTABILITY — an encrypted .bmf exported from Chromium is
 *      imported through the real Settings UI in WebKit (the most different
 *      engine: different IndexedDB impl, different storage stack) and the
 *      bookmark must be found again. This is the only supported way data
 *      moves between browsers: the vault is local-first and per-browser.
 *
 * Run: npx playwright test --config=playwright.config.ts --project=chromium \
 *        tests/e2e/tmp-cross-browser-persistence.spec.ts
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:4173";
const PASSWORD = "cross-browser-persist-12";
const BOOKMARK_URL = "https://example.com/cross-browser";
const BOOKMARK_TITLE = "Cross-browser persistence bookmark";

const CONSENT_KEYS: Array<[string, string]> = [
  ["forge_consent_decision_made", "true"],
  ["forge_consent_analytics", "true"],
  ["forge_consent_error_reporting", "true"],
  ["forge_consent_client_events", "true"],
  ["bmf_local_error_storage", "true"],
];

/**
 * True when the engine's Playwright browser binary is installed. The default
 * `npm run e2e` surface only guarantees Chromium — contributors and the main
 * e2e CI job may not have Firefox/WebKit, so those legs SKIP rather than fail.
 */
function engineInstalled(browserType: typeof firefox | typeof webkit): boolean {
  try {
    return existsSync(browserType.executablePath());
  } catch {
    return false;
  }
}

async function manualContext(browserType: typeof firefox | typeof webkit) {
  const browser = await browserType.launch();
  const context = await browser.newContext({
    baseURL: BASE_URL,
    acceptDownloads: true,
    serviceWorkers: "block",
    locale: "en-US",
  });
  await context.addInitScript((keys) => {
    for (const [name, value] of keys) {
      try {
        window.localStorage.setItem(name, value);
      } catch {
        /* storage unavailable — the app will show its own consent gate */
      }
    }
  }, CONSENT_KEYS);
  return { browser, context, page: await context.newPage() };
}

async function assertReloadPersistence(
  page: Page,
  engine: string,
): Promise<boolean | null> {
  await setupVault(page, { password: PASSWORD });
  await dismissOverlays(page);

  const persisted = await page.evaluate(async () => {
    try {
      return await navigator.storage.persisted();
    } catch {
      return null;
    }
  });

  await safeReload(page);
  // After reload the vault MUST be locked — proof the vault state (and its
  // absence of a silent wipe) survived; a missing IndexedDB would boot
  // first-run instead.
  await expect(page.getByTestId("vault-locked-screen")).toBeVisible({
    timeout: 60_000,
  });
  await unlockVault(page, PASSWORD);
  await expectUnlockedApp(page);

  console.log(`[persist] ${engine}: reload persistence OK (storage.persisted=${persisted})`);
  return persisted;
}

test.describe("cross-browser vault persistence", () => {
  test("vault survives reload in chromium, firefox and webkit", async ({
    page,
  }, testInfo) => {
    test.setTimeout(600_000);
    test.skip(testInfo.project.name !== "chromium", "runs once, launches engines manually");

    // Chromium leg uses the fixture page (baseURL + consent storageState
    // already applied by playwright.config.ts).
    const persistedByEngine: Array<boolean | null> = [
      await assertReloadPersistence(page, "chromium"),
    ];

    for (const [name, browserType] of [
      ["firefox", firefox],
      ["webkit", webkit],
    ] as const) {
      // reason: engines without an installed Playwright binary cannot run —
      // the default e2e surface only guarantees Chromium.
      test.skip(
        !engineInstalled(browserType),
        `${name} browser binary not installed (npx playwright install ${name})`,
      );
      const { browser, context, page: enginePage } = await manualContext(
        browserType,
      );
      try {
        persistedByEngine.push(
          await assertReloadPersistence(enginePage, name),
        );
      } finally {
        await context.close();
        await browser.close();
      }
    }

    // Every engine leg that ran must have gotten a definitive answer from
    // navigator.storage.persisted() — null means the StorageManager API
    // itself threw in that engine's storage stack.
    expect(persistedByEngine.every((v) => v !== null)).toBe(true);
  });

  test(".bmf exported in chromium imports and restores in webkit", async ({
    page,
  }, testInfo) => {
    test.setTimeout(600_000);
    test.skip(testInfo.project.name !== "chromium", "runs once, launches engines manually");

    // Chromium's native save dialog (File System Access API) never resolves
    // headless — force the anchor-download fallback, same as launch-smoke.
    // Installed before any goto so it applies across every navigation.
    await page.addInitScript(() => {
      Object.defineProperty(window, "showSaveFilePicker", {
        configurable: true,
        value: () =>
          Promise.reject(new Error("e2e: use anchor-download fallback")),
      });
    });

    // ── EXPORT leg (chromium, fixture page) ────────────────────────────
    await setupVault(page, { password: PASSWORD });
    await seedProEntitlement(page); // export is Pro-gated; real signing stack
    await dismissOverlays(page);

    // Capture one bookmark through the real UI.
    await page.getByTestId("add-bookmark-button").click();
    const captureInput = page.getByTestId("quick-capture-input");
    await expect(captureInput).toBeVisible();
    await captureInput.fill(BOOKMARK_URL);
    await page.getByTestId("bookmark-title-input").fill(BOOKMARK_TITLE);
    await page.getByTestId("save-bookmark-button").click();
    await expect(page.getByTestId("close-quick-capture-button")).toBeHidden({
      timeout: 60_000,
    });

    // Settings → Export Backup (encrypted .bmf). Same dialog handling as
    // launch-smoke-critical-paths: confirm()=yes, prompt()=backup password.
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
        void dialog.accept(PASSWORD);
      } else {
        void dialog.accept();
      }
    });
    const downloadPromise = page.waitForEvent("download", { timeout: 60_000 });
    await exportButton.click();
    const download = await downloadPromise;
    const backupPath = await download.path();
    if (!backupPath) throw new Error("expected the .bmf download to be saved");
    const backupBytes = readFileSync(backupPath);
    const handoffPath = join(tmpdir(), "bmf-cross-browser-export.bmf");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(handoffPath, backupBytes);

    // ── IMPORT leg (webkit — different engine, different storage stack) ──
    test.skip(
      !engineInstalled(webkit),
      "webkit browser binary not installed (npx playwright install webkit)",
    );
    const { browser, context, page: webkitPage } =
      await manualContext(webkit);
    try {
      await setupVault(webkitPage, { password: "webkit-local-12" });
      await seedProEntitlement(webkitPage);
      await dismissOverlays(webkitPage);

      await webkitPage.getByTestId("settings-button").click();
      const settingsDialog = webkitPage.locator(
        '[aria-labelledby="settings-dialog-title"]',
      );
      await expect(settingsDialog).toBeVisible();
      const importButton = settingsDialog.getByRole("button", {
        name: "Import Data",
      });
      const fileChooserPromise = webkitPage.waitForEvent("filechooser");
      await importButton.click();
      const fileChooser = await fileChooserPromise;
      await fileChooser.setFiles({
        name: "cross-browser.bmf",
        mimeType: "application/octet-stream",
        buffer: backupBytes,
      });

      const passwordDialog = webkitPage.locator(
        '[aria-labelledby="backup-password-dialog-title"]',
      );
      await expect(passwordDialog).toBeVisible();
      await passwordDialog
        .getByLabel("Enter the password to decrypt this backup:")
        .fill(PASSWORD);
      await passwordDialog
        .getByRole("button", { name: "Unlock" })
        .click();
      await expect(
        webkitPage.getByText("Backup imported successfully", { exact: true }),
      ).toBeVisible({ timeout: 60_000 });

      // The imported bookmark must be findable through the user's own path.
      await safeReload(webkitPage);
      const locked = webkitPage.getByTestId("vault-locked-screen");
      const settingsButton = webkitPage.getByTestId("settings-button");
      // After reload the vault may boot locked OR straight into the shell —
      // wait for whichever surface wins the race before deciding.
      await expect(locked.or(settingsButton)).toBeVisible({
        timeout: 60_000,
      });
      if (await locked.isVisible()) {
        await unlockVault(webkitPage, "webkit-local-12");
      }
      await expectUnlockedApp(webkitPage);
      await dismissOverlays(webkitPage);
      await webkitPage
        .getByRole("navigation", { name: "Sidebar sections" })
        .getByRole("button", { name: "Bookmarks", exact: true })
        .click();
      const searchInput = webkitPage.getByTestId("search-input");
      await expect(searchInput).toBeVisible({ timeout: 30_000 });
      await searchInput.fill(BOOKMARK_TITLE);
      await expect(
        webkitPage.getByText(BOOKMARK_TITLE, { exact: true }).first(),
      ).toBeVisible({ timeout: 30_000 });
       
      console.log("[persist] chromium→webkit .bmf portability OK");
    } finally {
      await context.close();
      await browser.close();
    }
  });
});
