/**
 * src/constants/locales.ts
 *
 * Canonical registry of locales BookmarkForge ships with.
 *
 * ## Why a dedicated module (not inline in src/i18n.ts)?
 *
 * 1. **Zero side effects.** `src/i18n.ts` re-exports from here so the
 *    runtime i18next instance keeps a single source-of-truth (no parallel
 *    definitions), and a Playwright Node-side helper can import this
 *    file without dragging in the i18next init / `languageChanged`
 *    side-effects of `src/i18n.ts`.
 * 2. **TypeScript narrows the union.** `LocaleCode` is the union of all
 *    30 codes; calling `seedLocale(page, "xx")` is a compile-time bug
 *    even before we ship it to dev server.
 * 3. **Spec gate split lives next to the data.** `CRITICAL_LOCALE_CODES`
 *    and `NIGHTLY_LOCALE_CODES` are derived from the same array, so a
 *    future addition to `SUPPORTED_LANGUAGES` automatically reflects in
 *    nightly (no second list to keep in sync).
 *
 * ## Gate split rationale
 *
 * Critical locales run on every CI gate (`npm run e2e`). The set of six
 * is chosen to cover orthogonal UI dimensions in a small footprint:
 *
 *   - `en` — principal language + LTR Latin baseline.
 *   - `es` — second-largest LTR Latin user base, longer words than en.
 *   - `de` — Germanic compound words (longest typical Cyrillic-class
 *     char ratio, surfaces forced-break bugs).
 *   - `zh` — CJK: distinct metrics (no spaces between glyphs) and
 *     vertical-rhythm rules most browsers handle differently.
 *   - `ar` — RTL + Arabic diacritics + Surrogate-pair glyphs.
 *   - `he` — RTL + shorter verb conjugations than Arabic; catches the
 *     exact-`direction: rtl` line-broken bugs `ar` masks.
 *
 * A regression that slips through on any of these six is highly
 * suspect for the long tail. The 24-locale nightly matrix catches
 * drift in the remaining locales.
 *
 * ## Small fallback
 *
 * `SMALL_FALLBACK_LOCALES` is the universal "least set" (`en` / `es`
 * / `de`). It is exported as an alternative to the canonical scope
 * lists and is what `loadLocaleCodes()` returns when env overrides
 * force the gate down to a smoke subset (e.g., local debugging or a
 * quick CI dry run).
 */

export interface SupportedLanguage {
  code: string;
  name: string;
}

export const SUPPORTED_LANGUAGES = [
  { code: "ar", name: "العربية" },
  { code: "bg", name: "Български" },
  { code: "cs", name: "Čeština" },
  { code: "da", name: "Dansk" },
  { code: "de", name: "Deutsch" },
  { code: "el", name: "Ελληνικά" },
  { code: "en", name: "English" },
  { code: "es", name: "Español" },
  { code: "fi", name: "Suomi" },
  { code: "fr", name: "Français" },
  { code: "he", name: "עברית" },
  { code: "hi", name: "हिन्दी" },
  { code: "hr", name: "Hrvatski" },
  { code: "hu", name: "Magyar" },
  { code: "id", name: "Bahasa Indonesia" },
  { code: "it", name: "Italiano" },
  { code: "ja", name: "日本語" },
  { code: "ko", name: "한국어" },
  { code: "nl", name: "Nederlands" },
  { code: "no", name: "Norsk" },
  { code: "pl", name: "Polski" },
  { code: "pt", name: "Português" },
  { code: "ro", name: "Română" },
  { code: "ru", name: "Русский" },
  { code: "sv", name: "Svenska" },
  { code: "th", name: "ไทย" },
  { code: "tr", name: "Türkçe" },
  { code: "uk", name: "Українська" },
  { code: "vi", name: "Tiếng Việt" },
  { code: "zh", name: "中文" },
] as const satisfies ReadonlyArray<SupportedLanguage>;

/** Union of the 30 supported codes. Drives `LocaleCode` everywhere. */
export type LocaleCode = (typeof SUPPORTED_LANGUAGES)[number]["code"];

export const SUPPORTED_LOCALE_CODES: ReadonlyArray<LocaleCode> =
  SUPPORTED_LANGUAGES.map((l): LocaleCode => l.code);

// ---- Machine-readable projection (for tooling, NOT for app code) ---------
// scripts/check-e2e-selectors.mjs parses THIS STRING LITERAL from the file
// text: it must run on Node 20 CI (no .ts type-stripping) and under vitest
// (whose module graph cannot load repo-external .ts). The literal MUST stay
// equal to SUPPORTED_LOCALE_CODES.join(",") — src/tests/constants-vocab.test.ts
// pins that equality, and the gate refuses any CSV entry that is not a
// string literal in this same file.
export const SUPPORTED_LOCALE_CODES_CSV =
  "ar,bg,cs,da,de,el,en,es,fi,fr,he,hi,hr,hu,id,it,ja,ko,nl,no,pl,pt,ro,ru,sv,th,tr,uk,vi,zh";

/** Critical locales run on every CI gate (see gate-split rationale above). */
export const CRITICAL_LOCALE_CODES: ReadonlyArray<LocaleCode> = [
  "en",
  "es",
  "de",
  "zh",
  "ar",
  "he",
];

/**
 * Nightly locales are the remaining SUPPORTED set. Computed at module
 * init so a future addition to SUPPORTED_LANGUAGES is automatically
 * picked up — no second list to keep in sync.
 */
const CRITICAL_SET: ReadonlySet<string> = new Set(CRITICAL_LOCALE_CODES);
export const NIGHTLY_LOCALE_CODES: ReadonlyArray<LocaleCode> =
  SUPPORTED_LOCALE_CODES.filter((code) => !CRITICAL_SET.has(code));

// Self-consistency invariant. Fires exactly once per process at module
// init if CRITICAL + NIGHTLY no longer covers SUPPORTED. The error
// message is conspicuous so a misconfigured split fails loudly on the
// FIRST test run instead of silently skipping a locale in nightly.
if (
  CRITICAL_LOCALE_CODES.length + NIGHTLY_LOCALE_CODES.length !==
    SUPPORTED_LOCALE_CODES.length ||
  CRITICAL_LOCALE_CODES.length === 0
) {
  throw new Error(
    `[constants/locales] CRITICAL (${CRITICAL_LOCALE_CODES.length}) + ` +
      `NIGHTLY (${NIGHTLY_LOCALE_CODES.length}) ≠ SUPPORTED ` +
      `(${SUPPORTED_LOCALE_CODES.length}). Either a locale was added to ` +
      `SUPPORTED_LANGUAGES without bucket-routing, or CRITICAL_LOCALE_CODES ` +
      `was emptied by accident. Update CRITICAL_LOCALE_CODES or split the ` +
      `union manually.`,
  );
}

/**
 * Universal smallest set. Always available alongside the canonical
 * scope lists. Used by `loadLocaleCodes()` when callers force a smoke
 * subset (env override, debug run, frozen CI cache). Three locales are
 * enough to prove the gate works; coverage parity with the canonical
 * list is NOT a goal here — that's what the full critical/nightly sets
 * are for.
 */
export const SMALL_FALLBACK_LOCALES: ReadonlyArray<LocaleCode> = [
  "en",
  "es",
  "de",
];
