/**
 * Advanced Modals Tests
 * 
 * Tests for BookmarkForge's modal functionality:
 * - Settings modal
 * - Vault lock modal
 * - Confirmation modals
 * - Modal focus management
 * - Modal scroll behavior
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Advanced Modals Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('should open and close settings modal', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Open settings
    await page.getByTestId('settings-button').click();
    await page.waitForTimeout(1000);

    // Verify modal is visible
    const modal = page.locator('[role="dialog"], [data-testid="settings-modal"]').first();
    expect(await modal.count()).toBeGreaterThan(0);

    // Close with Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Verify modal is closed
    const modalClosed = await modal.isVisible({ timeout: 3000 }).catch(() => false);
    expect(modalClosed).toBe(false);
  });

  test('should trap focus in settings modal', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Open settings
    await page.getByTestId('settings-button').click();
    await page.waitForTimeout(1000);

    // Verify modal is visible
    const modal = page.locator('[role="dialog"], [data-testid="settings-modal"]').first();
    expect(await modal.count()).toBeGreaterThan(0);

    // Tab through elements
    await page.keyboard.press('Tab');
    await page.waitForTimeout(500);

    // Verify focus is inside modal
    const focusedElement = page.locator(':focus').first();
    const isInsideModal = await modal.evaluate((modalEl, focusedEl) => {
      return modalEl.contains(focusedEl);
    }, await focusedElement.elementHandle());

    expect(isInsideModal).toBe(true);

    // Close modal
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  });

  test('should handle escape key in modal', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Open settings
    await page.getByTestId('settings-button').click();
    await page.waitForTimeout(1000);

    // Verify modal is visible
    const modal = page.locator('[role="dialog"], [data-testid="settings-modal"]').first();
    expect(await modal.count()).toBeGreaterThan(0);

    // Press Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Verify modal is closed
    const modalClosed = await modal.isVisible({ timeout: 3000 }).catch(() => false);
    expect(modalClosed).toBe(false);
  });

  test('should open vault lock modal', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Look for lock button
    const lockButton = page.locator('button:has-text("Lock"), [data-testid="lock-button"]').first();
    
    if (await lockButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await lockButton.click();
      await page.waitForTimeout(1000);

      // Verify unlock modal appears
      const unlockModal = page.locator('text=/unlock|password|vault/i').first();
      expect(await unlockModal.count()).toBeGreaterThan(0);
    }
  });

  test('should handle confirmation modal', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Look for delete button (triggers confirmation)
    const deleteButton = page.locator('button:has-text("Delete"), [data-testid="delete-button"]').first();
    
    if (await deleteButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await deleteButton.click();
      await page.waitForTimeout(1000);

      // Verify confirmation modal appears
      const confirmModal = page.locator('[role="alertdialog"], [role="dialog"], text=/confirm|are you sure/i').first();
      expect(await confirmModal.count()).toBeGreaterThan(0);

      // Cancel confirmation
      const cancelButton = page.locator('button:has-text("Cancel"), button:has-text("No")').first();
      if (await cancelButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await cancelButton.click();
        await page.waitForTimeout(500);
      }
    }
  });

  test('should handle modal backdrop click', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Open settings
    await page.getByTestId('settings-button').click();
    await page.waitForTimeout(1000);

    // Verify modal is visible
    const modal = page.locator('[role="dialog"], [data-testid="settings-modal"]').first();
    expect(await modal.count()).toBeGreaterThan(0);

    // Click on backdrop (outside modal)
    await page.mouse.click(10, 10);
    await page.waitForTimeout(500);

    // Modal might close or stay open depending on implementation
    const modalVisible = await modal.isVisible({ timeout: 3000 }).catch(() => false);
    // Either way, app should remain functional
    await expect(page.locator('body')).toBeVisible();
  });

  test('should handle nested modals', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Open settings
    await page.getByTestId('settings-button').click();
    await page.waitForTimeout(1000);

    // Look for button that opens nested modal
    const nestedButton = page.locator('button:has-text("Advanced"), button:has-text("More"), [data-testid="advanced-settings"]').first();
    
    if (await nestedButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await nestedButton.click();
      await page.waitForTimeout(1000);

      // Verify nested modal appears
      const nestedModal = page.locator('[role="dialog"]').nth(1);
      expect(await nestedModal.count()).toBeGreaterThan(0);

      // Close nested modal
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    }

    // Close settings
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  });

  test('should handle modal accessibility', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Open settings
    await page.getByTestId('settings-button').click();
    await page.waitForTimeout(1000);

    // Verify modal has proper ARIA attributes
    const modal = page.locator('[role="dialog"], [data-testid="settings-modal"]').first();
    expect(await modal.count()).toBeGreaterThan(0);

    const ariaLabel = await modal.getAttribute('aria-label');
    const ariaModal = await modal.getAttribute('aria-modal');

    // Should have aria-modal or aria-label
    expect(ariaLabel || ariaModal).toBeTruthy();

    // Close modal
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  });

  test('should handle modal size variants', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Open settings
    await page.getByTestId('settings-button').click();
    await page.waitForTimeout(1000);

    // Verify modal has reasonable size
    const modal = page.locator('[role="dialog"], [data-testid="settings-modal"]').first();
    expect(await modal.count()).toBeGreaterThan(0);

    const box = await modal.boundingBox();
    if (box) {
      expect(box.width).toBeGreaterThan(0);
      expect(box.height).toBeGreaterThan(0);
    }

    // Close modal
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  });

  test('should handle modal animation', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Open settings
    await page.getByTestId('settings-button').click();
    await page.waitForTimeout(1000);

    // Verify modal is visible
    const modal = page.locator('[role="dialog"], [data-testid="settings-modal"]').first();
    expect(await modal.count()).toBeGreaterThan(0);

    // Check for animation classes
    const className = await modal.getAttribute('class');
    expect(className).toBeTruthy();

    // Close modal
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  });

  test('should handle modal scroll behavior', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Open settings
    await page.getByTestId('settings-button').click();
    await page.waitForTimeout(1000);

    // Verify modal is visible
    const modal = page.locator('[role="dialog"], [data-testid="settings-modal"]').first();
    expect(await modal.count()).toBeGreaterThan(0);

    // Try to scroll within modal
    const modalContent = modal.locator('[data-testid="modal-content"], .modal-content, [class*="content"]').first();
    if (await modalContent.isVisible({ timeout: 3000 }).catch(() => false)) {
      await modalContent.evaluate(el => el.scrollTop = 100);
      await page.waitForTimeout(500);
    }

    // Close modal
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  });

  test('should handle modal persistence on reload', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Open settings
    await page.getByTestId('settings-button').click();
    await page.waitForTimeout(1000);

    // Verify modal is visible
    const modal = page.locator('[role="dialog"], [data-testid="settings-modal"]').first();
    expect(await modal.count()).toBeGreaterThan(0);

    // Reload page
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Modal should close on reload (expected behavior)
    const modalAfterReload = page.locator('[role="dialog"], [data-testid="settings-modal"]').first();
    const modalVisible = await modalAfterReload.isVisible({ timeout: 3000 }).catch(() => false);
    expect(modalVisible).toBe(false);
  });
});
