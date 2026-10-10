import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const vaultMock = vi.hoisted(() => ({
  withMasterPasswordBytes: vi.fn(),
  isLocked: vi.fn(),
  registerCaller: vi.fn(),
  onLock: vi.fn(() => () => {}),
  onUnlock: vi.fn(() => () => {}),
}));
const loggerMock = vi.hoisted(() => ({
  debug: vi.fn(),
  warn: vi.fn(),
}));
const cryptoMock = vi.hoisted(() => ({
  importKey: vi.fn(),
  sign: vi.fn(),
}));

vi.mock("../../services/SecurityVault", () => ({
  securityVault: vaultMock,
}));
vi.mock("../../utils/logger", () => ({
  logger: loggerMock,
}));

const mockKey = { algorithm: "HMAC" } as unknown as CryptoKey;

import { mutationGuard } from "../../services/security/MutationGuard";

describe("MutationGuard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vaultMock.withMasterPasswordBytes.mockImplementation((_caller, fn) =>
      fn(new TextEncoder().encode("test_password")),
    );
    vaultMock.isLocked.mockResolvedValue(false);
    cryptoMock.importKey.mockResolvedValue(mockKey);
    cryptoMock.sign.mockImplementation((_algo, _key, data) => {
      const input = new Uint8Array(data);
      const sum = input.reduce((a, b) => a + b, 0) & 0xff;
      return new Uint8Array([sum, 0, 0, 0]).buffer;
    });
    vi.stubGlobal("crypto", {
      subtle: { importKey: cryptoMock.importKey, sign: cryptoMock.sign },
    });
    mutationGuard.clearCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("guard returns a signed mutation", async () => {
    const signed = await mutationGuard.guard("theme", "dark");
    expect(signed.key).toBe("theme");
    expect(signed.value).toBe("dark");
    expect(signed.signature).toBeTruthy();
    expect(signed.version).toBe(1);
  });

  it("verify returns true for valid signature", async () => {
    const signed = await mutationGuard.guard("key1", "val1");
    const ok = await mutationGuard.verify(signed);
    expect(ok).toBe(true);
  });

  it("verify returns false if value tampered", async () => {
    const signed = await mutationGuard.guard("key1", "val1");
    signed.value = "tampered";
    const ok = await mutationGuard.verify(signed);
    expect(ok).toBe(false);
  });

  it("verify returns false if timestamp tampered", async () => {
    const signed = await mutationGuard.guard("key1", "val1");
    const tampered = { ...signed, timestamp: "2099-01-01T00:00:00.000Z" };
    const ok = await mutationGuard.verify(tampered);
    expect(ok).toBe(false);
  });

  it("detectTampering identifies tampered values", async () => {
    const stored = [
      await mutationGuard.guard("a", 1),
      await mutationGuard.guard("b", 2),
    ];
    const result = await mutationGuard.detectTampering(stored, [1, 99]);
    expect(result.totalChecked).toBe(2);
    expect(result.tamperedKeys).toEqual(["b"]);
  });

  it("sign caches derived keys per namespace", async () => {
    await mutationGuard.guard("ns1", "x");
    await mutationGuard.guard("ns1", "y");
    expect(cryptoMock.importKey).toHaveBeenCalledTimes(1);
  });

  it("clears key cache on vault lock", async () => {
    await mutationGuard.guard("ns-cache", "first");
    vaultMock.isLocked.mockResolvedValue(true);
    await mutationGuard.guard("ns-cache", "second");
    expect(loggerMock.debug).toHaveBeenCalledWith(
      "[MutationGuard] Vault locked, clearing key cache",
    );
  });

  it("detectTampering only checks up to the shorter array length", async () => {
    const stored = [await mutationGuard.guard("a", 1), await mutationGuard.guard("b", 2), await mutationGuard.guard("c", 3)];
    const result = await mutationGuard.detectTampering(stored, [1, 2]);
    expect(result.totalChecked).toBe(2);
    expect(result.tamperedKeys).toEqual([]);
  });

  it("zeroizes the password copy after key derivation", async () => {
    const passwordBytes = new TextEncoder().encode("test_password");
    vaultMock.withMasterPasswordBytes.mockImplementation((_caller, fn) =>
      fn(passwordBytes),
    );

    await mutationGuard.guard("zeroize", "password-copy");

    expect(passwordBytes.every((byte) => byte === 0)).toBe(true);
  });

  it("zeroizes key material when importKey fails", async () => {
    const passwordBytes = new TextEncoder().encode("test_password");
    let combined: Uint8Array | undefined;
    vaultMock.withMasterPasswordBytes.mockImplementation((_caller, fn) =>
      fn(passwordBytes),
    );
    cryptoMock.importKey.mockImplementationOnce(
      (_algorithm, raw) => {
        combined = raw as Uint8Array;
        return Promise.reject(new Error("import failed"));
      },
    );

    await expect(mutationGuard.guard("import-failure", "value")).rejects.toThrow(
      "MutationGuard: vault locked",
    );

    expect(passwordBytes.every((byte) => byte === 0)).toBe(true);
    expect(combined).toBeDefined();
    expect(combined!.every((byte) => byte === 0)).toBe(true);
  });

  it("throws when signing with a locked vault", async () => {
    vaultMock.withMasterPasswordBytes.mockRejectedValue(new Error("locked"));
    await expect(mutationGuard.guard("x", "y")).rejects.toThrow("MutationGuard: vault locked");
  });

  it("retries key derivation after a temporary failure", async () => {
    vaultMock.withMasterPasswordBytes
      .mockRejectedValueOnce(new Error("temporarily locked"))
      .mockImplementationOnce((_caller, fn) =>
        fn(new TextEncoder().encode("test_password")),
      );

    await expect(mutationGuard.guard("retry", "first")).rejects.toThrow(
      "MutationGuard: vault locked",
    );
    await expect(mutationGuard.guard("retry", "second")).resolves.toMatchObject({
      key: "retry",
      value: "second",
    });
    expect(cryptoMock.importKey).toHaveBeenCalledTimes(1);
  });

  it("clearCache removes cached keys", async () => {
    await mutationGuard.guard("ns-clear", "v1");
    mutationGuard.clearCache();
    await mutationGuard.guard("ns-clear", "v2");
    expect(cryptoMock.importKey).toHaveBeenCalledTimes(2);
  });
});
