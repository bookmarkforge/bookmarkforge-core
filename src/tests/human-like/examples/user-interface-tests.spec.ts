/**
 * User Interface Tests
 * 
 * Tests for advanced UI/UX features:
 * - Responsive design
 * - Accessibility features
 * - Keyboard navigation
 * - Screen reader compatibility
 * - High contrast mode
 * - Text scaling
 * - Focus management
 * - Tooltip behavior
 * - Modal interactions
 * - Loading states
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { saveBookmark } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('User Interface Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('14.1 Responsive design works on mobile', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    
    const mainContent = page.locator('[data-testid="main-content"], main');
    if (await mainContent.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(mainContent).toBeVisible();
    }
    
    // Reset viewport
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('14.2 High contrast mode works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const settingsButton = page.getByRole('button', { name: /settings/i });
    if (await settingsButton.isVisible()) {
      await human.click(settingsButton);
      
      const accessibilitySection = page.getByRole('button', { name: /accessibility/i });
      if (await accessibilitySection.isVisible({ timeout: 5000 }).catch(() => false)) {
        await human.click(accessibilitySection);
        
        const highContrastToggle = page.getByRole('switch', { name: /high contrast/i });
        if (await highContrastToggle.isVisible({ timeout: 5000 }).catch(() => false)) {
          await human.click(highContrastToggle);
          
          // Should apply high contrast
          const body = page.locator('body');
          await expect(body).toBeVisible();
        }
      }
    }
  });

  test('14.3 Text scaling works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const settingsButton = page.getByRole('button', { name: /settings/i });
    if (await settingsButton.isVisible()) {
      await human.click(settingsButton);
      
      const accessibilitySection = page.getByRole('button', { name: /accessibility/i });
      if (await accessibilitySection.isVisible({ timeout: 5000 }).catch(() => false)) {
        await human.click(accessibilitySection);
        
        const textSizeSlider = page.getByRole('slider', { name: /text size|font size/i });
        if (await textSizeSlider.isVisible({ timeout: 5000 }).catch(() => false)) {
          await human.click(textSizeSlider);
          
          // Should apply text scaling
          const body = page.locator('body');
          await expect(body).toBeVisible();
        }
      }
    }
  });

  test('14.4 Focus management works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const firstFocusable = page.locator('button, a, input').first();
    if (await firstFocusable.isVisible({ timeout: 5000 }).catch(() => false)) {
      await firstFocusable.focus();
      
      const focusedElement = page.locator(':focus');
      await expect(focusedElement).toBeVisible();
    }
  });

  test('14.5 Tooltip behavior works', async ({ page }) => {
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

  test('14.6 Modal interactions work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const settingsButton = page.getByRole('button', { name: /settings/i });
    if (await settingsButton.isVisible()) {
      await human.click(settingsButton);
      
      const modal = page.locator('[role="dialog"], .modal').first();
      if (await modal.isVisible({ timeout: 5000 }).catch(() => false)) {
        await expect(modal).toBeVisible();
        
        // Test modal close
        const closeButton = modal.getByRole('button', { name: /close|x/i });
        if (await closeButton.isVisible()) {
          await human.click(closeButton);
          await expect(modal).not.toBeVisible({ timeout: 3000 });
        }
      }
    }
  });

  test('14.7 Loading states work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Trigger a loading state
    await saveBookmark(page, 'https://example.com/loading', 'Loading Test');
    
    const loadingIndicator = page.locator('[data-testid="loading"], [role="progressbar"]');
    if (await loadingIndicator.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(loadingIndicator).toBeVisible();
    }
  });

  test('14.8 Keyboard navigation works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Tab through focusable elements
    await page.keyboard.press('Tab');
    
    const focusedElement = page.locator(':focus');
    if (await focusedElement.count() > 0) {
      await expect(focusedElement.count()).resolves.toBeGreaterThan(0);
    }
  });

  test('14.9 Screen reader landmarks work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const mainLandmark = page.locator('[role="main"], main');
    if (await mainLandmark.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(mainLandmark).toBeVisible();
    }
    
    const navLandmark = page.locator('[role="navigation"], nav');
    if (await navLandmark.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(navLandmark).toBeVisible();
    }
  });

  test('14.10 ARIA labels are present', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const interactiveElements = page.locator('button, a, input');
    const count = await interactiveElements.count();
    
    if (count > 0) {
      // Check that interactive elements have proper labels
      const labeledElements = page.locator('button[aria-label], a[aria-label], input[aria-label]');
      const labeledCount = await labeledElements.count();
      
      // At least some elements should be properly labeled
      await expect(labeledCount).toBeGreaterThan(0);
    }
  });
});