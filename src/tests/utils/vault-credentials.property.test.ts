// src/tests/utils/vault-credentials.property.test.ts
//
// Property-based tests (fast-check) for the vault credential byte helpers.
// Security invariants under test:
//  - passwordCodePointLength matches the JS code-point count for any string
//    and any valid UTF-8 byte sequence (min-length policy parity).
//  - normalizePasswordBytes trims ASCII whitespace identically for string
//    and byte inputs, is idempotent, and never aliases caller memory.
//  - copyPasswordBytes round-trips through TextDecoder and never aliases.
//  - constantTimeCompare is reflexive/symmetric and detects any difference.
//  - zeroPasswordBytes actually zeroes every byte.

import { describe, test, expect } from "vitest";
import fc from "fast-check";
import {
  passwordCodePointLength,
  copyPasswordBytes,
  normalizePasswordBytes,
} from "../../utils/passwordBytes";
import { constantTimeCompare } from "../../services/security-vault/compare";
import { zeroPasswordBytes } from "../../utils/crypto-core";

const arbString = fc.string({ maxLength: 256 });
const arbBytes = fc.uint8Array({ maxLength: 512 });
const WS = new Set([0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20]);

function trimBytes(bytes: Uint8Array): Uint8Array {
  let start = 0;
  let end = bytes.length;
  while (start < end && WS.has(bytes[start]!)) start += 1;
  while (end > start && WS.has(bytes[end - 1]!)) end -= 1;
  return bytes.slice(start, end);
}

describe("passwordCodePointLength properties", () => {
  test("matches [...str].length for arbitrary strings", () => {
    fc.assert(
      fc.property(arbString, (s) => {
        const bytes = new TextEncoder().encode(s);
        expect(passwordCodePointLength(bytes)).toBe([...s].length);
      }),
      { numRuns: 300 },
    );
  });

  test("never negative and <= byte length", () => {
    fc.assert(
      fc.property(arbBytes, (bytes) => {
        const n = passwordCodePointLength(bytes);
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThanOrEqual(bytes.length);
      }),
      { numRuns: 200 },
    );
  });
});

describe("normalizePasswordBytes properties", () => {
  test("string and byte paths produce identical output", () => {
    fc.assert(
      fc.property(arbString, (s) => {
        const bytes = new TextEncoder().encode(s);
        expect([...normalizePasswordBytes(s)]).toEqual([
          ...normalizePasswordBytes(bytes),
        ]);
      }),
      { numRuns: 300 },
    );
  });

  test("output contains no leading/trailing ASCII whitespace", () => {
    fc.assert(
      fc.property(arbString, (s) => {
        const out = normalizePasswordBytes(s);
        const first = out[0];
        const last = out[out.length - 1];
        if (out.length > 0) {
          expect(WS.has(first!)).toBe(false);
          expect(WS.has(last!)).toBe(false);
        }
      }),
      { numRuns: 200 },
    );
  });

  test("idempotent: normalize(normalize(x)) === normalize(x)", () => {
    fc.assert(
      fc.property(arbString, (s) => {
        const once = normalizePasswordBytes(s);
        const twice = normalizePasswordBytes(once);
        expect([...twice]).toEqual([...once]);
      }),
      { numRuns: 200 },
    );
  });

  test("does not alias caller buffer", () => {
    fc.assert(
      fc.property(arbBytes, (bytes) => {
        const input = new Uint8Array(bytes);
        const out = normalizePasswordBytes(input);
        // Reference computed before mutation — content may legitimately be
        // all zeros (e.g. a NUL-byte password), so compare values not bytes.
        const expected = [...trimBytes(bytes)];
        // Mutating the caller's buffer must not change the output.
        input.fill(0);
        expect([...out]).toEqual(expected);
      }),
      { numRuns: 200 },
    );
  });

  test("equals manual trim of UTF-8 encoding", () => {
    fc.assert(
      fc.property(arbString, (s) => {
        const expected = trimBytes(new TextEncoder().encode(s));
        expect([...normalizePasswordBytes(s)]).toEqual([...expected]);
      }),
      { numRuns: 200 },
    );
  });
});

describe("copyPasswordBytes properties", () => {
  test("round-trips string -> bytes -> string", () => {
    fc.assert(
      fc.property(arbString, (s) => {
        const bytes = copyPasswordBytes(s);
        expect(new TextDecoder().decode(bytes)).toBe(s);
      }),
      { numRuns: 200 },
    );
  });

  test("byte input produces an independent copy", () => {
    fc.assert(
      fc.property(arbBytes, (bytes) => {
        const input = new Uint8Array(bytes);
        const copy = copyPasswordBytes(input);
        input.fill(0);
        expect([...copy]).toEqual([...bytes]);
      }),
      { numRuns: 200 },
    );
  });
});

describe("constantTimeCompare properties", () => {
  test("reflexive and symmetric", () => {
    fc.assert(
      fc.property(arbString, arbString, (a, b) => {
        expect(constantTimeCompare(a, b)).toBe(constantTimeCompare(b, a));
        if (a === b) expect(constantTimeCompare(a, b)).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  test("different strings of different lengths are never equal", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 32 }),
        fc.string({ minLength: 1, maxLength: 32 }),
        (a, b) => {
          fc.pre(a !== b);
          expect(constantTimeCompare(a, b)).toBe(false);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("zeroPasswordBytes properties", () => {
  test("every byte is zero after the call", () => {
    fc.assert(
      fc.property(arbBytes, (bytes) => {
        const buf = new Uint8Array(bytes);
        // Skip all-zero inputs: the function warns on reuse detection.
        fc.pre(buf.some((b) => b !== 0));
        zeroPasswordBytes(buf);
        expect(buf.every((b) => b === 0)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });
});
