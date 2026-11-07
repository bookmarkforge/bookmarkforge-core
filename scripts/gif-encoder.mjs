#!/usr/bin/env node
/**
 * GIF89a encoder toolkit — dependency-free (pngjs used by callers only).
 *
 * Implements:
 *  - GIF LZW compression/decompression (omggif-compatible code widths)
 *  - median-cut color quantization
 *  - memoized nearest-palette indexing
 *  - a 5x7 bitmap font for caption bars
 *
 * Used by scripts/build-demo-gif.mjs; the LZW codec is round-trip verified
 * by scripts/__tests__/gif-encoder.test.mjs on every CI run.
 */

/**
 * GIF LZW compressor. Dictionary keys are (curCode << 8) | pixel.
 * The table must NOT be seeded with initial codes: key (0<<8)|k would alias
 * the composed entry for the string [0, k] and corrupt the stream.
 */
// ---------------------------------------------------------------------------
// Image pipeline: decode → scale (fit/letterbox) → compose with caption bar
// ---------------------------------------------------------------------------

/** Area-average box filter downscale (no dependencies, decent quality). */
function scaleImage(src, targetW, targetH) {
  const out = Buffer.alloc(targetW * targetH * 4);
  const xr = src.width / targetW;
  const yr = src.height / targetH;
  for (let y = 0; y < targetH; y++) {
    const y0 = Math.floor(y * yr);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * yr));
    for (let x = 0; x < targetW; x++) {
      const x0 = Math.floor(x * xr);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * xr));
      let r = 0, g = 0, b = 0, count = 0;
      for (let sy = y0; sy < y1 && sy < src.height; sy++) {
        for (let sx = x0; sx < x1 && sx < src.width; sx++) {
          const i = (sy * src.width + sx) * 4;
          r += src.data[i];
          g += src.data[i + 1];
          b += src.data[i + 2];
          count++;
        }
      }
      const o = (y * targetW + x) * 4;
      out[o] = Math.round(r / count);
      out[o + 1] = Math.round(g / count);
      out[o + 2] = Math.round(b / count);
      out[o + 3] = 255;
    }
  }
  return { width: targetW, height: targetH, data: out };
}

// ---------------------------------------------------------------------------
// Median-cut quantizer (deterministic)
// ---------------------------------------------------------------------------

function bucketOf(pixels) {
  const min = [255, 255, 255];
  const max = [0, 0, 0];
  for (const p of pixels) {
    for (let c = 0; c < 3; c++) {
      if (p[c] < min[c]) min[c] = p[c];
      if (p[c] > max[c]) max[c] = p[c];
    }
  }
  return { pixels, min, max };
}

function quantize(samples, maxColors) {
  if (!samples.length) return [[0, 0, 0]];
  let buckets = [bucketOf(samples)];
  while (buckets.length < maxColors) {
    let widest = -1;
    let widestRange = 0;
    let widestChannel = 0;
    for (let i = 0; i < buckets.length; i++) {
      const b = buckets[i];
      if (b.pixels.length < 2) continue;
      for (let c = 0; c < 3; c++) {
        const range = b.max[c] - b.min[c];
        if (range > widestRange) {
          widestRange = range;
          widest = i;
          widestChannel = c;
        }
      }
    }
    if (widest === -1 || widestRange === 0) break;
    const bucket = buckets[widest];
    const channel = widestChannel;
    bucket.pixels.sort((a, b) => a[channel] - b[channel]);
    const mid = bucket.pixels.length >> 1;
    const left = bucketOf(bucket.pixels.slice(0, mid));
    const right = bucketOf(bucket.pixels.slice(mid));
    buckets.splice(widest, 1, left, right);
  }
  const palette = [];
  for (const bucket of buckets) {
    if (!bucket.pixels.length) continue;
    let r = 0, g = 0, b = 0;
    for (const p of bucket.pixels) {
      r += p[0];
      g += p[1];
      b += p[2];
    }
    const n = bucket.pixels.length;
    palette.push([Math.round(r / n), Math.round(g / n), Math.round(b / n)]);
  }
  return palette.length ? palette : [[0, 0, 0]];
}

/** Nearest palette index with memoization keyed by packed RGB. */
function makePaletteIndexer(palette) {
  const cache = new Map();
  return (r, g, b) => {
    const key = (r << 16) | (g << 8) | b;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const dr = palette[i][0] - r;
      const dg = palette[i][1] - g;
      const db = palette[i][2] - b;
      const dist = dr * dr + dg * dg + db * db;
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    cache.set(key, best);
    return best;
  };
}

// ---------------------------------------------------------------------------
// 5x7 bitmap font for the caption bar
// ---------------------------------------------------------------------------

function getFont() {
  return {
    " ": [0,0,0,0,0,0,0],
    "A": [0b01110,0b10001,0b10001,0b11111,0b10001,0b10001,0b10001],
    "B": [0b11110,0b10001,0b10001,0b11110,0b10001,0b10001,0b11110],
    "C": [0b01110,0b10001,0b10000,0b10000,0b10000,0b10001,0b01110],
    "D": [0b11110,0b10001,0b10001,0b10001,0b10001,0b10001,0b11110],
    "E": [0b11111,0b10000,0b10000,0b11110,0b10000,0b10000,0b11111],
    "F": [0b11111,0b10000,0b10000,0b11110,0b10000,0b10000,0b10000],
    "G": [0b01110,0b10001,0b10000,0b10111,0b10001,0b10001,0b01111],
    "H": [0b10001,0b10001,0b10001,0b11111,0b10001,0b10001,0b10001],
    "I": [0b01110,0b00100,0b00100,0b00100,0b00100,0b00100,0b01110],
    "J": [0b00111,0b00010,0b00010,0b00010,0b00010,0b10010,0b01100],
    "K": [0b10001,0b10010,0b10100,0b11000,0b10100,0b10010,0b10001],
    "L": [0b10000,0b10000,0b10000,0b10000,0b10000,0b10000,0b11111],
    "M": [0b10001,0b11011,0b10101,0b10101,0b10001,0b10001,0b10001],
    "N": [0b10001,0b11001,0b10101,0b10011,0b10001,0b10001,0b10001],
    "O": [0b01110,0b10001,0b10001,0b10001,0b10001,0b10001,0b01110],
    "P": [0b11110,0b10001,0b10001,0b11110,0b10000,0b10000,0b10000],
    "Q": [0b01110,0b10001,0b10001,0b10001,0b10101,0b10010,0b01101],
    "R": [0b11110,0b10001,0b10001,0b11110,0b10100,0b10010,0b10001],
    "S": [0b01111,0b10000,0b10000,0b01110,0b00001,0b00001,0b11110],
    "T": [0b11111,0b00100,0b00100,0b00100,0b00100,0b00100,0b00100],
    "U": [0b10001,0b10001,0b10001,0b10001,0b10001,0b10001,0b01110],
    "V": [0b10001,0b10001,0b10001,0b10001,0b10001,0b01010,0b00100],
    "W": [0b10001,0b10001,0b10001,0b10101,0b10101,0b11011,0b10001],
    "X": [0b10001,0b10001,0b01010,0b00100,0b01010,0b10001,0b10001],
    "Y": [0b10001,0b10001,0b01010,0b00100,0b00100,0b00100,0b00100],
    "Z": [0b11111,0b00001,0b00010,0b00100,0b01000,0b10000,0b11111],
    "a": [0,0b01110,0b00001,0b01111,0b10001,0b10001,0b01111],
    "b": [0b10000,0b10000,0b11110,0b10001,0b10001,0b10001,0b11110],
    "c": [0,0b01110,0b10001,0b10000,0b10000,0b10001,0b01110],
    "d": [0b00001,0b00001,0b01111,0b10001,0b10001,0b10001,0b01111],
    "e": [0,0b01110,0b10001,0b11111,0b10000,0b10001,0b01110],
    "f": [0b00110,0b01001,0b01000,0b11110,0b01000,0b01000,0b01000],
    "g": [0,0b01111,0b10001,0b10001,0b01111,0b00001,0b01110],
    "h": [0b10000,0b10000,0b11110,0b10001,0b10001,0b10001,0b10001],
    "i": [0b00100,0,0b01100,0b00100,0b00100,0b00100,0b01110],
    "j": [0b00010,0,0b00110,0b00010,0b00010,0b10010,0b01100],
    "k": [0b10000,0b10000,0b10010,0b10100,0b11000,0b10100,0b10010],
    "l": [0b01100,0b00100,0b00100,0b00100,0b00100,0b00100,0b01110],
    "m": [0,0b11010,0b10101,0b10101,0b10101,0b10101,0b10101],
    "n": [0,0b11110,0b10001,0b10001,0b10001,0b10001,0b10001],
    "o": [0,0b01110,0b10001,0b10001,0b10001,0b10001,0b01110],
    "p": [0,0b11110,0b10001,0b10001,0b11110,0b10000,0b10000],
    "q": [0,0b01111,0b10001,0b10001,0b01111,0b00001,0b00001],
    "r": [0,0b10110,0b11001,0b10000,0b10000,0b10000,0b10000],
    "s": [0,0b01111,0b10000,0b01110,0b00001,0b10001,0b01110],
    "t": [0b01000,0b01000,0b11110,0b01000,0b01000,0b01001,0b00110],
    "u": [0,0b10001,0b10001,0b10001,0b10001,0b10011,0b01101],
    "v": [0,0b10001,0b10001,0b10001,0b10001,0b01010,0b00100],
    "w": [0,0b10001,0b10001,0b10101,0b10101,0b10101,0b01010],
    "x": [0,0b10001,0b01010,0b00100,0b01010,0b10001,0],
    "y": [0,0b10001,0b10001,0b10001,0b01111,0b00001,0b01110],
    "z": [0,0b11111,0b00010,0b00100,0b01000,0b10000,0b11111],
    "0": [0b01110,0b10001,0b10011,0b10101,0b11001,0b10001,0b01110],
    "1": [0b00100,0b01100,0b00100,0b00100,0b00100,0b00100,0b01110],
    "2": [0b01110,0b10001,0b00001,0b00110,0b01000,0b10000,0b11111],
    "3": [0b11110,0b00001,0b00001,0b01110,0b00001,0b00001,0b11110],
    "4": [0b00010,0b00110,0b01010,0b10010,0b11111,0b00010,0b00010],
    "5": [0b11111,0b10000,0b11110,0b00001,0b00001,0b10001,0b01110],
    "6": [0b01110,0b10000,0b10000,0b11110,0b10001,0b10001,0b01110],
    "7": [0b11111,0b00001,0b00010,0b00100,0b01000,0b01000,0b01000],
    "8": [0b01110,0b10001,0b10001,0b01110,0b10001,0b10001,0b01110],
    "9": [0b01110,0b10001,0b10001,0b01111,0b00001,0b00001,0b01110],
    "—": [0,0,0b11111,0,0,0,0],
    "–": [0,0,0b11111,0,0,0,0],
    "-": [0,0,0,0b11111,0,0,0],
    ",": [0,0,0,0,0,0b00100,0b01000],
    ".": [0,0,0,0,0,0,0b00100],
    "?": [0b01110,0b10001,0b00001,0b00110,0b00100,0,0b00100],
    "!": [0b00100,0b00100,0b00100,0b00100,0b00100,0,0b00100],
    "'": [0b00100,0b00100,0,0,0,0,0],
  };
}
// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

/**
 * Compose one output frame: fit the source image (letterbox, never stretch)
 * on a dark backdrop and draw a caption bar with the given height below it.
 */
function composeFrame(png, width, height, caption, captionHeight = 44) {
  const canvas = Buffer.alloc(width * height * 4, 0);
  const boxW = width;
  const boxH = height - captionHeight;

  // Fill the content box with a dark backdrop (also the letterbox color).
  for (let y = 0; y < boxH; y++) {
    for (let x = 0; x < boxW; x++) {
      const o = (y * width + x) * 4;
      canvas[o] = 22;
      canvas[o + 1] = 22;
      canvas[o + 2] = 28;
      canvas[o + 3] = 255;
    }
  }

  // Fit (never stretch): desktop frames fill exactly, mobile letterboxes.
  const scale = Math.min(boxW / png.width, boxH / png.height);
  const drawW = Math.max(1, Math.round(png.width * scale));
  const drawH = Math.max(1, Math.round(png.height * scale));
  const offX = Math.floor((boxW - drawW) / 2);
  const offY = Math.floor((boxH - drawH) / 2);
  const scaled = scaleImage(png, drawW, drawH);
  for (let y = 0; y < drawH; y++) {
    const srcStart = y * drawW * 4;
    scaled.data.copy(
      canvas,
      (offY + y) * width * 4 + offX * 4,
      srcStart,
      srcStart + drawW * 4,
    );
  }

  // Caption bar with white centered text.
  const barY = boxH;
  for (let y = barY; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      canvas[o] = 10;
      canvas[o + 1] = 10;
      canvas[o + 2] = 14;
    }
  }
  const font = getFont();
  let cx = Math.max(0, Math.floor((width - caption.length * 6) / 2));
  const cy = barY + Math.floor((captionHeight - 7) / 2);
  for (const ch of caption) {
    const glyph = font[ch] ?? font["?"];
    if (!glyph) {
      cx += 6;
      continue;
    }
    for (let gy = 0; gy < 7; gy++) {
      for (let gx = 0; gx < 5; gx++) {
        if ((glyph[gy] >> (4 - gx)) & 1) {
          const px = cx + gx;
          const py = cy + gy;
          if (px >= 0 && px < width && py < height) {
            const o = (py * width + px) * 4;
            canvas[o] = 240;
            canvas[o + 1] = 240;
            canvas[o + 2] = 245;
          }
        }
      }
    }
    cx += 6;
  }
  return canvas;
}

// ---------------------------------------------------------------------------
// GIF89a LZW — encoder and verifier decoder (omggif-compatible widths)
// ---------------------------------------------------------------------------

/** GIF LZW compressor. Numeric dictionary keys: prevCode * 256 + pixel. */
function lzwEncode(indexPixels, minCodeSize) {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  // Pixel indices must fit the initial code width or the stream is garbage.
  for (let i = 0; i < indexPixels.length; i++) {
    if (indexPixels[i] < 0 || indexPixels[i] >= clearCode) {
      throw new Error(
        `pixel index out of range at ${i}: ${indexPixels[i]} (must be < ${clearCode})`,
      );
    }
  }
  const bytes = [];
  let bitBuffer = 0;
  let bitCount = 0;
  const packCode = (code, size) => {
    bitBuffer |= code << bitCount;
    bitCount += size;
    while (bitCount >= 8) {
      bytes.push(bitBuffer & 0xff);
      bitBuffer >>= 8;
      bitCount -= 8;
    }
  };

  let codeSize = minCodeSize + 1;
  let dict = new Map();
  let dictNext = eoiCode + 1;
  // The dictionary holds composed strings only, keyed by (curCode << 8) | k.
  // Single-pixel codes are implicit (a miss ends with curCode = k), so the
  // table must NOT be seeded with the initial codes: key (0<<8)|k would
  // alias the composed entry for the string [0, k] and corrupt the stream.
  const resetDict = () => {
    dict = new Map();
    dictNext = eoiCode + 1;
    codeSize = minCodeSize + 1;
  };
  resetDict();

  let curCode = indexPixels[0];
  for (let i = 1; i < indexPixels.length; i++) {
    const k = indexPixels[i];
    const key = curCode * 256 + k;
    const found = dict.get(key);
    if (found !== undefined) {
      curCode = found;
      continue;
    }
    packCode(curCode, codeSize);
    if (dictNext === 4096) {
      packCode(clearCode, codeSize);
      resetDict();
    } else {
      if (dictNext >= 1 << codeSize && codeSize < 12) codeSize++;
      dict.set(key, dictNext++);
    }
    curCode = k;
  }
  packCode(curCode, codeSize);
  packCode(eoiCode, codeSize);
  if (bitCount > 0) bytes.push(bitBuffer & 0xff);
  return bytes;
}

/** GIF LZW decoder used to verify the encoder round-trips every frame. */
function lzwDecode(data, minCodeSize, expectedPixels) {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let dict = [];
  const resetDict = () => {
    dict = [];
    for (let i = 0; i < clearCode; i++) dict.push([i]);
    dict.push(null); // clear
    dict.push(null); // EOI
    codeSize = minCodeSize + 1;
  };
  resetDict();

  const out = [];
  let bitPos = 0;
  const readCode = () => {
    let code = 0;
    for (let i = 0; i < codeSize; i++) {
      const byte = data[bitPos >> 3];
      if (byte === undefined) return eoiCode;
      code |= ((byte >> (bitPos & 7)) & 1) << i;
      bitPos++;
    }
    return code;
  };

  let prev = null;
  for (;;) {
    const code = readCode();
    if (code === clearCode) {
      resetDict();
      prev = null;
      continue;
    }
    if (code === eoiCode) break;
    let entry;
    if (code < dict.length && dict[code]) {
      entry = dict[code];
    } else if (code === dict.length && prev) {
      entry = prev.concat([prev[0]]); // KwKwK case
    } else {
      throw new Error(`corrupt LZW stream: unexpected code ${code}`);
    }
    for (const v of entry) out.push(v);
    if (prev && dict.length < 4096) {
      dict.push(prev.concat([entry[0]]));
      if (dict.length === (1 << codeSize) && codeSize < 12) codeSize++;
    }
    prev = entry;
  }
  if (out.length !== expectedPixels) {
    throw new Error(
      `decode length ${out.length} != expected ${expectedPixels}`,
    );
  }
  return out;
}

function writeSubBlocks(bytes, data) {
  for (let i = 0; i < data.length; i += 255) {
    const chunk = data.slice(i, i + 255);
    bytes.push(chunk.length);
    for (const b of chunk) bytes.push(b);
  }
  bytes.push(0); // block terminator
}

// ---------------------------------------------------------------------------
export {
  lzwEncode,
  lzwDecode,
  writeSubBlocks,
  quantize,
  bucketOf,
  makePaletteIndexer,
  getFont,
  scaleImage,
  composeFrame,
};
