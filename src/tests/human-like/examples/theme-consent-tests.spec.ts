/**
 * Theme and Consent Tests
 *
 * Every test here asserts a real contract of the shipped UI:
 *  - ConsentBanner (src/components/ConsentBanner.tsx): first-visit banner,
 *    granular purposes, accept/reject/save persistence and privacy link.
 *  - ThemeToggle (src/components/Header.tsx + ThemeContext.tsx): the toggle
 *    cycles light → dark → system, flips html[data-theme]/class, names the NEXT
 *    action in its aria-label, and persists the choice through
 *    usePreferencesStore (bookmarkforge-theme).
 *
 * The previous version of this file guarded every assertion behind
 * `isVisible().catch(() => false)`, so all 10 tests passed when the banner or
 * the toggle was absent. The consent tests clear the inherited storageState on
 * purpose: the shared E2E state seeds an accepted decision so the banner cannot
 * cover other specs, which is exactly why this file must opt back into a first
 * visit to exercise it.
 */

import { test, expect } from '@playwright/test';
import { skipPassword } from '../../../../tests/e2e/vault-helpers';

test.describe('Privacy consent (first visit)', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('3.1 First visit shows the consent banner with every decision available', async ({
    page,
  }) => {
    const banner = page.getByRole('region', { name: 'Privacy consent' });

    await expect(banner).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Your Privacy Matters' }),
    ).toBeVisible();
    await expect(
      banner.getByRole('button', { name: 'Accept All' }),
    ).toBeVisible();
    await expect(
      banner.getByRole('button', { name: 'Reject All' }),
    ).toBeVisible();
    await expect(
      banner.getByRole('button', { name: 'Manage preferences' }),
    ).toBeVisible();
    await expect(
      banner.getByRole('link', { name: /Privacy Policy/ }),
    ).toBeVisible();
  });

  test('3.2 Accept All persists every purpose and closes the banner', async ({
    page,
  }) => {
    const banner = page.getByRole('region', { name: 'Privacy consent' });

    await banner.getByRole('button', { name: 'Accept All' }).click();
    await expect(banner).toBeHidden();

    const stored = await page.evaluate(() => ({
      decision: localStorage.getItem('forge_consent_decision_made'),
      analytics: localStorage.getItem('forge_consent_analytics'),
      errorReporting: localStorage.getItem('forge_consent_sentry'),
      clientEvents: localStorage.getItem('forge_consent_client_events'),
    }));
    expect(stored).toEqual({
      decision: 'true',
      analytics: 'true',
      errorReporting: 'true',
      clientEvents: 'true',
    });
  });

  test('3.3 Reject All persists a denial for every purpose', async ({ page }) => {
    const banner = page.getByRole('region', { name: 'Privacy consent' });

    await banner.getByRole('button', { name: 'Reject All' }).click();
    await expect(banner).toBeHidden();

    const stored = await page.evaluate(() => ({
      decision: localStorage.getItem('forge_consent_decision_made'),
      analytics: localStorage.getItem('forge_consent_analytics'),
      errorReporting: localStorage.getItem('forge_consent_sentry'),
      clientEvents: localStorage.getItem('forge_consent_client_events'),
    }));
    expect(stored).toEqual({
      decision: 'true',
      analytics: 'false',
      errorReporting: 'false',
      clientEvents: 'false',
    });
  });

  test('3.4 Manage preferences expands three purposes, all denied by default', async ({
    page,
  }) => {
    const banner = page.getByRole('region', { name: 'Privacy consent' });

    await banner
      .getByRole('button', { name: 'Manage preferences' })
      .click();
    const collapse = banner.getByRole('button', { name: 'Hide preferences' });
    await expect(collapse).toHaveAttribute('aria-expanded', 'true');
    await expect(collapse).toHaveAttribute('aria-controls', 'consent-preferences');
    await expect(
      banner.getByRole('checkbox', { name: 'Local usage stats' }),
    ).not.toBeChecked();
    await expect(
      banner.getByRole('checkbox', { name: 'Local error logs' }),
    ).not.toBeChecked();
    await expect(
      banner.getByRole('checkbox', { name: 'Local usage events' }),
    ).not.toBeChecked();
  });

  test('3.5 Saving one purpose keeps the other two denied', async ({ page }) => {
    const banner = page.getByRole('region', { name: 'Privacy consent' });

    await banner
      .getByRole('button', { name: 'Manage preferences' })
      .click();
    await banner
      .getByRole('checkbox', { name: 'Local usage stats' })
      .check();
    await banner.getByRole('button', { name: 'Save Preferences' }).click();
    await expect(banner).toBeHidden();

    const stored = await page.evaluate(() => ({
      analytics: localStorage.getItem('forge_consent_analytics'),
      errorReporting: localStorage.getItem('forge_consent_sentry'),
      clientEvents: localStorage.getItem('forge_consent_client_events'),
    }));
    expect(stored).toEqual({
      analytics: 'true',
      errorReporting: 'false',
      clientEvents: 'false',
    });
  });

  test('3.6 Hiding preferences keeps the pending selection', async ({ page }) => {
    const banner = page.getByRole('region', { name: 'Privacy consent' });
    const analytics = banner.getByRole('checkbox', {
      name: 'Local usage stats',
    });

    await banner
      .getByRole('button', { name: 'Manage preferences' })
      .click();
    await analytics.check();
    await banner.getByRole('button', { name: 'Hide preferences' }).click();
    await expect(analytics).toBeHidden();
    await banner
      .getByRole('button', { name: 'Manage preferences' })
      .click();
    await expect(analytics).toBeChecked();
  });

  test('3.7 Privacy Policy link is a new-tab route to /privacy', async ({
    page,
  }) => {
    const banner = page.getByRole('region', { name: 'Privacy consent' });
    const link = banner.getByRole('link', { name: /Privacy Policy/ });

    await expect(link).toHaveAttribute('href', '/privacy');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', /\bnoopener\b/);
  });
});

test.describe('Theme toggle', () => {
  test.beforeEach(async ({ page }) => {
    await skipPassword(page);
  });

  test('3.8 Theme toggle cycles light to dark on the html element', async ({
    page,
  }) => {
    const html = page.locator('html');
    const toggle = page.getByTestId('theme-toggle');
    await expect(toggle).toBeVisible();

    for (let i = 0; i < 3; i += 1) {
      if ((await toggle.getAttribute('aria-label')) === 'Switch to dark mode') {
        break;
      }
      await toggle.click();
    }
    await expect(toggle).toHaveAttribute('aria-label', 'Switch to dark mode');
    await expect(html).toHaveAttribute('data-theme', 'light');

    await toggle.click();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await expect(html).toHaveClass(/dark/);
  });

  test('3.9 Theme choice is persisted to local storage', async ({ page }) => {
    const toggle = page.getByTestId('theme-toggle');
    await expect(toggle).toBeVisible();

    for (let i = 0; i < 3; i += 1) {
      if ((await toggle.getAttribute('aria-label')) === 'Switch to dark mode') {
        break;
      }
      await toggle.click();
    }
    await toggle.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    const stored = await page.evaluate(() =>
      localStorage.getItem('bookmarkforge-theme'),
    );
    expect(stored).toBe('dark');
  });

  test('3.10 Theme toggle names the next action through a full cycle', async ({
    page,
  }) => {
    const toggle = page.getByTestId('theme-toggle');
    await expect(toggle).toBeVisible();

    for (let i = 0; i < 3; i += 1) {
      if ((await toggle.getAttribute('aria-label')) === 'Switch to dark mode') {
        break;
      }
      await toggle.click();
    }
    await expect(toggle).toHaveAttribute('aria-label', 'Switch to dark mode');

    await toggle.click();
    await expect(toggle).toHaveAttribute(
      'aria-label',
      'Switch to system theme',
    );
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-label', 'Switch to light mode');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-label', 'Switch to dark mode');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });
});
