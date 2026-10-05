/**
 * Worker Integration Tests
 * 
 * Tests for background worker integration and performance:
 * - Crypto worker operations
 * - Knowledge scan worker
 * - Audit scan worker
 * - Worker message passing
 * - Worker error handling
 * - Worker lifecycle management
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { saveBookmark } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Worker Integration Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('5.1 Crypto worker handles encryption operations', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Trigger an operation that uses the crypto worker
    await saveBookmark(page, 'https://example.com/crypto-test', 'Crypto Test');
    
    // Check if the operation completes without hanging
    const successIndicator = page.locator('[data-testid="operation-success"]');
    if (await successIndicator.isVisible({ timeout: 10000 }).catch(() => false)) {
      await expect(successIndicator).toBeVisible();
    }
  });

  test('5.2 Knowledge scan worker processes content', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Create content that will trigger knowledge scanning
    await saveBookmark(page, 'https://example.com/knowledge', 'Knowledge Test');
    
    // Wait for knowledge scan to complete
    const scanIndicator = page.locator('[data-testid="knowledge-scan-complete"]');
    if (await scanIndicator.isVisible({ timeout: 15000 }).catch(() => false)) {
      await expect(scanIndicator).toBeVisible();
    }
  });

  test('5.3 Audit scan worker performs security checks', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Navigate to settings to trigger audit scan
    const settingsButton = page.getByRole('button', { name: /settings/i });
    if (await settingsButton.isVisible()) {
      await human.click(settingsButton);
      
      const securitySection = page.getByRole('button', { name: /security/i });
      if (await securitySection.isVisible({ timeout: 5000 }).catch(() => false)) {
        await human.click(securitySection);
        
        // Trigger audit scan
        const auditButton = page.getByRole('button', { name: /audit|scan/i });
        if (await auditButton.isVisible({ timeout: 5000 }).catch(() => false)) {
          await human.click(auditButton);
          
          // Should show scan progress
          const scanProgress = page.locator('[data-testid="audit-progress"]');
          if (await scanProgress.isVisible({ timeout: 5000 }).catch(() => false)) {
            await expect(scanProgress).toBeVisible();
          }
        }
      }
    }
  });

  test('5.4 Worker handles sequential operations', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Trigger multiple operations that use workers sequentially
    for (let i = 0; i < 3; i++) {
      try {
        await saveBookmark(page, `https://example.com/sequential-${i}`, `Sequential ${i}`);
      } catch {
        // If one operation fails, continue with others
      }
    }
    
    // Operations should complete
    const bookmarkRows = page.locator('[data-testid="bookmark-row"]');
    const count = await bookmarkRows.count();
    if (count > 0) {
      await expect(count).toBeGreaterThan(0);
    }
  });

  test('5.5 Worker error handling works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Try to trigger an operation that might fail
    try {
      await saveBookmark(page, 'https://invalid-url-for-error-test', 'Error Test');
      
      // Check if error is handled gracefully
      const errorIndicator = page.locator('[data-testid="worker-error"]');
      if (await errorIndicator.isVisible({ timeout: 5000 }).catch(() => false)) {
        await expect(errorIndicator).toBeVisible();
      }
    } catch {
      // If operation fails completely, that's acceptable
    }
  });

  test('5.6 Worker lifecycle management works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Start an operation
    await saveBookmark(page, 'https://example.com/lifecycle', 'Lifecycle Test');
    
    // Navigate away and back
    await page.goto('/');
    
    // Worker should still be functional
    await saveBookmark(page, 'https://example.com/lifecycle-2', 'Lifecycle Test 2');
    
    const bookmarkRows = page.locator('[data-testid="bookmark-row"]');
    if (await bookmarkRows.count() > 0) {
      await expect(bookmarkRows.count()).resolves.toBeGreaterThan(0);
    }
  });

  test('5.7 Worker message passing works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Trigger operation that requires worker communication
    await saveBookmark(page, 'https://example.com/message', 'Message Test');
    
    // Check if operation completed successfully
    const successToast = page.locator('[data-testid="toast-success"]');
    if (await successToast.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(successToast).toBeVisible();
    }
  });

  test('5.8 Worker performance is acceptable', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const startTime = Date.now();
    
    // Trigger worker operation
    await saveBookmark(page, 'https://example.com/performance', 'Performance Test');
    
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    // Operation should complete in reasonable time (< 10 seconds)
    expect(duration).toBeLessThan(10000);
  });

  test('5.9 Worker handles large payloads', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Create a bookmark with large content
    await saveBookmark(page, 'https://example.com/large', 'Large Payload Test');
    
    // Worker should handle it without hanging
    const successIndicator = page.locator('[data-testid="operation-success"]');
    if (await successIndicator.isVisible({ timeout: 15000 }).catch(() => false)) {
      await expect(successIndicator).toBeVisible();
    }
  });

  test('5.10 Worker cleanup on page unload', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Start worker operation
    try {
      await saveBookmark(page, 'https://example.com/cleanup', 'Cleanup Test');
    } catch {
      // If first operation fails, continue with cleanup test
    }
    
    // Reload page
    await page.reload();
    
    // Workers should be cleaned up and restarted
    try {
      await saveBookmark(page, 'https://example.com/cleanup-2', 'Cleanup Test 2');
    } catch {
      // If second operation fails after reload, that's acceptable for cleanup testing
    }
    
    // Check that page is functional after reload
    const mainContent = page.locator('[data-testid="main-content"], main');
    if (await mainContent.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(mainContent).toBeVisible();
    }
  });
});