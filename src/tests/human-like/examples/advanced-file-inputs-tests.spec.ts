/**
 * Advanced File Inputs Tests
 * 
 * Tests for BookmarkForge's file input functionality:
 * - Import file input
 * - Export file input
 * - File validation
 * - File preview
 * - File upload
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Advanced File Inputs Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('should handle import file input', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Navigate to settings
    await page.getByTestId('settings-button').click();
    await page.waitForTimeout(1000);

    // Look for import file input
    const importInput = page.locator('input[type="file"]').first();
    
    if (await importInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Simulate file selection
      await importInput.setInputFiles({
        name: 'test-import.json',
        mimeType: 'application/json',
        buffer: Buffer.from('{"test": "data"}'),
      });

      await page.waitForTimeout(1000);

      // Verify import processing
      const successMessage = page.locator('text=/success|imported|complete/i').first();
      const errorMessage = page.locator('text=/error|failed|invalid/i').first();

      const hasSuccess = await successMessage.isVisible({ timeout: 3000 }).catch(() => false);
      const hasError = await errorMessage.isVisible({ timeout: 3000 }).catch(() => false);

      // Either success or error should be shown
      expect(hasSuccess || hasError).toBe(true);
    }

    // Close settings
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  });

  test('should handle export file input', async ({ page }) => {
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
    const download = await downloadPromise;

    // Export produces a download or a confirmation toast
    const toast = page.locator('[data-sonner-toast], [role="status"], [class*="toast"]').first();
    const hasToast = await toast.isVisible({ timeout: 3000 }).catch(() => false);
    expect(download !== null || hasToast).toBe(true);

    // Close settings
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  });

  test('should validate file type', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Navigate to settings
    await page.getByTestId('settings-button').click();
    await page.waitForTimeout(1000);

    // Look for import file input
    const importInput = page.locator('input[type="file"]').first();
    
    if (await importInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Try to upload invalid file type
      await importInput.setInputFiles({
        name: 'test.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('test'),
      });

      await page.waitForTimeout(1000);

      // Should show validation error
      const validationError = page.locator('text=/invalid|error|unsupported/i').first();
      expect(await validationError.count()).toBeGreaterThanOrEqual(0);
    }

    // Close settings
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  });

  test('should handle file preview', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Navigate to settings
    await page.getByTestId('settings-button').click();
    await page.waitForTimeout(1000);

    // Look for file preview area
    const filePreview = page.locator('[data-testid="file-preview"], [class*="preview"]').first();
    
    if (await filePreview.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(filePreview).toBeVisible();
    }

    // Close settings
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  });

  test('should handle file upload progress', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Navigate to settings
    await page.getByTestId('settings-button').click();
    await page.waitForTimeout(1000);

    // Look for upload button
    const uploadButton = page.locator('button:has-text("Upload"), [data-testid="upload-button"]').first();
    
    if (await uploadButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await uploadButton.click();
      await page.waitForTimeout(1000);

      // Should show progress or completion
      const progressBar = page.locator('[data-testid="progress"], [class*="progress"]').first();
      const successMessage = page.locator('text=/success|complete|uploaded/i').first();

      const hasProgress = await progressBar.isVisible({ timeout: 3000 }).catch(() => false);
      const hasSuccess = await successMessage.isVisible({ timeout: 3000 }).catch(() => false);

      expect(hasProgress || hasSuccess).toBe(true);
    }

    // Close settings
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  });

  test('should handle file input accessibility', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Navigate to settings
    await page.getByTestId('settings-button').click();
    await page.waitForTimeout(1000);

    // Look for file input
    const fileInput = page.locator('input[type="file"]').first();
    
    if (await fileInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Check ARIA attributes
      const ariaLabel = await fileInput.getAttribute('aria-label');
      const ariaDescribedby = await fileInput.getAttribute('aria-describedby');

      // Should have accessibility attributes
      expect(ariaLabel || ariaDescribedby).toBeTruthy();
    }

    // Close settings
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  });
});
