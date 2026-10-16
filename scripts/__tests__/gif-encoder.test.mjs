/**
 * Round-trip and structural tests for the dependency-free GIF encoder toolkit
 * (scripts/gif-encoder.mjs), used by scripts/build-demo-gif.mjs.
 *
 * The LZW cases deliberately include the two historical failure modes of GIF
 * encoders: (a) dictionary aliasing when the initial codes are pre-seeded,
 * and (b) code-width desynchronization between encoder and decoder.
 */
import { describe, expect, it } from "vitest";
import {
  composeFrame,
  getFont,
  lzwDecode,
  lzwEncode,
  makePaletteIndexer,
  quantize,
  scaleImage,
  writeSubBlocks,
} from "../gif-encoder.mjs";

/** Deterministic LCG so failures are reproducible across runs. */
function lcg(seed) {
  let state = seed >>> 0;
  return (n) => {
    state = (state * 1103515245 + 12345) >>> 0;
    return state % n;
  };
}

function roundtrip(indices, minCodeSize) {
  const compressed = lzwEncode(indices, minCodeSize);
  const decoded = lzwDecode(
    new Uint8Array(compressed),
    minCodeSize,
    indices.length,
  );
  expect(decoded).toHaveLength(indices.length);
  for (let i = 0; i < indices.length; i++) {
    if (decoded[i] !== indices[i]) {
      throw new Error(
        `round-trip mismatch at ${i}: ${decoded[i]} != ${indices[i]}`,
      );
    }
  }
}

describe("lzwEncode/lzwDecode round-trip", () => {
  it("survives random streams at every legal minimum code size", () => {
    const rnd = lcg(20260921);
    for (const minCodeSize of [2, 3, 8]) {
      for (const length of [100, 5000, 30000, 120000]) {
        const indices = Array.from({ length }, () => rnd(1 << minCodeSize));
        roundtrip(indices, minCodeSize);
      }
    }
  });

  it("handles uniform runs (KwKwK-heavy case)", () => {
    for (const length of [10, 1000, 50000]) {
      roundtrip(new Array(length).fill(3), 2);
    }
  });

  it("handles alternating patterns and single-symbol streams", () => {
    roundtrip([0, 1, 0, 1, 0, 1, 0, 1], 2);
    roundtrip([3], 2);
    roundtrip([2, 2], 2);
    // Larger alphabets through a matching minimum code size.
    roundtrip([7], 3);
    roundtrip([5, 5], 3);
  });

  it("rejects pixel indices that exceed the initial code width", () => {
    expect(() => lzwEncode([7], 2)).toThrow(/out of range/);
    expect(() => lzwEncode([1, 300], 2)).toThrow(/out of range/);
  });

  it("aliases never collide when pixel 0 follows pixel 0 (dict key check)", () => {
    // Regression: seeding the dictionary with the initial codes made key
    // (0<<8)|k alias the composed entry for the string [0, k].
    roundtrip([0, 0, 1, 0, 0, 1, 2, 0, 0, 1], 2);
    roundtrip(Array.from({ length: 4096 }, (_, i) => i % 4), 2);
  });

  it("wraps the code table at 4096 entries with a clear code", () => {
    const rnd = lcg(42);
    // High-entropy stream long enough to fill and wrap the dictionary.
    roundtrip(Array.from({ length: 90000 }, () => rnd(256)), 8);
  });
});

describe("writeSubBlocks", () => {
  it("chunks data into <=255-byte sub-blocks with terminator", () => {
    const data = Array.from({ length: 600 }, (_, i) => i % 256);
    const bytes = [];
    writeSubBlocks(bytes, data);
    // 600 bytes → chunks of 255 + 255 + 90, each preceded by a length byte,
    // plus the terminator: 256 + 256 + 91 + 1 = 604.
    expect(bytes.length).toBe(604);
    expect(bytes[0]).toBe(255);
    expect(bytes[256]).toBe(255);
    expect(bytes[512]).toBe(90);
    expect(bytes[bytes.length - 1]).toBe(0);
  });

  it("emits a bare terminator for empty data", () => {
    const bytes = [];
    writeSubBlocks(bytes, []);
    expect(bytes).toEqual([0]);
  });
});

describe("quantize", () => {
  it("returns a deterministic palette within the requested size", () => {
    const rnd = lcg(7);
    const samples = Array.from({ length: 5000 }, () => [rnd(256), rnd(256), rnd(256)]);
    const a = quantize(samples, 255);
    const b = quantize(samples, 255);
    expect(a).toEqual(b);
    expect(a.length).toBeLessThanOrEqual(255);
    expect(a.length).toBeGreaterThan(0);
    for (const [r, g, bl] of a) {
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(255);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThanOrEqual(255);
      expect(bl).toBeGreaterThanOrEqual(0);
      expect(bl).toBeLessThanOrEqual(255);
    }
  });

  it("collapses a single-color input to one palette entry", () => {
    const palette = quantize(Array.from({ length: 100 }, () => [10, 20, 30]), 255);
    expect(palette).toEqual([[10, 20, 30]]);
  });

  it("handles empty input without crashing", () => {
    expect(quantize([], 255)).toEqual([[0, 0, 0]]);
  });
});

describe("makePaletteIndexer", () => {
  it("finds the exact palette entry for a known color", () => {
    const palette = [
      [0, 0, 0],
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
    ];
    const index = makePaletteIndexer(palette);
    expect(index(0, 0, 0)).toBe(0);
    expect(index(255, 0, 0)).toBe(1);
    expect(index(0, 255, 0)).toBe(2);
    expect(index(0, 0, 255)).toBe(3);
  });

  it("memoizes repeated lookups without changing results", () => {
    const palette = [
      [0, 0, 0],
      [255, 255, 255],
    ];
    const index = makePaletteIndexer(palette);
    const first = index(250, 250, 250);
    const second = index(250, 250, 250);
    expect(first).toBe(second);
    expect(first).toBe(1);
  });
});

describe("scaleImage", () => {
  it("preserves dimensions and averages a solid color", () => {
    const src = {
      width: 4,
      height: 4,
      data: Buffer.alloc(4 * 4 * 4, 0),
    };
    for (let i = 0; i < 16; i++) {
      src.data[i * 4] = 100;
      src.data[i * 4 + 1] = 150;
      src.data[i * 4 + 2] = 200;
      src.data[i * 4 + 3] = 255;
    }
    const out = scaleImage(src, 2, 2);
    expect(out.width).toBe(2);
    expect(out.height).toBe(2);
    expect(out.data[0]).toBe(100);
    expect(out.data[1]).toBe(150);
    expect(out.data[2]).toBe(200);
  });
});

describe("composeFrame", () => {
  it("letterboxes a tall source and renders the caption text", () => {
    const src = {
      width: 100,
      height: 400,
      data: Buffer.alloc(100 * 400 * 4, 0),
    };
    for (let i = 0; i < 100 * 400; i++) {
      src.data[i * 4] = 255;
      src.data[i * 4 + 1] = 255;
      src.data[i * 4 + 2] = 255;
      src.data[i * 4 + 3] = 255;
    }
    const width = 200;
    const height = 244;
    const caption = "Hi";
    const frame = composeFrame(src, width, height, caption, 44);
    expect(frame).toHaveLength(width * height * 4);
    // Letterbox left edge stays backdrop-dark.
    const backdrop = frame[0];
    expect(backdrop).toBe(22);
    // Caption bar exists (dark row at the bottom).
    const barOffset = ((height - 44) * width + 0) * 4;
    expect(frame[barOffset]).toBe(10);
    // Somewhere in the caption bar the white glyph pixels appear.
    let whitePixels = 0;
    for (let i = (height - 44) * width; i < height * width; i++) {
      if (frame[i * 4] === 240) whitePixels++;
    }
    expect(whitePixels).toBeGreaterThan(0);
  });
});

describe("getFont", () => {
  it("covers every character used by the README captions", () => {
    const font = getFont();
    const captions = [
      "Local-first vault — everything on your device",
      "Capture any page in seconds",
      "Organized, searchable, private",
      "Instant search across your vault",
      "Locked until you return",
      "Works on mobile too",
    ];
    const missing = new Set();
    for (const caption of captions) {
      for (const ch of caption) {
        if (!font[ch]) missing.add(ch);
      }
    }
    expect([...missing]).toEqual([]);
  });
});
