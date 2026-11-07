/**
 * P-06 regression — password-buffer ownership in `verifyPassword`.
 *
 * The old code handed the SAME buffer to `decryptWithBytes` (which consumes
 * it per the crypto-core ownership contract) and then to its own `finally`
 * wipe, so every verification that reached the decrypt step tripped the
 * fail-closed "possible reuse of a consumed password" warning. The consumer
 * now receives a fresh copy and the owner wipes exactly one still-intact
 * buffer — on success and on rejection alike.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  encryptionService: {
    decryptWithBytes: vi.fn(),
    encryptWithBytes: vi.fn(),
    decrypt: vi.fn(),
    encrypt: vi.fn(),
  },
  secureStorage: {
    getVerificationToken: vi.fn(),
  },
  integrity: {
    validateVerificationIntegrity: vi.fn(),
    createVerificationToken: vi.fn(),
  },
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../../../services/EncryptionService", () => ({
  encryptionService: mocks.encryptionService,
}));
vi.mock("../../../services/SecureStorage", () => ({
  secureStorage: mocks.secureStorage,
}));
vi.mock("../../../services/security-vault/integrity", () => mocks.integrity);
vi.mock("../../../utils/logger", () => ({ logger: mocks.logger }));

import {
  verifyPassword,
  type AuthContext,
} from "../../../services/security-vault/auth";
import { VERIFICATION_PLAINTEXT } from "../../../services/security-vault/constants";

const ctx = {
  getMasterPasswordBytes: () => null,
  clearShareCredential: () => undefined,
  hasAnyVaultState: async () => true,
  recordAudit: () => undefined,
} as unknown as AuthContext;

describe("P-06 — verifyPassword buffer ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.secureStorage.getVerificationToken.mockResolvedValue("v6:token");
    mocks.integrity.validateVerificationIntegrity.mockResolvedValue(true);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("hands the consumer a fresh, intact copy and never trips the reuse warning", async () => {
    let receivedFirstByte = -1;
    mocks.encryptionService.decryptWithBytes.mockImplementation(
      async (_stored: string, bytes: Uint8Array) => {
        // The documented ownership contract: the consumer zeroes the buffer
        // it receives. Capture the first byte BEFORE consuming it.
        receivedFirstByte = bytes[0] ?? -1;
        bytes.fill(0);
        return VERIFICATION_PLAINTEXT;
      },
    );

    const ok = await verifyPassword("correct-horse-battery-staple", ctx);

    expect(ok).toBe(true);
    // The consumer received real password material (an already-consumed
    // buffer would have read as zero)...
    expect(receivedFirstByte).toBe(
      new TextEncoder().encode("correct-horse-battery-staple")[0],
    );
    // ...and the owner's own wipe did not fire the fail-closed reuse
    // warning (its buffer was never handed to a consumer).
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("keeps the failure path warning-free too (rejected password)", async () => {
    mocks.integrity.validateVerificationIntegrity.mockResolvedValue(false);

    const ok = await verifyPassword("wrong-password-attempt", ctx);

    expect(ok).toBe(false);
    expect(mocks.encryptionService.decryptWithBytes).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });
});
