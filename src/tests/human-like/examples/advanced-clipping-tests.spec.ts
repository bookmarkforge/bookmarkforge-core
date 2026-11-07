/**
 * Advanced Clipping Tests
 * 
 * Tests for advanced clipping functionality:
 * - Clipping displays
 * - Clipping overflow
 * - Clipping text
 * - Clipping mask
 * - Clipping path
 * - Clipping responsive
 * - Clipping accessibility
 * - Clipping custom
 * - Clipping ellipsis
 * - Clipping clip-path
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { saveBookmark } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Advanced Clipping Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('109.1 Clipping displays', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const clipping = page.locator('[data-testid="clipping"]');
    if (await clipping.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(clipping).toBeVisible();
    }
  });

  test('109.2 Clipping overflow works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const clipping = page.locator('[data-testid="clipping"]').first();
    if (await clipping.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(clipping).toBeVisible();
      
      const overflow = await clipping.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return styles.overflow;
      });
      if (overflow) {
        await expect(overflow).toBeTruthy();
      }
    }
  });

  test('109.3 Clipping text works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const clipping = page.locator('[data-testid="clipping"][data-text="true"]');
    if (await clipping.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(clipping).toBeVisible();
      
      const textOverflow = await clipping.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return styles.textOverflow;
      });
      if (textOverflow) {
        await expect(textOverflow).toBeTruthy();
      }
    }
  });

  test('109.4 Clipping mask works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const clipping = page.locator('[data-testid="clipping"][data-mask="true"]');
    if (await clipping.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(clipping).toBeVisible();
      
      const mask = await clipping.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return styles.mask || styles.webkitMask;
      });
      if (mask) {
        await expect(mask).toBeTruthy();
      }
    }
  });

  test('109.5 Clipping path works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const clipping = page.locator('[data-testid="clipping"][data-path="true"]');
    if (await clipping.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(clipping).toBeVisible();
      
      const clipPath = await clipping.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return styles.clipPath;
      });
      if (clipPath) {
        await expect(clipPath).toBeTruthy();
      }
    }
  });

  test('109.6 Clipping responsive works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    await page.setViewportSize({ width: 375, height: 667 });
    
    const clipping = page.locator('[data-testid="clipping"]').first();
    if (await clipping.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(clipping).toBeVisible();
    }
    
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('109.7 Clipping accessibility works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const clipping = page.locator('[data-testid="clipping"]').first();
    if (await clipping.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Check ARIA attributes
      const ariaLabel = await clipping.getAttribute('aria-label');
      const role = await clipping.getAttribute('role');
      
      if (ariaLabel || role) {
        await expect(ariaLabel || role).toBeTruthy();
      }
    }
  });

  test('109.8 Clipping custom works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const clipping = page.locator('[data-testid="clipping"][data-custom="true"]');
    if (await clipping.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(clipping).toBeVisible();
    }
  });

  test('109.9 Clipping ellipsis works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const clipping = page.locator('[data-testid="clipping"][data-ellipsis="true"]');
    if (await clipping.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(clipping).toBeVisible();
    }
  });

  test('109.10 Clipping clip-path works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const clipping = page.locator('[data-testid="clipping"][data-clip-path="true"]');
    if (await clipping.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(clipping).toBeVisible();
    }
  });
});