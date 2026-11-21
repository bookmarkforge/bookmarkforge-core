#!/usr/bin/env node
/**
 * scripts/check-no-pro-history.mjs
 *
 * Fails when the PUBLIC export's git HISTORY still contains a proprietary (Pro)
 * implementation — not just when the working tree does.
 *
 * C2 (2026-10-20 audit): `bookmarkforge/bookmarkforge-core` shipped five Pro
 * modules (`SyncService.ts`, `sync/signaling.ts`, `sync/replication.ts`,
 * `webrtc-sync/protocol.ts`, `webrtc-sync/validation.ts`) in nine commits.
 * `check:open-core` only ever looked at the working tree, so deleting the files
 * in a new commit made it green while the code stayed readable at the old
 * revisions, in every clone and in the GitHub UI.
 *
 * The primitives live in `./pro-history-check.mjs` and are shared with the local
 * verifier `.devin/scrub-public-export-history.mjs`, so the CI gate and the
 * operator tool cannot disagree about what "still contains Pro code" means.
 *
 * Requires FULL history (`actions/checkout` with `fetch-depth: 0`). A shallow
 * clone fails closed instead of reporting a clean history it cannot see.
 *
 * Usage: node scripts/check-no-pro-history.mjs [repoDir]
 * Exit codes: 0 = clean (or private tree), 1 = Pro code reachable in history.
 */
import process from "node:process";
import { resolve } from "node:path";
import {
  PRO_MODULE_PATHS,
  historyHits,
  isExportTree,
  isGitRepo,
  isShallowClone,
} from "./pro-history-check.mjs";

const ROOT = resolve(process.argv[2] ?? ".");

if (!isExportTree(ROOT)) {
  console.log(
    "[check-no-pro-history] ok: private tree — Pro implementations are expected here; " +
      "the history boundary applies to the public export only",
  );
  process.exit(0);
}

// Fail closed: "unverifiable" is not "clean".
if (!isGitRepo(ROOT)) {
  console.error(
    "[check-no-pro-history] FAIL: this export is not a git checkout — the history " +
      "cannot be verified, and 'unverifiable' is not 'clean'",
  );
  process.exit(1);
}

if (isShallowClone(ROOT)) {
  console.error(
    "[check-no-pro-history] FAIL: shallow clone — full history is required " +
      "(actions/checkout with fetch-depth: 0); a truncated history cannot prove " +
      "that no commit ever carried Pro code",
  );
  process.exit(1);
}

const hits = historyHits(ROOT);

if (hits.length === 0) {
  console.log(
    `[check-no-pro-history] ok: none of the ${PRO_MODULE_PATHS.length} Pro path(s) ` +
      "appears in any reachable commit",
  );
  process.exit(0);
}

console.error(
  `[check-no-pro-history] FAIL: ${hits.length} commit(s) still contain Pro implementations:`,
);
for (const line of hits.slice(0, 25)) {console.error(`  - ${line}`);}
if (hits.length > 25) {console.error(`  … and ${hits.length - 25} more`);}
console.error(
  "  A new commit that deletes the files does not fix this: the old revisions stay " +
    "readable. Rewrite the history (the private repository's " +
    ".devin/PUBLIC-EXPORT-HISTORY-SCRUB.md documents the procedure) and push with " +
    "--force-with-lease.",
);
process.exit(1);
