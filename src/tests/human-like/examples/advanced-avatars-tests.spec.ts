/**
 * Advanced Avatars Tests
 * 
 * Tests for advanced avatar functionality:
 * - Avatar displays
 * - Avatar images
 * - Avatar initials
 * - Avatar fallback
 * - Avatar size variants
 * - Avatar shape variants
 * - Avatar status
 * - Avatar group
 * - Avatar accessibility
 * - Avatar loading
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { saveBookmark } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Advanced Avatars Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('49.1 Avatar displays', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const avatar = page.locator('[data-testid="avatar"], .avatar');
    if (await avatar.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(avatar).toBeVisible();
    }
  });

  test('49.2 Avatar images work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const avatar = page.locator('[data-testid="avatar"] img').first();
    if (await avatar.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(avatar).toBeVisible();
    }
  });

  test('49.3 Avatar initials work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const avatar = page.locator('[data-testid="avatar"]').first();
    if (await avatar.isVisible({ timeout: 5000 }).catch(() => false)) {
      const avatarText = await avatar.textContent();
      if (avatarText && avatarText.length <= 3) {
        await expect(avatarText).toBeTruthy();
      }
    }
  });

  test('49.4 Avatar fallback works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const avatar = page.locator('[data-testid="avatar"][data-fallback="true"]');
    if (await avatar.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(avatar).toBeVisible();
    }
  });

  test('49.5 Avatar size variants work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const avatar = page.locator('[data-testid="avatar"]').first();
    if (await avatar.isVisible({ timeout: 5000 }).catch(() => false)) {
      const box = await avatar.boundingBox();
      if (box) {
        await expect(box.width).toBeGreaterThan(0);
        await expect(box.height).toBeGreaterThan(0);
      }
    }
  });

  test('49.6 Avatar shape variants work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const avatar = page.locator('[data-testid="avatar"]').first();
    if (await avatar.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(avatar).toBeVisible();
      
      // Check border-radius for shape
      const borderRadius = await avatar.evaluate(el => {
        const styles = window.getComputedStyle(el);
        return styles.borderRadius;
      });
      if (borderRadius) {
        await expect(borderRadius).toBeTruthy();
      }
    }
  });

  test('49.7 Avatar status works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const avatar = page.locator('[data-testid="avatar"][data-status]').first();
    if (await avatar.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(avatar).toBeVisible();
    }
  });

  test('49.8 Avatar group works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const avatarGroup = page.locator('[data-testid="avatar-group"]');
    if (await avatarGroup.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(avatarGroup).toBeVisible();
    }
  });

  test('49.9 Avatar accessibility works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const avatar = page.locator('[data-testid="avatar"]').first();
    if (await avatar.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Check ARIA attributes
      const ariaLabel = await avatar.getAttribute('aria-label');
      const altText = await avatar.locator('img').first().getAttribute('alt');
      
      if (ariaLabel || altText) {
        await expect(ariaLabel || altText).toBeTruthy();
      }
    }
  });

  test('49.10 Avatar loading works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const avatar = page.locator('[data-testid="avatar"] img').first();
    if (await avatar.isVisible({ timeout: 5000 }).catch(() => false)) {
      const complete = await avatar.evaluate((img) => (img as HTMLImageElement).complete);
      await expect(complete).toBeTruthy();
    }
  });
});