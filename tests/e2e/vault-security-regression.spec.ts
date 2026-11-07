import { test, expect } from "@playwright/test";
import { skipPassword } from "./vault-helpers";

/**
 * vault-security-regression: E2E regression tests for security fixes
 * applied during the comprehensive audit (rounds 1-31).
 *
 * Tests the critical fixes in a real browser runtime. Uses page.evaluate()
 * to directly exercise production modules in the browser's module graph.
 */
test.describe("Security regression E2E", () => {
  test.describe("CSV formula injection (fix #6 / #50)", () => {
    test("escapeCsv prefixes =, +, -, @ with single quote in browser runtime", async ({
      page,
    }) => {
      // Navigate to load the app's module graph so dynamic imports resolve
      await skipPassword(page);

      const results = await page.evaluate(async () => {
        const { escapeCsv } = await import(
          "/src/services/exporter.formatters.ts"
        );

        // Test formula injection payloads that MUST be prefixed
        const formulaTests = [
          "=cmd|' /C calc'!A0",
          "+SUM(A1:A10)",
          "-IMPORTXML(\"http://evil.com\")",
          "@SUM(A1)",
          "=HYPERLINK(\"http://evil.com\")",
        ];

        // Test safe strings that must NOT be prefixed
        const safeTests = [
          "Normal Title",
          "123 Numbers",
          "Safe text with = inside",
          "email@example.com",
        ];

        const formulaResults = formulaTests.map((input) => ({
          input,
          escaped: escapeCsv(input),
          startsWithQuote: escapeCsv(input).startsWith("'"),
          // The =, +, -, @ at position 0 must be prefixed
          prefixCorrect: escapeCsv(input).startsWith("'"),
        }));

        const safeResults = safeTests.map((input) => ({
          input,
          escaped: escapeCsv(input),
          startsWithQuote: escapeCsv(input).startsWith("'"),
          // Must NOT be unnecessarily prefixed
          noFalsePositive: !escapeCsv(input).startsWith("'"),
        }));

        // Also test double-quote escaping per RFC 4180
        const quoteInput = 'He said "hello"';
        const quoteEscaped = escapeCsv(quoteInput);

        return {
          formulaResults,
          safeResults,
          quoteEscaped,
          quoteHasDoubleEscaping: quoteEscaped.includes('""'),
        };
      });

      // All formula payloads must be prefixed with '
      for (const r of results.formulaResults) {
        expect(
          r.prefixCorrect,
          `escapeCsv("${r.input}") → "${r.escaped}": MUST start with '`,
        ).toBe(true);
      }

      // Safe strings must NOT be prefixed (no false positives)
      for (const r of results.safeResults) {
        expect(
          r.noFalsePositive,
          `escapeCsv("${r.input}") → "${r.escaped}": should NOT start with '`,
        ).toBe(true);
      }

      // Double-quote escaping must work
      expect(results.quoteHasDoubleEscaping).toBe(true);
      expect(results.quoteEscaped).toBe('He said ""hello""');
    });
  });

  test.describe("Backup password validation (fix #1)", () => {
    test("vault rejects empty/whitespace passwords", async ({ page }) => {
      await page.goto("/");

      // SecurityConfirmation should appear on pristine context
      await expect(
        page.getByRole("heading", { name: "Secure your vault" }),
      ).toBeVisible({ timeout: 30_000 });

      await page.getByRole("button", { name: "Set up password" }).click();

      await expect(
        page.getByRole("heading", { name: "Setup Secure Vault" }),
      ).toBeVisible({ timeout: 30_000 });

      // Download recovery kit to unlock the checkbox
      const download = page.waitForEvent("download");
      await page
        .getByRole("button", { name: "Download Recovery Kit" })
        .click();
      await download;

      const confirmCheckbox = page.getByRole("checkbox", {
        name: "I have safely saved the recovery phrase",
      });
      await expect(confirmCheckbox).toBeEnabled({ timeout: 10_000 });
      await confirmCheckbox.check();

      // Try whitespace-only password — should be rejected
      await page.getByLabel("Master Password").fill("   ");
      const createBtn = page.getByRole("button", { name: "Create Vault" });

      // The button should either be disabled or reject on click
      const isDisabled = await createBtn.isDisabled().catch(() => true);
      if (!isDisabled) {
        await createBtn.click();
        await page.waitForTimeout(500);
      }

      // Vault should NOT be created — we should still be on setup or see error
      const stillOnSetup = await page
        .getByRole("heading", { name: "Setup Secure Vault" })
        .isVisible()
        .catch(() => false);

      const errorVisible = await page
        .getByText(/password.*required|password.*empty|invalid.*password/i)
        .isVisible()
        .catch(() => false);

      expect(stillOnSetup || errorVisible).toBe(true);
    });
  });
});
