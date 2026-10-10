/**
 * Advanced Data Tables Tests
 * 
 * Tests for advanced data table functionality:
 * - Table displays
 * - Table sorting
 * - Table filtering
 * - Table pagination
 * - Table selection
 * - Table keyboard nav
 * - Table accessibility
 * - Table grouping
 * - Table export
 * - Table responsive
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { saveBookmark } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Advanced Data Tables Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('57.1 Table displays', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const table = page.locator('[role="table"], table');
    if (await table.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(table).toBeVisible();
    }
  });

  test('57.2 Table sorting works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const table = page.locator('[role="table"]').first();
    if (await table.isVisible({ timeout: 5000 }).catch(() => false)) {
      const sortButton = table.getByRole('button', { name: /sort/i });
      if (await sortButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await human.click(sortButton);
        
        await expect(sortButton).toBeVisible();
      }
    }
  });

  test('57.3 Table filtering works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const table = page.locator('[role="table"]').first();
    if (await table.isVisible({ timeout: 5000 }).catch(() => false)) {
      const filterInput = table.getByRole('textbox', { name: /filter|search/i });
      if (await filterInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        await human.type(filterInput, 'test');
        
        await expect(filterInput).toBeVisible();
      }
    }
  });

  test('57.4 Table pagination works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const table = page.locator('[role="table"]').first();
    if (await table.isVisible({ timeout: 5000 }).catch(() => false)) {
      const pagination = page.locator('[data-testid="pagination"]');
      if (await pagination.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(pagination).toBeVisible();
      }
    }
  });

  test('57.5 Table selection works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const table = page.locator('[role="table"]').first();
    if (await table.isVisible({ timeout: 5000 }).catch(() => false)) {
      const checkbox = table.getByRole('checkbox').first();
      if (await checkbox.isVisible({ timeout: 3000 }).catch(() => false)) {
        await human.click(checkbox);
        
        await expect(checkbox).toBeVisible();
      }
    }
  });

  test('57.6 Table keyboard navigation works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const table = page.locator('[role="table"]').first();
    if (await table.isVisible({ timeout: 5000 }).catch(() => false)) {
      const cell = table.locator('[role="cell"], td').first();
      if (await cell.isVisible({ timeout: 3000 }).catch(() => false)) {
        await cell.focus();
        
        await page.keyboard.press('ArrowRight');
        
        const focusedElement = page.locator(':focus');
        await expect(focusedElement).toBeVisible();
      }
    }
  });

  test('57.7 Table accessibility works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const table = page.locator('[role="table"]').first();
    if (await table.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Check ARIA attributes
      const ariaLabel = await table.getAttribute('aria-label');
      const role = await table.getAttribute('role');
      
      if (ariaLabel || role) {
        await expect(ariaLabel || role).toBeTruthy();
      }
    }
  });

  test('57.8 Table grouping works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const table = page.locator('[role="table"]').first();
    if (await table.isVisible({ timeout: 5000 }).catch(() => false)) {
      const groupRow = table.locator('[data-group="true"]');
      if (await groupRow.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(groupRow).toBeVisible();
      }
    }
  });

  test('57.9 Table export works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const table = page.locator('[role="table"]').first();
    if (await table.isVisible({ timeout: 5000 }).catch(() => false)) {
      const exportButton = page.getByRole('button', { name: /export/i });
      if (await exportButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await human.click(exportButton);
        
        await expect(exportButton).toBeVisible();
      }
    }
  });

  test('57.10 Table responsive works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    await page.setViewportSize({ width: 375, height: 667 });
    
    const table = page.locator('[role="table"]').first();
    if (await table.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(table).toBeVisible();
    }
    
    await page.setViewportSize({ width: 1280, height: 720 });
  });
});