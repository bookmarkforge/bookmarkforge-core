/**
 * ADR-052 Phase 1 — `reportVaultSecretFormatExposure` unit tests.
 *
 * The exposure report is the measurable gate for the v5 sunset: Phase 3
 * (legacy read-path removal) may only proceed when this report reaches zero
 * legacyV5 for a given vault. These tests pin its contract:
 *   - classification of v5/v6/absent secrets across the boot-path corpus;
 *   - "unknown" (never zero) when any secret is unreadable;
 *   - strictly read-only behavior (no writes, no crypto-layer mutation).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  secureStorage: {
    getSecret: vi.fn(),
    setSecret: vi.fn(),
    deleteSecret: vi.fn(),
  },
  encryptionService: {
    configureVaultKdfSalt: vi.fn(),
    getVaultKdfSaltHex: vi.fn(),
    decryptWithBytes: vi.fn(),
    encryptWithBytes: vi.fn(),
  },
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../../services/SecureStorage", () => ({
  secureStorage: mocks.secureStorage,
}));
vi.mock("../../../services/EncryptionService", () => ({
  encryptionService: mocks.encryptionService,
}));
vi.mock("../../../utils/logger", () => ({ logger: mocks.logger }));

import {
  reportVaultSaltInventory,
  reportVaultSecretFormatExposure,
} from "../../../services/security-vault/kdf-salt";
import { SECURE_STORAGE_KEYS } from "../../../services/security-vault/constants";

describe("ADR-052 Phase 1 — vault secret format exposure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("classifies v5, v6 and absent secrets across the boot-path corpus", async () => {
    mocks.secureStorage.getSecret.mockImplementation((key: string) => {
      if (key === SECURE_STORAGE_KEYS.DB_KEY) {
        return Promise.resolve("v6:salted-payload");
      }
      if (key === SECURE_STORAGE_KEYS.API_KEY) {
        return Promise.resolve("v5:legacy-payload");
      }
      // Verification token absent (fresh vault, pre-mint).
      return Promise.resolve(null);
    });

    const report = await reportVaultSecretFormatExposure();

    expect(report).toEqual({
      status: "ok",
      inspected: 2,
      legacyV5: 1,
      saltedV6: 1,
      legacyKeys: [SECURE_STORAGE_KEYS.API_KEY],
    });
  });

  it("reports a fully migrated vault as zero (the Phase 3 gate condition)", async () => {
    mocks.secureStorage.getSecret.mockImplementation((key: string) =>
      key === SECURE_STORAGE_KEYS.VERIFICATION
        ? Promise.resolve("v6:token")
        : Promise.resolve("v6:payload"),
    );

    const report = await reportVaultSecretFormatExposure();

    expect(report.status).toBe("ok");
    expect(report.legacyV5).toBe(0);
    expect(report.legacyKeys).toEqual([]);
    expect(report.saltedV6).toBe(report.inspected);
  });

  it("reports unknown (never zero) when a secret is unreadable", async () => {
    mocks.secureStorage.getSecret.mockImplementation((key: string) => {
      if (key === SECURE_STORAGE_KEYS.DB_KEY) {
        // Locked device key surface: the read itself throws.
        return Promise.reject(new Error("device key wrapped"));
      }
      return Promise.resolve("v6:payload");
    });

    const report = await reportVaultSecretFormatExposure();

    // Zero here would falsely signal a fully migrated vault — the exact
    // failure ADR-052's Phase 3 gate must not be able to see.
    expect(report.status).toBe("unknown");
    expect(report.legacyV5).toBe(0);
    expect(report.inspected).toBe(0);
  });

  it("is strictly read-only: no writes, no deletes, no crypto-layer mutation", async () => {
    mocks.secureStorage.getSecret.mockResolvedValue("v5:legacy");

    await reportVaultSecretFormatExposure();

    expect(mocks.secureStorage.setSecret).not.toHaveBeenCalled();
    expect(mocks.secureStorage.deleteSecret).not.toHaveBeenCalled();
    expect(mocks.encryptionService.configureVaultKdfSalt).not.toHaveBeenCalled();
    expect(mocks.encryptionService.decryptWithBytes).not.toHaveBeenCalled();
    expect(mocks.encryptionService.encryptWithBytes).not.toHaveBeenCalled();
  });
});

describe("ADR-053 Phase B — unified per-salt inventory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("emits one entry per registry descriptor with provision and governance", async () => {
    mocks.secureStorage.getSecret.mockImplementation(async (key: string) => {
      if (key === "kdf_salt") {return "a".repeat(32);}
      if (key === "vault_salt") {return "b".repeat(32);}
      return null;
    });

    const inventory = await reportVaultSaltInventory();
    expect(inventory).toHaveLength(2);
    expect(inventory.map((entry) => entry.purpose)).toEqual([
      "master-kdf",
      "db-key-kdf",
    ]);
    expect(inventory[0]).toMatchObject({
      governance: "ADR-046",
      rotatesWithPassword: true,
      provisioned: true,
    });
    expect(inventory[1]).toMatchObject({
      governance: "ADR-053",
      rotatesWithPassword: false,
      provisioned: true,
    });
  });

  it("attaches the v5/v6 corpus classification to the master-kdf entry only", async () => {
    mocks.secureStorage.getSecret.mockImplementation(async (key: string) => {
      if (key === "kdf_salt") {return "a".repeat(32);}
      if (key === "vault_salt") {return "b".repeat(32);}
      if (key === SECURE_STORAGE_KEYS.VERIFICATION) {
        return "v6:00000000000000000000000000000000:"
          + "0".repeat(64);
      }
      return null;
    });

    const inventory = await reportVaultSaltInventory();
    expect(inventory[0]?.corpus).toEqual({ legacyV5: 0, saltedV6: 1, legacyKeys: [] });
    expect(inventory[1]?.corpus).toBeUndefined();
  });

  it("omits corpus when the exposure report is unknown (no fake zero)", async () => {
    mocks.secureStorage.getSecret.mockRejectedValue(
      new Error("device key wrapped"),
    );

    const inventory = await reportVaultSaltInventory();
    expect(inventory).toHaveLength(2);
    for (const entry of inventory) {
      expect(entry.corpus).toBeUndefined();
      expect(entry.provisioned).toBe(false);
    }
  });

  it("degrades provisioned to false when a salt slot is unreadable", async () => {
    mocks.secureStorage.getSecret.mockImplementation(async (key: string) => {
      if (key === "kdf_salt") {throw new Error("read failed");}
      if (key === "vault_salt") {return "b".repeat(32);}
      return null;
    });

    const inventory = await reportVaultSaltInventory();
    expect(inventory[0]?.provisioned).toBe(false);
    expect(inventory[1]?.provisioned).toBe(true);
  });

  it("stays read-only (no writes, no crypto mutation)", async () => {
    mocks.secureStorage.getSecret.mockResolvedValue(null);
    await reportVaultSaltInventory();
    expect(mocks.secureStorage.setSecret).not.toHaveBeenCalled();
    expect(mocks.secureStorage.deleteSecret).not.toHaveBeenCalled();
    expect(mocks.encryptionService.configureVaultKdfSalt).not.toHaveBeenCalled();
  });
});
