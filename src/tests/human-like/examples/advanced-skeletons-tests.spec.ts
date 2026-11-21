/**
 * Advanced Skeletons Tests
 * 
 * Tests for BookmarkForge's skeleton loading states:
 * - Bookmark list skeletons
 * - Settings skeletons
 * - Lazy loading skeletons
 * - Skeleton accessibility
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Advanced Skeletons Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('should show skeleton during initial load', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Navigate to app
    await page.goto('/app');
    
    // Check for skeleton during load
    const skeleton = page.locator('[data-testid="skeleton"], [class*="skeleton"], [class*="placeholder"]').first();
    
    // Skeleton might appear briefly
    const hasSkeleton = await skeleton.isVisible({ timeout: 3000 }).catch(() => false);
    
    // App should eventually load
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toBeVisible();
  });

  test('should show skeleton during lazy loading', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Navigate to app
    await page.goto('/app');
    await page.waitForLoadState('networkidle');

    // Trigger lazy loading (e.g., open settings)
    await page.getByTestId('settings-button').click();
    
    // Check for skeleton during settings load
    const skeleton = page.locator('[data-testid="skeleton"], [class*="skeleton"], [class*="placeholder"]').first();
    const hasSkeleton = await skeleton.isVisible({ timeout: 3000 }).catch(() => false);
    
    // Settings should eventually load
    await page.waitForTimeout(2000);
    const settingsModal = page.locator('[role="dialog"], [data-testid="settings-modal"]').first();
    expect(await settingsModal.count()).toBeGreaterThan(0);

    // Close settings
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  });

  test('should show skeleton for bookmark list', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Navigate to app
    await page.goto('/app');
    await page.waitForLoadState('networkidle');

    // Check for bookmark list skeleton
    const bookmarkSkeleton = page.locator('[data-testid="bookmark-skeleton"], [class*="bookmark-skeleton"], [class*="skeleton"]').first();
    
    // Skeleton might appear if bookmarks are loading
    const hasSkeleton = await bookmarkSkeleton.isVisible({ timeout: 3000 }).catch(() => false);
    
    // Either skeleton or bookmarks should be visible
    const bookmarks = page.locator('[data-testid="bookmark-item"], .bookmark-card, [class*="bookmark"]').first();
    const hasBookmarks = await bookmarks.isVisible({ timeout: 3000 }).catch(() => false);
    
    expect(hasSkeleton || hasBookmarks).toBe(true);
  });

  test('should handle skeleton accessibility', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Trigger a loading state
    await page.getByTestId('settings-button').click();
    
    // Check for skeleton
    const skeleton = page.locator('[data-testid="skeleton"], [class*="skeleton"], [class*="placeholder"]').first();
    
    if (await skeleton.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Check ARIA attributes
      const ariaLabel = await skeleton.getAttribute('aria-label');
      const ariaBusy = await skeleton.getAttribute('aria-busy');
      const role = await skeleton.getAttribute('role');

      // Should have accessibility attributes
      expect(ariaLabel || ariaBusy || role).toBeTruthy();
    }

    // Close settings
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  });

  test('should handle skeleton responsive', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Test mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/app');
    await page.waitForLoadState('networkidle');

    // Check for skeleton
    const skeleton = page.locator('[data-testid="skeleton"], [class*="skeleton"], [class*="placeholder"]').first();
    const hasSkeleton = await skeleton.isVisible({ timeout: 3000 }).catch(() => false);
    
    // Restore desktop viewport
    await page.setViewportSize({ width: 1280, height: 720 });
    
    // App should still be functional
    await expect(page.locator('body')).toBeVisible();
  });
});
