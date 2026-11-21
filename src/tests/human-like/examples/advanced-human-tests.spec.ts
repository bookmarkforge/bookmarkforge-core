/**
 * Advanced Human Tests
 * Tests for human-like interaction patterns and behavioral scenarios
 * Rewritten to test real BookmarkForge human behavior
 */

import { test, expect } from '@playwright/test';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';

test.describe('Advanced Human Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("settings-button")).toBeVisible({ timeout: 30_000 });
  });

  test('should simulate realistic user journey', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);

    // Simulate a realistic user journey through the app
    // 1. Start on dashboard
    await expect(page.getByTestId("settings-button")).toBeVisible();

    // 2. Navigate to bookmarks
    const bookmarksTab = page.locator('button:has-text("Bookmarks")').first();
    if (await bookmarksTab.count() > 0) {
      await human.click(bookmarksTab);
      await page.waitForTimeout(500);
    }

    // 3. Create a bookmark
    const addButton = page.getByTestId("add-bookmark-button");
    if (await addButton.count() > 0) {
      await human.click(addButton);
      await page.waitForTimeout(500);

      const titleInput = page.getByTestId("bookmark-title-input");
      if (await titleInput.count() > 0) {
        await human.type(titleInput, "Human Test Bookmark");
      }

      const urlInput = page.locator('input[type="url"], input[placeholder*="URL"]').first();
      if (await urlInput.count() > 0) {
        await human.type(urlInput, "https://example.com/human");
      }

      const saveButton = page.getByTestId("save-bookmark-button");
      if (await saveButton.count() > 0 && await saveButton.isEnabled()) {
        await human.click(saveButton);
        await page.waitForTimeout(1000);
      }
    }

    // 4. Navigate back to dashboard
    const dashboardTab = page.locator('button:has-text("Dashboard")').first();
    if (await dashboardTab.count() > 0) {
      await human.click(dashboardTab);
      await page.waitForTimeout(500);
    }

    // Verify app is still functional
    await expect(page.getByTestId("settings-button")).toBeVisible();
  });

  test('should handle realistic user hesitation', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);

    // Simulate user hesitation (mouse movements without clicks)
    await human.moveMouse(100, 100);
    await page.waitForTimeout(500);

    await human.moveMouse(200, 200);
    await page.waitForTimeout(500);

    await human.moveMouse(300, 300);
    await page.waitForTimeout(500);

    // Eventually click something
    const settingsButton = page.getByTestId("settings-button");
    await human.click(settingsButton);
    await page.waitForTimeout(1000);

    // Close settings
    await page.keyboard.press("Escape");
  });

  test('should handle realistic user mistakes', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);

    // Simulate user making a mistake and correcting it
    const addButton = page.getByTestId("add-bookmark-button");
    if (await addButton.count() > 0) {
      await human.click(addButton);
      await page.waitForTimeout(500);

      // Type incorrect URL first
      const urlInput = page.locator('input[type="url"], input[placeholder*="URL"]').first();
      if (await urlInput.count() > 0) {
        await human.type(urlInput, "invalid-url");
        await page.waitForTimeout(500);

        // Clear and type correct URL
        await urlInput.clear();
        await human.type(urlInput, "https://example.com");
      }

      // Close without saving (user changed mind)
      await page.keyboard.press("Escape");
    }
  });

  test('should handle realistic user multitasking', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);

    // Simulate multitasking (rapid tab switching)
    const tabs = ['Dashboard', 'Bookmarks', 'Documents', 'Graph', 'Canvas'];

    for (let i = 0; i < 2; i++) { // Two rounds
      for (const tabName of tabs) {
        const tabButton = page.locator(`button:has-text("${tabName}")`).first();
        if (await tabButton.count() > 0) {
          await human.click(tabButton);
          await page.waitForTimeout(300); // Quick switch
        }
      }
    }

    // Verify app is still stable
    await expect(page.getByTestId("settings-button")).toBeVisible();
  });

  test('should handle realistic user patience', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);

    // Simulate patient user (longer waits)
    await page.waitForTimeout(2000);

    // Then perform action
    const settingsButton = page.getByTestId("settings-button");
    await human.click(settingsButton);
    await page.waitForTimeout(2000);

    // Close settings
    await page.keyboard.press("Escape");
  });
});
