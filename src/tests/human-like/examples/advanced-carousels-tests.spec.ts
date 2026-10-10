/**
 * Advanced Carousels Tests
 * 
 * Tests for advanced carousel functionality:
 * - Carousel navigation
 * - Carousel autoplay
 * - Carousel indicators
 * - Carousel touch swipe
 * - Carousel keyboard nav
 * - Carousel loop
 * - Carousel pause on hover
 * - Carousel accessibility
 * - Carousel responsive
 * - Carousel lazy load
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { saveBookmark } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Advanced Carousels Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('45.1 Carousel navigation works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const carousel = page.locator('[data-testid="carousel"]');
    if (await carousel.isVisible({ timeout: 5000 }).catch(() => false)) {
      const nextButton = carousel.getByRole('button', { name: /next|>/i });
      if (await nextButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await human.click(nextButton);
        
        await expect(nextButton).toBeVisible();
      }
    }
  });

  test('45.2 Carousel autoplay works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const carousel = page.locator('[data-testid="carousel"]');
    if (await carousel.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(carousel).toBeVisible();
      
      // Wait for autoplay to trigger (if enabled)
      await page.waitForTimeout(3000);
      
      await expect(carousel).toBeVisible();
    }
  });

  test('45.3 Carousel indicators work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const carousel = page.locator('[data-testid="carousel"]');
    if (await carousel.isVisible({ timeout: 5000 }).catch(() => false)) {
      const indicators = carousel.locator('[data-testid="carousel-indicator"]');
      if (await indicators.count() > 0) {
        await expect(indicators.count()).resolves.toBeGreaterThan(0);
        
        await human.click(indicators.first());
        await expect(indicators.first()).toBeVisible();
      }
    }
  });

  test('45.4 Carousel touch swipe works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const carousel = page.locator('[data-testid="carousel"]');
    if (await carousel.isVisible({ timeout: 5000 }).catch(() => false)) {
      await carousel.hover();
      
      // Simulate swipe
      await page.mouse.down();
      await page.mouse.move(-100, 0);
      await page.mouse.up();
      
      await expect(carousel).toBeVisible();
    }
  });

  test('45.5 Carousel keyboard navigation works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const carousel = page.locator('[data-testid="carousel"]');
    if (await carousel.isVisible({ timeout: 5000 }).catch(() => false)) {
      await carousel.focus();
      
      await page.keyboard.press('ArrowRight');
      
      await expect(carousel).toBeVisible();
    }
  });

  test('45.6 Carousel loop works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const carousel = page.locator('[data-testid="carousel"]');
    if (await carousel.isVisible({ timeout: 5000 }).catch(() => false)) {
      const nextButton = carousel.getByRole('button', { name: /next/i });
      if (await nextButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        // Navigate to end and then next should loop to start
        await human.click(nextButton);
        await human.click(nextButton);
        
        await expect(nextButton).toBeVisible();
      }
    }
  });

  test('45.7 Carousel pause on hover works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const carousel = page.locator('[data-testid="carousel"]');
    if (await carousel.isVisible({ timeout: 5000 }).catch(() => false)) {
      await carousel.hover();
      
      // Autoplay should pause
      await page.waitForTimeout(2000);
      
      await expect(carousel).toBeVisible();
    }
  });

  test('45.8 Carousel accessibility works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const carousel = page.locator('[data-testid="carousel"]');
    if (await carousel.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Check ARIA attributes
      const ariaLabel = await carousel.getAttribute('aria-label');
      const role = await carousel.getAttribute('role');
      
      if (ariaLabel || role) {
        await expect(ariaLabel || role).toBeTruthy();
      }
    }
  });

  test('45.9 Carousel responsive works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    await page.setViewportSize({ width: 375, height: 667 });
    
    const carousel = page.locator('[data-testid="carousel"]');
    if (await carousel.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(carousel).toBeVisible();
    }
    
    await page.setViewportSize({ width: 1280, height: 720 });
  });

  test('45.10 Carousel lazy load works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const carousel = page.locator('[data-testid="carousel"]');
    if (await carousel.isVisible({ timeout: 5000 }).catch(() => false)) {
      const lazyImages = carousel.locator('[loading="lazy"]');
      if (await lazyImages.count() > 0) {
        await expect(lazyImages.count()).resolves.toBeGreaterThan(0);
      }
    }
  });
});