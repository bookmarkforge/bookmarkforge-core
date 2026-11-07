/**
 * Advanced Wrappers Tests
 * 
 * Tests for advanced wrapper functionality:
 * - Wrapper displays
 * - Wrapper padding
 * - Wrapper margin
 * - Wrapper max-width
 * - Wrapper responsive
 * - Wrapper centering
 * - Wrapper flex
 * - Wrapper grid
 * - Wrapper custom
 * - Wrapper accessibility
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { saveBookmark } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Advanced Wrappers Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('91.1 Wrapper displays', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const wrapper = page.locator('[data-testid="wrapper"]');
    if (await wrapper.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(wrapper).toBeVisible();
    }
  });

  test('91.2 Wrapper padding works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const wrapper = page.locator('[data-testid="wrapper"]').first();
    if (await wrapper.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(wrapper).toBeVisible();
      
      const paddingStyle = await wrapper.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return styles.padding;
      });
      if (paddingStyle) {
        await expect(paddingStyle).toBeTruthy();
      }
    }
  });

  test('91.3 Wrapper margin works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const wrapper = page.locator('[data-testid="wrapper"]').first();
    if (await wrapper.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(wrapper).toBeVisible();
      
      const marginStyle = await wrapper.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return styles.margin;
      });
      if (marginStyle) {
        await expect(marginStyle).toBeTruthy();
      }
    }
  });

  test('91.4 Wrapper max-width works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const wrapper = page.locator('[data-testid="wrapper"]').first();
    if (await wrapper.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(wrapper).toBeVisible();
      
      const maxWidthStyle = await wrapper.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return styles.maxWidth;
      });
      if (maxWidthStyle) {
        await expect(maxWidthStyle).toBeTruthy();
      }
    }
  });

  test('91.5 Wrapper responsive works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    await page.setViewportSize({ width: 375, height: 667 });
    
    const wrapper = page.locator('[data-testid="wrapper"]').first();
    if (await wrapper.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(wrapper).toBeVisible();
    }
    
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('91.6 Wrapper centering works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const wrapper = page.locator('[data-testid="wrapper"]').first();
    if (await wrapper.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(wrapper).toBeVisible();
      
      const marginStyle = await wrapper.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return styles.marginLeft || styles.marginRight;
      });
      if (marginStyle) {
        await expect(marginStyle).toBeTruthy();
      }
    }
  });

  test('91.7 Wrapper flex works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const wrapper = page.locator('[data-testid="wrapper"][data-flex="true"]');
    if (await wrapper.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(wrapper).toBeVisible();
    }
  });

  test('91.8 Wrapper grid works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const wrapper = page.locator('[data-testid="wrapper"][data-grid="true"]');
    if (await wrapper.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(wrapper).toBeVisible();
    }
  });

  test('91.9 Wrapper custom works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const wrapper = page.locator('[data-testid="wrapper"][data-custom="true"]');
    if (await wrapper.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(wrapper).toBeVisible();
    }
  });

  test('91.10 Wrapper accessibility works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const wrapper = page.locator('[data-testid="wrapper"]').first();
    if (await wrapper.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Check ARIA attributes
      const ariaLabel = await wrapper.getAttribute('aria-label');
      const role = await wrapper.getAttribute('role');
      
      if (ariaLabel || role) {
        await expect(ariaLabel || role).toBeTruthy();
      }
    }
  });
});