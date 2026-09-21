#!/usr/bin/env node
/**
 * scripts/publish-demo-media.mjs
 *
 * Copies the demo media that the marketing site serves from `public/`.
 *
 * `docs/` is the single source of truth of the media pipeline: that is where
 * the GIF builder, the video builder, the drift comparison and the nightly
 * artifact all read and write. The landing, however, can only serve what lives
 * under `public/`. Rather than regenerate the media twice, this script copies
 * the declared derivatives and `check:demo-media` fails when a copy drifts
 * from its source, so the landing can never show a stale tour.
 *
 * Usage:
 *   node scripts/publish-demo-media.mjs            # write the copies
 *   node scripts/publish-demo-media.mjs --check     # verify without writing
 *
 * Exit 0 = copies in place (or verified); 1 = drift or missing source.
 */
import { copyFileSync, existsSync, readFileSync, statSync, mkdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { PUBLISHED_DERIVATIVES, findFirstDifference } from "./check-demo-media.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const options = { check: false };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === "--check") options.check = true;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return options;
}

/** Human-readable state of one derivative, without writing anything. */
export function describeDerivative(asset, root) {
  const sourcePath = resolve(root, asset.source);
  const targetPath = resolve(root, asset.path);
  if (!existsSync(sourcePath)) {
    return { label: asset.path, state: "missing-source", detail: `${asset.source} does not exist` };
  }
  if (!existsSync(targetPath)) {
    return { label: asset.path, state: "missing", detail: "not published yet" };
  }
  const sourceBytes = readFileSync(sourcePath);
  const targetBytes = readFileSync(targetPath);
  const offset = findFirstDifference(sourceBytes, targetBytes);
  if (offset === -1) {
    return { label: asset.path, state: "in-sync", detail: `${targetBytes.length} bytes` };
  }
  const shared = Math.min(sourceBytes.length, targetBytes.length);
  return {
    label: asset.path,
    state: "drifted",
    detail:
      offset === shared
        ? `${targetBytes.length < sourceBytes.length ? "truncated at" : "longer than its source:"} ${targetBytes.length} of ${sourceBytes.length} bytes`
        : `differs at byte ${offset}`,
  };
}

function main() {
  const options = parseArgs(process.argv);
  const states = PUBLISHED_DERIVATIVES.map((asset) => ({ asset, state: describeDerivative(asset, REPO_ROOT) }));
  const failures = [];

  for (const { asset, state } of states) {
    if (state.state === "missing-source") {
      failures.push(`${state.label}: source ${asset.source} does not exist`);
      continue;
    }
    if (options.check) {
      const ok = state.state === "in-sync";
      console.log(`${ok ? "ok  " : "FAIL"} ${state.label} — ${state.detail}`);
      if (!ok) failures.push(`${state.label}: ${state.detail} (fix: npm run demo:publish)`);
      continue;
    }
    const targetPath = resolve(REPO_ROOT, asset.path);
    mkdirSync(dirname(targetPath), { recursive: true });
    copyFileSync(resolve(REPO_ROOT, asset.source), targetPath);
    console.log(
      `wrote ${asset.path} — ${(statSync(targetPath).size / 1024).toFixed(0)} KiB from ${asset.source}`,
    );
  }

  if (failures.length > 0) {
    console.error(`[publish-demo-media] FAIL — ${failures.length} derived asset(s) out of sync:`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  if (options.check) {
    console.log(
      `[publish-demo-media] ok: ${states.length} published derivative(s) match their source (${relative(process.cwd(), REPO_ROOT) || "."})`,
    );
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href) {
  try {
    main();
  } catch (error) {
    console.error("[publish-demo-media] FAIL:", error?.message ?? error);
    process.exit(1);
  }
}
