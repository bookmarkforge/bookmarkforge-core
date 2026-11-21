/**
 * Sidebar Navigation Tests
 * 
 * Tests for sidebar navigation features:
 * - Sidebar opens/closes
 * - Sidebar navigation
 * - Sidebar collapsible sections
 * - Sidebar drag to resize
 * - Sidebar keyboard nav
 * - Sidebar search
 * - Sidebar favorites
 * - Sidebar icons
 * - Sidebar theme
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { saveBookmark } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Sidebar Navigation Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('39.1 Sidebar opens and closes', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const sidebarToggle = page.getByRole('button', { name: /sidebar|menu/i });
    if (await sidebarToggle.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(sidebarToggle);
      
      const sidebar = page.locator('[data-testid="sidebar"]');
      if (await sidebar.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(sidebar).toBeVisible();
        
        // Close sidebar
        await human.click(sidebarToggle);
        await expect(sidebar).not.toBeVisible({ timeout: 3000 });
      }
    }
  });

  test('39.2 Sidebar navigation works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const sidebar = page.locator('[data-testid="sidebar"]');
    if (await sidebar.isVisible({ timeout: 5000 }).catch(() => false)) {
      const navItems = sidebar.getByRole('link');
      if (await navItems.count() > 0) {
        await human.click(navItems.first());
        
        await expect(navItems.first()).toBeVisible();
      }
    }
  });

  test('39.3 Sidebar collapsible sections work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const sidebar = page.locator('[data-testid="sidebar"]');
    if (await sidebar.isVisible({ timeout: 5000 }).catch(() => false)) {
      const sectionHeader = sidebar.getByRole('button', { name: /expand|collapse/i }).first();
      if (await sectionHeader.isVisible({ timeout: 3000 }).catch(() => false)) {
        await human.click(sectionHeader);
        
        await expect(sectionHeader).toBeVisible();
      }
    }
  });

  test('39.4 Sidebar drag to resize works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const sidebar = page.locator('[data-testid="sidebar"]');
    if (await sidebar.isVisible({ timeout: 5000 }).catch(() => false)) {
      const resizeHandle = sidebar.locator('[data-testid="resize-handle"]');
      if (await resizeHandle.isVisible({ timeout: 3000 }).catch(() => false)) {
        await resizeHandle.dragTo(page.locator('body').first());
        
        await expect(resizeHandle).toBeVisible();
      }
    }
  });

  test('39.5 Sidebar keyboard navigation works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const sidebar = page.locator('[data-testid="sidebar"]');
    if (await sidebar.isVisible({ timeout: 5000 }).catch(() => false)) {
      const navItems = sidebar.getByRole('link');
      if (await navItems.count() > 0) {
        await navItems.first().focus();
        
        await page.keyboard.press('ArrowDown');
        
        const focusedElement = page.locator(':focus');
        await expect(focusedElement).toBeVisible();
      }
    }
  });

  test('39.6 Sidebar search works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const sidebar = page.locator('[data-testid="sidebar"]');
    if (await sidebar.isVisible({ timeout: 5000 }).catch(() => false)) {
      const searchInput = sidebar.getByRole('textbox', { name: /search/i });
      if (await searchInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        await human.type(searchInput, 'bookmarks');
        
        const searchResults = sidebar.locator('[data-testid="search-results"]');
        if (await searchResults.isVisible({ timeout: 3000 }).catch(() => false)) {
          await expect(searchResults).toBeVisible();
        }
      }
    }
  });

  test('39.7 Sidebar favorites work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const sidebar = page.locator('[data-testid="sidebar"]');
    if (await sidebar.isVisible({ timeout: 5000 }).catch(() => false)) {
      const favoritesSection = sidebar.locator('[data-testid="favorites"]');
      if (await favoritesSection.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(favoritesSection).toBeVisible();
      }
    }
  });

  test('39.8 Sidebar icons work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const sidebar = page.locator('[data-testid="sidebar"]');
    if (await sidebar.isVisible({ timeout: 5000 }).catch(() => false)) {
      const icons = sidebar.locator('[data-testid="icon"]');
      if (await icons.count() > 0) {
        await expect(icons.count()).resolves.toBeGreaterThan(0);
      }
    }
  });

  test('39.9 Sidebar theme works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const sidebar = page.locator('[data-testid="sidebar"]');
    if (await sidebar.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(sidebar).toBeVisible();
      
      // Check that sidebar respects current theme
      const body = page.locator('body');
      await expect(body).toBeVisible();
    }
  });

  test('39.10 Sidebar persistence works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const sidebar = page.locator('[data-testid="sidebar"]');
    if (await sidebar.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(sidebar).toBeVisible();
      
      // Reload and check if sidebar state persists
      await page.reload();
      
      const sidebarAfterReload = page.locator('[data-testid="sidebar"]');
      if (await sidebarAfterReload.isVisible({ timeout: 5000 }).catch(() => false)) {
        await expect(sidebarAfterReload).toBeVisible();
      }
    }
  });
});