// @vitest-environment node
//
// Property-based tests (fast-check) for the v7 authenticated envelope.
// Security invariants under test:
//  - Round-trip: decrypt(encrypt(t, pw, {purpose}), pw, {purpose}) === t
//  - AAD binding: a payload written for purpose A must NOT decrypt under
//    purpose B (ciphertext cannot be moved between storage slots).
//  - Wrong password always fails (AES-GCM tag).
//  - Tampering with any ciphertext byte fails the tag.
//  - encrypt() refuses to write without a per-vault salt (fail-closed A-02).
//  - Output is always a self-describing v7: envelope.

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import fc from "fast-check";
import {
  encrypt,
  decrypt,
  setVaultKdfSalt,
  resetSessionKeyCache,
  hasEmbeddedVaultSalt,
  base64ToU8a,
  u8aToBase64,
  KdfSaltUnavailableError,
} from "../../utils/crypto-core";

const VAULT_SALT = "c0ffee11".repeat(4); // 32 hex chars
const RUNS = 40;

const arbText = fc.string({ maxLength: 512 });
const arbPassword = fc.string({ minLength: 1, maxLength: 64 });
const arbPurpose = fc.oneof(
  fc.constant(undefined),
  fc.string({ minLength: 1, maxLength: 48 }),
);
const arbDistinctPurposes = fc
  .tuple(fc.string({ minLength: 1, maxLength: 32 }), fc.string({ minLength: 1, maxLength: 32 }))
  .filter(([a, b]) => a !== b);

beforeEach(() => {
  setVaultKdfSalt(VAULT_SALT);
  resetSessionKeyCache();
});

afterEach(() => {
  setVaultKdfSalt(null);
  resetSessionKeyCache();
});

describe("v7 envelope properties", () => {
  test("round-trip with matching purpose", async () => {
    await fc.assert(
      fc.asyncProperty(arbText, arbPassword, arbPurpose, async (text, pw, purpose) => {
        const encrypted = await encrypt(text, pw, { purpose });
        const decrypted = await decrypt(encrypted, pw, { purpose });
        return decrypted === text;
      }),
      { numRuns: RUNS },
    );
  });

  test("round-trip without options object at all", async () => {
    await fc.assert(
      fc.asyncProperty(arbText, arbPassword, async (text, pw) => {
        const encrypted = await encrypt(text, pw);
        const decrypted = await decrypt(encrypted, pw);
        return decrypted === text;
      }),
      { numRuns: RUNS },
    );
  });

  test("AAD binding: payload for purpose A never decrypts as purpose B", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbText,
        arbPassword,
        arbDistinctPurposes,
        async (text, pw, [pa, pb]) => {
          const encrypted = await encrypt(text, pw, { purpose: pa });
          try {
            await decrypt(encrypted, pw, { purpose: pb });
            return false; // AAD mismatch MUST fail
          } catch {
            return true;
          }
        },
      ),
      { numRuns: RUNS },
    );
  });

  test("explicit purpose never equals a different explicit purpose", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbText,
        arbPassword,
        arbDistinctPurposes,
        async (text, pw, [pa, pb]) => {
          const encrypted = await encrypt(text, pw, { purpose: pa });
          // Decrypting with NO purpose also fails: AAD "bmf-v7|pa" != "bmf-v7|"
          try {
            await decrypt(encrypted, pw);
            return false;
          } catch {
            return true;
          }
        },
      ),
      { numRuns: RUNS },
    );
  });

  test("wrong password always fails the GCM tag", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbText,
        fc.tuple(arbPassword, arbPassword).filter(([a, b]) => a !== b),
        arbPurpose,
        async (text, [pw1, pw2], purpose) => {
          const encrypted = await encrypt(text, pw1, { purpose });
          try {
            await decrypt(encrypted, pw2, { purpose });
            return false;
          } catch {
            return true;
          }
        },
      ),
      { numRuns: RUNS },
    );
  });

  test("single-byte payload tampering always fails", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbText,
        arbPassword,
        fc.nat(),
        async (text, pw, flipIndex) => {
          const encrypted = await encrypt(text, pw);
          fc.pre(encrypted.startsWith("v7:"));
          // Tamper at the BYTE level: flipping a base64 character can land in
          // the unused low bits of the final quantum and decode to identical
          // bytes, which is not a real tamper.
          const bytes = base64ToU8a(encrypted.slice(3));
          fc.pre(bytes.length > 0);
          const pos = flipIndex % bytes.length;
          bytes[pos] = bytes[pos]! ^ 0x01;
          const tampered = "v7:" + u8aToBase64(bytes);
          try {
            await decrypt(tampered, pw);
            return false; // tamper MUST fail
          } catch {
            return true;
          }
        },
      ),
      { numRuns: RUNS },
    );
  });

  test("output is always a v7 envelope with embedded vault salt", async () => {
    await fc.assert(
      fc.asyncProperty(arbText, arbPassword, arbPurpose, async (text, pw, purpose) => {
        const encrypted = await encrypt(text, pw, { purpose });
        return (
          encrypted.startsWith("v7:") &&
          hasEmbeddedVaultSalt(encrypted)
        );
      }),
      { numRuns: RUNS },
    );
  });

  test("encrypt refuses to write without a vault salt (fail-closed)", async () => {
    setVaultKdfSalt(null);
    resetSessionKeyCache();
    await expect(encrypt("secret", "pw")).rejects.toBeInstanceOf(
      KdfSaltUnavailableError,
    );
    // Restore for subsequent properties in this file.
    setVaultKdfSalt(VAULT_SALT);
    resetSessionKeyCache();
  });

  test("two encryptions of the same input differ (fresh salt+IV)", async () => {
    await fc.assert(
      fc.asyncProperty(arbText, arbPassword, arbPurpose, async (text, pw, purpose) => {
        const e1 = await encrypt(text, pw, { purpose });
        const e2 = await encrypt(text, pw, { purpose });
        return e1 !== e2;
      }),
      { numRuns: RUNS },
    );
  });
});
