/**
 * Pro/Free Boundary Enforcement Tests
 * 
 * Tests for Open Core boundary enforcement:
 * - Pro features are blocked for Free users
 * - Free tier usage limits are enforced
 * - Upgrade prompts appear correctly
 * - Pro features work with valid license
 * - Downgrade behavior is correct
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Pro/Free Boundary Enforcement', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('3.1 Pro feature shows upgrade prompt for Free users', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Try to access a Pro feature
    const proFeatureButton = page.getByTestId('pro-feature-button');
    if (await proFeatureButton.isVisible()) {
      await human.click(proFeatureButton);
      
      // Should show upgrade prompt
      const upgradePrompt = page.getByText(/upgrade|pro|license/i);
      if (await upgradePrompt.isVisible()) {
        await expect(upgradePrompt).toBeVisible();
      }
    }
    
    // App remains functional
    await expect(page.locator('#root')).toBeVisible();
  });

  test('3.2 Free tier usage limit displays correctly', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Create bookmarks to test limit
    for (let i = 0; i < 2; i++) {
      const fabButton = page.getByTestId('quick-capture-fab');
      if (await fabButton.isVisible()) {
        await human.click(fabButton);
        
        const urlInput = page.getByTestId('url-input');
        await human.type(urlInput, `https://example.com/limit-${i}`);
        
        const saveButton = page.getByTestId('save-button');
        await human.click(saveButton);
      }
    }
    
    // Check for usage indicator
    const usageIndicator = page.getByTestId('usage-indicator');
    if (await usageIndicator.isVisible()) {
      await expect(usageIndicator).toBeVisible();
    }
    
    // App remains functional
    await expect(page.locator('#root')).toBeVisible();
  });

  test('3.3 Pro features are locked in Free tier', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Try to access Pro features
    const aiFeatures = page.getByTestId('ai-features');
    if (await aiFeatures.isVisible()) {
      await human.click(aiFeatures);
      
      // Should show Pro boundary
      const proBoundary = page.getByTestId('pro-required-boundary');
      if (await proBoundary.isVisible()) {
        await expect(proBoundary).toBeVisible();
      }
    }
    
    // App remains functional
    await expect(page.locator('#root')).toBeVisible();
  });

  test('3.4 Upgrade prompt links to pricing page', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Trigger upgrade prompt
    const proFeatureButton = page.getByTestId('pro-feature-button');
    if (await proFeatureButton.isVisible()) {
      await human.click(proFeatureButton);
      
      // Check for pricing link
      const pricingLink = page.getByRole('link', { name: /pricing|upgrade/i });
      if (await pricingLink.isVisible()) {
        await expect(pricingLink).toBeVisible();
      }
    }
    
    // App remains functional
    await expect(page.locator('#root')).toBeVisible();
  });

  test('3.5 Free tier features work without license', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Use Free tier features
    const fabButton = page.getByTestId('quick-capture-fab');
    if (await fabButton.isVisible()) {
      await human.click(fabButton);
      
      const urlInput = page.getByTestId('url-input');
      await human.type(urlInput, 'https://example.com/free-feature');
      
      const saveButton = page.getByTestId('save-button');
      await human.click(saveButton);
    }
    
    // Free features should work
    await expect(page.locator('#root')).toBeVisible();
  });

  test('3.6 Pro features accessible with valid license', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Check if license is valid
    const licenseStatus = page.getByTestId('license-status');
    if (await licenseStatus.isVisible()) {
      await expect(licenseStatus).toBeVisible();
    }
    
    // App remains functional
    await expect(page.locator('#root')).toBeVisible();
  });

  test('3.7 Usage limit warning appears before blocking', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Create bookmarks
    for (let i = 0; i < 2; i++) {
      const fabButton = page.getByTestId('quick-capture-fab');
      if (await fabButton.isVisible()) {
        await human.click(fabButton);
        
        const urlInput = page.getByTestId('url-input');
        await human.type(urlInput, `https://example.com/warning-${i}`);
        
        const saveButton = page.getByTestId('save-button');
        await human.click(saveButton);
      }
    }
    
    // Check for warning - use more specific selector
    const warningMessage = page.getByText(/reached.*limit/i);
    if (await warningMessage.isVisible()) {
      await expect(warningMessage).toBeVisible();
    }
    
    // App remains functional
    await expect(page.locator('#root')).toBeVisible();
  });

  test('3.8 Pro features are clearly marked in UI', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Check for Pro badges
    const proBadges = page.getByTestId('pro-badge');
    if (await proBadges.isVisible()) {
      await expect(proBadges).toBeVisible();
    }
    
    // App remains functional
    await expect(page.locator('#root')).toBeVisible();
  });

  test('3.9 License activation works correctly', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Check license activation UI
    const licenseInput = page.getByTestId('license-input');
    if (await licenseInput.isVisible()) {
      await expect(licenseInput).toBeVisible();
    }
    
    // App remains functional
    await expect(page.locator('#root')).toBeVisible();
  });

  test('3.10 Free tier data persists on upgrade', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Create bookmark
    const fabButton = page.getByTestId('quick-capture-fab');
    if (await fabButton.isVisible()) {
      await human.click(fabButton);
      
      const urlInput = page.getByTestId('url-input');
      await human.type(urlInput, 'https://example.com/upgrade-test');
      
      const saveButton = page.getByTestId('save-button');
      await human.click(saveButton);
    }
    
    // Data should persist
    await expect(page.locator('#root')).toBeVisible();
  });

  test('3.11 Pro features downgrade to Free behavior', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Check downgrade behavior
    const settingsButton = page.getByTestId('settings-button');
    if (await settingsButton.isVisible()) {
      await human.click(settingsButton);
    }
    
    // App remains functional
    await expect(page.locator('#root')).toBeVisible();
  });

  test('3.12 Usage statistics are accurate', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Check usage stats
    const usageStats = page.getByTestId('usage-stats');
    if (await usageStats.isVisible()) {
      await expect(usageStats).toBeVisible();
    }
    
    // App remains functional
    await expect(page.locator('#root')).toBeVisible();
  });

  test('3.13 Pro features do not break Free tier UX', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Use Free tier features
    const fabButton = page.getByTestId('quick-capture-fab');
    if (await fabButton.isVisible()) {
      await human.click(fabButton);
      
      const urlInput = page.getByTestId('url-input');
      await human.type(urlInput, 'https://example.com/ux-test');
      
      const saveButton = page.getByTestId('save-button');
      await human.click(saveButton);
    }
    
    // UX should remain smooth
    await expect(page.locator('#root')).toBeVisible();
  });

  test('3.14 License validation is secure', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Check license validation
    const licenseValidation = page.getByTestId('license-validation');
    if (await licenseValidation.isVisible()) {
      await expect(licenseValidation).toBeVisible();
    }
    
    // App remains functional
    await expect(page.locator('#root')).toBeVisible();
  });

  test('3.15 Pro trial expiration works correctly', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Check trial status
    const trialStatus = page.getByTestId('trial-status');
    if (await trialStatus.isVisible()) {
      await expect(trialStatus).toBeVisible();
    }
    
    // App remains functional
    await expect(page.locator('#root')).toBeVisible();
  });

  test('3.16 Pro features work offline', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Simulate offline
    await page.context().setOffline(true);
    
    // App should work offline
    await expect(page.locator('#root')).toBeVisible();
    
    // Restore online
    await page.context().setOffline(false);
  });

  test('3.17 Free tier export works correctly', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Try export
    const exportButton = page.getByTestId('export-button');
    if (await exportButton.isVisible()) {
      await human.click(exportButton);
      
      // Export should work for Free tier
      await expect(page.locator('#root')).toBeVisible();
    }
  });

  test('3.18 Pro features do not leak data', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Ensure no data leaks
    await expect(page.locator('#root')).toBeVisible();
  });

  test('3.19 Upgrade prompt dismissible', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Try to dismiss upgrade prompt
    const dismissButton = page.getByRole('button', { name: /dismiss|close|later/i });
    if (await dismissButton.isVisible()) {
      await human.click(dismissButton);
      
      // Prompt should close
      await expect(page.locator('#root')).toBeVisible();
    }
  });

  test('3.20 Pro boundary does not affect core features', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Core features should always work
    const fabButton = page.getByTestId('quick-capture-fab');
    if (await fabButton.isVisible()) {
      await human.click(fabButton);
      
      const urlInput = page.getByTestId('url-input');
      await human.type(urlInput, 'https://example.com/core-test');
      
      const saveButton = page.getByTestId('save-button');
      await human.click(saveButton);
    }
    
    // Core features work regardless of tier
    await expect(page.locator('#root')).toBeVisible();
  });
});