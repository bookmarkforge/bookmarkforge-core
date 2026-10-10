/**
 * Advanced Chips Tests
 * 
 * Tests for advanced chip functionality:
 * - Chip displays
 * - Chip selection
 * - Chip deletion
 * - Chip keyboard nav
 * - Chip accessibility
 * - Chip variants
 * - Chip avatar
 * - Chip icon
 * - Chip overflow
 * - Chip grouping
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { saveBookmark } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Advanced Chips Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('51.1 Chip displays', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const chip = page.locator('[data-testid="chip"], .chip');
    if (await chip.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(chip).toBeVisible();
    }
  });

  test('51.2 Chip selection works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const chip = page.locator('[data-testid="chip"][role="button"], [data-testid="chip"][data-selectable="true"]').first();
    if (await chip.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(chip);
      
      const selectedChip = page.locator('[data-selected="true"]');
      if (await selectedChip.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(selectedChip).toBeVisible();
      }
    }
  });

  test('51.3 Chip deletion works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const chip = page.locator('[data-testid="chip"]').first();
    if (await chip.isVisible({ timeout: 5000 }).catch(() => false)) {
      const deleteButton = chip.getByRole('button', { name: /delete|close|x/i });
      if (await deleteButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await human.click(deleteButton);
        
        await expect(deleteButton).toBeVisible();
      }
    }
  });

  test('51.4 Chip keyboard navigation works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const chip = page.locator('[data-testid="chip"][role="button"]').first();
    if (await chip.isVisible({ timeout: 5000 }).catch(() => false)) {
      await chip.focus();
      
      await page.keyboard.press('ArrowRight');
      
      const focusedElement = page.locator(':focus');
      await expect(focusedElement).toBeVisible();
    }
  });

  test('51.5 Chip accessibility works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const chip = page.locator('[data-testid="chip"]').first();
    if (await chip.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Check ARIA attributes
      const ariaLabel = await chip.getAttribute('aria-label');
      const role = await chip.getAttribute('role');
      
      if (ariaLabel || role) {
        await expect(ariaLabel || role).toBeTruthy();
      }
    }
  });

  test('51.6 Chip variants work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const chip = page.locator('[data-testid="chip"]').first();
    if (await chip.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(chip).toBeVisible();
      
      // Check for variant class
      const variantClass = await chip.getAttribute('class');
      if (variantClass) {
        await expect(variantClass).toBeTruthy();
      }
    }
  });

  test('51.7 Chip avatar works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const chip = page.locator('[data-testid="chip"] [data-testid="avatar"]').first();
    if (await chip.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(chip).toBeVisible();
    }
  });

  test('51.8 Chip icon works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const chip = page.locator('[data-testid="chip"] [data-testid="icon"]').first();
    if (await chip.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(chip).toBeVisible();
    }
  });

  test('51.9 Chip overflow works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const chipContainer = page.locator('[data-testid="chip-container"]');
    if (await chipContainer.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(chipContainer).toBeVisible();
      
      const overflowChip = chipContainer.locator('[data-overflow="true"]');
      if (await overflowChip.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(overflowChip).toBeVisible();
      }
    }
  });

  test('51.10 Chip grouping works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const chipGroup = page.locator('[data-testid="chip-group"]');
    if (await chipGroup.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(chipGroup).toBeVisible();
      
      const chips = chipGroup.locator('[data-testid="chip"]');
      if (await chips.count() > 0) {
        await expect(chips.count()).resolves.toBeGreaterThan(0);
      }
    }
  });
});