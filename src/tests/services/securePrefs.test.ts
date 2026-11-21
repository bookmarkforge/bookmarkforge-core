/**
 * src/tests/services/securePrefs.test.ts
 *
 * Unit tests for the SecureStorage-backed preference accessor
 * (PLAN-N6-N7-storage-hardening, Fase 1): lazy localStorage migration,
 * dual-store writes/removes, and failure fallbacks.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getSecret: vi.fn(),
  setSecret: vi.fn(),
  deleteSecret: vi.fn(),
  migrateFromLocalStorage: vi.fn(),
}));

vi.mock("../../services/SecureStorage", () => ({
  secureStorage: {
    getSecret: mocks.getSecret,
    setSecret: mocks.setSecret,
    deleteSecret: mocks.deleteSecret,
    migrateFromLocalStorage: mocks.migrateFromLocalStorage,
  },
}));

import {
  securePrefGet,
  securePrefSet,
  securePrefRemove,
  migrateAllSecurePrefs,
  SECURE_PREF_STORAGE_KEYS,
} from "../../services/securePrefs";
import { STORAGE_KEYS } from "../../constants/storage-keys";

const KEY = STORAGE_KEYS.CUSTOM_PROMPTS_SUMMARIZE;
const SECURE_ID = `bmf_pref_${KEY}`;

describe("securePrefs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    mocks.getSecret.mockResolvedValue(null);
    mocks.setSecret.mockResolvedValue(undefined);
    mocks.deleteSecret.mockResolvedValue(undefined);
    mocks.migrateFromLocalStorage.mockResolvedValue(true);
  });

  it("returns the SecureStorage value when present", async () => {
    mocks.getSecret.mockResolvedValue("prompt text");
    await expect(securePrefGet(KEY)).resolves.toBe("prompt text");
    expect(mocks.getSecret).toHaveBeenCalledWith(SECURE_ID);
    expect(mocks.setSecret).not.toHaveBeenCalled();
  });

  it("lazily migrates a legacy localStorage value on first read", async () => {
    window.localStorage.setItem(KEY, "legacy prompt");
    await expect(securePrefGet(KEY)).resolves.toBe("legacy prompt");
    expect(mocks.setSecret).toHaveBeenCalledWith(SECURE_ID, "legacy prompt");
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("keeps the localStorage copy when the migration write fails", async () => {
    window.localStorage.setItem(KEY, "legacy prompt");
    mocks.setSecret.mockRejectedValue(new Error("idb blocked"));
    await expect(securePrefGet(KEY)).resolves.toBe("legacy prompt");
    expect(window.localStorage.getItem(KEY)).toBe("legacy prompt");
  });

  it("falls back to localStorage when SecureStorage read throws", async () => {
    window.localStorage.setItem(KEY, "fallback value");
    mocks.getSecret.mockRejectedValue(new Error("decrypt failed"));
    await expect(securePrefGet(KEY)).resolves.toBe("fallback value");
  });

  it("returns null when the key is unset anywhere", async () => {
    await expect(securePrefGet(KEY)).resolves.toBeNull();
    expect(mocks.setSecret).not.toHaveBeenCalled();
  });

  it("securePrefSet writes SecureStorage and scrubs localStorage", async () => {
    window.localStorage.setItem(KEY, "stale plaintext");
    await securePrefSet(KEY, "new value");
    expect(mocks.setSecret).toHaveBeenCalledWith(SECURE_ID, "new value");
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("securePrefSet falls back to localStorage when SecureStorage fails", async () => {
    mocks.setSecret.mockRejectedValue(new Error("idb blocked"));
    await securePrefSet(KEY, "kept value");
    expect(window.localStorage.getItem(KEY)).toBe("kept value");
  });

  it("securePrefRemove deletes from both stores", async () => {
    window.localStorage.setItem(KEY, "x");
    await securePrefRemove(KEY);
    expect(mocks.deleteSecret).toHaveBeenCalledWith(SECURE_ID);
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("migrateAllSecurePrefs sweeps every registered key", async () => {
    await migrateAllSecurePrefs();
    expect(mocks.migrateFromLocalStorage).toHaveBeenCalledTimes(
      SECURE_PREF_STORAGE_KEYS.length,
    );
    for (const storageKey of SECURE_PREF_STORAGE_KEYS) {
      expect(mocks.migrateFromLocalStorage).toHaveBeenCalledWith(
        storageKey,
        `bmf_pref_${storageKey}`,
      );
    }
  });

  it("migrateAllSecurePrefs continues after a per-key failure", async () => {
    mocks.migrateFromLocalStorage
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue(true);
    await expect(migrateAllSecurePrefs()).resolves.toBeUndefined();
    expect(mocks.migrateFromLocalStorage).toHaveBeenCalledTimes(
      SECURE_PREF_STORAGE_KEYS.length,
    );
  });
});
