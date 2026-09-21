/**
 * Unit tests for the demo media gates.
 *
 * The gates exist because binary assets are never reviewed: a truncated GIF and
 * a GIF that doubled in size both look like "an image" in a pull request. These
 * tests pin the two failure modes with synthetic fixtures — a minimal real GIF
 * stream built byte by byte, and PNG buffers whose pixel content is chosen to
 * produce a known drift ratio.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import {
  GIF_BUDGET,
  PUBLISHED_DERIVATIVES,
  evaluateAsset,
  findFirstDifference,
  inspectDerivatives,
  parseGifSummary,
  parsePngDimensions,
} from "../check-demo-media.mjs";
import { describeDerivative } from "../publish-demo-media.mjs";
import { DRIFT_DEFAULTS, comparePngBuffers, evaluateDrift } from "../compare-demo-media.mjs";

/** Minimal but structurally real GIF89a: global colour table, 2 frames, loop. */
function buildGif({ frames = 2, loop = true, trailer = true, truncateSubBlock = false } = {}) {
  const bytes = [];
  const push = (...values) => bytes.push(...values);
  const push16 = (value) => push(value & 0xff, (value >> 8) & 0xff);
  const ascii = (text) => push(...[...text].map((c) => c.charCodeAt(0)));

  ascii("GIF89a");
  push16(320); // width
  push16(180); // height
  push(0x80); // global colour table flag, size 2 entries
  push(0); // background colour index
  push(0); // pixel aspect ratio
  push(0x10, 0x20, 0x30); // colour table entry 0
  push(0x40, 0x50, 0x60); // colour table entry 1

  if (loop) {
    push(0x21, 0xff, 0x0b);
    ascii("NETSCAPE2.0");
    push(0x03, 0x01, 0x00, 0x00, 0x00);
  }

  for (let i = 0; i < frames; i++) {
    push(0x21, 0xf9, 0x04, 0x04, 0x0a, 0x00, 0x00, 0x00); // graphics control
    push(0x2c);
    push16(0);
    push16(0);
    push16(320);
    push16(180);
    push(0x00); // no local table
    push(0x02); // LZW minimum code size
    push(0x02, 0x4c, 0x01); // one data sub-block
    if (!truncateSubBlock) push(0x00); // block terminator
  }

  if (trailer) push(0x3b);
  return Buffer.from(bytes);
}

function buildPng(width, height, paint) {
  const png = new PNG({ width, height });
  png.data.fill(0xff);
  paint?.(png);
  return PNG.sync.write(png);
}

describe("GIF structure probe", () => {
  it("accepts a complete animated GIF and reports its shape", () => {
    const summary = parseGifSummary(buildGif());
    expect(summary).toMatchObject({
      ok: true,
      problems: [],
      version: "GIF89a",
      width: 320,
      height: 180,
      frames: 2,
      hasLoopExtension: true,
      hasTrailer: true,
    });
  });

  it("counts every frame, including a single-frame file", () => {
    expect(parseGifSummary(buildGif({ frames: 3 })).frames).toBe(3);
    expect(parseGifSummary(buildGif({ frames: 1 })).frames).toBe(1);
  });

  it("rejects a file that is not a GIF", () => {
    const png = buildPng(4, 4);
    const summary = parseGifSummary(png);
    expect(summary.ok).toBe(false);
    expect(summary.problems.join(" ")).toMatch(/not a GIF stream/);
    expect(parseGifSummary(Buffer.alloc(4)).ok).toBe(false);
  });

  it("detects a GIF truncated inside a sub-block", () => {
    const summary = parseGifSummary(buildGif({ truncateSubBlock: true }));
    expect(summary.ok).toBe(false);
    expect(summary.problems.join(" ")).toMatch(/truncated/);
  });

  it("detects a missing trailer", () => {
    const summary = parseGifSummary(buildGif({ trailer: false }));
    expect(summary.ok).toBe(false);
    expect(summary.problems.join(" ")).toMatch(/trailer/);
  });

  it("reports a non-looping GIF so the budget rule can reject it", () => {
    const summary = parseGifSummary(buildGif({ loop: false }));
    expect(summary.ok).toBe(true);
    expect(summary.hasLoopExtension).toBe(false);
  });
});

describe("PNG header probe", () => {
  it("reads dimensions from IHDR without decoding pixels", () => {
    expect(parsePngDimensions(buildPng(37, 19))).toEqual({ width: 37, height: 19 });
  });

  it("returns null for a non-PNG buffer", () => {
    expect(parsePngDimensions(Buffer.alloc(64, 0x7f))).toBeNull();
    expect(parsePngDimensions(Buffer.alloc(10))).toBeNull();
  });
});

describe("asset budget evaluation", () => {
  const gifStructure = parseGifSummary(buildGif());

  it("passes an asset inside its byte, size and structure rules", () => {
    const verdict = evaluateAsset({
      label: "tour.gif",
      kind: "gif",
      bytes: 90_000,
      budget: GIF_BUDGET,
      structure: gifStructure,
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.problems).toEqual([]);
  });

  it("reports the overshoot of a file above its budget", () => {
    const verdict = evaluateAsset({
      label: "tour.gif",
      kind: "gif",
      bytes: GIF_BUDGET.maxBytes + 2500,
      budget: GIF_BUDGET,
      structure: gifStructure,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join(" ")).toMatch(/exceeds the 150000-byte budget by 2500/);
  });

  it("fails a missing file instead of silently skipping it", () => {
    const verdict = evaluateAsset({
      label: "tour.gif",
      kind: "gif",
      bytes: Number.NaN,
      budget: GIF_BUDGET,
      structure: null,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join(" ")).toMatch(/file is missing/);
  });

  it("rejects a single-frame or non-looping GIF even when its size is fine", () => {
    const single = parseGifSummary(buildGif({ frames: 1 }));
    expect(
      evaluateAsset({ label: "g", kind: "gif", bytes: 1000, budget: GIF_BUDGET, structure: single })
        .problems.join(" "),
    ).toMatch(/expected at least 2/);

    const noLoop = parseGifSummary(buildGif({ loop: false }));
    expect(
      evaluateAsset({ label: "g", kind: "gif", bytes: 1000, budget: GIF_BUDGET, structure: noLoop })
        .problems.join(" "),
    ).toMatch(/NETSCAPE/);
  });

  it("enforces maximum dimensions", () => {
    const verdict = evaluateAsset({
      label: "poster.png",
      kind: "png",
      bytes: 1000,
      budget: { maxWidth: 100, maxHeight: 100 },
      structure: { ok: true, problems: [], width: 640, height: 420 },
    });
    expect(verdict.problems.join(" ")).toMatch(/width 640 exceeds 100/);
    expect(verdict.problems.join(" ")).toMatch(/height 420 exceeds 100/);
  });
});

describe("pixel drift comparison", () => {
  it("pins the calibrated drift budget so loosening it is a deliberate change", () => {
    // Two captures of an unchanged UI differ by at most 0.006% of pixels; a
    // simulated layout change moves 8.13%. The budget lives in that gap.
    expect(DRIFT_DEFAULTS.maxDiffRatio).toBe(0.001);
  });

  it("reports an identical capture as zero difference", () => {
    const capture = buildPng(60, 40);
    const comparison = comparePngBuffers(capture, buildPng(60, 40));
    expect(comparison.dimensionMismatch).toBe(false);
    expect(comparison.ratio).toBe(0);
  });

  it("measures a localised change as a small ratio that stays under the budget", () => {
    const reference = buildPng(100, 100);
    const changed = buildPng(100, 100, (png) => {
      for (let y = 0; y < 10; y++) {
        for (let x = 0; x < 10; x++) {
          const offset = (png.width * y + x) << 2;
          png.data[offset] = 0;
          png.data[offset + 1] = 0;
          png.data[offset + 2] = 0;
        }
      }
    });
    const comparison = comparePngBuffers(reference, changed);
    // 100 of 10_000 pixels mean two black pixels per background pixel.
    expect(comparison.ratio).toBeGreaterThan(0.005);
    expect(comparison.ratio).toBeLessThan(0.03);
    expect(
      evaluateDrift({ name: "app.png", comparison, maxDiffRatio: 0.05 }).ok,
    ).toBe(true);
  });

  it("treats a different image size as a complete mismatch", () => {
    const comparison = comparePngBuffers(buildPng(60, 40), buildPng(80, 40));
    expect(comparison.dimensionMismatch).toBe(true);
    expect(comparison.ratio).toBe(1);
    const verdict = evaluateDrift({
      name: "app.png",
      comparison,
      maxDiffRatio: DRIFT_DEFAULTS.maxDiffRatio,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join(" ")).toMatch(/size changed from 60x40 to 80x40/);
  });

  it("fails a capture whose difference exceeds the drift budget", () => {
    const verdict = evaluateDrift({
      name: "app.png",
      comparison: { dimensionMismatch: false, diffPixels: 500, totalPixels: 10_000, ratio: 0.05 },
      maxDiffRatio: 0.004,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join(" ")).toMatch(/5.00% of pixels differ/);
  });
});

/**
 * The landing can only serve what lives under public/, so the GIF the marketing
 * section shows is a copy of the one the pipeline produces. Nothing in a code
 * review reveals that the copy went stale, which is exactly the failure these
 * tests pin.
 */
describe("published landing copies", () => {
  it("treats identical buffers as equal", () => {
    expect(findFirstDifference(Buffer.from([1, 2, 3]), Buffer.from([1, 2, 3]))).toBe(-1);
  });

  it("reports the offset of the first differing byte", () => {
    expect(findFirstDifference(Buffer.from([1, 2, 3]), Buffer.from([1, 9, 3]))).toBe(1);
  });

  it("reports a truncated copy at the point it stops", () => {
    expect(findFirstDifference(Buffer.from([1, 2, 3, 4]), Buffer.from([1, 2]))).toBe(2);
  });

  it("declares at least one derivative the landing actually serves", () => {
    expect(PUBLISHED_DERIVATIVES.length).toBeGreaterThan(0);
    for (const asset of PUBLISHED_DERIVATIVES) {
      expect(asset.path.startsWith("public/")).toBe(true);
      expect(asset.source.startsWith("docs/")).toBe(true);
    }
  });

  it("passes when the committed copy matches its source", () => {
    const results = inspectDerivatives(process.cwd());
    for (const result of results) expect(result.problems).toEqual([]);
  });

  it("fails a missing copy and a drifted copy", () => {
    const root = mkdtempSync(join(tmpdir(), "demo-derivative-"));
    try {
      mkdirSync(join(root, "docs"), { recursive: true });
      mkdirSync(join(root, "public"), { recursive: true });
      const gif = buildGif({ frames: 1 });
      const asset = { path: "public/landing-demo-tour.gif", source: "docs/bookmarkforge-demo-tour.gif", kind: "gif" };
      writeFileSync(join(root, asset.source), Buffer.from(gif));

      expect(describeDerivative(asset, root).state).toBe("missing");

      writeFileSync(join(root, asset.path), Buffer.from([...gif, 0x00]));
      const longer = describeDerivative(asset, root);
      expect(longer.state).toBe("drifted");
      expect(longer.detail).toMatch(/longer than its source/);

      writeFileSync(join(root, asset.path), Buffer.from(gif.slice(0, gif.length - 1)));
      const truncated = describeDerivative(asset, root);
      expect(truncated.state).toBe("drifted");
      expect(truncated.detail).toMatch(/truncated at/);

      writeFileSync(join(root, asset.path), Buffer.from(gif));
      expect(describeDerivative(asset, root).state).toBe("in-sync");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
