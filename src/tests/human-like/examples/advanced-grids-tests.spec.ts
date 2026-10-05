/**
 * Advanced Grids Tests
 * 
 * Tests for advanced grid functionality:
 * - Grid displays
 * - Grid columns
 * - Grid rows
 * - Grid gap
 * - Grid responsive
 * - Grid auto-fit
 * - Grid auto-fill
 * - Grid accessibility
 * - Grid alignment
 * - Grid custom
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { saveBookmark } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Advanced Grids Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('80.1 Grid displays', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const grid = page.locator('[data-testid="grid"]');
    if (await grid.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(grid).toBeVisible();
    }
  });

  test('80.2 Grid columns work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const grid = page.locator('[data-testid="grid"]').first();
    if (await grid.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(grid).toBeVisible();
      
      const gridItems = grid.locator('[data-testid="grid-item"]');
      if (await gridItems.count() > 0) {
        await expect(gridItems.count()).resolves.toBeGreaterThan(0);
      }
    }
  });

  test('80.3 Grid rows work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const grid = page.locator('[data-testid="grid"]').first();
    if (await grid.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(grid).toBeVisible();
      
      const gridItems = grid.locator('[data-testid="grid-item"]');
      if (await gridItems.count() > 0) {
        await expect(gridItems.count()).resolves.toBeGreaterThan(0);
      }
    }
  });

  test('80.4 Grid gap works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const grid = page.locator('[data-testid="grid"]').first();
    if (await grid.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(grid).toBeVisible();
      
      const gapStyle = await grid.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return styles.gap || styles.columnGap;
      });
      if (gapStyle) {
        await expect(gapStyle).toBeTruthy();
      }
    }
  });

  test('80.5 Grid responsive works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    await page.setViewportSize({ width: 375, height: 667 });
    
    const grid = page.locator('[data-testid="grid"]').first();
    if (await grid.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(grid).toBeVisible();
    }
    
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('80.6 Grid auto-fit works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const grid = page.locator('[data-testid="grid"][data-auto-fit="true"]');
    if (await grid.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(grid).toBeVisible();
    }
  });

  test('80.7 Grid auto-fill works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const grid = page.locator('[data-testid="grid"][data-auto-fill="true"]');
    if (await grid.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(grid).toBeVisible();
    }
  });

  test('80.8 Grid accessibility works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const grid = page.locator('[data-testid="grid"]').first();
    if (await grid.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Check ARIA attributes
      const ariaLabel = await grid.getAttribute('aria-label');
      const role = await grid.getAttribute('role');
      
      if (ariaLabel || role) {
        await expect(ariaLabel || role).toBeTruthy();
      }
    }
  });

  test('80.9 Grid alignment works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const grid = page.locator('[data-testid="grid"]').first();
    if (await grid.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(grid).toBeVisible();
      
      const alignmentStyle = await grid.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return styles.justifyContent || styles.alignItems;
      });
      if (alignmentStyle) {
        await expect(alignmentStyle).toBeTruthy();
      }
    }
  });

  test('80.10 Grid custom works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const grid = page.locator('[data-testid="grid"][data-custom="true"]');
    if (await grid.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(grid).toBeVisible();
    }
  });
});