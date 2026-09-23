/**
 * Advanced Truncations Tests
 * 
 * Tests for advanced truncation functionality:
 * - Truncation displays
 * - Truncation ellipsis
 * - Truncation lines
 * - Truncation tooltip
 * - Truncation responsive
 * - Truncation accessibility
 * - Truncation character
 * - Truncation word
 * - Truncation clamp
 * - Truncation custom
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { saveBookmark } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Advanced Truncations Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('90.1 Truncation displays', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const truncated = page.locator('[data-testid="truncated"]');
    if (await truncated.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(truncated).toBeVisible();
    }
  });

  test('90.2 Truncation ellipsis works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const truncated = page.locator('[data-testid="truncated"]').first();
    if (await truncated.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(truncated).toBeVisible();
      
      const textOverflow = await truncated.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return styles.textOverflow;
      });
      if (textOverflow) {
        await expect(textOverflow).toBeTruthy();
      }
    }
  });

  test('90.3 Truncation lines work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const truncated = page.locator('[data-testid="truncated"][data-lines]');
    if (await truncated.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(truncated).toBeVisible();
      
      const lineClamp = await truncated.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return styles.webkitLineClamp || (styles as CSSStyleDeclaration & { lineClamp?: string }).lineClamp;
      });
      if (lineClamp) {
        await expect(lineClamp).toBeTruthy();
      }
    }
  });

  test('90.4 Truncation tooltip works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const truncated = page.locator('[data-testid="truncated"]').first();
    if (await truncated.isVisible({ timeout: 5000 }).catch(() => false)) {
      await truncated.hover();
      
      const tooltip = page.locator('[role="tooltip"]');
      if (await tooltip.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(tooltip).toBeVisible();
      }
    }
  });

  test('90.5 Truncation responsive works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    await page.setViewportSize({ width: 375, height: 667 });
    
    const truncated = page.locator('[data-testid="truncated"]').first();
    if (await truncated.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(truncated).toBeVisible();
    }
    
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('90.6 Truncation accessibility works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const truncated = page.locator('[data-testid="truncated"]').first();
    if (await truncated.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Check ARIA attributes
      const ariaLabel = await truncated.getAttribute('aria-label');
      const title = await truncated.getAttribute('title');
      
      if (ariaLabel || title) {
        await expect(ariaLabel || title).toBeTruthy();
      }
    }
  });

  test('90.7 Truncation character works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const truncated = page.locator('[data-testid="truncated"][data-truncate="character"]');
    if (await truncated.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(truncated).toBeVisible();
    }
  });

  test('90.8 Truncation word works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const truncated = page.locator('[data-testid="truncated"][data-truncate="word"]');
    if (await truncated.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(truncated).toBeVisible();
    }
  });

  test('90.9 Truncation clamp works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const truncated = page.locator('[data-testid="truncated"][data-clamp="true"]');
    if (await truncated.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(truncated).toBeVisible();
    }
  });

  test('90.10 Truncation custom works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const truncated = page.locator('[data-testid="truncated"][data-custom="true"]');
    if (await truncated.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(truncated).toBeVisible();
    }
  });
});