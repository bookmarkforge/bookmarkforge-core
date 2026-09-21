#!/usr/bin/env node
/**
 * Compares freshly captured demo media against the committed reference.
 *
 * The nightly media job regenerates the stills from the current UI and asks one
 * question: does the product still look like the images the README publishes?
 * When it does not, the media is stale and a human has to look at the result and
 * commit it.
 *
 * The comparison is pixel-based with a tolerance, not a byte comparison. Two
 * captures of an identical UI can differ in antialiasing, scrollbar rendering
 * or a single ASCII spinner frame; failing on that would make the job noise and
 * the job would be muted. A real UI change moves millions of pixels, so a
 * ratio threshold separates "regenerated, same product" from "the product
 * changed".
 *
 * Usage:
 *   node scripts/compare-demo-media.mjs --reference docs --generated <dir>
 *   node scripts/compare-demo-media.mjs --reference docs --generated <dir> --json
 *   node scripts/compare-demo-media.mjs --reference docs --generated <dir> --max-diff-ratio 0.01
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

/**
 * Defaults calibrated on repeated captures of an unchanged UI (see
 * docs/demo-media.md for the measurements).
 *
 * Two independent captures of the same UI differ by 0.006% of pixels at worst
 * since the demo clock is pinned, while a simulated layout change moves 8.13%.
 * 0.10% keeps an order of magnitude of headroom over the noise and still fails
 * on a change of a few thousand pixels, such as a rewritten label.
 */
export const DRIFT_DEFAULTS = {
  maxDiffRatio: 0.001,
  pixelThreshold: 0.12,
};

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested in scripts/__tests__/demo-media.test.mjs)
// ---------------------------------------------------------------------------

/**
 * Pixel difference between two PNG buffers.
 *
 * Images of different sizes are reported as a complete mismatch: the layout
 * changed, which is never a rendering detail.
 */
export function comparePngBuffers(referenceBuffer, generatedBuffer, { pixelThreshold } = {}) {
  const reference = PNG.sync.read(referenceBuffer);
  const generated = PNG.sync.read(generatedBuffer);

  if (reference.width !== generated.width || reference.height !== generated.height) {
    return {
      width: generated.width,
      height: generated.height,
      referenceWidth: reference.width,
      referenceHeight: reference.height,
      dimensionMismatch: true,
      diffPixels: reference.width * reference.height,
      totalPixels: reference.width * reference.height,
      ratio: 1,
    };
  }

  const total = reference.width * reference.height;
  const diffPixels = pixelmatch(
    reference.data,
    generated.data,
    null,
    reference.width,
    reference.height,
    { threshold: pixelThreshold ?? DRIFT_DEFAULTS.pixelThreshold },
  );
  return {
    width: reference.width,
    height: reference.height,
    referenceWidth: reference.width,
    referenceHeight: reference.height,
    dimensionMismatch: false,
    diffPixels,
    totalPixels: total,
    ratio: total === 0 ? 0 : diffPixels / total,
  };
}

/** Turns one comparison into a verdict against the drift budget. */
export function evaluateDrift({ name, comparison, maxDiffRatio }) {
  const problems = [];
  if (comparison.dimensionMismatch) {
    problems.push(
      `${name}: size changed from ${comparison.referenceWidth}x${comparison.referenceHeight} ` +
        `to ${comparison.width}x${comparison.height}`,
    );
  } else if (comparison.ratio > maxDiffRatio) {
    problems.push(
      `${name}: ${(comparison.ratio * 100).toFixed(2)}% of pixels differ ` +
        `(${comparison.diffPixels} of ${comparison.totalPixels}, budget ${(maxDiffRatio * 100).toFixed(2)}%)`,
    );
  }
  return { name, ok: problems.length === 0, problems, comparison };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const options = { reference: "docs", generated: null, json: false, ...DRIFT_DEFAULTS };
  for (let i = 2; i < argv.length; i++) {
    switch (argv[i]) {
      case "--reference":
        options.reference = argv[++i];
        break;
      case "--generated":
        options.generated = argv[++i];
        break;
      case "--max-diff-ratio":
        options.maxDiffRatio = Number(argv[++i]);
        break;
      case "--pixel-threshold":
        options.pixelThreshold = Number(argv[++i]);
        break;
      case "--json":
        options.json = true;
        break;
      default:
        throw new Error(`Unknown argument: ${argv[i]}`);
    }
  }
  if (!options.generated) throw new Error("--generated <dir> is required");
  if (!Number.isFinite(options.maxDiffRatio) || options.maxDiffRatio < 0) {
    throw new Error("--max-diff-ratio must be a non-negative number");
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv);
  const referenceDir = resolve(options.reference);
  const generatedDir = resolve(options.generated);

  if (!existsSync(generatedDir)) {
    console.error(`[compare-demo-media] FAIL: ${options.generated} does not exist`);
    process.exit(1);
  }
  const generated = readdirSync(generatedDir)
    .filter((name) => name.toLowerCase().endsWith(".png"))
    .sort();
  if (generated.length === 0) {
    console.error(`[compare-demo-media] FAIL: no PNG captures in ${options.generated}`);
    process.exit(1);
  }

  const results = [];
  for (const name of generated) {
    const referencePath = join(referenceDir, name);
    if (!existsSync(referencePath)) {
      results.push({
        name,
        ok: false,
        problems: [`${name}: no committed reference image to compare against`],
        comparison: null,
      });
      continue;
    }
    const comparison = comparePngBuffers(
      readFileSync(referencePath),
      readFileSync(join(generatedDir, name)),
      { pixelThreshold: options.pixelThreshold },
    );
    results.push(evaluateDrift({ name, comparison, maxDiffRatio: options.maxDiffRatio }));
  }

  const failures = results.filter((result) => !result.ok);
  const worst = results
    .filter((result) => result.comparison && !result.comparison.dimensionMismatch)
    .sort((a, b) => b.comparison.ratio - a.comparison.ratio)[0];

  if (options.json) {
    console.log(
      JSON.stringify(
        { reference: options.reference, generated: options.generated, results, ok: failures.length === 0 },
        null,
        2,
      ),
    );
  } else {
    console.log(
      `[compare-demo-media] ${results.length} capture(s) vs ${options.reference} ` +
        `(budget ${(options.maxDiffRatio * 100).toFixed(2)}% of pixels)`,
    );
    for (const result of results) {
      const detail = result.comparison
        ? `${(result.comparison.ratio * 100).toFixed(3)}%`
        : "no reference";
      console.log(`  ${result.ok ? "same" : "DRIFT"} ${result.name} — ${detail}`);
      for (const problem of result.problems) console.log(`       ${problem}`);
    }
    if (worst) console.log(`  worst: ${worst.name} at ${(worst.comparison.ratio * 100).toFixed(3)}%`);
  }

  if (failures.length > 0) {
    console.error(
      `[compare-demo-media] FAIL — the demo media is stale for ${failures.length} file(s).\n` +
        "The UI changed: review the artifacts uploaded by this job and commit the regenerated media\n" +
        "(npm run demo:capture-screens, npm run demo:build-gif) or fix the regression that changed it.",
    );
    process.exitCode = 1;
    return;
  }
  // In --json mode stdout stays parseable: the caller reads exactly one JSON
  // document, and human messages go to stderr.
  if (!options.json) {
    console.log("[compare-demo-media] the committed demo media still matches the current UI");
  }

}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error("[compare-demo-media] FAIL:", error?.message ?? error);
    process.exit(1);
  }
}
