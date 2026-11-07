type DateLike = Date | string | number;

const FALLBACK_LOCALE = "en-US";

// Right-to-left languages. Extend this list if `fa`/`ur` locales are ever
// added; the UI flips via [dir="rtl"] + logical CSS properties.
const RTL_LANGUAGES = new Set(["ar", "he"]);

export function isRTLanguage(lng: string): boolean {
  return RTL_LANGUAGES.has(lng);
}

/**
 * Maps base language codes to full BCP-47 tags accepted by the Web Speech
 * API (recognition + synthesis). Browsers reject bare codes like "es" on
 * some platforms, so every locale gets an explicit region tag.
 */
const LANG_TO_BCP47: Record<string, string> = {
  ar: "ar-SA", bg: "bg-BG", cs: "cs-CZ", da: "da-DK", de: "de-DE",
  el: "el-GR", en: "en-US", es: "es-ES", fi: "fi-FI", fr: "fr-FR",
  he: "he-IL", hi: "hi-IN", hr: "hr-HR", hu: "hu-HU", id: "id-ID",
  it: "it-IT", ja: "ja-JP", ko: "ko-KR", nl: "nl-NL", no: "nb-NO",
  pl: "pl-PL", pt: "pt-PT", ro: "ro-RO", ru: "ru-RU", sv: "sv-SE",
  th: "th-TH", tr: "tr-TR", uk: "uk-UA", vi: "vi-VN", zh: "zh-CN",
};

/**
 * Resolves an i18n language to a full BCP-47 speech tag: region-tagged
 * values pass through ("es-ES"), base codes are mapped, unknown codes fall
 * back to en-US rather than failing.
 */
export function toBcp47SpeechLang(lang: string | undefined): string {
  if (!lang) {return "en-US";}
  if (lang.includes("-")) {return lang;}
  return LANG_TO_BCP47[lang] ?? "en-US";
}

/** Sync <html dir> with the active language (safe outside the browser). */
export function applyLanguageDirection(lng: string): void {
  if (typeof document === "undefined") return;
  document.documentElement.dir = isRTLanguage(lng) ? "rtl" : "ltr";
}

// Intl constructors throw RangeError on an invalid locale. Validate and
// fall back so a caller passing an untrusted/garbage locale can't crash render.
function safeLocale(locale: string | undefined): string {
  if (!locale || typeof locale !== "string") {return FALLBACK_LOCALE;}
  try {
    new Intl.DateTimeFormat(locale);
    return locale;
  } catch (_err) {
    return FALLBACK_LOCALE;
  }
}

function toDate(value: DateLike): Date {
  if (value instanceof Date) {return value;}
  if (typeof value === "string") {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {throw new RangeError("Invalid date string");}
    return d;
  }
  return new Date(value);
}

function safeDateTimeFormat(
  value: DateLike,
  options: Intl.DateTimeFormatOptions,
  locale: string,
): string {
  if (value == null) {return "";}
  const d = toDate(value);
  try {
    return new Intl.DateTimeFormat(safeLocale(locale), options).format(d);
  } catch (_err) {
    return new Intl.DateTimeFormat(FALLBACK_LOCALE, options).format(d);
  }
}

export function formatDate(
  value: DateLike,
  options: Intl.DateTimeFormatOptions = {},
  locale = "en-US",
): string {
  return safeDateTimeFormat(value, options, locale);
}
