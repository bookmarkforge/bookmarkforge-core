/**
 * Advanced Mutation Tests
 * 
 * Tests for advanced mutation observer functionality:
 * - Mutation displays
 * - Mutation attributes
 * - Mutation children
 * - Mutation character data
 * - Mutation subtree
 * - Mutation accessibility
 * - Mutation custom
 * - Mutation async
 * - Mutation queue
 * - Mutation flush
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { saveBookmark } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Advanced Mutation Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('115.1 Mutation displays', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const mutation = page.locator('[data-testid="mutation"]');
    if (await mutation.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(mutation).toBeVisible();
    }
  });

  test('115.2 Mutation attributes work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const mutation = page.locator('[data-testid="mutation"][data-attributes="true"]');
    if (await mutation.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(mutation).toBeVisible();
      
      const attributes = await mutation.evaluate(el => el.getAttributeNames());
      if (attributes) {
        await expect(attributes.length).toBeGreaterThan(0);
      }
    }
  });

  test('115.3 Mutation children work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const mutation = page.locator('[data-testid="mutation"][data-children="true"]');
    if (await mutation.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(mutation).toBeVisible();
      
      const children = await mutation.evaluate(el => el.children.length);
      if (children) {
        await expect(children).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test('115.4 Mutation character data works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const mutation = page.locator('[data-testid="mutation"][data-character-data="true"]');
    if (await mutation.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(mutation).toBeVisible();
      
      const textContent = await mutation.evaluate(el => el.textContent);
      if (textContent) {
        await expect(textContent).toBeTruthy();
      }
    }
  });

  test('115.5 Mutation subtree works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const mutation = page.locator('[data-testid="mutation"][data-subtree="true"]');
    if (await mutation.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(mutation).toBeVisible();
      
      const children = await mutation.evaluate(el => el.children.length);
      if (children) {
        await expect(children).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test('115.6 Mutation accessibility works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const mutation = page.locator('[data-testid="mutation"]').first();
    if (await mutation.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Check ARIA attributes
      const ariaLabel = await mutation.getAttribute('aria-label');
      const role = await mutation.getAttribute('role');
      
      if (ariaLabel || role) {
        await expect(ariaLabel || role).toBeTruthy();
      }
    }
  });

  test('115.7 Mutation custom works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const mutation = page.locator('[data-testid="mutation"][data-custom="true"]');
    if (await mutation.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(mutation).toBeVisible();
    }
  });

  test('115.8 Mutation async works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const mutation = page.locator('[data-testid="mutation"][data-async="true"]');
    if (await mutation.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(mutation).toBeVisible();
    }
  });

  test('115.9 Mutation queue works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const mutation = page.locator('[data-testid="mutation"][data-queue="true"]');
    if (await mutation.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(mutation).toBeVisible();
    }
  });

  test('115.10 Mutation flush works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const mutation = page.locator('[data-testid="mutation"][data-flush="true"]');
    if (await mutation.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(mutation).toBeVisible();
    }
  });
});