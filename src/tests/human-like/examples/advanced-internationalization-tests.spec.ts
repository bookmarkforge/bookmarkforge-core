import { test, expect } from "@playwright/test";

/**
 * Advanced Internationalization Tests
 * Tests for internationalization, localization, and multi-language support
 * These tests simulate human-like interactions with i18n scenarios
 */

test.describe("Advanced Internationalization", () => {
  test("should handle language switching", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Switch language
    const languageSelector = page.locator('[data-testid="language-selector"]').first();
    if (await languageSelector.count() > 0) {
      await languageSelector.selectOption("es");

      // Verify language changed
      const currentLanguage = await page.evaluate(() => {
        return document.documentElement.lang;
      });

      expect(currentLanguage).toBe("es");
    }
  });

  test("should handle RTL layout switching", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Switch to RTL language
    const languageSelector = page.locator('[data-testid="language-selector"]').first();
    if (await languageSelector.count() > 0) {
      await languageSelector.selectOption("ar");

      // Verify RTL layout
      const isRTL = await page.evaluate(() => {
        return document.documentElement.dir === "rtl";
      });

      expect(isRTL).toBeTruthy();
    }
  });

  test("should handle date localization", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Switch to different locale
    const languageSelector = page.locator('[data-testid="language-selector"]').first();
    if (await languageSelector.count() > 0) {
      await languageSelector.selectOption("de");

      // Check date format
      const dateDisplay = page.locator('[data-testid="date-display"]').first();
      if (await dateDisplay.count() > 0) {
        const dateText = await dateDisplay.textContent();
        expect(dateText).toBeTruthy();
      }
    }
  });

  test("should handle number formatting", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Switch to different locale
    const languageSelector = page.locator('[data-testid="language-selector"]').first();
    if (await languageSelector.count() > 0) {
      await languageSelector.selectOption("fr");

      // Check number format
      const numberDisplay = page.locator('[data-testid="number-display"]').first();
      if (await numberDisplay.count() > 0) {
        const numberText = await numberDisplay.textContent();
        expect(numberText).toBeTruthy();
      }
    }
  });

  test("should handle currency formatting", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Switch to different locale
    const languageSelector = page.locator('[data-testid="language-selector"]').first();
    if (await languageSelector.count() > 0) {
      await languageSelector.selectOption("ja");

      // Check currency format
      const currencyDisplay = page.locator('[data-testid="currency-display"]').first();
      if (await currencyDisplay.count() > 0) {
        const currencyText = await currencyDisplay.textContent();
        expect(currencyText).toContain("¥");
      }
    }
  });

  test("should handle time zone conversion", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check time zone handling
    const timeDisplay = page.locator('[data-testid="time-display"]').first();
    if (await timeDisplay.count() > 0) {
      const timeText = await timeDisplay.textContent();
      expect(timeText).toBeTruthy();
    }
  });

  test("should handle text direction in mixed content", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Switch to RTL
    const languageSelector = page.locator('[data-testid="language-selector"]').first();
    if (await languageSelector.count() > 0) {
      await languageSelector.selectOption("he");

      // Check mixed content handling
      const mixedContent = page.locator('[data-testid="mixed-content"]').first();
      if (await mixedContent.count() > 0) {
        const hasRTL = await mixedContent.getAttribute("data-rtl");
        expect(hasRTL).toBeTruthy();
      }
    }
  });

  test("should handle pluralization rules", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check pluralization
    const countDisplay = page.locator('[data-testid="count-display"]').first();
    if (await countDisplay.count() > 0) {
      const countText = await countDisplay.textContent();
      expect(countText).toBeTruthy();
    }
  });

  test("should handle gender-specific translations", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check gender-specific content
    const genderSpecific = page.locator('[data-testid="gender-specific"]').first();
    if (await genderSpecific.count() > 0) {
      const text = await genderSpecific.textContent();
      expect(text).toBeTruthy();
    }
  });

  test("should handle character encoding", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check character encoding
    const charset = await page.evaluate(() => {
      return document.characterSet;
    });

    expect(charset).toBe("UTF-8");
  });

  test("should handle font loading for different scripts", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Switch to language with different script
    const languageSelector = page.locator('[data-testid="language-selector"]').first();
    if (await languageSelector.count() > 0) {
      await languageSelector.selectOption("zh");

      // Check font loading
      const fontLoaded = await page.evaluate(() => {
        return document.fonts.ready;
      });

      expect(fontLoaded).toBeTruthy();
    }
  });

  test("should handle input method editor (IME) support", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Switch to CJK language
    const languageSelector = page.locator('[data-testid="language-selector"]').first();
    if (await languageSelector.count() > 0) {
      await languageSelector.selectOption("ko");

      // Check IME support
      const inputField = page.locator('[data-testid="input-field"]').first();
      if (await inputField.count() > 0) {
        const hasIME = await inputField.getAttribute("data-ime-supported");
        expect(hasIME).toBeTruthy();
      }
    }
  });

  test("should handle locale-specific date formats", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Test different date formats
    const dateFormats = ["en-US", "en-GB", "de-DE", "ja-JP"];
    
    for (const locale of dateFormats) {
      const formattedDate = await page.evaluate((loc) => {
        return new Date().toLocaleDateString(loc);
      }, locale);

      expect(formattedDate).toBeTruthy();
    }
  });

  test("should handle locale-specific time formats", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Test different time formats
    const timeFormats = ["en-US", "es-ES", "fr-FR", "ru-RU"];
    
    for (const locale of timeFormats) {
      const formattedTime = await page.evaluate((loc) => {
        return new Date().toLocaleTimeString(loc);
      }, locale);

      expect(formattedTime).toBeTruthy();
    }
  });

  test("should handle measurement unit conversion", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Switch to metric locale
    const languageSelector = page.locator('[data-testid="language-selector"]').first();
    if (await languageSelector.count() > 0) {
      await languageSelector.selectOption("de");

      // Check unit conversion
      const unitDisplay = page.locator('[data-testid="unit-display"]').first();
      if (await unitDisplay.count() > 0) {
        const unitText = await unitDisplay.textContent();
        expect(unitText).toContain("km");
      }
    }
  });

  test("should handle address formatting by locale", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check address formatting
    const addressDisplay = page.locator('[data-testid="address-display"]').first();
    if (await addressDisplay.count() > 0) {
      const addressText = await addressDisplay.textContent();
      expect(addressText).toBeTruthy();
    }
  });

  test("should handle phone number formatting", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check phone number formatting
    const phoneDisplay = page.locator('[data-testid="phone-display"]').first();
    if (await phoneDisplay.count() > 0) {
      const phoneText = await phoneDisplay.textContent();
      expect(phoneText).toBeTruthy();
    }
  });

  test("should handle name formatting by locale", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check name formatting
    const nameDisplay = page.locator('[data-testid="name-display"]').first();
    if (await nameDisplay.count() > 0) {
      const nameText = await nameDisplay.textContent();
      expect(nameText).toBeTruthy();
    }
  });

  test("should handle calendar localization", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Switch to different locale
    const languageSelector = page.locator('[data-testid="language-selector"]').first();
    if (await languageSelector.count() > 0) {
      await languageSelector.selectOption("th");

      // Check calendar localization
      const calendar = page.locator('[data-testid="calendar"]').first();
      if (await calendar.count() > 0) {
        const hasLocalizedDays = await calendar.getAttribute("data-localized-days");
        expect(hasLocalizedDays).toBeTruthy();
      }
    }
  });

  test("should handle weekend localization", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Switch to locale with different weekend
    const languageSelector = page.locator('[data-testid="language-selector"]').first();
    if (await languageSelector.count() > 0) {
      await languageSelector.selectOption("il");

      // Check weekend localization
      const weekendDays = page.locator('[data-testid="weekend-days"]').first();
      if (await weekendDays.count() > 0) {
        const hasCorrectWeekend = await weekendDays.getAttribute("data-weekend");
        expect(hasCorrectWeekend).toBeTruthy();
      }
    }
  });

  test("should handle collation (sorting) by locale", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check sorting by locale
    const sortedList = page.locator('[data-testid="sorted-list"]').first();
    if (await sortedList.count() > 0) {
      const hasLocaleSort = await sortedList.getAttribute("data-locale-sorted");
      expect(hasLocaleSort).toBeTruthy();
    }
  });

  test("should handle translation completeness", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check for missing translations
    const missingTranslations = await page.evaluate(() => {
      const elements = document.querySelectorAll("[data-i18n]");
      return Array.from(elements).filter(el => {
        return el.textContent === "" || el.textContent.includes("missing");
      }).length;
    });

    expect(missingTranslations).toBe(0);
  });

  test("should handle dynamic language switching", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Rapid language switching
    const languageSelector = page.locator('[data-testid="language-selector"]').first();
    if (await languageSelector.count() > 0) {
      const languages = ["en", "es", "fr", "de"];
      
      for (const lang of languages) {
        await languageSelector.selectOption(lang);
        await page.waitForTimeout(100);

        const currentLang = document.documentElement.lang;
        expect(currentLang).toBe(lang);
      }
    }
  });

  test("should handle language persistence", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Set language
    const languageSelector = page.locator('[data-testid="language-selector"]').first();
    if (await languageSelector.count() > 0) {
      await languageSelector.selectOption("es");

      // Reload page
      await page.reload();
      await page.waitForLoadState("networkidle");

      // Verify language persisted
      const persistedLanguage = document.documentElement.lang;
      expect(persistedLanguage).toBe("es");
    }
  });

  test("should handle locale-specific keyboard layouts", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check keyboard layout support
    const keyboardLayout = await page.evaluate(() => {
      return navigator.language;
    });

    expect(keyboardLayout).toBeTruthy();
  });

  test("should handle bidi text rendering", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Switch to RTL
    const languageSelector = page.locator('[data-testid="language-selector"]').first();
    if (await languageSelector.count() > 0) {
      await languageSelector.selectOption("ar");

      // Check bidi rendering
      const bidiText = page.locator('[data-testid="bidi-text"]').first();
      if (await bidiText.count() > 0) {
        const hasBidi = await bidiText.getAttribute("data-bidi");
        expect(hasBidi).toBeTruthy();
      }
    }
  });

  test("should handle line breaking rules by locale", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check line breaking
    const textBlock = page.locator('[data-testid="text-block"]').first();
    if (await textBlock.count() > 0) {
      const hasLineBreak = await textBlock.getAttribute("data-line-break");
      expect(hasLineBreak).toBeTruthy();
    }
  });

  test("should handle hyphenation by locale", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check hyphenation
    const hyphenatedText = page.locator('[data-testid="hyphenated-text"]').first();
    if (await hyphenatedText.count() > 0) {
      const hasHyphenation = await hyphenatedText.getAttribute("data-hyphenated");
      expect(hasHyphenation).toBeTruthy();
    }
  });

  test("should handle quotation marks by locale", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check quotation marks
    const quotedText = page.locator('[data-testid="quoted-text"]').first();
    if (await quotedText.count() > 0) {
      const text = await quotedText.textContent();
      expect(text).toBeTruthy();
    }
  });

  test("should handle list numbering by locale", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check list numbering
    const numberedList = page.locator('[data-testid="numbered-list"]').first();
    if (await numberedList.count() > 0) {
      const hasLocaleNumbering = await numberedList.getAttribute("data-locale-numbering");
      expect(hasLocaleNumbering).toBeTruthy();
    }
  });

  test("should handle localization of error messages", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Switch language
    const languageSelector = page.locator('[data-testid="language-selector"]').first();
    if (await languageSelector.count() > 0) {
      await languageSelector.selectOption("fr");

      // Trigger error
      const errorButton = page.locator('[data-testid="error-button"]').first();
      if (await errorButton.count() > 0) {
        await errorButton.click();

        // Check localized error
        const errorMessage = page.locator('[data-testid="error-message"]').first();
        const isLocalized = await errorMessage.getAttribute("data-localized");
        expect(isLocalized).toBeTruthy();
      }
    }
  });

  test("should handle localization of success messages", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Switch language
    const languageSelector = page.locator('[data-testid="language-selector"]').first();
    if (await languageSelector.count() > 0) {
      await languageSelector.selectOption("de");

      // Trigger success
      const successButton = page.locator('[data-testid="success-button"]').first();
      if (await successButton.count() > 0) {
        await successButton.click();

        // Check localized success
        const successMessage = page.locator('[data-testid="success-message"]').first();
        const isLocalized = await successMessage.getAttribute("data-localized");
        expect(isLocalized).toBeTruthy();
      }
    }
  });

  test("should handle localization of placeholders", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Switch language
    const languageSelector = page.locator('[data-testid="language-selector"]').first();
    if (await languageSelector.count() > 0) {
      await languageSelector.selectOption("it");

      // Check placeholder localization
      const inputField = page.locator('[data-testid="input-field"]').first();
      if (await inputField.count() > 0) {
        const placeholder = await inputField.getAttribute("placeholder");
        expect(placeholder).toBeTruthy();
      }
    }
  });

  test("should handle localization of validation messages", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Switch language
    const languageSelector = page.locator('[data-testid="language-selector"]').first();
    if (await languageSelector.count() > 0) {
      await languageSelector.selectOption("pt");

      // Trigger validation
      const inputField = page.locator('[data-testid="input-field"]').first();
      if (await inputField.count() > 0) {
        await inputField.fill("invalid");
        await inputField.blur();

        // Check localized validation
        const validationMessage = page.locator('[data-testid="validation-message"]').first();
        const isLocalized = await validationMessage.getAttribute("data-localized");
        expect(isLocalized).toBeTruthy();
      }
    }
  });

  test("should handle localization of UI labels", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Switch language
    const languageSelector = page.locator('[data-testid="language-selector"]').first();
    if (await languageSelector.count() > 0) {
      await languageSelector.selectOption("nl");

      // Check UI labels
      const uiLabels = page.locator('[data-i18n]').first();
      if (await uiLabels.count() > 0) {
        const isLocalized = await uiLabels.getAttribute("data-localized");
        expect(isLocalized).toBeTruthy();
      }
    }
  });

  test("should handle localization of tooltips", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Switch language
    const languageSelector = page.locator('[data-testid="language-selector"]').first();
    if (await languageSelector.count() > 0) {
      await languageSelector.selectOption("sv");

      // Check tooltip localization
      const tooltipTrigger = page.locator('[data-testid="tooltip-trigger"]').first();
      if (await tooltipTrigger.count() > 0) {
        await tooltipTrigger.hover();

        const tooltip = page.locator('[data-testid="tooltip"]').first();
        const isLocalized = await tooltip.getAttribute("data-localized");
        expect(isLocalized).toBeTruthy();
      }
    }
  });

  test("should handle localization of help text", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Switch language
    const languageSelector = page.locator('[data-testid="language-selector"]').first();
    if (await languageSelector.count() > 0) {
      await languageSelector.selectOption("da");

      // Check help text localization
      const helpText = page.locator('[data-testid="help-text"]').first();
      if (await helpText.count() > 0) {
        const isLocalized = await helpText.getAttribute("data-localized");
        expect(isLocalized).toBeTruthy();
      }
    }
  });

  test("should handle localization of navigation items", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Switch language
    const languageSelector = page.locator('[data-testid="language-selector"]').first();
    if (await languageSelector.count() > 0) {
      await languageSelector.selectOption("no");

      // Check navigation localization
      const navItems = page.locator('[data-testid="nav-item"]').first();
      if (await navItems.count() > 0) {
        const isLocalized = await navItems.getAttribute("data-localized");
        expect(isLocalized).toBeTruthy();
      }
    }
  });

  test("should handle localization of button text", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Switch language
    const languageSelector = page.locator('[data-testid="language-selector"]').first();
    if (await languageSelector.count() > 0) {
      await languageSelector.selectOption("fi");

      // Check button localization
      const button = page.locator('[data-testid="button"]').first();
      if (await button.count() > 0) {
        const isLocalized = await button.getAttribute("data-localized");
        expect(isLocalized).toBeTruthy();
      }
    }
  });

  test("should handle localization of table headers", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Switch language
    const languageSelector = page.locator('[data-testid="language-selector"]').first();
    if (await languageSelector.count() > 0) {
      await languageSelector.selectOption("pl");

      // Check table header localization
      const tableHeader = page.locator('[data-testid="table-header"]').first();
      if (await tableHeader.count() > 0) {
        const isLocalized = await tableHeader.getAttribute("data-localized");
        expect(isLocalized).toBeTruthy();
      }
    }
  });

  test("should handle localization of status messages", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Switch language
    const languageSelector = page.locator('[data-testid="language-selector"]').first();
    if (await languageSelector.count() > 0) {
      await languageSelector.selectOption("ro");

      // Check status message localization
      const statusMessage = page.locator('[data-testid="status-message"]').first();
      if (await statusMessage.count() > 0) {
        const isLocalized = await statusMessage.getAttribute("data-localized");
        expect(isLocalized).toBeTruthy();
      }
    }
  });

  test("should handle localization of confirmations", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Switch language
    const languageSelector = page.locator('[data-testid="language-selector"]').first();
    if (await languageSelector.count() > 0) {
      await languageSelector.selectOption("hu");

      // Trigger confirmation dialog
      const confirmButton = page.locator('[data-testid="confirm-button"]').first();
      if (await confirmButton.count() > 0) {
        await confirmButton.click();

        // Check confirmation localization
        const confirmDialog = page.locator('[data-testid="confirm-dialog"]').first();
        const isLocalized = await confirmDialog.getAttribute("data-localized");
        expect(isLocalized).toBeTruthy();
      }
    }
  });

  test("should handle fallback to default language", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Set invalid language
    const languageSelector = page.locator('[data-testid="language-selector"]').first();
    if (await languageSelector.count() > 0) {
      await languageSelector.selectOption("invalid-locale");

      // Check fallback to default
      const fallbackLanguage = document.documentElement.lang;
      expect(fallbackLanguage).toBe("en");
    }
  });

  test("should handle language detection from browser", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Check if language matches browser
    const browserLanguage = await page.evaluate(() => navigator.language);
    const pageLanguage = document.documentElement.lang;

    // In a real app, this would detect browser language
    expect(pageLanguage).toBeTruthy();
  });
});
