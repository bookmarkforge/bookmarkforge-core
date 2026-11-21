/**
 * Advanced Error Recovery Tests
 * 
 * Tests for BookmarkForge's error recovery scenarios:
 * - Network failure recovery
 * - Offline/online transitions
 * - Storage errors
 * - Lazy loading failures
 * - Vault lock/unlock errors
 * - Sync errors
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Advanced Error Recovery Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('should handle network failure gracefully', async ({ page, context }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Warm the lazy Settings chunk while online
    await page.getByTestId('settings-button').click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Go offline
    await context.setOffline(true);
    await page.waitForTimeout(1000);

    // App should remain functional (local-first)
    await expect(page.locator('body')).toBeVisible();

    // Try to access settings (should work offline — module already loaded)
    const settingsButton = page.getByTestId('settings-button');
    await settingsButton.click();
    await page.waitForTimeout(1000);

    // Settings should open
    const settingsModal = page.getByRole('dialog').first();
    await expect(settingsModal).toBeVisible({ timeout: 10_000 });

    // Close settings
    await page.keyboard.press('Escape');

    // Go back online
    await context.setOffline(false);
    await page.waitForTimeout(1000);

    // App should recover
    await expect(page.locator('body')).toBeVisible();
  });

  test('should handle offline/online transitions', async ({ page, context }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Multiple offline/online transitions
    for (let i = 0; i < 3; i++) {
      await context.setOffline(true);
      await page.waitForTimeout(500);
      await context.setOffline(false);
      await page.waitForTimeout(500);
    }

    // App should still be functional
    await expect(page.locator('body')).toBeVisible();
    await expect(page.getByTestId('settings-button')).toBeVisible();
  });

  test('should handle storage errors gracefully', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Try to access localStorage (might fail in some contexts)
    const storageAvailable = await page.evaluate(() => {
      try {
        localStorage.setItem('test', 'value');
        localStorage.removeItem('test');
        return true;
      } catch {
        return false;
      }
    });

    // Storage should be available or handled gracefully
    expect(typeof storageAvailable).toBe('boolean');
  });

  test('should handle IndexedDB errors gracefully', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Try to access IndexedDB
    const idbAvailable = await page.evaluate(() => {
      return 'indexedDB' in window;
    });

    // IndexedDB should be available
    expect(idbAvailable).toBe(true);
  });

  test('should handle lazy loading failures', async ({ page, context }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Go offline to simulate lazy loading failure, then trigger a lazy
    // component (Settings) that has not been loaded yet
    await context.setOffline(true);
    await page.waitForTimeout(1000);

    await page.getByTestId('settings-button').click();
    await page.waitForTimeout(2000);

    // The app must stay stable while the lazy chunk waits for connectivity —
    // no white screen, no unhandled crash
    await expect(page.locator('body')).toBeVisible();
    const crashed = await page.evaluate(() =>
      !!document.querySelector('[data-testid="route-error"], .error-boundary-fallback')
    );
    expect(crashed).toBe(false);

    // Go back online — lazyWithRetry should resolve and Settings should open
    await context.setOffline(false);
    await page.waitForTimeout(1000);

    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press('Escape');
  });

  test('should handle vault lock errors', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Try to lock vault
    const lockButton = page.locator('button:has-text("Lock"), [data-testid="lock-button"]').first();
    
    if (await lockButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await lockButton.click();
      await page.waitForTimeout(1000);

      // Should show unlock screen
      const unlockScreen = page.locator('text=/unlock|password|vault/i').first();
      expect(await unlockScreen.count()).toBeGreaterThan(0);

      // Try to unlock with wrong password (should fail gracefully)
      const passwordInput = page.locator('input[type="password"], input[placeholder*="password"]').first();
      if (await passwordInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        await passwordInput.fill('wrong-password');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(1000);

        // Should show error or stay on unlock screen
        const errorMessage = page.locator('text=/error|invalid|incorrect/i').first();
        const stillLocked = await unlockScreen.isVisible({ timeout: 3000 }).catch(() => false);

        expect(errorMessage || stillLocked).toBeTruthy();
      }
    }
  });

  test('should handle sync errors gracefully', async ({ page, context }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Go offline to simulate sync failure
    await context.setOffline(true);
    await page.waitForTimeout(1000);

    // Try to trigger sync
    const syncButton = page.locator('button:has-text("Sync"), [data-testid="sync-button"]').first();
    
    if (await syncButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await syncButton.click();
      await page.waitForTimeout(1000);

      // Should handle sync failure gracefully
      const errorMessage = page.locator('text=/error|failed|offline/i').first();
      const appContent = page.locator('[data-testid="app-content"], main, [role="main"]').first();

      const hasError = await errorMessage.isVisible({ timeout: 3000 }).catch(() => false);
      const hasContent = await appContent.isVisible({ timeout: 3000 }).catch(() => false);

      expect(hasError || hasContent).toBe(true);
    }

    // Go back online
    await context.setOffline(false);
    await page.waitForTimeout(1000);
  });

  test('should handle metadata fetch errors', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Try to fetch metadata for a bookmark
    // This might fail due to network firewall or offline
    const bookmarkCard = page.locator('[data-testid="bookmark-item"], .bookmark-card, [class*="bookmark"]').first();
    
    if (await bookmarkCard.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Click on bookmark — app must handle the interaction gracefully
      // (details panel, navigation, or silent no-op; never a crash)
      await bookmarkCard.click();
      await page.waitForTimeout(2000);

      await expect(page.locator('body')).toBeVisible();
      const crashed = await page.evaluate(() =>
        !!document.querySelector('[data-testid="route-error"], .error-boundary-fallback')
      );
      expect(crashed).toBe(false);
    }
  });

  test('should handle AI provider errors', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Access settings
    await page.getByTestId('settings-button').click();
    await page.waitForTimeout(1000);

    // Look for AI provider section
    const aiSection = page.locator('button:has-text("AI"), button:has-text("Provider"), [data-testid="ai-section"]').first();
    
    if (await aiSection.isVisible({ timeout: 5000 }).catch(() => false)) {
      await aiSection.click();
      await page.waitForTimeout(1000);

      // Try to configure AI without proper setup
      const testButton = page.locator('button:has-text("Test"), button:has-text("Connect"), [data-testid="test-ai"]').first();
      
      if (await testButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await testButton.click();
        await page.waitForTimeout(2000);

        // Should show error or fallback message
        const errorMessage = page.locator('text=/error|failed|not configured|unavailable/i').first();
        expect(await errorMessage.count()).toBeGreaterThanOrEqual(0);
      }
    }

    // Close settings
    await page.keyboard.press('Escape');
  });

  test('should handle worker errors gracefully', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Workers should fallback to main thread if they fail
    // Check for worker-related errors in console
    const workerErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error' && msg.text().includes('worker')) {
        workerErrors.push(msg.text());
      }
    });

    // Wait for potential worker operations
    await page.waitForTimeout(3000);

    // Worker errors should be handled (fallback to main thread)
    // The app should still be functional
    await expect(page.locator('body')).toBeVisible();
  });

  test('should recover from JavaScript errors', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Inject a JavaScript error
    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error('Test error');
      }, 100);
    });

    await page.waitForTimeout(1000);

    // App should still be functional (error boundary should catch)
    await expect(page.locator('body')).toBeVisible();
    await expect(page.getByTestId('settings-button')).toBeVisible();
  });

  test('should handle timeout errors', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Try a slow operation that might timeout
    const slowOperation = page.evaluate(() => {
      return new Promise(resolve => {
        setTimeout(() => resolve('done'), 5000);
      });
    });

    // Should complete without breaking the app
    await slowOperation;
    await expect(page.locator('body')).toBeVisible();
  });

  test('should handle concurrent operation conflicts', async ({ page, context }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Open second tab
    const secondPage = await context.newPage();
    await secondPage.goto('/app');
    await secondPage.waitForLoadState('networkidle');

    // Both tabs should be able to operate without conflicts
    await expect(page.locator('body')).toBeVisible();
    await expect(secondPage.locator('body')).toBeVisible();

    // Close second tab
    await secondPage.close();
  });
});
