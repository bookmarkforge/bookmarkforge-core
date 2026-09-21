#!/usr/bin/env node
/**
 * Gate for the demo media published with the README.
 *
 * Two failure modes matter for an asset that every README visitor downloads,
 * and neither is visible in a code review:
 *
 *   1. GROWTH — a regenerated GIF or screenshot quietly doubles in size. The
 *      bytes are never reviewed, so nothing stops it.
 *   2. TRUNCATION — a file that was written halfway still has a plausible size
 *      and a valid magic number, and only breaks in the browser.
 *
 * So each declared asset gets a byte budget AND a real container check: GIF is
 * walked block by block (screen descriptor, colour tables, extension and image
 * blocks, trailer), PNG is read from its IHDR, WebM from its EBML header.
 *
 * The budgets are deliberately loose enough for a legitimate regeneration and
 * tight enough that a regression cannot hide.
 *
 * Usage:
 *   node scripts/check-demo-media.mjs                    # committed media set
 *   node scripts/check-demo-media.mjs --root <dir>       # same set elsewhere
 *   node scripts/check-demo-media.mjs --gif <file>       # one freshly built GIF
 *   node scripts/check-demo-media.mjs --json
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { probeWebm } from "./build-demo-video.mjs";

// ---------------------------------------------------------------------------
// Budgets (single source of truth: the GIF builder enforces the same value)
// ---------------------------------------------------------------------------

export const GIF_BUDGET = {
  maxBytes: 150_000,
  maxWidth: 1280,
  maxHeight: 1280,
  // A tour GIF that does not move, or that lost its trailer, is broken even if
  // its size looks fine.
  minFrames: 2,
  requireLoopExtension: true,
};

export const DEMO_MEDIA_ASSETS = [
  { path: "docs/bookmarkforge-demo-tour.gif", kind: "gif", budget: GIF_BUDGET },
  { path: "docs/bookmarkforge-demo-tour.webm", kind: "webm", budget: { maxBytes: 3_000_000 } },
  {
    path: "docs/bookmarkforge-demo-tour-poster.png",
    kind: "png",
    budget: { maxBytes: 600_000, maxWidth: 1280, maxHeight: 720 },
  },
  { path: "docs/bookmarkforge-demo-app.png", kind: "png", budget: { maxBytes: 400_000 } },
  { path: "docs/bookmarkforge-demo-capture.png", kind: "png", budget: { maxBytes: 400_000 } },
  { path: "docs/bookmarkforge-demo-bookmarks.png", kind: "png", budget: { maxBytes: 400_000 } },
  { path: "docs/bookmarkforge-demo-search.png", kind: "png", budget: { maxBytes: 400_000 } },
  { path: "docs/bookmarkforge-demo-locked.png", kind: "png", budget: { maxBytes: 400_000 } },
  { path: "docs/bookmarkforge-demo-mobile-secure.png", kind: "png", budget: { maxBytes: 400_000 } },
  { path: "docs/bookmarkforge-demo-mobile-dashboard.png", kind: "png", budget: { maxBytes: 400_000 } },
  { path: "docs/bookmarkforge-demo-mobile-capture.png", kind: "png", budget: { maxBytes: 400_000 } },
  { path: "docs/bookmarkforge-demo-landing-hero.png", kind: "png", budget: { maxBytes: 400_000 } },
];

/**
 * Landing copies of the documentation media.
 *
 * The marketing site can only serve files that live under `public/`, while
 * `docs/` stays the single source of truth of the media pipeline (generation,
 * budgets, drift comparison, nightly artifact). A copy that nobody checks is
 * how the landing ends up showing a GIF the pipeline no longer produces, so
 * every derivative named here is compared byte for byte against its source.
 *
 * Refresh with `npm run demo:publish`.
 */
export const PUBLISHED_DERIVATIVES = [
  {
    path: "public/landing-demo-tour.gif",
    source: "docs/bookmarkforge-demo-tour.gif",
    kind: "gif",
    budget: GIF_BUDGET,
  },
];

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested in scripts/__tests__/demo-media.test.mjs)
// ---------------------------------------------------------------------------

/**
 * Walks a GIF89a stream block by block.
 *
 * A size check alone cannot tell a complete GIF from one that lost its last
 * half, so this walks the real structure: header, logical screen descriptor,
 * optional global colour table, then every extension and image block via their
 * sub-block chains, ending at the trailer.
 */
export function parseGifSummary(buffer) {
  const problems = [];
  const read16 = (offset) => buffer[offset] | (buffer[offset + 1] << 8);

  if (buffer.length < 13) {
    return { ok: false, problems: ["file is smaller than a GIF header"], frames: 0 };
  }
  const version = buffer.subarray(0, 6).toString("latin1");
  if (version !== "GIF87a" && version !== "GIF89a") {
    return { ok: false, problems: [`not a GIF stream (magic "${version}")`], frames: 0 };
  }

  const width = read16(6);
  const height = read16(8);
  const packed = buffer[10];
  let offset = 13;
  if (packed & 0x80) offset += 3 * 2 ** ((packed & 0x07) + 1);

  let frames = 0;
  let hasLoopExtension = false;
  let hasTrailer = false;
  let truncated = false;

  const skipSubBlocks = () => {
    while (offset < buffer.length) {
      const size = buffer[offset];
      offset += 1 + size;
      if (size === 0) return true;
    }
    return false;
  };

  while (offset < buffer.length) {
    const marker = buffer[offset];
    if (marker === 0x3b) {
      hasTrailer = true;
      break;
    }
    if (marker === 0x21) {
      const label = buffer[offset + 1];
      offset += 2;
      if (label === 0xff) {
        const size = buffer[offset];
        const identifier = buffer.subarray(offset + 1, offset + 1 + size).toString("latin1");
        if (identifier.startsWith("NETSCAPE")) hasLoopExtension = true;
      }
      if (!skipSubBlocks()) {
        truncated = true;
        break;
      }
      continue;
    }
    if (marker === 0x2c) {
      if (offset + 10 > buffer.length) {
        truncated = true;
        break;
      }
      frames += 1;
      const localPacked = buffer[offset + 9];
      offset += 10;
      if (localPacked & 0x80) offset += 3 * 2 ** ((localPacked & 0x07) + 1);
      offset += 1; // LZW minimum code size
      if (!skipSubBlocks()) {
        truncated = true;
        break;
      }
      continue;
    }
    problems.push(`unexpected block marker 0x${marker.toString(16).padStart(2, "0")}`);
    break;
  }

  if (truncated) problems.push("stream ends inside a block (truncated file)");
  if (!hasTrailer) problems.push("GIF trailer (0x3b) not reached");

  return {
    ok: problems.length === 0,
    problems,
    version,
    width,
    height,
    frames,
    hasLoopExtension,
    hasTrailer,
  };
}

/** Reads width/height from a PNG IHDR chunk without decoding pixels. */
export function parsePngDimensions(buffer) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buffer.length < 24 || !signature.every((byte, index) => buffer[index] === byte)) {
    return null;
  }
  const chunkType = buffer.subarray(12, 16).toString("latin1");
  if (chunkType !== "IHDR") return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/** Applies one asset's budget and structure findings to a verdict. */
export function evaluateAsset({ label, kind, bytes, budget = {}, structure = null, derivative = null }) {
  const problems = [];
  if (derivative && !derivative.ok) problems.push(...derivative.problems);
  if (!Number.isFinite(bytes)) problems.push(`${label}: file is missing`);
  if (Number.isFinite(budget.maxBytes) && bytes > budget.maxBytes) {
    problems.push(
      `${label}: ${bytes} bytes exceeds the ${budget.maxBytes}-byte budget by ${bytes - budget.maxBytes}`,
    );
  }
  if (structure && structure.ok === false) {
    for (const problem of structure.problems) problems.push(`${label}: ${problem}`);
  }
  const dimensions = structure?.width ? structure : null;
  if (dimensions && budget.maxWidth && dimensions.width > budget.maxWidth) {
    problems.push(`${label}: width ${dimensions.width} exceeds ${budget.maxWidth}`);
  }
  if (dimensions && budget.maxHeight && dimensions.height > budget.maxHeight) {
    problems.push(`${label}: height ${dimensions.height} exceeds ${budget.maxHeight}`);
  }
  if (kind === "gif" && structure?.ok) {
    if (budget.minFrames && structure.frames < budget.minFrames) {
      problems.push(`${label}: ${structure.frames} frame(s), expected at least ${budget.minFrames}`);
    }
    if (budget.requireLoopExtension && !structure.hasLoopExtension) {
      problems.push(`${label}: missing NETSCAPE looping extension`);
    }
  }
  return { label, kind, bytes, ok: problems.length === 0, problems, structure };
}

/**
 * First byte where two buffers differ, or -1 when they are identical.
 *
 * Returns the shared length when one is a prefix of the other, so a truncated
 * copy reports where it stopped instead of "looks equal".
 */
export function findFirstDifference(left, right) {
  const shared = Math.min(left.length, right.length);
  for (let i = 0; i < shared; i += 1) {
    if (left[i] !== right[i]) return i;
  }
  return left.length === right.length ? -1 : shared;
}

/**
 * Compares a published copy with the documentation file it is derived from.
 * Pure so the drift verdict can be unit-tested without the filesystem.
 */
/** Reads one asset from disk and evaluates it. */
export function inspectAsset(asset, root) {
  const path = resolve(root, asset.path);
  if (!existsSync(path)) {
    return evaluateAsset({ label: asset.path, kind: asset.kind, bytes: Number.NaN, budget: asset.budget });
  }
  const buffer = readFileSync(path);
  let structure = null;
  if (asset.kind === "gif") structure = parseGifSummary(buffer);
  if (asset.kind === "png") {
    const dimensions = parsePngDimensions(buffer);
    structure = dimensions
      ? { ok: true, problems: [], ...dimensions }
      : { ok: false, problems: ["not a PNG stream (missing IHDR signature)"], width: null, height: null };
  }
  if (asset.kind === "webm") structure = probeWebm(buffer);
  return evaluateAsset({
    label: asset.path,
    kind: asset.kind,
    bytes: statSync(path).size,
    budget: asset.budget,
    structure,
    derivative: asset.source ? comparePublishedCopy(asset, root) : null,
  });
}

/** Inspects every published derivative declared above. */
export function inspectDerivatives(root) {
  return PUBLISHED_DERIVATIVES.map((asset) =>
    inspectAsset({ ...asset, budget: { ...asset.budget, maxBytes: undefined } }, root),
  );
}

/** Byte-for-byte comparison between a published copy and its source. */
function comparePublishedCopy(asset, root) {
  const sourcePath = resolve(root, asset.source);
  const targetPath = resolve(root, asset.path);
  const sourceBytes = existsSync(sourcePath) ? readFileSync(sourcePath) : null;
  const targetBytes = existsSync(targetPath) ? readFileSync(targetPath) : null;
  if (!sourceBytes || !targetBytes) {
    return {
      ok: false,
      problems: [
        sourceBytes
          ? `${asset.path}: missing copy of ${asset.source} — run npm run demo:publish`
          : `${asset.path}: source ${asset.source} is missing`,
      ],
    };
  }
  const offset = findFirstDifference(sourceBytes, targetBytes);
  if (offset === -1) return { ok: true, problems: [] };
  const shared = Math.min(sourceBytes.length, targetBytes.length);
  return {
    ok: false,
    problems: [
      offset === shared
        ? `${asset.path}: copy of ${asset.source} is ${
            targetBytes.length < sourceBytes.length
              ? `truncated (${targetBytes.length} of ${sourceBytes.length} bytes)`
              : `longer than its source (${targetBytes.length} of ${sourceBytes.length} bytes)`
          } — run npm run demo:publish`
        : `${asset.path}: differs from ${asset.source} at byte ${offset} — run npm run demo:publish`,
    ],
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const options = { root: ".", gif: null, json: false };
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case "--root":
        options.root = argv[++i];
        break;
      case "--gif":
        options.gif = argv[++i];
        break;
      case "--json":
        options.json = true;
        break;
      default:
        throw new Error(`Unknown argument: ${argv[i]}`);
    }
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv);
  const root = resolve(options.root);

  let results;
  let title;
  if (options.gif) {
    const gifPath = resolve(options.gif);
    if (!existsSync(gifPath)) {
      console.error(`[check-demo-media] FAIL: ${options.gif} does not exist`);
      process.exit(1);
    }
    const displayPath = relative(process.cwd(), gifPath).replaceAll("\\", "/");
    const inspected = inspectAsset(
      { path: gifPath, kind: "gif", budget: GIF_BUDGET },
      process.cwd(),
    );
    results = [{ ...inspected, label: displayPath }];
    title = `freshly built GIF ${displayPath}`;
  } else {
    results = [
      ...DEMO_MEDIA_ASSETS.map((asset) => inspectAsset(asset, root)),
      ...inspectDerivatives(root),
    ];
    title = `committed media set under ${relative(process.cwd(), root) || "."}`;
  }

  const failures = results.filter((result) => !result.ok);
  if (options.json) {
    console.log(JSON.stringify({ title, results, ok: failures.length === 0 }, null, 2));
  } else {
    console.log(`[check-demo-media] ${title} (${results.length} asset(s))`);
    for (const result of results) {
      const size = Number.isFinite(result.bytes) ? `${(result.bytes / 1024).toFixed(0)} KiB` : "missing";
      const structure = result.structure?.frames
        ? ` · ${result.structure.frames} frames ${result.structure.width}x${result.structure.height}`
        : result.structure?.width
          ? ` · ${result.structure.width}x${result.structure.height}`
          : "";
      console.log(`  ${result.ok ? "ok  " : "FAIL"} ${result.label} — ${size}${structure}`);
      for (const problem of result.problems) console.log(`       ${problem}`);
    }
  }

  if (failures.length > 0) {
    console.error(`[check-demo-media] FAIL — ${failures.length} asset(s) outside budget, structure or out of sync with their source`);
    process.exitCode = 1;
    return;
  }
  // In --json mode stdout stays parseable: exactly one JSON document.
  if (!options.json) {
    console.log("[check-demo-media] all demo assets within budget and structurally valid");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error("[check-demo-media] FAIL:", error?.message ?? error);
    process.exit(1);
  }
}
