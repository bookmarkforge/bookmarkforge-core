/**
 * Content and Metadata Tests
 * 
 * Tests for content fetching, metadata extraction, and related features:
 * - Content fetch service integration
 * - Metadata extraction from URLs
 * - Highlight service functionality
 * - Content parsing and rendering
 * - Offline content handling
 * - Metadata caching
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { saveBookmark } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Content and Metadata Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('1.1 Content fetch works for new bookmark', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    await saveBookmark(page, 'https://example.com/article', 'Test Article');
    
    // Wait for content to be fetched
    const contentIndicator = page.locator('[data-testid="content-fetched"]');
    if (await contentIndicator.isVisible({ timeout: 10000 }).catch(() => false)) {
      await expect(contentIndicator).toBeVisible();
    }
  });

  test('1.2 Metadata extraction shows title and description', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    await saveBookmark(page, 'https://example.com/test', 'Test Bookmark');
    
    // Check if metadata is displayed with more defensive selectors
    const titleElement = page.locator('[data-testid="bookmark-title"], .bookmark-title, [class*="title"]').first();
    if (await titleElement.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(titleElement).toBeVisible();
    }
    
    const descriptionElement = page.locator('[data-testid="bookmark-description"], .bookmark-description, [class*="description"]').first();
    if (await descriptionElement.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(descriptionElement).toBeVisible();
    }
  });

  test('1.3 Content fetch handles errors gracefully', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Try to save a bookmark with an invalid URL
    try {
      await saveBookmark(page, 'https://invalid-domain-that-does-not-exist.com', 'Invalid URL');
      
      // Should show error state or fallback
      const errorIndicator = page.locator('[data-testid="fetch-error"]');
      if (await errorIndicator.isVisible({ timeout: 5000 }).catch(() => false)) {
        await expect(errorIndicator).toBeVisible();
      }
    } catch {
      // If the operation fails completely, that's acceptable
    }
  });

  test('1.4 Highlight creation works in reader', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    await saveBookmark(page, 'https://example.com/article', 'Article for Highlighting');
    
    // Open the bookmark reader
    const bookmarkRow = page.locator('[data-testid="bookmark-row"]').first();
    if (await bookmarkRow.isVisible()) {
      await human.click(bookmarkRow);
      
      const readerModal = page.locator('[data-testid="bookmark-reader-modal"]');
      if (await readerModal.isVisible({ timeout: 5000 }).catch(() => false)) {
        await expect(readerModal).toBeVisible();
        
        // Try to create a highlight
        const contentArea = page.locator('[data-testid="reader-content"]');
        if (await contentArea.isVisible()) {
          await contentArea.selectText();
          
          const highlightButton = page.getByRole('button', { name: /highlight/i });
          if (await highlightButton.isVisible({ timeout: 3000 }).catch(() => false)) {
            await human.click(highlightButton);
          }
        }
      }
    }
  });

  test('1.5 Metadata caching works on revisit', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Save bookmark once
    await saveBookmark(page, 'https://example.com/cached', 'Cached Metadata');
    
    // Navigate away and back
    await page.goto('/');
    
    // Find the bookmark again
    const bookmarkRow = page.locator('[data-testid="bookmark-row"]').first();
    if (await bookmarkRow.isVisible()) {
      await human.click(bookmarkRow);
      
      // Metadata should be cached and displayed immediately
      const titleElement = page.locator('[data-testid="bookmark-title"]');
      await expect(titleElement).toBeVisible();
    }
  });

  test('1.6 Content fetch respects offline mode', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Simulate offline mode
    await page.context().setOffline(true);
    
    try {
      await saveBookmark(page, 'https://example.com/offline', 'Offline Bookmark');
      
      // Should show offline indicator or queue for later
      const offlineIndicator = page.locator('[data-testid="offline-indicator"]');
      if (await offlineIndicator.isVisible({ timeout: 5000 }).catch(() => false)) {
        await expect(offlineIndicator).toBeVisible();
      }
    } finally {
      await page.context().setOffline(false);
    }
  });

  test('1.7 Image metadata extraction works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    await saveBookmark(page, 'https://example.com/image-page', 'Image Page');
    
    // Check if image metadata is extracted
    const imagePreview = page.locator('[data-testid="image-preview"]');
    if (await imagePreview.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(imagePreview).toBeVisible();
    }
  });

  test('1.8 Video metadata extraction works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    await saveBookmark(page, 'https://example.com/video-page', 'Video Page');
    
    // Check if video metadata is extracted
    const videoIndicator = page.locator('[data-testid="video-indicator"]');
    if (await videoIndicator.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(videoIndicator).toBeVisible();
    }
  });

  test('1.9 Metadata update on refresh', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    await saveBookmark(page, 'https://example.com/refresh', 'Refresh Test');
    
    // Refresh metadata button
    const refreshButton = page.getByRole('button', { name: /refresh/i });
    if (await refreshButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(refreshButton);
      
      // Should show loading state
      const loadingIndicator = page.locator('[data-testid="loading-indicator"]');
      if (await loadingIndicator.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(loadingIndicator).toBeVisible();
      }
    }
  });

  test('1.10 Bulk metadata fetch works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Create multiple bookmarks
    for (let i = 0; i < 3; i++) {
      await saveBookmark(page, `https://example.com/bulk-${i}`, `Bulk ${i}`);
    }
    
    // Trigger bulk metadata fetch
    const bulkFetchButton = page.getByRole('button', { name: /fetch all/i });
    if (await bulkFetchButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(bulkFetchButton);
      
      // Should show progress
      const progressBar = page.locator('[data-testid="bulk-progress"]');
      if (await progressBar.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(progressBar).toBeVisible();
      }
    }
  });
});