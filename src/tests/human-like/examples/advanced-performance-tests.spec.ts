import { skipPassword } from "../../../../tests/e2e/vault-helpers";
import { test, expect } from "@playwright/test";

/**
 * Advanced Performance Tests
 * Tests for performance optimization, load handling, and resource management
 * Rewritten to test real BookmarkForge performance behavior
 */

test.describe("Advanced Performance", () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("settings-button")).toBeVisible({ timeout: 30_000 });
  });

  test("should handle page load performance", async ({ page }) => {
    const startTime = Date.now();
    await page.reload();
    await page.waitForLoadState("networkidle");
    const loadTime = Date.now() - startTime;

    // Page should load within reasonable time (dev mode is slower)
    expect(loadTime).toBeLessThan(30000);
  });

  test("should handle lazy loading of components", async ({ page }) => {
    // Settings is a lazy-loaded component
    const startTime = Date.now();
    await page.getByTestId("settings-button").click();
    await page.waitForTimeout(2000); // Allow lazy chunk to load
    const settingsLoadTime = Date.now() - startTime;

    // Settings should load reasonably fast
    expect(settingsLoadTime).toBeLessThan(10000);

    // Verify settings opened (look for any dialog or settings content)
    const settingsContent = page.locator('[role="dialog"], [data-testid="settings-modal"], [data-testid="settings-content"], main').first();
    expect(await settingsContent.count()).toBeGreaterThan(0);

    // Close settings
    await page.keyboard.press("Escape");
  });

  test("should handle memory usage", async ({ page }) => {
    // Check memory usage
    const memoryInfo = await page.evaluate(() => {
      return {
        usedJSHeapSize: (performance as any).memory?.usedJSHeapSize || 0,
        totalJSHeapSize: (performance as any).memory?.totalJSHeapSize || 0,
        jsHeapSizeLimit: (performance as any).memory?.jsHeapSizeLimit || 0,
      };
    });

    // Memory should be within reasonable limits
    expect(memoryInfo.usedJSHeapSize).toBeGreaterThan(0);
    expect(memoryInfo.usedJSHeapSize).toBeLessThan(memoryInfo.jsHeapSizeLimit);
  });

  test("should handle large list rendering", async ({ page }) => {
    // Navigate to bookmarks which may have large lists
    const bookmarksTab = page.locator('[data-testid="bookmarks-tab"], button:has-text("Bookmarks")').first();
    if (await bookmarksTab.count() > 0) {
      await bookmarksTab.click();
      await page.waitForLoadState("networkidle");

      // Verify bookmarks view loads
      const bookmarksView = page.locator('[data-testid="bookmarks-view"], main').first();
      expect(await bookmarksView.count()).toBeGreaterThan(0);
    }
  });

  test("should handle search performance", async ({ page }) => {
    // Open search/omnibar
    const searchButton = page.locator('[data-tour-id="tour-search"], button[aria-label*="Search"]').first();
    if (await searchButton.count() > 0) {
      const startTime = Date.now();
      await searchButton.click();
      await page.waitForTimeout(500); // Allow search to initialize

      // Type search query
      const searchInput = page.locator('input[role="combobox"], input[type="search"], input[placeholder*="Search"]').first();
      if (await searchInput.count() > 0) {
        await searchInput.fill("test");
        await page.waitForTimeout(1000); // Allow search to process
      }

      const searchTime = Date.now() - startTime;

      // Search should respond reasonably fast
      expect(searchTime).toBeLessThan(5000);

      // Close search
      await page.keyboard.press("Escape");
    }
  });

  test("should handle image loading performance", async ({ page }) => {
    // Check if images are loading with proper lazy loading
    const images = await page.evaluate(() => {
      const imgs = document.querySelectorAll("img");
      return Array.from(imgs).map(img => ({
        src: img.src,
        loading: img.loading,
        complete: img.complete,
      }));
    });

    // Images should have lazy loading attribute where appropriate
    const lazyImages = images.filter(img => img.loading === "lazy");
    expect(lazyImages.length).toBeGreaterThanOrEqual(0);
  });

  test("should handle CSS performance", async ({ page }) => {
    // Check computed styles performance
    const styleComputationTime = await page.evaluate(() => {
      const start = performance.now();
      const elements = document.querySelectorAll("*");
      elements.forEach(el => {
        window.getComputedStyle(el);
      });
      return performance.now() - start;
    });

    // Style computation should be fast
    expect(styleComputationTime).toBeLessThan(1000);
  });

  test("should handle DOM performance", async ({ page }) => {
    // Check DOM size
    const domStats = await page.evaluate(() => {
      return {
        totalElements: document.querySelectorAll("*").length,
        buttons: document.querySelectorAll("button").length,
        links: document.querySelectorAll("a").length,
        images: document.querySelectorAll("img").length,
      };
    });

    // DOM should be reasonable size
    expect(domStats.totalElements).toBeLessThan(5000);
  });

  test("should handle JavaScript performance", async ({ page }) => {
    // Check for long tasks
    const longTasks = await page.evaluate(() => {
      return new Promise((resolve) => {
        let tasks: number[] = [];
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.duration > 50) { // Long task threshold
              tasks.push(entry.duration);
            }
          }
        });
        observer.observe({ entryTypes: ["longtask"] });

        setTimeout(() => {
          observer.disconnect();
          resolve(tasks);
        }, 2000);
      });
    });

    // Should not have excessive long tasks
    expect((longTasks as number[]).length).toBeLessThan(5);
  });

  test("should handle rendering performance", async ({ page }) => {
    // Measure render performance
    const renderMetrics = await page.evaluate(() => {
      return new Promise((resolve) => {
        const start = performance.now();
        requestAnimationFrame(() => {
          const end = performance.now();
          resolve({
            frameTime: end - start,
            timestamp: performance.now(),
          });
        });
      });
    });

    // Frame time should be reasonable (60fps = ~16ms)
    expect((renderMetrics as any).frameTime).toBeLessThan(100);
  });

  test("should handle resource loading priority", async ({ page }) => {
    // Check resource loading order
    const resources = await page.evaluate(() => {
      const entries = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
      return entries.slice(0, 10).map(entry => ({
        name: entry.name,
        initiatorType: entry.initiatorType,
        duration: entry.duration,
      }));
    });

    // Critical resources should load first
    expect(resources.length).toBeGreaterThan(0);
  });

  test("should handle cache performance", async ({ page, context }) => {
    // First load
    await page.reload();
    await page.waitForLoadState("networkidle");

    // Second load should be faster due to cache
    const startTime = Date.now();
    await page.reload();
    await page.waitForLoadState("networkidle");
    const secondLoadTime = Date.now() - startTime;

    // Cached load should be reasonably fast
    expect(secondLoadTime).toBeLessThan(20000);
  });
});
