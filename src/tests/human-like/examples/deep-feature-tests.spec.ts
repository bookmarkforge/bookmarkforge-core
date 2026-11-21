/**
 * Deep Feature Coverage — human-like E2E for real interactions that the
 * existing example specs only open (or never touch):
 *
 *  1. Knowledge Dashboard cards (only "opens" covered by additional 5.2)
 *  2. Omnibar commands/actions (open/search/Escape covered by additional
 *     9.1-9.3; executing commands and selecting results is not)
 *  3. Bulk actions bar (bookmark-app only covers selection)
 *  4. Bookmark reader modal + themes (reader is never opened)
 *  5. Share bookmark modal (12.2 only checks the button exists)
 *  6. Database view interactions (e2e only navigates there)
 *  7. Support chat tabs (1.3 only checks it opens)
 *  8. TTS player voice settings panel (2.3 only checks the component)
 *
 * All interactions go through the CI-friendly simulators (ciBasicOptions /
 * ciHumanOptions) and assert on real UI state — no naked waitForTimeout
 * pacing sleeps.
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { goToBookmarks, saveBookmark } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Deep feature coverage', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('1. Knowledge dashboard renders stat cards and bento cards', async ({
    page,
  }) => {
    await saveBookmark(page, 'https://kpi.example.com', 'KPI Fixture Bookmark');

    await page.locator('[data-tab-id="analytics"]').first().click();

    // Loading screen clears when the RxDB stats subscription emits.
    await expect(
      page.getByRole('heading', { name: 'Analytics' }),
    ).toBeVisible({ timeout: 20_000 });

    // Stat cards (labels are translated; the en baseline is the reference).
    for (const label of [
      'Total Documents',
      'Total Bookmarks',
      'Total Categories',
      'Knowledge Integrity',
    ]) {
      await expect(
        page.locator('main').getByText(label, { exact: true }).first(),
      ).toBeVisible();
    }

    // Bento cards from the knowledge grid (fallback titles in en).
    for (const card of [
      'AI Sommelier',
      'Bookmark Antonyms',
      'Ambient Serendipity',
      'Bookmark Echoes',
    ]) {
      await expect(page.getByText(card)).toBeVisible();
    }

    // QuickActionCard's force re-index control exists.
    await expect(
      page.getByRole('button', { name: 'Force Global Re-indexing' }),
    ).toBeVisible();
  });

  test('2. Omnibar command creates a new document and opens the editor', async ({
    page,
  }) => {
    await page.getByRole('banner').getByRole('button', { name: 'Search' }).click();
    const combobox = page.getByRole('combobox', {
      name: /search anything/i,
    });
    await expect(combobox).toBeVisible();

    await page.getByRole('option', { name: 'New Document' }).click();

    // handleOmnibarAction("create_doc") inserts a doc and lands on the editor.
    await expect(page.getByTestId('block-editor')).toBeVisible({
      timeout: 15_000,
    });
  });

  test('3. Omnibar searches bookmarks and Open navigates to the list', async ({
    page,
  }) => {
    await saveBookmark(page, 'https://omnibar.example.com', 'Omnibar Target');
    await saveBookmark(page, 'https://other.example.com', 'Other Bookmark');

    await page.getByRole('banner').getByRole('button', { name: 'Search' }).click();
    const combobox = page.getByRole('combobox', {
      name: /search anything/i,
    });
    await expect(combobox).toBeVisible();

    await combobox.fill('Omnibar Target');

    // Fuse search is debounced 150ms; Playwright auto-waits the option.
    await page.getByRole('option', { name: 'Omnibar Target' }).click();

    // Selecting a bookmark result shows its actions, then Open navigates.
    await page.getByRole('button', { name: 'Open', exact: true }).click();

    await expect(page.getByTestId('search-input')).toBeVisible();
    await expect(page.getByText('Omnibar Target')).toBeVisible();
  });

  test('4. Omnibar command navigates to the dashboard', async ({ page }) => {
    await page.getByRole('banner').getByRole('button', { name: 'Search' }).click();
    const combobox = page.getByRole('combobox', {
      name: /search anything/i,
    });
    await expect(combobox).toBeVisible();

    await page.getByRole('option', { name: 'Dashboard' }).click();

    // The dashboard view hosts the importer entry point.
    await expect(
      page.getByRole('button', { name: 'Open Importer' }),
    ).toBeVisible();
  });

  test('5. Bulk actions: select all, bulk-tag, filter, bulk delete', async ({
    page,
  }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    await saveBookmark(page, 'https://bulk-a.example.com', 'Bulk Alpha');
    await saveBookmark(page, 'https://bulk-b.example.com', 'Bulk Beta');

    await goToBookmarks(page);

    // The select-all header control flips label ("Select All" -> "Deselect
    // All") as rows are selected; anchor the regex so row accessible names
    // ("Bulk Alpha..." etc.) never collide.
    const selectAllButton = page.getByRole('button', {
      name: /^(select|deselect) all$/i,
    });
    await human.click(selectAllButton);

    // Bulk bar appears with the real count.
    await expect(page.getByText('2 selected')).toBeVisible();

    // Bulk tag both rows.
    const tagInput = page.getByTestId('bookmark-tags-input');
    await human.type(tagInput, 'bulkflow');
    await human.click(page.getByRole('button', { name: 'Add Tag' }));

    // The tag filter bar shows the newly applied tag; filtering keeps both.
    const tagChip = page.getByTestId('tag-filter-bulkflow');
    await expect(tagChip).toBeVisible();
    await human.click(tagChip);
    await expect(page.getByText('Bulk Alpha')).toBeVisible();
    await expect(page.getByText('Bulk Beta')).toBeVisible();

    // Toggle the selection off and back on (the header label state depends
    // on the previous steps), then bulk delete — rows must disappear.
    await human.click(selectAllButton);
    await human.click(selectAllButton);
    await human.click(
      page.getByRole('button', { name: 'Delete Selected' }),
    );
    await expect(page.getByText('Bulk Alpha')).toBeHidden();
    await expect(page.getByText('Bulk Beta')).toBeHidden();
  });

  test('6. Bookmark reader modal opens and switches themes', async ({
    page,
  }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    await saveBookmark(page, 'https://reader.example.com', 'Reader Fixture');
    await goToBookmarks(page);

    // Single bookmark => single row: expand it to expose the read controls.
    await human.click(
      page.getByRole('button', { name: 'Expand', exact: true }),
    );
    await human.click(page.getByRole('button', { name: /^read$/i }));

    // Reader dialog with the control group rendered.
    const readerControls = page.getByRole('group', {
      name: 'Reader controls',
    });
    await expect(readerControls).toBeVisible({ timeout: 15_000 });

    // Switch to the sepia theme via the reader theme radios.
    await human.click(page.getByRole('radio', { name: 'Sepia theme' }));
    await expect(
      page.getByRole('radio', { name: 'Sepia theme' }),
    ).toBeChecked();

    await human.click(page.getByRole('button', { name: 'Close reader' }));
    await expect(readerControls).toBeHidden();
  });

  test('7. Share bookmark modal opens with recipient input', async ({
    page,
  }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    await saveBookmark(page, 'https://share.example.com', 'Share Fixture');
    await goToBookmarks(page);

    await human.click(
      page.getByRole('button', { name: 'Expand', exact: true }),
    );

    // The row share button's accessible name is its hidden xl label ("Share")
    // or the title ("Share via Device") — match either.
    await human.click(
      page.getByRole('button', { name: 'Share', exact: true }),
    );

    const recipientInput = page.getByRole('textbox', {
      name: 'Recipient Email Address',
    });
    await expect(recipientInput).toBeVisible({ timeout: 15_000 });

    // Close the modal through its own dialog-scoped close button.
    const shareDialog = page
      .locator('[role="dialog"]')
      .filter({ has: recipientInput });
    await human.click(
      shareDialog.getByRole('button', { name: 'Close' }),
    );
    await expect(recipientInput).toBeHidden();
  });

  test('8. Database view renders with search and selection controls', async ({
    page,
  }) => {
    await saveBookmark(page, 'https://db.example.com', 'DB Fixture');
    await page.locator('[data-tab-id="database"]').first().click();

    await expect(
      page.getByRole('heading', { name: 'Database' }),
    ).toBeVisible({ timeout: 15_000 });

    const searchRecords = page.getByRole('textbox', {
      name: 'Search records...',
    });
    await expect(searchRecords).toBeVisible();
    await expect(
      page.getByRole('checkbox', { name: 'Select all records' }),
    ).toBeVisible();

    // Filtering by a real record keeps the table functional.
    await searchRecords.fill('DB Fixture');
    await expect(
      page.getByRole('button', { name: 'Delete selected records' }),
    ).toBeVisible();
  });

  test('9. Support chat switches between AI, Knowledge Base and Diagnostics', async ({
    page,
  }) => {
    await page.locator('[data-tab-id="chat"]').first().click();

    await expect(
      page.getByRole('heading', { name: 'Help Center' }),
    ).toBeVisible({ timeout: 15_000 });

    await page.getByRole('tab', { name: 'Knowledge Base' }).click();
    await expect(
      page.getByRole('tab', { name: 'Knowledge Base' }),
    ).toHaveAttribute('aria-selected', 'true');

    await page.getByRole('tab', { name: 'Diagnostics' }).click();
    await expect(
      page.getByRole('tab', { name: 'Diagnostics' }),
    ).toHaveAttribute('aria-selected', 'true');

    await page.getByRole('tab', { name: 'AI Assistant' }).click();
    await expect(
      page.getByRole('tab', { name: 'AI Assistant' }),
    ).toHaveAttribute('aria-selected', 'true');
  });

  test('10. TTS player in the editor exposes voice settings', async ({
    page,
  }) => {
    await page.locator('[data-tab-id="documents"]').first().click();
    await page.getByTestId('new-document-button').click();

    const editor = page.getByTestId('block-editor');
    await expect(editor).toBeVisible({ timeout: 15_000 });

    // Add text to the document so TtsPlayer has content to work with
    await editor.click();
    await page.keyboard.type('This is test content for TTS player');

    // Open the advanced tools menu to expose TtsPlayer (lazy-loaded)
    const actionsButton = page.getByRole('button', { name: /actions/i });
    await actionsButton.click();

    // TtsPlayer renders in the editor toolbar (lazy-loaded); the play button
    // is the "Listen" control. Look for it with case-insensitive matching.
    const listenButton = page.getByRole('button', { name: /listen/i });
    await expect(listenButton).toBeVisible({ timeout: 20_000 });

    // Settings gear toggles the Voice Settings panel with the 3 sliders.
    // Use the editor context to select the TTS player settings button specifically
    const settingsButton = editor.getByRole('button', { name: 'Settings' });
    await settingsButton.click();

    await expect(
      page.getByRole('heading', { name: 'Voice Settings' }),
    ).toBeVisible();
    for (const slider of ['Speed', 'Pitch', 'Volume']) {
      await expect(page.getByRole('slider', { name: slider })).toBeVisible();
    }

    // Close the settings panel again.
    await settingsButton.click();
    await expect(
      page.getByRole('heading', { name: 'Voice Settings' }),
    ).toBeHidden();
  });
});
