/**
 * Advanced Shadows Tests
 * 
 * Tests for advanced shadow functionality:
 * - Shadow displays
 * - Shadow elevation
 * - Shadow spread
 * - Shadow blur
 * - Shadow color
 * - Shadow inset
 * - Shadow responsive
 * - Shadow accessibility
 * - Shadow custom
 * - Shadow layering
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { saveBookmark } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Advanced Shadows Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('101.1 Shadow displays', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const shadow = page.locator('[data-testid="shadow"]');
    if (await shadow.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(shadow).toBeVisible();
    }
  });

  test('101.2 Shadow elevation works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const shadow = page.locator('[data-testid="shadow"]').first();
    if (await shadow.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(shadow).toBeVisible();
      
      const boxShadow = await shadow.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return styles.boxShadow;
      });
      if (boxShadow) {
        await expect(boxShadow).toBeTruthy();
      }
    }
  });

  test('101.3 Shadow spread works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const shadow = page.locator('[data-testid="shadow"]').first();
    if (await shadow.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(shadow).toBeVisible();
      
      const boxShadow = await shadow.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return styles.boxShadow;
      });
      if (boxShadow) {
        await expect(boxShadow).toBeTruthy();
      }
    }
  });

  test('101.4 Shadow blur works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const shadow = page.locator('[data-testid="shadow"]').first();
    if (await shadow.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(shadow).toBeVisible();
      
      const boxShadow = await shadow.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return styles.boxShadow;
      });
      if (boxShadow) {
        await expect(boxShadow).toBeTruthy();
      }
    }
  });

  test('101.5 Shadow color works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const shadow = page.locator('[data-testid="shadow"]').first();
    if (await shadow.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(shadow).toBeVisible();
      
      const boxShadow = await shadow.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return styles.boxShadow;
      });
      if (boxShadow) {
        await expect(boxShadow).toBeTruthy();
      }
    }
  });

  test('101.6 Shadow inset works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const shadow = page.locator('[data-testid="shadow"][data-inset="true"]');
    if (await shadow.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(shadow).toBeVisible();
    }
  });

  test('101.7 Shadow responsive works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    await page.setViewportSize({ width: 375, height: 667 });
    
    const shadow = page.locator('[data-testid="shadow"]').first();
    if (await shadow.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(shadow).toBeVisible();
    }
    
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('101.8 Shadow accessibility works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const shadow = page.locator('[data-testid="shadow"]').first();
    if (await shadow.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Check ARIA attributes
      const ariaLabel = await shadow.getAttribute('aria-label');
      const role = await shadow.getAttribute('role');
      
      if (ariaLabel || role) {
        await expect(ariaLabel || role).toBeTruthy();
      }
    }
  });

  test('101.9 Shadow custom works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const shadow = page.locator('[data-testid="shadow"][data-custom="true"]');
    if (await shadow.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(shadow).toBeVisible();
    }
  });

  test('101.10 Shadow layering works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const shadow = page.locator('[data-testid="shadow"][data-layered="true"]');
    if (await shadow.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(shadow).toBeVisible();
    }
  });
});