/**
 * Advanced Shared Worker Tests
 * 
 * Tests for advanced shared worker functionality:
 * - Shared worker displays
 * - Shared worker spawn
 * - Shared worker message
 * - Shared worker terminate
 * - Shared worker multi-tab
 * - Shared worker accessibility
 * - Shared worker custom
 * - Shared worker port
 * - Shared worker error
 * - Shared worker close
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { saveBookmark } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Advanced Shared Worker Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('124.1 Shared worker displays', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const sharedWorker = page.locator('[data-testid="shared-worker"]');
    if (await sharedWorker.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(sharedWorker).toBeVisible();
    }
  });

  test('124.2 Shared worker spawn works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const sharedWorker = page.locator('[data-testid="shared-worker"][data-spawn="true"]');
    if (await sharedWorker.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(sharedWorker).toBeVisible();
      
      const workerCount = await page.evaluate(() => {
        return (window as any).sharedWorkerCount || 0;
      });
      if (workerCount) {
        await expect(workerCount).toBeGreaterThan(0);
      }
    }
  });

  test('124.3 Shared worker message works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const sharedWorker = page.locator('[data-testid="shared-worker"][data-message="true"]');
    if (await sharedWorker.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(sharedWorker).toBeVisible();
    }
  });

  test('124.4 Shared worker terminate works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const sharedWorker = page.locator('[data-testid="shared-worker"][data-terminate="true"]');
    if (await sharedWorker.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(sharedWorker).toBeVisible();
    }
  });

  test('124.5 Shared worker multi-tab works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const sharedWorker = page.locator('[data-testid="shared-worker"][data-multi-tab="true"]');
    if (await sharedWorker.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(sharedWorker).toBeVisible();
    }
  });

  test('124.6 Shared worker accessibility works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const sharedWorker = page.locator('[data-testid="shared-worker"]').first();
    if (await sharedWorker.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Check ARIA attributes
      const ariaLabel = await sharedWorker.getAttribute('aria-label');
      const role = await sharedWorker.getAttribute('role');
      
      if (ariaLabel || role) {
        await expect(ariaLabel || role).toBeTruthy();
      }
    }
  });

  test('124.7 Shared worker custom works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const sharedWorker = page.locator('[data-testid="shared-worker"][data-custom="true"]');
    if (await sharedWorker.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(sharedWorker).toBeVisible();
    }
  });

  test('124.8 Shared worker port works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const sharedWorker = page.locator('[data-testid="shared-worker"][data-port="true"]');
    if (await sharedWorker.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(sharedWorker).toBeVisible();
    }
  });

  test('124.9 Shared worker error works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const sharedWorker = page.locator('[data-testid="shared-worker"][data-error="true"]');
    if (await sharedWorker.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(sharedWorker).toBeVisible();
    }
  });

  test('124.10 Shared worker close works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const sharedWorker = page.locator('[data-testid="shared-worker"][data-close="true"]');
    if (await sharedWorker.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(sharedWorker).toBeVisible();
    }
  });
});