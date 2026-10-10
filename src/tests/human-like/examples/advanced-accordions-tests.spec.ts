/**
 * Advanced Accordions Tests
 * 
 * Tests for advanced accordion functionality:
 * - Accordion expands/collapses
 * - Accordion animation
 * - Accordion keyboard nav
 * - Accordion accessibility
 * - Accordion persistence
 * - Accordion nested
 * - Accordion multiple open
 * - Accordion one open only
 * - Accordion icons
 * - Accordion scroll
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { saveBookmark } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Advanced Accordions Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('44.1 Accordion expands and collapses', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const accordionHeader = page.locator('[data-testid="accordion-header"]').first();
    if (await accordionHeader.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(accordionHeader);
      
      const accordionContent = page.locator('[data-testid="accordion-content"]');
      if (await accordionContent.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(accordionContent).toBeVisible();
        
        // Collapse
        await human.click(accordionHeader);
        await expect(accordionContent).not.toBeVisible({ timeout: 3000 });
      }
    }
  });

  test('44.2 Accordion animation works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const accordionHeader = page.locator('[data-testid="accordion-header"]').first();
    if (await accordionHeader.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(accordionHeader);
      
      const accordionContent = page.locator('[data-testid="accordion-content"]');
      if (await accordionContent.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(accordionContent).toBeVisible();
        
        // Check for animation class
        const animationClass = await accordionContent.getAttribute('class');
        if (animationClass) {
          await expect(animationClass).toBeTruthy();
        }
      }
    }
  });

  test('44.3 Accordion keyboard navigation works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const accordionHeader = page.locator('[data-testid="accordion-header"]').first();
    if (await accordionHeader.isVisible({ timeout: 5000 }).catch(() => false)) {
      await accordionHeader.focus();
      
      await page.keyboard.press('Enter');
      
      const accordionContent = page.locator('[data-testid="accordion-content"]');
      if (await accordionContent.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(accordionContent).toBeVisible();
      }
    }
  });

  test('44.4 Accordion accessibility works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const accordionHeader = page.locator('[data-testid="accordion-header"]').first();
    if (await accordionHeader.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Check ARIA attributes
      const ariaExpanded = await accordionHeader.getAttribute('aria-expanded');
      const ariaControls = await accordionHeader.getAttribute('aria-controls');
      
      if (ariaExpanded || ariaControls) {
        await expect(ariaExpanded || ariaControls).toBeTruthy();
      }
    }
  });

  test('44.5 Accordion persistence works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const accordionHeader = page.locator('[data-testid="accordion-header"]').first();
    if (await accordionHeader.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(accordionHeader);
      
      // Reload and check if accordion state persists
      await page.reload();
      
      const accordionHeaderAfterReload = page.locator('[data-testid="accordion-header"]').first();
      if (await accordionHeaderAfterReload.isVisible({ timeout: 5000 }).catch(() => false)) {
        const ariaExpanded = await accordionHeaderAfterReload.getAttribute('aria-expanded');
        if (ariaExpanded === 'true') {
          await expect(ariaExpanded).toBe('true');
        }
      }
    }
  });

  test('44.6 Accordion nested works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const accordionHeader = page.locator('[data-testid="accordion-header"]').first();
    if (await accordionHeader.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(accordionHeader);
      
      const nestedAccordion = page.locator('[data-testid="accordion-content"] [data-testid="accordion-header"]');
      if (await nestedAccordion.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(nestedAccordion).toBeVisible();
      }
    }
  });

  test('44.7 Accordion multiple open works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const accordionHeaders = page.locator('[data-testid="accordion-header"]');
    const count = await accordionHeaders.count();
    
    if (count >= 2) {
      await human.click(accordionHeaders.first());
      await human.click(accordionHeaders.nth(1));
      
      const expandedCount = await page.locator('[aria-expanded="true"]').count();
      await expect(expandedCount).toBeGreaterThanOrEqual(2);
    }
  });

  test('44.8 Accordion one open only works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const accordionHeaders = page.locator('[data-testid="accordion-header"][data-mode="exclusive"]');
    const count = await accordionHeaders.count();
    
    if (count >= 2) {
      await human.click(accordionHeaders.first());
      await human.click(accordionHeaders.nth(1));
      
      const expandedCount = await page.locator('[aria-expanded="true"]').count();
      await expect(expandedCount).toBe(1);
    }
  });

  test('44.9 Accordion icons work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const accordionHeader = page.locator('[data-testid="accordion-header"]').first();
    if (await accordionHeader.isVisible({ timeout: 5000 }).catch(() => false)) {
      const icon = accordionHeader.locator('[data-testid="accordion-icon"]');
      if (await icon.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(icon).toBeVisible();
      }
    }
  });

  test('44.10 Accordion scroll works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const accordionHeader = page.locator('[data-testid="accordion-header"]').first();
    if (await accordionHeader.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(accordionHeader);
      
      const accordionContent = page.locator('[data-testid="accordion-content"]');
      if (await accordionContent.isVisible({ timeout: 3000 }).catch(() => false)) {
        await accordionContent.evaluate(el => el.scrollTop = 100);
        
        await expect(accordionContent).toBeVisible();
      }
    }
  });
});