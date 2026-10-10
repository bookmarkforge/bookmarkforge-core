import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  validateLocale,
  SUPPORTED_LANGUAGES,
  SCRIPT_INJECTION,
  decodeMarkupEscapes,
  detectUserLanguage,
} from "../i18n";

// detectUserLanguage is internal; we test it via exported API surface
// and by reimporting after clearing localStorage.
beforeEach(() => {
  localStorage.clear();
});

describe("i18n hardening", () => {
  it("declares 30 supported languages", () => {
    expect(SUPPORTED_LANGUAGES).toHaveLength(30);
  });

  it("all supported language codes are 2-letter ISO codes", () => {
    for (const { code } of SUPPORTED_LANGUAGES) {
      expect(code).toMatch(/^[a-z]{2}$/);
    }
  });

  it("accepts a benign nested locale payload", () => {
    const payload = { a: "hello", b: { c: "world", n: 1, flag: true } };
    expect(validateLocale(payload, "en")).toEqual(payload);
  });

  it("rejects a payload with script injection", () => {
    expect(() =>
      validateLocale({ a: "hi <script>alert(1)</script>" }, "en"),
    ).toThrow(/unsafe content/);
    expect(() => validateLocale({ a: "x onerror=alert(1)" }, "en")).toThrow(
      /unsafe content/,
    );
    expect(() => validateLocale({ a: "y javascript:alert(1)" }, "en")).toThrow(
      /unsafe content/,
    );
  });

  it("rejects entity-encoded script injection (L-11: &#x3c;)", () => {
    // The raw regex does NOT match the encoded form — that is the gap L-11
    // closes: after decodeMarkupEscapes it decodes to `<script>`.
    expect(SCRIPT_INJECTION.test("&#x3c;script&#x3e;")).toBe(false);
    expect(() =>
      validateLocale({ a: "&#x3c;script&#x3e;alert(1)" }, "en"),
    ).toThrow(/unsafe content/);
    expect(() =>
      validateLocale({ a: "&lt;script&gt;alert(1)" }, "en"),
    ).toThrow(/unsafe content/);
    // HTML5 decodes numeric references WITHOUT the trailing `;` too.
    expect(() =>
      validateLocale({ a: "&#x3cscript&#x3ealert(1)" }, "en"),
    ).toThrow(/unsafe content/);
  });

  it("rejects \\uXXXX-escaped script injection (L-11: \\u003c)", () => {
    // `\u003c` here is the 6-character literal (backslash-u-0-0-3-c), not a
    // real codepoint — it hides `<script>` from the raw regex.
    expect(SCRIPT_INJECTION.test("\\u003cscript\\u003e")).toBe(false);
    expect(() =>
      validateLocale({ a: "\\u003cscript\\u003ealert(1)" }, "en"),
    ).toThrow(/unsafe content/);
  });

  it("decodeMarkupEscapes normalizes entities and unicode escapes", () => {
    expect(decodeMarkupEscapes("&#x3c;script&#x3e;")).toBe("<script>");
    expect(decodeMarkupEscapes("&#60;&#62;")).toBe("<>");
    expect(decodeMarkupEscapes("&lt;b&gt;")).toBe("<b>");
    expect(decodeMarkupEscapes("\\u003cscript\\u003e")).toBe("<script>");
    expect(decodeMarkupEscapes("&amp;lt;")).toBe("&lt;"); // single DOM pass
  });

  it("accepts benign text with harmless entities (no false positive)", () => {
    expect(() => validateLocale({ a: "R&D is fine" }, "en")).not.toThrow();
    expect(() =>
      validateLocale({ a: "use &amp;lt; to display a less-than" }, "en"),
    ).not.toThrow();
  });

  it("rejects non-object payloads", () => {
    expect(() => validateLocale("str", "en")).toThrow(/Invalid locale/);
    expect(() => validateLocale([1, 2], "en")).toThrow(/Invalid locale/);
    expect(() => validateLocale(null, "en")).toThrow(/Invalid locale/);
  });

  it("rejects unsupported value types", () => {
    expect(() => validateLocale({ a: { b: () => 1 } }, "en")).toThrow(
      /unsupported value type/,
    );
  });

  it("accepts deeply nested benign payload", () => {
    const payload = { a: { b: { c: { d: "text", n: 42, f: false } } } };
    expect(validateLocale(payload, "en")).toEqual(payload);
  });

  it("accepts empty nested objects", () => {
    expect(validateLocale({ a: {}, b: "text" }, "en")).toEqual({
      a: {},
      b: "text",
    });
  });

  it("rejects script injection at nested path", () => {
    expect(() =>
      validateLocale({ level1: { level2: "hello <script>bad</script>" } }, "en"),
    ).toThrow(/unsafe content/);
  });

  it("rejects onerror attribute at nested path", () => {
    expect(() =>
      validateLocale({ x: { y: 'img onerror="alert(1)"' } }, "en"),
    ).toThrow(/unsafe content/);
  });

  it("accepts numbers and booleans at nested paths", () => {
    expect(
      validateLocale({ num: 0, flag: false, nested: { val: 1.5 } }, "en"),
    ).toEqual({ num: 0, flag: false, nested: { val: 1.5 } });
  });

  it("SCRIPT_INJECTION matches dangerous patterns", () => {
    expect(SCRIPT_INJECTION.test("<script>")).toBe(true);
    expect(SCRIPT_INJECTION.test(" onerror=")).toBe(true);
    expect(SCRIPT_INJECTION.test("javascript:alert(1)")).toBe(true);
    expect(SCRIPT_INJECTION.test("safe text")).toBe(false);
    expect(SCRIPT_INJECTION.test("onload=")).toBe(true); // on\w+ now covers all handlers
    expect(SCRIPT_INJECTION.test("<SCRIPT>")).toBe(true); // case-insensitive
  });

  it("rejects non-plain-object at root", () => {
    expect(() => validateLocale(undefined as any, "en")).toThrow(/Invalid locale/);
  });

  it("rejects symbol-valued leaf", () => {
    expect(() => validateLocale({ a: Symbol("x") as any }, "en")).toThrow(
      /unsupported value type/,
    );
  });
});

describe("detectUserLanguage", () => {
  beforeEach(() => {
    localStorage.clear();
    // Reset navigator properties to a known default so each test is
    // order-independent and the principal-language assertions below can
    // deterministically override them.
    Object.defineProperty(navigator, "language", {
      value: "en-US",
      configurable: true,
      writable: true,
    });
    Object.defineProperty(navigator, "languages", {
      value: ["en-US"],
      configurable: true,
      writable: true,
    });
  });

  it("honours a stored user preference", () => {
    localStorage.setItem("i18nextLng", "fr");
    expect(detectUserLanguage()).toBe("fr");
  });

  it("returns the stored value verbatim, without re-validation", () => {
    // Validity lives in the persist schema, not here. A legacy / unknown
    // value MUST be honoured so users on the upgrade path do not get a
    // silent UI reset to English.
    localStorage.setItem("i18nextLng", "zz");
    expect(detectUserLanguage()).toBe("zz");
  });

  it("returns 'en' (the principal language) when no preference is stored", () => {
    expect(detectUserLanguage()).toBe("en");
  });

  it("does NOT consult navigator.language (Spanish browser still boots in 'en')", () => {
    Object.defineProperty(navigator, "language", {
      value: "es-ES",
      configurable: true,
      writable: true,
    });
    expect(detectUserLanguage()).toBe("en");
  });

  it("does NOT consult navigator.language (French browser still boots in 'en')", () => {
    Object.defineProperty(navigator, "language", {
      value: "fr-FR",
      configurable: true,
      writable: true,
    });
    expect(detectUserLanguage()).toBe("en");
  });

  it("does NOT consult navigator.languages (multi-locale browser still boots in 'en')", () => {
    Object.defineProperty(navigator, "languages", {
      value: ["de-AT", "en-US", "es-ES"],
      configurable: true,
      writable: true,
    });
    expect(detectUserLanguage()).toBe("en");
  });

  it("does NOT consult navigator.language for RTL locales (Arabic browser still boots in 'en')", () => {
    // RTL is the strongest test of the principal-language contract because
    // a regression that re-introduces navigator-detection would LTR-flip
    // the unlock / onboarding screens for Arabic / Hebrew OEMs.
    Object.defineProperty(navigator, "language", {
      value: "ar-SA",
      configurable: true,
      writable: true,
    });
    expect(detectUserLanguage()).toBe("en");
  });

  it("does NOT consult navigator.language for RTL locales (Hebrew browser still boots in 'en')", () => {
    Object.defineProperty(navigator, "language", {
      value: "he-IL",
      configurable: true,
      writable: true,
    });
    expect(detectUserLanguage()).toBe("en");
  });
});
