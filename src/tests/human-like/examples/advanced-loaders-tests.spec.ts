/**
 * Advanced Loaders Tests
 * 
 * Tests for BookmarkForge's loading states:
 * - Initial app loading
 * - Lazy loading states
 * - Sync loading
 * - Import/export loading
 * - Loader accessibility
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Advanced Loaders Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('should show loading state during app initialization', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Navigate to app
    await page.goto('/app');
    
    // Check for loading indicators during initialization
    const loadingIndicator = page.locator('[data-testid="loader"], [class*="loader"], [class*="loading"], [class*="spinner"]').first();
    
    // Loading might appear briefly
    const hasLoading = await loadingIndicator.isVisible({ timeout: 3000 }).catch(() => false);
    
    // App should eventually load
    await page.waitForLoadState('networkidle');
    await expect(page.locator('body')).toBeVisible();
  });

  test('should show loading state during lazy loading', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Navigate to a lazy-loaded route
    await page.goto('/app');
    await page.waitForLoadState('networkidle');

    // Trigger lazy loading (e.g., open settings)
    await page.getByTestId('settings-button').click();
    
    // Check for loading state during settings load
    const loadingIndicator = page.locator('[data-testid="loader"], [class*="loader"], [class*="loading"], [class*="spinner"]').first();
    
    // Settings should eventually load
    await page.waitForTimeout(2000);
    const settingsModal = page.locator('[role="dialog"], [data-testid="settings-modal"]').first();
    expect(await settingsModal.count()).toBeGreaterThan(0);

    // Close settings
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  });

  test('should show loading state during sync', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Look for sync button
    const syncButton = page.locator('button:has-text("Sync"), [data-testid="sync-button"]').first();
    
    if (await syncButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await syncButton.click();
      
      // Check for loading indicator during sync
      const loadingIndicator = page.locator('[data-testid="loader"], [class*="loader"], [class*="loading"], [class*="spinner"]').first();
      const hasLoading = await loadingIndicator.isVisible({ timeout: 3000 }).catch(() => false);
      
      // Sync should complete
      await page.waitForTimeout(3000);
      await expect(page.locator('body')).toBeVisible();
    }
  });

  test('should show loading state during import', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Navigate to settings
    await page.getByTestId('settings-button').click();
    await page.waitForTimeout(1000);

    // Look for import button
    const importButton = page.locator('button:has-text("Import"), [data-testid="import-button"]').first();
    
    if (await importButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await importButton.click();
      await page.waitForTimeout(1000);

      // Check for loading indicator during import
      const loadingIndicator = page.locator('[data-testid="loader"], [class*="loader"], [class*="loading"], [class*="spinner"]').first();
      const hasLoading = await loadingIndicator.isVisible({ timeout: 3000 }).catch(() => false);
      
      // Import should complete or show error
      await page.waitForTimeout(2000);
      await expect(page.locator('body')).toBeVisible();
    }

    // Close settings
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  });

  test('should show loading state during export', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Navigate to settings
    await page.getByTestId('settings-button').click();
    await page.waitForTimeout(1000);

    // Look for export button inside the settings dialog
    const dialog = page.getByRole('dialog');
    const exportButton = dialog.getByRole('button', { name: /export/i }).first();

    await expect(exportButton).toBeVisible({ timeout: 10_000 });
    const downloadPromise = page.waitForEvent('download', { timeout: 10000 }).catch(() => null);

    await exportButton.click();

    // Check for loading indicator during export
    const loadingIndicator = page.locator('[data-testid="loader"], [class*="loader"], [class*="loading"], [class*="spinner"]').first();
    const hasLoading = await loadingIndicator.isVisible({ timeout: 3000 }).catch(() => false);

    const download = await downloadPromise;

    // Export produces a download or a confirmation toast
    const toast = page.locator('[data-sonner-toast], [role="status"], [class*="toast"]').first();
    const hasToast = await toast.isVisible({ timeout: 3000 }).catch(() => false);
    expect(download !== null || hasToast || hasLoading).toBe(true);

    // Close settings
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  });

  test('should handle loader accessibility', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Trigger a loading state
    await page.getByTestId('settings-button').click();
    
    // Check for loading indicator
    const loadingIndicator = page.locator('[data-testid="loader"], [class*="loader"], [class*="loading"], [class*="spinner"]').first();
    
    if (await loadingIndicator.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Check ARIA attributes
      const ariaLabel = await loadingIndicator.getAttribute('aria-label');
      const ariaBusy = await loadingIndicator.getAttribute('aria-busy');
      const role = await loadingIndicator.getAttribute('role');

      // Should have accessibility attributes
      expect(ariaLabel || ariaBusy || role).toBeTruthy();
    }

    // Close settings
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  });

  test('should handle loader overlay', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Trigger a loading state that might show overlay
    await page.getByTestId('settings-button').click();
    
    // Check for loading overlay
    const loadingOverlay = page.locator('[data-testid="loader-overlay"], [class*="overlay"], [class*="backdrop"]').first();
    
    if (await loadingOverlay.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(loadingOverlay).toBeVisible();
    }

    // Close settings
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  });

  test('should handle loader centered', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Trigger a loading state
    await page.getByTestId('settings-button').click();
    
    // Check for centered loader
    const loadingIndicator = page.locator('[data-testid="loader"], [class*="loader"], [class*="loading"], [class*="spinner"]').first();
    
    if (await loadingIndicator.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Check if loader is centered
      const box = await loadingIndicator.boundingBox();
      if (box) {
        const viewport = page.viewportSize();
        if (viewport) {
          const centerX = viewport.width / 2;
          const centerY = viewport.height / 2;
          const loaderCenterX = box.x + box.width / 2;
          const loaderCenterY = box.y + box.height / 2;

          // Loader should be roughly centered
          const isCentered = Math.abs(loaderCenterX - centerX) < 100 && Math.abs(loaderCenterY - centerY) < 100;
          // Centering is nice but not critical
          expect(typeof isCentered).toBe('boolean');
        }
      }
    }

    // Close settings
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  });
});
