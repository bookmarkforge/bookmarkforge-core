import { describe, it, expect } from "vitest";
import {
  formatDate,
  isRTLanguage,
  applyLanguageDirection,
  toBcp47SpeechLang,
} from "../../utils/localization";

// We use a fixed 'en-US' locale so the tests are deterministic
const LOCALE = "en-US";

describe("localization utils", () => {
  describe("formatDate", () => {
    it("formats a Date object with an explicit locale", () => {
      const date = new Date(2024, 0, 15); // 15 enero 2024
      const result = formatDate(date, {}, LOCALE);
      expect(result).toContain("2024");
      expect(result).toContain("15");
    });

    it("formats a date as an ISO string", () => {
      const result = formatDate("2024-06-20", {}, LOCALE);
      expect(result).toContain("2024");
      expect(result).toContain("20");
    });

    it("formats a date in numeric timestamp format", () => {
      const ts = new Date(2024, 5, 20).getTime();
      const result = formatDate(ts, {}, LOCALE);
      expect(result).toContain("2024");
    });

    it("accepts custom formatting options", () => {
      const date = new Date(2024, 0, 5);
      const result = formatDate(
        date,
        { month: "short", day: "2-digit" },
        LOCALE,
      );
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe("toBcp47SpeechLang", () => {
    it("falls back to en-US for undefined or empty language", () => {
      expect(toBcp47SpeechLang(undefined)).toBe("en-US");
      expect(toBcp47SpeechLang("")).toBe("en-US");
    });

    it("passes through region-tagged values and maps bare codes", () => {
      expect(toBcp47SpeechLang("es-ES")).toBe("es-ES");
      expect(toBcp47SpeechLang("es")).toBe("es-ES");
      expect(toBcp47SpeechLang("xx")).toBe("en-US");
    });
  });

  describe("RTL direction", () => {
    it("marks Arabic and Hebrew as RTL", () => {
      expect(isRTLanguage("ar")).toBe(true);
      expect(isRTLanguage("he")).toBe(true);
    });

    it("marks LTR languages as not RTL", () => {
      expect(isRTLanguage("en")).toBe(false);
      expect(isRTLanguage("es")).toBe(false);
      expect(isRTLanguage("zh")).toBe(false);
      expect(isRTLanguage("fr")).toBe(false);
      expect(isRTLanguage("de")).toBe(false);
      expect(isRTLanguage("ja")).toBe(false);
      expect(isRTLanguage("pt")).toBe(false);
    });

    it("rejects RTL-adjacent languages not yet in the set (fa, ur)", () => {
      // Persian and Urdu are RTL in practice but not in our Set yet.
      // If they are ever added, this test must be updated.
      expect(isRTLanguage("fa")).toBe(false);
      expect(isRTLanguage("ur")).toBe(false);
    });

    it("rejects language tags with subtags (ar-SA, he-IL)", () => {
      // The Set uses exact match; subtags are not registered.
      expect(isRTLanguage("ar-SA")).toBe(false);
      expect(isRTLanguage("he-IL")).toBe(false);
    });

    it("is safe for unknown/empty languages", () => {
      expect(isRTLanguage("")).toBe(false);
      expect(isRTLanguage("xx")).toBe(false);
      expect(isRTLanguage("zz-ZZ")).toBe(false);
    });

    it("applyLanguageDirection sets dir=rtl for Arabic", () => {
      document.documentElement.dir = "ltr";
      applyLanguageDirection("ar");
      expect(document.documentElement.dir).toBe("rtl");
    });

    it("applyLanguageDirection sets dir=rtl for Hebrew", () => {
      document.documentElement.dir = "ltr";
      applyLanguageDirection("he");
      expect(document.documentElement.dir).toBe("rtl");
    });

    it("applyLanguageDirection resets dir=ltr for English", () => {
      document.documentElement.dir = "rtl";
      applyLanguageDirection("en");
      expect(document.documentElement.dir).toBe("ltr");
    });

    it("applyLanguageDirection handles subtag ar-SA as LTR (not in Set)", () => {
      document.documentElement.dir = "rtl";
      applyLanguageDirection("ar-SA");
      expect(document.documentElement.dir).toBe("ltr");
    });

    it("applyLanguageDirection is idempotent", () => {
      document.documentElement.dir = "ltr";
      applyLanguageDirection("ar");
      applyLanguageDirection("ar");
      expect(document.documentElement.dir).toBe("rtl");
    });

    it("applyLanguageDirection is a no-op outside a browser", () => {
      const doc = globalThis.document;
      (globalThis as any).document = undefined;
      expect(() => applyLanguageDirection("ar")).not.toThrow();
      (globalThis as any).document = doc;
    });
  });

  describe("fuzzing — edge cases (formatDate)", () => {
    it("formatDate con NaN lanza RangeError", () => {
      expect(() => formatDate(NaN, {}, LOCALE)).toThrow();
    });

    it("formatDate con Infinity lanza RangeError", () => {
      expect(() => formatDate(Infinity, {}, LOCALE)).toThrow();
    });

    it("formatDate con null no lanza", () => {
      expect(() => formatDate(null as any, {}, LOCALE)).not.toThrow();
    });

    it("formatDate con undefined no lanza", () => {
      expect(() => formatDate(undefined as any, {}, LOCALE)).not.toThrow();
    });

    it("formatDate con string no-fecha lanza RangeError", () => {
      expect(() => formatDate("not-a-date", {}, LOCALE)).toThrow();
    });

    it("formatDate falls back to en-US when the locale itself is invalid", () => {
      // safeDateTimeFormat's Intl.DateTimeFormat throws for a garbage locale,
      // and the catch branch reformats with FALLBACK_LOCALE.
      const date = new Date(2024, 0, 15);
      const result = formatDate(date, { year: "numeric" }, "not-a-locale!");
      expect(result).toContain("2024");
    });

    it("formatDate falls back when the locale argument is empty", () => {
      const date = new Date(2024, 0, 15);
      const result = formatDate(date, { year: "numeric" }, "");
      expect(result).toContain("2024");
    });
  });
});
