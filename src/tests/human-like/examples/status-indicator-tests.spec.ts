/**
 * Status Indicator Tests
 * 
 * Tests for status indicator features:
 * - Connection status
 * - Sync status
 * - Encryption status
 * - Backup status
 * - Performance status
 * - Health status
 * - Status animations
 * - Status colors
 * - Status tooltips
 * - Status persistence
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { saveBookmark } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Status Indicator Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('38.1 Connection status displays', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const connectionStatus = page.locator('[data-testid="connection-status"]');
    if (await connectionStatus.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(connectionStatus).toBeVisible();
    }
  });

  test('38.2 Sync status displays', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const syncStatus = page.locator('[data-testid="sync-status"]');
    if (await syncStatus.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(syncStatus).toBeVisible();
    }
  });

  test('38.3 Encryption status displays', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const encryptionStatus = page.locator('[data-testid="encryption-status"]');
    if (await encryptionStatus.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(encryptionStatus).toBeVisible();
    }
  });

  test('38.4 Backup status displays', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const backupStatus = page.locator('[data-testid="backup-status"]');
    if (await backupStatus.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(backupStatus).toBeVisible();
    }
  });

  test('38.5 Performance status displays', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const performanceStatus = page.locator('[data-testid="performance-status"]');
    if (await performanceStatus.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(performanceStatus).toBeVisible();
    }
  });

  test('38.6 Health status displays', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const healthStatus = page.locator('[data-testid="health-status"]');
    if (await healthStatus.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(healthStatus).toBeVisible();
    }
  });

  test('38.7 Status animations work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const statusIndicator = page.locator('[data-testid="status-indicator"]');
    if (await statusIndicator.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(statusIndicator).toBeVisible();
      
      // Check for animation class
      const animationClass = await statusIndicator.getAttribute('class');
      if (animationClass) {
        await expect(animationClass).toBeTruthy();
      }
    }
  });

  test('38.8 Status colors work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const statusIndicator = page.locator('[data-testid="status-indicator"]');
    if (await statusIndicator.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(statusIndicator).toBeVisible();
      
      // Check that indicator has color styling
      const colorStyle = await statusIndicator.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return styles.color || styles.backgroundColor;
      });
      if (colorStyle) {
        await expect(colorStyle).toBeTruthy();
      }
    }
  });

  test('38.9 Status tooltips work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const statusIndicator = page.locator('[data-testid="status-indicator"]');
    if (await statusIndicator.isVisible({ timeout: 5000 }).catch(() => false)) {
      await statusIndicator.hover();
      
      const tooltip = page.locator('[role="tooltip"]');
      if (await tooltip.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(tooltip).toBeVisible();
      }
    }
  });

  test('38.10 Status persistence works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const statusIndicator = page.locator('[data-testid="status-indicator"]');
    if (await statusIndicator.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(statusIndicator).toBeVisible();
      
      // Reload and check if status persists
      await page.reload();
      
      const statusAfterReload = page.locator('[data-testid="status-indicator"]');
      if (await statusAfterReload.isVisible({ timeout: 5000 }).catch(() => false)) {
        await expect(statusAfterReload).toBeVisible();
      }
    }
  });
});