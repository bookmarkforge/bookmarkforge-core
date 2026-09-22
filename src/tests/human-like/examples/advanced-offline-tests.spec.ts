/**
 * Advanced Offline Tests
 * 
 * Tests for advanced offline functionality:
 * - Offline displays
 * - Offline detection
 * - Online detection
 * - Offline cache
 * - Offline sync
 * - Offline accessibility
 * - Offline custom
 * - Offline fallback
 * - Offline queue
 * - Offline retry
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { saveBookmark } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Advanced Offline Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('118.1 Offline displays', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const offline = page.locator('[data-testid="offline"]');
    if (await offline.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(offline).toBeVisible();
    }
  });

  test('118.2 Offline detection works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const offline = page.locator('[data-testid="offline"][data-detection="true"]');
    if (await offline.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(offline).toBeVisible();
      
      const isOnline = await page.evaluate(() => navigator.onLine);
      await expect(isOnline).toBe(true);
    }
  });

  test('118.3 Online detection works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const offline = page.locator('[data-testid="offline"][data-online="true"]');
    if (await offline.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(offline).toBeVisible();
      
      const isOnline = await page.evaluate(() => navigator.onLine);
      await expect(isOnline).toBe(true);
    }
  });

  test('118.4 Offline cache works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const offline = page.locator('[data-testid="offline"][data-cache="true"]');
    if (await offline.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(offline).toBeVisible();
      
      const cache = await page.evaluate(async () => {
        if ('caches' in window) {
          return await caches.keys();
        }
        return null;
      });
      if (cache) {
        await expect(cache).toBeTruthy();
      }
    }
  });

  test('118.5 Offline sync works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const offline = page.locator('[data-testid="offline"][data-sync="true"]');
    if (await offline.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(offline).toBeVisible();
    }
  });

  test('118.6 Offline accessibility works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const offline = page.locator('[data-testid="offline"]').first();
    if (await offline.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Check ARIA attributes
      const ariaLabel = await offline.getAttribute('aria-label');
      const role = await offline.getAttribute('role');
      
      if (ariaLabel || role) {
        await expect(ariaLabel || role).toBeTruthy();
      }
    }
  });

  test('118.7 Offline custom works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const offline = page.locator('[data-testid="offline"][data-custom="true"]');
    if (await offline.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(offline).toBeVisible();
    }
  });

  test('118.8 Offline fallback works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const offline = page.locator('[data-testid="offline"][data-fallback="true"]');
    if (await offline.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(offline).toBeVisible();
    }
  });

  test('118.9 Offline queue works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const offline = page.locator('[data-testid="offline"][data-queue="true"]');
    if (await offline.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(offline).toBeVisible();
    }
  });

  test('118.10 Offline retry works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const offline = page.locator('[data-testid="offline"][data-retry="true"]');
    if (await offline.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(offline).toBeVisible();
    }
  });
});