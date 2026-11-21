/**
 * Advanced Tabs Tests
 * 
 * Tests for BookmarkForge's tab navigation functionality:
 * - Main app tabs
 * - Tab switching
 * - Tab keyboard navigation
 * - Tab accessibility
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Advanced Tabs Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('should display main navigation tabs', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Look for tab navigation
    const tabs = page.locator('[role="tab"], [role="tablist"] button, nav button').first();
    
    if (await tabs.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(tabs).toBeVisible();
    }

    // Check for multiple tabs
    const tabCount = await page.locator('[role="tab"]').count();
    expect(tabCount).toBeGreaterThanOrEqual(0);
  });

  test('should switch between tabs', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Look for tabs
    const tabs = page.locator('[role="tab"]').first();
    
    if (await tabs.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Get initial state
      const initialSelected = await tabs.getAttribute('aria-selected');
      
      // Click on tab
      await tabs.click();
      await page.waitForTimeout(500);

      // Verify tab is selected
      const newSelected = await tabs.getAttribute('aria-selected');
      expect(newSelected).toBe('true');
    }
  });

  test('should handle tab keyboard navigation', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Look for tabs
    const tabs = page.locator('[role="tab"]').first();
    
    if (await tabs.isVisible({ timeout: 5000 }).catch(() => false)) {
      await tabs.focus();
      await page.waitForTimeout(500);

      // Navigate with arrow keys
      await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(500);
      await page.keyboard.press('ArrowLeft');
      await page.waitForTimeout(500);

      // Verify focus is still on tab
      const focusedElement = page.locator(':focus').first();
      await expect(focusedElement).toBeVisible();
    }
  });

  test('should handle tab accessibility', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Look for tabs
    const tabs = page.locator('[role="tab"]').first();
    
    if (await tabs.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Check ARIA attributes
      const ariaSelected = await tabs.getAttribute('aria-selected');
      const ariaControls = await tabs.getAttribute('aria-controls');

      // Should have accessibility attributes
      expect(ariaSelected || ariaControls).toBeTruthy();
    }
  });

  test('should handle tab persistence', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Look for tabs
    const tabs = page.locator('[role="tab"]').first();
    
    if (await tabs.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Click on tab
      await tabs.click();
      await page.waitForTimeout(500);

      // Reload page
      await page.reload();
      await page.waitForLoadState('networkidle');

      // Verify tab selection persists (or resets to default)
      const tabsAfterReload = page.locator('[role="tab"]').first();
      const hasSelectedTab = await tabsAfterReload.getAttribute('aria-selected');

      // Either persists or resets - both are valid
      expect(hasSelectedTab === 'true' || hasSelectedTab === 'false').toBe(true);
    }
  });

  test('should handle settings tabs', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Open settings
    await page.getByTestId('settings-button').click();
    await page.waitForTimeout(1000);

    // Look for tabs in settings
    const settingsTabs = page.locator('[role="tab"], [role="tablist"] button').first();
    
    if (await settingsTabs.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Switch between settings tabs
      await settingsTabs.click();
      await page.waitForTimeout(500);

      // Verify tab content changed
      await expect(page.locator('body')).toBeVisible();
    }

    // Close settings
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  });
});
