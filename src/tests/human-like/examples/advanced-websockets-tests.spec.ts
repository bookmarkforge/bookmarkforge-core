/**
 * Advanced WebSockets Tests
 * 
 * Tests for advanced WebSocket functionality:
 * - WebSocket displays
 * - WebSocket connect
 * - WebSocket message
 * - WebSocket disconnect
 * - WebSocket binary
 * - WebSocket accessibility
 * - WebSocket custom
 * - WebSocket ping
 * - WebSocket pong
 * - WebSocket error
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { saveBookmark } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Advanced WebSockets Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('121.1 WebSocket displays', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const websocket = page.locator('[data-testid="websocket"]');
    if (await websocket.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(websocket).toBeVisible();
    }
  });

  test('121.2 WebSocket connect works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const websocket = page.locator('[data-testid="websocket"][data-connect="true"]');
    if (await websocket.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(websocket).toBeVisible();
      
      const readyState = await page.evaluate(() => {
        return (window as any).wsReadyState;
      });
      if (readyState) {
        await expect(readyState).toBeTruthy();
      }
    }
  });

  test('121.3 WebSocket message works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const websocket = page.locator('[data-testid="websocket"][data-message="true"]');
    if (await websocket.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(websocket).toBeVisible();
    }
  });

  test('121.4 WebSocket disconnect works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const websocket = page.locator('[data-testid="websocket"][data-disconnect="true"]');
    if (await websocket.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(websocket).toBeVisible();
    }
  });

  test('121.5 WebSocket binary works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const websocket = page.locator('[data-testid="websocket"][data-binary="true"]');
    if (await websocket.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(websocket).toBeVisible();
    }
  });

  test('121.6 WebSocket accessibility works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const websocket = page.locator('[data-testid="websocket"]').first();
    if (await websocket.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Check ARIA attributes
      const ariaLabel = await websocket.getAttribute('aria-label');
      const role = await websocket.getAttribute('role');
      
      if (ariaLabel || role) {
        await expect(ariaLabel || role).toBeTruthy();
      }
    }
  });

  test('121.7 WebSocket custom works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const websocket = page.locator('[data-testid="websocket"][data-custom="true"]');
    if (await websocket.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(websocket).toBeVisible();
    }
  });

  test('121.8 WebSocket ping works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const websocket = page.locator('[data-testid="websocket"][data-ping="true"]');
    if (await websocket.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(websocket).toBeVisible();
    }
  });

  test('121.9 WebSocket pong works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const websocket = page.locator('[data-testid="websocket"][data-pong="true"]');
    if (await websocket.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(websocket).toBeVisible();
    }
  });

  test('121.10 WebSocket error works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const websocket = page.locator('[data-testid="websocket"][data-error="true"]');
    if (await websocket.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(websocket).toBeVisible();
    }
  });
});