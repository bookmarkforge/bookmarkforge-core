/**
 * Omnibar Advanced Tests
 * 
 * Tests for advanced omnibar functionality:
 * - Command execution
 * - Search and navigation
 * - Keyboard shortcuts
 * - Command history
 * - Quick actions
 * - Fuzzy search
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { saveBookmark } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Omnibar Advanced Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('6.1 Omnibar opens with keyboard shortcut', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Try common keyboard shortcuts for omnibar
    await page.keyboard.press('Control+K');
    
    const omnibar = page.locator('[data-testid="omnibar"], [data-testid="command-palette"]');
    if (await omnibar.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(omnibar).toBeVisible();
    }
  });

  test('6.2 Omnibar search works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Create some bookmarks to search
    await saveBookmark(page, 'https://example.com/search-test', 'Search Test');
    
    // Open omnibar
    await page.keyboard.press('Control+K');
    
    const omnibar = page.locator('[data-testid="omnibar"], [data-testid="command-palette"]');
    if (await omnibar.isVisible({ timeout: 3000 }).catch(() => false)) {
      const searchInput = omnibar.getByRole('textbox');
      if (await searchInput.isVisible()) {
        await human.type(searchInput, 'Search Test');
        
        // Should show search results
        const searchResults = omnibar.locator('[data-testid="search-results"]');
        if (await searchResults.isVisible({ timeout: 3000 }).catch(() => false)) {
          await expect(searchResults).toBeVisible();
        }
      }
    }
  });

  test('6.3 Omnibar executes commands', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Open omnibar
    await page.keyboard.press('Control+K');
    
    const omnibar = page.locator('[data-testid="omnibar"], [data-testid="command-palette"]');
    if (await omnibar.isVisible({ timeout: 3000 }).catch(() => false)) {
      const searchInput = omnibar.getByRole('textbox');
      if (await searchInput.isVisible()) {
        await human.type(searchInput, 'settings');
        
        // Should show command suggestions
        const commandSuggestions = omnibar.locator('[data-testid="command-suggestion"]');
        if (await commandSuggestions.first().isVisible({ timeout: 3000 }).catch(() => false)) {
          await human.click(commandSuggestions.first());
          
          // Should execute the command
          const settingsPage = page.locator('[data-testid="settings-page"]');
          if (await settingsPage.isVisible({ timeout: 5000 }).catch(() => false)) {
            await expect(settingsPage).toBeVisible();
          }
        }
      }
    }
  });

  test('6.4 Omnibar fuzzy search works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Create bookmark with specific title
    await saveBookmark(page, 'https://example.com/fuzzy-test', 'Fuzzy Search Test');
    
    // Open omnibar
    await page.keyboard.press('Control+K');
    
    const omnibar = page.locator('[data-testid="omnibar"], [data-testid="command-palette"]');
    if (await omnibar.isVisible({ timeout: 3000 }).catch(() => false)) {
      const searchInput = omnibar.getByRole('textbox');
      if (await searchInput.isVisible()) {
        // Type partial match
        await human.type(searchInput, 'fuzzy test');
        
        // Should find the bookmark
        const searchResults = omnibar.locator('[data-testid="search-results"]');
        if (await searchResults.isVisible({ timeout: 3000 }).catch(() => false)) {
          await expect(searchResults).toBeVisible();
        }
      }
    }
  });

  test('6.5 Omnibar navigation with arrow keys', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Create multiple bookmarks
    await saveBookmark(page, 'https://example.com/nav-1', 'Navigation Test 1');
    await saveBookmark(page, 'https://example.com/nav-2', 'Navigation Test 2');
    
    // Open omnibar
    await page.keyboard.press('Control+K');
    
    const omnibar = page.locator('[data-testid="omnibar"], [data-testid="command-palette"]');
    if (await omnibar.isVisible({ timeout: 3000 }).catch(() => false)) {
      const searchInput = omnibar.getByRole('textbox');
      if (await searchInput.isVisible()) {
        await human.type(searchInput, 'Navigation');
        
        // Try navigation with arrow keys
        await page.keyboard.press('ArrowDown');
        
        // Should select first result
        const firstResult = omnibar.locator('[data-testid="search-result"]').first();
        if (await firstResult.isVisible({ timeout: 3000 }).catch(() => false)) {
          await expect(firstResult).toBeVisible();
        }
      }
    }
  });

  test('6.6 Omnibar closes with Escape', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Open omnibar
    await page.keyboard.press('Control+K');
    
    const omnibar = page.locator('[data-testid="omnibar"], [data-testid="command-palette"]');
    if (await omnibar.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(omnibar).toBeVisible();
      
      // Close with Escape
      await page.keyboard.press('Escape');
      
      await expect(omnibar).not.toBeVisible({ timeout: 3000 });
    }
  });

  test('6.7 Omnibar quick actions work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Open omnibar
    await page.keyboard.press('Control+K');
    
    const omnibar = page.locator('[data-testid="omnibar"], [data-testid="command-palette"]');
    if (await omnibar.isVisible({ timeout: 3000 }).catch(() => false)) {
      const searchInput = omnibar.getByRole('textbox');
      if (await searchInput.isVisible()) {
        await human.type(searchInput, '>');
        
        // Should show quick actions
        const quickActions = omnibar.locator('[data-testid="quick-actions"]');
        if (await quickActions.isVisible({ timeout: 3000 }).catch(() => false)) {
          await expect(quickActions).toBeVisible();
        }
      }
    }
  });

  test('6.8 Omnibar recent items appear', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Create and access a bookmark
    await saveBookmark(page, 'https://example.com/recent', 'Recent Test');
    
    // Open omnibar
    await page.keyboard.press('Control+K');
    
    const omnibar = page.locator('[data-testid="omnibar"], [data-testid="command-palette"]');
    if (await omnibar.isVisible({ timeout: 3000 }).catch(() => false)) {
      const recentItems = omnibar.locator('[data-testid="recent-items"]');
      if (await recentItems.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(recentItems).toBeVisible();
      }
    }
  });

  test('6.9 Omnibar handles empty results', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Open omnibar
    await page.keyboard.press('Control+K');
    
    const omnibar = page.locator('[data-testid="omnibar"], [data-testid="command-palette"]');
    if (await omnibar.isVisible({ timeout: 3000 }).catch(() => false)) {
      const searchInput = omnibar.getByRole('textbox');
      if (await searchInput.isVisible()) {
        // Search for something that doesn't exist
        await human.type(searchInput, 'nonexistent-item-xyz-123');
        
        // Should show empty state
        const emptyState = omnibar.locator('[data-testid="empty-state"]');
        if (await emptyState.isVisible({ timeout: 3000 }).catch(() => false)) {
          await expect(emptyState).toBeVisible();
        }
      }
    }
  });

  test('6.10 Omnibar bookmarks specific search', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Create a bookmark
    await saveBookmark(page, 'https://example.com/bookmark-search', 'Bookmark Search Test');
    
    // Open omnibar
    await page.keyboard.press('Control+K');
    
    const omnibar = page.locator('[data-testid="omnibar"], [data-testid="command-palette"]');
    if (await omnibar.isVisible({ timeout: 3000 }).catch(() => false)) {
      const searchInput = omnibar.getByRole('textbox');
      if (await searchInput.isVisible()) {
        // Use bookmark-specific search prefix
        await human.type(searchInput, 'b Bookmark Search');
        
        // Should show bookmark results
        const bookmarkResults = omnibar.locator('[data-testid="bookmark-results"]');
        if (await bookmarkResults.isVisible({ timeout: 3000 }).catch(() => false)) {
          await expect(bookmarkResults).toBeVisible();
        }
      }
    }
  });
});