import { describe, it, expect } from "vitest";
import { STORAGE_KEYS } from "../../constants/storage-keys";

describe("STORAGE_KEYS", () => {
  it("exports a non-empty collection of keys", () => {
    const entries = Object.entries(STORAGE_KEYS);
    expect(entries.length).toBeGreaterThan(40);
  });

  it("every value is a non-empty string", () => {
    for (const [name, value] of Object.entries(STORAGE_KEYS)) {
      expect(typeof value).toBe("string");
      expect(value.length, `${name} has an empty value`).toBeGreaterThan(0);
    }
  });

  it("all values are unique (no accidental duplicates)", () => {
    const values = Object.values(STORAGE_KEYS);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
  });

  it("no key name collides with its value (readable contract)", () => {
    for (const [name, value] of Object.entries(STORAGE_KEYS)) {
      expect(name).not.toBe(value);
    }
  });

  it("documents the central namespace convention for forge_ keys", () => {
    expect(STORAGE_KEYS.ONBOARDING_COMPLETE).toBe("forge_onboarding_complete");
    expect(STORAGE_KEYS.WELCOME_TOUR_COMPLETE).toBe("forge_welcome_tour_complete");
    expect(STORAGE_KEYS.HAS_MASTER_PASSWORD).toBe("forge_has_master_password");
    expect(STORAGE_KEYS.CSP_PROFILE).toBe("forge_csp_profile");
    expect(STORAGE_KEYS.NUCLEAR_AUDIT).toBe("forge_nuclear_audit");
  });

  it("keeps sensitive vault keys stable", () => {
    expect(STORAGE_KEYS.VAULT_SALT).toBe("vault_salt");
    expect(STORAGE_KEYS.VAULT_CRYPTO_KEY).toBe("vault_crypto_key");
  });

  it("keeps theme and i18n keys stable", () => {
    expect(STORAGE_KEYS.THEME).toBe("bookmarkforge-theme");
    expect(STORAGE_KEYS.I18N_LANGUAGE).toBe("i18nextLng");
  });

  it("keeps cloud backup keys stable", () => {
    expect(STORAGE_KEYS.BOOKMARKFORGE_CLOUD_PROVIDER).toBe(
      "bookmarkforge_cloud_provider",
    );
    expect(STORAGE_KEYS.BOOKMARKFORGE_CLOUD_AUTOBACKUP).toBe(
      "bookmarkforge_cloud_autobackup",
    );
  });
});
