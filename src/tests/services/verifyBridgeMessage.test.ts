import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../services/SecurityVault", () => ({
  // P1: BroadcastBridgeService re-exports SECURE_STORAGE_KEYS from this
  // module — without it the SYNC_SETTINGS branch crashes on
  // `SECURE_STORAGE_KEYS.API_KEY` inside its try/catch. Inline copy because
  // bmf/no-securityvault-mock-without-lock fail-closes on async factories;
  // the test asserts against the REAL constant (security-vault/constants),
  // so a drift in either copy fails this file immediately.
  SECURE_STORAGE_KEYS: {
    RECOVERY_DATA: "recovery_data",
    API_KEY: "encrypted_api_key",
    DB_KEY: "encrypted_db_key",
    MASTER_PASSWORD_SETUP: "master_password_setup",
    VERIFICATION: "vault_verification",
    KDF_SALT: "kdf_salt",
  },
  securityVault: {
    isLocked: vi.fn(() => false),
    deriveBridgeKey: vi.fn(async () =>
      crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode("test-bridge-key"),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["verify"],
      ),
    ),
    encryptSecret: vi.fn(),
    onLock: vi.fn(() => () => {}),
    onUnlock: vi.fn(() => () => {}),
  },
}));

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { verifyBridgeMessage } from "../../services/BroadcastBridgeService";

async function signPayload(
  payload: Record<string, unknown>,
  nonce: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode("test-bridge-key"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const BRIDGE_REALM = "bookmarkforge-bridge-v1";
  const data = JSON.stringify({ ...payload, nonce, realm: BRIDGE_REALM });
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(data),
  );
  return Array.from(new Uint8Array(sig), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

describe("verifyBridgeMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should verify a valid message", async () => {
    const payload = { url: "https://test.com" };
    const nonce = "test-nonce";
    const sig = await signPayload(payload, nonce);
    const result = await verifyBridgeMessage(payload, sig, nonce);
    expect(result).toBe(true);
  });

  it("should reject a message with an incorrect signature", async () => {
    const result = await verifyBridgeMessage(
      { url: "https://evil.com" },
      "001122",
      "nonce",
    );
    expect(result).toBe(false);
  });

  it("should reject malformed signatures without throwing", async () => {
    await expect(
      verifyBridgeMessage({ url: "https://test.com" }, "not-hex", "nonce"),
    ).resolves.toBe(false);
    await expect(
      verifyBridgeMessage({ url: "https://test.com" }, "0".repeat(64), "x".repeat(257)),
    ).resolves.toBe(false);
  });

  it("should reject if the vault is locked", async () => {
    const { securityVault } = await import("../../services/SecurityVault");
    (securityVault.isLocked as any).mockReturnValue(true);
    const result = await verifyBridgeMessage({}, "0000", "nonce-locked");
    expect(result).toBe(false);
  });

  // ── P1 mock-contract sweep ──────────────────────────────────────────────
  // BroadcastBridgeService re-exports SECURE_STORAGE_KEYS from SecurityVault;
  // this file's factory omitted it, so the SYNC_SETTINGS persistence branch
  // crashed on `SECURE_STORAGE_KEYS.API_KEY` inside its try/catch and the
  // test suite never noticed.
  describe("P1 — SYNC_SETTINGS persistence contract", () => {
    it("encrypts an incoming API key under SECURE_STORAGE_KEYS.API_KEY when the vault is unlocked", async () => {
      const { broadcastBridgeService } = await import(
        "../../services/BroadcastBridgeService"
      );
      const { securityVault } = await import("../../services/SecurityVault");
      const { SECURE_STORAGE_KEYS } = await import(
        "../../services/security-vault/constants"
      );
      (securityVault.isLocked as any).mockReturnValue(false);

      await (broadcastBridgeService as any).handleSyncSettings({
        geminiKey: "AIza-test-key",
      });

      expect(securityVault.encryptSecret).toHaveBeenCalledWith(
        "AIza-test-key",
        SECURE_STORAGE_KEYS.API_KEY,
      );
    });

    it("refuses to persist the API key while the vault is locked", async () => {
      const { broadcastBridgeService } = await import(
        "../../services/BroadcastBridgeService"
      );
      const { securityVault } = await import("../../services/SecurityVault");
      const { logger } = await import("../../utils/logger");
      (securityVault.isLocked as any).mockReturnValue(true);

      await (broadcastBridgeService as any).handleSyncSettings({
        geminiKey: "AIza-test-key",
      });

      expect(securityVault.encryptSecret).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Refused to persist API key"),
      );
    });
  });
});
