#!/usr/bin/env node
/**
 * scripts/check-license-mirror-sync.mjs — license mirror drift gate.
 *
 * Fails when a declared api/ ↔ server/ license mirror has drifted (see
 * scripts/license-mirror-contract.mjs for the pair list and rationale).
 * Offline by contract: it reads the shipped sources only.
 *
 * Usage: node scripts/check-license-mirror-sync.mjs
 * Exit 0 clean, 1 on missing files or drift.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assessLicenseMirrors, MIRROR_PAIRS } from "./license-mirror-contract.mjs";

const ROOT = process.cwd();

const files = {};
for (const pair of MIRROR_PAIRS) {
  for (const path of [pair.apiPath, pair.serverPath]) {
    const abs = join(ROOT, path);
    files[path] = existsSync(abs) ? readFileSync(abs, "utf8") : undefined;
  }
}

const results = assessLicenseMirrors(files);
let failed = false;

for (const result of results) {
  if (result.status === "ok") {
    console.log(
      `[check-license-mirror-sync] OK: ${result.label} mirror in sync (${result.apiPath} ↔ ${result.serverPath})`,
    );
    continue;
  }
  failed = true;
  if (result.status === "missing") {
    console.error(
      `[check-license-mirror-sync] FAIL: ${result.label} mirror file missing — expected both ${result.apiPath} and ${result.serverPath}`,
    );
  } else {
    console.error(
      `[check-license-mirror-sync] FAIL: ${result.label} mirror drift — ${result.apiPath} and ${result.serverPath} differ outside comments. Re-sync the copy (comments may differ; code must not).`,
    );
  }
}

if (failed) {
  console.error(
    "[check-license-mirror-sync] License mirror contract violated. The api/ copy ships without server/, so seat accounting and signing canonicalization MUST stay identical.",
  );
  process.exit(1);
}

console.log(
  `[check-license-mirror-sync] PASS — ${results.length} license mirror pair(s) in sync`,
);
