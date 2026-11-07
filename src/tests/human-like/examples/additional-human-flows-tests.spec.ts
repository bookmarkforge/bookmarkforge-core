/**
 * Additional Human-Flow Tests
 *
 * Coverage for three real user flows that no human-like example spec
 * exercised (grep-verified 2026-09-24). Every selector is checked against
 * production source and every assertion is unconditional on state the test
 * itself drives, so the ratchet classifies them all as `real`.
 *
 *  15. Theme toggle full cycle — Header's ThemeToggle
 *      (data-testid="theme-toggle", ThemeContext.tsx). The old 3.1-3.3 tests
 *      in theme-consent-tests.spec.ts guarded everything behind
 *      isVisible-catch guards and asserted only `body` visibility; the real
 *      contract is: click cycles light → dark → system, each step flips
 *      html[data-theme] and the html.dark/light class, and the button's
 *      aria-label names the NEXT action (single source of truth with its
 *      tooltip, ThemeToggle.tsx).
 *  16. Note capture — the non-URL branch of QuickCapture (QuickCapture.tsx
 *      returns "note" and toasts app_noteCaptured, "Note captured and
 *      processed!"). No spec exercised this branch; saveBookmark only drives
 *      URLs.
 *  17. Rename revert — EditableTitle's Escape handler (EditableTitle.tsx):
 *      Escape restores the original title and closes the editor. Only the
 *      commit path (Enter) is covered by bookmark-app-tests.
 */

import { test, expect } from '@playwright/test';
import { createHumanBehavior, ciBasicOptions } from '../utils/human-behavior';
import { saveBookmark, goToBookmarks } from '../utils/app-flows';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Additional human flows', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('15. Theme toggle cycles light to dark to system on the html element', async ({
    page,
  }) => {    const human = createHumanBehavior(page, ciBasicOptions);
    const toggle = page.getByTestId('theme-toggle');
    const html = page.locator('html');

    // The toggle lives in the desktop Header, hidden on narrow viewports —
    // this suite must not depend on the runner's default window size.
    await page.setViewportSize({ width: 1280, height: 720 });

    // The HomeDashboard backup banner sits over the header and hides it
    // (MainAppLayout aria-hides the main area while overlays are up); dismiss
    // it first — its own snooze control, a real user action.
    const bannerDismiss = page.getByRole('button', {
      name: 'Got it, remind me later',
    });
    if (await bannerDismiss.isVisible().catch(() => false)) {
      await human.click(bannerDismiss);
    }

    // Deterministic start: force LIGHT mode through the toggle itself. The
    // cycle is light → dark → system (ThemeContext.toggleTheme), and
    // data-theme CANNOT distinguish light from system (both render "light"),
    // so the mode oracle is the button's aria-label, which names the NEXT
    // action: "Switch to dark mode" ⇔ current mode is light.
    await expect(toggle).toBeVisible();
    for (let i = 0; i < 3; i += 1) {
      if (
        (await toggle.getAttribute('aria-label')) === 'Switch to dark mode'
      ) {
        break;
      }
      await human.click(toggle);
    }
    await expect(toggle).toHaveAttribute('aria-label', 'Switch to dark mode');
    await expect(html).toHaveAttribute('data-theme', 'light');
    await expect(html).toHaveClass(/light/);

    // Click 1: light → dark. data-theme, class AND next-action label flip.
    await human.click(toggle);
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await expect(html).toHaveClass(/dark/);
    await expect(toggle).toHaveAttribute(
      'aria-label',
      'Switch to system theme',
    );

    // Click 2: dark → system. The class now reflects the OS preference; the
    // data-theme attribute and the label pin the mode itself.
    await human.click(toggle);
    await expect(toggle).toHaveAttribute(
      'aria-label',
      'Switch to light mode',
    );
    await expect(html).toHaveAttribute(
      'data-theme',
      /^(dark|light)$/,
    );

    // Click 3: system → light, closing the cycle deterministically.
    await human.click(toggle);
    await expect(html).toHaveAttribute('data-theme', 'light');
    await expect(toggle).toHaveAttribute(
      'aria-label',
      'Switch to dark mode',
    );
  });

  test('16. Note capture: text input lands as a note with its own toast', async ({
    page,
  }) => {
    const human = createHumanBehavior(page, ciBasicOptions);

    await human.click(page.getByTestId('add-bookmark-button'));
    await expect(page.getByTestId('quick-capture-input')).toBeVisible();

    // Non-URL text takes the note branch (QuickCapture isUrl regex fails).
    await human.type(
      page.getByTestId('quick-capture-input'),
      'Human-like note fixture for coverage',
    );
    await expect(page.getByTestId('save-bookmark-button')).toBeEnabled({
      timeout: 15_000,
    });
    await human.click(page.getByTestId('save-bookmark-button'));

    // The note branch toasts app_noteCaptured — distinct from the bookmark
    // toast; asserting it pins which branch ran.
    await expect(
      page.getByText('Note captured and processed!').first(),
    ).toBeVisible({ timeout: 30_000 });

    // The panel closes after the insert completes.
    await expect(page.getByTestId('quick-capture-input')).toBeHidden({
      timeout: 30_000,
    });
  });

  test('17. Inline rename reverts with Escape and keeps the original title', async ({
    page,
  }) => {
    const human = createHumanBehavior(page, ciBasicOptions);
    await saveBookmark(page, 'https://rename.example.com', 'Rename Fixture');
    await goToBookmarks(page);

    // Click-to-edit: scope to the list row (the virtualized listitem) and
    // target the title button by its EXACT text — the row container is also a
    // role="button" but its accessible name is the full row summary, and
    // EditableTitle's title="Click to edit" is a tooltip attribute, not part
    // of the accessible name.
    const row = page
      .getByRole('listitem')
      .filter({ hasText: 'Rename Fixture' });
    await human.click(row.getByRole('button', { name: 'Rename Fixture', exact: true }));
    const editor = page.getByRole('textbox', { name: 'Edit title' });
    await expect(editor).toBeVisible();

    // Type a new title, then abandon the edit with Escape.
    await editor.fill('Discarded Rename');
    await human.pressKey('Escape');
    await expect(editor).toBeHidden();

    // The row still shows the original title; the discarded value is gone.
    await expect(row.getByText('Rename Fixture')).toBeVisible();
    await expect(page.getByText('Discarded Rename')).toHaveCount(0);
  });
});
