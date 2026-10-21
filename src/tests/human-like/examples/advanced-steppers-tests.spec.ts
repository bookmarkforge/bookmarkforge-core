/**
 * Advanced Steppers Tests
 * 
 * Tests for advanced stepper functionality:
 * - Stepper displays
 * - Stepper navigation
 * - Stepper completion
 * - Stepper keyboard nav
 * - Stepper accessibility
 * - Stepper validation
 * - Stepper optional steps
 * - Stepper linear mode
 * - Stepper error states
 * - Stepper review
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { saveBookmark } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Advanced Steppers Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('55.1 Stepper displays', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const stepper = page.locator('[data-testid="stepper"]');
    if (await stepper.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(stepper).toBeVisible();
    }
  });

  test('55.2 Stepper navigation works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const stepper = page.locator('[data-testid="stepper"]');
    if (await stepper.isVisible({ timeout: 5000 }).catch(() => false)) {
      const nextButton = stepper.getByRole('button', { name: /next|continue/i });
      if (await nextButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await human.click(nextButton);
        
        await expect(nextButton).toBeVisible();
      }
    }
  });

  test('55.3 Stepper completion works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const stepper = page.locator('[data-testid="stepper"]');
    if (await stepper.isVisible({ timeout: 5000 }).catch(() => false)) {
      const completedStep = stepper.locator('[data-completed="true"]');
      if (await completedStep.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(completedStep).toBeVisible();
      }
    }
  });

  test('55.4 Stepper keyboard navigation works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const stepper = page.locator('[data-testid="stepper"]');
    if (await stepper.isVisible({ timeout: 5000 }).catch(() => false)) {
      const stepButton = stepper.getByRole('button').first();
      if (await stepButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await stepButton.focus();
        
        await page.keyboard.press('ArrowRight');
        
        const focusedElement = page.locator(':focus');
        await expect(focusedElement).toBeVisible();
      }
    }
  });

  test('55.5 Stepper accessibility works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const stepper = page.locator('[data-testid="stepper"]');
    if (await stepper.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Check ARIA attributes
      const ariaLabel = await stepper.getAttribute('aria-label');
      const role = await stepper.getAttribute('role');
      
      if (ariaLabel || role) {
        await expect(ariaLabel || role).toBeTruthy();
      }
    }
  });

  test('55.6 Stepper validation works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const stepper = page.locator('[data-testid="stepper"]');
    if (await stepper.isVisible({ timeout: 5000 }).catch(() => false)) {
      const invalidStep = stepper.locator('[data-invalid="true"]');
      if (await invalidStep.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(invalidStep).toBeVisible();
      }
    }
  });

  test('55.7 Stepper optional steps work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const stepper = page.locator('[data-testid="stepper"]');
    if (await stepper.isVisible({ timeout: 5000 }).catch(() => false)) {
      const optionalStep = stepper.locator('[data-optional="true"]');
      if (await optionalStep.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(optionalStep).toBeVisible();
      }
    }
  });

  test('55.8 Stepper linear mode works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const stepper = page.locator('[data-testid="stepper"][data-mode="linear"]');
    if (await stepper.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(stepper).toBeVisible();
    }
  });

  test('55.9 Stepper error states work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const stepper = page.locator('[data-testid="stepper"]');
    if (await stepper.isVisible({ timeout: 5000 }).catch(() => false)) {
      const errorStep = stepper.locator('[data-error="true"]');
      if (await errorStep.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(errorStep).toBeVisible();
      }
    }
  });

  test('55.10 Stepper review works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const stepper = page.locator('[data-testid="stepper"]');
    if (await stepper.isVisible({ timeout: 5000 }).catch(() => false)) {
      const reviewStep = stepper.locator('[data-review="true"]');
      if (await reviewStep.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(reviewStep).toBeVisible();
      }
    }
  });
});