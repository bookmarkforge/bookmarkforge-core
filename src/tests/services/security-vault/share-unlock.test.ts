import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ShareUnlockContext } from "../../../services/security-vault/share-unlock";
import { unlockVaultFromShare } from "../../../services/security-vault/share-unlock";

vi.mock("../../../utils/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const mocks = vi.hoisted(() => ({
  resetAttempts: vi.fn(),
  deriveShareCredential: vi.fn(),
}));

vi.mock("../../../store/rateLimitStore", () => ({
  useRateLimitStore: {
    getState: () => ({ resetAttempts: mocks.resetAttempts }),
  },
}));

vi.mock("../../../services/security-vault/share", async (importActual) => {
  const actual =
    await importActual<typeof import("../../../services/security-vault/share")>();
  return {
    ...actual,
    deriveShareCredential: mocks.deriveShareCredential,
  };
});

const SALT = new Uint8Array([9, 8, 7, 6, 5]);
const SALT_JSON = JSON.stringify(Array.from(SALT));
// Fresh-device bootstrap requires a >=16-byte salt (parseShareSalt min).
const FRESH_SALT = new Uint8Array(16).fill(3);
const FRESH_SALT_JSON = JSON.stringify(Array.from(FRESH_SALT));
const MASTER_BYTES = new TextEncoder().encode("correct-horse-battery");

/** Replicates the module's HKDF derivation to produce a valid share secret. */
async function deriveExpectedShareSecret(): Promise<string> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    MASTER_BYTES as Uint8Array<ArrayBuffer>,
    { name: "HKDF" },
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      salt: SALT as Uint8Array<ArrayBuffer>,
      info: new TextEncoder().encode("bookmarkforge-share"),
      hash: "SHA-256",
    },
    baseKey,
    256,
  );
  return Array.from(new Uint8Array(bits), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

function makeCtx(overrides: Partial<ShareUnlockContext> = {}) {
  const ctx: ShareUnlockContext = {
    getRateLimitLockoutUntil: vi.fn(() => 0),
    recordFailedAttempt: vi.fn(),
    hasExistingVaultState: vi.fn(async () => true),
    getMasterPasswordBytes: vi.fn(() => MASTER_BYTES),
    installShareCredential: vi.fn(),
    clearShareCredential: vi.fn(),
    recordAudit: vi.fn(),
    setUnlocked: vi.fn(),
    generateSessionToken: vi.fn(async () => {}),
    startSessionRotation: vi.fn(),
    stopSessionRotation: vi.fn(),
    notifyUnlockListeners: vi.fn(),
    clearSession: vi.fn(),
    ...overrides,
  };
  return ctx;
}

describe("unlockVaultFromShare", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deriveShareCredential.mockResolvedValue(new Uint8Array(32).fill(7));
  });

  it("returns false while rate-limited without recording an attempt", async () => {
    const ctx = makeCtx({
      getRateLimitLockoutUntil: vi.fn(() => Date.now() + 30_000),
    });
    expect(await unlockVaultFromShare(ctx, "a".repeat(64), SALT_JSON)).toBe(
      false,
    );
    expect(ctx.recordFailedAttempt).not.toHaveBeenCalled();
  });

  it("rejects a malformed share secret and records the failure", async () => {
    const ctx = makeCtx();
    expect(await unlockVaultFromShare(ctx, "not-hex", SALT_JSON)).toBe(false);
    expect(ctx.recordFailedAttempt).toHaveBeenCalledTimes(1);
  });

  it("rejects a malformed salt and records the failure", async () => {
    const ctx = makeCtx();
    expect(await unlockVaultFromShare(ctx, "a".repeat(64), "{bad json")).toBe(
      false,
    );
    expect(ctx.recordFailedAttempt).toHaveBeenCalledTimes(1);
  });

  it("rejects an existing vault when no master password bytes are available", async () => {
    const ctx = makeCtx({ getMasterPasswordBytes: vi.fn(() => null) });
    expect(await unlockVaultFromShare(ctx, "a".repeat(64), SALT_JSON)).toBe(
      false,
    );
    expect(ctx.recordFailedAttempt).toHaveBeenCalledTimes(1);
  });

  it("rejects a wrong share secret on an existing vault", async () => {
    const ctx = makeCtx();
    expect(await unlockVaultFromShare(ctx, "f".repeat(64), SALT_JSON)).toBe(
      false,
    );
    expect(ctx.recordFailedAttempt).toHaveBeenCalledTimes(1);
    expect(ctx.setUnlocked).not.toHaveBeenCalled();
  });

  it("unlocks an existing vault with the correct share secret", async () => {
    const secret = await deriveExpectedShareSecret();
    const ctx = makeCtx();
    expect(await unlockVaultFromShare(ctx, secret, SALT_JSON)).toBe(true);
    expect(ctx.setUnlocked).toHaveBeenCalledTimes(1);
    expect(ctx.generateSessionToken).toHaveBeenCalledTimes(1);
    expect(ctx.startSessionRotation).toHaveBeenCalledTimes(1);
    expect(ctx.notifyUnlockListeners).toHaveBeenCalledTimes(1);
    expect(ctx.recordAudit).toHaveBeenCalledWith({
      action: "vault_unlock_from_share",
      result: "success",
      origin: "SecurityVault",
    });
    expect(mocks.resetAttempts).toHaveBeenCalled();
  });

  it("fresh-device bootstrap installs a derived credential, never the raw secret", async () => {
    const ctx = makeCtx({
      hasExistingVaultState: vi.fn(async () => false),
    });
    const ok = await unlockVaultFromShare(ctx, "a".repeat(64), FRESH_SALT_JSON, {
      allowFreshDevice: true,
      emptyLocalDatabase: true,
    });
    expect(ok).toBe(true);
    expect(mocks.deriveShareCredential).toHaveBeenCalledWith(
      "a".repeat(64),
      expect.any(Uint8Array),
    );
    expect(ctx.installShareCredential).toHaveBeenCalledWith(
      expect.any(Uint8Array),
    );
    // The raw share secret must not be installed as the session credential.
    const installed = vi.mocked(ctx.installShareCredential).mock.calls[0]?.[0];
    expect(installed).toBeInstanceOf(Uint8Array);
    expect(
      Buffer.from(installed as Uint8Array).toString("hex"),
    ).not.toBe("a".repeat(64));
  });

  it("refuses fresh-device bootstrap without the empty-database attestation", async () => {
    const ctx = makeCtx({
      hasExistingVaultState: vi.fn(async () => false),
    });
    expect(
      await unlockVaultFromShare(ctx, "a".repeat(64), FRESH_SALT_JSON, {
        allowFreshDevice: true,
      }),
    ).toBe(false);
    expect(ctx.recordFailedAttempt).toHaveBeenCalledTimes(1);
    expect(ctx.installShareCredential).not.toHaveBeenCalled();
  });

  it("cleans up session state when activation fails", async () => {
    const ctx = makeCtx({
      generateSessionToken: vi.fn(async () => {
        throw new Error("token failure");
      }),
    });
    const secret = await deriveExpectedShareSecret();
    expect(await unlockVaultFromShare(ctx, secret, SALT_JSON)).toBe(false);
    expect(ctx.clearShareCredential).toHaveBeenCalled();
    expect(ctx.clearSession).toHaveBeenCalled();
    expect(ctx.stopSessionRotation).toHaveBeenCalled();
  });
});
