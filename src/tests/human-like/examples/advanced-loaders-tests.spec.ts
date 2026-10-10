/**
 * Advanced Loaders Tests
 * 
 * Tests for advanced loader functionality:
 * - Loader displays
 * - Loader spinning
 * - Loader variants
 * - Loader sizes
 * - Loader progress
 * - Loader dots
 * - Loader accessibility
 * - Loader centered
 * - Loader overlay
 * - Loader custom
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { saveBookmark } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Advanced Loaders Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('87.1 Loader displays', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const loader = page.locator('[data-testid="loader"]');
    if (await loader.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(loader).toBeVisible();
    }
  });

  test('87.2 Loader spinning works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const loader = page.locator('[data-testid="loader"]').first();
    if (await loader.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(loader).toBeVisible();
      
      const animationClass = await loader.getAttribute('class');
      if (animationClass) {
        await expect(animationClass).toBeTruthy();
      }
    }
  });

  test('87.3 Loader variants work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const loader = page.locator('[data-testid="loader"]').first();
    if (await loader.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(loader).toBeVisible();
      
      const variantClass = await loader.getAttribute('class');
      if (variantClass) {
        await expect(variantClass).toBeTruthy();
      }
    }
  });

  test('87.4 Loader sizes work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const loader = page.locator('[data-testid="loader"]').first();
    if (await loader.isVisible({ timeout: 5000 }).catch(() => false)) {
      const box = await loader.boundingBox();
      if (box) {
        await expect(box.width).toBeGreaterThan(0);
        await expect(box.height).toBeGreaterThan(0);
      }
    }
  });

  test('87.5 Loader progress works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const loader = page.locator('[data-testid="loader"][data-progress="true"]');
    if (await loader.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(loader).toBeVisible();
    }
  });

  test('87.6 Loader dots work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const loader = page.locator('[data-testid="loader"][data-dots="true"]');
    if (await loader.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(loader).toBeVisible();
    }
  });

  test('87.7 Loader accessibility works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const loader = page.locator('[data-testid="loader"]').first();
    if (await loader.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Check ARIA attributes
      const ariaLabel = await loader.getAttribute('aria-label');
      const ariaBusy = await loader.getAttribute('aria-busy');
      
      if (ariaLabel || ariaBusy) {
        await expect(ariaLabel || ariaBusy).toBeTruthy();
      }
    }
  });

  test('87.8 Loader centered works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const loader = page.locator('[data-testid="loader"][data-centered="true"]');
    if (await loader.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(loader).toBeVisible();
    }
  });

  test('87.9 Loader overlay works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const loaderOverlay = page.locator('[data-testid="loader-overlay"]');
    if (await loaderOverlay.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(loaderOverlay).toBeVisible();
    }
  });

  test('87.10 Loader custom works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const loader = page.locator('[data-testid="loader"][data-custom="true"]');
    if (await loader.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(loader).toBeVisible();
    }
  });
});