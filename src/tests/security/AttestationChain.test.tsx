import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const vaultMock = vi.hoisted(() => ({
  withMasterPasswordBytes: vi.fn(),
  registerCaller: vi.fn(),
  onLock: vi.fn(() => () => {}),
  onUnlock: vi.fn(() => () => {}),
}));
const storageMock = vi.hoisted(() => ({
  getSecret: vi.fn(),
  setSecret: vi.fn(),
  deleteSecret: vi.fn(),
}));
const cryptoMock = vi.hoisted(() => ({
  importKey: vi.fn(),
  sign: vi.fn(),
}));

vi.mock("../../services/SecurityVault", () => ({
  securityVault: vaultMock,
}));
vi.mock("../../services/SecureStorage", () => ({
  secureStorage: storageMock,
}));
vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const mockKey = { algorithm: "HMAC" } as unknown as CryptoKey;

import { attestationChain } from "../../services/security/AttestationChain";
import { logger } from "../../utils/logger";

describe("AttestationChain", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vaultMock.withMasterPasswordBytes.mockImplementation((_caller, fn) =>
      fn(new Uint8Array([1, 2, 3])),
    );
    cryptoMock.importKey.mockResolvedValue(mockKey);
    cryptoMock.sign.mockImplementation((_algo, _key, data) => {
      const input = new Uint8Array(data);
      const sum = input.reduce((a, b) => a + b, 0) & 0xff;
      return new Uint8Array([sum, 0, 0, 0]).buffer;
    });
    vi.stubGlobal("crypto", {
      subtle: { importKey: cryptoMock.importKey, sign: cryptoMock.sign },
    });
    storageMock.getSecret.mockResolvedValue(null);
    storageMock.deleteSecret.mockResolvedValue(undefined);
    attestationChain.clear();
    (attestationChain as any).initialized = false;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads existing chain from secureStorage on init", async () => {
    const stored = JSON.stringify([
      {
        index: 0,
        prevHash: "genesis",
        data: '{"action":"test","target":"x"}',
        timestamp: "2025-01-01T00:00:00Z",
        signature: "sig0",
      },
    ]);
    storageMock.getSecret.mockResolvedValue(stored);
    await attestationChain.init();
    expect(attestationChain.getLength()).toBe(1);
  });

  it("appends a signed entry and persists", async () => {
    const entry = await attestationChain.append("create", "doc-123", {
      source: "test",
    });
    expect(entry.index).toBe(0);
    expect(entry.prevHash).toBe("genesis");
    expect(typeof entry.signature).toBe("string");
    expect(entry.signature.length).toBeGreaterThan(0);
    expect(storageMock.setSecret).toHaveBeenCalledWith(
      "attestation_chain",
      expect.any(String),
    );
  });

  it("verifies a valid chain", async () => {
    await attestationChain.append("a", "1");
    await attestationChain.append("b", "2");
    const result = await attestationChain.verifyChain();
    expect(result.valid).toBe(true);
    expect(result.brokenAt).toBeNull();
  });

  it("detects a broken chain link", async () => {
    storageMock.getSecret.mockResolvedValue(
      JSON.stringify([
        {
          index: 0,
          prevHash: "genesis",
          data: '{"action":"a","target":"1"}',
          timestamp: "2025-01-01T00:00:00Z",
          signature: "valid_sig",
        },
        {
          index: 1,
          prevHash: "wrong_prev",
          data: '{"action":"b","target":"2"}',
          timestamp: "2025-01-01T00:00:00Z",
          signature: "other_sig",
        },
      ]),
    );
    await attestationChain.init();
    const result = await attestationChain.verifyChain();
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(1);
  });

  it("exportProof returns a slice of the chain", async () => {
    await attestationChain.append("a", "1");
    await attestationChain.append("b", "2");
    await attestationChain.append("c", "3");
    const proof = attestationChain.exportProof(1, 2);
    expect(proof).not.toBeNull();
    expect(proof!.startIndex).toBe(1);
    expect(proof!.endIndex).toBe(2);
    expect(proof!.chain.length).toBe(2);
  });

  it("exportProof returns null for invalid range", () => {
    expect(attestationChain.exportProof(-1, 0)).toBeNull();
    expect(attestationChain.exportProof(0, 999)).toBeNull();
  });

  it("clear empties the chain and deletes storage", async () => {
    await attestationChain.append("a", "1");
    attestationChain.clear();
    expect(attestationChain.getLength()).toBe(0);
    expect(storageMock.deleteSecret).toHaveBeenCalledWith("attestation_chain");
  });

  it("truncates the chain to MAX_CHAIN_LENGTH when exceeded", async () => {
    for (let i = 0; i < 1002; i++) {
      await attestationChain.append("action", String(i));
    }
    expect(attestationChain.getLength()).toBeLessThanOrEqual(1000);
    expect(attestationChain.getLength()).toBe(1000);
  });

  it("initializes with an empty chain when stored data is corrupted", async () => {
    storageMock.getSecret.mockResolvedValue("not-json");
    await attestationChain.init();
    expect(attestationChain.getLength()).toBe(0);
  });

  it("zeroizes the password copy after signing", async () => {
    const passwordBytes = new Uint8Array([1, 2, 3]);
    vaultMock.withMasterPasswordBytes.mockImplementation((_caller, fn) =>
      fn(passwordBytes),
    );

    await attestationChain.append("zeroize", "password-copy");

    expect(passwordBytes.every((byte) => byte === 0)).toBe(true);
  });

  it("throws when appending with a locked vault", async () => {
    vaultMock.withMasterPasswordBytes.mockImplementation(() => Promise.resolve(null));
    await expect(attestationChain.append("x", "y")).rejects.toThrow("AttestationChain: vault locked");
  });

  it("exportProof returns null for ranges outside the chain", async () => {
    await attestationChain.append("a", "1");
    await attestationChain.append("b", "2");
    expect(attestationChain.exportProof(5, 10)).toBeNull();
    expect(attestationChain.exportProof(1, 0)).toBeNull();
  });

  describe("bounded logging on persistence failure (logRateLimited)", () => {
    it("append keeps the in-memory chain and logs a bounded warning when persistence fails", async () => {
      const { resetRateLimitedLogging } = await import("../../utils/boundedLog");
      resetRateLimitedLogging();
      storageMock.setSecret.mockRejectedValue(new Error("quota exceeded"));
      (logger.warn as any).mockClear();

      const entry = await attestationChain.append("create", "doc-1", {
        source: "test",
      });
      expect(entry.index).toBe(0);
      // The signed entry stays in memory and persistence is retried on the
      // next append; the failure must remain diagnosable without log spam.
      expect(attestationChain.getLength()).toBe(1);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("[attestation-chain-persist]"),
        expect.objectContaining({ error: "quota exceeded" }),
      );
    });

    it("reSignAll logs a bounded warning when persistence fails", async () => {
      const { resetRateLimitedLogging } = await import("../../utils/boundedLog");
      await attestationChain.append("a", "1");
      await attestationChain.append("b", "2");
      storageMock.setSecret.mockRejectedValue(new Error("quota exceeded"));
      resetRateLimitedLogging();
      (logger.warn as any).mockClear();

      await attestationChain.reSignAll();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("[attestation-chain-resign-persist]"),
        expect.objectContaining({ error: "quota exceeded" }),
      );
    });
  });

  describe("reSignAll (H2 — post-rotation re-signing)", () => {
    it("re-signs every entry and persists the cascaded chain", async () => {
      await attestationChain.append("a", "1");
      await attestationChain.append("b", "2");
      await attestationChain.append("c", "3");
      storageMock.setSecret.mockClear();

      await attestationChain.reSignAll();

      expect(storageMock.setSecret).toHaveBeenCalledWith(
        "attestation_chain",
        expect.any(String),
      );
      const persisted = JSON.parse(
        storageMock.setSecret.mock.calls[0]![1] as string,
      ) as Array<{
        index: number;
        prevHash: string;
        signature: string;
      }>;
      expect(persisted).toHaveLength(3);
      // prevHash of entry i must equal the re-signed signature of entry i-1
      // (cascading update), and entry 0 keeps the genesis anchor.
      expect(persisted[0]!.prevHash).toBe("genesis");
      expect(persisted[1]!.prevHash).toBe(persisted[0]!.signature);
      expect(persisted[2]!.prevHash).toBe(persisted[1]!.signature);
    });

    it("leaves the chain verifiable after re-signing", async () => {
      await attestationChain.append("a", "1");
      await attestationChain.append("b", "2");
      await attestationChain.reSignAll();

      const result = await attestationChain.verifyChain();
      expect(result.valid).toBe(true);
      expect(result.brokenAt).toBeNull();
    });

    it("throws when the vault is locked (no key material)", async () => {
      // Append while unlocked (beforeEach mock), then lock before re-signing.
      await attestationChain.append("a", "1");
      vaultMock.withMasterPasswordBytes.mockImplementation(() =>
        Promise.resolve(null),
      );
      await expect(attestationChain.reSignAll()).rejects.toThrow(
        "AttestationChain: vault locked",
      );
    });
  });
});
