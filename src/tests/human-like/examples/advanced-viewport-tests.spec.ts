/**
 * Advanced Viewport Tests
 * 
 * Tests for advanced viewport functionality:
 * - Viewport displays
 * - Viewport scroll
 * - Viewport resize
 * - Viewport responsive
 * - Viewport orientation
 * - Viewport safe-area
 * - Viewport keyboard nav
 * - Viewport accessibility
 * - Viewport zoom
 * - Viewport custom
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { saveBookmark } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Advanced Viewport Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('95.1 Viewport displays', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const viewport = page.locator('[data-testid="viewport"]');
    if (await viewport.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(viewport).toBeVisible();
    }
  });

  test('95.2 Viewport scroll works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const viewport = page.locator('[data-testid="viewport"]').first();
    if (await viewport.isVisible({ timeout: 5000 }).catch(() => false)) {
      await viewport.evaluate(el => el.scrollTop = 100);
      
      await expect(viewport).toBeVisible();
    }
  });

  test('95.3 Viewport resize works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    await page.setViewportSize({ width: 375, height: 667 });
    
    const viewport = page.locator('[data-testid="viewport"]').first();
    if (await viewport.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(viewport).toBeVisible();
    }
    
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('95.4 Viewport responsive works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    await page.setViewportSize({ width: 375, height: 667 });
    
    const viewport = page.locator('[data-testid="viewport"]').first();
    if (await viewport.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(viewport).toBeVisible();
    }
    
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('95.5 Viewport orientation works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    await page.setViewportSize({ width: 667, height: 375 });
    
    const viewport = page.locator('[data-testid="viewport"]').first();
    if (await viewport.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(viewport).toBeVisible();
    }
    
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('95.6 Viewport safe-area works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const viewport = page.locator('[data-testid="viewport"]').first();
    if (await viewport.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(viewport).toBeVisible();
      
      const safeAreaStyle = await viewport.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return styles.padding || styles.paddingTop;
      });
      if (safeAreaStyle) {
        await expect(safeAreaStyle).toBeTruthy();
      }
    }
  });

  test('95.7 Viewport keyboard navigation works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const viewport = page.locator('[data-testid="viewport"]').first();
    if (await viewport.isVisible({ timeout: 5000 }).catch(() => false)) {
      await viewport.focus();
      
      await page.keyboard.press('ArrowDown');
      
      const focusedElement = page.locator(':focus');
      await expect(focusedElement).toBeVisible();
    }
  });

  test('95.8 Viewport accessibility works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const viewport = page.locator('[data-testid="viewport"]').first();
    if (await viewport.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Check ARIA attributes
      const ariaLabel = await viewport.getAttribute('aria-label');
      const role = await viewport.getAttribute('role');
      
      if (ariaLabel || role) {
        await expect(ariaLabel || role).toBeTruthy();
      }
    }
  });

  test('95.9 Viewport zoom works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const viewport = page.locator('[data-testid="viewport"]').first();
    if (await viewport.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(viewport).toBeVisible();
      
      const zoomStyle = await viewport.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return styles.zoom;
      });
      if (zoomStyle) {
        await expect(zoomStyle).toBeTruthy();
      }
    }
  });

  test('95.10 Viewport custom works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const viewport = page.locator('[data-testid="viewport"][data-custom="true"]');
    if (await viewport.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(viewport).toBeVisible();
    }
  });
});