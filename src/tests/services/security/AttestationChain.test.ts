import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { attestationChain } from "../../../services/security/AttestationChain";

vi.mock("../../../services/SecurityVault", () => ({
  securityVault: {
    withMasterPasswordBytes: vi.fn(),
    registerCaller: vi.fn(),
    onLock: vi.fn(() => vi.fn()),
    onUnlock: vi.fn(() => vi.fn()),
  },
}));

vi.mock("../../../services/SecureStorage", () => ({
  secureStorage: {
    getSecret: vi.fn(),
    setSecret: vi.fn(),
    deleteSecret: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../../utils/boundedLog", () => ({
  logRateLimited: vi.fn(),
}));

vi.mock("../../../services/security-vault/compare", () => ({
  constantTimeCompare: vi.fn((a: string, b: string) => a === b),
}));

vi.mock("../../../utils/crypto-core", () => ({
  zeroPasswordBytes: vi.fn(),
}));

describe("AttestationChain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    attestationChain.clear();
    (attestationChain as unknown as { initialized: boolean }).initialized = false;
  });

  afterEach(() => {
    attestationChain.clear();
  });

  describe("init", () => {
    it("initializes successfully with no stored chain", async () => {
      const { secureStorage } = await import("../../../services/SecureStorage");
      (secureStorage.getSecret as any).mockResolvedValue(null);

      await attestationChain.init();
      expect((attestationChain as unknown as { initialized: boolean }).initialized).toBe(true);
    });

    it("initializes successfully with stored chain", async () => {
      const { secureStorage } = await import("../../../services/SecureStorage");
      const storedChain = JSON.stringify([
        { index: 0, prevHash: "genesis", data: "test", timestamp: "2024-01-01", signature: "sig1" },
      ]);
      (secureStorage.getSecret as any).mockResolvedValue(storedChain);

      await attestationChain.init();
      expect((attestationChain as unknown as { initialized: boolean }).initialized).toBe(true);
    });

    it("handles parse errors gracefully", async () => {
      const { secureStorage } = await import("../../../services/SecureStorage");
      (secureStorage.getSecret as any).mockResolvedValue("invalid json");

      await attestationChain.init();
      expect((attestationChain as unknown as { initialized: boolean }).initialized).toBe(true);
    });
  });

  describe("append", () => {
    it("appends an entry to the chain", async () => {
      const { secureStorage } = await import("../../../services/SecureStorage");
      (secureStorage.getSecret as any).mockResolvedValue(null);
      (secureStorage.setSecret as any).mockResolvedValue(undefined);

      const { securityVault } = await import("../../../services/SecurityVault");
      (securityVault.withMasterPasswordBytes as any).mockImplementation(
        (_caller: string, fn: (bytes: Uint8Array) => Promise<void>) =>
          fn(new Uint8Array([1, 2, 3])),
      );

      const entry = await attestationChain.append("test-action", "test-target");
      expect(entry.index).toBe(0);
      expect(entry.prevHash).toBe("genesis");
      expect(entry.signature).toBeDefined();
    });

    it("increments index for subsequent entries", async () => {
      const { secureStorage } = await import("../../../services/SecureStorage");
      (secureStorage.getSecret as any).mockResolvedValue(null);
      (secureStorage.setSecret as any).mockResolvedValue(undefined);

      const { securityVault } = await import("../../../services/SecurityVault");
      (securityVault.withMasterPasswordBytes as any).mockImplementation(
        (_caller: string, fn: (bytes: Uint8Array) => Promise<void>) =>
          fn(new Uint8Array([1, 2, 3])),
      );

      const entry1 = await attestationChain.append("action1", "target1");
      const entry2 = await attestationChain.append("action2", "target2");
      expect(entry2.index).toBe(1);
      expect(entry2.prevHash).toBe(entry1.signature);
    });

    it("includes context in entry", async () => {
      const { secureStorage } = await import("../../../services/SecureStorage");
      (secureStorage.getSecret as any).mockResolvedValue(null);
      (secureStorage.setSecret as any).mockResolvedValue(undefined);

      const { securityVault } = await import("../../../services/SecurityVault");
      (securityVault.withMasterPasswordBytes as any).mockImplementation(
        (_caller: string, fn: (bytes: Uint8Array) => Promise<void>) =>
          fn(new Uint8Array([1, 2, 3])),
      );

      const entry = await attestationChain.append("action", "target", { key: "value" });
      expect(entry.data).toContain("key");
      expect(entry.data).toContain("value");
    });
  });

  describe("verifyChain", () => {
    it("verifies an empty chain", async () => {
      const { secureStorage } = await import("../../../services/SecureStorage");
      (secureStorage.getSecret as any).mockResolvedValue(null);

      await attestationChain.init();
      const result = await attestationChain.verifyChain();
      expect(result.valid).toBe(true);
      expect(result.brokenAt).toBeNull();
    });

    it("verifies a single entry chain", async () => {
      const { secureStorage } = await import("../../../services/SecureStorage");
      (secureStorage.getSecret as any).mockResolvedValue(null);
      (secureStorage.setSecret as any).mockResolvedValue(undefined);

      const { securityVault } = await import("../../../services/SecurityVault");
      (securityVault.withMasterPasswordBytes as any).mockImplementation(
        (_caller: string, fn: (bytes: Uint8Array) => Promise<void>) =>
          fn(new Uint8Array([1, 2, 3])),
      );

      await attestationChain.append("action", "target");
      const result = await attestationChain.verifyChain();
      expect(result.valid).toBe(true);
    });
  });

  describe("clear", () => {
    it("clears the chain", () => {
      expect(() => attestationChain.clear()).not.toThrow();
    });
  });
});
