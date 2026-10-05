import { describe, expect, it, vi, beforeEach } from "vitest";

const encryptWithBytes = vi.fn();
const decryptWithBytes = vi.fn();
const zeroPasswordBytes = vi.fn();

vi.mock("../../../services/EncryptionService", () => ({
  encryptionService: { encryptWithBytes, decryptWithBytes },
}));

vi.mock("../../../utils/crypto-core", () => ({
  zeroPasswordBytes,
}));

const { SECURE_STORAGE_KEYS } = await import("../../../services/security-vault/constants");
const secrets = await import("../../../services/security-vault/secrets");

type Context = Parameters<typeof secrets.encryptSecret>[2];

function makeContext(overrides: Partial<Context> = {}): Context {
  return {
    getMasterPasswordBytes: () => new Uint8Array([1, 2, 3]),
    assertUnlocked: vi.fn(),
    recordAudit: vi.fn(),
    hasMasterPassword: vi.fn().mockResolvedValue(true),
    setMasterPasswordConfiguredFlag: vi.fn().mockResolvedValue(undefined),
    getSecret: vi.fn().mockResolvedValue(null),
    setSecret: vi.fn().mockResolvedValue(undefined),
    deleteSecret: vi.fn().mockResolvedValue(undefined),
    getRecoveryData: vi.fn().mockResolvedValue(null),
    setRecoveryData: vi.fn().mockResolvedValue(undefined),
    clearRecoveryData: vi.fn().mockResolvedValue(undefined),
    hasRecoveryData: vi.fn().mockResolvedValue(false),
    migrateFromLocalStorage: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  encryptWithBytes.mockResolvedValue("encrypted");
  decryptWithBytes.mockResolvedValue("plaintext");
});

describe("security-vault secrets", () => {
  it("encrypts, stores, audits, and zeroizes the password copy", async () => {
    const ctx = makeContext();

    await expect(secrets.encryptSecret("value", "custom-key", ctx)).resolves.toBe("encrypted");

    expect(ctx.assertUnlocked).toHaveBeenCalledWith("custom-key", "encrypt");
    expect(encryptWithBytes).toHaveBeenCalledWith("value", expect.any(Uint8Array));
    expect(ctx.setSecret).toHaveBeenCalledWith("custom-key", "encrypted");
    expect(ctx.recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "secret_encrypt",
      target: "custom-key",
      result: "success",
    }));
    expect(zeroPasswordBytes).toHaveBeenCalledWith(expect.any(Uint8Array));
  });

  it("zeroizes the password copy when encryption or storage fails", async () => {
    encryptWithBytes.mockRejectedValueOnce(new Error("crypto failed"));
    const ctx = makeContext();

    await expect(secrets.encryptSecret("value", "key", ctx)).rejects.toThrow("crypto failed");
    expect(zeroPasswordBytes).toHaveBeenCalledOnce();
  });

  it("decrypts an existing secret and audits success", async () => {
    const ctx = makeContext({ getSecret: vi.fn().mockResolvedValue("ciphertext") });

    await expect(secrets.decryptSecret("key", ctx)).resolves.toBe("plaintext");

    expect(ctx.assertUnlocked).toHaveBeenCalledWith("key", "decrypt");
    expect(decryptWithBytes).toHaveBeenCalledWith("ciphertext", expect.any(Uint8Array));
    expect(ctx.recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "secret_decrypt",
      result: "success",
    }));
    expect(zeroPasswordBytes).toHaveBeenCalledOnce();
  });

  it("audits and rejects a missing secret", async () => {
    const ctx = makeContext();

    await expect(secrets.decryptSecret("missing", ctx)).rejects.toThrow("Secret not found");
    expect(decryptWithBytes).not.toHaveBeenCalled();
    expect(ctx.recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "secret_decrypt",
      target: "missing",
      result: "failure",
    }));
  });

  it("supports existence, deletion, recovery, and migration operations", async () => {
    const getSecret = vi.fn().mockResolvedValue("present");
    const ctx = makeContext({ getSecret });

    await expect(secrets.hasSecret("key", ctx)).resolves.toBe(true);
    await secrets.deleteSecret("key", ctx);
    await secrets.setRecoveryData("recovery", ctx);
    await expect(secrets.getRecoveryData(ctx)).resolves.toBeNull();
    await expect(secrets.hasRecoveryData(ctx)).resolves.toBe(false);
    await secrets.clearRecoveryData(ctx);
    await secrets.setMasterPasswordFlag(ctx);
    await secrets.migrateFromLocalStorage(ctx);

    expect(ctx.deleteSecret).toHaveBeenCalledWith("key");
    expect(ctx.recordAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "secret_delete" }));
    expect(ctx.setRecoveryData).toHaveBeenCalledWith("recovery");
    expect(ctx.clearRecoveryData).toHaveBeenCalledOnce();
    expect(ctx.setMasterPasswordConfiguredFlag).toHaveBeenCalledOnce();
    expect(ctx.migrateFromLocalStorage).toHaveBeenNthCalledWith(
      1,
      "recovery_data",
      SECURE_STORAGE_KEYS.RECOVERY_DATA,
    );
    expect(ctx.migrateFromLocalStorage).toHaveBeenNthCalledWith(
      2,
      "encrypted_api_key",
      SECURE_STORAGE_KEYS.API_KEY,
    );
  });

  it("returns the configured-password state only in a browser context", async () => {
    const ctx = makeContext({ hasMasterPassword: vi.fn().mockResolvedValue(true) });
    await expect(secrets.hasMasterPassword(ctx)).resolves.toBe(true);

    vi.stubGlobal("window", undefined);
    await expect(secrets.hasMasterPassword(ctx)).resolves.toBe(false);
    vi.unstubAllGlobals();
  });
});
