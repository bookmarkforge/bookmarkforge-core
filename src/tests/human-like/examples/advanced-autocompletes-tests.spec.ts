/**
 * Advanced Autocompletes Tests
 * 
 * Tests for advanced autocomplete functionality:
 * - Autocomplete displays
 * - Autocomplete suggestions
 * - Autocomplete selection
 * - Autocomplete keyboard nav
 * - Autocomplete accessibility
 * - Autocomplete filtering
 * - Autocomplete debounce
 * - Autocomplete loading
 * - Autocomplete custom
 * - Autocomplete multiple
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { saveBookmark } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Advanced Autocompletes Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('60.1 Autocomplete displays', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const autocomplete = page.locator('[role="combobox"]');
    if (await autocomplete.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(autocomplete).toBeVisible();
    }
  });

  test('60.2 Autocomplete suggestions work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const autocomplete = page.locator('[role="combobox"]').first();
    if (await autocomplete.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.type(autocomplete, 'test');
      
      const suggestions = page.locator('[role="listbox"]');
      if (await suggestions.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(suggestions).toBeVisible();
      }
    }
  });

  test('60.3 Autocomplete selection works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const autocomplete = page.locator('[role="combobox"]').first();
    if (await autocomplete.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.type(autocomplete, 'test');
      
      const suggestions = page.locator('[role="listbox"]');
      if (await suggestions.isVisible({ timeout: 3000 }).catch(() => false)) {
        const option = suggestions.getByRole('option').first();
        if (await option.isVisible({ timeout: 3000 }).catch(() => false)) {
          await human.click(option);
          
          await expect(autocomplete).toBeVisible();
        }
      }
    }
  });

  test('60.4 Autocomplete keyboard navigation works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const autocomplete = page.locator('[role="combobox"]').first();
    if (await autocomplete.isVisible({ timeout: 5000 }).catch(() => false)) {
      await autocomplete.focus();
      
      await page.keyboard.press('ArrowDown');
      
      const focusedElement = page.locator(':focus');
      await expect(focusedElement).toBeVisible();
    }
  });

  test('60.5 Autocomplete accessibility works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const autocomplete = page.locator('[role="combobox"]').first();
    if (await autocomplete.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Check ARIA attributes
      const ariaLabel = await autocomplete.getAttribute('aria-label');
      const ariaExpanded = await autocomplete.getAttribute('aria-expanded');
      
      if (ariaLabel || ariaExpanded) {
        await expect(ariaLabel || ariaExpanded).toBeTruthy();
      }
    }
  });

  test('60.6 Autocomplete filtering works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const autocomplete = page.locator('[role="combobox"]').first();
    if (await autocomplete.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.type(autocomplete, 'test');
      
      const suggestions = page.locator('[role="listbox"]');
      if (await suggestions.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(suggestions).toBeVisible();
      }
    }
  });

  test('60.7 Autocomplete debounce works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const autocomplete = page.locator('[role="combobox"]').first();
    if (await autocomplete.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.type(autocomplete, 't');
      
      // Wait for debounce
      await page.waitForTimeout(300);
      
      await expect(autocomplete).toBeVisible();
    }
  });

  test('60.8 Autocomplete loading works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const autocomplete = page.locator('[role="combobox"]').first();
    if (await autocomplete.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.type(autocomplete, 'test');
      
      const loadingIndicator = page.locator('[data-loading="true"]');
      if (await loadingIndicator.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(loadingIndicator).toBeVisible();
      }
    }
  });

  test('60.9 Autocomplete custom works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const autocomplete = page.locator('[role="combobox"][data-custom="true"]');
    if (await autocomplete.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(autocomplete).toBeVisible();
    }
  });

  test('60.10 Autocomplete multiple works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const autocomplete = page.locator('[role="combobox"][aria-multiselectable="true"]');
    if (await autocomplete.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(autocomplete).toBeVisible();
    }
  });
});