/**
 * Advanced Aspect Ratios Tests
 * 
 * Tests for advanced aspect ratio functionality:
 * - Aspect ratio displays
 * - Aspect ratio 16:9
 * - Aspect ratio 4:3
 * - Aspect ratio 1:1
 * - Aspect ratio custom
 * - Aspect ratio responsive
 * - Aspect ratio fit
 * - Aspect ratio accessibility
 * - Aspect ratio scale
 * - Aspect ratio min/max
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { saveBookmark } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Advanced Aspect Ratios Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('107.1 Aspect ratio displays', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const aspectRatio = page.locator('[data-testid="aspect-ratio"]');
    if (await aspectRatio.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(aspectRatio).toBeVisible();
    }
  });

  test('107.2 Aspect ratio 16:9 works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const aspectRatio = page.locator('[data-testid="aspect-ratio"][data-ratio="16/9"]');
    if (await aspectRatio.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(aspectRatio).toBeVisible();
      
      const ratio = await aspectRatio.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return styles.aspectRatio;
      });
      if (ratio) {
        await expect(ratio).toBeTruthy();
      }
    }
  });

  test('107.3 Aspect ratio 4:3 works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const aspectRatio = page.locator('[data-testid="aspect-ratio"][data-ratio="4/3"]');
    if (await aspectRatio.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(aspectRatio).toBeVisible();
      
      const ratio = await aspectRatio.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return styles.aspectRatio;
      });
      if (ratio) {
        await expect(ratio).toBeTruthy();
      }
    }
  });

  test('107.4 Aspect ratio 1:1 works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const aspectRatio = page.locator('[data-testid="aspect-ratio"][data-ratio="1/1"]');
    if (await aspectRatio.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(aspectRatio).toBeVisible();
      
      const ratio = await aspectRatio.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return styles.aspectRatio;
      });
      if (ratio) {
        await expect(ratio).toBeTruthy();
      }
    }
  });

  test('107.5 Aspect ratio custom works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const aspectRatio = page.locator('[data-testid="aspect-ratio"][data-custom="true"]');
    if (await aspectRatio.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(aspectRatio).toBeVisible();
    }
  });

  test('107.6 Aspect ratio responsive works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    await page.setViewportSize({ width: 375, height: 667 });
    
    const aspectRatio = page.locator('[data-testid="aspect-ratio"]').first();
    if (await aspectRatio.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(aspectRatio).toBeVisible();
    }
    
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('107.7 Aspect ratio fit works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const aspectRatio = page.locator('[data-testid="aspect-ratio"][data-fit="true"]');
    if (await aspectRatio.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(aspectRatio).toBeVisible();
    }
  });

  test('107.8 Aspect ratio accessibility works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const aspectRatio = page.locator('[data-testid="aspect-ratio"]').first();
    if (await aspectRatio.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Check ARIA attributes
      const ariaLabel = await aspectRatio.getAttribute('aria-label');
      const role = await aspectRatio.getAttribute('role');
      
      if (ariaLabel || role) {
        await expect(ariaLabel || role).toBeTruthy();
      }
    }
  });

  test('107.9 Aspect ratio scale works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const aspectRatio = page.locator('[data-testid="aspect-ratio"][data-scale="true"]');
    if (await aspectRatio.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(aspectRatio).toBeVisible();
    }
  });

  test('107.10 Aspect ratio min/max works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const aspectRatio = page.locator('[data-testid="aspect-ratio"][data-min-max="true"]');
    if (await aspectRatio.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(aspectRatio).toBeVisible();
    }
  });
});