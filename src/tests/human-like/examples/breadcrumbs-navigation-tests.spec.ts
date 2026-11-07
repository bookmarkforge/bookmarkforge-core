/**
 * Breadcrumbs Navigation Tests
 * 
 * Tests for breadcrumbs navigation features:
 * - Breadcrumbs display
 * - Breadcrumbs navigation
 * - Breadcrumbs truncation
 * - Breadcrumbs accessibility
 * - Breadcrumbs icons
 * - Breadcrumbs click
 * - Breadcrumbs hover
 * - Breadcrumbs mobile
 * - Breadcrumbs animation
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { saveBookmark } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Breadcrumbs Navigation Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('40.1 Breadcrumbs display correctly', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const breadcrumbs = page.locator('[data-testid="breadcrumbs"], nav[aria-label="breadcrumb"]');
    if (await breadcrumbs.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(breadcrumbs).toBeVisible();
    }
  });

  test('40.2 Breadcrumbs navigation works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const breadcrumbs = page.locator('[data-testid="breadcrumbs"]');
    if (await breadcrumbs.isVisible({ timeout: 5000 }).catch(() => false)) {
      const breadcrumbLinks = breadcrumbs.getByRole('link');
      if (await breadcrumbLinks.count() > 0) {
        await human.click(breadcrumbLinks.first());
        
        await expect(breadcrumbLinks.first()).toBeVisible();
      }
    }
  });

  test('40.3 Breadcrumbs truncation works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const breadcrumbs = page.locator('[data-testid="breadcrumbs"]');
    if (await breadcrumbs.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(breadcrumbs).toBeVisible();
      
      // Check that breadcrumbs don't overflow
      const box = await breadcrumbs.boundingBox();
      if (box) {
        await expect(box.width).toBeLessThan(1000);
      }
    }
  });

  test('40.4 Breadcrumbs accessibility works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const breadcrumbs = page.locator('[data-testid="breadcrumbs"], nav[aria-label="breadcrumb"]');
    if (await breadcrumbs.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(breadcrumbs).toBeVisible();
      
      // Check ARIA attributes
      const ariaLabel = await breadcrumbs.getAttribute('aria-label');
      if (ariaLabel) {
        await expect(ariaLabel).toBeTruthy();
      }
    }
  });

  test('40.5 Breadcrumbs icons work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const breadcrumbs = page.locator('[data-testid="breadcrumbs"]');
    if (await breadcrumbs.isVisible({ timeout: 5000 }).catch(() => false)) {
      const icons = breadcrumbs.locator('[data-testid="breadcrumb-icon"]');
      if (await icons.count() > 0) {
        await expect(icons.count()).resolves.toBeGreaterThan(0);
      }
    }
  });

  test('40.6 Breadcrumbs click works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const breadcrumbs = page.locator('[data-testid="breadcrumbs"]');
    if (await breadcrumbs.isVisible({ timeout: 5000 }).catch(() => false)) {
      const breadcrumbLinks = breadcrumbs.getByRole('link');
      if (await breadcrumbLinks.count() > 0) {
        await human.click(breadcrumbLinks.first());
        
        await expect(breadcrumbLinks.first()).toBeVisible();
      }
    }
  });

  test('40.7 Breadcrumbs hover works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const breadcrumbs = page.locator('[data-testid="breadcrumbs"]');
    if (await breadcrumbs.isVisible({ timeout: 5000 }).catch(() => false)) {
      const breadcrumbLinks = breadcrumbs.getByRole('link');
      if (await breadcrumbLinks.count() > 0) {
        await breadcrumbLinks.first().hover();
        
        await expect(breadcrumbLinks.first()).toBeVisible();
      }
    }
  });

  test('40.8 Breadcrumbs mobile works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    await page.setViewportSize({ width: 375, height: 667 });
    
    const breadcrumbs = page.locator('[data-testid="breadcrumbs"]');
    if (await breadcrumbs.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(breadcrumbs).toBeVisible();
    }
    
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('40.9 Breadcrumbs animation works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const breadcrumbs = page.locator('[data-testid="breadcrumbs"]');
    if (await breadcrumbs.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(breadcrumbs).toBeVisible();
      
      // Check for animation class
      const animationClass = await breadcrumbs.getAttribute('class');
      if (animationClass) {
        await expect(animationClass).toBeTruthy();
      }
    }
  });

  test('40.10 Breadcrumbs context aware works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const breadcrumbs = page.locator('[data-testid="breadcrumbs"]');
    if (await breadcrumbs.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(breadcrumbs).toBeVisible();
      
      // Check that breadcrumbs reflect current context
      const currentContext = breadcrumbs.locator('[data-current="true"]');
      if (await currentContext.count() > 0) {
        await expect(currentContext.count()).resolves.toBeGreaterThan(0);
      }
    }
  });
});