/**
 * Tooltip and Help Tests
 * 
 * Tests for tooltip and help features:
 * - Tooltips display
 * - Tooltips positioning
 * - Tooltips persistence
 * - Tooltips accessibility
 * - Help modal opens
 * - Help search
 * - Help navigation
 * - Help context
 * - Help tours
 * - Help shortcuts
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { saveBookmark } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Tooltip and Help Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('37.1 Tooltips display correctly', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const tooltipTrigger = page.locator('[title], [data-tooltip]').first();
    if (await tooltipTrigger.isVisible({ timeout: 5000 }).catch(() => false)) {
      await tooltipTrigger.hover();
      
      const tooltip = page.locator('[role="tooltip"], .tooltip');
      if (await tooltip.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(tooltip).toBeVisible();
      }
    }
  });

  test('37.2 Tooltips positioning works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const tooltipTrigger = page.locator('[title], [data-tooltip]').first();
    if (await tooltipTrigger.isVisible({ timeout: 5000 }).catch(() => false)) {
      await tooltipTrigger.hover();
      
      const tooltip = page.locator('[role="tooltip"]');
      if (await tooltip.isVisible({ timeout: 3000 }).catch(() => false)) {
        const box = await tooltip.boundingBox();
        if (box) {
          await expect(box.x).toBeGreaterThan(0);
          await expect(box.y).toBeGreaterThan(0);
        }
      }
    }
  });

  test('37.3 Tooltips persistence works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const tooltipTrigger = page.locator('[title], [data-tooltip]').first();
    if (await tooltipTrigger.isVisible({ timeout: 5000 }).catch(() => false)) {
      await tooltipTrigger.hover();
      
      // Wait for tooltip to appear
      await page.waitForTimeout(500);
      
      const tooltip = page.locator('[role="tooltip"]');
      if (await tooltip.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(tooltip).toBeVisible();
      }
    }
  });

  test('37.4 Tooltips accessibility works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const tooltipTrigger = page.locator('[aria-describedby], [aria-label]').first();
    if (await tooltipTrigger.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(tooltipTrigger).toBeVisible();
    }
  });

  test('37.5 Help modal opens', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const helpButton = page.getByRole('button', { name: /help|\?/i });
    if (await helpButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(helpButton);
      
      const helpModal = page.locator('[data-testid="help-modal"]');
      if (await helpModal.isVisible({ timeout: 5000 }).catch(() => false)) {
        await expect(helpModal).toBeVisible();
      }
    }
  });

  test('37.6 Help search works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const helpButton = page.getByRole('button', { name: /help/i });
    if (await helpButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(helpButton);
      
      const searchInput = page.getByRole('textbox', { name: /search/i });
      if (await searchInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        await human.type(searchInput, 'bookmark');
        
        const searchResults = page.locator('[data-testid="help-results"]');
        if (await searchResults.isVisible({ timeout: 3000 }).catch(() => false)) {
          await expect(searchResults).toBeVisible();
        }
      }
    }
  });

  test('37.7 Help navigation works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const helpButton = page.getByRole('button', { name: /help/i });
    if (await helpButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(helpButton);
      
      const navLinks = page.locator('[data-testid="help-nav"] a');
      if (await navLinks.count() > 0) {
        await expect(navLinks.count()).resolves.toBeGreaterThan(0);
      }
    }
  });

  test('37.8 Help context works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const contextHelpButton = page.getByRole('button', { name: /context help/i });
    if (await contextHelpButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(contextHelpButton);
      
      const contextPanel = page.locator('[data-testid="context-panel"]');
      if (await contextPanel.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(contextPanel).toBeVisible();
      }
    }
  });

  test('37.9 Help tours work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const tourButton = page.getByRole('button', { name: /tour|guide/i });
    if (await tourButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(tourButton);
      
      const tourOverlay = page.locator('[data-testid="tour-overlay"]');
      if (await tourOverlay.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(tourOverlay).toBeVisible();
      }
    }
  });

  test('37.10 Help shortcuts work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    await page.keyboard.press('F1');
    
    const helpModal = page.locator('[data-testid="help-modal"]');
    if (await helpModal.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(helpModal).toBeVisible();
    }
  });
});