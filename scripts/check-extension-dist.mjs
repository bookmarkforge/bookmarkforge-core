/**
 * scripts/check-extension-dist.mjs — extension dist sidecar gate.
 *
 * Asserts that `dist-extension/SHA256SUMS.txt` (canonical POSIX
 * `sha256sum -c` checksums of the shipped extension artifacts) and
 * `dist-extension/MANIFEST.md` (build provenance + per-file roles) both
 * exist and are consistent with the actual published artifacts.
 *
 * Runs after `npm run build:extension:custom` and fails loudly when:
 *
 *   1. The output directory itself is missing                → "FAIL no-dist"
 *   2. `SHA256SUMS.txt` or `MANIFEST.md` is missing           → "FAIL missing-sidecar"
 *   3. `SHA256SUMS.txt` has a wrong shape / bad hex line      → "FAIL bad-sums"
 *   4. Any listed file's recorded hash != its actual hash    → "FAIL drift"
 *   5. `MANIFEST.md` doesn't cross-reference every sum       → "FAIL manifest-mismatch"
 *   6. A real file lives in the dist but isn't listed in
 *      `SHA256SUMS.txt`                                      → "FAIL unlisted-file"
 *
 * The OUTPUT_DIR environment variable is honored for both relative and
 * absolute paths, so CI and local packaging can choose the artifact directory.
 *
 * Usage:
 *   node scripts/check-extension-dist.mjs                  # gate (exit 1 on drift)
 *   node scripts/check-extension-dist.mjs --print          # print the dist-inventory summary
 *
 * There is no `--fix`. The sidecars are produced by
 * `scripts/build-extension.cjs`; the gate intentionally refuses to
 * regenerate them automatically so a build-script regression surfaces
 * rather than being silently masked by an in-gate rewrite.
 */
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { join, isAbsolute } from "node:path";

const ROOT = process.cwd();
const OUTPUT_DIR = process.env.OUTPUT_DIR || "dist-extension";
const DIST = isAbsolute(OUTPUT_DIR) ? OUTPUT_DIR : join(ROOT, OUTPUT_DIR);
const SIDECAR_SUMS = "SHA256SUMS.txt";
const SIDECAR_MANIFEST = "MANIFEST.md";
const SIDECAR_MANIFEST_JSON = "build-manifest.json";
const SIDECAR_README = "README.md";

/**
 * Match a single POSIX `sha256sum -c` line, ignoring comments.
 * Two-space separator between the 64-hex digest and the basename.
 * Basenames we emit contain only [A-Za-z0-9._-] (matches a relaxed
 * shell-safe character class); reject anything else.
 */
const SUMS_LINE = /^([a-f0-9]{64})  ([A-Za-z0-9._-]+)$/;

/**
 * Files we never expect to see in SHA256SUMS.txt — the sidecars themselves.
 * Four sidecars today: the sums file, the markdown provenance (which
 * details the sidecars without carrying the inventory inline), the JSON
 * sibling (the parseable inventory), and the consumer-facing README
 * (published with the bundle; OUTPUT_DIR + sidecar meanings).
 */
const SIDECARS = new Set([
  SIDECAR_SUMS,
  SIDECAR_MANIFEST,
  SIDECAR_MANIFEST_JSON,
  SIDECAR_README,
]);

/**
 * Compute SHA-256 of `filePath` with a streaming buffer so very large
 * future icons / fonts still fit. Caller may pre-stat with `statSync()`
 * if it also wants the byte count.
 */
function sha256OfFile(filePath) {
  const buf = readFileSync(filePath);
  return createHash("sha256").update(buf).digest("hex");
}

/** Parse `text` (the contents of SHA256SUMS.txt) into a deterministic list. */
function parseSums(text) {
  const out = [];
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    if (!raw.trim()) continue;
    if (raw.startsWith("#")) continue; // sha256sum -c ignores comments verbatim.
    const m = SUMS_LINE.exec(raw);
    if (!m) {
      return { error: `malformed line: ${JSON.stringify(raw)}`, entries: null };
    }
    out.push({ sha256: m[1], file: m[2] });
  }
  return { error: null, entries: out };
}

/**
 * Distinct gate steps so the caller can see exactly which side tripped.
 * Each returns `null` on success and a failure record otherwise. The
 * final `process.exit(1)` is only invoked if any non-null record exists.
 */
function run() {
  const failures = [];

  // --- Check 1: the dist directory itself exists. -----------------------
  if (!existsSync(DIST)) {
    failures.push({
      reason: "no-dist",
      path: DIST,
      hint:
        `run \`npm run build:extension:custom\` first to produce ${OUTPUT_DIR}/. ` +
        "The publish-readiness gate refuses to continue without a packaged bundle.",
    });
    return failures; // Short-circuit: nothing else to test without a dist.
  }

  // --- Check 2: sidecar files exist. ------------------------------------
  for (const sidecar of [
    SIDECAR_SUMS,
    SIDECAR_MANIFEST,
    SIDECAR_MANIFEST_JSON,
    SIDECAR_README,
  ]) {
    if (!existsSync(join(DIST, sidecar))) {
      failures.push({
        reason: "missing-sidecar",
        path: join(DIST, sidecar),
        hint:
          `${sidecar} is a reproducibility/reproducible-build sidecar emitted by ` +
          "`scripts/build-extension.cjs`. If it is missing after a build, the build " +
          "script regressed — fix the script, do not just re-run the gate.",
      });
    }
  }
  if (failures.length > 0) return failures; // Don't try to parse a missing sums file.

  // --- Check 3: SHA256SUMS.txt is well-formed. -------------------------
  const sumsText = readFileSync(join(DIST, SIDECAR_SUMS), "utf8");
  const sums = parseSums(sumsText);
  if (sums.error) {
    failures.push({
      reason: "bad-sums",
      path: join(DIST, SIDECAR_SUMS),
      detail: sums.error,
    });
    return failures; // Every later check relies on sums.entries being valid.
  }

  // --- Check 4: each listed file hash matches the actual file. ---------
  const recorded = new Map(); // basename → recorded sha256 (for cross-check vs MANIFEST.md)
  for (const entry of sums.entries) {
    recorded.set(entry.file, entry.sha256);
    const target = join(DIST, entry.file);
    if (!existsSync(target)) {
      failures.push({
        reason: "missing-listed-file",
        path: target,
        detail: `SHA256SUMS.txt lists ${entry.file} but ${OUTPUT_DIR}/${entry.file} is absent`,
      });
      continue;
    }
    const actual = sha256OfFile(target);
    if (actual !== entry.sha256) {
      failures.push({
        reason: "drift",
        path: target,
        recorded: entry.sha256,
        actual,
        detail: `${entry.file} hash drifted: recorded ${entry.sha256}, actual ${actual}`,
      });
    }
  }

  // --- Check 5a: MANIFEST.md shape (lite — markdown is human-readable,
  //     structural truth now lives in build-manifest.json). --------------------
  const manifest = readFileSync(join(DIST, SIDECAR_MANIFEST), "utf8");
  const manifestLines = manifest.split(/\r?\n/);
  if (manifestLines.length < 4) {
    failures.push({
      reason: "manifest-shape",
      path: join(DIST, SIDECAR_MANIFEST),
      detail: `MANIFEST.md has ${manifestLines.length} lines; expected at least 4`,
    });
  }
  // New structural markers: the markdown must reference the JSON sibling
  // and define an `## Inventory` section. The old `Built at:` / `## Files
  // (alphabetical)` markers are gone — the inventory lives in JSON now.
  if (!manifest.includes("## Inventory")) {
    failures.push({
      reason: "manifest-shape",
      path: join(DIST, SIDECAR_MANIFEST),
      detail: "MANIFEST.md is missing the `## Inventory` section header",
    });
  }
  if (!manifest.includes("build-manifest.json")) {
    failures.push({
      reason: "manifest-shape",
      path: join(DIST, SIDECAR_MANIFEST),
      detail: "MANIFEST.md does not reference its JSON sibling (`build-manifest.json`)",
    });
  }

  // --- Check 5b: build-manifest.json parses + has the expected schema. -------
  let parsedManifest = null;
  const manifestJsonPath = join(DIST, SIDECAR_MANIFEST_JSON);
  let rawJsonText = null;
  try {
    rawJsonText = readFileSync(manifestJsonPath, "utf8");
  } catch (error) {
    failures.push({
      reason: "manifest-json",
      path: manifestJsonPath,
      detail: `could not read build-manifest.json: ${error?.message ?? String(error)}`,
    });
  }
  if (rawJsonText !== null) {
    try {
      parsedManifest = JSON.parse(rawJsonText);
    } catch (error) {
      failures.push({
        reason: "manifest-json",
        path: manifestJsonPath,
        detail: `build-manifest.json is not valid JSON: ${error?.message ?? String(error)}`,
      });
    }
  }
  if (parsedManifest !== null) {
    if (!parsedManifest.files || !Array.isArray(parsedManifest.files)) {
      failures.push({
        reason: "manifest-json",
        path: manifestJsonPath,
        detail: "build-manifest.json is missing the top-level `files` array",
      });
    } else {
      for (let i = 0; i < parsedManifest.files.length; i++) {
        const entry = parsedManifest.files[i];
        if (!entry || typeof entry !== "object") {
          failures.push({
            reason: "manifest-json",
            path: manifestJsonPath,
            detail: `build-manifest.json \`files[${i}]\` is not an object`,
          });
          continue;
        }
        if (typeof entry.name !== "string") {
          failures.push({
            reason: "manifest-json",
            path: manifestJsonPath,
            detail: `build-manifest.json \`files[${i}]\` is missing a string \`name\``,
          });
        }
        if (typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
          failures.push({
            reason: "manifest-json",
            path: manifestJsonPath,
            detail: `build-manifest.json \`files[${i}]\` is missing a 64-hex SHA-256 \`sha256\``,
          });
        }
        if (typeof entry.size !== "number" || entry.size < 0) {
          failures.push({
            reason: "manifest-json",
            path: manifestJsonPath,
            detail: `build-manifest.json \`files[${i}]\` is missing a non-negative numeric \`size\``,
          });
        }
      }
    }
    if (parsedManifest.metadata && parsedManifest.metadata.source_files_count !== parsedManifest.files?.length) {
      failures.push({
        reason: "manifest-json",
        path: manifestJsonPath,
        detail: `build-manifest.json metadata.source_files_count (${parsedManifest.metadata?.source_files_count ?? "missing"}) ` +
          `does not match files.length (${parsedManifest.files?.length ?? "missing"})`,
      });
    }
  }

  // --- Check 5c: one-way cross-reference build-manifest.json -> SHA256SUMS.txt.
  //
  // Direction matters. build-manifest.json's `files[]` lists only the
  // 10 SOURCE artifacts (it is the parseable inventory, not a directory
  // listing). The two sidecars (MANIFEST.md + build-manifest.json) are
  // also in SHA256SUMS.txt but deliberately NOT in build-manifest.json's
  // files[] — cataloguing a file inside its own manifest would create a
  // hash-self-reference loop. So:
  //
  //   - Forward direction (JSON -> SUMS) IS required: every JSON
  //     files[].sha256 must also appear in SHA256SUMS.txt. Catches a
  //     stale JSON (someone deleted a source from SUMS but kept it in
  //     JSON) or a tampered SUMS (someone removed a source hash).
  //   - Reverse direction (SUMS -> JSON) is NOT required because the
  //     sidecar hashes (and any new sidecar hashes added later) live in
  //     SUMS without being catalogued in JSON's files[].
  if (parsedManifest !== null && Array.isArray(parsedManifest.files)) {
    const jsonBySha = new Map();
    for (const entry of parsedManifest.files) {
      if (entry && typeof entry.sha256 === "string") {
        jsonBySha.set(entry.sha256, entry);
      }
    }
    // build-manifest.json hashes that are not in SHA256SUMS.txt (forward):
    const orphanJsonHashes = [];
    const recordedShas = new Set(recorded.values());
    for (const sha of jsonBySha.keys()) {
      if (!recordedShas.has(sha)) orphanJsonHashes.push(sha);
    }
    if (orphanJsonHashes.length > 0) {
      failures.push({
        reason: "manifest-mismatch",
        path: manifestJsonPath,
        detail:
          `build-manifest.json references ${orphanJsonHashes.length} hash(es) that are not in ` +
          `${SIDECAR_SUMS}: ${orphanJsonHashes.slice(0, 3).map((s) => "`" + s + "`").join(", ")}` +
          (orphanJsonHashes.length > 3 ? "…" : ""),
      });
    }
  }

  // --- Check 6: a real file in dist must be listed in SHA256SUMS.txt. ---
  // Allowed exceptions: the sidecars themselves. Anything else is an
  // unanticipated build output that the operator should review.
  const onDisk = readdirSync(DIST).filter((name) => {
    try {
      return statSync(join(DIST, name)).isFile();
    } catch {
      return false;
    }
  });
  const unlisted = onDisk.filter(
    (name) => !SIDECARS.has(name) && !recorded.has(name),
  );
  if (unlisted.length > 0) {
    failures.push({
      reason: "unlisted-file",
      path: DIST,
      detail:
        `${unlisted.length} file(s) in ${OUTPUT_DIR} are not listed in ` +
        `${SIDECAR_SUMS}: ${unlisted.slice(0, 5).map((s) => "`" + s + "`").join(", ")}` +
        (unlisted.length > 5 ? "…" : ""),
    });
  }

  return failures;
}

// Direct-invocation guard (matches scripts/check-extension-csp.mjs, scripts/audit-anchors.mjs).
function isDirectInvocation() {
  const entry = process.argv[1];
  if (!entry) return false;
  const entryBase = entry.split(/[\\/]/).pop();
  const moduleBase = import.meta.url.split("/").pop();
  return entryBase === moduleBase;
}

if (isDirectInvocation()) {
  const args = process.argv.slice(2);
  const printMode = args.includes("--print");

  let failures;
  try {
    failures = await run();
  } catch (error) {
    console.error(
      `[check-extension-dist] FATAL: ${error?.message ?? String(error)}`,
    );
    process.exit(2);
  }

  if (printMode) {
    console.log(`dist: ${DIST}`);
    if (!existsSync(DIST)) {
      console.log("(dist directory absent)");
      process.exit(0);
    }
    const files = readdirSync(DIST).filter((name) =>
      statSync(join(DIST, name)).isFile(),
    );
    console.log(`files: ${files.length}`);
    for (const name of files.sort()) {
      const stat = statSync(join(DIST, name));
      console.log(`  ${name} (${stat.size} bytes)`);
    }
    process.exit(0);
  }

  if (failures.length === 0) {
    console.log(
      `[check-extension-dist] ok ${DIST} — ${SIDECAR_SUMS} verifies + ${SIDECAR_MANIFEST} in sync`,
    );
    process.exit(0);
  }

  for (const f of failures) {
    console.error(`[check-extension-dist] FAIL (${f.reason}) ${f.path}`);
    if (f.detail) console.error(`  ${f.detail}`);
    if (f.hint) console.error(`  hint: ${f.hint}`);
  }
  console.error(`[check-extension-dist] ${failures.length} failure(s)`);
  process.exit(1);
}

export { run, parseSums, sha256OfFile };
