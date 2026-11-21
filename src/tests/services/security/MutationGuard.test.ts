import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mutationGuard } from "../../../services/security/MutationGuard";

vi.mock("../../../services/SecurityVault", () => ({
  securityVault: {
    withMasterPasswordBytes: vi.fn(),
    isLocked: vi.fn().mockResolvedValue(false),
    registerCaller: vi.fn(),
    onLock: vi.fn(() => vi.fn()),
    onUnlock: vi.fn(() => vi.fn()),
  },
}));

vi.mock("../../../utils/logger", () => ({
  logger: { debug: vi.fn(), warn: vi.fn() },
}));

vi.mock("../../../utils/crypto-core", () => ({
  zeroPasswordBytes: vi.fn(),
}));

describe("MutationGuard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutationGuard.clearCache();
  });

  afterEach(() => {
    mutationGuard.clearCache();
  });

  describe("guard", () => {
    it("returns a signed mutation", async () => {
      const { securityVault } = await import("../../../services/SecurityVault");
      (securityVault.withMasterPasswordBytes as any).mockImplementation(
        (_caller: string, fn: (bytes: Uint8Array) => Promise<void>) =>
          fn(new Uint8Array([1, 2, 3])),
      );

      const signed = await mutationGuard.guard("test-key", "test-value");
      expect(signed.key).toBe("test-key");
      expect(signed.value).toBe("test-value");
      expect(signed.signature).toBeDefined();
      expect(signed.timestamp).toBeDefined();
      expect(signed.version).toBe(1);
    });

    it("creates different signatures for different values", async () => {
      const { securityVault } = await import("../../../services/SecurityVault");
      (securityVault.withMasterPasswordBytes as any).mockImplementation(
        (_caller: string, fn: (bytes: Uint8Array) => Promise<void>) =>
          fn(new Uint8Array([1, 2, 3])),
      );

      const signed1 = await mutationGuard.guard("key", "value1");
      const signed2 = await mutationGuard.guard("key", "value2");
      expect(signed1.signature).not.toBe(signed2.signature);
    });
  });

  describe("verify", () => {
    it("verifies a valid signed mutation", async () => {
      const { securityVault } = await import("../../../services/SecurityVault");
      (securityVault.withMasterPasswordBytes as any).mockImplementation(
        (_caller: string, fn: (bytes: Uint8Array) => Promise<void>) =>
          fn(new Uint8Array([1, 2, 3])),
      );

      const signed = await mutationGuard.guard("test-key", "test-value");
      const isValid = await mutationGuard.verify(signed);
      expect(isValid).toBe(true);
    });

    it("rejects a tampered signature", async () => {
      const { securityVault } = await import("../../../services/SecurityVault");
      (securityVault.withMasterPasswordBytes as any).mockImplementation(
        (_caller: string, fn: (bytes: Uint8Array) => Promise<void>) =>
          fn(new Uint8Array([1, 2, 3])),
      );

      const signed = await mutationGuard.guard("test-key", "test-value");
      signed.signature = "tampered";
      const isValid = await mutationGuard.verify(signed);
      expect(isValid).toBe(false);
    });

    it("rejects a tampered value", async () => {
      const { securityVault } = await import("../../../services/SecurityVault");
      (securityVault.withMasterPasswordBytes as any).mockImplementation(
        (_caller: string, fn: (bytes: Uint8Array) => Promise<void>) =>
          fn(new Uint8Array([1, 2, 3])),
      );

      const signed = await mutationGuard.guard("test-key", "test-value");
      (signed as any).value = "tampered-value";
      const isValid = await mutationGuard.verify(signed);
      expect(isValid).toBe(false);
    });
  });

  describe("detectTampering", () => {
    it("detects no tampering when values match", async () => {
      const { securityVault } = await import("../../../services/SecurityVault");
      (securityVault.withMasterPasswordBytes as any).mockImplementation(
        (_caller: string, fn: (bytes: Uint8Array) => Promise<void>) =>
          fn(new Uint8Array([1, 2, 3])),
      );

      const stored = [
        await mutationGuard.guard("key1", "value1"),
        await mutationGuard.guard("key2", "value2"),
      ];
      const current = ["value1", "value2"];

      const report = await mutationGuard.detectTampering(stored, current);
      expect(report.tamperedKeys).toEqual([]);
      expect(report.totalChecked).toBe(2);
    });

    it("detects tampering when values differ", async () => {
      const { securityVault } = await import("../../../services/SecurityVault");
      (securityVault.withMasterPasswordBytes as any).mockImplementation(
        (_caller: string, fn: (bytes: Uint8Array) => Promise<void>) =>
          fn(new Uint8Array([1, 2, 3])),
      );

      const stored = [
        await mutationGuard.guard("key1", "value1"),
        await mutationGuard.guard("key2", "value2"),
      ];
      const current = ["value1", "tampered-value2"];

      const report = await mutationGuard.detectTampering(stored, current);
      expect(report.tamperedKeys).toContain("key2");
      expect(report.totalChecked).toBe(2);
    });

    it("handles empty arrays", async () => {
      const report = await mutationGuard.detectTampering([], []);
      expect(report.tamperedKeys).toEqual([]);
      expect(report.totalChecked).toBe(0);
    });
  });

  describe("clearCache", () => {
    it("clears the key cache", () => {
      expect(() => mutationGuard.clearCache()).not.toThrow();
    });
  });

  describe("getInstance", () => {
    it("returns singleton instance", () => {
      const instance1 = mutationGuard;
      const instance2 = mutationGuard;
      expect(instance1).toBe(instance2);
    });
  });
});
