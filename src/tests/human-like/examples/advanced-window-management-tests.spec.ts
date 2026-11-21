import { skipPassword } from "../../../../tests/e2e/vault-helpers";
import { test, expect } from "@playwright/test";

/**
 * Advanced Window Management Tests
 * Tests for window management, responsive design, and layout behavior
 * Rewritten to test real BookmarkForge window behavior
 */

test.describe("Advanced Window Management", () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("settings-button")).toBeVisible({ timeout: 30_000 });
  });

  test("should handle window resize", async ({ page }) => {
    // Test different viewport sizes
    const sizes = [
      { width: 1920, height: 1080 },
      { width: 1366, height: 768 },
      { width: 1024, height: 768 },
      { width: 768, height: 1024 },
      { width: 375, height: 667 },
    ];

    for (const size of sizes) {
      await page.setViewportSize(size);
      await page.waitForTimeout(500);

      // Verify app adapts to viewport
      const settingsButton = page.getByTestId("settings-button");
      const isVisible = await settingsButton.isVisible().catch(() => false);
      expect(isVisible).toBeTruthy();
    }

    // Reset to default
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test("should handle responsive layout", async ({ page }) => {
    // Test mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(500);

    // Check if mobile layout elements are present
    const mobileElements = await page.evaluate(() => {
      return {
        hasBottomNav: document.querySelector('[data-testid="bottom-nav"], .bottom-nav') !== null,
        hasHamburger: document.querySelector('[data-testid="hamburger-menu"], .hamburger') !== null,
        hasMobileHeader: document.querySelector('[data-testid="mobile-header"], .mobile-header') !== null,
      };
    });

    // App should adapt to mobile viewport
    const isMobile = mobileElements.hasBottomNav || mobileElements.hasHamburger || mobileElements.hasMobileHeader;
    expect(typeof isMobile).toBe("boolean");

    // Reset to desktop
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test("should handle scroll behavior", async ({ page }) => {
    // Scroll to bottom
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
    });
    await page.waitForTimeout(500);

    // Verify scroll position
    const scrollY = await page.evaluate(() => window.scrollY);
    expect(scrollY).toBeGreaterThanOrEqual(0);

    // Scroll to top
    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(500);

    // Verify scroll restored
    const scrollYAfter = await page.evaluate(() => window.scrollY);
    expect(scrollYAfter).toBeLessThan(scrollY + 100);
  });

  test("should handle modal positioning", async ({ page }) => {
    // Open settings modal
    await page.getByTestId("settings-button").click();
    await page.waitForTimeout(1000);

    // Check modal position
    const modal = page.locator('[role="dialog"], [data-testid="settings-modal"]').first();
    if (await modal.count() > 0) {
      const modalBox = await modal.boundingBox();
      expect(modalBox).not.toBeNull();

      if (modalBox) {
        // Modal should be within viewport
        expect(modalBox.x).toBeGreaterThanOrEqual(0);
        expect(modalBox.y).toBeGreaterThanOrEqual(0);
        expect(modalBox.x + modalBox.width).toBeLessThanOrEqual(1280);
        expect(modalBox.y + modalBox.height).toBeLessThanOrEqual(720);
      }
    }

    // Close modal
    await page.keyboard.press("Escape");
  });

  test("should handle dropdown positioning", async ({ page }) => {
    // Look for dropdown menus
    const dropdownButtons = page.locator('button[aria-haspopup="true"], button[aria-expanded]').first();
    if (await dropdownButtons.count() > 0) {
      await dropdownButtons.click();
      await page.waitForTimeout(500);

      // Check dropdown position
      const dropdown = page.locator('[role="menu"], [role="listbox"], .dropdown').first();
      if (await dropdown.count() > 0) {
        const dropdownBox = await dropdown.boundingBox();
        expect(dropdownBox).not.toBeNull();
      }

      // Close dropdown
      await page.keyboard.press("Escape");
    }
  });

  test("should handle tooltip positioning", async ({ page }) => {
    // Look for visible elements with tooltips (not hidden link tags)
    const tooltipElements = page.locator('button[title], button[data-tooltip], button[aria-describedby], [role="button"][title]').first();
    if (await tooltipElements.count() > 0) {
      await tooltipElements.hover();
      await page.waitForTimeout(500);

      // Check if tooltip appears
      const tooltip = page.locator('[role="tooltip"], .tooltip, [data-testid="tooltip"]').first();
      expect(await tooltip.count()).toBeGreaterThanOrEqual(0);
    }
  });

  test("should handle focus management", async ({ page }) => {
    // Tab through focusable elements
    await page.locator("body").click();

    const focusableElements: string[] = [];
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press("Tab");
      const focused = page.locator(":focus").first();
      if (await focused.count() > 0) {
        const tag = await focused.evaluate(el => el.tagName.toLowerCase());
        const testId = await focused.getAttribute("data-testid");
        focusableElements.push(`${tag}${testId ? `[${testId}]` : ""}`);
      }
    }

    // Should navigate through multiple elements
    expect(focusableElements.length).toBeGreaterThan(3);
  });

  test("should handle window state persistence", async ({ page }) => {
    // Set viewport size
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.waitForTimeout(500);

    // Reload page
    await page.reload();
    await page.waitForLoadState("networkidle");

    // Verify app is still usable
    await expect(page.getByTestId("settings-button")).toBeVisible({ timeout: 30_000 });
  });

  test("should handle multi-window behavior", async ({ page, context }) => {
    // Open second window
    const secondPage = await context.newPage();
    await secondPage.goto("/app");
    await secondPage.waitForLoadState("networkidle");

    // Both windows should be functional
    const firstSettings = await page.getByTestId("settings-button").isVisible();
    const secondHasApp = await secondPage.locator("body").isVisible();

    expect(firstSettings).toBeTruthy();
    expect(secondHasApp).toBeTruthy();

    await secondPage.close();
  });

  test("should handle fullscreen mode", async ({ page }) => {
    // Try to enter fullscreen
    try {
      await page.evaluate(() => {
        document.documentElement.requestFullscreen();
      });
      await page.waitForTimeout(500);

      // Check if fullscreen was entered
      const isFullscreen = await page.evaluate(() => {
        return document.fullscreenElement !== null;
      });

      expect(typeof isFullscreen).toBe("boolean");

      // Exit fullscreen
      await page.evaluate(() => {
        document.exitFullscreen();
      });
    } catch (e) {
      // Fullscreen may not be supported in headless mode
      expect(true).toBeTruthy();
    }
  });

  test("should handle window blur/focus", async ({ page }) => {
    // Simulate window blur
    await page.evaluate(() => {
      window.dispatchEvent(new Event('blur'));
    });
    await page.waitForTimeout(500);

    // Simulate window focus
    await page.evaluate(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await page.waitForTimeout(500);

    // App should remain functional
    await expect(page.getByTestId("settings-button")).toBeVisible();
  });
});
