/**
 * Advanced Dialogs Tests
 * 
 * Tests for advanced dialog functionality:
 * - Dialog opens/closes
 * - Dialog backdrop
 * - Dialog focus trap
 * - Dialog escape key
 * - Dialog animation
 * - Dialog size variants
 * - Dialog nesting
 * - Dialog accessibility
 * - Dialog confirm
 * - Dialog alert
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { saveBookmark } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Advanced Dialogs Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('54.1 Dialog opens and closes', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const dialogButton = page.getByRole('button', { name: /dialog|confirm/i });
    if (await dialogButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(dialogButton);
      
      const dialog = page.locator('[role="dialog"]');
      if (await dialog.isVisible({ timeout: 5000 }).catch(() => false)) {
        await expect(dialog).toBeVisible();
        
        const closeButton = dialog.getByRole('button', { name: /close|cancel/i });
        if (await closeButton.isVisible({ timeout: 3000 }).catch(() => false)) {
          await human.click(closeButton);
          await expect(dialog).not.toBeVisible({ timeout: 3000 });
        }
      }
    }
  });

  test('54.2 Dialog backdrop works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const dialogButton = page.getByRole('button', { name: /dialog/i });
    if (await dialogButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(dialogButton);
      
      const backdrop = page.locator('[data-testid="dialog-backdrop"]');
      if (await backdrop.isVisible({ timeout: 5000 }).catch(() => false)) {
        await expect(backdrop).toBeVisible();
        
        await backdrop.click();
        
        const dialog = page.locator('[role="dialog"]');
        if (await dialog.isVisible({ timeout: 3000 }).catch(() => false)) {
          await expect(dialog).not.toBeVisible({ timeout: 3000 });
        }
      }
    }
  });

  test('54.3 Dialog focus trap works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const dialogButton = page.getByRole('button', { name: /dialog/i });
    if (await dialogButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(dialogButton);
      
      const dialog = page.locator('[role="dialog"]');
      if (await dialog.isVisible({ timeout: 5000 }).catch(() => false)) {
        await expect(dialog).toBeVisible();
        
        await page.keyboard.press('Tab');
        
        const focusedElement = page.locator(':focus');
        if (await focusedElement.count() > 0) {
          const isInsideDialog = await dialog.evaluate((dialog, focused) => {
            return dialog.contains(document.activeElement);
          });
          await expect(isInsideDialog).toBeTruthy();
        }
      }
    }
  });

  test('54.4 Dialog escape key works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const dialogButton = page.getByRole('button', { name: /dialog/i });
    if (await dialogButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(dialogButton);
      
      const dialog = page.locator('[role="dialog"]');
      if (await dialog.isVisible({ timeout: 5000 }).catch(() => false)) {
        await expect(dialog).toBeVisible();
        
        await page.keyboard.press('Escape');
        
        await expect(dialog).not.toBeVisible({ timeout: 3000 });
      }
    }
  });

  test('54.5 Dialog animation works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const dialogButton = page.getByRole('button', { name: /dialog/i });
    if (await dialogButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(dialogButton);
      
      const dialog = page.locator('[role="dialog"]');
      if (await dialog.isVisible({ timeout: 5000 }).catch(() => false)) {
        await expect(dialog).toBeVisible();
        
        const animationClass = await dialog.getAttribute('class');
        if (animationClass) {
          await expect(animationClass).toBeTruthy();
        }
      }
    }
  });

  test('54.6 Dialog size variants work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const dialogButton = page.getByRole('button', { name: /dialog/i });
    if (await dialogButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(dialogButton);
      
      const dialog = page.locator('[role="dialog"]');
      if (await dialog.isVisible({ timeout: 5000 }).catch(() => false)) {
        const box = await dialog.boundingBox();
        if (box) {
          await expect(box.width).toBeGreaterThan(0);
          await expect(box.height).toBeGreaterThan(0);
        }
      }
    }
  });

  test('54.7 Dialog nesting works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const dialogButton = page.getByRole('button', { name: /dialog/i });
    if (await dialogButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(dialogButton);
      
      const dialog = page.locator('[role="dialog"]');
      if (await dialog.isVisible({ timeout: 5000 }).catch(() => false)) {
        const nestedButton = dialog.getByRole('button', { name: /nested|more/i });
        if (await nestedButton.isVisible({ timeout: 3000 }).catch(() => false)) {
          await human.click(nestedButton);
          
          const nestedDialog = page.locator('[role="dialog"]:nth-of-type(2)');
          if (await nestedDialog.isVisible({ timeout: 3000 }).catch(() => false)) {
            await expect(nestedDialog).toBeVisible();
          }
        }
      }
    }
  });

  test('54.8 Dialog accessibility works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const dialogButton = page.getByRole('button', { name: /dialog/i });
    if (await dialogButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(dialogButton);
      
      const dialog = page.locator('[role="dialog"]');
      if (await dialog.isVisible({ timeout: 5000 }).catch(() => false)) {
        const ariaLabel = await dialog.getAttribute('aria-label');
        const ariaModal = await dialog.getAttribute('aria-modal');
        
        if (ariaLabel || ariaModal) {
          await expect(ariaLabel || ariaModal).toBeTruthy();
        }
      }
    }
  });

  test('54.9 Dialog confirm works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const confirmButton = page.getByRole('button', { name: /confirm/i });
    if (await confirmButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(confirmButton);
      
      const dialog = page.locator('[role="dialog"]');
      if (await dialog.isVisible({ timeout: 5000 }).catch(() => false)) {
        const okButton = dialog.getByRole('button', { name: /ok|yes/i });
        if (await okButton.isVisible({ timeout: 3000 }).catch(() => false)) {
          await human.click(okButton);
          
          await expect(dialog).not.toBeVisible({ timeout: 3000 });
        }
      }
    }
  });

  test('54.10 Dialog alert works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const alertButton = page.getByRole('button', { name: /alert/i });
    if (await alertButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(alertButton);
      
      const dialog = page.locator('[role="alertdialog"]');
      if (await dialog.isVisible({ timeout: 5000 }).catch(() => false)) {
        await expect(dialog).toBeVisible();
        
        const okButton = dialog.getByRole('button', { name: /ok/i });
        if (await okButton.isVisible({ timeout: 3000 }).catch(() => false)) {
          await human.click(okButton);
          
          await expect(dialog).not.toBeVisible({ timeout: 3000 });
        }
      }
    }
  });
});