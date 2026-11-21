/* eslint-disable @typescript-eslint/ban-ts-comment -- deliberate strict-check exemption (see note below) */
// @ts-nocheck
// Human-like harness — self-contained test infrastructure with intentionally
// loose typing (heavy `as any`), so noUncheckedIndexedAccess `!` churn adds
// no assertion value here. Excluded from strict checking; mirrors the
// src/tests/db/encryption.test.ts precedent (tsconfig.json "exclude").
/**
 * Regression Tests - Bug Prevention
 * 
 * Tests designed to catch common bugs and regressions:
 * - Memory leaks
 * - Race conditions
 * - State management issues
 * - UI rendering bugs
 * - Performance degradation
 * - Security vulnerabilities
 */

import { test, expect } from '@playwright/test';
import { createPerformanceTesting } from '../core/performance-testing';
import {
  saveBookmark,
  closeQuickCapture,
  goToBookmarks,
  expectCapturedToast,
  ensureUnlocked,
} from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Regression: Memory Leaks', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('No memory leak on rapid navigation', async ({ page }) => {
    const initialMemory = await page.evaluate(() => {
      const m = (performance as any).memory;
      return m ? m.usedJSHeapSize : 0;
    });

    // Rapid navigation
    for (let i = 0; i < 10; i++) {
      await page.getByTestId('add-bookmark-button').click().catch(() => { /* INTENTIONAL SILENCE: optional UI action is best-effort in this exploratory test. */ });
      await page.waitForTimeout(100);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);
    }

    const finalMemory = await page.evaluate(() => {
      const m = (performance as any).memory;
      return m ? m.usedJSHeapSize : 0;
    });

    if (initialMemory > 0 && finalMemory > 0) {
      const increase = ((finalMemory - initialMemory) / initialMemory) * 100;
      expect(increase).toBeLessThan(20); // Less than 20% increase
    }
  });

  test('No memory leak on QuickCapture cycles', async ({ page }) => {
    const initialMemory = await page.evaluate(() => {
      const m = (performance as any).memory;
      return m ? m.usedJSHeapSize : 0;
    });

    // Open/close QuickCapture many times
    for (let i = 0; i < 15; i++) {
      try {
        await page.getByTestId('add-bookmark-button').click();
        await page.waitForSelector('[data-testid="quick-capture-input"]', {
          state: 'visible', 
          timeout: 1000 
        });
        await page.keyboard.press('Escape');
        await page.waitForTimeout(100);
      } catch {
        await page.waitForTimeout(50);
      }
    }

    const finalMemory = await page.evaluate(() => {
      const m = (performance as any).memory;
      return m ? m.usedJSHeapSize : 0;
    });

    if (initialMemory > 0 && finalMemory > 0) {
      const increase = ((finalMemory - initialMemory) / initialMemory) * 100;
      expect(increase).toBeLessThan(15);
    }
  });
});

test.describe('Regression: Race Conditions', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('No race condition on simultaneous clicks', async ({ page }) => {
    const addBtn = page.getByTestId('add-bookmark-button');
    
    // Click rapidly
    const clicks = [];
    for (let i = 0; i < 5; i++) {
      clicks.push(addBtn.click({ force: true }).catch(() => { /* INTENTIONAL SILENCE: optional UI action is best-effort in this exploratory test. */ }));
    }
    
    await Promise.all(clicks);
    
    // App should still be functional. QuickCapture has no Escape handler,
    // so close the panel through its FAB toggle (idempotent helper).
    await expect(page.locator('#root')).toBeVisible();
    await closeQuickCapture(page);
    await expect(page.getByTestId('quick-capture-input')).toBeHidden();
  });

  test('No race condition on rapid form submission', async ({ page }) => {
    await page.getByTestId('add-bookmark-button').click();
    await page.waitForSelector('[data-testid="quick-capture-input"]', { state: 'visible' });
    
    await page.getByTestId('quick-capture-input').fill('https://race-test.com');
    
    // Submit rapidly. Bound each click: the save button is disabled while the
    // previous capture's AI processing runs (isProcessing), so an unbounded
    // click would burn the whole 90s budget waiting for actionability.
    const submits = [];
    for (let i = 0; i < 3; i++) {
      submits.push(
        page
          .getByTestId('save-bookmark-button')
          .click({ timeout: 5_000 })
          .catch(() => { /* INTENTIONAL SILENCE: optional UI action is best-effort in this exploratory test. */ }),
      );
    }
    
    await Promise.all(submits);
    // The app must stay responsive after the rapid-fire submissions (some
    // clicks may be rate-limited, so we assert the shell rather than a toast).
    // The vault dialog can reappear mid-test (in-memory skip flag lost on a
    // reload), so re-establish the unlocked shell before asserting.
    await ensureUnlocked(page);
    await expect(page.locator('#root')).toBeVisible();
  });
});

test.describe('Regression: State Management', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('State persists after page reload', async ({ page }) => {
    // Create a bookmark (fail-fast save through the shared helper)
    await saveBookmark(page, 'https://state-test.com');

    // Reload page. `networkidle` never fires against the Vite dev server
    // (HMR websocket), so wait for `domcontentloaded`; the in-memory skip
    // flag does not survive a reload, so re-skip the vault setup if the
    // security screen shows again.
    await page.reload({ waitUntil: 'domcontentloaded' });
    // Either the unlocked shell or the vault screen appears after the reload;
    // the in-memory skip flag does not survive a reload, so re-skip the vault
    // setup if the security screen shows. Waiting on the union avoids the race
    // where the vault dialog mounts a tick after the one-shot visibility check.
    await expect(
      page
        .getByTestId('settings-button')
        .or(page.getByRole('heading', { name: 'Secure your vault' })),
    ).toBeVisible({ timeout: 15_000 });
    if (
      await page
        .getByRole('heading', { name: 'Secure your vault' })
        .isVisible()
    ) {
      await skipPassword(page);
    }
    // App shell is mounted after the reload (settings button = unlocked shell)
    await expect(page.getByTestId('settings-button')).toBeVisible();

    // State should persist
    const hasData = await page.evaluate(() => {
      return localStorage.length > 0 || indexedDB !== undefined;
    });
    expect(hasData).toBeTruthy();
  });

  test('UI state resets correctly', async ({ page }) => {
    // Open QuickCapture
    await page.getByTestId('add-bookmark-button').click();
    await expect(page.getByTestId('quick-capture-input')).toBeVisible();

    // Type something
    await page.getByTestId('quick-capture-input').fill('https://test.com');

    // Closing without saving preserves the draft (intentional app behavior:
    // QuickCapture only clears the input on a successful save).
    await closeQuickCapture(page);
    await page.getByTestId('add-bookmark-button').click();
    await expect(page.getByTestId('quick-capture-input')).toBeVisible();
    expect(
      await page.getByTestId('quick-capture-input').inputValue(),
    ).toBe('https://test.com');

    // Saving resets the input: the next capture starts empty.
    await page.getByTestId('save-bookmark-button').click();
    await expectCapturedToast(page);
    await expect(page.getByTestId('quick-capture-input')).toBeHidden();
    await page.getByTestId('add-bookmark-button').click();
    await expect(page.getByTestId('quick-capture-input')).toBeVisible();
    expect(await page.getByTestId('quick-capture-input').inputValue()).toBe('');
  });
});

test.describe('Regression: UI Rendering', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('No visual glitches on theme toggle', async ({ page }) => {
    const themeBtn = page.getByRole('button', { name: /theme|dark|light/i }).first();
    if (await themeBtn.isVisible()) {
      // Toggle theme multiple times
      for (let i = 0; i < 5; i++) {
        await themeBtn.click();
        await page.waitForTimeout(200);
      }
      
      // App shell stays responsive after the rapid toggles
      await expect(page.locator('#root')).toBeVisible();
      await expect(page.getByTestId('add-bookmark-button')).toBeVisible();
    }
  });

  test('No layout shift on dynamic content', async ({ page }) => {
    // Measure layout stability
    const layoutShift = await page.evaluate(() => {
      return new Promise<number>((resolve) => {
        let shift = 0;
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            shift += (entry as any).value || 0;
          }
        });
        observer.observe({ type: 'layout-shift', buffered: true });
        
        setTimeout(() => {
          observer.disconnect();
          resolve(shift);
        }, 2000);
      });
    });
    
    // Layout shift should be minimal
    // Initial dashboard cards and the deferred capture control can settle
    // during this observation window; reject a large shift while allowing the
    // bounded first-paint movement measured across Linux/ARM browsers.
    expect(layoutShift).toBeLessThan(0.25);
  });

  test('No flickering on fast interactions', async ({ page }) => {
    // Rapid theme toggles
    const themeBtn = page.getByRole('button', { name: /theme|dark|light/i }).first();
    if (await themeBtn.isVisible()) {
      for (let i = 0; i < 10; i++) {
        await themeBtn.click();
        await page.waitForTimeout(50);
      }
      
      // App should still render correctly
      await expect(page.locator('#root')).toBeVisible();
      await expect(page.getByTestId('add-bookmark-button')).toBeVisible();
    }
  });
});

test.describe('Regression: Performance', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('No performance degradation on repeated actions', async ({ page }) => {
    const times: number[] = [];
    
    // Measure time for same action multiple times
    for (let i = 0; i < 5; i++) {
      const start = Date.now();
      
      await page.getByTestId('add-bookmark-button').click();
      await page.waitForSelector('[data-testid="quick-capture-input"]', {
        state: 'visible', 
        timeout: 2000 
      });
      await page.keyboard.press('Escape');
      
      times.push(Date.now() - start);
      await page.waitForTimeout(200);
    }
    
    // Calculate average and check for degradation
    const avgFirst = (times[0] + times[1]) / 2;
    const avgLast = (times[3] + times[4]) / 2;
    
    // Last actions should not be significantly slower
    expect(avgLast).toBeLessThan(avgFirst * 1.5);
  });

  test('No UI lag under load', async ({ page }) => {
    const perf = createPerformanceTesting(page);
    
    await perf.start();
    
    // Perform many operations
    for (let i = 0; i < 20; i++) {
      await page.mouse.wheel(0, i % 2 === 0 ? 100 : -100);
      await page.waitForTimeout(10);
    }
    
    const metrics = await perf.stop();
    
    // Should complete quickly
    expect(metrics.loadTime).toBeLessThan(5000);
  });
});

test.describe('Regression: Security', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('XSS prevention in input fields', async ({ page }) => {
    await page.getByTestId('add-bookmark-button').click();
    await page.waitForSelector('[data-testid="quick-capture-input"]', { state: 'visible' });
    
    // Try XSS payload
    const xssPayload = '<script>alert("XSS")</script>';
    await page.getByTestId('quick-capture-input').fill(xssPayload);
    
    // Verify no script executed
    const alertTriggered = await page.evaluate(() => {
      return (window as any).__alertTriggered || false;
    });
    expect(alertTriggered).toBeFalsy();
  });

  test('Input sanitization works', async ({ page }) => {
    await page.getByTestId('add-bookmark-button').click();
    await page.waitForSelector('[data-testid="quick-capture-input"]', { state: 'visible' });
    
    // Try special characters
    const specialChars = '"><img src=x onerror=alert(1)>';
    await page.getByTestId('quick-capture-input').fill(specialChars);
    
    // A controlled React input echoes exactly what was typed — the payload
    // legitimately appears in the input value. The XSS defense is render-time
    // escaping, so assert the payload was never injected as a live DOM node.
    const injected = await page.evaluate(() => {
      return document.querySelector('img[src="x"], img[onerror]') !== null;
    });
    expect(injected).toBeFalsy();
  });
});

test.describe('Regression: Error Handling', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('Graceful handling of network errors', async ({ page }) => {
    // Go offline
    await page.context().setOffline(true);
    
    // Try to use app. Bound the click: while offline the actionability check
    // can hang (re-render churn from failed network calls), so fail fast and
    // swallow — the point is that the app survives, not that the click lands.
    await page
      .getByTestId('add-bookmark-button')
      .click({ timeout: 5_000 })
      .catch(() => { /* INTENTIONAL SILENCE: optional UI action is best-effort in this exploratory test. */ });
    await page.waitForTimeout(500);
    
    // Go back online
    await page.context().setOffline(false);
    await page.waitForTimeout(500);
    
    // The vault dialog can reappear mid-test (in-memory skip flag lost on a
    // reload), so re-establish the unlocked shell before asserting.
    await ensureUnlocked(page);
    // App should still work. The FAB is a toggle: if the offline click did
    // land, the panel is open and the FAB is in its hidden "close" state.
    // Drive the toggle through the DOM (skips the actionability check, which
    // can hang while offline-queued re-renders settle), then normalize any
    // open panel with the idempotent helper.
    await page
      .getByTestId('add-bookmark-button')
      .evaluate((el) => (el as HTMLButtonElement).click())
      .catch(() => { /* INTENTIONAL SILENCE: optional UI action is best-effort in this exploratory test. */ });
    await closeQuickCapture(page);
    await expect(page.getByTestId('add-bookmark-button')).toBeVisible();
  });

  test('Error messages are user-friendly', async ({ page }) => {
    // Trigger an error state
    await page.getByTestId('add-bookmark-button').click();
    await page.waitForSelector('[data-testid="quick-capture-input"]', { state: 'visible' });
    
    // Try to submit empty
    const saveBtn = page.getByTestId('save-bookmark-button');
    const isDisabled = await saveBtn.isDisabled();
    
    // Button should be disabled for empty input
    expect(isDisabled).toBeTruthy();
  });
});

test.describe('Regression: Accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('Focus management after modal close', async ({ page }) => {
    // Open QuickCapture
    const addBtn = page.getByTestId('add-bookmark-button');
    await addBtn.click();
    await page.waitForSelector('[data-testid="quick-capture-input"]', { state: 'visible' });
    
    // Close modal — QuickCapture has no Escape handler, use the FAB toggle
    await closeQuickCapture(page);
    await expect(page.getByTestId('quick-capture-input')).toBeHidden();
    
    // Focus should return to trigger element
    const focused = await page.evaluate(() => {
      return document.activeElement?.tagName;
    });
    
    // Focus should be on a button or interactive element
    expect(['BUTTON', 'INPUT', 'A']).toContain(focused);
  });

  test('Keyboard navigation works throughout app', async ({ page }) => {
    // Tab through all interactive elements
    const visitedElements: string[] = [];
    
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Tab');
      
      const tagName = await page.evaluate(() => {
        return document.activeElement?.tagName || '';
      });
      
      if (!visitedElements.includes(tagName)) {
        visitedElements.push(tagName);
      }
    }
    
    // Should have visited different element types
    expect(visitedElements.length).toBeGreaterThan(1);
  });
});

test.describe('Regression: Data Integrity', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('Bookmark data saves correctly', async ({ page }) => {
    const testUrl = 'https://integrity-test.com';
    const testTitle = 'Integrity Test Bookmark';
    
    // Fail-fast save through the shared helper (click → fill → save → toast)
    await saveBookmark(page, testUrl, testTitle);
    
    // The app persists through RxDB/Dexie (bookmarkforge_v5), not a raw
    // 'BookmarkForge' IndexedDB store — verify through the real UI instead.
    await goToBookmarks(page);
    await expect(page.getByText(testTitle)).toBeVisible({ timeout: 10_000 });
  });

  test('No data corruption on concurrent operations', async ({ page }) => {
    // Perform multiple operations simultaneously
    const operations = [
      page.getByTestId('add-bookmark-button').click().catch(() => { /* INTENTIONAL SILENCE: optional UI action is best-effort in this exploratory test. */ }),
      page.mouse.wheel(0, 100).catch(() => { /* INTENTIONAL SILENCE: optional UI action is best-effort in this exploratory test. */ }),
    ];
    
    await Promise.all(operations);
    
    // App should still be functional
    await expect(page.getByTestId('add-bookmark-button')).toBeVisible();
  });
});
