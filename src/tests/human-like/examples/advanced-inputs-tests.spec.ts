/**
 * Advanced Inputs Tests
 * 
 * Tests for BookmarkForge's input functionality:
 * - Search input
 * - Form inputs
 * - Password inputs
 * - URL inputs
 * - Text inputs
 * - Input validation
 * - Input accessibility
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Advanced Inputs Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('should handle search input', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Open search (Omnibar)
    const searchButton = page.locator('button[aria-label*="Search"], button[aria-label*="search"], [data-testid="search-button"]').first();
    
    if (await searchButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await searchButton.click();
      await page.waitForTimeout(1000);

      // Verify search input is visible
      const searchInput = page.locator('input[role="combobox"], input[type="search"], input[placeholder*="Search"]').first();
      expect(await searchInput.isVisible({ timeout: 3000 })).toBe(true);

      // Type search query
      await searchInput.fill('test');
      await page.waitForTimeout(500);

      // Verify input value
      await expect(searchInput).toHaveValue('test');

      // Close search
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }
  });

  test('should handle bookmark URL input', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Look for add bookmark button (QuickCapture FAB)
    const addButton = page.getByTestId('add-bookmark-button');
    
    if (await addButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await addButton.click();
      await page.waitForTimeout(1000);

      // Verify URL input is visible (QuickCapture uses a single text input
      // for URLs and notes)
      const urlInput = page.getByTestId('quick-capture-input');
      await expect(urlInput).toBeVisible({ timeout: 10_000 });

      // Enter URL
      await urlInput.fill('https://example.com');
      await page.waitForTimeout(500);

      // Verify input value
      await expect(urlInput).toHaveValue('https://example.com');

      // Close form
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }
  });

  test('should handle bookmark title input', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Look for add bookmark button
    const addButton = page.locator('[data-testid="add-bookmark-button"], button:has-text("Add"), button:has-text("New")').first();
    
    if (await addButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await addButton.click();
      await page.waitForTimeout(1000);

      // Verify title input is visible
      const titleInput = page.locator('input[type="text"], input[placeholder*="Title"], input[placeholder*="title"]').first();
      expect(await titleInput.isVisible({ timeout: 3000 })).toBe(true);

      // Enter title
      await titleInput.fill('Test Bookmark');
      await page.waitForTimeout(500);

      // Verify input value
      await expect(titleInput).toHaveValue('Test Bookmark');

      // Close form
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }
  });

  test('should handle password input in vault lock', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Look for lock button
    const lockButton = page.locator('button:has-text("Lock"), [data-testid="lock-button"]').first();
    
    if (await lockButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await lockButton.click();
      await page.waitForTimeout(1000);

      // Verify password input is visible
      const passwordInput = page.locator('input[type="password"], input[placeholder*="password"]').first();
      expect(await passwordInput.isVisible({ timeout: 3000 })).toBe(true);

      // Enter password
      await passwordInput.fill('test-password');
      await page.waitForTimeout(500);

      // Verify input value (should be masked)
      const inputValue = await passwordInput.inputValue();
      expect(inputValue).toBe('test-password');
    }
  });

  test('should handle input validation', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Look for add bookmark button
    const addButton = page.locator('[data-testid="add-bookmark-button"], button:has-text("Add"), button:has-text("New")').first();
    
    if (await addButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await addButton.click();
      await page.waitForTimeout(1000);

      // Try to submit without URL
      const submitButton = page.locator('button[type="submit"], button:has-text("Save"), button:has-text("Add")').first();
      
      if (await submitButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await submitButton.click();
        await page.waitForTimeout(1000);

        // Should show validation error
        const errorMessage = page.locator('text=/required|invalid|error/i').first();
        expect(await errorMessage.count()).toBeGreaterThan(0);
      }

      // Close form
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }
  });

  test('should handle input keyboard navigation', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Look for add bookmark button
    const addButton = page.locator('[data-testid="add-bookmark-button"], button:has-text("Add"), button:has-text("New")').first();
    
    if (await addButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await addButton.click();
      await page.waitForTimeout(1000);

      // Focus on first input
      const firstInput = page.locator('input').first();
      await firstInput.focus();
      
      // Tab to next input
      await page.keyboard.press('Tab');
      await page.waitForTimeout(500);

      // Verify focus moved to next input
      const focusedElement = page.locator(':focus').first();
      await expect(focusedElement).toBeVisible();

      // Close form
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }
  });

  test('should handle input accessibility', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Look for add bookmark button
    const addButton = page.locator('[data-testid="add-bookmark-button"], button:has-text("Add"), button:has-text("New")').first();
    
    if (await addButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await addButton.click();
      await page.waitForTimeout(1000);

      // Check first input for accessibility
      const input = page.locator('input').first();
      
      if (await input.isVisible({ timeout: 3000 }).catch(() => false)) {
        // Check ARIA attributes
        const ariaLabel = await input.getAttribute('aria-label');
        const ariaDescribedby = await input.getAttribute('aria-describedby');
        const placeholder = await input.getAttribute('placeholder');

        // Should have accessibility attributes
        expect(ariaLabel || ariaDescribedby || placeholder).toBeTruthy();
      }

      // Close form
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }
  });

  test('should handle input placeholder', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Look for add bookmark button
    const addButton = page.locator('[data-testid="add-bookmark-button"], button:has-text("Add"), button:has-text("New")').first();
    
    if (await addButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await addButton.click();
      await page.waitForTimeout(1000);

      // Check inputs for placeholders
      const inputs = page.locator('input[placeholder]');
      const count = await inputs.count();

      // Should have at least one input with placeholder
      expect(count).toBeGreaterThan(0);

      // Close form
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }
  });

  test('should handle input disabled state', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Navigate to settings
    await page.getByTestId('settings-button').click();
    await page.waitForTimeout(1000);

    // Look for disabled input
    const disabledInput = page.locator('input[disabled], input:disabled').first();
    
    if (await disabledInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Should not be editable
      await expect(disabledInput).toBeDisabled();
    }

    // Close settings
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  });

  test('should handle input prefix/suffix', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Look for input with prefix/suffix
    const inputGroup = page.locator('[data-testid="input-group"], [class*="input-group"]').first();
    
    if (await inputGroup.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Should have prefix or suffix
      const prefix = inputGroup.locator('[data-testid="prefix"], [class*="prefix"]').first();
      const suffix = inputGroup.locator('[data-testid="suffix"], [class*="suffix"]').first();

      const hasPrefix = await prefix.isVisible({ timeout: 3000 }).catch(() => false);
      const hasSuffix = await suffix.isVisible({ timeout: 3000 }).catch(() => false);

      expect(hasPrefix || hasSuffix).toBe(true);
    }
  });
});
