// @vitest-environment node
/**
 * Property-based fuzz tests for crypto-core encrypt/decrypt primitives.
 *
 * Uses fast-check to generate randomised inputs and verify invariants
 * across many runs, catching edge cases that hand-written tests can miss
 * (empty strings, null bytes, unicode edge cases, binary blobs, very long
 * inputs, etc.).
 *
 * The Argon2id parameters are automatically reduced in test mode (8 MiB,
 * t=1 — see src/utils/argon2-kdf.ts) so each run is fast. `FUZZ_RUNS` env
 * var controls the number of runs per test (default 50); set it to 500+
 * for nightly/hardening runs. The default is kept moderate so the fuzz
 * suite completes comfortably within CI timeouts.
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";

/** Per-test fuzz budget. Override via `FUZZ_RUNS=500` for thorough nightly runs. */
const FUZZ_RUNS = Math.max(10, Number(process.env.FUZZ_RUNS) || (process.env.CI ? 20 : 50));
import {
  encrypt,
  decrypt,
  encryptBinary,
  decryptBinary,
  encryptWithSessionKey,
  decryptWithSessionKey,
  hashString,
  deriveDbKey,
  generateSecureSalt,
  u8aToBase64,
  base64ToU8a,
} from "../../utils/crypto-core";

/** Shallow-equal comparison for Uint8Array (fast-check 4.x has no stringifyRepr). */
function uint8Equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// ── Arbitraries ──────────────────────────────────────────────────────

/** Any printable unicode string, including empty. */
const textArb = fc.string();

/** A password-like string: at least 1 char, printable. */
const passwordArb = fc.string({ minLength: 1 });

/** A pair of distinct passwords (p1 !== p2). */
const distinctPasswordsArb = fc
  .tuple(passwordArb, passwordArb)
  .filter(([a, b]) => a !== b);

/** Arbitrary binary data. */
const binaryArb = fc.uint8Array();

/** A salt string that won't produce degenerate Argon2id input. */
const saltArb = fc.string({ minLength: 1, maxLength: 64 });

// ── Text encrypt/decrypt ─────────────────────────────────────────────

describe("crypto-core fuzz — text encrypt/decrypt", () => {
  it("round-trip: decrypt(encrypt(text, pw), pw) === text", async () => {
    await fc.assert(
      fc.asyncProperty(textArb, passwordArb, async (text, password) => {
        const encrypted = await encrypt(text, password);
        const decrypted = await decrypt(encrypted, password);
        return decrypted === text;
      }),
      { numRuns: FUZZ_RUNS },
    );
  });

  it("wrong password: decrypt(encrypt(text, pw1), pw2) throws", async () => {
    await fc.assert(
      fc.asyncProperty(
        textArb,
        distinctPasswordsArb,
        async (text, [pw1, pw2]) => {
          const encrypted = await encrypt(text, pw1);
          try {
            await decrypt(encrypted, pw2);
            return false; // should have thrown
          } catch {
            return true;
          }
        },
      ),
      { numRuns: FUZZ_RUNS },
    );
  });

  it("output format: encrypted text starts with 'v5:' and is valid base64", async () => {
    await fc.assert(
      fc.asyncProperty(textArb, passwordArb, async (text, password) => {
        const encrypted = await encrypt(text, password);
        if (!encrypted.startsWith("v5:")) return false;
        const body = encrypted.slice(3);
        // Must be valid base64
        return /^[A-Za-z0-9+/]+={0,2}$/.test(body);
      }),
      { numRuns: FUZZ_RUNS },
    );
  });

  it("encrypted output differs from plaintext", async () => {
    await fc.assert(
      fc.asyncProperty(textArb, passwordArb, async (text, password) => {
        const encrypted = await encrypt(text, password);
        // The ciphertext should never equal the plaintext (astronomically unlikely
        // with AES-GCM + random salt/IV).
        return encrypted !== text;
      }),
      { numRuns: FUZZ_RUNS },
    );
  });

  it("deterministic: same (text, pw) produces different ciphertext each time (random salt+IV)", async () => {
    await fc.assert(
      fc.asyncProperty(textArb, passwordArb, async (text, password) => {
        const e1 = await encrypt(text, password);
        const e2 = await encrypt(text, password);
        // Each encryption uses a fresh random salt + IV, so ciphertexts differ.
        return e1 !== e2;
      }),
      { numRuns: FUZZ_RUNS },
    );
  });
});

// ── Binary encrypt/decrypt ───────────────────────────────────────────

describe("crypto-core fuzz — binary encrypt/decrypt", () => {
  it("round-trip: decryptBinary(encryptBinary(data, pw), pw) === data", async () => {
    await fc.assert(
      fc.asyncProperty(binaryArb, passwordArb, async (data, password) => {
        const encrypted = await encryptBinary(data, password);
        const decrypted = await decryptBinary(encrypted, password);
        return uint8Equal(new Uint8Array(data), new Uint8Array(decrypted));
      }),
      { numRuns: FUZZ_RUNS, timeout: 30000 },
    );
  }, 30000);

  it("wrong password: decryptBinary(encryptBinary(data, pw1), pw2) throws", async () => {
    await fc.assert(
      fc.asyncProperty(
        binaryArb,
        distinctPasswordsArb,
        async (data, [pw1, pw2]) => {
          const encrypted = await encryptBinary(data, pw1);
          try {
            await decryptBinary(encrypted, pw2);
            return false;
          } catch {
            return true;
          }
        },
      ),
      { numRuns: FUZZ_RUNS, timeout: 30000 },
    );
  }, 30000);

  it("ciphertext is larger than plaintext (salt + IV + tag overhead)", async () => {
    await fc.assert(
      fc.asyncProperty(binaryArb, passwordArb, async (data, password) => {
        const encrypted = await encryptBinary(data, password);
        // 16-byte salt + 12-byte IV + 16-byte GCM tag = 44 bytes overhead minimum
        return encrypted.length >= data.length + 44;
      }),
      { numRuns: FUZZ_RUNS },
    );
  });
});

// ── Session key encrypt/decrypt ──────────────────────────────────────

describe("crypto-core fuzz — session key", () => {
  it("round-trip: decryptWithSessionKey(encryptWithSessionKey(data, pw), pw) === data", async () => {
    await fc.assert(
      fc.asyncProperty(binaryArb, passwordArb, async (data, password) => {
        const encrypted = await encryptWithSessionKey(data, password);
        const decrypted = await decryptWithSessionKey(encrypted, password);
        return uint8Equal(new Uint8Array(data), new Uint8Array(decrypted));
      }),
      { numRuns: FUZZ_RUNS },
    );
  });

  it("wrong password fails", async () => {
    await fc.assert(
      fc.asyncProperty(
        binaryArb,
        distinctPasswordsArb,
        async (data, [pw1, pw2]) => {
          const encrypted = await encryptWithSessionKey(data, pw1);
          try {
            await decryptWithSessionKey(encrypted, pw2);
            return false;
          } catch {
            return true;
          }
        },
      ),
      { numRuns: FUZZ_RUNS },
    );
  });

  it("unique HKDF salt per call (S6)", async () => {
    await fc.assert(
      fc.asyncProperty(passwordArb, async (password) => {
        const data = new Uint8Array([1, 2, 3]);
        const e1 = await encryptWithSessionKey(data, password);
        const e2 = await encryptWithSessionKey(data, password);
        // S6: first 16 bytes are the HKDF salt — they must differ.
        const salt1 = e1.slice(0, 16);
        const salt2 = e2.slice(0, 16);
        return !uint8Equal(new Uint8Array(salt1), new Uint8Array(salt2));
      }),
      { numRuns: FUZZ_RUNS },
    );
  });
});

// ── deriveDbKey ──────────────────────────────────────────────────────

describe("crypto-core fuzz — deriveDbKey", () => {
  it("deterministic: same (password, salt) → same key", async () => {
    await fc.assert(
      fc.asyncProperty(passwordArb, saltArb, async (password, salt) => {
        const k1 = await deriveDbKey(password, salt);
        const k2 = await deriveDbKey(password, salt);
        return k1 === k2;
      }),
      { numRuns: FUZZ_RUNS },
    );
  });

  it("different salts → different keys", async () => {
    await fc.assert(
      fc.asyncProperty(
        passwordArb,
        saltArb,
        saltArb,
        async (password, salt1, salt2) => {
          fc.pre(salt1 !== salt2);
          const k1 = await deriveDbKey(password, salt1);
          const k2 = await deriveDbKey(password, salt2);
          return k1 !== k2;
        },
      ),
      { numRuns: FUZZ_RUNS },
    );
  });

  it("output is 64-char hex", async () => {
    await fc.assert(
      fc.asyncProperty(passwordArb, saltArb, async (password, salt) => {
        const key = await deriveDbKey(password, salt);
        return /^[0-9a-f]{64}$/.test(key);
      }),
      { numRuns: FUZZ_RUNS },
    );
  });
});

// ── hashString ───────────────────────────────────────────────────────

describe("crypto-core fuzz — hashString", () => {
  it("deterministic: same input → same hash", async () => {
    await fc.assert(
      fc.asyncProperty(textArb, async (input) => {
        const h1 = await hashString(input);
        const h2 = await hashString(input);
        return h1 === h2;
      }),
      { numRuns: FUZZ_RUNS },
    );
  });

  it("different inputs → different hashes", async () => {
    await fc.assert(
      fc.asyncProperty(textArb, textArb, async (a, b) => {
        fc.pre(a !== b);
        const h1 = await hashString(a);
        const h2 = await hashString(b);
        return h1 !== h2;
      }),
      { numRuns: FUZZ_RUNS },
    );
  });

  it("output is 64-char hex", async () => {
    await fc.assert(
      fc.asyncProperty(textArb, async (input) => {
        const hash = await hashString(input);
        return /^[0-9a-f]{64}$/.test(hash);
      }),
      { numRuns: FUZZ_RUNS },
    );
  });
});

// ── generateSecureSalt ───────────────────────────────────────────────

describe("crypto-core fuzz — generateSecureSalt", () => {
  it("output is 64-char hex", () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const salt = generateSecureSalt();
        return /^[0-9a-f]{64}$/.test(salt);
      }),
      { numRuns: FUZZ_RUNS },
    );
  });

  it("consecutive calls produce different salts", () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const s1 = generateSecureSalt();
        const s2 = generateSecureSalt();
        return s1 !== s2;
      }),
      { numRuns: FUZZ_RUNS },
    );
  });
});

// ── base64 helpers ───────────────────────────────────────────────────

describe("crypto-core fuzz — base64 helpers", () => {
  it("round-trip: base64ToU8a(u8aToBase64(bytes)) === bytes", () => {
    fc.assert(
      fc.property(binaryArb, (bytes) => {
        const b64 = u8aToBase64(bytes);
        const decoded = base64ToU8a(b64);
        return uint8Equal(new Uint8Array(bytes), new Uint8Array(decoded));
      }),
      { numRuns: FUZZ_RUNS },
    );
  });

  it("u8aToBase64 produces valid base64", () => {
    fc.assert(
      fc.property(binaryArb, (bytes) => {
        const b64 = u8aToBase64(bytes);
        return /^[A-Za-z0-9+/]*={0,2}$/.test(b64);
      }),
      { numRuns: FUZZ_RUNS },
    );
  });

  it("base64ToU8a throws on invalid base64", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }).filter((s) => {
          // Generate strings that are NOT valid base64
          try { atob(s); return false; } catch { return true; }
        }),
        (invalid) => {
          // Some invalid base64 strings crash atob; fast-check will skip
          // crashes via the default error handler.
          try {
            base64ToU8a(invalid);
            return false; // should have thrown
          } catch {
            return true;
          }
        },
      ),
      { numRuns: FUZZ_RUNS },
    );
  });
});
