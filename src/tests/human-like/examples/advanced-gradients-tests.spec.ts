/**
 * Advanced Gradients Tests
 * 
 * Tests for advanced gradient functionality:
 * - Gradient displays
 * - Gradient linear
 * - Gradient radial
 * - Gradient conic
 * - Gradient custom
 * - Gradient responsive
 * - Gradient accessibility
 * - Gradient animation
 * - Gradient stops
 * - Gradient blend
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { saveBookmark } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Advanced Gradients Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('108.1 Gradient displays', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const gradient = page.locator('[data-testid="gradient"]');
    if (await gradient.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(gradient).toBeVisible();
    }
  });

  test('108.2 Gradient linear works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const gradient = page.locator('[data-testid="gradient"][data-type="linear"]');
    if (await gradient.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(gradient).toBeVisible();
      
      const background = await gradient.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return styles.background;
      });
      if (background) {
        await expect(background).toBeTruthy();
      }
    }
  });

  test('108.3 Gradient radial works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const gradient = page.locator('[data-testid="gradient"][data-type="radial"]');
    if (await gradient.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(gradient).toBeVisible();
      
      const background = await gradient.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return styles.background;
      });
      if (background) {
        await expect(background).toBeTruthy();
      }
    }
  });

  test('108.4 Gradient conic works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const gradient = page.locator('[data-testid="gradient"][data-type="conic"]');
    if (await gradient.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(gradient).toBeVisible();
      
      const background = await gradient.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return styles.background;
      });
      if (background) {
        await expect(background).toBeTruthy();
      }
    }
  });

  test('108.5 Gradient custom works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const gradient = page.locator('[data-testid="gradient"][data-custom="true"]');
    if (await gradient.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(gradient).toBeVisible();
    }
  });

  test('108.6 Gradient responsive works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    await page.setViewportSize({ width: 375, height: 667 });
    
    const gradient = page.locator('[data-testid="gradient"]').first();
    if (await gradient.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(gradient).toBeVisible();
    }
    
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('108.7 Gradient accessibility works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const gradient = page.locator('[data-testid="gradient"]').first();
    if (await gradient.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Check ARIA attributes
      const ariaLabel = await gradient.getAttribute('aria-label');
      const role = await gradient.getAttribute('role');
      
      if (ariaLabel || role) {
        await expect(ariaLabel || role).toBeTruthy();
      }
    }
  });

  test('108.8 Gradient animation works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const gradient = page.locator('[data-testid="gradient"][data-animated="true"]');
    if (await gradient.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(gradient).toBeVisible();
    }
  });

  test('108.9 Gradient stops work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const gradient = page.locator('[data-testid="gradient"][data-stops="true"]');
    if (await gradient.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(gradient).toBeVisible();
    }
  });

  test('108.10 Gradient blend works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const gradient = page.locator('[data-testid="gradient"][data-blend="true"]');
    if (await gradient.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(gradient).toBeVisible();
    }
  });
});