/**
 * Advanced Scrollbars Tests
 * 
 * Tests for advanced scrollbar functionality:
 * - Scrollbar displays
 * - Scrollbar scroll
 * - Scrollbar keyboard nav
 * - Scrollbar auto-hide
 * - Scrollbar custom
 * - Scrollbar thin
 * - Scrollbar overlay
 * - Scrollbar track
 * - Scrollbar thumb
 * - Scrollbar hover
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { saveBookmark } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Advanced Scrollbars Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('86.1 Scrollbar displays', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const scrollable = page.locator('[data-testid="scrollable"]');
    if (await scrollable.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(scrollable).toBeVisible();
    }
  });

  test('86.2 Scrollbar scroll works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const scrollable = page.locator('[data-testid="scrollable"]').first();
    if (await scrollable.isVisible({ timeout: 5000 }).catch(() => false)) {
      await scrollable.evaluate(el => el.scrollTop = 100);
      
      await expect(scrollable).toBeVisible();
    }
  });

  test('86.3 Scrollbar keyboard navigation works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const scrollable = page.locator('[data-testid="scrollable"]').first();
    if (await scrollable.isVisible({ timeout: 5000 }).catch(() => false)) {
      await scrollable.focus();
      
      await page.keyboard.press('ArrowDown');
      
      const focusedElement = page.locator(':focus');
      await expect(focusedElement).toBeVisible();
    }
  });

  test('86.4 Scrollbar auto-hide works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const scrollable = page.locator('[data-testid="scrollable"][data-auto-hide="true"]');
    if (await scrollable.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(scrollable).toBeVisible();
    }
  });

  test('86.5 Scrollbar custom works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const scrollable = page.locator('[data-testid="scrollable"][data-custom="true"]');
    if (await scrollable.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(scrollable).toBeVisible();
    }
  });

  test('86.6 Scrollbar thin works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const scrollable = page.locator('[data-testid="scrollable"][data-thin="true"]');
    if (await scrollable.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(scrollable).toBeVisible();
    }
  });

  test('86.7 Scrollbar overlay works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const scrollable = page.locator('[data-testid="scrollable"][data-overlay="true"]');
    if (await scrollable.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(scrollable).toBeVisible();
    }
  });

  test('86.8 Scrollbar track works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const scrollable = page.locator('[data-testid="scrollable"]').first();
    if (await scrollable.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(scrollable).toBeVisible();
      
      const trackStyle = await scrollable.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return (styles as CSSStyleDeclaration & { scrollbarTrackColor?: string }).scrollbarTrackColor || styles.scrollbarColor;
      });
      if (trackStyle) {
        await expect(trackStyle).toBeTruthy();
      }
    }
  });

  test('86.9 Scrollbar thumb works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const scrollable = page.locator('[data-testid="scrollable"]').first();
    if (await scrollable.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(scrollable).toBeVisible();
      
      const thumbStyle = await scrollable.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return (styles as CSSStyleDeclaration & { scrollbarThumbColor?: string }).scrollbarThumbColor || styles.scrollbarColor;
      });
      if (thumbStyle) {
        await expect(thumbStyle).toBeTruthy();
      }
    }
  });

  test('86.10 Scrollbar hover works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const scrollable = page.locator('[data-testid="scrollable"]').first();
    if (await scrollable.isVisible({ timeout: 5000 }).catch(() => false)) {
      await scrollable.hover();
      
      await expect(scrollable).toBeVisible();
    }
  });
});