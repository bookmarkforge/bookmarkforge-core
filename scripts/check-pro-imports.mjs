#!/usr/bin/env node
/**
 * check-pro-imports — erosion gate for the Open Core runtime boundary.
 *
 * Why this exists: src/services/pro-access.ts is the single sanctioned seam
 * between Core code and Pro implementations. Every *other* static reference
 * to a Pro module re-links Pro code into Core chunks and quietly widens the
 * boundary that scripts/pro-boundary.mjs then has to patch at export time
 * with placeholder pairs. The compile-time boundary makes such drift *safe*
 * (the export still compiles); this gate makes it *visible* — it fails the
 * moment a new static reference appears outside the declared allowances, so
 * the boundary cannot erode one "small" import at a time.
 *
 * A reference is allowed when ANY of these holds (all declared here, none
 * discovered at runtime):
 *
 *   1. The importing file is itself a Pro module (isProModulePath). Pro code
 *      may import Pro freely;
 *   2. The importing file is src/services/pro-access.ts, the seam itself.
 *   3. The import is server-internal (importer and target both under
 *      server/). The server assembles its own Pro handlers behind its own
 *      entitlement enforcement (entitlement-guard), and both sides are
 *      excluded from the public export together.
 *   4. The importing file is a test (Pro-behaviour tests live in the private
 *      tree and the exporter excludes them; component tests are expected to
 *      mock the pro-access loader instead of the Pro modules).
 *   5. Every occurrence of the specifier in the file is a type-only import
 *      (`import type` / `export type`). Those are erased at compile time and
 *      are satisfied in the export by the generated .d.ts pairs — they carry
 *      no code into Core chunks.
 *
 * There is NO tolerated zone: the AI tree migration behind the loader is
 * complete. Pro is an exact file list in scripts/pro-boundary.mjs —
 * anything else fails with the file, line and specifier to fix.
 *
 * Policy is imported from scripts/pro-boundary.mjs so the exporter, the
 * boundary generator, the open-core gate and this gate can never disagree
 * about what "Pro" means.
 */
import { readFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isProModulePath, scanProReferences, SKIP_DIRS as PRO_SCAN_SKIP_DIRS, SCAN_EXTENSIONS } from "./pro-boundary.mjs";
import { getCachedVerdict, putCachedVerdict, treeFingerprint } from "./gate-cache.mjs";

const GATE_CACHE_NAME = "check-pro-imports";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = join(SCRIPT_DIR, "..");

/** The one Core-side file allowed to statically reference Pro modules. */
export const PRO_ACCESS_SEAM = "src/services/pro-access.ts";

/** The boundary generator itself: it names Pro paths to *write* the export
 * placeholders, so its references are machinery, not coupling. */
export const BOUNDARY_GENERATOR = "scripts/pro-boundary.mjs";

/** Test files: Pro-behaviour pins and loader-mocking component tests. */
function isTestFile(relPath) {
  return (
    /(^|\/)(__tests__|tests)(\/|$)/.test(relPath) ||
    /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(relPath)
  );
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * True when every raw occurrence of `specifier` in `source` sits inside a
 * type-only import/export statement (erased at compile time).
 */
export function isTypeOnlyUsage(source, specifier) {
  const total =
    source.split(`"${specifier}"`).length - 1 +
    source.split(`'${specifier}'`).length - 1 +
    source.split(`\`${specifier}\``).length - 1;
  if (total === 0) {return false;}
  const typeStmtRe = new RegExp(
    `(?:import|export)\\s+type\\s+[^;]*?["']${escapeRe(specifier)}["']`,
    "g",
  );
  const typeOnly = source.match(typeStmtRe)?.length ?? 0;
  return typeOnly === total;
}

function lineOf(source, specifier) {
  const idx = source.indexOf(specifier);
  return idx === -1 ? 0 : source.slice(0, idx).split("\n").length;
}

/**
 * Classify every Pro reference in the tree.
 *
 * @param {string} root repo root to scan
 * @param {string[]=} files optional file list override (tests)
 * @returns {{violations: Array<{file: string, line: number, specifier: string, modulePath: string}>, referencingFiles: number, allowed: number}}
 */
export function checkProImports(root = DEFAULT_ROOT, files) {
  const { perFile } = scanProReferences(root, files ?? undefined);
  const violations = [];
  let allowed = 0;

  for (const [file, refs] of perFile) {
    let source;
    try {
      source = readFileSync(join(root, file.split("/").join(sep)), "utf8");
    } catch {
      source = "";
    }

    // Declared allowances 1-4 (file-level).
    const importerIsPro = isProModulePath(file);
    const importerIsSeam = file === PRO_ACCESS_SEAM;
    const importerIsTest = isTestFile(file);

    for (const [specifier, info] of refs) {
      const serverInternal =
        file.startsWith("server/") && info.modulePath.startsWith("server/");
      const typeOnly = isTypeOnlyUsage(source, specifier);
      if (importerIsPro || importerIsSeam || importerIsTest || serverInternal || typeOnly) {
        allowed += 1;
        continue;
      }
      if (file === BOUNDARY_GENERATOR) {
        allowed += 1;
        continue;
      }
      violations.push({
        file,
        line: lineOf(source, specifier),
        specifier,
        modulePath: info.modulePath,
      });
    }
  }

  return {
    violations,
    referencingFiles: perFile.size,
    allowed,
  };
}

function main() {
  // Verdict cache (scripts/gate-cache.mjs): the scan is deterministic in the
  // source tree, so a fingerprint match over the scanner's exact universe
  // (pro-boundary's SKIP_DIRS + SCAN_EXTENSIONS) proves the PASS verdict
  // still holds. Only PASS is cached; BMF_GATE_CACHE_OFF=1 bypasses.
  const fingerprint = treeFingerprint({
    root: DEFAULT_ROOT,
    extensions: SCAN_EXTENSIONS,
    skipDirs: PRO_SCAN_SKIP_DIRS,
    hash: true,
  });
  if (getCachedVerdict({ gateName: GATE_CACHE_NAME, fingerprint })) {
    console.log(
      `[check-pro-imports] OK (cached): source tree unchanged since the last pass — no Core file statically imports a Pro module outside the sanctioned seam`,
    );
    return;
  }
  const result = checkProImports(DEFAULT_ROOT);
  if (result.violations.length > 0) {
    console.error(
      `[check-pro-imports] FAIL: ${result.violations.length} static Pro import(s) outside the sanctioned seam — Core code must resolve Pro through ${PRO_ACCESS_SEAM}`,
    );
    for (const v of result.violations) {
      console.error(
        `  ${v.file}:${v.line} — "${v.specifier}" -> ${v.modulePath}`,
      );
    }
    console.error(
      "  Allowed: pro-access.ts (the seam), Pro-to-Pro imports, server-internal imports, tests, type-only imports. See scripts/check-pro-imports.mjs.",
    );
    process.exit(1);
  }
  console.log(
    `[check-pro-imports] OK: no Core file statically imports a Pro module outside the sanctioned seam (${result.referencingFiles} referencing file(s), ${result.allowed} allowed)`,
  );
  putCachedVerdict({ gateName: GATE_CACHE_NAME, fingerprint });
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main();
}
