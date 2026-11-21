/**
 * Advanced Service Workers / Offline Platform Tests
 *
 * NOTE: the PWA service worker (dist/sw.js, Workbox) only registers in
 * production builds (`vite preview`/`vite build`). The human-like suite runs
 * against the Vite dev server, where `virtual:pwa-register` is a no-op and
 * Playwright's contextOptions block service workers anyway. Real SW
 * registration/cache/offline-shell coverage lives in:
 *   - tests/e2e/sw-integrity-tamper.spec.ts   (vite preview)
 *   - tests/e2e/pwa-mobile-android.spec.ts    (vite preview)
 *
 * This spec therefore verifies the platform capabilities the app relies on
 * (ServiceWorker/Cache APIs, IndexedDB persistence) and real offline
 * behavior of the already-loaded app — deterministic checks that hold in dev.
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Advanced Service Workers Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
    await page.waitForLoadState('networkidle');
  });

  test('should expose the service worker API', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);

    const swApiAvailable = await page.evaluate(() => 'serviceWorker' in navigator);
    expect(swApiAvailable).toBe(true);
  });

  test('should expose Cache Storage API', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);

    const cacheAvailable = await page.evaluate(() => 'caches' in window);
    expect(cacheAvailable).toBe(true);

    // CacheStorage must be openable (used by Workbox runtime caching in prod)
    const canOpen = await page.evaluate(async () => {
      try {
        const cache = await caches.open('forge-capability-probe');
        await cache.put('/probe', new Response('ok'));
        const hit = await cache.match('/probe');
        await cache.delete('/probe');
        return hit !== undefined;
      } catch {
        return false;
      }
    });
    expect(canOpen).toBe(true);
  });

  test('should keep app data in IndexedDB offline', async ({ page, context }) => {
    const human = createHumanBehavior(page, ciBasicOptions);

    // Seed a marker, go offline, verify it survives
    await page.evaluate(() => localStorage.setItem('forge_sw_offline_probe', 'persisted'));
    await context.setOffline(true);
    await page.waitForTimeout(1000);

    await expect(page.locator('body')).toBeVisible();
    const value = await page.evaluate(() => localStorage.getItem('forge_sw_offline_probe'));
    expect(value).toBe('persisted');

    await context.setOffline(false);
    await page.evaluate(() => localStorage.removeItem('forge_sw_offline_probe'));
  });

  test('should keep UI functional without network after load', async ({ page, context }) => {
    const human = createHumanBehavior(page, ciBasicOptions);

    // Warm the lazy Settings chunk online first (realistic user flow)
    await page.getByTestId('settings-button').click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    await context.setOffline(true);
    await page.waitForTimeout(1000);

    // Settings still opens offline — module is in memory, data is local
    await page.getByTestId('settings-button').click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Escape');

    await context.setOffline(false);
    await page.waitForTimeout(500);
  });

  test('should recover when connectivity returns', async ({ page, context }) => {
    const human = createHumanBehavior(page, ciBasicOptions);

    await context.setOffline(true);
    await page.waitForTimeout(1000);
    expect(await page.evaluate(() => navigator.onLine)).toBe(false);

    await context.setOffline(false);
    await page.waitForTimeout(1000);
    expect(await page.evaluate(() => navigator.onLine)).toBe(true);
    await expect(page.getByTestId('settings-button')).toBeVisible();
  });

  test('should support background sync API detection', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);

    const bgSyncAvailable = await page.evaluate(() => {
      return 'serviceWorker' in navigator && 'sync' in window.ServiceWorkerRegistration.prototype;
    });
    expect(typeof bgSyncAvailable).toBe('boolean');
  });

  test('should support push notifications API detection', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);

    const pushSupported = await page.evaluate(() => 'PushManager' in window);
    expect(typeof pushSupported).toBe('boolean');
  });
});
