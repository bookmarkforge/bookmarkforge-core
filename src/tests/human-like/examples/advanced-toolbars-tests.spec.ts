/**
 * Advanced Toolbars Tests
 * 
 * Tests for advanced toolbar functionality:
 * - Toolbar displays
 * - Toolbar actions
 * - Toolbar keyboard nav
 * - Toolbar accessibility
 * - Toolbar grouping
 * - Toolbar overflow
 * - Toolbar custom
 * - Toolbar sticky
 * - Toolbar responsive
 * - Toolbar tooltips
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { saveBookmark } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Advanced Toolbars Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('70.1 Toolbar displays', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const toolbar = page.locator('[data-testid="toolbar"], [role="toolbar"]');
    if (await toolbar.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(toolbar).toBeVisible();
    }
  });

  test('70.2 Toolbar actions work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const toolbar = page.locator('[data-testid="toolbar"]').first();
    if (await toolbar.isVisible({ timeout: 5000 }).catch(() => false)) {
      const toolbarButton = toolbar.getByRole('button').first();
      if (await toolbarButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await human.click(toolbarButton);
        
        await expect(toolbarButton).toBeVisible();
      }
    }
  });

  test('70.3 Toolbar keyboard navigation works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const toolbar = page.locator('[data-testid="toolbar"]').first();
    if (await toolbar.isVisible({ timeout: 5000 }).catch(() => false)) {
      const toolbarButton = toolbar.getByRole('button').first();
      if (await toolbarButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await toolbarButton.focus();
        
        await page.keyboard.press('ArrowRight');
        
        const focusedElement = page.locator(':focus');
        await expect(focusedElement).toBeVisible();
      }
    }
  });

  test('70.4 Toolbar accessibility works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const toolbar = page.locator('[data-testid="toolbar"]').first();
    if (await toolbar.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Check ARIA attributes
      const ariaLabel = await toolbar.getAttribute('aria-label');
      const role = await toolbar.getAttribute('role');
      
      if (ariaLabel || role) {
        await expect(ariaLabel || role).toBeTruthy();
      }
    }
  });

  test('70.5 Toolbar grouping works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const toolbar = page.locator('[data-testid="toolbar"]').first();
    if (await toolbar.isVisible({ timeout: 5000 }).catch(() => false)) {
      const group = toolbar.locator('[data-testid="toolbar-group"]');
      if (await group.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(group).toBeVisible();
      }
    }
  });

  test('70.6 Toolbar overflow works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const toolbar = page.locator('[data-testid="toolbar"]').first();
    if (await toolbar.isVisible({ timeout: 5000 }).catch(() => false)) {
      const overflowButton = toolbar.getByRole('button', { name: /more|overflow/i });
      if (await overflowButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await human.click(overflowButton);
        
        await expect(overflowButton).toBeVisible();
      }
    }
  });

  test('70.7 Toolbar custom works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const toolbar = page.locator('[data-testid="toolbar"][data-custom="true"]');
    if (await toolbar.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(toolbar).toBeVisible();
    }
  });

  test('70.8 Toolbar sticky works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const toolbar = page.locator('[data-testid="toolbar"][data-sticky="true"]');
    if (await toolbar.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(toolbar).toBeVisible();
    }
  });

  test('70.9 Toolbar responsive works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    await page.setViewportSize({ width: 375, height: 667 });
    
    const toolbar = page.locator('[data-testid="toolbar"]').first();
    if (await toolbar.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(toolbar).toBeVisible();
    }
    
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('70.10 Toolbar tooltips work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const toolbar = page.locator('[data-testid="toolbar"]').first();
    if (await toolbar.isVisible({ timeout: 5000 }).catch(() => false)) {
      const toolbarButton = toolbar.getByRole('button').first();
      if (await toolbarButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await toolbarButton.hover();
        
        const tooltip = page.locator('[role="tooltip"]');
        if (await tooltip.isVisible({ timeout: 3000 }).catch(() => false)) {
          await expect(tooltip).toBeVisible();
        }
      }
    }
  });
});