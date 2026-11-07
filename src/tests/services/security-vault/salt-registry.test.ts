/**
 * ADR-053 Phase A — salt registry invariants.
 *
 * The registry is the code-level contract for per-vault salt governance:
 * these tests pin the asymmetry that ADR-053 elevates from accident to
 * contract (kdf_salt rotates with the password, db_salt never does), the
 * uniqueness of on-disk keys, and the guard against duplicate entries.
 *
 * Note: descriptor storageKey VALUES are persisted disk format (ADR-053
 * A-2) — they are asserted here as frozen, not "stabilized".
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DB_SALT_DESCRIPTOR,
  FORBIDDEN_DISK_RENAMES,
  KDF_SALT_DESCRIPTOR,
  VAULT_SALT_REGISTRY,
} from "../../../services/security-vault/salt-registry";
import { SECURE_STORAGE_KEYS } from "../../../services/security-vault/constants";
import { STORAGE_KEYS } from "../../../constants/storage-keys";

const REGISTRY_MODULE = "../../../services/security-vault/salt-registry";

describe("salt-registry (ADR-053 Phase A invariants)", () => {
  it("registers exactly the two per-vault salts", () => {
    expect(VAULT_SALT_REGISTRY).toHaveLength(2);
    expect(VAULT_SALT_REGISTRY).toContain(KDF_SALT_DESCRIPTOR);
    expect(VAULT_SALT_REGISTRY).toContain(DB_SALT_DESCRIPTOR);
  });

  it("assigns distinct on-disk keys to every entry", () => {
    const diskKeys = VAULT_SALT_REGISTRY.map((d) => d.storageKey);
    expect(new Set(diskKeys).size).toBe(diskKeys.length);
  });

  it("pins the persisted disk format (ADR-053 A-2: renames are forbidden)", () => {
    // These strings are stored vault data. Changing either one without a
    // valued migration bricks existing vaults — the registry must keep
    // them byte-for-byte.
    expect(KDF_SALT_DESCRIPTOR.storageKey).toBe(SECURE_STORAGE_KEYS.KDF_SALT);
    expect(KDF_SALT_DESCRIPTOR.storageKey).toBe("kdf_salt");
    expect(DB_SALT_DESCRIPTOR.storageKey).toBe("vault_salt");
    // The registry key and the legacy localStorage key denote the same
    // disk slot: migration reads STORAGE_KEYS.VAULT_SALT and writes the
    // registry key (database.ts).
    expect(STORAGE_KEYS.VAULT_SALT).toBe(DB_SALT_DESCRIPTOR.storageKey);
    expect(FORBIDDEN_DISK_RENAMES.has("kdf_salt")).toBe(true);
    expect(FORBIDDEN_DISK_RENAMES.has("vault_salt")).toBe(true);
  });

  it("declares the lifecycle asymmetry: kdf_salt rotates, db_salt never does", () => {
    expect(KDF_SALT_DESCRIPTOR.rotatesWithPassword).toBe(true);
    expect(DB_SALT_DESCRIPTOR.rotatesWithPassword).toBe(false);
    // ADR-053 decision 3: the ADR-046 rollback table must never be
    // "completed" with db_salt.
    expect(KDF_SALT_DESCRIPTOR.syncCrossTab).toBe(true);
    expect(DB_SALT_DESCRIPTOR.syncCrossTab).toBe(false);
  });

  it("records governance and one purpose per entry (no value sharing)", () => {
    expect(KDF_SALT_DESCRIPTOR.governance).toBe("ADR-046");
    expect(DB_SALT_DESCRIPTOR.governance).toBe("ADR-053");
    const purposes = VAULT_SALT_REGISTRY.map((d) => d.purpose);
    expect(new Set(purposes).size).toBe(purposes.length);
    // Descriptors carry contracts, never salt material.
    for (const descriptor of VAULT_SALT_REGISTRY) {
      expect(Object.values(descriptor)).not.toContain(
        expect.stringMatching(/^[0-9a-f]{32}$/),
      );
    }
  });

  it("throws at import time when a duplicate storageKey is registered", async () => {
    vi.resetModules();
    // Force the collision: make the constants entry equal the hardcoded
    // db_salt disk key so the two descriptors claim the same slot.
    vi.doMock("../../../services/security-vault/constants", () => ({
      SECURE_STORAGE_KEYS: {
        ...SECURE_STORAGE_KEYS,
        KDF_SALT: "vault_salt",
      },
    }));
    try {
      await expect(import(REGISTRY_MODULE)).rejects.toThrow(
        /duplicate storageKey "vault_salt"/,
      );
    } finally {
      vi.doUnmock("../../../services/security-vault/constants");
      vi.resetModules();
    }
  });
});
