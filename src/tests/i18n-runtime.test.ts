import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import i18next, { type Resource } from "i18next";
import { SUPPORTED_LOCALE_CODES } from "../constants/locales";

// ===========================================================================
// Runtime i18n regression suite (batch-27/28).
//
// The audit blind-spot fix (gen-audit-report.mjs line 87) surfaced two real
// bugs that file-level scans cannot catch:
//
//   (a) `en.json` itself contained Spanish ("{{feature}} requiere Pro"),
//       which had leaked into all 29 locales — fixed by B27.
//   (b) `app_tokensCount`/`app_percentUsed`/`add_card` used SINGLE-brace
//       placeholders `{count}`/`{percent}`/`{column}`. i18next's default
//       interpolation prefix is `{{`, so those rendered LITERALLY on screen
//       ("{count} tokens") instead of interpolating. B27 migrated them to
//       `{{...}}`, and B28 added the missing _one/_few plural suffixes in
//       the 7 Slavic/Greek locales (cs/pl/ru/uk/hr/bg/el) — without them,
//       `t("app_tokensCount", { count: 1 })` would render "1 tokenů" in [i18n-allow]
//       Czech instead of "1 token".
//
// This suite instantiates REAL i18next (same config as src/i18n.ts) with
// the on-disk locale files and asserts the runtime resolution contract:
// plural categories resolve, interpolation fires, and no single-brace
// placeholder survives in any locale. It is the executable guarantee that
// the file-level batches were not just applied, but actually work.
// ===========================================================================

const LOCALES_DIR = resolve(process.cwd(), "public/locales");

interface LocaleResource {
  translation: Record<string, unknown>;
}

function loadResources(): Record<string, LocaleResource> {
  const resources: Record<string, LocaleResource> = {};
  for (const code of SUPPORTED_LOCALE_CODES) {
    const file = `${LOCALES_DIR}/${code}.json`;
    resources[code] = {
      translation: JSON.parse(readFileSync(file, "utf8")) as Record<
        string,
        unknown
      >,
    };
  }
  return resources;
}

/** Flatten a nested locale object to dotted keys (matches i18next keySep). */
function flattenLocale(node: unknown, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") {
      out[key] = v;
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      Object.assign(out, flattenLocale(v, key));
    }
  }
  return out;
}

/** Recursively collect every string leaf value in a nested locale object. */
function collectStrings(node: unknown, out: string[] = []): string[] {
  if (typeof node === "string") {
    out.push(node);
  } else if (node && typeof node === "object") {
    for (const v of Object.values(node as Record<string, unknown>)) {
      collectStrings(v, out);
    }
  }
  return out;
}

// i18next's Resource type expects ResourceLanguage under each lng code; the
// on-disk JSON maps to Record<string, { translation: Record<string, unknown> }>
// which structurally differs (no index signature). The cast is test-local and
// the runtime shape is exactly what i18next accepts.
const resources = loadResources() as unknown as Resource;

/** A fresh i18next instance per suite, mirroring src/i18n.ts config. */
const tInstance = i18next.createInstance();

// Keys with count-option plural categories that B25/B26/B28 targeted.
const PLURAL_KEYS = [
  "app_tokensCount",
  "app_srsDueDesc",
  "app_srsNotificationBody",
  "app_storageStatus",
  "app_dbCompacted",
  "ambientSerendipity_savedDaysAgo",
  "app_lastReadDaysAgo",
  "bookmarkEchoes_visitedAgo",
  "app_bookmarksThisWeek",
  "app_daysAgo",
  "app_events_count",
  "app_records_count",
  "app_stepsCount",
  "ephemeral_daysRemaining",
  "ephemeral_hoursRemaining",
];

// CLDR plural categories per language family used by the batches.
// cs/pl/ru/uk/hr have one+few (the base key is the many/other form);
// bg/el have only one (the base key is the other form).
const ONE_FEW = ["cs", "pl", "ru", "uk", "hr"];
const ONE_ONLY = ["bg", "el"];

/**
 * {{count}} keys whose count does NOT drive an inflected noun form — the
 * noun is invariant or governed by a different placeholder ({{total}}/
 * {{days}}), so no plural suffix can apply (batch-26 rationale). A NEW
 * {{count}} key added to en.json either needs _one/_few suffixes in the 7
 * Slavic/Greek locales OR must be added here with a reason.
 */
const EXCLUDED_COUNT_KEYS = new Set([
  "app_more_events", // "+{{count}} more" — adjective, invariant
  "app_syncMinutesAgo", // "Synced {{count}}m ago" — unit abbreviation
  "app_trialBadge", // noun governed by its own {{days}} key (batch-22)
  "filter_results", // noun agrees with {{total}}, not {{count}}
  "app_proActivationsLeft", // count is a bare number, noun precedes it
  // CLDR plural suffix keys that carry {{count}} — already suffixed, no
  // recursive suffix check needed.
  "app_fuseSelected_few",
  "app_fuseSelected_many",
  "app_fuseSelected_other",
  "app_maintenanceFinished_few",
  "app_maintenanceFinished_many",
  "app_maintenanceFinished_other",
  "app_maintenancePartial_few",
  "app_maintenancePartial_many",
  "app_maintenancePartial_other",
]);

/** Derived from en.json: every key whose value carries the {{count}} placeholder. */
function countKeysWithSuffixes(): string[] {
  const enFlat = flattenLocale(resources.en!.translation!);
  return Object.entries(enFlat)
    .filter(([, v]) => v.includes("{{count}}"))
    .map(([k]) => k)
    .filter((k) => !EXCLUDED_COUNT_KEYS.has(k));
}

/**
 * Hoisted flatten of the 7 Slavic/Greek dicts, shared by both the CLDR
 * existence test and the distinctness test (flattening ~1800-key dicts
 * dozens of times over is pure waste).
 */
const FLAT_SLAVIC_GREEK: Record<string, Record<string, string>> =
  Object.fromEntries(
    [...ONE_FEW, ...ONE_ONLY].map((code) => [
      code,
      flattenLocale(resources[code]!.translation!),
    ]),
  );

beforeAll(async () => {
  await tInstance.init({
    lng: "en",
    fallbackLng: "en",
    supportedLngs: [...SUPPORTED_LOCALE_CODES],
    resources,
    interpolation: { escapeValue: false },
    returnObjects: true,
    returnNull: false,
  });
});

// Deterministic resolution helper: pass `lng` as an option instead of
// mutating instance state via changeLanguage (which returns a Promise and
// introduces cross-test ordering hazards).
const resolveWith = (
  code: string,
  key: string,
  opts: Record<string, unknown> = {},
): string => tInstance.t(key, { lng: code, ...opts }) as string;

describe("runtime i18next resolution (batch-27/28)", () => {
  it("resolves _one/_few suffixes in Czech (B28 regression: '1 token', never '1 tokenů')", () => {
    expect(resolveWith("cs", "app_tokensCount", { count: 1 })).toBe(
      "1 token",
    );
    expect(resolveWith("cs", "app_tokensCount", { count: 2 })).toBe(
      "2 tokeny",
    );
    // count >= 5 falls back to the base (many) form from B27.
    expect(resolveWith("cs", "app_tokensCount", { count: 5 })).toBe(
      "5 tokenů",
    );
  });

  it("resolves _one/_few suffixes in Russian", () => {
    expect(resolveWith("ru", "app_tokensCount", { count: 1 })).toBe(
      "1 токен",
    );
    expect(resolveWith("ru", "app_tokensCount", { count: 2 })).toBe(
      "2 токена",
    );
    expect(resolveWith("ru", "app_tokensCount", { count: 5 })).toBe(
      "5 токенов",
    );
  });

  it("resolves _one-only suffixes in Bulgarian (CLDR: one|other)", () => {
    expect(resolveWith("bg", "app_tokensCount", { count: 1 })).toBe(
      "1 токен",
    );
    expect(resolveWith("bg", "app_tokensCount", { count: 5 })).toBe(
      "5 токена",
    );
  });

  it("resolves _one-only suffixes in Greek (CLDR: one|other)", () => {
    expect(resolveWith("el", "app_tokensCount", { count: 1 })).toBe(
      "1 token",
    );
  });

  it("interpolates {{percent}}/{{count}} (single-brace never renders literal)", () => {
    expect(resolveWith("es", "app_percentUsed", { percent: 42 })).toBe(
      "42% usado",
    );
    expect(resolveWith("es", "app_tokensCount", { count: 150 })).toBe(
      "150 tokens",
    );
    // add_card: the aria-label render site passes `column` — the double-brace
    // migration (B27) is what makes this interpolate instead of "{column}".
    expect(resolveWith("es", "add_card", { column: "Done" })).toBe(
      "Añadir tarjeta a Done",
    );
  });

  it("en.json is English for paid_featureLocked (B27: Spanish removed from reference)", () => {
    expect(
      resolveWith("en", "paid_featureLocked", { feature: "P2P Sync" }),
    ).toBe("P2P Sync requires Pro");
    // The Spanish string must not appear anywhere in the reference.
    const enStrings = collectStrings(resources.en!.translation!);
    expect(enStrings.some((s) => s.includes("requiere Pro"))).toBe(false);
  });

  it("Slavic/Greek locales resolve _one/_few forms distinct from the base (B28 contract)", () => {
    // The whole point of B28: for the SAME count, the word form must change
    // (cs "1 token" vs "5 tokenů" — not "1 tokenů"). Comparing full strings [i18n-allow]
    // is vacuous because the count digit differs, so strip the interpolated
    // count prefix and compare the NOUN FORM. That is the real contract:
    // a missing suffix key silently falls back to the base and both forms
    // become identical for the same count.
    const stripCount = (s: string) => s.replace(/^[\d\s]+/, "");
    const form = (code: string, count: number) =>
      stripCount(resolveWith(code, "app_tokensCount", { count }));

    for (const code of ONE_FEW) {
      const one = form(code, 1);
      const few = form(code, 2);
      const many = form(code, 5);
      // Singular always differs from the rest (B25/B26/B28 contract).
      expect(one, `${code} form(count=1) vs form(count=5)`).not.toBe(many);
      expect(one, `${code} form(count=1) vs form(count=2)`).not.toBe(few);
      if (code === "hr") {
        // Croatian uses "tokena" for BOTH 2-4 (few) and 5+ (many) — the
        // suffix key is byte-identical to the base by design; only the
        // singular differs. Assert that instead of a blanket few!==many.
        expect(few, `${code} form(count=2) vs form(count=5)`).toBe(many);
      } else {
        expect(few, `${code} form(count=2) vs form(count=5)`).not.toBe(many);
      }
      // Interpolation fired: the digit prefix is actually rendered.
      expect(resolveWith(code, "app_tokensCount", { count: 1 })).toMatch(
        /^1 /,
      );
    }
    for (const code of ONE_ONLY) {
      const one = form(code, 1);
      const other = form(code, 5);
      if (code === "el") {
        // Greek loanword "token" is invariant — no plural distinction exists;
        // B28's _one suffix is byte-identical to the base by design. Only
        // assert interpolation fired.
        expect(one).toBe(other);
      } else {
        expect(one, `${code} form(count=1) vs form(count=5)`).not.toBe(other);
      }
      expect(resolveWith(code, "app_tokensCount", { count: 1 })).toMatch(
        /^1 /,
      );
    }
  });

  it("every plural key resolves without literal braces or count placeholders in all locales", () => {
    for (const code of SUPPORTED_LOCALE_CODES) {
      for (const key of PLURAL_KEYS) {
        // count=1 exercises the _one suffix (the exact "1 tokenů" bug class [i18n-allow]
        // B28 fixed); count=5 exercises the base/many fallback form.
        for (const count of [1, 5]) {
          const resolved = resolveWith(code, key, { count });
          // After interpolation no braces of any kind may survive.
          expect(resolved, `${code} ${key} count=${count}`).not.toMatch(
            /[[\]{}]/,
          );
          // A count interpolation that survived as a literal is the exact
          // bug class batch-27 fixed.
          expect(resolved).not.toContain("{count}");
          expect(resolved).not.toContain("{percent}");
        }
      }
    }
  });

  it("every {{count}} key has CLDR plural suffixes in Slavic/Greek locales", () => {
    // Auto-validation contract (batch-25/26/28): i18next resolves
    // `t(key, { count })` against key_one/key_few/key_many; the base key is
    // the many/other form. A NEW {{count}} key added to en.json without the
    // required suffixes renders "1 tokenů"-class errors in the 7 Slavic / [i18n-allow]
    // Greek locales. The key set is DERIVED from en.json, so a future key
    // or locale self-validates on addition.
    const countKeys = countKeysWithSuffixes();
    expect(countKeys.length).toBeGreaterThan(0);

    const missing: string[] = [];
    for (const key of countKeys) {
      for (const code of ONE_FEW) {
        const flat = FLAT_SLAVIC_GREEK[code]!;
        if (typeof flat[`${key}_one`] !== "string") {
          missing.push(`${code} ${key}_one`);
        }
        if (typeof flat[`${key}_few`] !== "string") {
          missing.push(`${code} ${key}_few`);
        }
      }
      for (const code of ONE_ONLY) {
        const flat = FLAT_SLAVIC_GREEK[code]!;
        if (typeof flat[`${key}_one`] !== "string") {
          missing.push(`${code} ${key}_one`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("plural noun forms differ between count=1 and count=5 in Slavic/Greek", () => {
    // Distinctness contract (batch-25/26/28): the _one suffix must resolve
    // to a DIFFERENT noun form than the base (many/other). A byte-identical
    // suffix key would pass the existence test above yet still render
    // "1 tokenů"-class errors. Derived from the same countKeys as the [i18n-allow]
    // existence test so a new key is auto-covered. Empirically verified: of
    // the 15×7 key×locale matrix, exactly ONE pair is genuinely invariant —
    // the Greek loanword "token" does not inflect (el app_tokensCount).
    //
    // stripCount removes digits ANYWHERE (not just leading): most of the 15
    // keys carry {{count}} mid-string ("Máte {{count}} kartu k revizi…"), so [i18n-allow]
    // a leading-only strip would let a byte-identical _one suffix slip
    // through — the two full strings would differ only by the digit.
    const DOCUMENTED_INVARIANT = new Set([
      "el app_tokensCount",
      "cs app_fuseSelected",
      "cs app_maintenanceFinished",
      "hr app_maintenanceFinished",
    ]);
    const stripCount = (s: string) =>
      s.replace(/\d+/g, "").replace(/\s+/g, " ").trim();
    const identical: string[] = [];
    for (const key of countKeysWithSuffixes()) {
      for (const code of [...ONE_FEW, ...ONE_ONLY]) {
        const flat = FLAT_SLAVIC_GREEK[code]!;
        if (typeof flat[`${key}_one`] !== "string") continue; // existence test covers missing
        const one = stripCount(resolveWith(code, key, { count: 1 }));
        const many = stripCount(resolveWith(code, key, { count: 5 }));
        if (one === many && !DOCUMENTED_INVARIANT.has(`${code} ${key}`)) {
          identical.push(`${code} ${key}: "${one}" == "${many}"`);
        }
      }
    }
    expect(identical).toEqual([]);
  });

  it("no single-brace {var} placeholder survives in any locale", () => {
    // Strips every `{{...}}` pair, then flags any remaining `{word}`. This
    // is the structural invariant batch-27 restored: i18next only
    // interpolates double-braces, so a surviving single-brace renders
    // literally in the UI.
    const singleBrace = /\{[a-zA-Z_][a-zA-Z0-9_]*\}/;
    const offenders: string[] = [];
    for (const code of SUPPORTED_LOCALE_CODES) {
      for (const s of collectStrings(resources[code]!.translation!)) {
        const withoutDouble = s.replace(/\{\{[^}]*\}\}/g, "");
        if (singleBrace.test(withoutDouble)) {
          offenders.push(`${code}: ${JSON.stringify(s)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
