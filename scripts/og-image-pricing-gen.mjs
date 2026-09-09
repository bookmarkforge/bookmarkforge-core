#!/usr/bin/env node
/**
 * scripts/og-image-pricing-gen.mjs — regenerate the pricing social-share card.
 *
 * Source of truth is public/og-image-pricing.svg (the canonical, reviewable
 * artwork). Running this script renders it to public/og-image-pricing.png
 * (1200x630, brand-navy, cyan accents, real BookmarkForge logo embedded in
 * the SVG as a data URI). The PNG is purely a render target for social
 * platforms that don't consume SVG OG images.
 *
 * Idempotent by construction: re-rendering the same SVG produces the same PNG
 * (sharp is deterministic for the same input + same libvips/sharp version;
 * the on-disk PNG is byte-identical across runs on the same machine).
 *
 * Usage: node scripts/og-image-pricing-gen.mjs   (from the repo root)
 *
 * Requires: sharp (devDependency). Fails fast with a clear message if missing.
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, existsSync, writeFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);


const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SVG_PATH = resolve(ROOT, "public", "og-image-pricing.svg");
const PNG_PATH = resolve(ROOT, "public", "og-image-pricing.png");

if (!existsSync(SVG_PATH)) {
  console.error(
    `ERROR: ${SVG_PATH} does not exist. The pricing card can't be rendered ` +
      `without its source SVG. Put public/og-image-pricing.svg back in place ` +
      `and re-run.`,
  );
  process.exit(2);
}

// Guard: if sharp isn't installed, print the exact install command the repo
// uses (package manager is detected from lockfile presence, falling back to
// npm) and exit non-zero so CI surfaces the gap instead of a cryptic ENOENT.
function requireSharp() {
  try {
    // eslint-disable-next-line node/no-missing-require -- dynamic require
    // for a dep that may be absent; guarded by the try/catch below.
    return require("sharp");
  } catch (err) {
    const hasPnpmLock = existsSync(resolve(ROOT, "pnpm-lock.yaml"));
    const hasYarnLock = existsSync(resolve(ROOT, "yarn.lock"));
    const hasBunLock = existsSync(resolve(ROOT, "bun.lockb"));
    const pm =
      hasBunLock && hasPnpmLock
        ? "bun or pnpm"
        : hasBunLock
          ? "bun"
          : hasYarnLock
            ? "yarn"
            : hasPnpmLock
              ? "pnpm"
              : "npm";
    console.error(
      "ERROR: sharp is not installed. The pricing-card generator depends on it.\n" +
        `Run: ${pm} install sharp` +
        (pm === "npm" ? " --save-dev" : ""),
    );
    process.exit(2);
  }
}

try {
  const sharpLib = requireSharp();
  const svg = readFileSync(SVG_PATH);
  const out = await sharpLib(svg).png().toBuffer();

  writeFileSync(PNG_PATH, out);

  const before = statSync(PNG_PATH).size;
  console.log(
    `Rendered ${PNG_PATH} (${before} bytes, 1200x630) from ${SVG_PATH}.`,
  );
} catch (err) {
  console.error(
    `ERROR: failed to render ${SVG_PATH} -> ${PNG_PATH}: ${err.message}`,
  );
  process.exit(2);
}
