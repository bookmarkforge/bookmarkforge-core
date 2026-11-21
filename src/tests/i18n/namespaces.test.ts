import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  APP_NAMESPACE,
  LANDING_NAMESPACE,
  localeLoadPath,
} from "../../i18n";
import { SUPPORTED_LOCALE_CODES } from "../../constants/locales";

/**
 * Phase 3 contract: the app boots with ONE namespace and ONE language file,
 * and the public copy lives in a separate, on-demand namespace. A regression
 * here silently pulls marketing copy (or a second language) into the first
 * paint, which is exactly what the split exists to prevent.
 */
describe("i18n namespaces — app (eager) vs landing (on demand)", () => {
  it("resolves one file per namespace and language", () => {
    expect(localeLoadPath("es", APP_NAMESPACE)).toBe("/locales/es.json");
    expect(localeLoadPath("es", LANDING_NAMESPACE)).toBe(
      "/locales/landing/es.json",
    );
  });

  it("normalizes regional tags to the shipped locale code", () => {
    expect(localeLoadPath("es-ES", APP_NAMESPACE)).toBe("/locales/es.json");
    expect(localeLoadPath("pt-BR", LANDING_NAMESPACE)).toBe(
      "/locales/landing/pt.json",
    );
  });

  it("ships a landing namespace for every supported locale", () => {
    const missing = SUPPORTED_LOCALE_CODES.filter(
      (code) =>
        !existsSync(join(process.cwd(), "public", "locales", "landing", `${code}.json`)),
    );
    expect(missing).toEqual([]);
  });

  it("keeps the landing namespace free of app-only sections", () => {
    const landing = JSON.parse(
      readFileSync(join(process.cwd(), "public", "locales", "landing", "en.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(landing.hero).toBeTruthy();
    // Help Center and the schema.org graph are server-rendered; neither
    // belongs in a client payload.
    expect(landing.help).toBeUndefined();
    expect(landing.structuredData).toBeUndefined();
  });
});
