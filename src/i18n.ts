import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import HttpBackend from "i18next-http-backend";

/**
 * Canonical locale registry, owned by `src/constants/locales.ts`.
 *
 * Imported here for local use (the i18next `init` block below builds
 * `supportedLngs: SUPPORTED_LANGUAGES.map((l) => l.code)`), and
 * re-exported so callers (and the legacy test suite in
 * `src/tests/i18n.test.ts`) continue to see the same names as part of
 * `src/i18n.ts`'s public surface. The literal array lives in
 * `./constants/locales` so a Playwright Node-side helper can import it
 * without dragging in the i18next init / `languageChanged`
 * side-effects of this file.
 */
import {
  SUPPORTED_LANGUAGES,
  SUPPORTED_LOCALE_CODES,
  CRITICAL_LOCALE_CODES,
  NIGHTLY_LOCALE_CODES,
  SMALL_FALLBACK_LOCALES,
  type LocaleCode,
  type SupportedLanguage,
} from "./constants/locales";

export {
  SUPPORTED_LANGUAGES,
  SUPPORTED_LOCALE_CODES,
  CRITICAL_LOCALE_CODES,
  NIGHTLY_LOCALE_CODES,
  SMALL_FALLBACK_LOCALES,
};
export type { LocaleCode, SupportedLanguage };

import { safeGet, safeSet } from "./store/safeStorage";
import { usePreferencesStore } from "./store/usePreferencesStore";
import { applyLanguageDirection } from "./utils/localization";
import { analyticsService } from "./services/AnalyticsService";

/**
 * Resolve the active UI language code at app boot.
 *
 * **English (`en`) is the project's principal language.** It ships first,
 * receives new strings first, and is the value `fallbackLng` resolves every
 * missing key against in i18next. To honour that contract we deliberately
 * do NOT auto-detect from `navigator.language`: a Spanish Chrome user would
 * otherwise boot into Spanish without ever seeing English, and the
 * principal-language guarantee would silently break per browser locale.
 *
 * The only legitimate override is an explicit, previously-saved user choice
 * (the `i18nextLng` storage key, mirrored from `usePreferencesStore.language`
 * via the `languageChanged` listener below). When that key is absent —
 * first launch, or after the user cleared site data / uninstalled — we
 * return English unconditionally so the user always sees the principal UI
 * and only ever leaves it through an explicit switch in Settings.
 *
 * Note: NuclearForget preserves `i18nextLng` (it's on the default allowlist
 * in `NuclearForgetService`), so it does NOT reset the UI to English.
 */
export function detectUserLanguage(): string {
  const stored = safeGet("i18nextLng");
  return stored || "en";
}

// SECURITY: validate locale payloads loaded over HTTP. Even though they come
// from the same origin, a compromised bundle/CDN or MITM could swap a locale
// file to inject HTML/scripts (returnObjects:true + escapeValue:false make
// this risky if any component renders a translation via innerHTML). We reject
// payloads that are not plain string-keyed objects or that contain markup.
// Matches <script tags, javascript: URIs, and all inline event handler
// attributes (onerror, onload, onclick, onfocus, etc.) that could execute
// code if a component renders a translation via innerHTML without DOMPurify.
export const SCRIPT_INJECTION = /<script|on\w+\s*=|javascript:/i;

// SECURITY (audit L-11): SCRIPT_INJECTION only sees raw markup — HTML
// numeric/named entities (`&#x3c;`, `&lt;`) and JS unicode escapes
// (`\u003c`) evade it. Decode the forms a browser DOM pass (or a later
// JSON.parse) would interpret BEFORE the regex test, so entity-encoded
// payloads are still rejected. Decoding follows single-pass DOM semantics:
// `&amp;lt;` decodes to `&lt;` (rendered literally), never re-decoded to `<`.
const NAMED_ENTITY_TO_CHAR: Record<string, string> = {
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  equals: "=",
  colon: ":",
  sol: "/",
  period: ".",
  tab: "\t",
  newline: "\n",
  // `amp` last in the alternation below: `&amp;lt;` must stay `&lt;` after
  // one decode pass (DOM-equivalent), never re-decode into `<`.
  amp: "&",
};

/**
 * Decodes the encodings that hide markup from SCRIPT_INJECTION: numeric
 * entities (`&#60;`, `&#x3c;`), JS unicode escapes (`\u003c`) and the named
 * entities mapping to markup-significant ASCII characters. The decoded
 * result is only used for the injection test — original values are never
 * rewritten.
 * @internal exported for tests
 */
export function decodeMarkupEscapes(value: string): string {
  return value
    // Numeric entities: decimal (&#60;) and hex (&#x3c;, case-insensitive).
    // The `;?` mirrors HTML5: numeric character references are decoded even
    // WITHOUT the trailing semicolon (`&#x3cscript&#x3e` renders `<script>`).
    .replace(/&#(?:x([0-9a-f]+)|([0-9]+));?/gi, (match, hex, dec) => {
      const code = parseInt(hex || dec, hex ? 16 : 10);
      return Number.isInteger(code) && code >= 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    })
    // JS unicode escapes: \u003c / \u003C (4 hex digits).
    .replace(/\\u([0-9a-f]{4})/gi, (_match, hex) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    // Named entities for markup-significant characters (amp last).
    .replace(
      /&(lt|gt|quot|apos|equals|colon|sol|period|tab|newline|amp);/gi,
      (match, name) => NAMED_ENTITY_TO_CHAR[name.toLowerCase()] ?? match,
    );
}

export function validateLocale(
  data: unknown,
  lng: string,
): Record<string, unknown> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error(`Invalid locale payload for ${lng}`);
  }
  const walk = (node: unknown, path = ""): void => {
    if (typeof node === "string") {
      // L-11: test the DOM-equivalent decoded form so entity/escape-encoded
      // payloads (`&#x3c;script&#x3e;`, `\u003cscript\u003e`) are rejected
      // too, not only raw `<script>` markup.
      if (SCRIPT_INJECTION.test(decodeMarkupEscapes(node))) {
        throw new Error(
          `Locale ${lng} contains unsafe content at ${path || "<root>"}`,
        );
      }
      return;
    }
    if (node !== null && typeof node === "object") {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        walk(v, path ? `${path}.${k}` : k);
      }
      return;
    }
    // numbers/booleans are fine; anything else is rejected.
    if (
      node !== null &&
      typeof node !== "number" &&
      typeof node !== "boolean"
    ) {
      throw new Error(`Locale ${lng} has unsupported value type at ${path}`);
    }
  };
  walk(data);
  return data as Record<string, unknown>;
}

i18n
  .use(HttpBackend)
  .use(initReactI18next)
  .init({
    lng: detectUserLanguage(),
    fallbackLng: "en",
    supportedLngs: SUPPORTED_LANGUAGES.map((l) => l.code),
    interpolation: {
      escapeValue: false,
    },
    backend: {
      loadPath: "/locales/{{lng}}.json",
      // Validate/parse each fetched locale before i18next uses it.
      parse: (data: string, lng: string) => {
        const parsed = JSON.parse(data);
        return validateLocale(parsed, lng);
      },
    },
    returnObjects: true,
    returnNull: false,
    // i18next's verbose init/language logs are useful during local
    // development, but they drown out real test diagnostics. Keep runtime
    // validation and loading errors enabled; only disable debug formatting in
    // the dedicated test mode.
    debug: import.meta.env.DEV && import.meta.env.MODE !== "test",
  });

// Single subscription point for language changes. Persists to localStorage,
// updates the <html lang> attribute (used by browser runtime + Intl), and
// mirrors the new value into the Zustand preferences slice so React
// components subscribing to `usePreferencesStore((s) => s.language)` re-
// render automatically. This single-listener pattern lets us drop the
// per-component forceUpdate / i18n.on('languageChanged') workarounds in
// LanguageSelector and useSettings — see commit history.
i18n.on("languageChanged", (lng) => {
  // Track language changes in analytics (fire-and-forget — analytics may not
  // be started yet on first boot, which is fine).
  try {
    analyticsService.track("language_changed", { language: lng });
  } catch {
    // analyticsService may not be initialized yet during i18n init — ignore.
  }
  safeSet("i18nextLng", lng);
  applyLanguageDirection(lng);
  document.documentElement.lang = lng;
  // getState() reads the latest store value without subscribing, so no
  // re-render cycle is triggered for the calling listener. The Zustand
  // persist middleware will write `i18nextLng` again (harmlessly) right
  // after this; the redundancy is accepted for the simplification win.
  usePreferencesStore.getState().setLanguage(lng);
});

// Apply direction for the boot language immediately: the languageChanged
// listener fires only after async i18n.init resolves, which would leave the
// unlock/onboarding screens (rendered before init completes) in LTR even for
// ar/he users. Doing it here (sync) covers the whole pre-init window.
applyLanguageDirection(detectUserLanguage());

export default i18n;
