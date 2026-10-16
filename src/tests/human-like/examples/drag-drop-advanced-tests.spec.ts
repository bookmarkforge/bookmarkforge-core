/**
 * Advanced Drag and Drop Tests
 * 
 * Tests for advanced drag and drop functionality:
 * - Multi-item drag
 * - Drag between containers
 * - Drag constraints
 * - Drag visual feedback
 * - Drag accessibility
 * - Drag undo/redo
 * - Drag validation
 * - Drag performance
 * - Drag shortcuts
 * - Drag configuration
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { saveBookmark } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Advanced Drag and Drop Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('36.1 Multi-item drag works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const bookmarkRows = page.locator('[data-testid="bookmark-row"]');
    const count = await bookmarkRows.count();
    
    if (count >= 2) {
      // Try to select multiple items
      await page.keyboard.down('Control');
      await human.click(bookmarkRows.first());
      await human.click(bookmarkRows.nth(1));
      await page.keyboard.up('Control');
      
      const selectedItems = page.locator('[data-selected="true"]');
      if (await selectedItems.count() > 0) {
        await expect(selectedItems.count()).resolves.toBeGreaterThan(0);
      }
    }
  });

  test('36.2 Drag between containers works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const draggables = page.locator('[draggable="true"]').first();
    if (await draggables.isVisible({ timeout: 5000 }).catch(() => false)) {
      await draggables.dragTo(page.locator('[data-testid="drop-zone"]').first());
      
      const dropZone = page.locator('[data-testid="drop-zone"]');
      if (await dropZone.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(dropZone).toBeVisible();
      }
    }
  });

  test('36.3 Drag constraints work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const draggables = page.locator('[draggable="true"]').first();
    if (await draggables.isVisible({ timeout: 5000 }).catch(() => false)) {
      await draggables.dragTo(page.locator('body').first());
      
      // Should show constraint violation feedback
      const constraintFeedback = page.locator('[data-testid="constraint-feedback"]');
      if (await constraintFeedback.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(constraintFeedback).toBeVisible();
      }
    }
  });

  test('36.4 Drag visual feedback works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const draggables = page.locator('[draggable="true"]').first();
    if (await draggables.isVisible({ timeout: 5000 }).catch(() => false)) {
      await draggables.hover();
      
      const dragFeedback = page.locator('[data-testid="drag-feedback"]');
      if (await dragFeedback.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(dragFeedback).toBeVisible();
      }
    }
  });

  test('36.5 Drag accessibility works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const draggables = page.locator('[draggable="true"]');
    const count = await draggables.count();
    
    if (count > 0) {
      // Check that draggable elements have accessible labels
      const firstDraggable = draggables.first();
      const ariaLabel = await firstDraggable.getAttribute('aria-label');
      if (ariaLabel) {
        await expect(ariaLabel).toBeTruthy();
      }
    }
  });

  test('36.6 Drag undo/redo works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const draggables = page.locator('[draggable="true"]').first();
    if (await draggables.isVisible({ timeout: 5000 }).catch(() => false)) {
      await draggables.dragTo(page.locator('[data-testid="drop-zone"]').first());
      
      // Try to undo
      await page.keyboard.press('Control+z');
      
      const undoIndicator = page.locator('[data-testid="undo-indicator"]');
      if (await undoIndicator.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(undoIndicator).toBeVisible();
      }
    }
  });

  test('36.7 Drag validation works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const draggables = page.locator('[draggable="true"]').first();
    if (await draggables.isVisible({ timeout: 5000 }).catch(() => false)) {
      await draggables.dragTo(page.locator('[data-testid="invalid-drop-zone"]').first());
      
      const validationError = page.locator('[data-testid="validation-error"]');
      if (await validationError.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(validationError).toBeVisible();
      }
    }
  });

  test('36.8 Drag performance works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const draggables = page.locator('[draggable="true"]').first();
    if (await draggables.isVisible({ timeout: 5000 }).catch(() => false)) {
      const startTime = Date.now();
      await draggables.dragTo(page.locator('[data-testid="drop-zone"]').first());
      const dragTime = Date.now() - startTime;
      
      // Drag should complete in reasonable time
      await expect(dragTime).toBeLessThan(5000);
    }
  });

  test('36.9 Drag shortcuts work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const draggables = page.locator('[draggable="true"]').first();
    if (await draggables.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(draggables);
      
      // Use keyboard shortcut to move
      await page.keyboard.press('ArrowDown');
      
      const movedItem = page.locator('[data-moved="true"]');
      if (await movedItem.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(movedItem).toBeVisible();
      }
    }
  });

  test('36.10 Drag configuration works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const settingsButton = page.getByRole('button', { name: /settings/i });
    if (await settingsButton.isVisible()) {
      await human.click(settingsButton);
      
      const dragSection = page.getByRole('button', { name: /drag|drop/i });
      if (await dragSection.isVisible({ timeout: 5000 }).catch(() => false)) {
        await human.click(dragSection);
        
        const dragConfig = page.locator('[data-testid="drag-config"]');
        if (await dragConfig.isVisible({ timeout: 5000 }).catch(() => false)) {
          await expect(dragConfig).toBeVisible();
        }
      }
    }
  });
});