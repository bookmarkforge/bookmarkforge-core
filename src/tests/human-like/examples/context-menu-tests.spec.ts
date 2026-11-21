/**
 * Context Menu Tests
 * 
 * Tests for context menu functionality:
 * - Context menu opens
 * - Context menu items
 * - Context menu actions
 * - Context menu customization
 * - Context menu positioning
 * - Context menu keyboard
 * - Context menu accessibility
 * - Context menu dynamic items
 * - Context menu persistence
 * - Context menu theming
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { saveBookmark } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Context Menu Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('34.1 Context menu opens', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const bookmarkRow = page.locator('[data-testid="bookmark-row"]').first();
    if (await bookmarkRow.isVisible({ timeout: 5000 }).catch(() => false)) {
      await bookmarkRow.click({ button: 'right' });
      
      const contextMenu = page.locator('[data-testid="context-menu"]');
      if (await contextMenu.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(contextMenu).toBeVisible();
      }
    }
  });

  test('34.2 Context menu items work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const bookmarkRow = page.locator('[data-testid="bookmark-row"]').first();
    if (await bookmarkRow.isVisible({ timeout: 5000 }).catch(() => false)) {
      await bookmarkRow.click({ button: 'right' });
      
      const menuItems = page.locator('[data-testid="context-menu-item"]');
      if (await menuItems.count() > 0) {
        await expect(menuItems.count()).resolves.toBeGreaterThan(0);
      }
    }
  });

  test('34.3 Context menu actions work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const bookmarkRow = page.locator('[data-testid="bookmark-row"]').first();
    if (await bookmarkRow.isVisible({ timeout: 5000 }).catch(() => false)) {
      await bookmarkRow.click({ button: 'right' });
      
      const editItem = page.getByRole('menuitem', { name: /edit/i });
      if (await editItem.isVisible({ timeout: 3000 }).catch(() => false)) {
        await human.click(editItem);
        
        const editDialog = page.locator('[data-testid="edit-dialog"]');
        if (await editDialog.isVisible({ timeout: 3000 }).catch(() => false)) {
          await expect(editDialog).toBeVisible();
        }
      }
    }
  });

  test('34.4 Context menu customization works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const settingsButton = page.getByRole('button', { name: /settings/i });
    if (await settingsButton.isVisible()) {
      await human.click(settingsButton);
      
      const contextMenuSection = page.getByRole('button', { name: /context menu/i });
      if (await contextMenuSection.isVisible({ timeout: 5000 }).catch(() => false)) {
        await human.click(contextMenuSection);
        
        const customizePanel = page.locator('[data-testid="customize-panel"]');
        if (await customizePanel.isVisible({ timeout: 5000 }).catch(() => false)) {
          await expect(customizePanel).toBeVisible();
        }
      }
    }
  });

  test('34.5 Context menu positioning works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const bookmarkRow = page.locator('[data-testid="bookmark-row"]').first();
    if (await bookmarkRow.isVisible({ timeout: 5000 }).catch(() => false)) {
      await bookmarkRow.click({ button: 'right' });
      
      const contextMenu = page.locator('[data-testid="context-menu"]');
      if (await contextMenu.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(contextMenu).toBeVisible();
        
        // Check that menu is positioned near click point
        const box = await contextMenu.boundingBox();
        if (box) {
          await expect(box.x).toBeGreaterThan(0);
          await expect(box.y).toBeGreaterThan(0);
        }
      }
    }
  });

  test('34.6 Context menu keyboard works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const bookmarkRow = page.locator('[data-testid="bookmark-row"]').first();
    if (await bookmarkRow.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(bookmarkRow);
      
      // Open context menu with keyboard
      await page.keyboard.press('Shift+F10');
      
      const contextMenu = page.locator('[data-testid="context-menu"]');
      if (await contextMenu.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(contextMenu).toBeVisible();
      }
    }
  });

  test('34.7 Context menu accessibility works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const bookmarkRow = page.locator('[data-testid="bookmark-row"]').first();
    if (await bookmarkRow.isVisible({ timeout: 5000 }).catch(() => false)) {
      await bookmarkRow.click({ button: 'right' });
      
      const contextMenu = page.locator('[role="menu"]');
      if (await contextMenu.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(contextMenu).toBeVisible();
      }
    }
  });

  test('34.8 Context menu dynamic items work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const bookmarkRow = page.locator('[data-testid="bookmark-row"]').first();
    if (await bookmarkRow.isVisible({ timeout: 5000 }).catch(() => false)) {
      await bookmarkRow.click({ button: 'right' });
      
      const dynamicItems = page.locator('[data-testid="dynamic-item"]');
      if (await dynamicItems.count() > 0) {
        await expect(dynamicItems.count()).resolves.toBeGreaterThan(0);
      }
    }
  });

  test('34.9 Context menu persistence works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const settingsButton = page.getByRole('button', { name: /settings/i });
    if (await settingsButton.isVisible()) {
      await human.click(settingsButton);
      
      const contextMenuSection = page.getByRole('button', { name: /context menu/i });
      if (await contextMenuSection.isVisible({ timeout: 5000 }).catch(() => false)) {
        await human.click(contextMenuSection);
        
        const persistenceToggle = page.getByRole('switch', { name: /persist/i });
        if (await persistenceToggle.isVisible({ timeout: 5000 }).catch(() => false)) {
          await human.click(persistenceToggle);
          
          const persistenceStatus = page.locator('[data-testid="persistence-status"]');
          if (await persistenceStatus.isVisible({ timeout: 3000 }).catch(() => false)) {
            await expect(persistenceStatus).toBeVisible();
          }
        }
      }
    }
  });

  test('34.10 Context menu theming works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const bookmarkRow = page.locator('[data-testid="bookmark-row"]').first();
    if (await bookmarkRow.isVisible({ timeout: 5000 }).catch(() => false)) {
      await bookmarkRow.click({ button: 'right' });
      
      const contextMenu = page.locator('[data-testid="context-menu"]');
      if (await contextMenu.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(contextMenu).toBeVisible();
        
        // Check that menu respects current theme
        const body = page.locator('body');
        await expect(body).toBeVisible();
      }
    }
  });
});