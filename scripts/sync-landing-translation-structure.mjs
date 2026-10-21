#!/usr/bin/env node
/**
 * scripts/sync-landing-translation-structure.mjs — make every landing
 * translation file have EXACTLY the structure of the English source.
 *
 * Why this exists
 * ---------------
 * scripts/translations/<code>.json were seeded as copies of the English file
 * and then edited by hand, one locale at a time. Over time the English source
 * moved and the copies did not:
 *
 *   - en.json gained `pricing.plans.1.cta2` ("Get Pro $79 Regular") and
 *     `structuredData.offers.1.availability`. No locale had them, so every
 *     localized landing rendered ONE pricing button where the English one
 *     renders two, and the JSON-LD offer lost its availability.
 *   - the copies kept `pricing.plans.0.features.12` and two extra
 *     `footer.resources.links` entries that the English source dropped, so
 *     the localized landings advertised a feature the English one does not.
 *
 * The freshness gate (check:landings-fresh) compares a committed page with a
 * fresh render of ITS OWN json, so a file that drifted from the English
 * source still passed. This script re-aligns the structures, and
 * check:landing-i18n fails when they drift again.
 *
 * The values of a missing key are copied from the English source and
 * reported as "needs translation" — the sync never invents copy.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { LANDING_CODES } from "./landing-registry.mjs";
import {
  analyzeLocale,
  flattenLeaves,
  isExemptString,
  isIdentifierPath,
  METADATA_PATHS,
  ENUM_VALUES,
} from "./check-landing-i18n.mjs";

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(THIS_DIR, "..");
const TRANSLATIONS_DIR = join(ROOT, "scripts", "translations");

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));

/**
 * Rebuild `locale` with the shape of `english`: every leaf of the English
 * source exists, and nothing else does.
 *
 * @returns {{ value: object, added: string[], removed: string[] }}
 */
export function syncStructure(english, locale) {
  const enLeaves = flattenLeaves(english);
  const locLeaves = flattenLeaves(locale);
  const added = [];
  const removed = [];

  const result = JSON.parse(JSON.stringify(locale));

  const setPath = (root, path, value) => {
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
  };

  const deletePath = (root, path) => {
    const parts = path.split(".");
    let cursor = root;
    for (let i = 0; i < parts.length - 1; i += 1) {
      cursor = cursor[parts[i]];
      if (cursor === undefined || cursor === null) return;
    }
    const last = parts[parts.length - 1];
    if (Array.isArray(cursor) && /^\d+$/.test(last)) {
      cursor.splice(Number(last), 1);
    } else {
      delete cursor[last];
    }
  };

  // Remove the extra leaves. Array elements are removed from the highest index
  // down, otherwise removing index 2 shifts index 3 into its place and the
  // stale entry survives the sync.
  const removals = Object.keys(locLeaves)
    .filter((path) => !(path in enLeaves))
    .sort((a, b) => {
      const aParts = a.split(".");
      const bParts = b.split(".");
      for (let i = 0; i < Math.max(aParts.length, bParts.length); i += 1) {
        const aPart = aParts[i];
        const bPart = bParts[i];
        if (aPart === bPart) continue;
        if (aPart === undefined) return 1;
        if (bPart === undefined) return -1;
        const aNum = /^\d+$/.test(aPart);
        const bNum = /^\d+$/.test(bPart);
        if (aNum && bNum) return Number(bPart) - Number(aPart);
        return aPart < bPart ? -1 : 1;
      }
      return 0;
    });
  for (const path of removals) {
    deletePath(result, path);
    removed.push(path);
  }
  for (const [path, value] of Object.entries(enLeaves)) {
    if (!(path in locLeaves)) {
      setPath(result, path, value);
      added.push(path);
    }
  }
  return { value: result, added, removed };
}

/** True when a copied English value still has to be translated. */
function needsTranslation(path, value) {
  if (typeof value !== "string") return false;
  if (METADATA_PATHS.has(path) || isIdentifierPath(path)) return false;
  if (ENUM_VALUES.has(value)) return false;
  return !isExemptString(value);
}

function main() {
  const english = readJson(join(TRANSLATIONS_DIR, "en.json"));
  const report = {};
  for (const code of LANDING_CODES) {
    const file = join(TRANSLATIONS_DIR, `${code}.json`);
    const locale = readJson(file);
    const { value, added, removed } = syncStructure(english, locale);
    const todo = added.filter((path) =>
      needsTranslation(path, flattenLeaves(english)[path]),
    );
    if (added.length || removed.length) {
      writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    }
    if (added.length || removed.length) {
      report[code] = { added, removed, needsTranslation: todo };
      console.log(
        `${code.padEnd(3)} +${String(added.length).padStart(2)} -${String(removed.length).padStart(2)}` +
          (todo.length ? `  needs translation: ${todo.join(", ")}` : ""),
      );
    }
    // Safety net: the merged file must still analyse cleanly.
    const result = analyzeLocale(english, value, {
      sourceLocale: code === "en",
    });
    if (result.missing.length || result.extra.length) {
      console.error(
        `  !! ${code}: structure still differs (missing ${result.missing.length}, extra ${result.extra.length})`,
      );
      process.exitCode = 1;
    }
  }
  console.log(
    Object.keys(report).length
      ? `synced ${Object.keys(report).length} locale file(s)`
      : "every locale already matches the English structure",
  );
}

const invokedDirectly =
  process.argv[1] &&
  process.argv[1].replace(/\\/g, "/").endsWith("sync-landing-translation-structure.mjs");
if (invokedDirectly) {
  main();
}
