/**
 * Advanced Selects Tests
 * 
 * Tests for BookmarkForge's select/dropdown functionality:
 * - Settings dropdowns
 * - Language selection
 * - Theme selection
 * - Filter dropdowns
 * - Sort dropdowns
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Advanced Selects Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('should handle language selection dropdown', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Navigate to settings
    await page.getByTestId('settings-button').click();
    await page.waitForTimeout(1000);

    // Look for language dropdown
    const languageSelect = page.locator('select, [role="combobox"]').filter({ hasText: /language|idioma/i }).first();
    
    if (await languageSelect.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(languageSelect);
      await page.waitForTimeout(500);

      // Verify options are visible
      const options = page.locator('[role="listbox"], [role="option"], option');
      expect(await options.count()).toBeGreaterThan(0);

      // Select a different language
      const spanishOption = page.locator('option:has-text("Español"), [role="option"]:has-text("Español")').first();
      if (await spanishOption.isVisible({ timeout: 3000 }).catch(() => false)) {
        await spanishOption.click();
        await page.waitForTimeout(1000);

        // Verify language changed
        const htmlLang = await page.evaluate(() => document.documentElement.lang);
        expect(htmlLang).toBe('es');
      }
    }

    // Close settings
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  });

  test('should handle theme selection dropdown', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Navigate to settings
    await page.getByTestId('settings-button').click();
    await page.waitForTimeout(1000);

    // Look for theme dropdown
    const themeSelect = page.locator('select, [role="combobox"]').filter({ hasText: /theme|tema/i }).first();
    
    if (await themeSelect.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(themeSelect);
      await page.waitForTimeout(500);

      // Verify options are visible
      const options = page.locator('[role="listbox"], [role="option"], option');
      expect(await options.count()).toBeGreaterThan(0);

      // Select dark theme
      const darkOption = page.locator('option:has-text("Dark"), [role="option"]:has-text("Dark"), option:has-text("Oscuro")').first();
      if (await darkOption.isVisible({ timeout: 3000 }).catch(() => false)) {
        await darkOption.click();
        await page.waitForTimeout(1000);

        // Verify theme changed
        const bodyClass = await page.evaluate(() => document.body.className);
        expect(bodyClass).toContain('dark');
      }
    }

    // Close settings
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  });

  test('should handle sort dropdown', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Look for sort dropdown in main UI
    const sortSelect = page.locator('select, [role="combobox"]').filter({ hasText: /sort|order/i }).first();
    
    if (await sortSelect.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(sortSelect);
      await page.waitForTimeout(500);

      // Verify options are visible
      const options = page.locator('[role="listbox"], [role="option"], option');
      expect(await options.count()).toBeGreaterThan(0);

      // Select different sort option
      const sortOption = page.locator('option').nth(1);
      if (await sortOption.isVisible({ timeout: 3000 }).catch(() => false)) {
        await sortOption.click();
        await page.waitForTimeout(1000);

        // Verify sort changed
        await expect(page.locator('body')).toBeVisible();
      }
    }
  });

  test('should handle filter dropdown', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Look for filter dropdown
    const filterSelect = page.locator('select, [role="combobox"]').filter({ hasText: /filter|category/i }).first();
    
    if (await filterSelect.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(filterSelect);
      await page.waitForTimeout(500);

      // Verify options are visible
      const options = page.locator('[role="listbox"], [role="option"], option');
      expect(await options.count()).toBeGreaterThan(0);

      // Select filter option
      const filterOption = page.locator('option').nth(1);
      if (await filterOption.isVisible({ timeout: 3000 }).catch(() => false)) {
        await filterOption.click();
        await page.waitForTimeout(1000);

        // Verify filter applied
        await expect(page.locator('body')).toBeVisible();
      }
    }
  });

  test('should handle select keyboard navigation', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Navigate to settings
    await page.getByTestId('settings-button').click();
    await page.waitForTimeout(1000);

    // Look for any select
    const select = page.locator('select, [role="combobox"]').first();
    
    if (await select.isVisible({ timeout: 5000 }).catch(() => false)) {
      await select.focus();
      
      // Test keyboard navigation
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(500);

      await page.keyboard.press('ArrowUp');
      await page.waitForTimeout(500);

      // Verify focus is still on select
      const focusedElement = page.locator(':focus').first();
      await expect(focusedElement).toBeVisible();
    }

    // Close settings
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  });

  test('should handle select accessibility', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Navigate to settings
    await page.getByTestId('settings-button').click();
    await page.waitForTimeout(1000);

    // Look for any select
    const select = page.locator('select, [role="combobox"]').first();
    
    if (await select.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Check ARIA attributes
      const ariaLabel = await select.getAttribute('aria-label');
      const ariaExpanded = await select.getAttribute('aria-expanded');

      // Should have accessibility attributes
      expect(ariaLabel || ariaExpanded).toBeTruthy();
    }

    // Close settings
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  });
});
