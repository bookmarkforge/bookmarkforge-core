import { test, expect } from "@playwright/test";
import { setupVault, safeReload } from "./vault-helpers";
// Single source of truth: the same list the app's LanguageSelector renders
// (src/constants/locales.ts). The E2E selector gate resolves the
// `[data-language-code="${code}"]` interpolation against this import
// mechanically — a locale added to the app's list is automatically covered
// here, and one removed from the app fails the loop here.
import { SUPPORTED_LOCALE_CODES } from "../../src/constants/locales";

/**
 * vault-locale-switch: runs under playwright.idb-persistence.ts. Switching
 * the UI language persists — after a reload the app still renders in the
 * selected language (html lang attribute + a known translated string).
 */
test("language switch persists across reload", async ({ page }) => {
  await setupVault(page);

  // Open the language menu and select Spanish.
  await page.getByRole("button", { name: "Language" }).click();
  const esOption = page.getByRole("menuitem", { name: /español/i });
  await expect(esOption).toBeVisible({ timeout: 10_000 });
  await esOption.click();

  // i18n sets <html lang> immediately.
  await expect
    .poll(() => page.evaluate(() => document.documentElement.lang), {
      timeout: 10_000,
    })
    .toBe("es");

  // Reload — the app boots in Spanish again.
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.lang), {
      timeout: 30_000,
    })
    .toBe("es");
});

test("pre-vault language selector exposes all 30 locales and applies RTL", async ({
  page,
}) => {
  await page.goto("/");
  const securityDialog = page.locator(
    '[aria-labelledby="security-confirmation-title"]',
  );
  await expect(securityDialog).toBeVisible({ timeout: 30_000 });

  const locales = SUPPORTED_LOCALE_CODES;

  const languageButton = page.getByTestId("language-select");
  await languageButton.click();
  await expect(page.getByRole("menuitem")).toHaveCount(30);

  for (const code of locales) {
    if (!(await page.getByRole("menu").isVisible())) {
      await languageButton.click();
    }
    await page.locator(`[data-language-code="${code}"]`).click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.lang), {
        timeout: 10_000,
      })
      .toBe(code);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dir), {
        timeout: 10_000,
      })
      .toBe(code === "ar" || code === "he" ? "rtl" : "ltr");
  }
});

test("Arabic switches html dir to rtl and persists across reload", async ({
  page,
}) => {
  await setupVault(page);

  // Start in LTR.
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dir), {
      timeout: 10_000,
    })
    .toBe("ltr");

  // Switch to Arabic.
  await page.getByRole("button", { name: "Language" }).click();
  const arOption = page.getByRole("menuitem", { name: /العربية/i });
  await expect(arOption).toBeVisible({ timeout: 10_000 });
  await arOption.click();

  // i18n flips <html dir> to rtl immediately (applied synchronously by the
  // languageChanged listener, not only inside MainApp).
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dir), {
      timeout: 10_000,
    })
    .toBe("rtl");
  await expect
    .poll(() => page.evaluate(() => document.documentElement.lang), {
      timeout: 10_000,
    })
    .toBe("ar");

  // Reload — RTL persists (boot applies direction before init resolves).
  await safeReload(page);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dir), {
      timeout: 30_000,
    })
    .toBe("rtl");
});
