import { describe, expect, it } from "vitest";
import {
  SIDEBAR_TAB_IDS,
  BOTTOM_NAV_TAB_IDS,
  SUPPORT_CHAT_TAB_IDS,
  DATA_TAB_ID_VALUES,
  BOTTOM_NAV_TAB_ID_VALUES,
  DATA_TAB_ID_VALUES_CSV,
  BOTTOM_NAV_TAB_ID_VALUES_CSV,
} from "../constants/navigation";
import {
  SUPPORTED_LANGUAGES,
  SUPPORTED_LOCALE_CODES,
  SUPPORTED_LOCALE_CODES_CSV,
} from "../constants/locales";

/**
 * Pins the CSV-projection contract consumed by scripts/check-e2e-selectors.mjs.
 *
 * The gate parses the CSV literals from the constants files' TEXT (it must
 * run on Node 20 CI without .ts type-stripping), so the literals cannot be
 * trusted on their own: THIS test enforces that each literal is exactly the
 * join of the typed array in the same module. A tab id added to
 * SIDEBAR_TAB_IDS without updating the CSV — or the reverse — fails here,
 * keeping the constants file the single source of truth for both the app
 * and the tooling.
 */
describe("constants CSV projections (E2E selector gate contract)", () => {
  it("DATA_TAB_ID_VALUES_CSV is exactly the join of DATA_TAB_ID_VALUES", () => {
    expect(DATA_TAB_ID_VALUES_CSV).toBe(DATA_TAB_ID_VALUES.join(","));
  });

  it("BOTTOM_NAV_TAB_ID_VALUES_CSV is exactly the join of BOTTOM_NAV_TAB_ID_VALUES", () => {
    expect(BOTTOM_NAV_TAB_ID_VALUES_CSV).toBe(
      BOTTOM_NAV_TAB_ID_VALUES.join(","),
    );
  });

  it("SUPPORTED_LOCALE_CODES_CSV is exactly the join of SUPPORTED_LOCALE_CODES", () => {
    expect(SUPPORTED_LOCALE_CODES_CSV).toBe(SUPPORTED_LOCALE_CODES.join(","));
  });

  it("BOTTOM_NAV ids are a subset of the sidebar ids (mobile shows a subset)", () => {
    for (const id of BOTTOM_NAV_TAB_IDS) {
      expect(SIDEBAR_TAB_IDS).toContain(id);
    }
  });

  it("DATA_TAB_ID_VALUES is exactly sidebar + support-chat ids", () => {
    expect([...DATA_TAB_ID_VALUES]).toEqual([
      ...SIDEBAR_TAB_IDS,
      ...SUPPORT_CHAT_TAB_IDS,
    ]);
  });

  it("locale codes derive from SUPPORTED_LANGUAGES and stay unique", () => {
    expect(SUPPORTED_LOCALE_CODES).toHaveLength(30);
    expect(new Set(SUPPORTED_LOCALE_CODES).size).toBe(30);
    expect([...SUPPORTED_LOCALE_CODES]).toEqual(
      SUPPORTED_LANGUAGES.map((l) => l.code),
    );
  });
});
