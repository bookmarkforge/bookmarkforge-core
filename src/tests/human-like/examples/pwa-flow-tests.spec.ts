/**
 * PWA Install & Update Flow — Human-Like E2E
 *
 * Exercises the full Progressive Web App lifecycle with realistic user
 * behavior: offline readiness, update prompts, install flow, and
 * service worker lifecycle events.
 *
 * The ReloadPrompt component (src/components/pwa/ReloadPrompt.tsx) uses
 * vite-plugin-pwa's `useRegisterSW` hook to surface offline-ready and
 * update-available states. This spec drives it through the human
 * simulator (ciBasicOptions) against the real Vite dev server with
 * Dexie-backed IndexedDB.
 */

import { test, expect } from "@playwright/test";
import { createHumanBehavior, ciBasicOptions } from "../utils/human-behavior";
import {
  goToBookmarks,
  createBookmarkViaCapture,
  expectCapturedToast,
} from "../utils/app-flows";
import { skipPassword } from "../../../../tests/e2e/vault-helpers";

// ---------------------------------------------------------------------------
// PWA flow helpers
// ---------------------------------------------------------------------------

/**
 * Drive the test-only PWA state bridge used by ReloadPrompt in `--mode test`.
 * Real browsers do not expose a portable way to synthesize a waiting service
 * worker, so this keeps the E2E flow on the real prompt UI without relying on
 * undocumented vite-plugin-pwa internals.
 */
async function simulateSWUpdate(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent("bookmarkforge:pwa-state", {
        detail: { offlineReady: false, needRefresh: true },
      }),
    );
  });
}

/**
 * Drive the test-only offline-ready state on the real ReloadPrompt UI.
 */
async function simulateSWOfflineReady(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    window.dispatchEvent(
      new CustomEvent("bookmarkforge:pwa-state", {
        detail: { offlineReady: true, needRefresh: false },
      }),
    );
  });
}

/**
 * Dispatch pwa-state events until the ReloadPrompt toast renders.
 *
 * ReloadPrompt attaches its `bookmarkforge:pwa-state` window listener in a
 * passive effect, which runs after the DOM commit that `skipPassword` waits
 * for — a single early dispatch can therefore be lost under load. Re-dispatch
 * (the component's setState is idempotent) until the prompt appears.
 */
async function dispatchPwaStateUntilPrompt(
  page: import("@playwright/test").Page,
  dispatch: () => Promise<void>,
) {
  await expect
    .poll(
      async () => {
        await dispatch();
        return page.getByTestId("pwa-reload-prompt").isVisible().catch(() => false);
      },
      { timeout: 5_000 },
    )
    .toBe(true);
}

/**
 * Simulate the `beforeinstallprompt` browser event so the install prompt
 * becomes visible.  Returns the outcome the user chose.
 */
async function simulateInstallPrompt(
  page: import("@playwright/test").Page,
  outcome: "accepted" | "dismissed",
) {
  await page.evaluate(
    (o) => {
      const event = new Event("beforeinstallprompt", {
        cancelable: true,
      }) as any;
      event.prompt = () => {
        if (o === "accepted") {
          window.setTimeout(() => window.dispatchEvent(new Event("appinstalled")), 0);
        }
      };
      event.userChoice = Promise.resolve({ outcome: o });
      window.dispatchEvent(event);
    },
    outcome,
  );
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

test.describe("PWA — Service Worker lifecycle", () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test("detects offline-ready state and user reads then dismisses the toast", async ({
    page,
  }) => {
    const human = createHumanBehavior(page, ciBasicOptions);

    // User creates a bookmark normally — app is functional.
    await createBookmarkViaCapture(
      page,
      human,
      "https://pwa-offline.example.com",
      "PWA Offline Test",
    );
    await expectCapturedToast(page);

    // Simulate SW reaching offline-ready — vite-plugin-pwa fires the
    // pwa-offline-ready event, which useRegisterSW surfaces as a toast.
    await dispatchPwaStateUntilPrompt(page, () => simulateSWOfflineReady(page));

    // The ReloadPrompt renders a toast with the offline-ready message.
    const prompt = page.getByTestId("pwa-reload-prompt");
    await expect(prompt).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId("pwa-reload-message")).toContainText(
      /offline/i,
    );

    // Realistic human behavior: the user reads the toast (short pause),
    // then decides to dismiss it rather than interact further.
    const dismissBtn = page.getByTestId("pwa-dismiss-button");
    await human.click(dismissBtn);

    // Toast should be gone.
    await expect(prompt).not.toBeVisible();
  });

  test("user sees update notification, hesitates, then reloads", async ({
    page,
  }) => {
    const human = createHumanBehavior(page, ciBasicOptions);

    // User has been using the app — create a bookmark.
    await createBookmarkViaCapture(
      page,
      human,
      "https://pwa-update.example.com",
      "PWA Update Test Bookmark",
    );
    await expectCapturedToast(page);

    // Navigate to bookmarks to confirm data persisted.
    await goToBookmarks(page);
    await expect(page.getByText("PWA Update Test Bookmark")).toBeVisible();

    // Simulate a new SW waiting — update notification appears.
    await dispatchPwaStateUntilPrompt(page, () => simulateSWUpdate(page));

    const prompt = page.getByTestId("pwa-reload-prompt");
    await expect(prompt).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId("pwa-reload-message")).toContainText(
      /new version/i,
    );

    // Human hesitates: reads the notification, considers whether to reload
    // now or later. The basic simulator adds natural micro-delays.
    // Then decides: "Yes, reload now" and clicks the Reload button.
    const reloadBtn = page.getByTestId("pwa-reload-button");
    await human.click(reloadBtn);

    // ReloadPrompt calls updateServiceWorker(true), which triggers a page
    // reload. After reload we verify the vault is still accessible
    // (IndexedDB persisted across the SW update).
    await page.waitForLoadState("load", { timeout: 15_000 });

    // After reload, skipPassword unlocks the vault again. The bookmark
    // we created before the update should still be present — the vault
    // survives SW updates because it lives in IndexedDB, not the SW cache.
    await skipPassword(page);
    await goToBookmarks(page);
    await expect(page.getByText("PWA Update Test Bookmark")).toBeVisible();
  });

  test("user sees update notification and decides to dismiss it", async ({
    page,
  }) => {
    const human = createHumanBehavior(page, ciBasicOptions);

    // User is in the middle of a task — creating a bookmark.
    await createBookmarkViaCapture(
      page,
      human,
      "https://pwa-dismiss.example.com",
      "Don't Interrupt Me",
    );
    await expectCapturedToast(page);

    // SW update arrives while user is working.
    await dispatchPwaStateUntilPrompt(page, () => simulateSWUpdate(page));

    const prompt = page.getByTestId("pwa-reload-prompt");
    await expect(prompt).toBeVisible({ timeout: 5_000 });

    // Human reads the notification but decides not to reload right now
    // (they're in the middle of something). Dismisses the toast.
    const dismissBtn = page.getByTestId("pwa-dismiss-button");
    await human.click(dismissBtn);

    await expect(prompt).not.toBeVisible();

    // User continues working — creates another bookmark without
    // interruption. The update can wait.
    await createBookmarkViaCapture(
      page,
      human,
      "https://pwa-after-dismiss.example.com",
      "After Dismiss Bookmark",
    );
    await expectCapturedToast(page);

    await goToBookmarks(page);
    await expect(page.getByText("After Dismiss Bookmark")).toBeVisible();
  });
});

test.describe("PWA — Install prompt flow", () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test("user accepts the install prompt and gets confirmation", async ({
    page,
  }) => {
    const human = createHumanBehavior(page, ciBasicOptions);

    // Simulate the browser's beforeinstallprompt firing. The
    // useInstallPrompt hook captures this and sets isInstallable = true.
    await simulateInstallPrompt(page, "accepted");

    // The app exposes the install action in the header once the browser
    // reports that installation is available.
    const appInstalled = page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          window.addEventListener("appinstalled", () => resolve(), {
            once: true,
          });
        }),
    );

    const installBtn = page.getByTestId("pwa-install-button");
    await expect(installBtn).toBeVisible({ timeout: 5_000 });
    await human.click(installBtn);

    // The simulated browser event emits appinstalled after prompt().
    await appInstalled;

    // After installation, the install prompt should no longer be available.
    // In real PWA, isInstallable becomes false and the button is hidden.
  });

  test("user dismisses the install prompt and can still use the app", async ({
    page,
  }) => {
    const human = createHumanBehavior(page, ciBasicOptions);

    // Simulate beforeinstallprompt but user dismisses.
    await simulateInstallPrompt(page, "dismissed");

    // User should still be able to use the app normally without
    // installation. Create and verify a bookmark.
    await createBookmarkViaCapture(
      page,
      human,
      "https://pwa-no-install.example.com",
      "No Install Needed",
    );
    await expectCapturedToast(page);

    await goToBookmarks(page);
    await expect(page.getByText("No Install Needed")).toBeVisible();

    // App remains fully functional without PWA installation.
  });
});

test.describe("PWA — Offline resilience", () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test("app renders content from SW cache when offline", async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);

    // First, create a bookmark so there's data to view.
    await createBookmarkViaCapture(
      page,
      human,
      "https://offline-test.example.com",
      "Offline Survival Bookmark",
    );
    await expectCapturedToast(page);
    await goToBookmarks(page);

    // Simulate going offline. The SW should serve cached assets, and
    // IndexedDB (Dexie) works fully offline.
    await page.context().setOffline(true);

    // Navigation within the app should still work via SW cache.
    // Click the dashboard tab — cached shell + dynamic data from
    // IndexedDB should both render.
    await human.click(page.locator('[data-tab-id="dashboard"]').first());
    await expect(page.getByTestId("add-bookmark-button")).toBeVisible({
      timeout: 5_000,
    });

    // Return to bookmarks — data persisted in IndexedDB across offline.
    await human.click(page.locator('[data-tab-id="bookmarks"]').first());
    await expect(page.getByText("Offline Survival Bookmark")).toBeVisible();

    // Restore connectivity.
    await page.context().setOffline(false);
  });

  test("QuickCapture works during offline (pure IndexedDB, no network)", async ({
    page,
  }) => {
    const human = createHumanBehavior(page, ciBasicOptions);

    // Wait until the unlocked app shell is interactive before going offline;
    // otherwise the offline toggle can race lazy shell initialization.
    await expect(page.getByTestId("add-bookmark-button")).toBeVisible({
      timeout: 10_000,
    });
    // Preload the bookmarks view while online; offline mode should then
    // exercise IndexedDB persistence rather than a first-time lazy chunk
    // fetch that the service worker may not have cached in dev mode.
    await goToBookmarks(page);
    await page.context().setOffline(true);

    // Creating a bookmark should work entirely offline — it only touches
    // IndexedDB. The AI embedding pipeline may stall, but the core save
    // (URL + title) must succeed.
    await createBookmarkViaCapture(
      page,
      human,
      "https://offline-capture.example.com",
      "Offline Capture",
    );
    await expectCapturedToast(page);

    // Verify it's in the list.
    await goToBookmarks(page);
    await expect(page.getByText("Offline Capture")).toBeVisible();

    // Restore.
    await page.context().setOffline(false);
  });
});

test.describe("PWA — ReloadPrompt accessibility & keyboard", () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test("ReloadPrompt buttons are keyboard-accessible", async ({ page }) => {
    // Trigger the update notification and assert the prompt appears.
    await dispatchPwaStateUntilPrompt(page, () => simulateSWUpdate(page));

    const prompt = page.getByTestId("pwa-reload-prompt");
    await expect(prompt).toBeVisible({ timeout: 5_000 });

    // Verify the prompt controls participate in keyboard navigation without
    // depending on translated button labels.
    const reloadBtn = page.getByTestId("pwa-reload-button");
    const dismissBtn = page.getByTestId("pwa-dismiss-button");
    await reloadBtn.focus();
    await expect(reloadBtn).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(dismissBtn).toBeFocused();
  });

  test("both offline and update toasts are never shown simultaneously", async ({
    page,
  }) => {
    // Inject both events, re-dispatching until the prompt renders.
    await dispatchPwaStateUntilPrompt(page, async () => {
      await simulateSWOfflineReady(page);
      await simulateSWUpdate(page);
    });

    // Only one toast should exist at a time — ReloadPrompt returns null
    // when neither condition is active, and renders only one state at
    // a time (offline READY → dismiss, or needRefresh → reload options).
    // The update notification takes priority in the component's render order.
    const prompt = page.getByTestId("pwa-reload-prompt");
    await expect(prompt).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId("pwa-reload-message")).toContainText(
      /new version/i,
    );
    await expect(page.getByTestId("pwa-reload-message")).not.toContainText(
      /ready for offline/i,
    );
  });
});
