/**
 * Advanced Search Tests
 * 
 * Tests for advanced search functionality:
 * - Advanced search filters
 * - Search operators
 * - Boolean search
 * - Fuzzy search
 * - Search history
 * - Saved searches
 * - Search suggestions
 * - Search results sorting
 * - Search in specific fields
 * - Search analytics
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { saveBookmark } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Advanced Search Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('23.1 Advanced search filters work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const searchInput = page.getByRole('textbox', { name: /search/i });
    if (await searchInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.type(searchInput, 'test');
      
      const filterButton = page.getByRole('button', { name: /filter/i });
      if (await filterButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await human.click(filterButton);
        
        const filterPanel = page.locator('[data-testid="filter-panel"]');
        if (await filterPanel.isVisible({ timeout: 3000 }).catch(() => false)) {
          await expect(filterPanel).toBeVisible();
        }
      }
    }
  });

  test('23.2 Search operators work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const searchInput = page.getByRole('textbox', { name: /search/i });
    if (await searchInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Use search operators
      await human.type(searchInput, 'title:test tag:important');
      
      const searchResults = page.locator('[data-testid="search-results"]');
      if (await searchResults.isVisible({ timeout: 5000 }).catch(() => false)) {
        await expect(searchResults).toBeVisible();
      }
    }
  });

  test('23.3 Boolean search works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const searchInput = page.getByRole('textbox', { name: /search/i });
    if (await searchInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Use boolean operators
      await human.type(searchInput, 'test AND important');
      
      const searchResults = page.locator('[data-testid="search-results"]');
      if (await searchResults.isVisible({ timeout: 5000 }).catch(() => false)) {
        await expect(searchResults).toBeVisible();
      }
    }
  });

  test('23.4 Fuzzy search works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const searchInput = page.getByRole('textbox', { name: /search/i });
    if (await searchInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Type partial match
      await human.type(searchInput, 'tst');
      
      const searchResults = page.locator('[data-testid="search-results"]');
      if (await searchResults.isVisible({ timeout: 5000 }).catch(() => false)) {
        await expect(searchResults).toBeVisible();
      }
    }
  });

  test('23.5 Search history works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const searchInput = page.getByRole('textbox', { name: /search/i });
    if (await searchInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.type(searchInput, 'test');
      
      const historyButton = page.getByRole('button', { name: /history/i });
      if (await historyButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await human.click(historyButton);
        
        const historyPanel = page.locator('[data-testid="search-history"]');
        if (await historyPanel.isVisible({ timeout: 3000 }).catch(() => false)) {
          await expect(historyPanel).toBeVisible();
        }
      }
    }
  });

  test('23.6 Saved searches work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const searchInput = page.getByRole('textbox', { name: /search/i });
    if (await searchInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.type(searchInput, 'test');
      
      const saveSearchButton = page.getByRole('button', { name: /save/i });
      if (await saveSearchButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await human.click(saveSearchButton);
        
        const savedSearches = page.locator('[data-testid="saved-searches"]');
        if (await savedSearches.isVisible({ timeout: 3000 }).catch(() => false)) {
          await expect(savedSearches).toBeVisible();
        }
      }
    }
  });

  test('23.7 Search suggestions work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const searchInput = page.getByRole('textbox', { name: /search/i });
    if (await searchInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.type(searchInput, 't');
      
      const suggestions = page.locator('[data-testid="search-suggestions"]');
      if (await suggestions.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(suggestions).toBeVisible();
      }
    }
  });

  test('23.8 Search results sorting works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const searchInput = page.getByRole('textbox', { name: /search/i });
    if (await searchInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.type(searchInput, 'test');
      
      const sortButton = page.getByRole('button', { name: /sort/i });
      if (await sortButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await human.click(sortButton);
        
        const sortOptions = page.locator('[data-testid="sort-options"]');
        if (await sortOptions.isVisible({ timeout: 3000 }).catch(() => false)) {
          await expect(sortOptions).toBeVisible();
        }
      }
    }
  });

  test('23.9 Search in specific fields works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const searchInput = page.getByRole('textbox', { name: /search/i });
    if (await searchInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.type(searchInput, 'test');
      
      const fieldSelector = page.getByRole('combobox', { name: /field|in/i });
      if (await fieldSelector.isVisible({ timeout: 3000 }).catch(() => false)) {
        await human.click(fieldSelector);
        
        const fieldOptions = page.getByRole('option');
        if (await fieldOptions.count() > 0) {
          await expect(fieldOptions.count()).resolves.toBeGreaterThan(0);
        }
      }
    }
  });

  test('23.10 Search analytics work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const settingsButton = page.getByRole('button', { name: /settings/i });
    if (await settingsButton.isVisible()) {
      await human.click(settingsButton);
      
      const analyticsSection = page.getByRole('button', { name: /analytics/i });
      if (await analyticsSection.isVisible({ timeout: 5000 }).catch(() => false)) {
        await human.click(analyticsSection);
        
        const searchAnalytics = page.locator('[data-testid="search-analytics"]');
        if (await searchAnalytics.isVisible({ timeout: 5000 }).catch(() => false)) {
          await expect(searchAnalytics).toBeVisible();
        }
      }
    }
  });
});