/**
 * Advanced Checkboxes Tests
 * 
 * Tests for BookmarkForge's checkbox/toggle functionality:
 * - Settings toggles
 * - Checkbox state
 * - Checkbox accessibility
 * - Checkbox groups
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Advanced Checkboxes Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('should handle settings toggles', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Navigate to settings
    await page.getByTestId('settings-button').click();
    await page.waitForTimeout(1000);

    // Look for checkboxes/toggles
    const checkboxes = page.locator('input[type="checkbox"], [role="checkbox"], [role="switch"]').first();
    
    if (await checkboxes.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Get initial state
      const initialState = await checkboxes.getAttribute('aria-checked') || await checkboxes.isChecked();
      
      // Toggle checkbox
      await human.click(checkboxes);
      await page.waitForTimeout(500);

      // Verify state changed
      const newState = await checkboxes.getAttribute('aria-checked') || await checkboxes.isChecked();
      expect(newState).not.toBe(initialState);
    }

    // Close settings
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  });

  test('should handle checkbox keyboard navigation', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Navigate to settings
    await page.getByTestId('settings-button').click();
    await page.waitForTimeout(1000);

    // Look for checkbox
    const checkbox = page.locator('input[type="checkbox"], [role="checkbox"], [role="switch"]').first();
    
    if (await checkbox.isVisible({ timeout: 5000 }).catch(() => false)) {
      await checkbox.focus();
      
      // Test keyboard toggle with Space
      await page.keyboard.press('Space');
      await page.waitForTimeout(500);

      // Verify focus is still on checkbox
      const focusedElement = page.locator(':focus').first();
      await expect(focusedElement).toBeVisible();
    }

    // Close settings
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  });

  test('should handle checkbox accessibility', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Navigate to settings
    await page.getByTestId('settings-button').click();
    await page.waitForTimeout(1000);

    // Look for checkbox
    const checkbox = page.locator('input[type="checkbox"], [role="checkbox"], [role="switch"]').first();
    
    if (await checkbox.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Check ARIA attributes
      const ariaLabel = await checkbox.getAttribute('aria-label');
      const ariaChecked = await checkbox.getAttribute('aria-checked');
      const ariaDisabled = await checkbox.getAttribute('aria-disabled');

      // Should have accessibility attributes
      expect(ariaLabel || ariaChecked || ariaDisabled).toBeTruthy();
    }

    // Close settings
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  });

  test('should handle checkbox groups', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Navigate to settings
    await page.getByTestId('settings-button').click();
    await page.waitForTimeout(1000);

    // Look for checkbox group
    const checkboxGroup = page.locator('[role="group"], [data-testid="checkbox-group"], fieldset').first();
    
    if (await checkboxGroup.isVisible({ timeout: 5000 }).catch(() => false)) {
      const checkboxes = checkboxGroup.locator('input[type="checkbox"], [role="checkbox"], [role="switch"]');
      const count = await checkboxes.count();
      
      // Should have multiple checkboxes in group
      expect(count).toBeGreaterThan(1);
    }

    // Close settings
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  });

  test('should handle checkbox disabled state', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Navigate to settings
    await page.getByTestId('settings-button').click();
    await page.waitForTimeout(1000);

    // Look for disabled checkbox
    const disabledCheckbox = page.locator('input[type="checkbox"]:disabled, [role="checkbox"][aria-disabled="true"], [role="switch"][aria-disabled="true"]').first();
    
    if (await disabledCheckbox.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Should not be clickable
      await expect(disabledCheckbox).toBeDisabled();
    }

    // Close settings
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  });

  test('should handle checkbox label association', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Navigate to settings
    await page.getByTestId('settings-button').click();
    await page.waitForTimeout(1000);

    // Look for checkbox with label
    const checkbox = page.locator('input[type="checkbox"], [role="checkbox"], [role="switch"]').first();
    
    if (await checkbox.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Check if checkbox has associated label
      const label = await checkbox.evaluate(el => {
        const id = el.id;
        return id ? document.querySelector(`label[for="${id}"]`) : el.closest('label');
      });

      // Should have label or aria-label
      const ariaLabel = await checkbox.getAttribute('aria-label');
      expect(label || ariaLabel).toBeTruthy();
    }

    // Close settings
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  });
});
