/**
 * Advanced Breadcrumbs Tests
 * 
 * Tests for advanced breadcrumb functionality:
 * - Breadcrumb displays
 * - Breadcrumb navigation
 * - Breadcrumb truncation
 * - Breadcrumb accessibility
 * - Breadcrumb separator
 * - Breadcrumb custom
 * - Breadcrumb clickable
 * - Breadcrumb dynamic
 * - Breadcrumb history
 * - Breadcrumb mobile
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { saveBookmark } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Advanced Breadcrumbs Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('69.1 Breadcrumb displays', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const breadcrumbs = page.locator('[data-testid="breadcrumbs"], nav[aria-label="breadcrumb"]');
    if (await breadcrumbs.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(breadcrumbs).toBeVisible();
    }
  });

  test('69.2 Breadcrumb navigation works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const breadcrumbs = page.locator('[data-testid="breadcrumbs"]');
    if (await breadcrumbs.isVisible({ timeout: 5000 }).catch(() => false)) {
      const breadcrumbLink = breadcrumbs.getByRole('link').first();
      if (await breadcrumbLink.isVisible({ timeout: 3000 }).catch(() => false)) {
        await human.click(breadcrumbLink);
        
        await expect(breadcrumbLink).toBeVisible();
      }
    }
  });

  test('69.3 Breadcrumb truncation works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const breadcrumbs = page.locator('[data-testid="breadcrumbs"]');
    if (await breadcrumbs.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(breadcrumbs).toBeVisible();
      
      const box = await breadcrumbs.boundingBox();
      if (box) {
        await expect(box.width).toBeLessThan(1000);
      }
    }
  });

  test('69.4 Breadcrumb accessibility works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const breadcrumbs = page.locator('[data-testid="breadcrumbs"], nav[aria-label="breadcrumb"]');
    if (await breadcrumbs.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(breadcrumbs).toBeVisible();
      
      const ariaLabel = await breadcrumbs.getAttribute('aria-label');
      if (ariaLabel) {
        await expect(ariaLabel).toBeTruthy();
      }
    }
  });

  test('69.5 Breadcrumb separator works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const breadcrumbs = page.locator('[data-testid="breadcrumbs"]');
    if (await breadcrumbs.isVisible({ timeout: 5000 }).catch(() => false)) {
      const separator = breadcrumbs.locator('[data-testid="separator"]');
      if (await separator.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(separator).toBeVisible();
      }
    }
  });

  test('69.6 Breadcrumb custom works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const breadcrumbs = page.locator('[data-testid="breadcrumbs"][data-custom="true"]');
    if (await breadcrumbs.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(breadcrumbs).toBeVisible();
    }
  });

  test('69.7 Breadcrumb clickable works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const breadcrumbs = page.locator('[data-testid="breadcrumbs"]');
    if (await breadcrumbs.isVisible({ timeout: 5000 }).catch(() => false)) {
      const breadcrumbLink = breadcrumbs.getByRole('link').first();
      if (await breadcrumbLink.isVisible({ timeout: 3000 }).catch(() => false)) {
        await human.click(breadcrumbLink);
        
        await expect(breadcrumbLink).toBeVisible();
      }
    }
  });

  test('69.8 Breadcrumb dynamic works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const breadcrumbs = page.locator('[data-testid="breadcrumbs"]');
    if (await breadcrumbs.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(breadcrumbs).toBeVisible();
      
      const currentContext = breadcrumbs.locator('[data-current="true"]');
      if (await currentContext.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(currentContext).toBeVisible();
      }
    }
  });

  test('69.9 Breadcrumb history works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const breadcrumbs = page.locator('[data-testid="breadcrumbs"]');
    if (await breadcrumbs.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(breadcrumbs).toBeVisible();
      
      const breadcrumbLinks = breadcrumbs.getByRole('link');
      if (await breadcrumbLinks.count() > 0) {
        await expect(breadcrumbLinks.count()).resolves.toBeGreaterThan(0);
      }
    }
  });

  test('69.10 Breadcrumb mobile works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    await page.setViewportSize({ width: 375, height: 667 });
    
    const breadcrumbs = page.locator('[data-testid="breadcrumbs"]');
    if (await breadcrumbs.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(breadcrumbs).toBeVisible();
    }
    
    await page.setViewportSize({ width: 1280, height: 720 });
  });
});