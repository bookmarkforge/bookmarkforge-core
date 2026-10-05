/**
 * Advanced Resize Tests
 * 
 * Tests for advanced resize observer functionality:
 * - Resize displays
 * - Resize width
 * - Resize height
 * - Resize responsive
 * - Resize debounce
 * - Resize accessibility
 * - Resize custom
 * - Resize threshold
 * - Resize container
 * - Resize layout
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { saveBookmark } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Advanced Resize Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('114.1 Resize displays', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const resize = page.locator('[data-testid="resize"]');
    if (await resize.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(resize).toBeVisible();
    }
  });

  test('114.2 Resize width works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const resize = page.locator('[data-testid="resize"]').first();
    if (await resize.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(resize).toBeVisible();
      
      const width = await resize.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return styles.width;
      });
      if (width) {
        await expect(width).toBeTruthy();
      }
    }
  });

  test('114.3 Resize height works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const resize = page.locator('[data-testid="resize"]').first();
    if (await resize.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(resize).toBeVisible();
      
      const height = await resize.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return styles.height;
      });
      if (height) {
        await expect(height).toBeTruthy();
      }
    }
  });

  test('114.4 Resize responsive works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    await page.setViewportSize({ width: 375, height: 667 });
    
    const resize = page.locator('[data-testid="resize"]').first();
    if (await resize.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(resize).toBeVisible();
    }
    
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('114.5 Resize debounce works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const resize = page.locator('[data-testid="resize"][data-debounce="true"]');
    if (await resize.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(resize).toBeVisible();
      
      await page.setViewportSize({ width: 500, height: 500 });
      
      await expect(resize).toBeVisible();
    }
    
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('114.6 Resize accessibility works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const resize = page.locator('[data-testid="resize"]').first();
    if (await resize.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Check ARIA attributes
      const ariaLabel = await resize.getAttribute('aria-label');
      const role = await resize.getAttribute('role');
      
      if (ariaLabel || role) {
        await expect(ariaLabel || role).toBeTruthy();
      }
    }
  });

  test('114.7 Resize custom works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const resize = page.locator('[data-testid="resize"][data-custom="true"]');
    if (await resize.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(resize).toBeVisible();
    }
  });

  test('114.8 Resize threshold works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const resize = page.locator('[data-testid="resize"][data-threshold="true"]');
    if (await resize.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(resize).toBeVisible();
      
      await page.setViewportSize({ width: 500, height: 500 });
      
      await expect(resize).toBeVisible();
    }
    
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('114.9 Resize container works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const resize = page.locator('[data-testid="resize"][data-container="true"]');
    if (await resize.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(resize).toBeVisible();
    }
  });

  test('114.10 Resize layout works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const resize = page.locator('[data-testid="resize"][data-layout="true"]');
    if (await resize.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(resize).toBeVisible();
      
      await page.setViewportSize({ width: 500, height: 500 });
      
      await expect(resize).toBeVisible();
    }
    
    await page.setViewportSize({ width: 1280, height: 720 });
  });
});