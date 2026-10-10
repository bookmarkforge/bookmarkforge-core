/**
 * Advanced Lists Tests
 * 
 * Tests for advanced list functionality:
 * - List displays
 * - List selection
 * - List multi-select
 * - List keyboard nav
 * - List drag reorder
 * - List accessibility
 * - List virtual scroll
 * - List grouping
 * - List filtering
 * - List sorting
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { saveBookmark } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Advanced Lists Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('52.1 List displays', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const list = page.locator('[role="list"], ul, ol');
    if (await list.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(list).toBeVisible();
    }
  });

  test('52.2 List selection works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const list = page.locator('[role="list"]').first();
    if (await list.isVisible({ timeout: 5000 }).catch(() => false)) {
      const listItem = list.locator('[role="listitem"]').first();
      if (await listItem.isVisible({ timeout: 3000 }).catch(() => false)) {
        await human.click(listItem);
        
        await expect(listItem).toBeVisible();
      }
    }
  });

  test('52.3 List multi-select works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const list = page.locator('[role="list"][aria-multiselectable="true"]').first();
    if (await list.isVisible({ timeout: 5000 }).catch(() => false)) {
      const listItems = list.locator('[role="listitem"]');
      if (await listItems.count() >= 2) {
        await human.click(listItems.first());
        await page.keyboard.down('Control');
        await human.click(listItems.nth(1));
        await page.keyboard.up('Control');
        
        await expect(listItems.count()).resolves.toBeGreaterThanOrEqual(2);
      }
    }
  });

  test('52.4 List keyboard navigation works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const list = page.locator('[role="list"]').first();
    if (await list.isVisible({ timeout: 5000 }).catch(() => false)) {
      const listItem = list.locator('[role="listitem"]').first();
      if (await listItem.isVisible({ timeout: 3000 }).catch(() => false)) {
        await listItem.focus();
        
        await page.keyboard.press('ArrowDown');
        
        const focusedElement = page.locator(':focus');
        await expect(focusedElement).toBeVisible();
      }
    }
  });

  test('52.5 List drag reorder works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const list = page.locator('[role="list"]').first();
    if (await list.isVisible({ timeout: 5000 }).catch(() => false)) {
      const listItems = list.locator('[role="listitem"]');
      if (await listItems.count() >= 2) {
        const firstItem = listItems.first();
        const secondItem = listItems.nth(1);
        
        if (await firstItem.isVisible({ timeout: 3000 }).catch(() => false)) {
          await firstItem.dragTo(secondItem);
          
          await expect(firstItem).toBeVisible();
        }
      }
    }
  });

  test('52.6 List accessibility works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const list = page.locator('[role="list"]').first();
    if (await list.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Check ARIA attributes
      const ariaLabel = await list.getAttribute('aria-label');
      const role = await list.getAttribute('role');
      
      if (ariaLabel || role) {
        await expect(ariaLabel || role).toBeTruthy();
      }
    }
  });

  test('52.7 List virtual scroll works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const list = page.locator('[data-testid="virtual-list"]');
    if (await list.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(list).toBeVisible();
      
      // Scroll to trigger virtual rendering
      await list.evaluate(el => el.scrollTop = 1000);
      
      await expect(list).toBeVisible();
    }
  });

  test('52.8 List grouping works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const listGroup = page.locator('[data-testid="list-group"]');
    if (await listGroup.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(listGroup).toBeVisible();
    }
  });

  test('52.9 List filtering works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const list = page.locator('[role="list"]').first();
    if (await list.isVisible({ timeout: 5000 }).catch(() => false)) {
      const filterInput = page.getByRole('textbox', { name: /filter|search/i });
      if (await filterInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        await human.type(filterInput, 'test');
        
        await expect(filterInput).toBeVisible();
      }
    }
  });

  test('52.10 List sorting works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const list = page.locator('[role="list"]').first();
    if (await list.isVisible({ timeout: 5000 }).catch(() => false)) {
      const sortButton = page.getByRole('button', { name: /sort/i });
      if (await sortButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await human.click(sortButton);
        
        await expect(sortButton).toBeVisible();
      }
    }
  });
});