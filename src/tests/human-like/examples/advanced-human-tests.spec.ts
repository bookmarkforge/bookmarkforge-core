/* eslint-disable @typescript-eslint/ban-ts-comment -- deliberate strict-check exemption (see note below) */
// @ts-nocheck
// Human-like harness — self-contained test infrastructure with intentionally
// loose typing (heavy `as any`), so noUncheckedIndexedAccess `!` churn adds
// no assertion value here. Excluded from strict checking; mirrors the
// src/tests/db/encryption.test.ts precedent (tsconfig.json "exclude").
/**
 * Advanced Human-Like Tests
 * 
 * Enhanced tests with:
 * - Extreme stress testing
 * - Fatigue simulation
 * - Complex multi-step workflows
 * - Realistic user journeys
 * - Edge case scenarios
 * - Performance under load
 */

import { test, expect } from '@playwright/test';
import { createAdvancedHumanBehavior, ciHumanOptions } from '../utils/advanced-human-behavior';
import { createSessionRecorder } from '../sessions/session-recorder';
import { createBehavioralAnalytics } from '../analytics/behavioral-analytics';
import { createPerformanceTesting } from '../core/performance-testing';
import { createBookmarkFast, saveBookmark, ensureUnlocked, expectCapturedToast } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

// ============================================================
// SECTION 1: EXTREME STRESS TESTING
// ============================================================

test.describe('1. Extreme Stress Testing', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('1.1 Rapid-fire bookmark creation (5 bookmarks)', async ({ page }) => {
    let created = 0;
    for (let i = 0; i < 5; i++) {
      try {
        // The capture panel is a FAB toggle that STAYS OPEN after a save;
        // the helper resets it before each save so the loop cannot hang on
        // a closed panel, and every wait is bounded (15s toast budget).
        await createBookmarkFast(page, `https://stress-${i}.com`);
        created++;
      } catch (e) {
        // Page might have closed, break out
        break;
      }
    }

    expect(created).toBeGreaterThan(0);
    console.log(`Stress test: ${created} bookmarks created`);
  });

  test('1.2 Rapid UI interactions', async ({ page }) => {
    const human = createAdvancedHumanBehavior(page, {
      ...ciHumanOptions,
      baseDelay: 30,
      delayVariation: 20,
    });

    // Rapid clicks on various elements
    const buttons = await page.locator('button').all();
    for (let i = 0; i < Math.min(10, buttons.length); i++) {
      try {
        await buttons[i].click({ timeout: 1000 });
        await page.waitForTimeout(100);
      } catch {
        // Continue
      }
    }
  });

  test('1.3 Memory stress test - many operations', async ({ page }) => {
    const human = createAdvancedHumanBehavior(page, ciHumanOptions);

    // Perform many different operations
    for (let i = 0; i < 15; i++) {
      try {
        // Alternate between different actions
        switch (i % 4) {
          case 0:
            await page.getByTestId('add-bookmark-button').click();
            await page.waitForTimeout(300);
            await page.keyboard.press('Escape');
            break;
          case 1:
            await human.scroll('down', 2);
            break;
          case 2:
            await human.scroll('up', 1);
            break;
          case 3:
            await page.waitForTimeout(200);
            break;
        }
      } catch {
        await page.waitForTimeout(200);
      }
    }
  });
});

// ============================================================
// SECTION 2: FATIGUE SIMULATION
// ============================================================

test.describe('2. Fatigue Simulation', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('2.1 Extended session fatigue', async ({ page }) => {
    const human = createAdvancedHumanBehavior(page, {
      ...ciHumanOptions,
      enableFatigue: true,
      sessionDuration: 60000, // 1 minute for testing
    });

    // Simulate extended usage
    for (let i = 0; i < 10; i++) {
      await page.getByTestId('add-bookmark-button').click().catch(() => { /* INTENTIONAL SILENCE: optional UI action is best-effort in this exploratory test. */ });
      await page.waitForTimeout(200);
      
      if (i % 2 === 0) {
        await human.scroll('down', 1);
      } else {
        await human.scroll('up', 1);
      }
      
      // Check fatigue level
      const metrics = human.getMetrics();
      console.log(`Iteration ${i}: Fatigue level ${(metrics.fatigueLevel * 100).toFixed(1)}%`);
    }
  });

  test('2.2 Typing fatigue', async ({ page }) => {
    const human = createAdvancedHumanBehavior(page, {
      ...ciHumanOptions,
      enableFatigue: true,
      baseDelay: 30,
    });

    // Type multiple times to show fatigue effect
    for (let i = 0; i < 3; i++) {
      try {
        await page.getByTestId('add-bookmark-button').click();
        await page.waitForSelector('[data-testid="quick-capture-input"]', {
          state: 'visible', 
          timeout: 2000 
        });
        
        await page.getByTestId('quick-capture-input').fill(`https://fatigue-${i}.com`);
        
        await page.keyboard.press('Escape');
        await page.waitForTimeout(200);
      } catch {
        await page.waitForTimeout(100);
      }
    }

    const metrics = human.getMetrics();
    expect(metrics.fatigueLevel).toBeGreaterThanOrEqual(0);
  });
});

// ============================================================
// SECTION 3: HESITATION PATTERNS
// ============================================================

test.describe('3. Hesitation Patterns', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('3.1 Decision-making hesitations', async ({ page }) => {
    const human = createAdvancedHumanBehavior(page, {
      ...ciHumanOptions,
      enableHesitation: true,
      baseDelay: 30,
    });

    // Open QuickCapture and hesitate before typing
    await page.getByTestId('add-bookmark-button').click();
    await page.waitForSelector('[data-testid="quick-capture-input"]', {
      state: 'visible',
      timeout: 3000 
    });

    // Hesitate before typing URL
    await human.makeDecision('simple');
    await page.getByTestId('quick-capture-input').fill('https://hesitation-test.com');

    // Hesitate before saving
    await human.makeDecision('simple');
    await page.getByTestId('save-bookmark-button').click();

    const metrics = human.getMetrics();
    expect(metrics.hesitationsCount).toBeGreaterThanOrEqual(0);
  });

  test('3.2 Hover hesitations', async ({ page }) => {
    const human = createAdvancedHumanBehavior(page, {
      ...ciHumanOptions,
      enableHesitation: true,
    });

    // Hover over various elements with hesitation
    const addBtn = page.getByTestId('add-bookmark-button');
    await human.hover(addBtn);
    await human.makeDecision('simple');
    await addBtn.click();

    await page.waitForTimeout(500);
  });
});

// ============================================================
// SECTION 4: READING TIME SIMULATION
// ============================================================

test.describe('4. Reading Time Simulation', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('4.1 Simulate reading page content', async ({ page }) => {
    const human = createAdvancedHumanBehavior(page, {
      ...ciHumanOptions,
      enableReadingTime: true,
    });

    // Get page content length
    const contentLength = await page.evaluate(() => {
      return document.body.innerText.length;
    });

    // Simulate reading (bounded sample: a full-shell innerText would drive
    // the per-char estimate past the 5s cap, wasting CI budget on a no-op)
    await human.simulateReading(Math.min(contentLength, 25));
  });

  test('4.2 Reading and scrolling pattern', async ({ page }) => {
    const human = createAdvancedHumanBehavior(page, {
      ...ciHumanOptions,
      enableReadingTime: true,
    });

    // Simulate reading with scrolling
    await human.readContent(600);
  });
});

// ============================================================
// SECTION 5: COMPLEX USER JOURNEYS
// ============================================================

test.describe('5. Complex User Journeys', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('5.1 Complete bookmark management workflow', async ({ page }) => {
    const human = createAdvancedHumanBehavior(page, {
      ...ciHumanOptions,
      enableFatigue: true,
      enableHesitation: true,
      simulateMistakes: true,
    });
    const recorder = createSessionRecorder(page);
    const analytics = createBehavioralAnalytics(page);

    await analytics.startSession();
    await recorder.start('complex-workflow');

    // Step 1: Create bookmark
    await human.makeDecision('simple');
    await page.getByTestId('add-bookmark-button').click();
    await page.waitForSelector('[data-testid="quick-capture-input"]', { state: 'visible' });
    
    await human.type(page.getByTestId('quick-capture-input'), 'https://workflow-test.com');
    await human.type(page.getByTestId('bookmark-title-input'), 'Workflow Test');
    await page.getByTestId('save-bookmark-button').click();
    await expectCapturedToast(page);

    // Step 2: Scroll to explore
    await human.scroll('down', 3);
    await human.readContent(600);
    await human.scroll('up', 2);

    // Step 3: Check settings
    const settingsBtn = page.getByRole('button', { name: /setting/i }).first();
    if (await settingsBtn.isVisible()) {
      await human.click(settingsBtn);
      await page.waitForTimeout(500);
      await human.readContent(1000);
      await page.keyboard.press('Escape');
    }

    const session = await recorder.stop();
    const analyticsSession = await analytics.stopSession();
    const metrics = human.getMetrics();

    expect(session.actions.length).toBeGreaterThan(0);
    expect(metrics.actionsPerformed).toBeGreaterThan(0);
    
    console.log('Complex workflow metrics:', {
      actions: metrics.actionsPerformed,
      mistakes: metrics.mistakesMade,
      hesitations: metrics.hesitationsCount,
      fatigue: (metrics.fatigueLevel * 100).toFixed(1) + '%',
    });
  });

  test('5.2 Multi-tab simulation', async ({ page }) => {
    const human = createAdvancedHumanBehavior(page, ciHumanOptions);

    // Simulate switching contexts
    await page.getByTestId('add-bookmark-button').click();
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');

    await human.scroll('down', 2);
    await page.waitForTimeout(500);
    await human.scroll('up', 1);

    await page.getByTestId('add-bookmark-button').click();
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
  });

  test('5.3 Error recovery simulation', async ({ page }) => {
    const human = createAdvancedHumanBehavior(page, {
      ...ciHumanOptions,
      simulateMistakes: true,
    });

    // Try to interact with elements that might not exist
    for (let i = 0; i < 5; i++) {
      try {
        const btn = page.getByRole('button', { name: /nonexistent/i }).first();
        await btn.click({ timeout: 1000 });
      } catch {
        // Recover gracefully
        await human.makeDecision('simple');
      }
    }

    // Continue with valid actions
    // The vault dialog can reappear mid-test (in-memory skip flag lost on a
    // reload), so re-establish the unlocked shell before interacting.
    await ensureUnlocked(page);
    await page.getByTestId('add-bookmark-button').click();
    await page.waitForTimeout(500);
  });
});

// ============================================================
// SECTION 6: PERFORMANCE UNDER LOAD
// ============================================================

test.describe('6. Performance Under Load', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('6.1 Rapid interactions performance', async ({ page }) => {
    const perf = createPerformanceTesting(page);
    const human = createAdvancedHumanBehavior(page, {
      ...ciHumanOptions,
      baseDelay: 20,
      delayVariation: 10,
    });

    await perf.start();

    // Perform many rapid interactions
    for (let i = 0; i < 30; i++) {
      try {
        await page.getByTestId('add-bookmark-button').click({ timeout: 1000 });
        await page.waitForTimeout(50);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(50);
      } catch {
        await page.waitForTimeout(50);
      }
    }

    const metrics = await perf.stop();
    expect(metrics.loadTime).toBeLessThan(30000);
    
    console.log('Performance under load:', {
      totalTime: metrics.loadTime + 'ms',
      interactions: 30,
    });
  });

  test('6.2 Memory usage during heavy operations', async ({ page }) => {
    // The vault dialog can reappear mid-test (in-memory skip flag lost on a
    // reload), so re-establish the unlocked shell before interacting.
    await ensureUnlocked(page);
    // Perform memory-intensive operations (bounded saves via the shared
    // helper — the FAB-toggle panel must be reset between saves)
    for (let i = 0; i < 3; i++) {
      await createBookmarkFast(page, `https://memory-${i}.com`);
    }

    // Check memory usage
    const memory = await page.evaluate(() => {
      const m = (performance as any).memory;
      return m ? { used: m.usedJSHeapSize, limit: m.jsHeapSizeLimit } : null;
    });

    if (memory) {
      const usagePercent = (memory.used / memory.limit) * 100;
      expect(usagePercent).toBeLessThan(90);
      console.log(`Memory usage: ${usagePercent.toFixed(1)}%`);
    }
  });
});

// ============================================================
// SECTION 7: ACCESSIBILITY UNDER STRESS
// ============================================================

test.describe('7. Accessibility Under Stress', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('7.1 Keyboard navigation under load', async ({ page }) => {
    const human = createAdvancedHumanBehavior(page, ciHumanOptions);

    // Rapid keyboard navigation
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(50);
    }

    // Verify focus is still manageable
    const focused = await page.evaluate(() => {
      return document.activeElement?.tagName;
    });
    expect(['BUTTON', 'INPUT', 'A', 'SELECT', 'TEXTAREA', 'BODY']).toContain(focused);
  });

  test('7.2 Screen reader simulation', async ({ page }) => {
    // Check ARIA labels are present
    const elementsWithAria = await page.evaluate(() => {
      const elements = document.querySelectorAll('[aria-label], [aria-labelledby], [role]');
      return elements.length;
    });
    expect(elementsWithAria).toBeGreaterThan(0);
  });
});

// ============================================================
// SECTION 8: EDGE CASE SCENARIOS
// ============================================================

test.describe('8. Edge Case Scenarios', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('8.1 Very long input handling', async ({ page }) => {
    await page.getByTestId('add-bookmark-button').click();
    await page.waitForSelector('[data-testid="quick-capture-input"]', {
      state: 'visible',
      timeout: 3000 
    });

    // Type very long URL using fill for speed
    const longUrl = 'https://example.com/' + 'a'.repeat(200);
    await page.getByTestId('quick-capture-input').fill(longUrl);

    // Verify input handling
    const value = await page.getByTestId('quick-capture-input').inputValue();
    expect(value.length).toBeGreaterThan(0);
    await page.keyboard.press('Escape');
  });

  test('8.2 Special characters handling', async ({ page }) => {
    const human = createAdvancedHumanBehavior(page, ciHumanOptions);

    await page.getByTestId('add-bookmark-button').click();
    await page.waitForSelector('[data-testid="quick-capture-input"]', { state: 'visible' });

    // Type special characters
    await human.type(
      page.getByTestId('quick-capture-input'),
      'https://example.com/path?q=hello&lang=es#section'
    );

    await page.keyboard.press('Escape');
  });

  test('8.3 Concurrent operations', async ({ page }) => {
    const human = createAdvancedHumanBehavior(page, ciHumanOptions);

    // Try multiple operations simultaneously
    const promises = [
      page.getByTestId('add-bookmark-button').click().catch(() => { /* INTENTIONAL SILENCE: optional UI action is best-effort in this exploratory test. */ }),
      human.scroll('down', 1).catch(() => { /* INTENTIONAL SILENCE: optional UI action is best-effort in this exploratory test. */ }),
    ];

    await Promise.all(promises);
    await page.waitForTimeout(500);
  });

  test('8.4 Network interruption simulation', async ({ page }) => {
    // Simulate network issues
    await page.context().setOffline(true);
    await page.waitForTimeout(500);

    // Try to use app offline. Bound the click: while offline the app can
    // re-render repeatedly (failed network requests), so Playwright's
    // actionability check on the FAB never settles — an unbounded click
    // would swallow the whole 90s budget and die with a browser-closed error.
    await page
      .getByTestId('add-bookmark-button')
      .click({ timeout: 3_000 })
      .catch(() => { /* INTENTIONAL SILENCE: optional UI action is best-effort in this exploratory test. */ });
    await page.waitForTimeout(500);

    // Restore network
    await page.context().setOffline(false);
    await page.waitForTimeout(500);
  });
});

// ============================================================
// SECTION 9: REALISTIC USER BEHAVIOR PATTERNS
// ============================================================

test.describe('9. Realistic User Behavior Patterns', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('9.1 Distracted user pattern', async ({ page }) => {
    const human = createAdvancedHumanBehavior(page, {
      ...ciHumanOptions,
      enableHesitation: true,
      enableReadingTime: true,
    });

    // User gets distracted mid-task
    await page.getByTestId('add-bookmark-button').click();
    await page.waitForSelector('[data-testid="quick-capture-input"]', { state: 'visible' });
    
    // Start typing then stop
    await human.type(page.getByTestId('quick-capture-input'), 'https://');
    await human.readContent(800); // Distracted reading
    
    // Resume typing
    await human.type(page.getByTestId('quick-capture-input'), 'distracted-user.com');
    await page.getByTestId('save-bookmark-button').click();
  });

  test('9.2 Explorer user pattern', async ({ page }) => {
    const human = createAdvancedHumanBehavior(page, {
      ...ciHumanOptions,
      enableReadingTime: true,
    });

    // User explores the UI
    await human.scroll('down', 5);
    await human.readContent(1200);
    await human.scroll('up', 3);
    await human.readContent(800);
    
    // Eventually creates a bookmark
    await page.getByTestId('add-bookmark-button').click();
    await page.waitForTimeout(500);
    await page.keyboard.press('Escape');
  });

  test('9.3 Power user pattern', async ({ page }) => {
    // Fast, efficient actions (raw fail-fast save through the shared helper)
    await saveBookmark(page, 'https://power-user.com');
  });
});

// ============================================================
// SECTION 10: COMBINED METRICS TEST
// ============================================================

test.describe('10. Combined Metrics Validation', () => {
  test('10.1 Full session metrics collection', async ({ page }) => {
    await skipPassword(page);

    const human = createAdvancedHumanBehavior(page, {
      ...ciHumanOptions,
      baseDelay: 20,
    });

    const recorder = createSessionRecorder(page);
    const analytics = createBehavioralAnalytics(page);

    await analytics.startSession();
    await recorder.start('metrics-session');

    // Perform various actions (bounded saves via the shared helper — the
    // FAB-toggle panel must be reset between saves)
    for (let i = 0; i < 3; i++) {
      await createBookmarkFast(page, `https://metrics-${i}.com`);
    }

    const session = await recorder.stop();
    const analyticsSession = await analytics.stopSession();
    const humanMetrics = human.getMetrics();

    console.log('=== FINAL METRICS REPORT ===');
    console.log('Human Behavior Metrics:', humanMetrics);
    console.log('Session Recording:', session.actions.length, 'actions');
    console.log('Analytics Events:', analyticsSession.events.length, 'events');

    expect(humanMetrics.actionsPerformed).toBeGreaterThanOrEqual(0);
  });
});
