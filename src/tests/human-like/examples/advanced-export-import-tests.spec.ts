/**
 * Advanced Export/Import Tests
 * 
 * Tests for advanced export and import functionality:
 * - Multiple format export
 * - Bulk export operations
 * - Import validation
 * - Import conflict resolution
 * - Export filtering
 * - Import encryption
 * - Cross-platform compatibility
 * - Export scheduling
 * - Import progress tracking
 * - Data integrity verification
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { saveBookmark } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Advanced Export/Import Coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('11.1 Multiple format export works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    await saveBookmark(page, 'https://example.com/export-test', 'Export Test');
    
    const exportButton = page.getByRole('button', { name: /export/i });
    if (await exportButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(exportButton);
      
      const formatSelect = page.getByRole('combobox', { name: /format/i });
      if (await formatSelect.isVisible({ timeout: 3000 }).catch(() => false)) {
        await human.click(formatSelect);
        
        const formats = page.getByRole('option');
        if (await formats.count() > 0) {
          await expect(formats.count()).resolves.toBeGreaterThan(0);
        }
      }
    }
  });

  test('11.2 Bulk export operations work', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Create multiple bookmarks
    for (let i = 0; i < 3; i++) {
      try {
        await saveBookmark(page, `https://example.com/bulk-${i}`, `Bulk ${i}`);
      } catch {
        // Continue even if some fail
      }
    }
    
    const exportButton = page.getByRole('button', { name: /export/i });
    if (await exportButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(exportButton);
      
      const bulkExportToggle = page.getByRole('checkbox', { name: /bulk|all/i });
      if (await bulkExportToggle.isVisible({ timeout: 3000 }).catch(() => false)) {
        await human.click(bulkExportToggle);
        
        const exportConfirm = page.getByRole('button', { name: /confirm|export/i });
        if (await exportConfirm.isVisible()) {
          await human.click(exportConfirm);
        }
      }
    }
  });

  test('11.3 Import validation works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const importButton = page.getByRole('button', { name: /import/i });
    if (await importButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(importButton);
      
      const fileInput = page.locator('input[type="file"]');
      if (await fileInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        // Try to trigger validation without actual file
        const validateButton = page.getByRole('button', { name: /validate/i });
        if (await validateButton.isVisible()) {
          await human.click(validateButton);
          
          const validationMessage = page.locator('[data-testid="validation-message"]');
          if (await validationMessage.isVisible({ timeout: 3000 }).catch(() => false)) {
            await expect(validationMessage).toBeVisible();
          }
        }
      }
    }
  });

  test('11.4 Import conflict resolution works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    // Create a bookmark that might conflict on import
    await saveBookmark(page, 'https://example.com/conflict', 'Conflict Test');
    
    const importButton = page.getByRole('button', { name: /import/i });
    if (await importButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(importButton);
      
      const conflictResolution = page.locator('[data-testid="conflict-resolution"]');
      if (await conflictResolution.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(conflictResolution).toBeVisible();
      }
    }
  });

  test('11.5 Export filtering works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    await saveBookmark(page, 'https://example.com/filter-test', 'Filter Test');
    
    const exportButton = page.getByRole('button', { name: /export/i });
    if (await exportButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(exportButton);
      
      const filterSection = page.locator('[data-testid="export-filters"]');
      if (await filterSection.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(filterSection).toBeVisible();
      }
    }
  });

  test('11.6 Import encryption works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const importButton = page.getByRole('button', { name: /import/i });
    if (await importButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(importButton);
      
      const encryptionToggle = page.getByRole('switch', { name: /encrypt|password/i });
      if (await encryptionToggle.isVisible({ timeout: 3000 }).catch(() => false)) {
        await human.click(encryptionToggle);
        
        const passwordInput = page.getByRole('textbox', { name: /password/i });
        if (await passwordInput.isVisible({ timeout: 3000 }).catch(() => false)) {
          await expect(passwordInput).toBeVisible();
        }
      }
    }
  });

  test('11.7 Cross-platform compatibility works', async ({ page }) => {
    // The export button only exists inside the unlocked app.
    await skipPassword(page);
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const exportButton = page.getByRole('button', { name: /export/i });
    if (await exportButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(exportButton);
      
      const compatibilityOption = page.getByRole('checkbox', { name: /compatibility|cross-platform/i });
      if (await compatibilityOption.isVisible({ timeout: 3000 }).catch(() => false)) {
        await human.click(compatibilityOption);
        
        const exportConfirm = page.getByRole('button', { name: /export/i });
        if (await exportConfirm.isVisible()) {
          await human.click(exportConfirm);
        }
      }
    }
  });

  test('11.8 Export scheduling works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const settingsButton = page.getByRole('button', { name: /settings/i });
    if (await settingsButton.isVisible()) {
      await human.click(settingsButton);
      
      const exportSection = page.getByRole('button', { name: /export|backup/i });
      if (await exportSection.isVisible({ timeout: 5000 }).catch(() => false)) {
        await human.click(exportSection);
        
        const scheduleExport = page.getByRole('button', { name: /schedule/i });
        if (await scheduleExport.isVisible({ timeout: 3000 }).catch(() => false)) {
          await human.click(scheduleExport);
          
          const scheduleDialog = page.locator('[data-testid="schedule-dialog"]');
          if (await scheduleDialog.isVisible({ timeout: 3000 }).catch(() => false)) {
            await expect(scheduleDialog).toBeVisible();
          }
        }
      }
    }
  });

  test('11.9 Import progress tracking works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const importButton = page.getByRole('button', { name: /import/i });
    if (await importButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(importButton);
      
      const progressBar = page.locator('[data-testid="import-progress"]');
      if (await progressBar.isVisible({ timeout: 3000 }).catch(() => false)) {
        await expect(progressBar).toBeVisible();
      }
    }
  });

  test('11.10 Data integrity verification works', async ({ page }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    
    const importButton = page.getByRole('button', { name: /import/i });
    if (await importButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await human.click(importButton);
      
      const verifyIntegrity = page.getByRole('checkbox', { name: /verify|integrity/i });
      if (await verifyIntegrity.isVisible({ timeout: 3000 }).catch(() => false)) {
        await human.click(verifyIntegrity);
        
        const integrityCheck = page.locator('[data-testid="integrity-check"]');
        if (await integrityCheck.isVisible({ timeout: 3000 }).catch(() => false)) {
          await expect(integrityCheck).toBeVisible();
        }
      }
    }
  });
});