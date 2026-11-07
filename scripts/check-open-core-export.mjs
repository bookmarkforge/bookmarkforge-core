#!/usr/bin/env node
/**
 * Verifies the Open Core boundary — of this source tree, or of a materialized
 * export when a directory is passed (the exporter calls it that way).
 *
 * Usage: node scripts/check-open-core-export.mjs [export-dir]
 *
 * With no argument the gate verifies whichever tree it is standing in: the
 * private source repository only registers the policy (its Pro implementations
 * are supposed to be here), while an exported tree — the public repository — is
 * verified in full, so the public CI re-checks its own boundary on every run.
 *
 * Checks, in order:
 *   1. (export only) no Pro implementation ships: a Pro path may only exist as a
 *      generated declaration plus an inert runtime placeholder, both marked;
 *   2. (export only) every Pro reference in the tree resolves to that placeholder
 *      pair, without an explicit extension that would bypass it;
 *   3. license metadata is MIT/Open Core.
 *
 * The Pro path policy itself lives in scripts/pro-boundary.mjs so the exporter,
 * the placeholder generator and this gate cannot drift apart: an exclusion added
 * in one place is enforced by the others in the same commit.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import process from "node:process";
import {
  PRO_MODULE_DIRS,
  PRO_MODULE_PATHS,
  isProModulePath,
  sourceFiles,
  undocumentedProPaths,
  verifyProBoundary,
} from "./pro-boundary.mjs";

const normalized = (value) => value.split(sep).join("/");

/**
 * A tree that still carries Pro *implementations* is the private source repo;
 * a tree that only carries their placeholder artefacts is an export.
 *
 * Probed directly instead of walking the tree: this runs at the top of the very
 * first gate of `npm run check`, and a full recursive scan there would cost
 * seconds on every gate run to answer a question the declared paths already do.
 */
const holdsProImplementations = (dir) => {
  const abs = (rel) => join(dir, rel.split("/").join(sep));
  const isRealSource = (name) => !/\.[cm]?jsx?$/.test(name) && !name.endsWith(".d.ts");
  if (PRO_MODULE_PATHS.some((proPath) => existsSync(abs(proPath)))) return true;
  return PRO_MODULE_DIRS.some((proDir) => {
    let entries;
    try {
      entries = readdirSync(abs(proDir), { withFileTypes: true });
    } catch {
      return false;
    }
    return entries.some((entry) => entry.isFile() && isRealSource(entry.name));
  });
};

// ── Documentation reconciliation ──────────────────────────────────────────
// The published Core/Pro document must classify every declared Pro path (see
// undocumentedProPaths). Checked in both trees — the private source tree when
// the policy is edited, the export when the public repository re-audits
// itself — so the shipped document cannot describe a boundary the policy no
// longer has. Fail closed: a missing document is a failure, not a skip.
const docTree = process.argv[2] ?? ".";
const docPath = join(docTree, "OPEN-CORE.md");
if (!existsSync(docPath)) {
  console.error(`[open-core] FAIL: ${normalized(docPath)} is missing — the Core/Pro classification cannot be verified`);
  process.exit(1);
}
const undocumented = undocumentedProPaths(readFileSync(docPath, "utf8"));
if (undocumented.length) {
  console.error(
    "[open-core] FAIL: Pro module(s) declared in scripts/pro-boundary.mjs but not classified in OPEN-CORE.md:",
  );
  for (const proPath of undocumented) console.error(`- ${proPath}`);
  console.error("  Add each one to the Feature classification table in OPEN-CORE.md.");
  process.exit(1);
}

let root = process.argv[2];
/**
 * Export checkouts sitting next to this one.
 *
 * C2 (2026-10-20 audit): the no-argument mode only registered policy in the
 * private tree, so a sibling `<PREFIX>bookmarkforge-core` export that still
 * carried five Pro `.ts` implementations passed every `npm run check` while the
 * published repository shipped them. The private checkout is exactly where
 * that mistake is catchable, so scan the siblings and verify each one with the
 * same code path used for an explicit argument.
 */
function siblingExportCheckouts() {
  // The URL directory is THIS checkout (…/bookmarkforge-core); exports are
  // materialised next to it, one level up. With a single dirname the scan
  // looked inside the private checkout and never found the sibling, so the
  // C2 protection below never fired from the real tree.
  const parent = dirname(dirname(fileURLToPath(new URL(".", import.meta.url))));
  try {
    return readdirSync(parent, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          // `bookmarkforge-core`, `BOOKMARKbookmarkforge-core`, `foo-bookmarkforge-core`
          /bookmarkforge-core$/i.test(entry.name),
      )
      .map((entry) => join(parent, entry.name))
      .filter((dir) => existsSync(join(dir, "package.json")) && existsSync(join(dir, "src")));
  } catch {
    /* INTENTIONAL SILENCE: an unreadable parent directory just means there is
     * no sibling export to verify; the explicit-argument mode still applies. */
    return [];
  }
}

/**
 * An export checkout ships an auditable root `manifest.json` with
 * `license: "MIT"`; the private repository does not.
 *
 * C2 (2026-10-20 audit): without this discriminator an export that still
 * carried Pro implementations was indistinguishable from the private tree, so
 * the no-argument mode printed "this is the private tree" and exited 0 INSIDE
 * the published repository. Its own CI runs `npm run check:open-core`, so the
 * gate that exists to stop exactly this leak was green while five Pro
 * implementations shipped. The private tree's policy branch is now unreachable
 * from an export, whatever state its `src/` is in.
 */
function looksLikeExportTree(dir) {
  const manifestPath = join(dir, "manifest.json");
  if (!existsSync(manifestPath)) return false;
  try {
    return JSON.parse(readFileSync(manifestPath, "utf8")).license === "MIT";
  } catch {
    return false;
  }
}

if (!root) {
  if (holdsProImplementations(".") && !looksLikeExportTree(".")) {
    const failures = [];
    const verified = [];
    for (const dir of siblingExportCheckouts()) {
      const run = spawnSync(
        process.execPath,
        [fileURLToPath(import.meta.url), dir],
        { encoding: "utf8" },
      );
      const label = relative(process.cwd(), dir) || dir;
      if (run.status === 0) {
        verified.push(label);
      } else {
        failures.push(`${label}:\n${(run.stderr || run.stdout || "").trim()}`);
      }
    }
    if (failures.length) {
      console.error(
        "[open-core] FAIL: a sibling public export violates the Core/Pro boundary:",
      );
      for (const failure of failures) console.error(failure);
      process.exit(1);
    }
    console.log(
      `[open-core] OK: Pro policy registered (${PRO_MODULE_PATHS.length} exact path(s), ` +
        `${PRO_MODULE_DIRS.length} tree(s)); Pro implementations are present, so this is the ` +
        `private tree` +
        (verified.length
          ? `; sibling export(s) verified: ${verified.join(", ")}`
          : " — pass an export directory for materialized verification"),
    );
    process.exit(0);
  }
  root = ".";
}
if (!existsSync(root)) {
  console.error(`[open-core] FAIL: export directory does not exist: ${root}`);
  process.exit(1);
}

const implementations = sourceFiles(root).filter(
  (file) => isProModulePath(file) && !file.endsWith(".d.ts") && !file.endsWith(".js"),
);
if (implementations.length) {
  console.error("[open-core] FAIL: Pro implementations found in public export:");
  for (const file of implementations) console.error(`- ${file}`);
  process.exit(1);
}

const { violations, placeholderCount } = verifyProBoundary(root);
if (violations.length) {
  console.error("[open-core] FAIL: Pro placeholders are incomplete or unmarked in the public export:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

const manifestPath = join(root, "manifest.json");
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.license !== "MIT") {
    console.error(`[open-core] FAIL: manifest license is ${manifest.license ?? "missing"}, expected MIT`);
    process.exit(1);
  }
}
const license = join(root, "LICENSE");
if (existsSync(license) && !readFileSync(license, "utf8").startsWith("MIT License")) {
  console.error("[open-core] FAIL: public LICENSE does not start with MIT License");
  process.exit(1);
}
console.log(
  `[open-core] OK: no Pro implementation in the public export, ${placeholderCount} placeholder ` +
    `artefact(s) cover every Pro reference, and MIT metadata is consistent ` +
    `(${normalized(relative(process.cwd(), root)) || "."})`,
);
