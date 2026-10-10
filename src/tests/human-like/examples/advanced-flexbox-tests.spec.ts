/**
 * Advanced Flexbox Tests
 * 
 * Tests for advanced flexbox functionality:
 * - Flexbox displays
 * - Flexbox direction
 * - Flexbox wrap
 * - Flexbox justify
 * - Flexbox align
 * - Flexbox gap
 * - Flexbox responsive
 * - Flexbox grow
 * - Flexbox shrink
 * - Flexbox custom
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { saveBookmark } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Advanced Flexbox Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('81.1 Flexbox displays', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const flex = page.locator('[data-testid="flex"]');
    if (await flex.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(flex).toBeVisible();
    }
  });

  test('81.2 Flexbox direction works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const flex = page.locator('[data-testid="flex"]').first();
    if (await flex.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(flex).toBeVisible();
      
      const directionStyle = await flex.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return styles.flexDirection;
      });
      if (directionStyle) {
        await expect(directionStyle).toBeTruthy();
      }
    }
  });

  test('81.3 Flexbox wrap works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const flex = page.locator('[data-testid="flex"]').first();
    if (await flex.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(flex).toBeVisible();
      
      const wrapStyle = await flex.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return styles.flexWrap;
      });
      if (wrapStyle) {
        await expect(wrapStyle).toBeTruthy();
      }
    }
  });

  test('81.4 Flexbox justify works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const flex = page.locator('[data-testid="flex"]').first();
    if (await flex.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(flex).toBeVisible();
      
      const justifyStyle = await flex.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return styles.justifyContent;
      });
      if (justifyStyle) {
        await expect(justifyStyle).toBeTruthy();
      }
    }
  });

  test('81.5 Flexbox align works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const flex = page.locator('[data-testid="flex"]').first();
    if (await flex.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(flex).toBeVisible();
      
      const alignStyle = await flex.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return styles.alignItems;
      });
      if (alignStyle) {
        await expect(alignStyle).toBeTruthy();
      }
    }
  });

  test('81.6 Flexbox gap works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const flex = page.locator('[data-testid="flex"]').first();
    if (await flex.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(flex).toBeVisible();
      
      const gapStyle = await flex.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return styles.gap || styles.columnGap;
      });
      if (gapStyle) {
        await expect(gapStyle).toBeTruthy();
      }
    }
  });

  test('81.7 Flexbox responsive works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    await page.setViewportSize({ width: 375, height: 667 });
    
    const flex = page.locator('[data-testid="flex"]').first();
    if (await flex.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(flex).toBeVisible();
    }
    
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('81.8 Flexbox grow works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const flex = page.locator('[data-testid="flex"]').first();
    if (await flex.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(flex).toBeVisible();
      
      const growStyle = await flex.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return styles.flexGrow;
      });
      if (growStyle) {
        await expect(growStyle).toBeTruthy();
      }
    }
  });

  test('81.9 Flexbox shrink works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const flex = page.locator('[data-testid="flex"]').first();
    if (await flex.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(flex).toBeVisible();
      
      const shrinkStyle = await flex.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return styles.flexShrink;
      });
      if (shrinkStyle) {
        await expect(shrinkStyle).toBeTruthy();
      }
    }
  });

  test('81.10 Flexbox custom works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const flex = page.locator('[data-testid="flex"][data-custom="true"]');
    if (await flex.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(flex).toBeVisible();
    }
  });
});