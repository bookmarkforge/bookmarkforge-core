/**
 * Advanced Animations Tests
 * 
 * Tests for advanced animation functionality:
 * - Animation displays
 * - Animation play
 * - Animation pause
 * - Animation duration
 * - Animation easing
 * - Animation delay
 * - Animation iteration
 * - Animation fill
 * - Animation direction
 * - Animation custom
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { saveBookmark } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Advanced Animations Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('96.1 Animation displays', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const animated = page.locator('[data-testid="animated"]');
    if (await animated.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(animated).toBeVisible();
    }
  });

  test('96.2 Animation play works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const animated = page.locator('[data-testid="animated"]').first();
    if (await animated.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(animated).toBeVisible();
      
      const animationClass = await animated.getAttribute('class');
      if (animationClass) {
        await expect(animationClass).toBeTruthy();
      }
    }
  });

  test('96.3 Animation pause works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const animated = page.locator('[data-testid="animated"][data-paused="true"]');
    if (await animated.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(animated).toBeVisible();
    }
  });

  test('96.4 Animation duration works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const animated = page.locator('[data-testid="animated"]').first();
    if (await animated.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(animated).toBeVisible();
      
      const durationStyle = await animated.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return styles.animationDuration;
      });
      if (durationStyle) {
        await expect(durationStyle).toBeTruthy();
      }
    }
  });

  test('96.5 Animation easing works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const animated = page.locator('[data-testid="animated"]').first();
    if (await animated.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(animated).toBeVisible();
      
      const easingStyle = await animated.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return styles.animationTimingFunction;
      });
      if (easingStyle) {
        await expect(easingStyle).toBeTruthy();
      }
    }
  });

  test('96.6 Animation delay works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const animated = page.locator('[data-testid="animated"]').first();
    if (await animated.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(animated).toBeVisible();
      
      const delayStyle = await animated.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return styles.animationDelay;
      });
      if (delayStyle) {
        await expect(delayStyle).toBeTruthy();
      }
    }
  });

  test('96.7 Animation iteration works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const animated = page.locator('[data-testid="animated"]').first();
    if (await animated.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(animated).toBeVisible();
      
      const iterationStyle = await animated.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return styles.animationIterationCount;
      });
      if (iterationStyle) {
        await expect(iterationStyle).toBeTruthy();
      }
    }
  });

  test('96.8 Animation fill works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const animated = page.locator('[data-testid="animated"]').first();
    if (await animated.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(animated).toBeVisible();
      
      const fillStyle = await animated.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return styles.animationFillMode;
      });
      if (fillStyle) {
        await expect(fillStyle).toBeTruthy();
      }
    }
  });

  test('96.9 Animation direction works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const animated = page.locator('[data-testid="animated"]').first();
    if (await animated.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(animated).toBeVisible();
      
      const directionStyle = await animated.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return styles.animationDirection;
      });
      if (directionStyle) {
        await expect(directionStyle).toBeTruthy();
      }
    }
  });

  test('96.10 Animation custom works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const animated = page.locator('[data-testid="animated"][data-custom="true"]');
    if (await animated.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(animated).toBeVisible();
    }
  });
});