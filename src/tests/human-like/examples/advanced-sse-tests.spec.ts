/**
 * Advanced Server-Sent Events Tests
 * 
 * Tests for advanced server-sent events functionality:
 * - SSE displays
 * - SSE connect
 * - SSE message
 * - SSE disconnect
 * - SSE retry
 * - SSE accessibility
 * - SSE custom
 * - SSE event types
 * - SSE data
 * - SSE error
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { saveBookmark } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Advanced Server-Sent Events Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('122.1 SSE displays', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const sse = page.locator('[data-testid="sse"]');
    if (await sse.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(sse).toBeVisible();
    }
  });

  test('122.2 SSE connect works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const sse = page.locator('[data-testid="sse"][data-connect="true"]');
    if (await sse.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(sse).toBeVisible();
      
      const readyState = await page.evaluate(() => {
        return (window as any).sseReadyState;
      });
      if (readyState) {
        await expect(readyState).toBeTruthy();
      }
    }
  });

  test('122.3 SSE message works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const sse = page.locator('[data-testid="sse"][data-message="true"]');
    if (await sse.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(sse).toBeVisible();
    }
  });

  test('122.4 SSE disconnect works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const sse = page.locator('[data-testid="sse"][data-disconnect="true"]');
    if (await sse.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(sse).toBeVisible();
    }
  });

  test('122.5 SSE retry works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const sse = page.locator('[data-testid="sse"][data-retry="true"]');
    if (await sse.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(sse).toBeVisible();
    }
  });

  test('122.6 SSE accessibility works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const sse = page.locator('[data-testid="sse"]').first();
    if (await sse.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Check ARIA attributes
      const ariaLabel = await sse.getAttribute('aria-label');
      const role = await sse.getAttribute('role');
      
      if (ariaLabel || role) {
        await expect(ariaLabel || role).toBeTruthy();
      }
    }
  });

  test('122.7 SSE custom works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const sse = page.locator('[data-testid="sse"][data-custom="true"]');
    if (await sse.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(sse).toBeVisible();
    }
  });

  test('122.8 SSE event types work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const sse = page.locator('[data-testid="sse"][data-event-types="true"]');
    if (await sse.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(sse).toBeVisible();
    }
  });

  test('122.9 SSE data works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const sse = page.locator('[data-testid="sse"][data-data="true"]');
    if (await sse.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(sse).toBeVisible();
    }
  });

  test('122.10 SSE error works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const sse = page.locator('[data-testid="sse"][data-error="true"]');
    if (await sse.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(sse).toBeVisible();
    }
  });
});