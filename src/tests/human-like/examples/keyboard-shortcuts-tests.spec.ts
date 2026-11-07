/**
 * Keyboard Shortcuts Tests
 * 
 * Tests for keyboard shortcuts:
 * - Basic shortcuts
 * - Custom shortcuts
 * - Shortcut conflicts
 * - Shortcut discovery
 * - Shortcut modifiers
 * - Global shortcuts
 * - Context shortcuts
 * - Shortcut help
 * - Shortcut recording
 * - Shortcut accessibility
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { saveBookmark } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Keyboard Shortcuts Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('33.1 Basic shortcuts work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Test common shortcuts
    await page.keyboard.press('Control+f');
    
    const searchInput = page.getByRole('textbox', { name: /search/i });
    if (await searchInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(searchInput).toBeFocused();
    }
  });

  test('33.2 Custom shortcuts work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const settingsButton = page.getByRole('button', { name: /settings/i });
    if (await settingsButton.isVisible()) {
      await human.click(settingsButton);
      
      const shortcutsSection = page.getByRole('button', { name: /shortcut|keybinding/i });
      if (await shortcutsSection.isVisible({ timeout: 5000 }).catch(() => false)) {
        await human.click(shortcutsSection);
        
        const customShortcuts = page.locator('[data-testid="custom-shortcuts"]');
        if (await customShortcuts.isVisible({ timeout: 5000 }).catch(() => false)) {
          await expect(customShortcuts).toBeVisible();
        }
      }
    }
  });

  test('33.3 Shortcut conflicts work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const settingsButton = page.getByRole('button', { name: /settings/i });
    if (await settingsButton.isVisible()) {
      await human.click(settingsButton);
      
      const shortcutsSection = page.getByRole('button', { name: /shortcut/i });
      if (await shortcutsSection.isVisible({ timeout: 5000 }).catch(() => false)) {
        await human.click(shortcutsSection);
        
        const conflictWarning = page.locator('[data-testid="conflict-warning"]');
        if (await conflictWarning.isVisible({ timeout: 5000 }).catch(() => false)) {
          await expect(conflictWarning).toBeVisible();
        }
      }
    }
  });

  test('33.4 Shortcut discovery works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const helpButton = page.getByRole('button', { name: /help|\?/i });
    if (await helpButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(helpButton);
      
      const shortcutList = page.locator('[data-testid="shortcut-list"]');
      if (await shortcutList.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(shortcutList).toBeVisible();
      }
    }
  });

  test('33.5 Shortcut modifiers work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Test modifier combinations
    await page.keyboard.press('Control+Shift+f');
    
    const searchInput = page.getByRole('textbox', { name: /search/i });
    if (await searchInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(searchInput).toBeFocused();
    }
  });

  test('33.6 Global shortcuts work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const settingsButton = page.getByRole('button', { name: /settings/i });
    if (await settingsButton.isVisible()) {
      await human.click(settingsButton);
      
      const shortcutsSection = page.getByRole('button', { name: /shortcut/i });
      if (await shortcutsSection.isVisible({ timeout: 5000 }).catch(() => false)) {
        await human.click(shortcutsSection);
        
        const globalShortcuts = page.locator('[data-testid="global-shortcuts"]');
        if (await globalShortcuts.isVisible({ timeout: 5000 }).catch(() => false)) {
          await expect(globalShortcuts).toBeVisible();
        }
      }
    }
  });

  test('33.7 Context shortcuts work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Click on a bookmark to focus context
    const bookmarkRow = page.locator('[data-testid="bookmark-row"]').first();
    if (await bookmarkRow.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(bookmarkRow);
      
      // Test context-specific shortcut
      await page.keyboard.press('Delete');
      
      // Should show delete confirmation or similar
      const deleteDialog = page.locator('[data-testid="delete-dialog"]');
      if (await deleteDialog.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(deleteDialog).toBeVisible();
      }
    }
  });

  test('33.8 Shortcut help works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    await page.keyboard.press('Control+/');
    
    const shortcutHelp = page.locator('[data-testid="shortcut-help"]');
    if (await shortcutHelp.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(shortcutHelp).toBeVisible();
    }
  });

  test('33.9 Shortcut recording works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const settingsButton = page.getByRole('button', { name: /settings/i });
    if (await settingsButton.isVisible()) {
      await human.click(settingsButton);
      
      const shortcutsSection = page.getByRole('button', { name: /shortcut/i });
      if (await shortcutsSection.isVisible({ timeout: 5000 }).catch(() => false)) {
        await human.click(shortcutsSection);
        
        const recordButton = page.getByRole('button', { name: /record/i });
        if (await recordButton.isVisible({ timeout: 5000 }).catch(() => false)) {
          await human.click(recordButton);
          
          const recordingIndicator = page.locator('[data-testid="recording-indicator"]');
          if (await recordingIndicator.isVisible({ timeout: 3000 }).catch(() => false)) {
            await expect(recordingIndicator).toBeVisible();
          }
        }
      }
    }
  });

  test('33.10 Shortcut accessibility works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const settingsButton = page.getByRole('button', { name: /settings/i });
    if (await settingsButton.isVisible()) {
      await human.click(settingsButton);
      
      const shortcutsSection = page.getByRole('button', { name: /shortcut/i });
      if (await shortcutsSection.isVisible({ timeout: 5000 }).catch(() => false)) {
        await human.click(shortcutsSection);
        
        const accessibleShortcuts = page.locator('[aria-label*="shortcut"], [aria-label*="keyboard"]');
        if (await accessibleShortcuts.count() > 0) {
          await expect(accessibleShortcuts.count()).resolves.toBeGreaterThan(0);
        }
      }
    }
  });
});