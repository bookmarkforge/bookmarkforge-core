/**
 * Advanced Human Actions Tests
 * Tests for human-like interaction patterns and behavioral scenarios
 * Rewritten to test real BookmarkForge user behavior
 */

import { test, expect } from '@playwright/test';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';

test.describe('Advanced Human Actions Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("settings-button")).toBeVisible({ timeout: 30_000 });
  });

  test('should handle realistic user navigation', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);

    // Simulate realistic navigation pattern
    const tabs = ['Dashboard', 'Bookmarks', 'Documents', 'Graph'];

    for (const tabName of tabs) {
      const tabButton = page.locator(`button:has-text("${tabName}")`).first();
      if (await tabButton.count() > 0) {
        await human.click(tabButton);
        await page.waitForTimeout(500);
      }
    }

    // Verify app is still functional
    await expect(page.getByTestId("settings-button")).toBeVisible();
  });

  test('should handle realistic form filling', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);

    // Open bookmark creation
    const addButton = page.getByTestId("add-bookmark-button");
    if (await addButton.count() > 0) {
      await human.click(addButton);
      await page.waitForTimeout(500);

      // Fill form with human-like delays
      const titleInput = page.getByTestId("bookmark-title-input");
      if (await titleInput.count() > 0) {
        await human.type(titleInput, "Test Bookmark Title");
      }

      const urlInput = page.locator('input[type="url"], input[placeholder*="URL"]').first();
      if (await urlInput.count() > 0) {
        await human.type(urlInput, "https://example.com");
      }

      // Save bookmark
      const saveButton = page.getByTestId("save-bookmark-button");
      if (await saveButton.count() > 0 && await saveButton.isEnabled()) {
        await human.click(saveButton);
        await page.waitForTimeout(1000);
      }
    }

    // Verify app is still functional after form interaction
    await expect(page.getByTestId("settings-button")).toBeVisible();
  });

  test('should handle realistic search behavior', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);

    // Open search
    const searchButton = page.locator('[data-tour-id="tour-search"], button[aria-label*="Search"]').first();
    if (await searchButton.count() > 0) {
      await human.click(searchButton);
      await page.waitForTimeout(500);

      // Type search query with human-like delays
      const searchInput = page.locator('input[role="combobox"], input[type="search"]').first();
      if (await searchInput.count() > 0) {
        await human.type(searchInput, "test search query");
        await page.waitForTimeout(1000);
      }

      // Close search
      await page.keyboard.press("Escape");
    }

    // Verify app is still functional after search interaction
    await expect(page.getByTestId("settings-button")).toBeVisible();
  });

  test('should handle realistic settings interaction', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);

    // Open settings
    await human.click(page.getByTestId("settings-button"));
    await page.waitForTimeout(1000);

    // Interact with settings options
    const checkboxes = page.locator('input[type="checkbox"]');
    const checkboxCount = await checkboxes.count();

    if (checkboxCount > 0) {
      // Toggle first checkbox
      await human.click(checkboxes.first());
      await page.waitForTimeout(500);
    }

    // Close settings
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    // Verify app is still functional after settings interaction
    await expect(page.getByTestId("settings-button")).toBeVisible();
  });

  test('should handle realistic scroll behavior', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);

    // Simulate realistic scrolling
    await human.scroll('down', 500);
    await page.waitForTimeout(500);

    await human.scroll('up', 300);
    await page.waitForTimeout(500);

    // Verify app is still functional
    await expect(page.getByTestId("settings-button")).toBeVisible();
  });

  test('should handle realistic keyboard usage', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);

    // Simulate keyboard navigation
    await human.pressKey('Tab');
    await page.waitForTimeout(200);

    await human.pressKey('Tab');
    await page.waitForTimeout(200);

    await human.pressKey('Enter');
    await page.waitForTimeout(500);

    // Verify app is still functional
    await expect(page.getByTestId("settings-button")).toBeVisible();
  });
});
