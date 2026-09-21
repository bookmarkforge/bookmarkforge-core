#!/usr/bin/env node
/**
 * Build the README demo GIF from the captured app screenshots.
 *
 * Zero extra dependencies: implements GIF89a (LZW), median-cut color
 * quantization and per-frame transparency diffing natively on top of the
 * `pngjs` dev dependency. Every frame is LZW round-trip decoded before the
 * file is written, so a broken stream can never be committed.
 *
 * The bit-width transition follows the omggif reference behavior so the
 * output decodes correctly in browsers, not only in our own verifier.
 *
 * Usage:
 *   node scripts/build-demo-gif.mjs
 *   node scripts/build-demo-gif.mjs --fps 2 --width 640 --out docs/demo.gif
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { PNG } from "pngjs";
import {
  lzwDecode,
  lzwEncode,
  writeSubBlocks,
  quantize,
  makePaletteIndexer,
  composeFrame,
} from "./gif-encoder.mjs";
// One source of truth for the published GIF budget: this builder refuses to
// produce a file the README gate would reject.
import { GIF_BUDGET } from "./check-demo-media.mjs";

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const options = {
    fps: 2,
    width: 640,
    fromDir: resolve("docs"),
    out: resolve("docs/bookmarkforge-demo-tour.gif"),
  };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--fps") options.fps = Number(argv[++i]);
    else if (argv[i] === "--width") options.width = Number(argv[++i]);
    else if (argv[i] === "--from-dir") options.fromDir = resolve(argv[++i]);
    else if (argv[i] === "--out") options.out = resolve(argv[++i]);
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  if (!Number.isFinite(options.fps) || options.fps < 0.5 || options.fps > 10) {
    throw new Error("--fps must be between 0.5 and 10");
  }
  if (
    !Number.isInteger(options.width) ||
    options.width < 240 ||
    options.width > 1280
  ) {
    throw new Error("--width must be between 240 and 1280");
  }
  return options;
}

const SOURCE_FRAMES = [
  { file: "bookmarkforge-demo-app.png", caption: "Local-first vault — everything on your device", ms: 2600 },
  { file: "bookmarkforge-demo-capture.png", caption: "Capture any page in seconds", ms: 2200 },
  { file: "bookmarkforge-demo-bookmarks.png", caption: "Organized, searchable, private", ms: 2200 },
  { file: "bookmarkforge-demo-search.png", caption: "Instant search across your vault", ms: 2200 },
  { file: "bookmarkforge-demo-locked.png", caption: "Locked until you return", ms: 1800 },
  { file: "bookmarkforge-demo-mobile-capture.png", caption: "Works on mobile too", ms: 2200 },
];

const CAPTION_HEIGHT = 44;
const MAX_PALETTE = 255; // +1 transparent slot = full 256-color table

// Main
// ---------------------------------------------------------------------------

async function main() {
  const options = parseArgs(process.argv);
  const docsDir = options.fromDir;

  const sources = [];
  for (const frame of SOURCE_FRAMES) {
    const path = join(docsDir, frame.file);
    if (!existsSync(path)) {
      throw new Error(
        `missing source frame: ${frame.file} (run scripts/capture-demo-screens.mjs first)`,
      );
    }
    const png = PNG.sync.read(readFileSync(path));
    if (png.width < 200 || png.height < 200) {
      throw new Error(`${frame.file} too small: ${png.width}x${png.height}`);
    }
    sources.push({ ...frame, png });
  }

  const first = sources[0].png;
  const width = options.width;
  const height = Math.round((width * first.height) / first.width) + CAPTION_HEIGHT;

  const frames = sources.map((s) => ({
    caption: s.caption,
    ms: s.ms,
    rgba: composeFrame(s.png, width, height, s.caption, CAPTION_HEIGHT),
  }));

  // Shared palette from sampled pixels of all frames → single global table.
  const sample = [];
  const stride = Math.max(1, Math.floor((width * height) / 50000));
  for (const f of frames) {
    for (let i = 0; i < width * height; i += stride) {
      const o = i * 4;
      sample.push([f.rgba[o], f.rgba[o + 1], f.rgba[o + 2]]);
    }
  }
  const palette = quantize(sample, MAX_PALETTE);
  if (palette.length > MAX_PALETTE) palette.length = MAX_PALETTE;
  const transparentIndex = palette.length;
  let tableSize = 2;
  while (tableSize < palette.length + 1) tableSize *= 2;
  const bits = Math.round(Math.log2(tableSize));
  while (palette.length < tableSize) palette.push([0, 0, 0]);
  const indexPixel = makePaletteIndexer(palette);

  // Header + Logical Screen Descriptor (global color table).
  const out = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]; // "GIF89a"
  out.push(width & 0xff, (width >> 8) & 0xff);
  out.push(height & 0xff, (height >> 8) & 0xff);
  out.push(0xf0 | (bits - 1)); // GCT flag + color resolution + size
  out.push(0); // background color index
  out.push(0); // pixel aspect ratio
  for (const [r, g, b] of palette) out.push(r, g, b);

  // NETSCAPE2.0 infinite loop extension.
  out.push(0x21, 0xff, 0x0b);
  for (const c of "NETSCAPE2.0") out.push(c.charCodeAt(0));
  out.push(0x03, 0x01, 0x00, 0x00, 0x00);

  const minCodeSize = Math.max(2, bits);
  let prevRgba = null;
  let totalMs = 0;
  for (const frame of frames) {
    const delayCs = Math.max(2, Math.round(frame.ms / 10));
    totalMs += delayCs * 10;

    // Graphic Control Extension: transparency for diffed frames.
    const hasTransparency = Boolean(prevRgba);
    out.push(0x21, 0xf9, 0x04);
    out.push((hasTransparency ? 0x01 : 0x00) | 0x04); // transparent | disposal=keep
    out.push(delayCs & 0xff, (delayCs >> 8) & 0xff);
    out.push(transparentIndex);
    out.push(0x00);

    // Image Descriptor.
    out.push(0x2c);
    out.push(0, 0, 0, 0);
    out.push(width & 0xff, (width >> 8) & 0xff);
    out.push(height & 0xff, (height >> 8) & 0xff);
    out.push(0x00); // no local color table, no interlace

    // Indexed pixels; unchanged pixels vs previous frame → transparent.
    const pixelCount = width * height;
    const indices = new Uint8Array(pixelCount);
    for (let i = 0; i < pixelCount; i++) {
      const o = i * 4;
      const same =
        prevRgba &&
        prevRgba[o] === frame.rgba[o] &&
        prevRgba[o + 1] === frame.rgba[o + 1] &&
        prevRgba[o + 2] === frame.rgba[o + 2];
      indices[i] = same
        ? transparentIndex
        : indexPixel(frame.rgba[o], frame.rgba[o + 1], frame.rgba[o + 2]);
    }

    const compressed = lzwEncode(indices, minCodeSize);
    const decoded = lzwDecode(
      new Uint8Array(compressed),
      minCodeSize,
      pixelCount,
    );
    for (let i = 0; i < pixelCount; i++) {
      if (decoded[i] !== indices[i]) {
        throw new Error(
          `LZW round-trip mismatch at pixel ${i}: ${decoded[i]} != ${indices[i]}`,
        );
      }
    }

    out.push(minCodeSize);
    writeSubBlocks(out, compressed);
    prevRgba = frame.rgba;
  }

  out.push(0x3b); // trailer

  const buffer = Buffer.from(out);
  writeFileSync(options.out, buffer);
  console.log(
    `wrote ${options.out} (${Math.round(buffer.length / 1024)} KB, ` +
      `${frames.length} frames, ${(totalMs / 1000).toFixed(1)}s loop, ` +
      `${width}x${height}, ${palette.length} colors)`,
  );

  if (buffer.length > GIF_BUDGET.maxBytes) {
    throw new Error(
      `the GIF is ${buffer.length} bytes, over the ${GIF_BUDGET.maxBytes}-byte README budget ` +
        `by ${buffer.length - GIF_BUDGET.maxBytes}. Lower --width, drop a frame from ` +
        "SOURCE_FRAMES, or raise the budget in scripts/check-demo-media.mjs with a documented reason.",
    );
  }
}

main().catch((error) => {
  console.error("[gif] FAILED:", error?.message ?? error);
  process.exit(1);
});
