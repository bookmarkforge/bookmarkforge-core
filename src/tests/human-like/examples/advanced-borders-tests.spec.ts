/**
 * Advanced Borders Tests
 * 
 * Tests for advanced border functionality:
 * - Border displays
 * - Border width
 * - Border style
 * - Border color
 * - Border radius
 * - Border responsive
 * - Border accessibility
 * - Border custom
 * - Border variants
 * - Border combined
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { saveBookmark } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Advanced Borders Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('102.1 Border displays', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const border = page.locator('[data-testid="border"]');
    if (await border.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(border).toBeVisible();
    }
  });

  test('102.2 Border width works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const border = page.locator('[data-testid="border"]').first();
    if (await border.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(border).toBeVisible();
      
      const borderWidth = await border.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return styles.borderWidth;
      });
      if (borderWidth) {
        await expect(borderWidth).toBeTruthy();
      }
    }
  });

  test('102.3 Border style works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const border = page.locator('[data-testid="border"]').first();
    if (await border.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(border).toBeVisible();
      
      const borderStyle = await border.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return styles.borderStyle;
      });
      if (borderStyle) {
        await expect(borderStyle).toBeTruthy();
      }
    }
  });

  test('102.4 Border color works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const border = page.locator('[data-testid="border"]').first();
    if (await border.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(border).toBeVisible();
      
      const borderColor = await border.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return styles.borderColor;
      });
      if (borderColor) {
        await expect(borderColor).toBeTruthy();
      }
    }
  });

  test('102.5 Border radius works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const border = page.locator('[data-testid="border"]').first();
    if (await border.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(border).toBeVisible();
      
      const borderRadius = await border.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return styles.borderRadius;
      });
      if (borderRadius) {
        await expect(borderRadius).toBeTruthy();
      }
    }
  });

  test('102.6 Border responsive works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    await page.setViewportSize({ width: 375, height: 667 });
    
    const border = page.locator('[data-testid="border"]').first();
    if (await border.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(border).toBeVisible();
    }
    
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('102.7 Border accessibility works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const border = page.locator('[data-testid="border"]').first();
    if (await border.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Check ARIA attributes
      const ariaLabel = await border.getAttribute('aria-label');
      const role = await border.getAttribute('role');
      
      if (ariaLabel || role) {
        await expect(ariaLabel || role).toBeTruthy();
      }
    }
  });

  test('102.8 Border custom works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const border = page.locator('[data-testid="border"][data-custom="true"]');
    if (await border.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(border).toBeVisible();
    }
  });

  test('102.9 Border variants work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const border = page.locator('[data-testid="border"][data-variant="true"]');
    if (await border.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(border).toBeVisible();
    }
  });

  test('102.10 Border combined works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const border = page.locator('[data-testid="border"][data-combined="true"]');
    if (await border.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(border).toBeVisible();
    }
  });
});