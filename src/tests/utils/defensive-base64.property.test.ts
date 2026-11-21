// src/tests/utils/defensive-base64.property.test.ts
//
// Property-based tests (fast-check) for the defensive Base64 decoder.
// Invariants under test:
// 1. Round-trip: arbitrary bytes -> base64 -> decode === original bytes.
// 2. Total safety: ANY string input either decodes correctly or throws a
//    DefensiveBase64Error — never a raw exception, never silent garbage.
// 3. Size bound: decoded output can never exceed maxBytes; oversized input
//    is always rejected with reason "too-large" before allocation.
// 4. Output length matches the arithmetically predicted decoded length.

import { describe, test, expect } from "vitest";
import fc from "fast-check";
import {
  assertValidBase64,
  decodeDefensiveBase64,
  DefensiveBase64Error,
} from "../../utils/defensive-base64";

const arbBytes = fc.uint8Array({ minLength: 1, maxLength: 512 });
const arbString = fc.string({ maxLength: 2048 });
const arbMaxBytes = fc.integer({ min: 0, max: 4096 });

function encodeBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

describe("defensive-base64 properties", () => {
  test("round-trip: decode(encode(bytes)) === bytes", () => {
    fc.assert(
      fc.property(arbBytes, (bytes) => {
        const encoded = encodeBase64(bytes);
        const decoded = decodeDefensiveBase64(encoded, bytes.length, 4096);
        expect([...decoded]).toEqual([...bytes]);
      }),
      { numRuns: 200 },
    );
  });

  test("decoded length never exceeds maxBytes and matches prediction", () => {
    fc.assert(
      fc.property(arbBytes, arbMaxBytes, (bytes, maxBytes) => {
        const encoded = encodeBase64(bytes);
        try {
          const { decodedLength } = assertValidBase64(encoded, maxBytes);
          expect(decodedLength).toBeLessThanOrEqual(maxBytes);
          const decoded = decodeDefensiveBase64(encoded, maxBytes, 4096);
          expect(decoded.length).toBe(decodedLength);
        } catch (e) {
          expect(e).toBeInstanceOf(DefensiveBase64Error);
          // Only "too-large" is reachable for well-formed base64 input.
          expect((e as DefensiveBase64Error).reason).toBe("too-large");
        }
      }),
      { numRuns: 200 },
    );
  });

  test("any string input either decodes or throws DefensiveBase64Error", () => {
    fc.assert(
      fc.property(arbString, arbMaxBytes, (input, maxBytes) => {
        try {
          decodeDefensiveBase64(input, maxBytes, 4096);
        } catch (e) {
          expect(e).toBeInstanceOf(DefensiveBase64Error);
          expect(["invalid-format", "too-large", "decode-failed"]).toContain(
            (e as DefensiveBase64Error).reason,
          );
        }
      }),
      { numRuns: 300 },
    );
  });

  test("oversized payloads are always rejected as too-large", () => {
    fc.assert(
      fc.property(arbBytes, arbMaxBytes, (bytes, maxBytes) => {
        if (bytes.length <= maxBytes) return; // nothing to assert
        const encoded = encodeBase64(bytes);
        expect(() =>
          assertValidBase64(encoded, maxBytes),
        ).toThrowError(expect.objectContaining({ reason: "too-large" }));
      }),
      { numRuns: 200 },
    );
  });

  test("decode is deterministic", () => {
    fc.assert(
      fc.property(arbString, arbMaxBytes, (input, maxBytes) => {
        const run = () => {
          try {
            return { ok: true as const, out: decodeDefensiveBase64(input, maxBytes, 4096) };
          } catch (e) {
            return { ok: false as const, err: (e as Error).name };
          }
        };
        const a = run();
        const b = run();
        if (a.ok && b.ok) {
          expect([...a.out]).toEqual([...b.out]);
        } else {
          expect(a.ok).toBe(b.ok);
          expect(a.err).toBe(b.err);
        }
      }),
      { numRuns: 200 },
    );
  });
});
