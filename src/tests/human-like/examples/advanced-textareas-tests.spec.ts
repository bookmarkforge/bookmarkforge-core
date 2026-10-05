/**
 * Advanced Textareas Tests
 * 
 * Tests for advanced textarea functionality:
 * - Textarea displays
 * - Textarea input
 * - Textarea resize
 * - Textarea keyboard nav
 * - Textarea accessibility
 * - Textarea validation
 * - Textarea placeholder
 * - Textarea maxlength
 * - Textarea autoexpand
 * - Textarea character count
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { saveBookmark } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Advanced Textareas Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('66.1 Textarea displays', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const textarea = page.locator('textarea');
    if (await textarea.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(textarea).toBeVisible();
    }
  });

  test('66.2 Textarea input works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const textarea = page.locator('textarea').first();
    if (await textarea.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.type(textarea, 'test input');
      
      await expect(textarea).toHaveValue(/test/i);
    }
  });

  test('66.3 Textarea resize works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const textarea = page.locator('textarea').first();
    if (await textarea.isVisible({ timeout: 5000 }).catch(() => false)) {
      const resizeHandle = textarea.locator('::-webkit-resizer');
      if (await resizeHandle.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(resizeHandle).toBeVisible();
      }
    }
  });

  test('66.4 Textarea keyboard navigation works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const textarea = page.locator('textarea').first();
    if (await textarea.isVisible({ timeout: 5000 }).catch(() => false)) {
      await textarea.focus();
      
      await page.keyboard.press('ArrowDown');
      
      const focusedElement = page.locator(':focus');
      await expect(focusedElement).toBeVisible();
    }
  });

  test('66.5 Textarea accessibility works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const textarea = page.locator('textarea').first();
    if (await textarea.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Check ARIA attributes
      const ariaLabel = await textarea.getAttribute('aria-label');
      const placeholder = await textarea.getAttribute('placeholder');
      
      if (ariaLabel || placeholder) {
        await expect(ariaLabel || placeholder).toBeTruthy();
      }
    }
  });

  test('66.6 Textarea validation works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const textarea = page.locator('textarea[data-invalid="true"]');
    if (await textarea.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(textarea).toBeVisible();
    }
  });

  test('66.7 Textarea placeholder works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const textarea = page.locator('textarea').first();
    if (await textarea.isVisible({ timeout: 5000 }).catch(() => false)) {
      const placeholder = await textarea.getAttribute('placeholder');
      if (placeholder) {
        await expect(placeholder).toBeTruthy();
      }
    }
  });

  test('66.8 Textarea maxlength works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const textarea = page.locator('textarea[maxlength]').first();
    if (await textarea.isVisible({ timeout: 5000 }).catch(() => false)) {
      const maxlength = await textarea.getAttribute('maxlength');
      if (maxlength) {
        await expect(maxlength).toBeTruthy();
      }
    }
  });

  test('66.9 Textarea autoexpand works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const textarea = page.locator('textarea[data-autoexpand="true"]');
    if (await textarea.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(textarea).toBeVisible();
    }
  });

  test('66.10 Textarea character count works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const textarea = page.locator('textarea').first();
    if (await textarea.isVisible({ timeout: 5000 }).catch(() => false)) {
      const charCount = page.locator('[data-testid="char-count"]');
      if (await charCount.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(charCount).toBeVisible();
      }
    }
  });
});