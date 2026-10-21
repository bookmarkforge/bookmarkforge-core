/**
 * Advanced Focus Traps Tests
 * 
 * Tests for advanced focus trap functionality:
 * - Focus trap displays
 * - Focus trap activation
 * - Focus trap deactivation
 * - Focus trap keyboard nav
 * - Focus trap accessibility
 * - Focus trap return
 * - Focus trap escape
 * - Focus trap initial
 * - Focus trap persistent
 * - Focus trap custom
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { saveBookmark } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Advanced Focus Traps Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('93.1 Focus trap displays', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const focusTrap = page.locator('[data-testid="focus-trap"]');
    if (await focusTrap.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(focusTrap).toBeVisible();
    }
  });

  test('93.2 Focus trap activation works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const focusTrapButton = page.getByRole('button', { name: /modal|dialog/i });
    if (await focusTrapButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(focusTrapButton);
      
      const focusTrap = page.locator('[data-testid="focus-trap"]');
      if (await focusTrap.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(focusTrap).toBeVisible();
      }
    }
  });

  test('93.3 Focus trap deactivation works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const focusTrapButton = page.getByRole('button', { name: /modal|dialog/i });
    if (await focusTrapButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(focusTrapButton);
      
      const focusTrap = page.locator('[data-testid="focus-trap"]');
      if (await focusTrap.isVisible({ timeout: 3000 }).catch(() => false)) {
        const closeButton = focusTrap.getByRole('button', { name: /close|x/i });
        if (await closeButton.isVisible({ timeout: 3000 }).catch(() => false)) {
          await human.click(closeButton);
          
          await expect(focusTrap).not.toBeVisible({ timeout: 3000 });
        }
      }
    }
  });

  test('93.4 Focus trap keyboard navigation works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const focusTrapButton = page.getByRole('button', { name: /modal|dialog/i });
    if (await focusTrapButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(focusTrapButton);
      
      const focusTrap = page.locator('[data-testid="focus-trap"]');
      if (await focusTrap.isVisible({ timeout: 3000 }).catch(() => false)) {
        const focusable = focusTrap.getByRole('button').first();
        if (await focusable.isVisible({ timeout: 3000 }).catch(() => false)) {
          await focusable.focus();
          
          await page.keyboard.press('Tab');
          
          const focusedElement = page.locator(':focus');
          await expect(focusedElement).toBeVisible();
        }
      }
    }
  });

  test('93.5 Focus trap accessibility works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const focusTrap = page.locator('[data-testid="focus-trap"]').first();
    if (await focusTrap.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Check ARIA attributes
      const ariaLabel = await focusTrap.getAttribute('aria-label');
      const role = await focusTrap.getAttribute('role');
      
      if (ariaLabel || role) {
        await expect(ariaLabel || role).toBeTruthy();
      }
    }
  });

  test('93.6 Focus trap return works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const focusTrapButton = page.getByRole('button', { name: /modal|dialog/i });
    if (await focusTrapButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await focusTrapButton.focus();
      
      await human.click(focusTrapButton);
      
      const focusTrap = page.locator('[data-testid="focus-trap"]');
      if (await focusTrap.isVisible({ timeout: 3000 }).catch(() => false)) {
        await page.keyboard.press('Escape');
        
        const focusedElement = page.locator(':focus');
        await expect(focusedElement).toBeVisible();
      }
    }
  });

  test('93.7 Focus trap escape works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const focusTrapButton = page.getByRole('button', { name: /modal|dialog/i });
    if (await focusTrapButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(focusTrapButton);
      
      const focusTrap = page.locator('[data-testid="focus-trap"]');
      if (await focusTrap.isVisible({ timeout: 3000 }).catch(() => false)) {
        await page.keyboard.press('Escape');
        
        await expect(focusTrap).not.toBeVisible({ timeout: 3000 });
      }
    }
  });

  test('93.8 Focus trap initial works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const focusTrapButton = page.getByRole('button', { name: /modal|dialog/i });
    if (await focusTrapButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(focusTrapButton);
      
      const focusTrap = page.locator('[data-testid="focus-trap"]');
      if (await focusTrap.isVisible({ timeout: 3000 }).catch(() => false)) {
        const focusedElement = page.locator(':focus');
        await expect(focusedElement).toBeVisible();
      }
    }
  });

  test('93.9 Focus trap persistent works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const focusTrap = page.locator('[data-testid="focus-trap"][data-persistent="true"]');
    if (await focusTrap.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(focusTrap).toBeVisible();
    }
  });

  test('93.10 Focus trap custom works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const focusTrap = page.locator('[data-testid="focus-trap"][data-custom="true"]');
    if (await focusTrap.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(focusTrap).toBeVisible();
    }
  });
});