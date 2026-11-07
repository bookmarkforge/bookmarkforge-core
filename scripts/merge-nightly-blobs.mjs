#!/usr/bin/env node
/**
 * scripts/merge-nightly-blobs.mjs
 *
 * Resilient merge of Playwright blob reports for the nightly sharded suites
 * (human-like, multiuser, ...). Called from the nightly.yml merge jobs after
 * download-artifact collects the per-shard blob reports into BLOBS_DIR.
 *
 * A shard that is cancelled before its run step produces NO blob report, and
 * a shard that fails mid-run may still upload a partial set. `playwright
 * merge-reports` requires the FULL set of shard blobs to build one unified
 * HTML report, so naively invoking it on an empty or partial directory fails
 * the merge job — even though the failing shard already failed its own job
 * and the nightly is already red. This script degrades gracefully instead:
 *
 *   - 0 blob reports found            → skip the merge, log a notice, exit 0
 *   - >0 but < EXPECTED_SHARDS        → skip the merge, log a warning, exit 0
 *                                       (the missing shard's failure is the
 *                                       signal; no point failing the merge too)
 *   - == EXPECTED_SHARDS              → run `playwright merge-reports`; its
 *                                       exit code is propagated (a real merge
 *                                       failure MUST fail the merge job)
 *   - > EXPECTED_SHARDS               → run the merge anyway (extra shards are
 *                                       tolerated; the count is advisory)
 *
 * The decision is written to MERGE_STATUS_FILE as structured JSON so the
 * workflow can upload it as evidence alongside (or instead of) the report.
 *
 * Environment:
 *   BLOBS_DIR          directory with downloaded blob reports (default "blobs")
 *   EXPECTED_SHARDS    number of shards the matrix should have produced
 *                      (required — no default, to force explicit wiring)
 *   MERGE_STATUS_FILE  path for the decision JSON (default "merge-status.json")
 *   PLAYWRIGHT_REPORTER  extra merge-reports reporter flags, e.g. "line"
 *                      (default "html")
 *
 * Exit codes:
 *   0  merged OK, or skipped gracefully (nothing/incomplete to merge)
 *   1  playwright merge-reports genuinely failed (real error, not a gap)
 *   2  missing/invalid EXPECTED_SHARDS (wiring error — should fail loudly)
 */
import { existsSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

// A Playwright blob report is a directory whose name starts with "report-"
// (e.g. "report-0123456789abcdef.zip" is extracted to a dir by
// download-artifact with merge-multiple). Count any entry that looks like a
// report: a directory containing a "report.json" or a "*.zip" file.
export async function countBlobs(blobsDir) {
  if (!existsSync(blobsDir)) return 0;
  const entries = await readdir(blobsDir, { withFileTypes: true });
  let count = 0;
  for (const entry of entries) {
    const full = `${blobsDir}/${entry.name}`;
    if (entry.isDirectory()) {
      // Extracted blob report dirs (download-artifact merge-multiple flattens
      // the original report.zip into a folder named after the artifact).
      if (existsSync(`${full}/report.json`)) count += 1;
    } else if (entry.name.endsWith(".zip") || entry.name.endsWith(".json")) {
      count += 1;
    }
  }
  return count;
}

// Decide what to do given how many blobs we have vs how many we expect.
export function decideMerge(found, expected) {
  if (expected <= 0) return { action: "error", reason: "expected shards must be a positive integer" };
  if (found === 0) return { action: "skip", reason: "no blob reports found (shards cancelled before run?)" };
  if (found < expected) {
    return {
      action: "skip",
      reason: `incomplete blob set: found ${found}/${expected} (a shard failed or was cancelled — its own job already reports the failure)`,
    };
  }
  return { action: "merge", reason: `complete blob set: ${found}/${expected}` };
}

// Invoke the local Playwright CLI directly (node …/cli.js): `npx` resolves to
// a .cmd shim on Windows and spawnSync cannot exec it reliably. The CLI is
// always present after `npm ci` in the merge job.
export function runMerge({ blobsDir, reporter = "html" }) {
  const cli = fileURLToPath(new URL("../node_modules/playwright/cli.js", import.meta.url));
  const result = spawnSync(process.execPath, [cli, "merge-reports", "--reporter", reporter, blobsDir], {
    stdio: "inherit",
  });
  return result.status ?? 1;
}

export async function main(options = {}) {
  const env = options.env ?? process.env;
  const blobsDir = (env.BLOBS_DIR ?? "blobs").replace(/\/+$/, "");
  const statusFile = env.MERGE_STATUS_FILE ?? "merge-status.json";
  const reporter = env.PLAYWRIGHT_REPORTER ?? "html";

  const expectedRaw = env.EXPECTED_SHARDS?.trim();
  if (!expectedRaw || !/^\d+$/.test(expectedRaw) || Number(expectedRaw) <= 0) {
    const status = { merged: false, skipped: false, reason: "invalid EXPECTED_SHARDS (wiring error)" };
    writeFileSync(statusFile, JSON.stringify(status, null, 2));
    console.error(JSON.stringify({ event: "nightly_merge_invalid_expected", reason: status.reason }));
    return 2;
  }
  const expected = Number(expectedRaw);

  const found = await countBlobs(blobsDir);
  const decision = decideMerge(found, expected);
  console.error(JSON.stringify({ event: "nightly_merge_decision", blobsDir, found, expected, ...decision }));

  if (decision.action === "skip") {
    const status = { merged: false, skipped: true, found, expected, reason: decision.reason };
    writeFileSync(statusFile, JSON.stringify(status, null, 2));
    return 0;
  }

  if (decision.action === "error") {
    writeFileSync(statusFile, JSON.stringify({ merged: false, skipped: false, found, expected, reason: decision.reason }, null, 2));
    return 2;
  }

  const mergeStatus = runMerge({ blobsDir, reporter });
  const status = {
    merged: mergeStatus === 0,
    skipped: false,
    found,
    expected,
    reason: decision.reason,
    mergeExitCode: mergeStatus,
  };
  writeFileSync(statusFile, JSON.stringify(status, null, 2));
  return mergeStatus;
}

const IS_CLI = Boolean(process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url);
if (IS_CLI) {
  main().then((code) => {
    process.exitCode = code;
  });
}
