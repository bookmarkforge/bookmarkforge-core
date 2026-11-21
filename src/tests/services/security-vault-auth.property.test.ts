// src/tests/services/security-vault-auth.property.test.ts
//
// Property-based tests (fast-check) for verifyPassword() — the gate that
// decides whether a master password opens the vault.
//
// Truth table under test (token = stored verification ciphertext):
//   no token + vault state exists      -> false (tamper fail-closed)
//   no token + empty vault             -> true  (first-run registration)
//   token + integrity fails            -> false (always, before decrypt)
//   token + integrity ok + plaintext   -> true
//   token + integrity ok + other text  -> false
//   token + integrity ok + decrypt throws (non-v5) -> false
//   token + integrity ok + v5 error    -> throws LegacyV5FormatRemovedError
//
// Crypto is mocked at the module boundary; the property is about the
// DECISION LOGIC, not the primitives (those have their own tests).

import { describe, test, expect, vi, beforeEach } from "vitest";
import fc from "fast-check";

const getVerificationToken = vi.fn<() => Promise<string | null>>();
const getVerificationIntegrity = vi.fn<() => Promise<string | null>>();
const decryptWithBytes = vi.fn();
const validateIntegrity = vi.fn<() => Promise<boolean>>();
const recordAudit = vi.fn();
const hasAnyVaultState = vi.fn<() => Promise<boolean>>();

vi.mock("../../services/SecureStorage", () => ({
  secureStorage: {
    getVerificationToken: (...args: unknown[]) => getVerificationToken(...(args as [])),
    getVerificationIntegrity: (...args: unknown[]) => getVerificationIntegrity(...(args as [])),
    storeVerificationTokenWithIntegrity: vi.fn(),
  },
}));

vi.mock("../../services/EncryptionService", () => ({
  encryptionService: {
    decryptWithBytes: (...args: unknown[]) => decryptWithBytes(...args),
    encryptWithBytes: vi.fn(),
  },
}));

vi.mock("../../services/security-vault/integrity", () => ({
  validateVerificationIntegrity: (...args: unknown[]) =>
    validateIntegrity(...(args as [])),
  createVerificationToken: vi.fn(),
  deriveIntegrityHmacKey: vi.fn(),
}));

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const { verifyPassword } = await import("../../services/security-vault/auth");
const { VERIFICATION_PLAINTEXT } = await import(
  "../../services/security-vault/constants"
);
const { LegacyV5FormatRemovedError } = await import("../../utils/crypto-core");

const ctx = {
  hasAnyVaultState: (...args: unknown[]) => hasAnyVaultState(...(args as [])),
  recordAudit: (...args: unknown[]) => recordAudit(...args),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("verifyPassword properties", () => {
  test("no token: result === !hasAnyVaultState (fail-closed on tamper)", async () => {
    await fc.assert(
      fc.asyncProperty(fc.boolean(), async (hasState) => {
        vi.clearAllMocks();
        getVerificationToken.mockResolvedValue(null);
        hasAnyVaultState.mockResolvedValue(hasState);
        const result = await verifyPassword("correct-horse-1", ctx);
        expect(result).toBe(!hasState);
        // Without a token, decrypt must never run.
        expect(decryptWithBytes).not.toHaveBeenCalled();
      }),
      { numRuns: 100 },
    );
  });

  test("token present: integrity failure always rejects before decrypt", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), async (_pw) => {
        vi.clearAllMocks();
        getVerificationToken.mockResolvedValue("ciphertext");
        validateIntegrity.mockResolvedValue(false);
        const result = await verifyPassword(_pw, ctx);
        expect(result).toBe(false);
        expect(decryptWithBytes).not.toHaveBeenCalled();
      }),
      { numRuns: 100 },
    );
  });

  test("token + integrity ok: accepts iff decrypt === VERIFICATION_PLAINTEXT", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string(),
        fc.oneof(fc.constant(VERIFICATION_PLAINTEXT), fc.string()),
        async (pw, decrypted) => {
          vi.clearAllMocks();
          getVerificationToken.mockResolvedValue("ciphertext");
          validateIntegrity.mockResolvedValue(true);
          decryptWithBytes.mockResolvedValue(decrypted);
          const result = await verifyPassword(pw, ctx);
          expect(result).toBe(decrypted === VERIFICATION_PLAINTEXT);
        },
      ),
      { numRuns: 200 },
    );
  });

  test("token + integrity ok + decrypt throws -> false (except v5 -> typed throw)", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string(),
        fc.constantFrom("generic", "v5"),
        async (pw, mode) => {
          vi.clearAllMocks();
          getVerificationToken.mockResolvedValue("ciphertext");
          validateIntegrity.mockResolvedValue(true);
          if (mode === "v5") {
            decryptWithBytes.mockRejectedValue(
              new LegacyV5FormatRemovedError(),
            );
            await expect(verifyPassword(pw, ctx)).rejects.toBeInstanceOf(
              LegacyV5FormatRemovedError,
            );
          } else {
            decryptWithBytes.mockRejectedValue(new Error("decrypt failed"));
            await expect(verifyPassword(pw, ctx)).resolves.toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  test("tamper case (token missing + state exists) is always audited", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), async (pw) => {
        vi.clearAllMocks();
        getVerificationToken.mockResolvedValue(null);
        hasAnyVaultState.mockResolvedValue(true);
        await verifyPassword(pw, ctx);
        expect(recordAudit).toHaveBeenCalledWith(
          expect.objectContaining({
            action: "vault_unlock_failed",
            result: "failure",
          }),
        );
      }),
      { numRuns: 50 },
    );
  });

  test("string and Uint8Array password inputs behave identically", async () => {
    await fc.assert(
      fc.asyncProperty(arbPassword(), async (pw) => {
        vi.clearAllMocks();
        getVerificationToken.mockResolvedValue("ciphertext");
        validateIntegrity.mockResolvedValue(true);
        decryptWithBytes.mockResolvedValue(VERIFICATION_PLAINTEXT);
        const asString = await verifyPassword(pw, ctx);
        vi.clearAllMocks();
        getVerificationToken.mockResolvedValue("ciphertext");
        validateIntegrity.mockResolvedValue(true);
        decryptWithBytes.mockResolvedValue(VERIFICATION_PLAINTEXT);
        const asBytes = await verifyPassword(
          new TextEncoder().encode(pw),
          ctx,
        );
        expect(asString).toBe(asBytes);
      }),
      { numRuns: 100 },
    );
  });
});

function arbPassword(): fc.Arbitrary<string> {
  return fc.string({ minLength: 1, maxLength: 64 });
}
