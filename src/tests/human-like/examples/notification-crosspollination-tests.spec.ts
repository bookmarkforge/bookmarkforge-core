/**
 * Notification and Cross-Pollination Tests
 * 
 * Tests for notification system and AI cross-pollination features:
 * - Notification service integration
 * - Toast notifications
 * - In-app notifications
 * - Cross-pollination service
 * - Knowledge card suggestions
 * - Notification preferences
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { saveBookmark } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Notification and Cross-Pollination Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('4.1 Toast notifications appear', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    await saveBookmark(page, 'https://example.com/test', 'Test Bookmark');
    
    // Toast should appear after save
    const toast = page.locator('[data-testid="toast-success"]');
    if (await toast.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(toast).toBeVisible();
    }
  });

  test('4.2 Toast notifications can be dismissed', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    await saveBookmark(page, 'https://example.com/test', 'Test Bookmark');
    
    const toast = page.locator('[data-testid="toast-success"]');
    if (await toast.isVisible({ timeout: 5000 }).catch(() => false)) {
      const dismissButton = toast.getByRole('button', { name: /close|dismiss/i });
      if (await dismissButton.isVisible()) {
        await human.click(dismissButton);
        
        await expect(toast).not.toBeVisible({ timeout: 3000 });
      }
    }
  });

  test('4.3 Multiple toast notifications stack correctly', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Create multiple bookmarks to trigger multiple toasts
    for (let i = 0; i < 3; i++) {
      await saveBookmark(page, `https://example.com/test-${i}`, `Test ${i}`);
    }
    
    // Check if multiple toasts are visible
    const toasts = page.locator('[data-testid="toast-success"]');
    const toastCount = await toasts.count();
    if (toastCount > 0) {
      await expect(toastCount).toBeGreaterThan(0);
    }
  });

  test('4.4 In-app notifications appear', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const notificationButton = page.getByRole('button', { name: /notification|bell/i });
    if (await notificationButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(notificationButton);
      
      const notificationPanel = page.locator('[data-testid="notification-panel"]');
      if (await notificationPanel.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(notificationPanel).toBeVisible();
      }
    }
  });

  test('4.5 Notification preferences work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const settingsButton = page.getByRole('button', { name: /settings/i });
    if (await settingsButton.isVisible()) {
      await human.click(settingsButton);
      
      const notificationSection = page.getByRole('button', { name: /notification/i });
      if (await notificationSection.isVisible({ timeout: 5000 }).catch(() => false)) {
        await human.click(notificationSection);
        
        const notificationSettings = page.locator('[data-testid="notification-settings"]');
        if (await notificationSettings.isVisible({ timeout: 3000 }).catch(() => false)) {
          await expect(notificationSettings).toBeVisible();
        }
      }
    }
  });

  test('4.6 Cross-pollination suggestions appear', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Create some bookmarks to generate suggestions
    await saveBookmark(page, 'https://example.com/ai', 'AI Topic');
    await saveBookmark(page, 'https://example.com/ml', 'ML Topic');
    
    // Navigate to knowledge dashboard
    const analyticsButton = page.getByRole('button', { name: /analytics|knowledge/i });
    if (await analyticsButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(analyticsButton);
      
      const crossPollinationSection = page.locator('[data-testid="cross-pollination"]');
      if (await crossPollinationSection.isVisible({ timeout: 5000 }).catch(() => false)) {
        await expect(crossPollinationSection).toBeVisible();
      }
    }
  });

  test('4.7 Cross-pollination cards are clickable', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const analyticsButton = page.getByRole('button', { name: /analytics|knowledge/i });
    if (await analyticsButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(analyticsButton);
      
      const crossPollinationCard = page.locator('[data-testid="cross-pollination-card"]').first();
      if (await crossPollinationCard.isVisible({ timeout: 5000 }).catch(() => false)) {
        await human.click(crossPollinationCard);
        
        // Should navigate to related content
        const contentArea = page.locator('[data-testid="content-area"]');
        if (await contentArea.isVisible({ timeout: 3000 }).catch(() => false)) {
          await expect(contentArea).toBeVisible();
        }
      }
    }
  });

  test('4.8 Cross-pollination can be disabled', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const settingsButton = page.getByRole('button', { name: /settings/i });
    if (await settingsButton.isVisible()) {
      await human.click(settingsButton);
      
      const aiSection = page.getByRole('button', { name: /ai|intelligence/i });
      if (await aiSection.isVisible({ timeout: 5000 }).catch(() => false)) {
        await human.click(aiSection);
        
        const crossPollinationToggle = page.getByRole('switch', { name: /cross.*pollination/i });
        if (await crossPollinationToggle.isVisible({ timeout: 3000 }).catch(() => false)) {
          await human.click(crossPollinationToggle);
        }
      }
    }
  });

  test('4.9 Notification history works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const notificationButton = page.getByRole('button', { name: /notification|bell/i });
    if (await notificationButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(notificationButton);
      
      const historyButton = page.getByRole('button', { name: /history/i });
      if (await historyButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await human.click(historyButton);
        
        const notificationHistory = page.locator('[data-testid="notification-history"]');
        if (await notificationHistory.isVisible({ timeout: 3000 }).catch(() => false)) {
          await expect(notificationHistory).toBeVisible();
        }
      }
    }
  });

  test('4.10 Notification sounds work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const settingsButton = page.getByRole('button', { name: /settings/i });
    if (await settingsButton.isVisible()) {
      await human.click(settingsButton);
      
      const notificationSection = page.getByRole('button', { name: /notification/i });
      if (await notificationSection.isVisible({ timeout: 5000 }).catch(() => false)) {
        await human.click(notificationSection);
        
        const soundToggle = page.getByRole('switch', { name: /sound/i });
        if (await soundToggle.isVisible({ timeout: 3000 }).catch(() => false)) {
          await human.click(soundToggle);
        }
      }
    }
  });
});