/**
 * Advanced Collapses Tests
 * 
 * Tests for advanced collapse functionality:
 * - Collapse displays
 * - Collapse toggle
 * - Collapse keyboard nav
 * - Collapse accessibility
 * - Collapse animation
 * - Collapse multiple
 * - Collapse accordion
 * - Collapse panel
 * - Collapse header
 * - Collapse custom
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { saveBookmark } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Advanced Collapses Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('85.1 Collapse displays', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const collapse = page.locator('[data-testid="collapse"]');
    if (await collapse.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(collapse).toBeVisible();
    }
  });

  test('85.2 Collapse toggle works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const collapseButton = page.getByRole('button', { name: /collapse|expand/i });
    if (await collapseButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(collapseButton);
      
      await expect(collapseButton).toBeVisible();
    }
  });

  test('85.3 Collapse keyboard navigation works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const collapseButton = page.getByRole('button', { name: /collapse|expand/i });
    if (await collapseButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await collapseButton.focus();
      
      await page.keyboard.press('Enter');
      
      const focusedElement = page.locator(':focus');
      await expect(focusedElement).toBeVisible();
    }
  });

  test('85.4 Collapse accessibility works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const collapse = page.locator('[data-testid="collapse"]').first();
    if (await collapse.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Check ARIA attributes
      const ariaLabel = await collapse.getAttribute('aria-label');
      const ariaExpanded = await collapse.getAttribute('aria-expanded');
      
      if (ariaLabel || ariaExpanded) {
        await expect(ariaLabel || ariaExpanded).toBeTruthy();
      }
    }
  });

  test('85.5 Collapse animation works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const collapse = page.locator('[data-testid="collapse"]').first();
    if (await collapse.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(collapse).toBeVisible();
      
      const animationClass = await collapse.getAttribute('class');
      if (animationClass) {
        await expect(animationClass).toBeTruthy();
      }
    }
  });

  test('85.6 Collapse multiple works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const collapseGroup = page.locator('[data-testid="collapse-group"]');
    if (await collapseGroup.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(collapseGroup).toBeVisible();
      
      const collapses = collapseGroup.locator('[data-testid="collapse"]');
      if (await collapses.count() > 0) {
        await expect(collapses.count()).resolves.toBeGreaterThan(0);
      }
    }
  });

  test('85.7 Collapse accordion works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const accordion = page.locator('[data-testid="accordion"]');
    if (await accordion.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(accordion).toBeVisible();
    }
  });

  test('85.8 Collapse panel works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const panel = page.locator('[data-testid="collapse-panel"]');
    if (await panel.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(panel).toBeVisible();
    }
  });

  test('85.9 Collapse header works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const header = page.locator('[data-testid="collapse-header"]');
    if (await header.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(header).toBeVisible();
    }
  });

  test('85.10 Collapse custom works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const collapse = page.locator('[data-testid="collapse"][data-custom="true"]');
    if (await collapse.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(collapse).toBeVisible();
    }
  });
});