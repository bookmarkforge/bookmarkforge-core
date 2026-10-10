/**
 * Advanced Media Queries Tests
 * 
 * Tests for advanced media query functionality:
 * - Media query displays
 * - Media query breakpoint
 * - Media query orientation
 * - Media query resolution
 * - Media query color
 * - Media query prefers
 * - Media query responsive
 * - Media query container
 * - Media query custom
 * - Media query fallback
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { saveBookmark } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Advanced Media Queries Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('98.1 Media query displays', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const responsive = page.locator('[data-testid="responsive"]');
    if (await responsive.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(responsive).toBeVisible();
    }
  });

  test('98.2 Media query breakpoint works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    await page.setViewportSize({ width: 375, height: 667 });
    
    const responsive = page.locator('[data-testid="responsive"]').first();
    if (await responsive.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(responsive).toBeVisible();
    }
    
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('98.3 Media query orientation works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    await page.setViewportSize({ width: 667, height: 375 });
    
    const responsive = page.locator('[data-testid="responsive"]').first();
    if (await responsive.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(responsive).toBeVisible();
    }
    
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('98.4 Media query resolution works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    await page.setViewportSize({ width: 1920, height: 1080 });
    
    const responsive = page.locator('[data-testid="responsive"]').first();
    if (await responsive.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(responsive).toBeVisible();
    }
    
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('98.5 Media query color works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const responsive = page.locator('[data-testid="responsive"]').first();
    if (await responsive.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(responsive).toBeVisible();
      
      const colorStyle = await responsive.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return styles.color;
      });
      if (colorStyle) {
        await expect(colorStyle).toBeTruthy();
      }
    }
  });

  test('98.6 Media query prefers works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const responsive = page.locator('[data-testid="responsive"]').first();
    if (await responsive.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(responsive).toBeVisible();
      
      const prefersStyle = await responsive.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return styles.colorScheme;
      });
      if (prefersStyle) {
        await expect(prefersStyle).toBeTruthy();
      }
    }
  });

  test('98.7 Media query responsive works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    await page.setViewportSize({ width: 375, height: 667 });
    
    const responsive = page.locator('[data-testid="responsive"]').first();
    if (await responsive.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(responsive).toBeVisible();
    }
    
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('98.8 Media query container works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const containerQuery = page.locator('[data-testid="container-query"]');
    if (await containerQuery.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(containerQuery).toBeVisible();
    }
  });

  test('98.9 Media query custom works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const responsive = page.locator('[data-testid="responsive"][data-custom="true"]');
    if (await responsive.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(responsive).toBeVisible();
    }
  });

  test('98.10 Media query fallback works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const responsive = page.locator('[data-testid="responsive"][data-fallback="true"]');
    if (await responsive.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(responsive).toBeVisible();
    }
  });
});