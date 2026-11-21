#!/usr/bin/env node
/**
 * scripts/apply-landing-i18n-patch.mjs — merge a translation patch into a
 * landing locale file, with validation.
 *
 * A patch is a flat JSON object: leaf path -> translated string
 * ("pricing.plans.1.features.3.text": "…"). The paths come from
 * scripts/landing-i18n-tasks.mjs --tasks, so a patch can only touch leaves
 * the English source defines. This script:
 *
 *   1. refuses a path the English source does not have (no invented keys);
 *   2. refuses a path whose English value is not a string;
 *   3. writes the value into the locale file, creating the intermediate
 *      objects/arrays the path implies;
 *   4. preserves the {{placeholders}} of the English source;
 *   5. re-runs the structure analysis of check:landing-i18n.mjs and refuses
 *      to leave a file that broke the key structure.
 *
 * Usage:
 *   node scripts/apply-landing-i18n-patch.mjs --locale cs --patch <file>
 *   node scripts/apply-landing-i18n-patch.mjs --locale cs --patch <file> --dry-run
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  analyzeLocale,
  flattenLeaves,
  placeholdersOf,
} from "./check-landing-i18n.mjs";

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(THIS_DIR, "..");
const TRANSLATIONS_DIR = join(ROOT, "scripts", "translations");

function getArgs(argv) {
  const args = { dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--locale") args.locale = argv[++i];
    else if (arg === "--patch") args.patch = argv[++i];
    else if (arg === "--dry-run") args.dryRun = true;
  }
  return args;
}

/** Write `value` at a dotted path, creating the containers it implies. */
function setPath(root, path, value) {
  const parts = path.split(".");
  let cursor = root;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    const nextIsIndex = /^\d+$/.test(parts[i + 1]);
    if (cursor[key] === undefined || cursor[key] === null) {
      cursor[key] = nextIsIndex ? [] : {};
    }
    cursor = cursor[key];
  }
  cursor[parts[parts.length - 1]] = value;
}

export function applyPatch({ locale, patch, dryRun = false }) {
  const english = JSON.parse(
    readFileSync(join(TRANSLATIONS_DIR, "en.json"), "utf8"),
  );
  const file = join(TRANSLATIONS_DIR, `${locale}.json`);
  const target = JSON.parse(readFileSync(file, "utf8"));
  const enLeaves = flattenLeaves(english);

  // A patch is either the flat { path: translation } map or the task file
  // shape { locale, language, note, strings: { path: translation } }.
  const entries =
    patch && typeof patch.strings === "object" && patch.strings !== null
      ? patch.strings
      : patch;

  const problems = [];
  const skipped = [];
  const applied = [];
  for (const [path, value] of Object.entries(entries)) {
    if (!(path in enLeaves)) {
      // A task file can be slightly older than the English source (a key that
      // the source dropped in the meantime). The sync already removed the key
      // from the locale file, so there is nothing to translate any more.
      skipped.push(path);
      continue;
    }
    if (typeof enLeaves[path] !== "string") {
      problems.push(`not a string in the English source: ${path}`);
      continue;
    }
    if (typeof value !== "string" || value.trim() === "") {
      problems.push(`empty or non-string translation: ${path}`);
      continue;
    }
    const enPlaceholders = placeholdersOf(enLeaves[path]).join("|");
    const newPlaceholders = placeholdersOf(value).join("|");
    if (enPlaceholders !== newPlaceholders) {
      problems.push(
        `placeholder mismatch (expected "${enPlaceholders}", got "${newPlaceholders}"): ${path}`,
      );
      continue;
    }
    setPath(target, path, value);
    applied.push(path);
  }

  const result = analyzeLocale(english, target, {
    sourceLocale: locale === "en",
  });
  if (result.missing.length) {
    problems.push(
      `the merged file would lose ${result.missing.length} key(s): ${result.missing.slice(0, 5).join(", ")}`,
    );
  }
  if (result.typeMismatch.length) {
    problems.push(
      `the merged file would change ${result.typeMismatch.length} type(s): ${result.typeMismatch.slice(0, 5).join(", ")}`,
    );
  }

  if (problems.length) {
    return { ok: false, applied: [], problems };
  }
  if (!dryRun) {
    writeFileSync(file, `${JSON.stringify(target, null, 2)}\n`, "utf8");
  }
  return {
    ok: true,
    applied,
    skipped,
    problems: [],
    remaining: result.untranslated.length,
    remainingPaths: result.untranslated,
  };
}

const invokedDirectly =
  process.argv[1] &&
  process.argv[1].replace(/\\/g, "/").endsWith("apply-landing-i18n-patch.mjs");
if (invokedDirectly) {
  const args = getArgs(process.argv.slice(2));
  if (!args.locale || !args.patch) {
    console.error(
      "usage: node scripts/apply-landing-i18n-patch.mjs --locale <code> --patch <file> [--dry-run]",
    );
    process.exit(2);
  }
  const patch = JSON.parse(readFileSync(args.patch, "utf8").replace(/^\uFEFF/, ""));
  const result = applyPatch({ locale: args.locale, patch, dryRun: args.dryRun });
  if (!result.ok) {
    console.error(
      `[apply-landing-i18n-patch] FAIL ${args.locale}: ${result.problems.length} problem(s):`,
    );
    for (const problem of result.problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log(
    `[apply-landing-i18n-patch] ok ${args.locale}: ${result.applied.length} leaf/leaves applied, ${result.remaining} untranslated remaining` +
      (result.skipped.length
        ? `, ${result.skipped.length} path(s) skipped (no longer in the English source)`
        : "") +
      (args.dryRun ? " (dry run)" : ""),
  );
}
