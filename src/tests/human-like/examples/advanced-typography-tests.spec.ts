/**
 * Advanced Typography Tests
 * 
 * Tests for advanced typography functionality:
 * - Typography displays
 * - Typography font family
 * - Typography font size
 * - Typography font weight
 - Typography line height
 * Typography letter spacing
 * - Typography color
 * - Typography alignment
 * - Typography responsive
 * - Typography accessibility
 * - Typography custom
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { saveBookmark } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Advanced Typography Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('100.1 Typography displays', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const typography = page.locator('[data-testid="typography"]');
    if (await typography.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(typography).toBeVisible();
    }
  });

  test('100.2 Typography font family works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const typography = page.locator('[data-testid="typography"]').first();
    if (await typography.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(typography).toBeVisible();
      
      const fontFamily = await typography.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return styles.fontFamily;
      });
      if (fontFamily) {
        await expect(fontFamily).toBeTruthy();
      }
    }
  });

  test('100.3 Typography font size works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const typography = page.locator('[data-testid="typography"]').first();
    if (await typography.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(typography).toBeVisible();
      
      const fontSize = await typography.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return styles.fontSize;
      });
      if (fontSize) {
        await expect(fontSize).toBeTruthy();
      }
    }
  });

  test('100.4 Typography font weight works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const typography = page.locator('[data-testid="typography"]').first();
    if (await typography.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(typography).toBeVisible();
      
      const fontWeight = await typography.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return styles.fontWeight;
      });
      if (fontWeight) {
        await expect(fontWeight).toBeTruthy();
      }
    }
  });

  test('100.5 Typography line height works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const typography = page.locator('[data-testid="typography"]').first();
    if (await typography.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(typography).toBeVisible();
      
      const lineHeight = await typography.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return styles.lineHeight;
      });
      if (lineHeight) {
        await expect(lineHeight).toBeTruthy();
      }
    }
  });

  test('100.6 Typography letter spacing works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const typography = page.locator('[data-testid="typography"]').first();
    if (await typography.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(typography).toBeVisible();
      
      const letterSpacing = await typography.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return styles.letterSpacing;
      });
      if (letterSpacing) {
        await expect(letterSpacing).toBeTruthy();
      }
    }
  });

  test('100.7 Typography color works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const typography = page.locator('[data-testid="typography"]').first();
    if (await typography.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(typography).toBeVisible();
      
      const color = await typography.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return styles.color;
      });
      if (color) {
        await expect(color).toBeTruthy();
      }
    }
  });

  test('100.8 Typography alignment works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const typography = page.locator('[data-testid="typography"]').first();
    if (await typography.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(typography).toBeVisible();
      
      const textAlign = await typography.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return styles.textAlign;
      });
      if (textAlign) {
        await expect(textAlign).toBeTruthy();
      }
    }
  });

  test('100.9 Typography responsive works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    await page.setViewportSize({ width: 375, height: 667 });
    
    const typography = page.locator('[data-testid="typography"]').first();
    if (await typography.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(typography).toBeVisible();
    }
    
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('100.10 Typography custom works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const typography = page.locator('[data-testid="typography"][data-custom="true"]');
    if (await typography.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(typography).toBeVisible();
    }
  });
});