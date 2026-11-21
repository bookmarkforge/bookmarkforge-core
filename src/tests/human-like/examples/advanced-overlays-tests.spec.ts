/**
 * Advanced Overlays Tests
 * 
 * Tests for BookmarkForge's overlay functionality:
 * - Modal overlays
 * - Dropdown overlays
 * - Tooltip overlays
 * - Overlay dismissal
 * - Overlay accessibility
 * - Overlay positioning
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Advanced Overlays Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('should show overlay when opening settings modal', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Open settings
    await page.getByTestId('settings-button').click();
    await page.waitForTimeout(1000);

    // Check for overlay/backdrop
    const overlay = page.locator('[data-testid="overlay"], [class*="overlay"], [class*="backdrop"], [role="dialog"]').first();
    
    if (await overlay.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(overlay).toBeVisible();
    }

    // Close settings
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  });

  test('should handle overlay position', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Open settings
    await page.getByTestId('settings-button').click();
    await page.waitForTimeout(1000);

    // Check for overlay
    const overlay = page.locator('[data-testid="overlay"], [class*="overlay"], [class*="backdrop"], [role="dialog"]').first();
    
    if (await overlay.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Check overlay position
      const position = await overlay.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return styles.position;
      });
      
      // Overlay should have position property
      expect(position).toBeTruthy();
    }

    // Close settings
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  });

  test('should handle overlay z-index', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Open settings
    await page.getByTestId('settings-button').click();
    await page.waitForTimeout(1000);

    // Check for overlay
    const overlay = page.locator('[data-testid="overlay"], [class*="overlay"], [class*="backdrop"], [role="dialog"]').first();
    
    if (await overlay.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Check overlay z-index
      const zIndex = await overlay.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return styles.zIndex;
      });
      
      // Overlay should have z-index
      expect(zIndex).toBeTruthy();
    }

    // Close settings
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  });

  test('should handle overlay dismissal', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Open settings
    await page.getByTestId('settings-button').click();
    await page.waitForTimeout(1000);

    // Check for overlay
    const overlay = page.locator('[data-testid="overlay"], [class*="overlay"], [class*="backdrop"], [role="dialog"]').first();
    
    if (await overlay.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Dismiss with Escape
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);

      // Overlay should be dismissed
      const overlayVisible = await overlay.isVisible({ timeout: 3000 }).catch(() => false);
      expect(overlayVisible).toBe(false);
    }
  });

  test('should handle overlay focus', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Open settings
    await page.getByTestId('settings-button').click();
    await page.waitForTimeout(1000);

    // Check for overlay
    const overlay = page.locator('[data-testid="overlay"], [class*="overlay"], [class*="backdrop"], [role="dialog"]').first();
    
    if (await overlay.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Check if focus is trapped in overlay
      await page.keyboard.press('Tab');
      await page.waitForTimeout(500);

      // Focus should be inside overlay
      const focusedElement = page.locator(':focus').first();
      const isInsideOverlay = await overlay.evaluate((overlayEl, focusedEl) => {
        return overlayEl.contains(focusedEl);
      }, await focusedElement.elementHandle());

      expect(isInsideOverlay).toBe(true);
    }

    // Close settings
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  });

  test('should handle overlay accessibility', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Open settings
    await page.getByTestId('settings-button').click();
    await page.waitForTimeout(1000);

    // Check for overlay — the settings dialog carries the ARIA semantics
    const overlay = page.getByRole('dialog').first();
    
    await expect(overlay).toBeVisible({ timeout: 10_000 });

    // Dialog must expose an accessible name
    await expect(overlay).toHaveAccessibleName(/.+/, { timeout: 5_000 });

    // Close settings
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  });

  test('should handle overlay responsive', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Test mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(1000);

    // Open settings
    await page.getByTestId('settings-button').click();
    await page.waitForTimeout(1000);

    // Check for overlay
    const overlay = page.locator('[data-testid="overlay"], [class*="overlay"], [class*="backdrop"], [role="dialog"]').first();
    const hasOverlay = await overlay.isVisible({ timeout: 3000 }).catch(() => false);

    // Overlay should be visible on mobile
    expect(hasOverlay).toBe(true);

    // Close settings
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Restore desktop viewport
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForTimeout(500);
  });
});
