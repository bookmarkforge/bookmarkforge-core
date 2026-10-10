/**
 * Mobile, Import round-trip and Settings depth — human-like E2E gaps:
 *
 *  1. BottomNav mobile navigation (sidebar collapse is e2e-covered; the
 *     mobile nav bar itself is never exercised)
 *  2. Real import round-trip through the Dashboard importer (3.1 only opens
 *     the dialog; no file is ever uploaded)
 *  3. Invalid import error path (never covered)
 *  4. Settings deep sections (specs only open the dialog; the 12 testid'd
 *     sections are never individually asserted)
 *  5. Voice Command Center full-page flow (2.2 only checks it opens)
 *
 * All interactions use CI-friendly simulators and assert on real UI state —
 * no naked waitForTimeout pacing sleeps.
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { goToBookmarks } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

const IMPORT_FIXTURE = JSON.stringify({
  bookmarks: [
    {
      url: 'https://imported.example.com',
      title: 'Imported Fixture Bookmark',
      description: 'round trip through the universal importer',
      tags: ['fixture'],
    },
  ],
});

test.describe('Mobile navigation', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('1. BottomNav switches tabs, opens search and settings', async ({
    page,
  }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    await skipPassword(page);

    const bottomNav = page.getByTestId('bottom-nav');
    await expect(bottomNav).toBeVisible();

    // Bookmarks tab via the mobile nav.
    await human.click(
      bottomNav.getByRole('button', { name: 'Bookmarks' }),
    );
    await expect(page.getByTestId('search-input')).toBeVisible({
      timeout: 10_000,
    });

    // Search button opens the omnibar.
    await human.click(bottomNav.getByRole('button', { name: 'Search' }));
    await expect(
      page.getByRole('combobox', { name: /search anything/i }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('combobox', { name: /search anything/i }),
    ).toBeHidden();

    // Settings button opens the settings dialog.
    await human.click(bottomNav.getByRole('button', { name: 'Settings' }));
    const settingsDialog = page.getByRole('dialog', {
      name: 'Settings',
    });
    await expect(settingsDialog).toBeVisible();
    await settingsDialog
      .getByLabel('Close')
      .evaluate((button) => (button as HTMLButtonElement).click());
    await expect(settingsDialog).toBeHidden();
  });
});

test.describe('Import round-trip', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('2. Importing a JSON fixture lands the bookmark in the list', async ({
    page,
  }) => {
    const human = createHumanBehavior(page, ciBasicOptions);

    await human.click(
      page.getByRole('button', { name: 'Open Importer' }),
    );

    const importDialog = page.getByRole('dialog', {
      name: 'Import Data',
    });
    await expect(importDialog).toBeVisible();

    // Upload the fixture through the hidden file input.
    await page
      .getByLabel('Click to upload file')
      .setInputFiles({
        name: 'bookmarkforge-fixture.json',
        mimeType: 'application/json',
        buffer: Buffer.from(IMPORT_FIXTURE),
      });

    // Success result with the imported count.
    await expect(
      page.getByRole('heading', { name: 'Import Complete' }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Imported')).toBeVisible();

    // Close the dialog and verify the data is really in the list.
    await importDialog
      .getByRole('button', { name: 'Close', exact: true })
      .evaluate((button) => (button as HTMLButtonElement).click());
    await expect(importDialog).toBeHidden();

    await goToBookmarks(page);
    await expect(page.getByText('Imported Fixture Bookmark')).toBeVisible();
  });

  test('3. Invalid JSON shows the import error result', async ({ page }) => {
    await page.getByRole('button', { name: 'Open Importer' }).click();

    const importDialog = page.getByRole('dialog', { name: 'Import Data' });
    await expect(importDialog).toBeVisible();

    await page
      .getByLabel('Click to upload file')
      .setInputFiles({
        name: 'garbage.json',
        mimeType: 'application/json',
        buffer: Buffer.from('this is not json'),
      });

    await expect(
      page.getByRole('heading', { name: 'Error importing data.' }),
    ).toBeVisible({ timeout: 20_000 });
  });
});

test.describe('Settings deep sections', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('4. All 12 settings sections render in the dialog', async ({
    page,
  }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    await human.click(page.getByTestId('settings-button'));

    const settingsDialog = page.getByRole('dialog', { name: 'Settings' });
    await expect(settingsDialog).toBeVisible();

    const sectionIds = [
      'settings-appearance',
      'settings-focus-mode',
      'settings-security',
      'settings-cloud-sync',
      'settings-storage',
      'settings-api-usage',
      'settings-network-permissions',
      'settings-model-manager',
      'settings-ai-config',
      'settings-custom-prompts',
      'settings-pro',
      'settings-advanced',
    ];

    for (const id of sectionIds) {
      const section = settingsDialog.getByTestId(id);
      await section.scrollIntoViewIfNeeded();
      await expect(section).toBeVisible();
    }
  });
});

test.describe('Voice Command Center', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('5. Full-page voice center exposes listening flow', async ({
    page,
  }) => {
    const human = createHumanBehavior(page, ciBasicOptions);

    await human.click(page.locator('[data-tab-id="voiceLocal"]').first());

    await expect(
      page.getByRole('heading', { name: 'Voice Commands' }),
    ).toBeVisible({ timeout: 15_000 });

    // Usage hints are rendered.
    for (const hint of ['Try saying', 'Search for...', 'Go to...']) {
      await expect(page.getByText(hint).first()).toBeVisible();
    }

    // Starting listening opens the panel with the transcript area.
    await human.click(page.getByRole('button', { name: 'Start Listening' }));
    const voicePanel = page
      .locator('.ds-modal-overlay')
      .filter({ hasText: 'Speak now...' });
    await expect(voicePanel).toBeVisible();

    // Close the panel with its dismiss button.
    await human.click(voicePanel.getByRole('button').first());
    await expect(voicePanel).toBeHidden();
  });
});
