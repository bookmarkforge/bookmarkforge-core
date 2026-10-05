import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../services/SecurityVault", () => ({
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
});
