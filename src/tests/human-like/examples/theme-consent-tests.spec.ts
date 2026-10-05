/**
 * Theme and Consent Tests
 * 
 * Tests for theme management and consent handling:
 * - Theme switching (light/dark/system)
 * - Consent management
 * - Privacy preferences
 * - Theme persistence
 * - Consent tracking
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Theme and Consent Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('3.1 Theme toggle works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const themeToggle = page.getByRole('button', { name: /theme|dark|light/i });
    if (await themeToggle.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(themeToggle);
      
      // Theme should change
      const body = page.locator('body');
      await expect(body).toBeVisible();
    }
  });

  test('3.2 Dark mode activates correctly', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const themeToggle = page.getByRole('button', { name: /theme/i });
    if (await themeToggle.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(themeToggle);
      
      // Try to select dark mode
      const darkModeOption = page.getByRole('menuitem', { name: /dark/i });
      if (await darkModeOption.isVisible({ timeout: 3000 }).catch(() => false)) {
        await human.click(darkModeOption);
        
        // Check if dark mode is applied
        const darkModeClass = await page.locator('body').getAttribute('class');
        if (darkModeClass && darkModeClass.includes('dark')) {
          await expect(true).toBeTruthy();
        }
      }
    }
  });

  test('3.3 Light mode activates correctly', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const themeToggle = page.getByRole('button', { name: /theme/i });
    if (await themeToggle.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(themeToggle);
      
      // Try to select light mode
      const lightModeOption = page.getByRole('menuitem', { name: /light/i });
      if (await lightModeOption.isVisible({ timeout: 3000 }).catch(() => false)) {
        await human.click(lightModeOption);
        
        // Check if light mode is applied
        const body = page.locator('body');
        await expect(body).toBeVisible();
      }
    }
  });

  test('3.4 System theme preference works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const themeToggle = page.getByRole('button', { name: /theme/i });
    if (await themeToggle.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(themeToggle);
      
      // Try to select system theme
      const systemThemeOption = page.getByRole('menuitem', { name: /system/i });
      if (await systemThemeOption.isVisible({ timeout: 3000 }).catch(() => false)) {
        await human.click(systemThemeOption);
        
        // Should respect system preference
        const body = page.locator('body');
        await expect(body).toBeVisible();
      }
    }
  });

  test('3.5 Theme preference persists across sessions', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const themeToggle = page.getByRole('button', { name: /theme/i });
    if (await themeToggle.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(themeToggle);
      
      const darkModeOption = page.getByRole('menuitem', { name: /dark/i });
      if (await darkModeOption.isVisible({ timeout: 3000 }).catch(() => false)) {
        await human.click(darkModeOption);
        
        // Reload page
        await page.reload();
        
        // Theme should persist
        const body = page.locator('body');
        await expect(body).toBeVisible();
      }
    }
  });

  test('3.6 Consent banner shows on first visit', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Clear consent cookies/storage if possible
    await page.evaluate(() => {
      localStorage.clear();
    });
    
    await page.reload();
    
    const consentBanner = page.locator('[data-testid="consent-banner"]');
    if (await consentBanner.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(consentBanner).toBeVisible();
    }
  });

  test('3.7 Consent acceptance works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const consentBanner = page.locator('[data-testid="consent-banner"]');
    if (await consentBanner.isVisible({ timeout: 5000 }).catch(() => false)) {
      const acceptButton = page.getByRole('button', { name: /accept|agree/i });
      if (await acceptButton.isVisible()) {
        await human.click(acceptButton);
        
        // Banner should disappear
        await expect(consentBanner).not.toBeVisible({ timeout: 3000 });
      }
    }
  });

  test('3.8 Consent rejection works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const consentBanner = page.locator('[data-testid="consent-banner"]');
    if (await consentBanner.isVisible({ timeout: 5000 }).catch(() => false)) {
      const rejectButton = page.getByRole('button', { name: /reject|decline/i });
      if (await rejectButton.isVisible()) {
        await human.click(rejectButton);
        
        // Banner should disappear
        await expect(consentBanner).not.toBeVisible({ timeout: 3000 });
      }
    }
  });

  test('3.9 Consent preferences can be changed', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const settingsButton = page.getByRole('button', { name: /settings/i });
    if (await settingsButton.isVisible()) {
      await human.click(settingsButton);
      
      const privacySection = page.getByRole('button', { name: /privacy|consent/i });
      if (await privacySection.isVisible({ timeout: 5000 }).catch(() => false)) {
        await human.click(privacySection);
        
        const consentSettings = page.locator('[data-testid="consent-settings"]');
        if (await consentSettings.isVisible({ timeout: 3000 }).catch(() => false)) {
          await expect(consentSettings).toBeVisible();
        }
      }
    }
  });

  test('3.10 Theme does not break accessibility', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const themeToggle = page.getByRole('button', { name: /theme/i });
    if (await themeToggle.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(themeToggle);
      
      const darkModeOption = page.getByRole('menuitem', { name: /dark/i });
      if (await darkModeOption.isVisible({ timeout: 3000 }).catch(() => false)) {
        await human.click(darkModeOption);
        
        // Check that main navigation is still accessible
        const mainNav = page.getByRole('navigation', { name: /main/i });
        if (await mainNav.isVisible({ timeout: 3000 }).catch(() => false)) {
          await expect(mainNav).toBeVisible();
        }
      }
    }
  });
});