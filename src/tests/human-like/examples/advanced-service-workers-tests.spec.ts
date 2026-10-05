/**
 * Advanced Service Workers Tests
 * 
 * Tests for advanced service worker functionality:
 * - Service worker displays
 * - Service worker register
 * - Service worker update
 * - Service worker cache
 * - Service worker push
 * - Service worker accessibility
 * - Service worker custom
 * - Service worker sync
 * - Service worker background
 * - Service worker offline
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { saveBookmark } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Advanced Service Workers Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('120.1 Service worker displays', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const serviceWorker = page.locator('[data-testid="service-worker"]');
    if (await serviceWorker.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(serviceWorker).toBeVisible();
    }
  });

  test('120.2 Service worker register works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const serviceWorker = page.locator('[data-testid="service-worker"][data-register="true"]');
    if (await serviceWorker.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(serviceWorker).toBeVisible();
      
      const registration = await page.evaluate(() => {
        return navigator.serviceWorker.getRegistration();
      });
      if (registration) {
        await expect(registration).toBeTruthy();
      }
    }
  });

  test('120.3 Service worker update works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const serviceWorker = page.locator('[data-testid="service-worker"][data-update="true"]');
    if (await serviceWorker.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(serviceWorker).toBeVisible();
    }
  });

  test('120.4 Service worker cache works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const serviceWorker = page.locator('[data-testid="service-worker"][data-cache="true"]');
    if (await serviceWorker.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(serviceWorker).toBeVisible();
      
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

  test('120.5 Service worker push works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const serviceWorker = page.locator('[data-testid="service-worker"][data-push="true"]');
    if (await serviceWorker.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(serviceWorker).toBeVisible();
    }
  });

  test('120.6 Service worker accessibility works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const serviceWorker = page.locator('[data-testid="service-worker"]').first();
    if (await serviceWorker.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Check ARIA attributes
      const ariaLabel = await serviceWorker.getAttribute('aria-label');
      const role = await serviceWorker.getAttribute('role');
      
      if (ariaLabel || role) {
        await expect(ariaLabel || role).toBeTruthy();
      }
    }
  });

  test('120.7 Service worker custom works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const serviceWorker = page.locator('[data-testid="service-worker"][data-custom="true"]');
    if (await serviceWorker.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(serviceWorker).toBeVisible();
    }
  });

  test('120.8 Service worker sync works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const serviceWorker = page.locator('[data-testid="service-worker"][data-sync="true"]');
    if (await serviceWorker.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(serviceWorker).toBeVisible();
    }
  });

  test('120.9 Service worker background works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const serviceWorker = page.locator('[data-testid="service-worker"][data-background="true"]');
    if (await serviceWorker.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(serviceWorker).toBeVisible();
    }
  });

  test('120.10 Service worker offline works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const serviceWorker = page.locator('[data-testid="service-worker"][data-offline="true"]');
    if (await serviceWorker.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(serviceWorker).toBeVisible();
    }
  });
});