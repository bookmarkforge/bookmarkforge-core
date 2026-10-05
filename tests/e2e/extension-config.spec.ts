/**
 * Extension E2E — configurable base URL.
 *
 * Loads the unpacked extension in a persistent Chromium context and
 * exercises the popup UI: default URL, custom URL save, validation
 * rejection, reset to default, and the background context menu.
 *
 * These tests validate the S6 hardening (ADR-026 D4) that replaced
 * the hardcoded BF_BASE_URL with chrome.storage.sync.
 *
 * Requires Chromium. Run with:
 *   npx playwright test --config=playwright.config.ts tests/e2e/extension-config.spec.ts
 */
import {
  test,
  expect,
  chromium,
  type Page,
  type BrowserContext,
} from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

// ── Helpers ──────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_DIR = path.resolve(__dirname, "../../extension");
const DEFAULT_BASE_URL = "https://bookmarkforge.com";
const CUSTOM_BASE_URL = "https://forge.example.com";

// ── Pre-flight: running browser session ────────────────────────────

const EXTENSION_SKIP_REASON =
  "A Chrome/Edge browser session is already running on this machine, so the " +
  "extension suite cannot launch its dedicated Chromium instance " +
  "(\"Opening in an existing browser session\"). Close Chrome/Edge and re-run " +
  "the suite, or run it on a clean CI agent.";

let _runningBrowserSession: boolean | null = null;

/**
 * Detect a real (non-Playwright) Chrome/Edge browser session on this machine.
 *
 * On Windows, a live Chrome instance refuses to start a second instance with
 * the extension profile and Playwright's launch dies with "Se está abriendo
 * en una sesión de navegador existente" — the extension e2e cannot run until
 * the user closes their browser. Playwright's own bundled Chromium (under
 * ms-playwright paths) is excluded so a concurrent e2e worker never causes a
 * false positive. Memoized: the OS probe runs once per worker.
 */
function runningBrowserSession(): boolean {
  // The extension context uses a dedicated temporary profile. Allow an
  // explicit opt-in for local runs while the user's browser remains open;
  // CI remains conservative by default when this flag is absent.
  if (process.env.BMF_ALLOW_EXTENSION_BROWSER_CONCURRENCY === "1") return false;
  if (_runningBrowserSession !== null) return _runningBrowserSession;
  _runningBrowserSession = detectRunningBrowser();
  return _runningBrowserSession;
}

function detectRunningBrowser(): boolean {
  try {
    if (process.platform === "win32") {
      const out = spawnSync(
        "powershell",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "Get-Process chrome,msedge,brave,opera,chromium -ErrorAction SilentlyContinue | " +
            "Where-Object { $_.Path -notlike '*ms-playwright*' } | " +
            "Select-Object -ExpandProperty Path",
        ],
        { encoding: "utf8", timeout: 10_000, windowsHide: true },
      );
      // Note: PowerShell may exit non-zero (e.g. elevated processes that
      // deny the .Path read) while still printing the browser paths on
      // stdout — the stdout content is authoritative, not the exit code.
      if (out.error) return false; // spawn failed or timed out
      return out.stdout.split(/\r?\n/).some((l) => l.trim().length > 0);
    }
    const out = spawnSync(
      "ps",
      ["-axo", "pid=,command="],
      { encoding: "utf8", timeout: 5_000 },
    );
    if (out.error) return false;
    return out.stdout
      .split(/\n/)
      .some(
        (l) =>
          /(chrome|chromium|msedge|brave|opera)/i.test(l) &&
          !/ms-playwright|playwright/i.test(l),
      );
  } catch {
    return false;
  }
}

/** Absolute path to the unpacked extension directory. */
function extensionPath(): string {
  if (!fs.existsSync(EXTENSION_DIR)) {
    throw new Error(
      `Extension directory not found at ${EXTENSION_DIR}. ` +
        `Build the extension first with: npm run build:extension:custom`,
    );
  }
  return EXTENSION_DIR;
}

/**
 * Launch a persistent Chromium context with the extension loaded.
 * Returns the context and the popup page.
 */
async function launchExtensionContext(): Promise<{
  context: BrowserContext;
  extensionId: string;
}> {
  const userDataDir = path.join(
    __dirname,
    "../../test-results/.ext-profile",
  );

  let context: BrowserContext;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false, // Extensions require a visible browser in Chromium
      args: [
        `--disable-extensions-except=${extensionPath()}`,
        `--load-extension=${extensionPath()}`,
        "--disable-dev-shm-usage",
        "--no-sandbox",
      ],
      // Give the extension service worker time to register.
      slowMo: 50,
    });
  } catch (error) {
    // Reactive backstop for a running Chrome session that the pre-flight
    // probe missed (different browser, non-default profile): surface the
    // environment conflict instead of a cryptic launch error.
    const msg = error instanceof Error ? error.message : String(error);
    if (
      /existing browser session|existing session|abriendo en una sesi/i.test(
        msg,
      )
    ) {
      throw new Error(
        "The extension browser could not start because a Chrome/Edge session " +
          "is already running on this machine. Close Chrome/Edge and re-run, " +
          "or run on a clean CI agent.",
      );
    }
    throw error;
  }

  // Wait for the extension's service worker to become active.
  // The extension ID is stable for unpacked extensions based on the
  // extension path hash, but we can also derive it from the manifest.
  let extensionId = "";
  if (context.serviceWorkers().length > 0) {
    const sw = context.serviceWorkers()[0]!;
    extensionId = new URL(sw.url()).hostname;
  }

  // Fallback: derive from background script if service worker not detected.
  if (!extensionId) {
    // Give the worker a moment to spawn, then re-check.
    await new Promise((resolve) => setTimeout(resolve, 500));
    for (const sw of context.serviceWorkers()) {
      const host = new URL(sw.url()).hostname;
      if (host.length === 32) {
        extensionId = host;
        break;
      }
    }
  }

  if (!extensionId) {
    // Last resort: navigate to a blank page and let the extension load.
    const page = await context.newPage();
    await page.goto("about:blank");
    await page.waitForTimeout(1000);
    const workers = context.serviceWorkers();
    if (workers.length === 0) {
      throw new Error(
        "Extension service worker did not start. " +
          "Check that the extension manifest is valid and the background " +
          "script has no syntax errors.",
      );
    }
    extensionId = new URL(workers[0]!.url()).hostname;
  }

  return { context, extensionId };
}

/** Open the extension popup as a standalone page. */
async function openPopup(
  context: BrowserContext,
  extensionId: string,
): Promise<Page> {
  const popup = await context.newPage();
  await popup.goto(
    `chrome-extension://${extensionId}/popup.html`,
  );
  await popup.waitForSelector("#saveBtn", { timeout: 5_000 });
  return popup;
}

/** Clear any stored custom URL in chrome.storage.sync. */
async function clearStoredUrl(popup: Page): Promise<void> {
  await popup.evaluate(() => {
    return chrome.storage.sync.remove("bookmarkforge_base_url");
  });
}

/** Open the settings panel in the popup. */
async function openSettings(popup: Page): Promise<void> {
  const toggle = popup.locator("#settingsToggle");
  const panel = popup.locator("#settingsPanel");

  const isOpen = await panel.evaluate((element) =>
    element.classList.contains("is-open"),
  );
  if (!isOpen) {
    await toggle.click();
  }
  await expect(panel).toBeVisible();
}

/** Get the current displayed URL from the settings panel. */
async function getDisplayedUrl(popup: Page): Promise<string> {
  const el = popup.locator("#currentUrlDisplay");
  await expect(el).toBeVisible();
  return (await el.textContent()) ?? "";
}

/** Set a custom URL via the settings panel and click Save. */
async function saveCustomUrl(
  popup: Page,
  url: string,
): Promise<void> {
  await openSettings(popup);
  const input = popup.locator("#customUrlInput");
  await input.fill(url);
  await popup.locator("#saveUrlBtn").click();
  // Wait for the success or error status to appear.
  await popup.waitForTimeout(300);
}

// ── Tests ──────────────────────────────────────────────────────────

// All tests share one persistent Chromium profile so chrome.storage.sync
// persistence can be verified across popup reopenings. Keep this describe
// serial even when the global E2E matrix uses fullyParallel workers.
test.describe.configure({ mode: "serial" });
test.describe("Extension — configurable base URL", () => {
  // Launched once per worker; the persistent profile persists across tests
  // so custom URL settings survive between tests. We clear storage before
  // each test that depends on a clean state.
  let context: BrowserContext;
  let extensionId: string;

  test.beforeAll(async () => {
    // Pre-flight: a running Chrome/Edge session prevents the extension
    // browser from launching on Windows. Skip the whole suite with a clear
    // reason instead of failing with "Opening in an existing browser
    // session" (see EXTENSION_SKIP_REASON).
    test.skip(runningBrowserSession(), EXTENSION_SKIP_REASON);
    ({ context, extensionId } = await launchExtensionContext());
  });

  test.afterAll(async () => {
    await context?.close().catch(() => undefined);
  });

  // ── Popup UI ────────────────────────────────────────────────────

  test("popup loads and displays page title and URL", async () => {
    const popup = await openPopup(context, extensionId);

    // The popup queries chrome.tabs.query for the active tab. Since
    // there's no "real" active tab in this test context, the popup
    // shows "Loading..." / "..." — but the DOM elements exist.
    await expect(popup.locator("#pageTitle")).toBeVisible();
    // A standalone extension page has no real active tab, so #pageUrl may be
    // empty (and therefore zero-height) while still being present in the DOM.
    await expect(popup.locator("#pageUrl")).toBeAttached();
    await expect(popup.locator("#saveBtn")).toBeVisible();
    await expect(popup.locator("#saveBtn")).toBeEnabled();

    await popup.close();
  });

  test("popup shows settings toggle", async () => {
    const popup = await openPopup(context, extensionId);

    await expect(popup.locator("#settingsToggle")).toBeVisible();
    await expect(popup.locator("#settingsToggle")).toHaveText(
      /Settings/,
    );

    await popup.close();
  });

  // ── Settings panel ──────────────────────────────────────────────

  test("settings panel opens and shows default URL", async () => {
    const popup = await openPopup(context, extensionId);
    await clearStoredUrl(popup);
    await openSettings(popup);

    // The settings panel must be visible.
    await expect(popup.locator("#settingsPanel")).toBeVisible();

    // Default URL must be displayed.
    const displayed = await getDisplayedUrl(popup);
    expect(displayed).toBe(DEFAULT_BASE_URL);

    // Input must be pre-filled with the default.
    const input = popup.locator("#customUrlInput");
    await expect(input).toHaveValue(DEFAULT_BASE_URL);

    await popup.close();
  });

  test("settings panel can be toggled closed", async () => {
    const popup = await openPopup(context, extensionId);
    await clearStoredUrl(popup);

    await openSettings(popup);
    await popup.locator("#settingsToggle").click();
    await expect(popup.locator("#settingsPanel")).toBeHidden();

    await popup.close();
  });

  // ── Custom URL ─────────────────────────────────────────────────

  test("saves a valid custom URL and displays it", async () => {
    const popup = await openPopup(context, extensionId);
    await clearStoredUrl(popup);

    await saveCustomUrl(popup, CUSTOM_BASE_URL);

    // Success status must appear.
    const urlStatus = popup.locator("#urlStatus");
    await expect(urlStatus).toContainText("Saved");

    // The displayed current URL must update.
    const displayed = await getDisplayedUrl(popup);
    expect(displayed).toBe(CUSTOM_BASE_URL);

    // Closing the panel and re-opening must show the saved URL.
    await popup.locator("#settingsToggle").click(); // close
    await openSettings(popup);
    const redisplayed = await getDisplayedUrl(popup);
    expect(redisplayed).toBe(CUSTOM_BASE_URL);

    await popup.close();
  });

  test("custom URL persists after closing and reopening popup", async () => {
    // The previous test saved CUSTOM_BASE_URL to chrome.storage.sync.
    // This test opens a fresh popup and expects the saved URL.
    const popup = await openPopup(context, extensionId);
    await openSettings(popup);

    const displayed = await getDisplayedUrl(popup);
    expect(displayed).toBe(CUSTOM_BASE_URL);

    await popup.close();
  });

  test("strips trailing slashes from custom URLs", async () => {
    const popup = await openPopup(context, extensionId);

    await saveCustomUrl(popup, `${CUSTOM_BASE_URL}/path///`);

    const displayed = await getDisplayedUrl(popup);
    expect(displayed).toBe(`${CUSTOM_BASE_URL}/path`);
    expect(displayed).not.toMatch(/\/+$/);

    await popup.close();
  });

  // ── URL validation ──────────────────────────────────────────────

  test("rejects invalid URLs and shows error", async () => {
    const popup = await openPopup(context, extensionId);
    await clearStoredUrl(popup);

    const invalidUrls = [
      "not-a-url",
      "ftp://files.example.com",
      "http://insecure.example.com",
      "   ",
      "javascript:alert(1)",
    ];

    for (const url of invalidUrls) {
      await saveCustomUrl(popup, url);
      const urlStatus = popup.locator("#urlStatus");
      await expect(urlStatus).toContainText(/Enter a valid|valid HTTPS/);
    }

    // After all invalid attempts, the displayed URL must still be the default.
    const displayed = await getDisplayedUrl(popup);
    expect(displayed).toBe(DEFAULT_BASE_URL);

    await popup.close();
  });

  // ── Reset ───────────────────────────────────────────────────────

  test("resets to default URL via Reset button", async () => {
    const popup = await openPopup(context, extensionId);

    // First set a custom URL so there's something to reset.
    await saveCustomUrl(popup, CUSTOM_BASE_URL);
    await expect(popup.locator("#currentUrlDisplay")).toContainText(
      CUSTOM_BASE_URL,
    );

    // Click Reset.
    await openSettings(popup);
    await popup.locator("#resetUrlBtn").click();
    await popup.waitForTimeout(300);

    // Status must confirm the reset.
    await expect(popup.locator("#urlStatus")).toContainText("Reset");

    // Displayed URL must be back to default.
    const displayed = await getDisplayedUrl(popup);
    expect(displayed).toBe(DEFAULT_BASE_URL);

    // Input must show default.
    await expect(popup.locator("#customUrlInput")).toHaveValue(
      DEFAULT_BASE_URL,
    );

    await popup.close();
  });

  // ── ARIA / a11y ────────────────────────────────────────────────

  test("settings toggle has correct ARIA attributes", async () => {
    const popup = await openPopup(context, extensionId);

    const toggle = popup.locator("#settingsToggle");

    // Initially collapsed.
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toHaveAttribute("aria-controls", "settingsPanel");

    // After expanding.
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");

    await popup.close();
  });

  test("settings panel has correct landmark role", async () => {
    const popup = await openPopup(context, extensionId);
    await openSettings(popup);

    const panel = popup.locator("#settingsPanel");
    await expect(panel).toHaveAttribute("role", "region");
    await expect(panel).toHaveAttribute(
      "aria-labelledby",
      "settingsLabel",
    );

    await popup.close();
  });

  // ── Status messages ─────────────────────────────────────────────

  test("status messages use aria-live for screen readers", async () => {
    const popup = await openPopup(context, extensionId);
    await clearStoredUrl(popup);

    // Status elements must have aria-live for dynamic announcements.
    const saveStatus = popup.locator("#status");
    await expect(saveStatus).toHaveAttribute("aria-live", "polite");

    await openSettings(popup);
    const urlStatus = popup.locator("#urlStatus");
    await expect(urlStatus).toHaveAttribute("aria-live", "polite");

    await popup.close();
  });
});
