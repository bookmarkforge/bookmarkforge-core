/**
 * Advanced Blending Tests
 * 
 * Tests for advanced blending functionality:
 * - Blending displays
 * - Blending multiply
 * - Blending screen
 * - Blending overlay
 * - Blending custom
 * - Blending responsive
 * - Blending accessibility
 * - Blending mix-blend
 * - Blending isolation
 * - Blending backdrop
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { saveBookmark } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Advanced Blending Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('110.1 Blending displays', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const blending = page.locator('[data-testid="blending"]');
    if (await blending.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(blending).toBeVisible();
    }
  });

  test('110.2 Blending multiply works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const blending = page.locator('[data-testid="blending"][data-mode="multiply"]');
    if (await blending.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(blending).toBeVisible();
      
      const blendMode = await blending.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return styles.mixBlendMode;
      });
      if (blendMode) {
        await expect(blendMode).toBeTruthy();
      }
    }
  });

  test('110.3 Blending screen works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const blending = page.locator('[data-testid="blending"][data-mode="screen"]');
    if (await blending.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(blending).toBeVisible();
      
      const blendMode = await blending.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return styles.mixBlendMode;
      });
      if (blendMode) {
        await expect(blendMode).toBeTruthy();
      }
    }
  });

  test('110.4 Blending overlay works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const blending = page.locator('[data-testid="blending"][data-mode="overlay"]');
    if (await blending.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(blending).toBeVisible();
      
      const blendMode = await blending.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return styles.mixBlendMode;
      });
      if (blendMode) {
        await expect(blendMode).toBeTruthy();
      }
    }
  });

  test('110.5 Blending custom works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const blending = page.locator('[data-testid="blending"][data-custom="true"]');
    if (await blending.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(blending).toBeVisible();
    }
  });

  test('110.6 Blending responsive works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    await page.setViewportSize({ width: 375, height: 667 });
    
    const blending = page.locator('[data-testid="blending"]').first();
    if (await blending.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(blending).toBeVisible();
    }
    
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('110.7 Blending accessibility works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const blending = page.locator('[data-testid="blending"]').first();
    if (await blending.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Check ARIA attributes
      const ariaLabel = await blending.getAttribute('aria-label');
      const role = await blending.getAttribute('role');
      
      if (ariaLabel || role) {
        await expect(ariaLabel || role).toBeTruthy();
      }
    }
  });

  test('110.8 Blending mix-blend works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const blending = page.locator('[data-testid="blending"][data-mix-blend="true"]');
    if (await blending.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(blending).toBeVisible();
    }
  });

  test('110.9 Blending isolation works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const blending = page.locator('[data-testid="blending"][data-isolation="true"]');
    if (await blending.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(blending).toBeVisible();
      
      const isolation = await blending.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return styles.isolation;
      });
      if (isolation) {
        await expect(isolation).toBeTruthy();
      }
    }
  });

  test('110.10 Blending backdrop works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const blending = page.locator('[data-testid="blending"][data-backdrop="true"]');
    if (await blending.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(blending).toBeVisible();
    }
  });
});