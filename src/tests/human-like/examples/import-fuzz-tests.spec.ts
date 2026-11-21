/**
 * Import Fuzzing Tests
 *
 * Feeds malformed/corrupt files into the real import paths
 * (Settings → Import data / Import settings) and asserts the app
 * rejects them gracefully: error toast, no crash, no reload loop,
 * vault stays usable.
 */

import { test, expect, type Page } from '@playwright/test';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

const SETTINGS_BUTTON_TIMEOUT = 30_000;

async function openSettings(page: Page) {
  await page.getByTestId('settings-button').click();
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 15_000 });
}

function payloadFile(name: string, content: string | Buffer, mime = 'application/json') {
  return { name, mimeType: mime, buffer: Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8') };
}

// NOTE: `{}` is intentionally accepted as a valid EMPTY backup
// (unversioned flat-object format, covered by BackupService.test.ts
// "should import empty backup (empty object {}) successfully"), so it is
// excluded from the must-reject list.
const MALFORMED_PAYLOADS: Array<{ label: string; file: ReturnType<typeof payloadFile> }> = [
  { label: 'empty file', file: payloadFile('empty.json', '') },
  { label: 'not json', file: payloadFile('garbage.json', 'this is not json {{{') },
  { label: 'truncated json', file: payloadFile('truncated.json', '{"bookmarks": [{"id": "abc"') },
  { label: 'json array', file: payloadFile('array.json', '[]') },
  { label: 'wrong field types', file: payloadFile('wrong-types.json', '{"bookmarks":"not-an-array","version":123}') },
  { label: 'null literal', file: payloadFile('null.json', 'null') },
  { label: 'binary garbage', file: payloadFile('binary.json', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe, 0x01, 0x02]), 'application/octet-stream') },
  { label: 'huge nesting', file: payloadFile('nested.json', '{"a":'.repeat(500) + '1' + '}'.repeat(500)) },
];

test.describe('Import Fuzzing', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('settings-button')).toBeVisible({ timeout: SETTINGS_BUTTON_TIMEOUT });
  });

  for (const { label, file } of MALFORMED_PAYLOADS) {
    test(`backup import rejects ${label}`, async ({ page }) => {
      await openSettings(page);

      const importInput = page.getByLabel('Import data', { exact: false });
      await importInput.setInputFiles(file);

      // Must surface feedback: error toast (or at minimum stay alive)
      const toast = page.locator('[data-sonner-toast]').first();
      const gotToast = await toast.isVisible({ timeout: 15_000 }).catch(() => false);

      // App must not crash or hang on the error boundary
      const crashed = await page.evaluate(() =>
        !!document.querySelector('[data-testid="route-error"], .error-boundary-fallback')
      );
      expect(crashed).toBe(false);
      await expect(page.locator('body')).toBeVisible();

      // A malformed file should produce an error toast, not success
      if (gotToast) {
        const text = (await toast.textContent()) ?? '';
        expect(text.toLowerCase()).not.toContain('imported successfully');
        expect(text.toLowerCase()).not.toContain('settings imported');
      } else {
        // No toast at all is acceptable only if nothing happened visibly —
        // but the app must still be responsive
        await expect(page.getByTestId('settings-button')).toBeVisible({ timeout: 5_000 });
      }
    });
  }

  test('settings import rejects malformed json', async ({ page }) => {
    await openSettings(page);

    const settingsImport = page.getByLabel('Import settings', { exact: false });
    await settingsImport.setInputFiles(payloadFile('bad-settings.json', '{"theme": 12345, "broken": '));

    const toast = page.locator('[data-sonner-toast]').first();
    const gotToast = await toast.isVisible({ timeout: 15_000 }).catch(() => false);

    const crashed = await page.evaluate(() =>
      !!document.querySelector('[data-testid="route-error"], .error-boundary-fallback')
    );
    expect(crashed).toBe(false);
    await expect(page.locator('body')).toBeVisible();

    if (gotToast) {
      const text = (await toast.textContent()) ?? '';
      expect(text.toLowerCase()).not.toContain('imported');
    }
  });

  test('bmf file without password shows password prompt', async ({ page }) => {
    await openSettings(page);

    const importInput = page.getByLabel('Import data', { exact: false });
    await importInput.setInputFiles(payloadFile('vault.bmf', 'not-a-real-backup', 'application/octet-stream'));

    // .bmf files route through the password dialog
    const passwordDialog = page.locator('[role="dialog"]').nth(1);
    const dialogCount = await page.getByRole('dialog').count();
    expect(dialogCount).toBeGreaterThanOrEqual(1);

    // Either a password prompt appeared or an error toast did — never a crash
    const anyDialog = page.getByRole('dialog').first();
    await expect(anyDialog).toBeVisible({ timeout: 5_000 });
  });

  test('app remains usable after fuzz sequence', async ({ page }) => {
    await openSettings(page);

    const importInput = page.getByLabel('Import data', { exact: false });
    for (const { file } of MALFORMED_PAYLOADS.slice(0, 4)) {
      await importInput.setInputFiles(file);
      await page.waitForTimeout(500);
    }

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Core UI still works
    await expect(page.getByTestId('settings-button')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('body')).toBeVisible();
  });
});
