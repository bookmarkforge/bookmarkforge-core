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
import { join, relative, sep } from "node:path";
import process from "node:process";
import {
  PRO_MODULE_DIRS,
  PRO_MODULE_PATHS,
  isProModulePath,
  sourceFiles,
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

let root = process.argv[2];
if (!root) {
  if (holdsProImplementations(".")) {
    console.log(
      `[open-core] OK: Pro policy registered (${PRO_MODULE_PATHS.length} exact path(s), ` +
        `${PRO_MODULE_DIRS.length} tree(s)); Pro implementations are present, so this is the ` +
        `private tree — pass an export directory for materialized verification`,
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
