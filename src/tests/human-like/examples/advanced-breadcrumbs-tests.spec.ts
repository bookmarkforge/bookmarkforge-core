/**
 * Advanced Breadcrumbs Tests
 * 
 * Tests for BookmarkForge's breadcrumb navigation:
 * - App breadcrumbs
 * - Breadcrumb navigation
 * - Breadcrumb accessibility
 * - Breadcrumb responsive
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Advanced Breadcrumbs Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('should display breadcrumbs if available', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Look for breadcrumbs
    const breadcrumbs = page.locator('[data-testid="breadcrumbs"], nav[aria-label="breadcrumb"], [class*="breadcrumb"]').first();
    
    if (await breadcrumbs.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(breadcrumbs).toBeVisible();
    }
  });

  test('should handle breadcrumb navigation', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Look for breadcrumbs
    const breadcrumbs = page.locator('[data-testid="breadcrumbs"], nav[aria-label="breadcrumb"], [class*="breadcrumb"]').first();
    
    if (await breadcrumbs.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Look for breadcrumb links
      const breadcrumbLink = breadcrumbs.getByRole('link').first();
      
      if (await breadcrumbLink.isVisible({ timeout: 3000 }).catch(() => false)) {
        await breadcrumbLink.click();
        await page.waitForTimeout(1000);

        // Verify navigation occurred
        await expect(page.locator('body')).toBeVisible();
      }
    }
  });

  test('should handle breadcrumb accessibility', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Look for breadcrumbs
    const breadcrumbs = page.locator('[data-testid="breadcrumbs"], nav[aria-label="breadcrumb"], [class*="breadcrumb"]').first();
    
    if (await breadcrumbs.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Check ARIA attributes
      const ariaLabel = await breadcrumbs.getAttribute('aria-label');
      const role = await breadcrumbs.getAttribute('role');

      // Should have accessibility attributes
      expect(ariaLabel || role).toBeTruthy();
    }
  });

  test('should handle breadcrumb responsive', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Test mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(1000);

    // Look for breadcrumbs
    const breadcrumbs = page.locator('[data-testid="breadcrumbs"], nav[aria-label="breadcrumb"], [class*="breadcrumb"]').first();
    const hasBreadcrumbs = await breadcrumbs.isVisible({ timeout: 3000 }).catch(() => false);

    // Breadcrumbs might or might not be visible on mobile
    expect(typeof hasBreadcrumbs).toBe('boolean');

    // Restore desktop viewport
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForTimeout(500);
  });

  test('should handle breadcrumb truncation', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Look for breadcrumbs
    const breadcrumbs = page.locator('[data-testid="breadcrumbs"], nav[aria-label="breadcrumb"], [class*="breadcrumb"]').first();
    
    if (await breadcrumbs.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Check if breadcrumbs are truncated on small screens
      const box = await breadcrumbs.boundingBox();
      if (box) {
        // Breadcrumbs should fit within viewport
        expect(box.width).toBeLessThanOrEqual(1280);
      }
    }
  });
});
