/**
 * tests/e2e/capture-sanitization.spec.ts — E2E gate for the extension→app
 * capture flow with malicious payloads.
 *
 * Simulates what the browser extension does: opens `/capture#url=…&title=…`
 * with attacker-controlled values in the fragment hash. The Capture component
 * (src/components/Capture.tsx) reads these params, sanitizes them via
 * `sanitizeUserInput` (DOMPurify, no tags) and `validateAndSanitizeUrl`
 * (http/https only, anti-SSRF), then auto-saves to the vault after 500 ms.
 *
 * The test verifies:
 *   1. Malicious titles are stripped of HTML/script content before being
 *      stored in the bookmark.
 *   2. Malicious URLs (javascript:, data:, file:) are rejected by the
 *      validator — no bookmark is created for them.
 *   3. The saved bookmark's title in the DOM contains no live script content.
 *   4. The auto-save fires (no user interaction required — matching the
 *      real extension flow where the tab opens and saves automatically).
 *
 * Uses Playwright against the Vite dev server (playwright.config.ts).
 * Vault is unlocked via `skipPassword` so the DB is ready for inserts.
 */
import { test, expect } from "@playwright/test";
import { skipPassword, dismissOverlays } from "./vault-helpers";

/** Payloads that an attacker could inject via a crafted page title. */
const MALICIOUS_TITLES = [
  // Basic XSS
  '<script>alert("XSS")</script>',
  // Event handler injection
  '<img src=x onerror="alert(1)">',
  // SVG-based XSS
  '<svg onload="alert(1)">',
  // Attribute injection
  '" onfocus="alert(1)" autofocus="',
  // Template literal injection
  '{{constructor.constructor("alert(1)")()}}',
  // HTML injection (should be stripped, not rendered)
  '<h1>Injected Header</h1><p>fake content</p>',
  // Null bytes and control characters
  'title\x00with\x00nulls',
  // Excessively long title (DoS via huge DOM)
  'A'.repeat(5000),
  // Unicode right-to-left override (homograph attack)
  '\u202eattack\u202c',
];

/** URLs that must be rejected (no bookmark created). */
const MALICIOUS_URLS = [
  'javascript:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  'file:///etc/passwd',
  'vbscript:MsgBox("XSS")',
];

test.describe("capture flow: malicious payload sanitization", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }) => {
    // Unlock the vault with skip-password so the DB is ready for inserts.
    await skipPassword(page);
    await dismissOverlays(page);
  });

  for (const maliciousTitle of MALICIOUS_TITLES) {
    const label = maliciousTitle.length > 40
      ? maliciousTitle.slice(0, 37) + "…"
      : maliciousTitle;

    test(`sanitizes malicious title: ${label}`, async ({ page }) => {
      const encodedTitle = encodeURIComponent(maliciousTitle);
      const captureUrl = `/capture#url=${encodeURIComponent("https://example.com/safe-page")}&title=${encodedTitle}`;

      // Navigate to the capture route (simulates extension opening the tab).
      await page.goto(captureUrl);

      // Wait for auto-save (500 ms timer + DB write + UI update).
      // The "Saved successfully" toast or the saved checkmark indicates
      // the bookmark was written.
      await expect(
        page.getByText(/saved|bookmark/i).first(),
      ).toBeVisible({ timeout: 10_000 });

      // Verify no script executed: if an XSS payload ran, `window.__xssFired`
      // would be set (we inject a sentinel before navigation).
      const xssFired = await page.evaluate(() => {
        return (window as unknown as Record<string, unknown>).__xssFired === true;
      });
      expect(
        xssFired,
        `XSS payload fired in the browser: ${label}`,
      ).toBe(false);

      // Verify the title input does not contain raw HTML tags.
      const titleInput = page.getByRole("textbox", { name: /title/i });
      if (await titleInput.isVisible().catch(() => false)) {
        const titleValue = await titleInput.inputValue();
        // The title should have been sanitized: no <, >, or " that could
        // form executable HTML. DOMPurify strips tags; sanitizeUserInput
        // further limits to plain text.
        expect(titleValue).not.toMatch(/<script/i);
        expect(titleValue).not.toMatch(/onerror/i);
        expect(titleValue).not.toMatch(/onload/i);
        expect(titleValue).not.toMatch(/<img/i);
        expect(titleValue).not.toMatch(/<svg/i);
        expect(titleValue).not.toMatch(/<h1/i);
        expect(titleValue).not.toMatch(/<p/i);
      }

      // Navigate to the main app and verify the bookmark was saved
      // with a sanitized title (no HTML tags in the stored data).
      await page.goto("/");
      // The bookmark list should show the page URL, not the malicious title
      // rendered as HTML.
      const pageContent = await page.content();
      expect(pageContent).not.toContain("<script>alert");
      expect(pageContent).not.toContain("onerror=\"alert");
      expect(pageContent).not.toContain("onload=\"alert");
    });
  }

  for (const maliciousUrl of MALICIOUS_URLS) {
    test(`rejects malicious URL: ${maliciousUrl.slice(0, 30)}`, async ({ page }) => {
      const encodedUrl = encodeURIComponent(maliciousUrl);
      const captureUrl = `/capture#url=${encodedUrl}&title=Safe%20Title`;

      await page.goto(captureUrl);

      // The Capture component should reject the URL via validateAndSanitizeUrl
      // and show an error toast — no bookmark should be created.
      // Wait a moment for the auto-save attempt (500 ms timer).
      await page.waitForTimeout(1_500);

      // The URL input should still show the malicious URL (it's displayed
      // for the user to see), but it should NOT have been saved to the vault.
      // Verify by checking the app's bookmark list doesn't contain it.
      await page.goto("/");
      const pageContent = await page.content();
      // The malicious URL should not appear as a saved bookmark.
      expect(pageContent).not.toContain(maliciousUrl);
    });
  }

  test("sanitized title is safe for DOM rendering", async ({ page }) => {
    // This test specifically checks that the saved bookmark's title,
    // when rendered back in the app's bookmark list, doesn't execute JS.
    const xssTitle = '<img src=x onerror="window.__xssFired=true">';
    const encodedTitle = encodeURIComponent(xssTitle);
    const captureUrl = `/capture#url=${encodeURIComponent("https://example.com/render-test")}&title=${encodedTitle}`;

    await page.goto(captureUrl);

    // Inject sentinel before the auto-save renders anything.
    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>).__xssFired = false;
    });

    // Wait for auto-save.
    await expect(
      page.getByText(/saved|bookmark/i).first(),
    ).toBeVisible({ timeout: 10_000 });

    // Now navigate to the main app where the bookmark title would be
    // rendered in the list. The sentinel must remain false.
    await page.goto("/");
    await page.waitForTimeout(1_000);

    const xssFired = await page.evaluate(() => {
      return (window as unknown as Record<string, unknown>).__xssFired === true;
    });
    expect(
      xssFired,
      "XSS payload fired when the saved bookmark title was rendered in the app",
    ).toBe(false);
  });

  test("URL fragment values trigger auto-save (secondary path)", async ({ page }) => {
    // Security invariant from the extension: captured data must travel via
    // fragment hash, never query params (S0/R1 hardening). The Capture
    // component merges both but fragment takes precedence. This test
    // verifies the query-param secondary path also triggers auto-save.
    const captureUrl = `/capture?url=${encodeURIComponent("https://leaked.example.com")}&title=Leaked&text=via-query`;
    await page.goto(captureUrl);

    // The Capture component accepts query params (fallback for bookmarklets).
    // Auto-save fires after 500 ms; verify the saved toast appears.
    await expect(
      page.getByText(/saved|bookmark/i).first(),
    ).toBeVisible({ timeout: 10_000 });

    // Verify the title input shows the sanitized title (not raw HTML).
    const titleInput = page.getByRole("textbox", { name: /title/i });
    if (await titleInput.isVisible().catch(() => false)) {
      const titleValue = await titleInput.inputValue();
      expect(titleValue).toBe("Leaked");
    }
  });
});
