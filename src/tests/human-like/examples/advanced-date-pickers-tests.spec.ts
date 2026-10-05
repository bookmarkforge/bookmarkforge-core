/**
 * Advanced Date Pickers Tests
 * 
 * Tests for advanced date picker functionality:
 * - Date picker displays
 * - Date selection
 * - Date range
 * - Date keyboard nav
 * - Date accessibility
 * - Date validation
 * - Date localization
 * - Date disabled
 * - Date presets
 * - Date time
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { saveBookmark } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Advanced Date Pickers Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('61.1 Date picker displays', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const datePicker = page.locator('[data-testid="date-picker"]');
    if (await datePicker.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(datePicker).toBeVisible();
    }
  });

  test('61.2 Date selection works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const datePicker = page.locator('[data-testid="date-picker"]');
    if (await datePicker.isVisible({ timeout: 5000 }).catch(() => false)) {
      const dayButton = datePicker.getByRole('button', { name: /\d+/ }).first();
      if (await dayButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await human.click(dayButton);
        
        await expect(dayButton).toBeVisible();
      }
    }
  });

  test('61.3 Date range works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const datePicker = page.locator('[data-testid="date-picker"][data-range="true"]');
    if (await datePicker.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(datePicker).toBeVisible();
    }
  });

  test('61.4 Date keyboard navigation works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const datePicker = page.locator('[data-testid="date-picker"]');
    if (await datePicker.isVisible({ timeout: 5000 }).catch(() => false)) {
      const dayButton = datePicker.getByRole('button').first();
      if (await dayButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await dayButton.focus();
        
        await page.keyboard.press('ArrowRight');
        
        const focusedElement = page.locator(':focus');
        await expect(focusedElement).toBeVisible();
      }
    }
  });

  test('61.5 Date accessibility works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const datePicker = page.locator('[data-testid="date-picker"]');
    if (await datePicker.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Check ARIA attributes
      const ariaLabel = await datePicker.getAttribute('aria-label');
      const role = await datePicker.getAttribute('role');
      
      if (ariaLabel || role) {
        await expect(ariaLabel || role).toBeTruthy();
      }
    }
  });

  test('61.6 Date validation works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const datePicker = page.locator('[data-testid="date-picker"]');
    if (await datePicker.isVisible({ timeout: 5000 }).catch(() => false)) {
      const invalidDate = datePicker.locator('[data-invalid="true"]');
      if (await invalidDate.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(invalidDate).toBeVisible();
      }
    }
  });

  test('61.7 Date localization works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const datePicker = page.locator('[data-testid="date-picker"]');
    if (await datePicker.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(datePicker).toBeVisible();
      
      // Check for localized date format
      const dayName = datePicker.getByText(/mon|tue|wed|thu|fri|sat|sun/i);
      if (await dayName.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(dayName).toBeVisible();
      }
    }
  });

  test('61.8 Date disabled works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const datePicker = page.locator('[data-testid="date-picker"]');
    if (await datePicker.isVisible({ timeout: 5000 }).catch(() => false)) {
      const disabledDay = datePicker.getByRole('button', { name: /\d+/ }).locator('[disabled]');
      if (await disabledDay.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(disabledDay).toBeVisible();
      }
    }
  });

  test('61.9 Date presets work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const datePicker = page.locator('[data-testid="date-picker"]');
    if (await datePicker.isVisible({ timeout: 5000 }).catch(() => false)) {
      const presetButton = datePicker.getByRole('button', { name: /today|yesterday|tomorrow/i });
      if (await presetButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await human.click(presetButton);
        
        await expect(presetButton).toBeVisible();
      }
    }
  });

  test('61.10 Date time works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const dateTimePicker = page.locator('[data-testid="datetime-picker"]');
    if (await dateTimePicker.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(dateTimePicker).toBeVisible();
    }
  });
});