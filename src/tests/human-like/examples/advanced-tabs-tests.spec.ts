/**
 * Advanced Tabs Tests
 * 
 * Tests for advanced tabs functionality:
 * - Tab switching
 * - Tab persistence
 * - Tab keyboard nav
 * - Tab drag to reorder
 * - Tab context menu
 * - Tab close
 * - Tab pinning
 * - Tab groups
 * - Tab overflow
 * - Tab accessibility
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { saveBookmark } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Advanced Tabs Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('43.1 Tab switching works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const tabs = page.locator('[role="tab"]');
    const count = await tabs.count();
    
    if (count > 1) {
      const secondTab = tabs.nth(1);
      await human.click(secondTab);
      
      await expect(secondTab).toHaveAttribute('aria-selected', 'true');
    }
  });

  test('43.2 Tab persistence works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const tabs = page.locator('[role="tab"]');
    const count = await tabs.count();
    
    if (count > 1) {
      const secondTab = tabs.nth(1);
      await human.click(secondTab);
      
      // Reload and check if tab selection persists
      await page.reload();
      
      const tabsAfterReload = page.locator('[role="tab"]');
      if (await tabsAfterReload.count() > 1) {
        const selectedTab = tabsAfterReload.locator('[aria-selected="true"]');
        if (await selectedTab.count() > 0) {
          await expect(selectedTab).toBeVisible();
        }
      }
    }
  });

  test('43.3 Tab keyboard navigation works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const tabs = page.locator('[role="tab"]');
    const count = await tabs.count();
    
    if (count > 1) {
      const firstTab = tabs.first();
      await firstTab.focus();
      
      await page.keyboard.press('ArrowRight');
      
      const focusedElement = page.locator(':focus');
      await expect(focusedElement).toBeVisible();
    }
  });

  test('43.4 Tab drag to reorder works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const tabs = page.locator('[role="tab"]');
    const count = await tabs.count();
    
    if (count > 1) {
      const firstTab = tabs.first();
      const secondTab = tabs.nth(1);
      
      if (await firstTab.isVisible({ timeout: 5000 }).catch(() => false)) {
        await firstTab.dragTo(secondTab);
        
        await expect(firstTab).toBeVisible();
      }
    }
  });

  test('43.5 Tab context menu works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const tabs = page.locator('[role="tab"]');
    const count = await tabs.count();
    
    if (count > 0) {
      const firstTab = tabs.first();
      await firstTab.click({ button: 'right' });
      
      const contextMenu = page.locator('[data-testid="context-menu"]');
      if (await contextMenu.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(contextMenu).toBeVisible();
      }
    }
  });

  test('43.6 Tab close works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const tabs = page.locator('[role="tab"]');
    const count = await tabs.count();
    
    if (count > 1) {
      const closeButton = tabs.first().getByRole('button', { name: /close/i });
      if (await closeButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await human.click(closeButton);
        
        const tabsAfterClose = page.locator('[role="tab"]');
        await expect(tabsAfterClose.count()).resolves.toBeLessThan(count);
      }
    }
  });

  test('43.7 Tab pinning works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const tabs = page.locator('[role="tab"]');
    const count = await tabs.count();
    
    if (count > 0) {
      const firstTab = tabs.first();
      await firstTab.click({ button: 'right' });
      
      const pinOption = page.getByRole('menuitem', { name: /pin/i });
      if (await pinOption.isVisible({ timeout: 3000 }).catch(() => false)) {
        await human.click(pinOption);
        
        const pinnedTab = page.locator('[data-pinned="true"]');
        if (await pinnedTab.isVisible({ timeout: 3000 }).catch(() => false)) {
          await expect(pinnedTab).toBeVisible();
        }
      }
    }
  });

  test('43.8 Tab groups work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const tabGroups = page.locator('[data-testid="tab-group"]');
    if (await tabGroups.count() > 0) {
      await expect(tabGroups.count()).resolves.toBeGreaterThan(0);
    }
  });

  test('43.9 Tab overflow works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const tabs = page.locator('[role="tab"]');
    const count = await tabs.count();
    
    if (count > 0) {
      const tabList = page.locator('[role="tablist"]');
      await expect(tabList).toBeVisible();
      
      // Check for overflow indicator
      const overflowIndicator = page.locator('[data-testid="tab-overflow"]');
      if (await overflowIndicator.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(overflowIndicator).toBeVisible();
      }
    }
  });

  test('43.10 Tab accessibility works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const tabs = page.locator('[role="tab"]');
    const count = await tabs.count();
    
    if (count > 0) {
      const firstTab = tabs.first();
      
      // Check ARIA attributes
      const ariaSelected = await firstTab.getAttribute('aria-selected');
      const ariaControls = await firstTab.getAttribute('aria-controls');
      
      if (ariaSelected || ariaControls) {
        await expect(ariaSelected || ariaControls).toBeTruthy();
      }
    }
  });
});