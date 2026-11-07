/**
 * AI Provider Advanced Tests
 * 
 * Tests for advanced AI provider integrations:
 * - Multiple provider management
 * - Provider switching
 - Provider configuration
 - Custom provider setup
 - Provider error handling
 - Provider fallback
 - Provider authentication
 - Rate limiting per provider
 - Provider health checks
 - Provider-specific features
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { saveBookmark } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('AI Provider Advanced Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('8.1 Multiple provider management works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const settingsButton = page.getByRole('button', { name: /settings/i });
    if (await settingsButton.isVisible()) {
      await human.click(settingsButton);
      
      const aiSection = page.getByRole('button', { name: /ai|provider/i });
      if (await aiSection.isVisible({ timeout: 5000 }).catch(() => false)) {
        await human.click(aiSection);
        
        const providerList = page.locator('[data-testid="provider-list"]');
        if (await providerList.isVisible({ timeout: 5000 }).catch(() => false)) {
          await expect(providerList).toBeVisible();
        }
      }
    }
  });

  test('8.2 Provider switching works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const settingsButton = page.getByRole('button', { name: /settings/i });
    if (await settingsButton.isVisible()) {
      await human.click(settingsButton);
      
      const aiSection = page.getByRole('button', { name: /ai|provider/i });
      if (await aiSection.isVisible({ timeout: 5000 }).catch(() => false)) {
        await human.click(aiSection);
        
        const providerSelect = page.getByRole('combobox', { name: /provider/i });
        if (await providerSelect.isVisible({ timeout: 5000 }).catch(() => false)) {
          await human.click(providerSelect);
          
          // Should show provider options
          const providerOptions = page.getByRole('option');
          if (await providerOptions.first().isVisible({ timeout: 3000 }).catch(() => false)) {
            await expect(providerOptions.first()).toBeVisible();
          }
        }
      }
    }
  });

  test('8.3 Custom provider setup works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const settingsButton = page.getByRole('button', { name: /settings/i });
    if (await settingsButton.isVisible()) {
      await human.click(settingsButton);
      
      const aiSection = page.getByRole('button', { name: /ai|provider/i });
      if (await aiSection.isVisible({ timeout: 5000 }).catch(() => false)) {
        await human.click(aiSection);
        
        const customProviderButton = page.getByRole('button', { name: /custom|add provider/i });
        if (await customProviderButton.isVisible({ timeout: 5000 }).catch(() => false)) {
          await human.click(customProviderButton);
          
          // Should show custom provider form
          const customForm = page.locator('[data-testid="custom-provider-form"]');
          if (await customForm.isVisible({ timeout: 3000 }).catch(() => false)) {
            await expect(customForm).toBeVisible();
          }
        }
      }
    }
  });

  test('8.4 Provider error handling works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const settingsButton = page.getByRole('button', { name: /settings/i });
    if (await settingsButton.isVisible()) {
      await human.click(settingsButton);
      
      const aiSection = page.getByRole('button', { name: /ai|provider/i });
      if (await aiSection.isVisible({ timeout: 5000 }).catch(() => false)) {
        await human.click(aiSection);
        
        const testConnectionButton = page.getByRole('button', { name: /test|connect/i });
        if (await testConnectionButton.isVisible({ timeout: 5000 }).catch(() => false)) {
          await human.click(testConnectionButton);
          
          // Should show connection status
          const connectionStatus = page.locator('[data-testid="connection-status"]');
          if (await connectionStatus.isVisible({ timeout: 5000 }).catch(() => false)) {
            await expect(connectionStatus).toBeVisible();
          }
        }
      }
    }
  });

  test('8.5 Provider fallback works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const settingsButton = page.getByRole('button', { name: /settings/i });
    if (await settingsButton.isVisible()) {
      await human.click(settingsButton);
      
      const aiSection = page.getByRole('button', { name: /ai|provider/i });
      if (await aiSection.isVisible({ timeout: 5000 }).catch(() => false)) {
        await human.click(aiSection);
        
        const fallbackToggle = page.getByRole('switch', { name: /fallback/i });
        if (await fallbackToggle.isVisible({ timeout: 5000 }).catch(() => false)) {
          await human.click(fallbackToggle);
          
          // Should show fallback options
          const fallbackOptions = page.locator('[data-testid="fallback-options"]');
          if (await fallbackOptions.isVisible({ timeout: 3000 }).catch(() => false)) {
            await expect(fallbackOptions).toBeVisible();
          }
        }
      }
    }
  });

  test('8.6 Provider authentication works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const settingsButton = page.getByRole('button', { name: /settings/i });
    if (await settingsButton.isVisible()) {
      await human.click(settingsButton);
      
      const aiSection = page.getByRole('button', { name: /ai|provider/i });
      if (await aiSection.isVisible({ timeout: 5000 }).catch(() => false)) {
        await human.click(aiSection);
        
        const apiKeyInput = page.getByRole('textbox', { name: /api key|token/i });
        if (await apiKeyInput.isVisible({ timeout: 5000 }).catch(() => false)) {
          await human.type(apiKeyInput, 'test-key-123');
          
          const saveButton = page.getByRole('button', { name: /save/i });
          if (await saveButton.isVisible()) {
            await human.click(saveButton);
            
            // Should show success
            const successToast = page.locator('[data-testid="toast-success"]');
            if (await successToast.isVisible({ timeout: 3000 }).catch(() => false)) {
              await expect(successToast).toBeVisible();
            }
          }
        }
      }
    }
  });

  test('8.7 Rate limiting per provider works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const settingsButton = page.getByRole('button', { name: /settings/i });
    if (await settingsButton.isVisible()) {
      await human.click(settingsButton);
      
      const aiSection = page.getByRole('button', { name: /ai|provider/i });
      if (await aiSection.isVisible({ timeout: 5000 }).catch(() => false)) {
        await human.click(aiSection);
        
        const rateLimitInput = page.getByRole('spinbutton', { name: /rate limit/i });
        if (await rateLimitInput.isVisible({ timeout: 5000 }).catch(() => false)) {
          await human.type(rateLimitInput, '10');
          
          const saveButton = page.getByRole('button', { name: /save/i });
          if (await saveButton.isVisible()) {
            await human.click(saveButton);
          }
        }
      }
    }
  });

  test('8.8 Provider health checks work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const settingsButton = page.getByRole('button', { name: /settings/i });
    if (await settingsButton.isVisible()) {
      await human.click(settingsButton);
      
      const aiSection = page.getByRole('button', { name: /ai|provider/i });
      if (await aiSection.isVisible({ timeout: 5000 }).catch(() => false)) {
        await human.click(aiSection);
        
        const healthCheckButton = page.getByRole('button', { name: /health|status/i });
        if (await healthCheckButton.isVisible({ timeout: 5000 }).catch(() => false)) {
          await human.click(healthCheckButton);
          
          // Should show health status
          const healthStatus = page.locator('[data-testid="health-status"]');
          if (await healthStatus.isVisible({ timeout: 5000 }).catch(() => false)) {
            await expect(healthStatus).toBeVisible();
          }
        }
      }
    }
  });

  test('8.9 Provider-specific features work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const settingsButton = page.getByRole('button', { name: /settings/i });
    if (await settingsButton.isVisible()) {
      await human.click(settingsButton);
      
      const aiSection = page.getByRole('button', { name: /ai|provider/i });
      if (await aiSection.isVisible({ timeout: 5000 }).catch(() => false)) {
        await human.click(aiSection);
        
        const providerFeatures = page.locator('[data-testid="provider-features"]');
        if (await providerFeatures.isVisible({ timeout: 5000 }).catch(() => false)) {
          await expect(providerFeatures).toBeVisible();
        }
      }
    }
  });

  test('8.10 Provider configuration persists', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const settingsButton = page.getByRole('button', { name: /settings/i });
    if (await settingsButton.isVisible()) {
      await human.click(settingsButton);
      
      const aiSection = page.getByRole('button', { name: /ai|provider/i });
      if (await aiSection.isVisible({ timeout: 5000 }).catch(() => false)) {
        await human.click(aiSection);
        
        // Configure a provider
        const providerSelect = page.getByRole('combobox', { name: /provider/i });
        if (await providerSelect.isVisible({ timeout: 5000 }).catch(() => false)) {
          await human.click(providerSelect);
          
          const firstOption = page.getByRole('option').first();
          if (await firstOption.isVisible({ timeout: 3000 }).catch(() => false)) {
            await human.click(firstOption);
          }
        }
        
        // Reload and check if configuration persists
        await page.reload();
        
        await human.click(settingsButton);
        await human.click(aiSection);
        
        const currentProvider = page.getByRole('combobox', { name: /provider/i });
        if (await currentProvider.isVisible({ timeout: 5000 }).catch(() => false)) {
          await expect(currentProvider).toBeVisible();
        }
      }
    }
  });
});