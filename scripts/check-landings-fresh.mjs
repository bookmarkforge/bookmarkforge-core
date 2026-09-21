#!/usr/bin/env node
/**
 * scripts/check-landings-fresh.mjs
 *
 * Freshness gate: the HTML that build-landings.cjs would generate must be
 * byte-identical (modulo CRLF) to the committed files in public/. Born after
 * pocket-alternative.html drifted from its translation JSON for weeks — a
 * hand-edited page is a fork of its own source of truth.
 *
 * Instead of running the writing build and diffing the worktree (fragile
 * against CRLF checkout conversion and dirty-tree noise), this gate renders
 * every page IN MEMORY through the same Nunjucks env, filters and templates
 * the builder uses (renderAll() is exported by build-landings.cjs for
 * exactly this), and compares:
 *
 *   1. every page the build produces must exist in public/ and match;
 *   2. every file matching the generator's output-name patterns that the
 *      build would NOT produce is flagged as stale (renamed outputs must be
 *      removed in the same PR; 404.html stays exempt — it is a declared
 *      static file until the generator grows 404 support).
 *
 * Read-only by construction: it never writes public/. Fix a failure with
 * `npm run build:landings` and commit the regenerated pages.
 *
 * Exit 0 fresh, 1 drift/missing/stale, 2 infra error (render threw).
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(THIS_DIR, "..", "public");

const require = createRequire(import.meta.url);
const builder = require(join(THIS_DIR, "build-landings.cjs"));

/** Name patterns the generator emits today (all flat in public/). Anything
 * matching these that the build no longer produces is a stale orphan.
 * 404.html / 404-<lang>.html are deliberately absent: the build skips 404
 * (see the TODO in build-landings.cjs), so they remain hand-maintained. */
const GENERATED_NAME_RE =
  /^(?:landing\.html|(?:es|fr|de|pt|it)\.html|pocket-alternative(?:-[a-z]{2})?\.html)$/;

/** Git checkout may convert LF→CRLF on Windows; the builder always writes
 * LF. Compare after normalizing line endings so a fresh clone cannot
 * false-fail. */
function normalizeEol(text) {
  // Normalize CRLF, lone CR (classic Mac), and double-CR before LF
  // (Windows regression when a tool converts an already-CRLF fixture).
  // The \r+ before \n collapses any run of CRs; standalone \r mid-line
  // is also replaced to avoid false diffs from misconfigured editors.
  return text.replace(/\r+\n/g, "\n").replace(/\r/g, "\n");
}

/** First differing line between two LF-normalized texts, 1-indexed. */
function firstDiffLine(committed, fresh) {
  const a = committed.split("\n");
  const b = fresh.split("\n");
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return i + 1;
  }
  return 0; // identical
}

/**
 * Check freshness. `publicDir` defaults to the repo's public/; the suite
 * overrides it to stay hermetic. Returns { checked, failures } where each
 * failure is { file, reason } with an actionable line reference when a diff
 * exists.
 */
export function checkLandingsFresh({ publicDir = PUBLIC_DIR } = {}) {
  const rendered = builder.renderAll(); // in-memory: never writes
  const contract = new Map(
    rendered.map((r) => [basename(r.path), normalizeEol(r.html)]),
  );
  const failures = [];

  for (const [name, fresh] of contract) {
    const abs = join(publicDir, name);
    if (!existsSync(abs)) {
      failures.push({
        file: `public/${name}`,
        reason: "missing: the generator produces it but it is not committed (run npm run build:landings)",
      });
      continue;
    }
    const committed = normalizeEol(readFileSync(abs, "utf8"));
    if (committed !== fresh) {
      const line = firstDiffLine(committed, fresh);
      failures.push({
        file: `public/${name}`,
        reason: line
          ? `stale: committed HTML differs from the fresh render at line ${line} (fix: npm run build:landings)`
          : "stale: committed HTML differs from the fresh render (fix: npm run build:landings)",
      });
    }
  }

  const produced = new Set(contract.keys());
  for (const entry of readdirSync(publicDir)) {
    if (GENERATED_NAME_RE.test(entry) && !produced.has(entry)) {
      failures.push({
        file: `public/${entry}`,
        reason: "stale: matches a generator output name but build-landings no longer produces it (remove it or restore the template/translation)",
      });
    }
  }

  failures.sort((x, y) => x.file.localeCompare(y.file));
  return { checked: contract.size, failures };
}

function main() {
  let result;
  try {
    result = checkLandingsFresh();
  } catch (error) {
    console.error(`[check-landings-fresh] FAIL: render threw: ${error.message}`);
    process.exit(2);
  }
  if (result.failures.length) {
    console.error(`[check-landings-fresh] FAIL: ${result.failures.length} landing drift(s):`);
    for (const { file, reason } of result.failures) {
      console.error(`  - ${file}: ${reason}`);
    }
    process.exit(1);
  }
  console.log(`[check-landings-fresh] ok: ${result.checked} generated landing page(s) are in sync with their sources`);
}

const isMain =
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;
if (isMain) {
  main();
}
