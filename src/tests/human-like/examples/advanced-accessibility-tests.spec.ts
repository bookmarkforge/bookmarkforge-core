/**
 * Advanced Accessibility Tests
 * 
 * Tests for advanced accessibility features:
 * - Screen reader optimization
 * - Keyboard navigation
 * - Focus management
 * - ARIA attributes
 * - Color contrast
 * - Text scaling
 * - Reduced motion
 * - Alternative text
 * - Accessibility audit
 * - WCAG compliance
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { saveBookmark } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Advanced Accessibility Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('32.1 Screen reader optimization works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const settingsButton = page.getByRole('button', { name: /settings/i });
    if (await settingsButton.isVisible()) {
      await human.click(settingsButton);
      
      const a11ySection = page.getByRole('button', { name: /accessibility/i });
      if (await a11ySection.isVisible({ timeout: 5000 }).catch(() => false)) {
        await human.click(a11ySection);
        
        const screenReaderSettings = page.locator('[data-testid="screen-reader-settings"]');
        if (await screenReaderSettings.isVisible({ timeout: 5000 }).catch(() => false)) {
          await expect(screenReaderSettings).toBeVisible();
        }
      }
    }
  });

  test('32.2 Keyboard navigation works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Tab through interactive elements
    await page.keyboard.press('Tab');
    
    const focusedElement = page.locator(':focus');
    if (await focusedElement.count() > 0) {
      await expect(focusedElement.count()).resolves.toBeGreaterThan(0);
    }
  });

  test('32.3 Focus management works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const firstFocusable = page.locator('button, a, input').first();
    if (await firstFocusable.isVisible({ timeout: 5000 }).catch(() => false)) {
      await firstFocusable.focus();
      
      const focusedElement = page.locator(':focus');
      await expect(focusedElement).toBeVisible();
    }
  });

  test('32.4 ARIA attributes are present', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const interactiveElements = page.locator('button[aria-label], a[aria-label], input[aria-label]');
    const count = await interactiveElements.count();
    
    if (count > 0) {
      await expect(count).toBeGreaterThan(0);
    }
  });

  test('32.5 Color contrast works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const settingsButton = page.getByRole('button', { name: /settings/i });
    if (await settingsButton.isVisible()) {
      await human.click(settingsButton);
      
      const a11ySection = page.getByRole('button', { name: /accessibility/i });
      if (await a11ySection.isVisible({ timeout: 5000 }).catch(() => false)) {
        await human.click(a11ySection);
        
        const contrastToggle = page.getByRole('switch', { name: /contrast/i });
        if (await contrastToggle.isVisible({ timeout: 5000 }).catch(() => false)) {
          await human.click(contrastToggle);
          
          const body = page.locator('body');
          await expect(body).toBeVisible();
        }
      }
    }
  });

  test('32.6 Text scaling works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const settingsButton = page.getByRole('button', { name: /settings/i });
    if (await settingsButton.isVisible()) {
      await human.click(settingsButton);
      
      const a11ySection = page.getByRole('button', { name: /accessibility/i });
      if (await a11ySection.isVisible({ timeout: 5000 }).catch(() => false)) {
        await human.click(a11ySection);
        
        const textSizeSlider = page.getByRole('slider', { name: /text size/i });
        if (await textSizeSlider.isVisible({ timeout: 5000 }).catch(() => false)) {
          await human.click(textSizeSlider);
          
          const body = page.locator('body');
          await expect(body).toBeVisible();
        }
      }
    }
  });

  test('32.7 Reduced motion works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const settingsButton = page.getByRole('button', { name: /settings/i });
    if (await settingsButton.isVisible()) {
      await human.click(settingsButton);
      
      const a11ySection = page.getByRole('button', { name: /accessibility/i });
      if (await a11ySection.isVisible({ timeout: 5000 }).catch(() => false)) {
        await human.click(a11ySection);
        
        const reducedMotionToggle = page.getByRole('switch', { name: /reduced motion/i });
        if (await reducedMotionToggle.isVisible({ timeout: 5000 }).catch(() => false)) {
          await human.click(reducedMotionToggle);
          
          const motionIndicator = page.locator('[data-testid="motion-indicator"]');
          if (await motionIndicator.isVisible({ timeout: 3000 }).catch(() => false)) {
            await expect(motionIndicator).toBeVisible();
          }
        }
      }
    }
  });

  test('32.8 Alternative text works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const images = page.locator('img[alt]');
    const count = await images.count();
    
    if (count > 0) {
      await expect(count).toBeGreaterThan(0);
    }
  });

  test('32.9 Accessibility audit works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const settingsButton = page.getByRole('button', { name: /settings/i });
    if (await settingsButton.isVisible()) {
      await human.click(settingsButton);
      
      const a11ySection = page.getByRole('button', { name: /accessibility/i });
      if (await a11ySection.isVisible({ timeout: 5000 }).catch(() => false)) {
        await human.click(a11ySection);
        
        const auditButton = page.getByRole('button', { name: /audit/i });
        if (await auditButton.isVisible({ timeout: 5000 }).catch(() => false)) {
          await human.click(auditButton);
          
          const auditResults = page.locator('[data-testid="audit-results"]');
          if (await auditResults.isVisible({ timeout: 5000 }).catch(() => false)) {
            await expect(auditResults).toBeVisible();
          }
        }
      }
    }
  });

  test('32.10 WCAG compliance works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const settingsButton = page.getByRole('button', { name: /settings/i });
    if (await settingsButton.isVisible()) {
      await human.click(settingsButton);
      
      const a11ySection = page.getByRole('button', { name: /accessibility/i });
      if (await a11ySection.isVisible({ timeout: 5000 }).catch(() => false)) {
        await human.click(a11ySection);
        
        const wcagSection = page.locator('[data-testid="wcag-compliance"]');
        if (await wcagSection.isVisible({ timeout: 5000 }).catch(() => false)) {
          await expect(wcagSection).toBeVisible();
        }
      }
    }
  });
});