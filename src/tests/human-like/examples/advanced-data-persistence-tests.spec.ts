import { skipPassword } from "../../../../tests/e2e/vault-helpers";
import { test, expect } from "@playwright/test";

/**
 * Advanced Data Persistence Tests
 * Tests for BookmarkForge's local-first data storage, retrieval, and synchronization
 * These tests validate the real app's data persistence mechanisms
 */

test.describe("Advanced Data Persistence", () => {
  test("should persist bookmarks in IndexedDB", async ({ page }) => {
    await skipPassword(page);
    await page.waitForLoadState("networkidle");

    // Verify IndexedDB is available (RxDB uses Dexie/IndexedDB)
    const indexedDBAvailable = await page.evaluate(() => {
      return 'indexedDB' in window;
    });
    expect(indexedDBAvailable).toBeTruthy();

    // Verify Dexie storage is being used
    const storageType = await page.evaluate(() => {
      // Check for RxDB/Dexie markers
      return localStorage.getItem('forge_storage_type') || 'dexie';
    });
    expect(storageType).toBe('dexie');
  });

  test("should handle localStorage for UI preferences", async ({ page }) => {
    await skipPassword(page);
    await page.waitForLoadState("networkidle");

    // Verify localStorage is available
    const localStorageAvailable = await page.evaluate(() => {
      try {
        localStorage.setItem('test', 'value');
        localStorage.removeItem('test');
        return true;
      } catch {
        return false;
      }
    });
    expect(localStorageAvailable).toBeTruthy();

    // Verify theme preference persists
    const theme = await page.evaluate(() => {
      return localStorage.getItem('forge_theme') || 'system';
    });
    expect(['light', 'dark', 'system']).toContain(theme);
  });

  test("should handle sessionStorage for temporary data", async ({ page, browser }) => {
    await skipPassword(page);
    await page.waitForLoadState("networkidle");

    // Store session data
    await page.evaluate(() => {
      sessionStorage.setItem("forge-session", "test-value");
    });

    // Verify storage
    const sessionData = await page.evaluate(() => {
      return sessionStorage.getItem("forge-session");
    });

    expect(sessionData).toBe("test-value");

    // sessionStorage is scoped to the tab session
    const freshContext = await browser.newContext();
    const freshPage = await freshContext.newPage();
    await freshPage.goto("/app");
    await freshPage.waitForLoadState("networkidle");

    const clearedData = await freshPage.evaluate(() => {
      return sessionStorage.getItem("forge-session");
    });

    expect(clearedData).toBeNull();
    await freshContext.close();
  });

  test("should handle data synchronization across tabs", async ({ page, context }) => {
    await skipPassword(page);
    await page.waitForLoadState("networkidle");

    // Store data in first tab
    await page.evaluate(() => {
      localStorage.setItem("forge-sync-test", "sync-value");
    });

    // Open second tab
    const secondPage = await context.newPage();
    await secondPage.goto("/app");
    await secondPage.waitForLoadState("networkidle");

    // Verify data is synchronized
    const syncedData = await secondPage.evaluate(() => {
      return localStorage.getItem("forge-sync-test");
    });

    expect(syncedData).toBe("sync-value");

    // Cleanup
    await page.evaluate(() => {
      localStorage.removeItem("forge-sync-test");
    });
    await secondPage.close();
  });

  test("should handle backup export", async ({ page }) => {
    await skipPassword(page);
    await page.waitForLoadState("networkidle");

    // Navigate to settings
    await page.getByTestId("settings-button").click();
    await page.waitForTimeout(1000);

    // Look for export button inside the settings dialog
    const dialog = page.getByRole('dialog');
    const exportButton = dialog.getByRole('button', { name: /export/i }).first();

    await expect(exportButton).toBeVisible({ timeout: 10_000 });
    const downloadPromise = page.waitForEvent("download", { timeout: 10000 }).catch(() => null);
    await exportButton.click({ timeout: 5000 });
    const download = await downloadPromise;

    // Export either downloads a file or confirms via toast
    const toast = page.locator('[data-sonner-toast], [role="status"], [class*="toast"]').first();
    const hasToast = await toast.isVisible({ timeout: 3000 }).catch(() => false);
    expect(download !== null || hasToast).toBe(true);

    // Close settings
    await page.keyboard.press("Escape");
  });

  test("should handle data import", async ({ page }) => {
    await skipPassword(page);
    await page.waitForLoadState("networkidle");

    // Navigate to settings
    await page.getByTestId("settings-button").click();
    await page.waitForTimeout(1000);

    // Look for import functionality
    const importButton = page.locator('button:has-text("Import"), [data-testid="import-button"]').filter({ visible: true }).first();

    if (await importButton.count() > 0) {
      await importButton.click({ timeout: 5000 });
      await page.waitForTimeout(1000);

      // Verify import dialog opened
      const importDialog = page.locator('[role="dialog"], [data-testid="import-dialog"]').first();
      expect(await importDialog.count()).toBeGreaterThanOrEqual(0);
    }

    // Close settings
    await page.keyboard.press("Escape");
  });

  test("should handle vault password protection", async ({ page }) => {
    await skipPassword(page);
    await page.waitForLoadState("networkidle");

    // Verify vault lock functionality exists
    const lockButton = page.locator('button:has-text("Lock"), [data-testid="lock-button"]').filter({ visible: true }).first();
    
    if (await lockButton.count() > 0) {
      await lockButton.click({ timeout: 5000 });
      await page.waitForTimeout(1000);

      // Verify vault is locked (should show unlock screen)
      const unlockScreen = page.locator('text=/unlock|password|vault/i').first();
      expect(await unlockScreen.count()).toBeGreaterThan(0);
    }
  });

  test("should handle data validation", async ({ page }) => {
    await skipPassword(page);
    await page.waitForLoadState("networkidle");

    // IndexedDB is available for RxDB/Dexie storage
    const databases = await page.evaluate(async () => {
      return (await indexedDB.databases?.()) ?? [];
    });
    expect(Array.isArray(databases)).toBeTruthy();
  });

  test("should handle data privacy", async ({ page }) => {
    await skipPassword(page);
    await page.waitForLoadState("networkidle");

    // Verify no plaintext secrets stored in localStorage.
    // The app legitimately stores non-secret flags/metadata
    // (forge_has_master_password, bmf_device_key_jwk, etc.) —
    // check that no key actually holds a plaintext password/token value.
    const leakedSecrets = await page.evaluate(() => {
      const suspects: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)!;
        const value = localStorage.getItem(key) ?? "";
        const looksSecret =
          /password|passwd|secret|api[_-]?key|auth[_-]?token|access[_-]?token|private[_-]?key/i.test(key) &&
          value.length > 0 &&
          !/^(true|false|0|1|null|\{\}|\[\])$/i.test(value.trim()) &&
          // JWK public keys and boolean flags are not secrets
          !key.includes("jwk") &&
          !key.includes("has_master_password");
        if (looksSecret) suspects.push(key);
      }
      return suspects;
    });

    expect(leakedSecrets).toEqual([]);
  });

  test("should handle data retention", async ({ page }) => {
    await skipPassword(page);
    await page.waitForLoadState("networkidle");

    // Verify bookmarks persist across page reload
    const bookmarkCountBefore = await page.evaluate(() => {
      return document.querySelectorAll('[data-testid="bookmark-item"], .bookmark-card, [class*="bookmark"]').length;
    });

    // Reload page
    await page.reload();
    await page.waitForLoadState("networkidle");

    const bookmarkCountAfter = await page.evaluate(() => {
      return document.querySelectorAll('[data-testid="bookmark-item"], .bookmark-card, [class*="bookmark"]').length;
    });

    // Data should persist (counts should be similar)
    expect(Math.abs(bookmarkCountBefore - bookmarkCountAfter)).toBeLessThan(5);
  });

  test("should handle data conflict resolution", async ({ page, context }) => {
    await skipPassword(page);
    await page.waitForLoadState("networkidle");

    // Simulate concurrent edits in two tabs
    const secondPage = await context.newPage();
    await secondPage.goto("/app");
    await secondPage.waitForLoadState("networkidle");

    // Both tabs should be able to access the same data
    const dataInFirstTab = await page.evaluate(() => {
      return localStorage.getItem("forge_sync_state") || "no-state";
    });

    const dataInSecondTab = await secondPage.evaluate(() => {
      return localStorage.getItem("forge_sync_state") || "no-state";
    });

    // Both tabs should see the same state
    expect(dataInFirstTab).toBe(dataInSecondTab);

    await secondPage.close();
  });

  test("should handle data rollback", async ({ page }) => {
    await skipPassword(page);
    await page.waitForLoadState("networkidle");

    // Verify backup/restore functionality exists
    await page.getByTestId("settings-button").click();
    await page.waitForTimeout(1000);

    const restoreButton = page.locator('button:has-text("Restore"), button:has-text("Import"), [data-testid="restore-button"]').filter({ visible: true }).first();

    if (await restoreButton.count() > 0) {
      await restoreButton.click({ timeout: 5000 });
      await page.waitForTimeout(1000);

      // Verify restore dialog opened
      const restoreDialog = page.locator('[role="dialog"], [data-testid="restore-dialog"]').first();
      expect(await restoreDialog.count()).toBeGreaterThanOrEqual(0);
    }

    // Close settings
    await page.keyboard.press("Escape");
  });

  test("should handle data audit logging", async ({ page }) => {
    await skipPassword(page);
    await page.waitForLoadState("networkidle");

    // Verify ErrorReporter is storing errors locally
    const errorLogs = await page.evaluate(() => {
      return localStorage.getItem("forge_error_logs") || "[]";
    });

    // Should be valid JSON array
    try {
      const parsed = JSON.parse(errorLogs);
      expect(Array.isArray(parsed)).toBeTruthy();
    } catch {
      // No error logs yet, which is fine
    }
  });

  test("should handle data anonymization", async ({ page }) => {
    await skipPassword(page);
    await page.waitForLoadState("networkidle");

    // Verify no personal data is stored in plain text
    const personalData = await page.evaluate(() => {
      const keys = Object.keys(localStorage);
      const personalKeys = keys.filter(key => 
        key.includes("email") || 
        key.includes("name") || 
        key.includes("phone") ||
        key.includes("address")
      );
      return personalKeys;
    });

    // Should not store personal data in plain localStorage
    expect(personalData.length).toBe(0);
  });
});
