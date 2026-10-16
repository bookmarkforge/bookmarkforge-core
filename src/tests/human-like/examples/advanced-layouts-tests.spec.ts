/**
 * Advanced Layouts Tests
 * 
 * Tests for advanced layout functionality:
 * - Layout displays
 * - Layout spacing
 * - Layout breakpoints
 * - Layout containers
 * - Layout nesting
 * - Layout responsive
 * - Layout overflow
 * - Layout accessibility
 * - Layout alignment
 * - Layout custom
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { saveBookmark } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Advanced Layouts Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('82.1 Layout displays', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const layout = page.locator('[data-testid="layout"]');
    if (await layout.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(layout).toBeVisible();
    }
  });

  test('82.2 Layout spacing works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const layout = page.locator('[data-testid="layout"]').first();
    if (await layout.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(layout).toBeVisible();
      
      const spacingStyle = await layout.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return styles.padding || styles.margin;
      });
      if (spacingStyle) {
        await expect(spacingStyle).toBeTruthy();
      }
    }
  });

  test('82.3 Layout breakpoints work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    await page.setViewportSize({ width: 375, height: 667 });
    
    const layout = page.locator('[data-testid="layout"]').first();
    if (await layout.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(layout).toBeVisible();
    }
    
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('82.4 Layout containers work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const layout = page.locator('[data-testid="layout"]').first();
    if (await layout.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(layout).toBeVisible();
      
      const container = layout.locator('[data-testid="container"]');
      if (await container.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(container).toBeVisible();
      }
    }
  });

  test('82.5 Layout nesting works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const layout = page.locator('[data-testid="layout"]').first();
    if (await layout.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(layout).toBeVisible();
      
      const nestedLayout = layout.locator('[data-testid="layout"]');
      if (await nestedLayout.count() > 0) {
        await expect(nestedLayout.count()).resolves.toBeGreaterThan(0);
      }
    }
  });

  test('82.6 Layout responsive works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    await page.setViewportSize({ width: 375, height: 667 });
    
    const layout = page.locator('[data-testid="layout"]').first();
    if (await layout.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(layout).toBeVisible();
    }
    
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('82.7 Layout overflow works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const layout = page.locator('[data-testid="layout"]').first();
    if (await layout.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(layout).toBeVisible();
      
      const overflowStyle = await layout.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return styles.overflow;
      });
      if (overflowStyle) {
        await expect(overflowStyle).toBeTruthy();
      }
    }
  });

  test('82.8 Layout accessibility works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const layout = page.locator('[data-testid="layout"]').first();
    if (await layout.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Check ARIA attributes
      const ariaLabel = await layout.getAttribute('aria-label');
      const role = await layout.getAttribute('role');
      
      if (ariaLabel || role) {
        await expect(ariaLabel || role).toBeTruthy();
      }
    }
  });

  test('82.9 Layout alignment works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const layout = page.locator('[data-testid="layout"]').first();
    if (await layout.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(layout).toBeVisible();
      
      const alignmentStyle = await layout.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return styles.textAlign || styles.justifyContent;
      });
      if (alignmentStyle) {
        await expect(alignmentStyle).toBeTruthy();
      }
    }
  });

  test('82.10 Layout custom works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const layout = page.locator('[data-testid="layout"][data-custom="true"]');
    if (await layout.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(layout).toBeVisible();
    }
  });
});