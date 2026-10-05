import { describe, expect, it } from "vitest";
import {
  DefensiveBase64Error,
  assertValidBase64,
  decodeDataUrlToBytes,
  decodeDefensiveBase64,
  decodeDefensiveBase64Async,
} from "../../utils/defensive-base64";

describe("assertValidBase64", () => {
  it("returns the exact decoded length for padded payloads", () => {
    expect(assertValidBase64("SGk=", 100)).toEqual({
      decodedLength: 2,
      padding: 1,
    });
    expect(assertValidBase64("QQ==", 100)).toEqual({
      decodedLength: 1,
      padding: 2,
    });
  });

  it.each(["", "SGk", "SG=k", "SGk===", "not base64!"])(
    "rejects malformed payload %s before decoding",
    (value) => {
      expect(() => assertValidBase64(value, 100)).toThrowError(
        DefensiveBase64Error,
      );
      try {
        assertValidBase64(value, 100);
      } catch (error) {
        expect((error as DefensiveBase64Error).reason).toBe("invalid-format");
      }
    },
  );

  it("rejects oversized payloads without allocating", () => {
    // 4 base64 chars = 3 bytes: 8 chars decodes to 6 bytes.
    expect(() => assertValidBase64("AAAAAAAA", 5)).toThrowError(
      DefensiveBase64Error,
    );
    try {
      assertValidBase64("AAAAAAAA", 5);
    } catch (error) {
      expect((error as DefensiveBase64Error).reason).toBe("too-large");
    }
  });
});

describe("decodeDefensiveBase64", () => {
  it("decodes valid payloads across chunk boundaries", () => {
    const raw = new Uint8Array(10);
    for (let i = 0; i < raw.length; i++) {raw[i] = i;}
    let binary = "";
    for (const b of raw) {binary += String.fromCharCode(b);}
    const base64 = btoa(binary);

    const decoded = decodeDefensiveBase64(base64, 1024, 4);
    expect(Array.from(decoded)).toEqual(Array.from(raw));
  });

  it("decodes exactly at the limit but not above it", () => {
    const base64 = btoa("12345");
    expect(() => decodeDefensiveBase64(base64, 4, 4)).toThrowError(
      DefensiveBase64Error,
    );
    const decoded = decodeDefensiveBase64(base64, 5, 4);
    expect(new TextDecoder().decode(decoded)).toBe("12345");
  });
});

describe("decodeDefensiveBase64Async", () => {
  it("decodes multi-chunk payloads with yields", async () => {
    const payload = JSON.stringify({
      bookmarks: [{ id: "big", title: "x".repeat(300_000) }],
    });
    const bytes = new TextEncoder().encode(payload);
    let base64 = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      base64 += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    base64 = btoa(base64);

    const decoded = await decodeDefensiveBase64Async(base64, 1024 * 1024, 64 * 1024);
    expect(new TextDecoder().decode(decoded)).toBe(payload);
  });

  it("rejects oversized payloads before any atob call", async () => {
    const oversized = "A".repeat(4 * 1024 * 1024); // would decode to 3 MB
    await expect(
      decodeDefensiveBase64Async(oversized, 1024, 64),
    ).rejects.toMatchObject({ reason: "too-large" });
  });
});

describe("decodeDataUrlToBytes", () => {
  it("decodes a valid data URL and returns the mime type", () => {
    const decoded = decodeDataUrlToBytes(
      `data:image/png;base64,${btoa("\x89PNG")}`,
      1024,
    );
    expect(decoded).not.toBeNull();
    expect(decoded!.mimeType).toBe("image/png");
    expect(Array.from(decoded!.bytes)).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it("rejects lenient Base64 that bare atob would accept", () => {
    // Length 3 is not a multiple of 4; browsers' forgiving atob accepts it.
    expect(decodeDataUrlToBytes("data:audio/mp3;base64,abc", 1024)).toBeNull();
  });

  it("rejects malformed data URLs and percent-encoded payloads", () => {
    expect(decodeDataUrlToBytes("not-a-data-url", 1024)).toBeNull();
    expect(decodeDataUrlToBytes("data:text/plain,hello", 1024)).toBeNull();
    expect(decodeDataUrlToBytes("data:", 1024)).toBeNull();
  });

  it("rejects oversized payloads before allocating", () => {
    // 8 base64 chars decode to 6 bytes; the bound is 5.
    expect(
      decodeDataUrlToBytes(`data:application/octet-stream;base64,${btoa("123456")}`, 5),
    ).toBeNull();
  });
});
