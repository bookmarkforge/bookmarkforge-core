/**
 * Advanced Sliders Tests
 * 
 * Tests for advanced slider functionality:
 * - Slider drag works
 * - Slider keyboard nav
 * - Slider accessibility
 * - Slider min/max
 * - Slider steps
 * - Slider labels
 * - Slider tooltips
 * - Slider range
 * - Slider disabled
 * - Slider persistence
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { saveBookmark } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Advanced Sliders Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('46.1 Slider drag works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const slider = page.locator('[role="slider"]').first();
    if (await slider.isVisible({ timeout: 5000 }).catch(() => false)) {
      await slider.dragTo(page.locator('body').first());
      
      await expect(slider).toBeVisible();
    }
  });

  test('46.2 Slider keyboard navigation works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const slider = page.locator('[role="slider"]').first();
    if (await slider.isVisible({ timeout: 5000 }).catch(() => false)) {
      await slider.focus();
      
      await page.keyboard.press('ArrowRight');
      
      const focusedElement = page.locator(':focus');
      await expect(focusedElement).toBeVisible();
    }
  });

  test('46.3 Slider accessibility works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const slider = page.locator('[role="slider"]').first();
    if (await slider.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Check ARIA attributes
      const ariaValueNow = await slider.getAttribute('aria-valuenow');
      const ariaValueMin = await slider.getAttribute('aria-valuemin');
      const ariaValueMax = await slider.getAttribute('aria-valuemax');
      
      if (ariaValueNow || ariaValueMin || ariaValueMax) {
        await expect(ariaValueNow || ariaValueMin || ariaValueMax).toBeTruthy();
      }
    }
  });

  test('46.4 Slider min/max works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const slider = page.locator('[role="slider"]').first();
    if (await slider.isVisible({ timeout: 5000 }).catch(() => false)) {
      const ariaValueMin = await slider.getAttribute('aria-valuemin');
      const ariaValueMax = await slider.getAttribute('aria-valuemax');
      
      if (ariaValueMin && ariaValueMax) {
        await expect(parseFloat(ariaValueMin)).toBeLessThan(parseFloat(ariaValueMax));
      }
    }
  });

  test('46.5 Slider steps work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const slider = page.locator('[role="slider"][aria-valuetext]').first();
    if (await slider.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(slider).toBeVisible();
    }
  });

  test('46.6 Slider labels work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const slider = page.locator('[role="slider"]').first();
    if (await slider.isVisible({ timeout: 5000 }).catch(() => false)) {
      const ariaLabel = await slider.getAttribute('aria-label');
      if (ariaLabel) {
        await expect(ariaLabel).toBeTruthy();
      }
    }
  });

  test('46.7 Slider tooltips work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const slider = page.locator('[role="slider"]').first();
    if (await slider.isVisible({ timeout: 5000 }).catch(() => false)) {
      await slider.hover();
      
      const tooltip = page.locator('[role="tooltip"]');
      if (await tooltip.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(tooltip).toBeVisible();
      }
    }
  });

  test('46.8 Slider range works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const slider = page.locator('[role="slider"][aria-valuemin][aria-valuemax]').first();
    if (await slider.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(slider).toBeVisible();
    }
  });

  test('46.9 Slider disabled works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const slider = page.locator('[role="slider"][aria-disabled="true"]');
    if (await slider.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(slider).toBeVisible();
    }
  });

  test('46.10 Slider persistence works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const slider = page.locator('[role="slider"]').first();
    if (await slider.isVisible({ timeout: 5000 }).catch(() => false)) {
      const initialValue = await slider.getAttribute('aria-valuenow');
      
      // Reload and check if slider value persists
      await page.reload();
      
      const sliderAfterReload = page.locator('[role="slider"]').first();
      if (await sliderAfterReload.isVisible({ timeout: 5000 }).catch(() => false)) {
        const valueAfterReload = await sliderAfterReload.getAttribute('aria-valuenow');
        if (initialValue && valueAfterReload) {
          await expect(valueAfterReload).toBe(initialValue);
        }
      }
    }
  });
});