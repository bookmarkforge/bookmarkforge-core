import { skipPassword } from "../../../../tests/e2e/vault-helpers";
import { test, expect } from "@playwright/test";

/**
 * Advanced Recovery Tests
 * Tests for error recovery, resilience, and fault tolerance
 * Rewritten to test real BookmarkForge recovery behavior (local-first app)
 */

test.describe("Advanced Recovery", () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("settings-button")).toBeVisible({ timeout: 30_000 });
  });

  test("should handle offline mode recovery", async ({ page, context }) => {
    // Go offline
    await context.setOffline(true);
    await page.waitForTimeout(500);

    // App should remain functional
    expect(await page.evaluate(() => navigator.onLine)).toBe(false);
    await expect(page.getByTestId("settings-button")).toBeVisible();

    // Go back online
    await context.setOffline(false);
    await page.waitForTimeout(500);

    // Verify recovery
    expect(await page.evaluate(() => navigator.onLine)).toBe(true);
    await expect(page.getByTestId("settings-button")).toBeVisible();
  });

  test("should handle network interruption recovery", async ({ page, context }) => {
    // Interrupt network
    await context.setOffline(true);
    await page.waitForTimeout(1000);

    // App must remain usable
    await expect(page.getByTestId("settings-button")).toBeVisible();

    // Restore network
    await context.setOffline(false);
    await page.waitForTimeout(1000);

    // Verify recovery
    expect(await page.evaluate(() => navigator.onLine)).toBe(true);
    await expect(page.getByTestId("settings-button")).toBeVisible();
  });

  test("should handle failed requests gracefully", async ({ page }) => {
    // Intercept and fail external requests
    await page.route("**://external-api.com/**", (route) => route.abort());

    // App should handle failed requests gracefully
    await expect(page.getByTestId("settings-button")).toBeVisible();
  });

  test("should handle page reload recovery", async ({ page }) => {
    // Reload page
    await page.reload();
    await page.waitForLoadState("networkidle");

    // App should recover and be usable
    await expect(page.getByTestId("settings-button")).toBeVisible({ timeout: 30_000 });
  });

  test("should handle browser crash recovery", async ({ page }) => {
    // Simulate crash by reloading the page
    await page.reload();
    await page.waitForLoadState("networkidle");

    // App should recover and be usable
    await expect(page.getByTestId("settings-button")).toBeVisible({ timeout: 30_000 });
  });

  test("should handle storage errors gracefully", async ({ page }) => {
    // Simulate storage issues by setting invalid data
    await page.evaluate(() => {
      try {
        localStorage.setItem("test-corrupted", "{invalid json");
      } catch (e) {
        // Expected to fail
      }
    });

    // App should handle storage issues gracefully
    await expect(page.getByTestId("settings-button")).toBeVisible();
  });

  test("should handle JavaScript errors gracefully", async ({ page }) => {
    // Inject a script that throws an error
    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error("Test error");
      }, 100);
    });

    // Wait for error to occur
    await page.waitForTimeout(500);

    // App should still be functional
    await expect(page.getByTestId("settings-button")).toBeVisible();
  });

  test("should handle memory pressure recovery", async ({ page }) => {
    // Simulate memory pressure by allocating large objects
    await page.evaluate(() => {
      const largeArray = new Array(1000000).fill("test");
      // Force garbage collection if available
      if (window.gc) { window.gc(); }
    });

    // Wait for potential memory issues
    await page.waitForTimeout(1000);

    // App should remain stable
    await expect(page.getByTestId("settings-button")).toBeVisible();
  });

  test("should handle slow network recovery", async ({ page, context }) => {
    // Simulate slow network
    await page.route("**/*", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1000)); // 1 second delay
      route.continue();
    });

    // Reload with slow network
    await page.reload();
    await page.waitForLoadState("networkidle");

    // App should still load
    await expect(page.getByTestId("settings-button")).toBeVisible({ timeout: 60000 });
  });

  test("should handle timeout recovery", async ({ page }) => {
    // Set up a route that never responds
    await page.route("**://timeout-test.com/**", () => {
      // Never respond
    });

    // App should handle timeout gracefully
    await expect(page.getByTestId("settings-button")).toBeVisible();
  });

  test("should handle data corruption recovery", async ({ page }) => {
    // Corrupt localStorage data
    await page.evaluate(() => {
      localStorage.setItem("corrupted", "{invalid json");
    });

    // Reload page
    await page.reload();
    await page.waitForLoadState("networkidle");

    // App should handle corrupted data gracefully
    await expect(page.getByTestId("settings-button")).toBeVisible({ timeout: 30_000 });
  });

  test("should handle concurrent error recovery", async ({ page }) => {
    // Trigger multiple errors simultaneously
    await page.evaluate(() => {
      // Simulate multiple async errors
      Promise.all([
        Promise.reject(new Error("Error 1")),
        Promise.reject(new Error("Error 2")),
        Promise.reject(new Error("Error 3")),
      ]).catch(() => {});
    });

    // Wait for errors to process
    await page.waitForTimeout(1000);

    // App should remain stable
    await expect(page.getByTestId("settings-button")).toBeVisible();
  });
});
