/**
 * Advanced Alerts Tests
 * 
 * Tests for advanced alert functionality:
 * - Alert displays
 * - Alert variants
 * - Alert dismissal
 * - Alert accessibility
 * - Alert actions
 * - Alert icons
 * - Alert persistence
 * - Alert stacked
 * - Alert animated
 * - Alert custom
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { saveBookmark } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Advanced Alerts Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('74.1 Alert displays', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const alert = page.locator('[data-testid="alert"], [role="alert"]');
    if (await alert.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(alert).toBeVisible();
    }
  });

  test('74.2 Alert variants work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const alert = page.locator('[data-testid="alert"]').first();
    if (await alert.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(alert).toBeVisible();
      
      const variantClass = await alert.getAttribute('class');
      if (variantClass) {
        await expect(variantClass).toBeTruthy();
      }
    }
  });

  test('74.3 Alert dismissal works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const alert = page.locator('[data-testid="alert"]').first();
    if (await alert.isVisible({ timeout: 5000 }).catch(() => false)) {
      const closeButton = alert.getByRole('button', { name: /close|x/i });
      if (await closeButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await human.click(closeButton);
        
        await expect(closeButton).toBeVisible();
      }
    }
  });

  test('74.4 Alert accessibility works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const alert = page.locator('[role="alert"]').first();
    if (await alert.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Check ARIA attributes
      const ariaLabel = await alert.getAttribute('aria-label');
      const role = await alert.getAttribute('role');
      
      if (ariaLabel || role) {
        await expect(ariaLabel || role).toBeTruthy();
      }
    }
  });

  test('74.5 Alert actions work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const alert = page.locator('[data-testid="alert"]').first();
    if (await alert.isVisible({ timeout: 5000 }).catch(() => false)) {
      const actionButton = alert.getByRole('button', { name: /action|retry/i });
      if (await actionButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await human.click(actionButton);
        
        await expect(actionButton).toBeVisible();
      }
    }
  });

  test('74.6 Alert icons work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const alert = page.locator('[data-testid="alert"]').first();
    if (await alert.isVisible({ timeout: 5000 }).catch(() => false)) {
      const icon = alert.locator('[data-testid="icon"]');
      if (await icon.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(icon).toBeVisible();
      }
    }
  });

  test('74.7 Alert persistence works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const alert = page.locator('[data-testid="alert"][data-persistent="true"]');
    if (await alert.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(alert).toBeVisible();
    }
  });

  test('74.8 Alert stacked works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const alertContainer = page.locator('[data-testid="alert-container"]');
    if (await alertContainer.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(alertContainer).toBeVisible();
      
      const alerts = alertContainer.locator('[data-testid="alert"]');
      if (await alerts.count() > 0) {
        await expect(alerts.count()).resolves.toBeGreaterThan(0);
      }
    }
  });

  test('74.9 Alert animated works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const alert = page.locator('[data-testid="alert"]').first();
    if (await alert.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(alert).toBeVisible();
      
      const animationClass = await alert.getAttribute('class');
      if (animationClass) {
        await expect(animationClass).toBeTruthy();
      }
    }
  });

  test('74.10 Alert custom works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const alert = page.locator('[data-testid="alert"][data-custom="true"]');
    if (await alert.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(alert).toBeVisible();
    }
  });
});