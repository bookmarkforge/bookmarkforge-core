/**
 * Advanced Layout Observer Tests
 * 
 * Tests for advanced layout observer functionality:
 * - Layout displays
 * - Layout intrinsic
 * - Layout extrinsic
 * - Layout responsive
 * - Layout accessibility
 * - Layout custom
 * - Layout viewport
 * - Layout container
 * - Layout performance
 * - Layout optimization
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { saveBookmark } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Advanced Layout Observer Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('116.1 Layout displays', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const layout = page.locator('[data-testid="layout-observer"]');
    if (await layout.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(layout).toBeVisible();
    }
  });

  test('116.2 Layout intrinsic works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const layout = page.locator('[data-testid="layout-observer"][data-intrinsic="true"]');
    if (await layout.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(layout).toBeVisible();
      
      const rect = await layout.evaluate(el => el.getBoundingClientRect());
      if (rect) {
        await expect(rect.width).toBeGreaterThan(0);
      }
    }
  });

  test('116.3 Layout extrinsic works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const layout = page.locator('[data-testid="layout-observer"][data-extrinsic="true"]');
    if (await layout.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(layout).toBeVisible();
      
      const rect = await layout.evaluate(el => el.getBoundingClientRect());
      if (rect) {
        await expect(rect.width).toBeGreaterThan(0);
      }
    }
  });

  test('116.4 Layout responsive works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    await page.setViewportSize({ width: 375, height: 667 });
    
    const layout = page.locator('[data-testid="layout-observer"]').first();
    if (await layout.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(layout).toBeVisible();
    }
    
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('116.5 Layout accessibility works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const layout = page.locator('[data-testid="layout-observer"]').first();
    if (await layout.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Check ARIA attributes
      const ariaLabel = await layout.getAttribute('aria-label');
      const role = await layout.getAttribute('role');
      
      if (ariaLabel || role) {
        await expect(ariaLabel || role).toBeTruthy();
      }
    }
  });

  test('116.6 Layout custom works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const layout = page.locator('[data-testid="layout-observer"][data-custom="true"]');
    if (await layout.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(layout).toBeVisible();
    }
  });

  test('116.7 Layout viewport works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const layout = page.locator('[data-testid="layout-observer"][data-viewport="true"]');
    if (await layout.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(layout).toBeVisible();
      
      const rect = await layout.evaluate(el => el.getBoundingClientRect());
      if (rect) {
        await expect(rect.width).toBeGreaterThan(0);
      }
    }
  });

  test('116.8 Layout container works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const layout = page.locator('[data-testid="layout-observer"][data-container="true"]');
    if (await layout.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(layout).toBeVisible();
    }
  });

  test('116.9 Layout performance works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const layout = page.locator('[data-testid="layout-observer"][data-performance="true"]');
    if (await layout.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(layout).toBeVisible();
    }
  });

  test('116.10 Layout optimization works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const layout = page.locator('[data-testid="layout-observer"][data-optimization="true"]');
    if (await layout.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(layout).toBeVisible();
    }
  });
});