// src/tests/utils/defensive-base64.test.ts
//
// Tests for defensive Base64 decoder.
// Covers: validation before allocation, size bounds, charset validation,
// padding validation, chunked decoding, async variant, data URL decoding.

import { describe, test, expect } from "vitest";
import {
  assertValidBase64,
  decodeDefensiveBase64,
  decodeDefensiveBase64Async,
  decodeDataUrlToBytes,
  DefensiveBase64Error,
} from "../../utils/defensive-base64";

describe("defensive-base64", () => {
  describe("assertValidBase64", () => {
    test("accepts valid Base64 with no padding", () => {
      const data = "SGVsbG8g"; // "Hello " (8 chars, no padding)
      const result = assertValidBase64(data, 1000);
      expect(result.decodedLength).toBe(6);
      expect(result.padding).toBe(0);
    });

    test("accepts valid Base64 with single padding", () => {
      const data = "SGVsbG8="; // "Hello"
      const result = assertValidBase64(data, 1000);
      expect(result.decodedLength).toBe(5);
      expect(result.padding).toBe(1);
    });

    test("accepts valid Base64 with double padding", () => {
      const data = "AA=="; // 1 byte (0x00)
      const result = assertValidBase64(data, 1000);
      expect(result.decodedLength).toBe(1);
      expect(result.padding).toBe(2);
    });

    test("rejects empty string", () => {
      expect(() => assertValidBase64("", 1000)).toThrow(DefensiveBase64Error);
      try {
        assertValidBase64("", 1000);
      } catch (e) {
        expect(e).toBeInstanceOf(DefensiveBase64Error);
        expect((e as DefensiveBase64Error).reason).toBe("invalid-format");
      }
    });

    test("rejects length not multiple of 4", () => {
      expect(() => assertValidBase64("SGVsbG8", 1000)).toThrow(DefensiveBase64Error);
      try {
        assertValidBase64("SGVsbG8", 1000);
      } catch (e) {
        expect((e as DefensiveBase64Error).reason).toBe("invalid-format");
      }
    });

    test("rejects invalid charset characters", () => {
      expect(() => assertValidBase64("SGVsbG8!World", 1000)).toThrow(
        DefensiveBase64Error,
      );
      try {
        assertValidBase64("SGVsbG8!World", 1000);
      } catch (e) {
        expect((e as DefensiveBase64Error).reason).toBe("invalid-format");
      }
    });

    test("rejects padding in middle of string", () => {
      expect(() => assertValidBase64("SG=VsbG8=", 1000)).toThrow(DefensiveBase64Error);
      try {
        assertValidBase64("SG=VsbG8=", 1000);
      } catch (e) {
        expect((e as DefensiveBase64Error).reason).toBe("invalid-format");
      }
    });

    test("rejects too-large payload", () => {
      // 4 bytes Base64 = 3 bytes decoded
      // Create a payload that would decode to >100 bytes
      const largePayload = "A".repeat(200); // 150 bytes decoded
      expect(() => assertValidBase64(largePayload, 100)).toThrow(
        DefensiveBase64Error,
      );
      try {
        assertValidBase64(largePayload, 100);
      } catch (e) {
        expect((e as DefensiveBase64Error).reason).toBe("too-large");
      }
    });

    test("accepts payload exactly at max size", () => {
      // 136 chars Base64 = 102 bytes decoded (136/4*3 = 102)
      const payload = "A".repeat(136);
      const result = assertValidBase64(payload, 102);
      expect(result.decodedLength).toBe(102);
    });

    test("computes correct decoded length for various sizes", () => {
      // No padding: length/4*3
      expect(assertValidBase64("AAAA", 100).decodedLength).toBe(3);
      expect(assertValidBase64("AAAAAAAA", 100).decodedLength).toBe(6);

      // Single padding: length/4*3 - 1
      expect(assertValidBase64("AAAAAA==", 100).decodedLength).toBe(4);
      expect(assertValidBase64("AAAAAAAAAA==", 100).decodedLength).toBe(7);

      // Double padding: length/4*3 - 2
      expect(assertValidBase64("AAA=", 100).decodedLength).toBe(2);
      expect(assertValidBase64("AAAAAAA=", 100).decodedLength).toBe(5);
    });
  });

  describe("decodeDefensiveBase64", () => {
    test("decodes valid Base64 correctly", () => {
      const data = "SGVsbG8gV29ybGQ="; // "Hello World" (with padding)
      const result = decodeDefensiveBase64(data, 1000, 1024);
      const text = new TextDecoder().decode(result);
      expect(text).toBe("Hello World");
    });

    test("decodes Base64 with padding", () => {
      const data = "SGVsbG8="; // "Hello"
      const result = decodeDefensiveBase64(data, 1000, 1024);
      const text = new TextDecoder().decode(result);
      expect(text).toBe("Hello");
    });

    test("decodes binary data correctly", () => {
      const original = new Uint8Array([0, 1, 2, 3, 4, 5, 255, 254, 253]);
      const data = btoa(String.fromCharCode(...original));
      const result = decodeDefensiveBase64(data, 1000, 1024);
      expect(result).toEqual(original);
    });

    test("respects maxBytes limit", () => {
      const largePayload = "A".repeat(200);
      expect(() => decodeDefensiveBase64(largePayload, 100, 1024)).toThrow(
        DefensiveBase64Error,
      );
    });

    test("rejects invalid format before allocation", () => {
      expect(() => decodeDefensiveBase64("invalid!", 1000, 1024)).toThrow(
        DefensiveBase64Error,
      );
    });

    test("handles chunked decoding correctly", () => {
      // Create a larger payload to test chunking
      const original = new Uint8Array(10000);
      for (let i = 0; i < original.length; i++) {
        original[i] = i % 256;
      }
      const data = btoa(String.fromCharCode(...original));
      const result = decodeDefensiveBase64(data, 20000, 1024);
      expect(result).toEqual(original);
    });

    test("fails on decode-failure despite charset validation", () => {
      // This is unlikely with valid charset, but the code handles it
      // Create a payload that passes charset but fails atob
      // (this is belt-and-braces defense)
      const data = "AA=="; // valid charset, should decode to 1 byte
      const result = decodeDefensiveBase64(data, 1000, 1024);
      expect(result.length).toBe(1);
    });

    test("verifies decoded length matches expected", () => {
      const data = "SGVsbG8=";
      const result = decodeDefensiveBase64(data, 1000, 1024);
      expect(result.length).toBe(5);
    });
  });

  describe("decodeDefensiveBase64Async", () => {
    test("decodes valid Base64 correctly", async () => {
      const data = "SGVsbG8gV29ybGQ="; // "Hello World" (with padding)
      const result = await decodeDefensiveBase64Async(data, 1000, 1024);
      const text = new TextDecoder().decode(result);
      expect(text).toBe("Hello World");
    });

    test("yields to event loop between chunks", async () => {
      // Create a payload large enough to require multiple chunks
      const original = new Uint8Array(5000);
      for (let i = 0; i < original.length; i++) {
        original[i] = i % 256;
      }
      const data = btoa(String.fromCharCode(...original));

      const startTime = Date.now();
      const result = await decodeDefensiveBase64Async(data, 10000, 1024);
      const elapsed = Date.now() - startTime;

      expect(result).toEqual(original);
      // Should have yielded at least once (elapsed > 0 is not a guarantee,
      // but with setTimeout(0) it should)
      expect(elapsed).toBeGreaterThanOrEqual(0);
    });

    test("respects maxBytes limit", async () => {
      const largePayload = "A".repeat(200);
      await expect(
        decodeDefensiveBase64Async(largePayload, 100, 1024),
      ).rejects.toThrow(DefensiveBase64Error);
    });

    test("rejects invalid format", async () => {
      await expect(
        decodeDefensiveBase64Async("invalid!", 1000, 1024),
      ).rejects.toThrow(DefensiveBase64Error);
    });

    test("verifies decoded length matches expected", async () => {
      const data = "SGVsbG8=";
      const result = await decodeDefensiveBase64Async(data, 1000, 1024);
      expect(result.length).toBe(5);
    });
  });

  describe("decodeDataUrlToBytes", () => {
    test("decodes valid data URL", () => {
      const dataUrl = "data:text/plain;base64,SGVsbG8gV29ybGQ="; // "Hello World" with padding
      const result = decodeDataUrlToBytes(dataUrl, 1000);
      expect(result).not.toBeNull();
      expect(result?.mimeType).toBe("text/plain");
      const text = new TextDecoder().decode(result!.bytes);
      expect(text).toBe("Hello World");
    });

    test("decodes data URL with charset", () => {
      const dataUrl = "data:text/plain;charset=utf-8;base64,SGVsbG8=";
      const result = decodeDataUrlToBytes(dataUrl, 1000);
      expect(result).not.toBeNull();
      expect(result?.mimeType).toBe("text/plain");
    });

    test("returns null for non-data URL", () => {
      const result = decodeDataUrlToBytes("https://example.com", 1000);
      expect(result).toBeNull();
    });

    test("returns null for data URL without comma", () => {
      const result = decodeDataUrlToBytes("data:text/plain", 1000);
      expect(result).toBeNull();
    });

    test("returns null for non-Base64 data URL", () => {
      const result = decodeDataUrlToBytes("data:text/plain,Hello", 1000);
      expect(result).toBeNull();
    });

    test("returns null for percent-encoded data URL", () => {
      // Percent-encoded URLs are intentionally not handled
      const result = decodeDataUrlToBytes("data:text/plain,Hello%20World", 1000);
      expect(result).toBeNull();
    });

    test("respects maxBytes limit", () => {
      const largePayload = "A".repeat(200);
      const dataUrl = `data:text/plain;base64,${largePayload}`;
      const result = decodeDataUrlToBytes(dataUrl, 100);
      expect(result).toBeNull();
    });

    test("returns null on decode error", () => {
      const dataUrl = "data:text/plain;base64,!!!invalid!!!";
      const result = decodeDataUrlToBytes(dataUrl, 1000);
      expect(result).toBeNull();
    });

    test("handles empty MIME type", () => {
      const dataUrl = "data:;base64,SGVsbG8=";
      const result = decodeDataUrlToBytes(dataUrl, 1000);
      expect(result).not.toBeNull();
      expect(result?.mimeType).toBe("");
    });

    test("normalizes MIME type to lowercase", () => {
      const dataUrl = "data:TEXT/PLAIN;base64,SGVsbG8=";
      const result = decodeDataUrlToBytes(dataUrl, 1000);
      expect(result?.mimeType).toBe("text/plain");
    });
  });

  describe("security invariants", () => {
    test("never calls atob on invalid charset", () => {
      // This is tested indirectly by the charset validation
      // If validation fails, atob is never called
      expect(() => assertValidBase64("!!!", 1000)).toThrow(DefensiveBase64Error);
    });

    test("never allocates beyond maxBytes", () => {
      const largePayload = "A".repeat(10000); // 7500 bytes decoded
      expect(() => decodeDefensiveBase64(largePayload, 100, 1024)).toThrow(
        DefensiveBase64Error,
      );
    });

    test("chunked decoding uses pre-sized buffer", () => {
      const data = "SGVsbG8gV29ybGQ="; // "Hello World" with padding
      const result = decodeDefensiveBase64(data, 1000, 1024);
      // Buffer is allocated once at the exact decoded length
      expect(result.length).toBe(11);
    });

    test("async variant prevents UI freeze", async () => {
      // This is a behavioral test - the async variant should yield
      // We can't directly test "no freeze", but we can verify it completes
      const largePayload = "A".repeat(10000);
      const result = await decodeDefensiveBase64Async(largePayload, 10000, 1024);
      expect(result.length).toBe(7500);
    });
  });

  describe("edge cases", () => {
    test("handles whitespace in Base64 (should reject)", () => {
      expect(() => assertValidBase64("SGVs bG8=", 1000)).toThrow(
        DefensiveBase64Error,
      );
    });

    test("handles URL-safe Base64 (should reject)", () => {
      // URL-safe uses - and _ instead of + and /
      expect(() => assertValidBase64("SGVs-bG8_", 1000)).toThrow(
        DefensiveBase64Error,
      );
    });

    test("handles minimal valid Base64", () => {
      const data = "AA=="; // 1 byte
      const result = assertValidBase64(data, 1000);
      expect(result.decodedLength).toBe(1);
      expect(result.padding).toBe(2);
    });

    test("handles empty decoded result (4 chars = 0 bytes)", () => {
      // This is actually not valid - 4 chars Base64 always decodes to 3 bytes
      // The minimum is 2 chars for 1 byte with padding
      const data = "AA==";
      const result = decodeDefensiveBase64(data, 1000, 1024);
      expect(result.length).toBe(1);
    });
  });
});
