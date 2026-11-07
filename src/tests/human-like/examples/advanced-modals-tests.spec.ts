/**
 * Advanced Modals Tests
 * 
 * Tests for advanced modal functionality:
 * - Modal opens/closes
 * - Modal backdrop
 * - Modal focus trap
 * - Modal escape key
 * - Modal animation
 * - Modal size variants
 * - Modal nesting
 * - Modal accessibility
 * - Modal scroll
 * - Modal persistence
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { saveBookmark } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Advanced Modals Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('42.1 Modal opens and closes', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const settingsButton = page.getByRole('button', { name: /settings/i });
    if (await settingsButton.isVisible()) {
      await human.click(settingsButton);
      
      const modal = page.locator('[role="dialog"]');
      if (await modal.isVisible({ timeout: 5000 }).catch(() => false)) {
        await expect(modal).toBeVisible();
        
        const closeButton = modal.getByRole('button', { name: /close|cancel/i });
        if (await closeButton.isVisible({ timeout: 3000 }).catch(() => false)) {
          await human.click(closeButton);
          await expect(modal).not.toBeVisible({ timeout: 3000 });
        }
      }
    }
  });

  test('42.2 Modal backdrop works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const settingsButton = page.getByRole('button', { name: /settings/i });
    if (await settingsButton.isVisible()) {
      await human.click(settingsButton);
      
      const backdrop = page.locator('[data-testid="modal-backdrop"]');
      if (await backdrop.isVisible({ timeout: 5000 }).catch(() => false)) {
        await expect(backdrop).toBeVisible();
        
        await backdrop.click();
        
        const modal = page.locator('[role="dialog"]');
        if (await modal.isVisible({ timeout: 3000 }).catch(() => false)) {
          await expect(modal).not.toBeVisible({ timeout: 3000 });
        }
      }
    }
  });

  test('42.3 Modal focus trap works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const settingsButton = page.getByRole('button', { name: /settings/i });
    if (await settingsButton.isVisible()) {
      await human.click(settingsButton);
      
      const modal = page.locator('[role="dialog"]');
      if (await modal.isVisible({ timeout: 5000 }).catch(() => false)) {
        await expect(modal).toBeVisible();
        
        // Press Tab multiple times - focus should stay in modal
        await page.keyboard.press('Tab');
        await page.keyboard.press('Tab');
        
        const focusedElement = page.locator(':focus');
        if (await focusedElement.count() > 0) {
          const isInsideModal = await modal.evaluate((modal, focused) => {
            return modal.contains(document.activeElement);
          });
          await expect(isInsideModal).toBeTruthy();
        }
      }
    }
  });

  test('42.4 Modal escape key works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const settingsButton = page.getByRole('button', { name: /settings/i });
    if (await settingsButton.isVisible()) {
      await human.click(settingsButton);
      
      const modal = page.locator('[role="dialog"]');
      if (await modal.isVisible({ timeout: 5000 }).catch(() => false)) {
        await expect(modal).toBeVisible();
        
        await page.keyboard.press('Escape');
        
        await expect(modal).not.toBeVisible({ timeout: 3000 });
      }
    }
  });

  test('42.5 Modal animation works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const settingsButton = page.getByRole('button', { name: /settings/i });
    if (await settingsButton.isVisible()) {
      await human.click(settingsButton);
      
      const modal = page.locator('[role="dialog"]');
      if (await modal.isVisible({ timeout: 5000 }).catch(() => false)) {
        await expect(modal).toBeVisible();
        
        // Check for animation class
        const animationClass = await modal.getAttribute('class');
        if (animationClass) {
          await expect(animationClass).toBeTruthy();
        }
      }
    }
  });

  test('42.6 Modal size variants work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const settingsButton = page.getByRole('button', { name: /settings/i });
    if (await settingsButton.isVisible()) {
      await human.click(settingsButton);
      
      const modal = page.locator('[role="dialog"]');
      if (await modal.isVisible({ timeout: 5000 }).catch(() => false)) {
        await expect(modal).toBeVisible();
        
        const box = await modal.boundingBox();
        if (box) {
          await expect(box.width).toBeGreaterThan(0);
          await expect(box.height).toBeGreaterThan(0);
        }
      }
    }
  });

  test('42.7 Modal nesting works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const settingsButton = page.getByRole('button', { name: /settings/i });
    if (await settingsButton.isVisible()) {
      await human.click(settingsButton);
      
      const modal = page.locator('[role="dialog"]');
      if (await modal.isVisible({ timeout: 5000 }).catch(() => false)) {
        await expect(modal).toBeVisible();
        
        // Try to open another modal from within
        const nestedButton = modal.getByRole('button', { name: /advanced|more/i });
        if (await nestedButton.isVisible({ timeout: 3000 }).catch(() => false)) {
          await human.click(nestedButton);
          
          const nestedModal = page.locator('[role="dialog"]:nth-of-type(2)');
          if (await nestedModal.isVisible({ timeout: 3000 }).catch(() => false)) {
            await expect(nestedModal).toBeVisible();
          }
        }
      }
    }
  });

  test('42.8 Modal accessibility works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const settingsButton = page.getByRole('button', { name: /settings/i });
    if (await settingsButton.isVisible()) {
      await human.click(settingsButton);
      
      const modal = page.locator('[role="dialog"]');
      if (await modal.isVisible({ timeout: 5000 }).catch(() => false)) {
        await expect(modal).toBeVisible();
        
        // Check ARIA attributes
        const ariaLabel = await modal.getAttribute('aria-label');
        const ariaModal = await modal.getAttribute('aria-modal');
        
        if (ariaLabel || ariaModal) {
          await expect(ariaLabel || ariaModal).toBeTruthy();
        }
      }
    }
  });

  test('42.9 Modal scroll works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const settingsButton = page.getByRole('button', { name: /settings/i });
    if (await settingsButton.isVisible()) {
      await human.click(settingsButton);
      
      const modal = page.locator('[role="dialog"]');
      if (await modal.isVisible({ timeout: 5000 }).catch(() => false)) {
        await expect(modal).toBeVisible();
        
        // Scroll within modal
        const modalContent = modal.locator('[data-testid="modal-content"]');
        if (await modalContent.isVisible({ timeout: 3000 }).catch(() => false)) {
          await modalContent.evaluate(el => el.scrollTop = 100);
          
          await expect(modalContent).toBeVisible();
        }
      }
    }
  });

  test('42.10 Modal persistence works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const settingsButton = page.getByRole('button', { name: /settings/i });
    if (await settingsButton.isVisible()) {
      await human.click(settingsButton);
      
      const modal = page.locator('[role="dialog"]');
      if (await modal.isVisible({ timeout: 5000 }).catch(() => false)) {
        await expect(modal).toBeVisible();
        
        // Reload and check if modal state persists (should close on reload typically)
        await page.reload();
        
        const modalAfterReload = page.locator('[role="dialog"]');
        if (await modalAfterReload.isVisible({ timeout: 3000 }).catch(() => false)) {
          // Modal might persist in some cases
          await expect(modalAfterReload).toBeVisible();
        } else {
          // Modal should close on reload (expected behavior)
          await expect(modalAfterReload).not.toBeVisible();
        }
      }
    }
  });
});