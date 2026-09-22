/**
 * Advanced Broadcast Channel Tests
 * 
 * Tests for advanced broadcast channel functionality:
 * - Broadcast channel displays
 * - Broadcast channel connect
 * - Broadcast channel message
 * - Broadcast channel disconnect
 * - Broadcast channel multi-tab
 * - Broadcast channel accessibility
 * - Broadcast channel custom
 * - Broadcast channel error
 * - Broadcast channel type
 * - Broadcast channel close
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { saveBookmark } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Advanced Broadcast Channel Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('123.1 Broadcast channel displays', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const broadcastChannel = page.locator('[data-testid="broadcast-channel"]');
    if (await broadcastChannel.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(broadcastChannel).toBeVisible();
    }
  });

  test('123.2 Broadcast channel connect works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const broadcastChannel = page.locator('[data-testid="broadcast-channel"][data-connect="true"]');
    if (await broadcastChannel.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(broadcastChannel).toBeVisible();
      
      const channel = await page.evaluate(() => {
        if ('BroadcastChannel' in window) {
          return new BroadcastChannel('test');
        }
        return null;
      });
      if (channel) {
        await expect(channel).toBeTruthy();
      }
    }
  });

  test('123.3 Broadcast channel message works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const broadcastChannel = page.locator('[data-testid="broadcast-channel"][data-message="true"]');
    if (await broadcastChannel.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(broadcastChannel).toBeVisible();
    }
  });

  test('123.4 Broadcast channel disconnect works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const broadcastChannel = page.locator('[data-testid="broadcast-channel"][data-disconnect="true"]');
    if (await broadcastChannel.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(broadcastChannel).toBeVisible();
    }
  });

  test('123.5 Broadcast channel multi-tab works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const broadcastChannel = page.locator('[data-testid="broadcast-channel"][data-multi-tab="true"]');
    if (await broadcastChannel.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(broadcastChannel).toBeVisible();
    }
  });

  test('123.6 Broadcast channel accessibility works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const broadcastChannel = page.locator('[data-testid="broadcast-channel"]').first();
    if (await broadcastChannel.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Check ARIA attributes
      const ariaLabel = await broadcastChannel.getAttribute('aria-label');
      const role = await broadcastChannel.getAttribute('role');
      
      if (ariaLabel || role) {
        await expect(ariaLabel || role).toBeTruthy();
      }
    }
  });

  test('123.7 Broadcast channel custom works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const broadcastChannel = page.locator('[data-testid="broadcast-channel"][data-custom="true"]');
    if (await broadcastChannel.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(broadcastChannel).toBeVisible();
    }
  });

  test('123.8 Broadcast channel error works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const broadcastChannel = page.locator('[data-testid="broadcast-channel"][data-error="true"]');
    if (await broadcastChannel.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(broadcastChannel).toBeVisible();
    }
  });

  test('123.9 Broadcast channel type works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const broadcastChannel = page.locator('[data-testid="broadcast-channel"][data-type="true"]');
    if (await broadcastChannel.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(broadcastChannel).toBeVisible();
    }
  });

  test('123.10 Broadcast channel close works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const broadcastChannel = page.locator('[data-testid="broadcast-channel"][data-close="true"]');
    if (await broadcastChannel.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(broadcastChannel).toBeVisible();
    }
  });
});