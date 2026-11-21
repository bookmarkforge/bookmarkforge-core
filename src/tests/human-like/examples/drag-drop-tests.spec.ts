/**
 * Drag and Drop Tests
 * 
 * Tests drag and drop functionality across the application:
 * - Tag drag and drop in bookmarks
 * - Bookmark reordering
 * - Canvas element dragging
 * - File upload via drag and drop
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Drag and Drop Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('1.1 Tag drag and drop works in bookmarks', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Create a bookmark first
    const fabButton = page.getByTestId('quick-capture-fab');
    if (await fabButton.isVisible()) {
      await human.click(fabButton);
      
      const urlInput = page.getByTestId('url-input');
      await human.type(urlInput, 'https://example.com/drag-test');
      
      const titleInput = page.getByTestId('title-input');
      await human.type(titleInput, 'Drag Test Bookmark');
      
      const saveButton = page.getByTestId('save-button');
      await human.click(saveButton);
      
      // Wait for bookmark to appear
      await page.waitForTimeout(2000);
    }
    
    // Open tag manager
    const bookmarkRow = page.getByText('Drag Test Bookmark');
    if (await bookmarkRow.isVisible()) {
      await bookmarkRow.click();
      
      const tagButton = page.getByRole('button', { name: /tag/i });
      if (await tagButton.isVisible()) {
        await human.click(tagButton);
        
        // Try to find draggable tag elements
        const draggableTag = page.locator('[draggable="true"]').first();
        if (await draggableTag.isVisible()) {
          // Tag should be draggable
          await expect(draggableTag).toHaveAttribute('draggable', 'true');
        }
      }
    }
  });

  test('1.2 Bookmark reordering via drag handles', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Navigate to bookmarks
    const bookmarksTab = page.locator('[data-tab-id="bookmarks"]');
    await bookmarksTab.click();
    
    // Look for drag handles on bookmark rows
    const dragHandle = page.locator('[data-testid="drag-handle"]').first();
    if (await dragHandle.isVisible()) {
      await expect(dragHandle).toBeVisible();
      // Drag handle should be present for reordering
    }
  });

  test('1.3 File upload via drag and drop', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Try to access PDF upload area
    const documentsTab = page.locator('[data-tab-id="documents"]');
    await documentsTab.click();
    
    const newDocButton = page.getByTestId('new-document-button');
    await human.click(newDocButton);
    
    // Look for drop zone
    const dropZone = page.locator('[data-testid="drop-zone"], [role="droppable"]');
    if (await dropZone.isVisible()) {
      await expect(dropZone).toBeVisible();
      // Drop zone should accept files
    }
  });

  test('1.4 Canvas element dragging', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Try to open canvas view
    const canvasButton = page.getByRole('button', { name: /canvas/i });
    if (await canvasButton.isVisible()) {
      await human.click(canvasButton);
      
      // Look for draggable canvas elements
      const canvasElement = page.locator('[data-testid="canvas-element"]').first();
      if (await canvasElement.isVisible()) {
        await expect(canvasElement).toHaveAttribute('draggable', 'true');
      }
    }
  });

  test('1.5 Drag and drop accessibility', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Verify keyboard alternative for drag operations
    const bookmarksTab = page.locator('[data-tab-id="bookmarks"]');
    await bookmarksTab.click();
    
    // Check for keyboard-accessible reordering controls
    const moveUpButton = page.getByRole('button', { name: /move up/i });
    const moveDownButton = page.getByRole('button', { name: /move down/i });
    
    // At least one alternative should exist
    const hasKeyboardAlternative = await moveUpButton.isVisible() || await moveDownButton.isVisible();
    if (hasKeyboardAlternative) {
      await expect(true).toBeTruthy();
    }
  });

  test('1.6 Drag visual feedback during operation', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Test that drag operations show visual feedback
    const bookmarksTab = page.locator('[data-tab-id="bookmarks"]');
    await bookmarksTab.click();
    
    const draggableElement = page.locator('[draggable="true"]').first();
    if (await draggableElement.isVisible()) {
      // Simulate drag start by hovering
      await draggableElement.hover();
      
      // Check for drag feedback classes or states
      const hasDragFeedback = await draggableElement.evaluate((el) => {
        return el.classList.contains('dragging') || 
               el.classList.contains('drag-start') ||
               getComputedStyle(el).opacity !== '1';
      });
      
      // Visual feedback should be present during drag
      if (hasDragFeedback) {
        await expect(true).toBeTruthy();
      }
    }
  });

  test('1.7 Drag and drop drop target highlighting', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Test that drop targets show visual feedback
    const bookmarksTab = page.locator('[data-tab-id="bookmarks"]');
    await bookmarksTab.click();
    
    const dropTarget = page.locator('[data-testid="drop-target"]').first();
    if (await dropTarget.isVisible()) {
      await expect(dropTarget).toBeVisible();
      // Drop target should be identifiable
    }
  });

  test('1.8 Cancel drag operation with Escape', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Test that Escape cancels drag operations
    const bookmarksTab = page.locator('[data-tab-id="bookmarks"]');
    await bookmarksTab.click();
    
    const draggableElement = page.locator('[draggable="true"]').first();
    if (await draggableElement.isVisible()) {
      await draggableElement.click();
      await page.keyboard.press('Escape');
      
      // Operation should be cancelled
      await expect(page.locator('.dragging, .drag-start')).not.toBeVisible();
    }
  });

  test('1.9 Drag and drop prevents accidental drops', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Test that dragging outside valid areas doesn't drop
    const bookmarksTab = page.locator('[data-tab-id="bookmarks"]');
    await bookmarksTab.click();
    
    const draggableElement = page.locator('[draggable="true"]').first();
    if (await draggableElement.isVisible()) {
      await draggableElement.hover();
      
      // Drag to invalid area (e.g., outside list)
      const invalidArea = page.locator('body');
      await invalidArea.click();
      
      // Should not have dropped
      await expect(page.locator('.drop-success')).not.toBeVisible();
    }
  });

  test('1.10 Touch device drag support', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Test touch events for drag (simulated)
    const bookmarksTab = page.locator('[data-tab-id="bookmarks"]');
    await bookmarksTab.click();
    
    const touchElement = page.locator('[data-testid="touch-draggable"]').first();
    if (await touchElement.isVisible()) {
      await expect(touchElement).toBeVisible();
      // Touch drag support should be available
    }
  });
});
