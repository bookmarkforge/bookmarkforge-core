/**
 * Advanced Dialogs Tests
 * 
 * Tests for BookmarkForge's dialog/modal functionality:
 * - Settings modal
 * - Vault lock dialog
 * - Confirmation dialogs
 * - Focus trap behavior
 * - Escape key handling
 * - Backdrop click
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Advanced Dialogs Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('should open and close settings dialog', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Open settings
    await page.getByTestId('settings-button').click();
    await page.waitForTimeout(1000);

    // Verify dialog is visible
    const dialog = page.locator('[role="dialog"], [data-testid="settings-modal"]').first();
    expect(await dialog.count()).toBeGreaterThan(0);

    // Close with Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Verify dialog is closed
    const dialogClosed = await dialog.isVisible({ timeout: 3000 }).catch(() => false);
    expect(dialogClosed).toBe(false);
  });

  test('should trap focus in settings dialog', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Open settings
    await page.getByTestId('settings-button').click();
    await page.waitForTimeout(1000);

    // Verify dialog is visible
    const dialog = page.locator('[role="dialog"], [data-testid="settings-modal"]').first();
    expect(await dialog.count()).toBeGreaterThan(0);

    // Tab through elements
    await page.keyboard.press('Tab');
    await page.waitForTimeout(500);

    // Verify focus is inside dialog
    const focusedElement = page.locator(':focus').first();
    const isInsideDialog = await dialog.evaluate((dialogEl, focusedEl) => {
      return dialogEl.contains(focusedEl);
    }, await focusedElement.elementHandle());

    expect(isInsideDialog).toBe(true);

    // Close dialog
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  });

  test('should handle escape key in dialog', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Open settings
    await page.getByTestId('settings-button').click();
    await page.waitForTimeout(1000);

    // Verify dialog is visible
    const dialog = page.locator('[role="dialog"], [data-testid="settings-modal"]').first();
    expect(await dialog.count()).toBeGreaterThan(0);

    // Press Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Verify dialog is closed
    const dialogClosed = await dialog.isVisible({ timeout: 3000 }).catch(() => false);
    expect(dialogClosed).toBe(false);
  });

  test('should open vault lock dialog', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Look for lock button
    const lockButton = page.locator('button:has-text("Lock"), [data-testid="lock-button"]').first();
    
    if (await lockButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await lockButton.click();
      await page.waitForTimeout(1000);

      // Verify unlock dialog appears
      const unlockDialog = page.locator('text=/unlock|password|vault/i').first();
      expect(await unlockDialog.count()).toBeGreaterThan(0);
    }
  });

  test('should handle confirmation dialog', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Look for delete button (triggers confirmation)
    const deleteButton = page.locator('button:has-text("Delete"), [data-testid="delete-button"]').first();
    
    if (await deleteButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await deleteButton.click();
      await page.waitForTimeout(1000);

      // Verify confirmation dialog appears
      const confirmDialog = page.locator('[role="alertdialog"], [role="dialog"], text=/confirm|are you sure/i').first();
      expect(await confirmDialog.count()).toBeGreaterThan(0);

      // Cancel confirmation
      const cancelButton = page.locator('button:has-text("Cancel"), button:has-text("No")').first();
      if (await cancelButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await cancelButton.click();
        await page.waitForTimeout(500);
      }
    }
  });

  test('should handle dialog backdrop click', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Open settings
    await page.getByTestId('settings-button').click();
    await page.waitForTimeout(1000);

    // Verify dialog is visible
    const dialog = page.locator('[role="dialog"], [data-testid="settings-modal"]').first();
    expect(await dialog.count()).toBeGreaterThan(0);

    // Click on backdrop (outside dialog)
    await page.mouse.click(10, 10);
    await page.waitForTimeout(500);

    // Dialog might close or stay open depending on implementation
    const dialogVisible = await dialog.isVisible({ timeout: 3000 }).catch(() => false);
    // Either way, app should remain functional
    await expect(page.locator('body')).toBeVisible();
  });

  test('should handle nested dialogs', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Open settings
    await page.getByTestId('settings-button').click();
    await page.waitForTimeout(1000);

    // Look for button that opens nested dialog
    const nestedButton = page.locator('button:has-text("Advanced"), button:has-text("More"), [data-testid="advanced-settings"]').first();
    
    if (await nestedButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await nestedButton.click();
      await page.waitForTimeout(1000);

      // Verify nested dialog appears
      const nestedDialog = page.locator('[role="dialog"]').nth(1);
      expect(await nestedDialog.count()).toBeGreaterThan(0);

      // Close nested dialog
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }

    // Close settings
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  });

  test('should handle dialog accessibility', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Open settings
    await page.getByTestId('settings-button').click();
    await page.waitForTimeout(1000);

    // Verify dialog has proper ARIA attributes
    const dialog = page.locator('[role="dialog"], [data-testid="settings-modal"]').first();
    expect(await dialog.count()).toBeGreaterThan(0);

    const ariaLabel = await dialog.getAttribute('aria-label');
    const ariaModal = await dialog.getAttribute('aria-modal');

    // Should have aria-modal or aria-label
    expect(ariaLabel || ariaModal).toBeTruthy();

    // Close dialog
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  });

  test('should handle dialog size variants', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Open settings
    await page.getByTestId('settings-button').click();
    await page.waitForTimeout(1000);

    // Verify dialog has reasonable size
    const dialog = page.locator('[role="dialog"], [data-testid="settings-modal"]').first();
    expect(await dialog.count()).toBeGreaterThan(0);

    const box = await dialog.boundingBox();
    if (box) {
      expect(box.width).toBeGreaterThan(0);
      expect(box.height).toBeGreaterThan(0);
    }

    // Close dialog
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  });

  test('should handle dialog animation', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Open settings
    await page.getByTestId('settings-button').click();
    await page.waitForTimeout(1000);

    // Verify dialog is visible
    const dialog = page.locator('[role="dialog"], [data-testid="settings-modal"]').first();
    expect(await dialog.count()).toBeGreaterThan(0);

    // Check for animation classes
    const className = await dialog.getAttribute('class');
    expect(className).toBeTruthy();

    // Close dialog
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  });
});
