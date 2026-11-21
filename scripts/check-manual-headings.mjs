#!/usr/bin/env node
/**
 * scripts/check-manual-headings.mjs
 *
 * CI gate: the localized user manuals must keep the section skeleton the
 * English source declares.
 *
 * Born from the 2026-11-04 manual audit, which found the Czech condensed
 * duplicate had silently demoted three of its thirteen section headings to
 * body text: §1 survived as the bare line "1. Úvod", §8 as the translated
 * fragment "Dovoz a vývoz." with number and marker gone, and §9 as the
 * machine-translation artifact `<g id="1">9</g>. Odstraňování problémů`. Every
 * existing gate passed while that file rendered its sections out of order:
 * `check-manual-figures` reads business figures, `check-docs-markdown` reads
 * table/link/heading *style* rules, and neither compares a translation's
 * skeleton against the master. Only rendering the file by hand showed it.
 *
 * Two shapes are legitimate and both are enforced here:
 *   - full manuals (en, es, pt, it, fr, de, ja, zh) mirror the English
 *     numbered skeleton exactly — every `## N.` section and every `### N.M`
 *     subsection, in order, at the same level. Heading text is per-locale and
 *     deliberately not compared.
 *   - condensed manuals (the other 22 locales) carry the five unnumbered
 *     sections documented in check-manual-figures: no numbers, no
 *     subsections.
 *
 * The English skeleton is parsed, never duplicated: adding a section to
 * user-manual-en.md fails this gate on every full manual until each one
 * follows, instead of letting a translation drift one edition behind.
 *
 * Sources are DERIVED from scripts/landing-registry.mjs (MANUAL_FILES) — the
 * same single source the pages, the PDF generator and the exporter read — so a
 * new locale is covered the day it is registered.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { LANDING_CODES, manualSourcePath } from "./landing-registry.mjs";

const THIS_DIR = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(THIS_DIR, "..");

/** Locales whose manual carries the full numbered translation of the English
 * master. Everything else in the registry is a condensed manual. Pinned on
 * purpose: this split is a product decision, not something to infer from a
 * file, so a full manual that loses its skeleton fails instead of quietly
 * reclassifying itself as condensed. */
export const FULL_MANUAL_CODES = ["en", "es", "pt", "it", "fr", "de", "ja", "zh"];

/** Sections in a condensed manual (see check-manual-figures: "condensed
 * manuals carry §3.1/§6/§7-shaped prose lines"). */
export const CONDENSED_SECTION_COUNT = 5;

/** Machine-translation leftovers that end up in the body: an SVG text element
 * emitted where a heading marker should have been. */
const MT_ARTIFACTS = [/<g\s+id=/i];

const HEADING_RE = /^(#{1,6})[ \t]+(.*?)[ \t]*$/;
/** Section number at the start of a heading. Sections carry a trailing dot
 * ("## 2. Getting Started") while subsections do not ("### 3.1 Bookmarks"),
 * so the dot is optional and must still be followed by a space — that keeps
 * "## 300+ integrations" from reading as section 300. */
const NUMBERED_RE = /^(\d+(?:\.\d+)*)\.?(?=\s|$)/;

/**
 * Split a manual into its headings, in file order.
 *
 * `level` is the count of leading `#`; `number` is the dotted section number
 * the heading text starts with ("1", "3.1"), or null for an unnumbered
 * heading. A heading whose text starts with a number but not as a section
 * number ("1.000 bookmarks") keeps the number only when it is followed by a
 * dot and a space, matching the manual convention.
 */
export function parseHeadings(src) {
  const headings = [];
  for (const line of src.split(/\r?\n/)) {
    const m = line.match(HEADING_RE);
    if (!m) continue;
    const text = m[2].replace(/[*_`]/g, "").trim();
    const num = text.match(NUMBERED_RE);
    headings.push({ level: m[1].length, text, number: num ? num[1] : null });
  }
  return headings;
}

/** The comparable part of a manual's skeleton: (level, number) pairs for the
 * section and subsection levels, in order. Heading text is locale-specific
 * and intentionally left out. */
export function headingSignature(headings) {
  return headings
    .filter((h) => h.level >= 2 && h.level <= 4)
    .map((h) => `${h.level}:${h.number ?? "-"}`);
}

/** Render a signature as the human-readable list of section numbers it holds,
 * so a failure names the sections a manual lost rather than only offsets. */
function sectionNumbers(signature) {
  return signature
    .map((entry) => {
      const [level, number] = entry.split(":");
      if (number === "-") return level === "2" ? "(unnumbered §)" : "";
      return level === "2" ? number : number;
    })
    .filter(Boolean);
}

/**
 * Compare one manual against the skeleton its family requires.
 *
 * `expected` is the English signature for full manuals and null for condensed
 * ones. Returns a list of failures (empty when the manual is clean); each
 * failure names the file label and what went wrong, so CI output points at
 * the section rather than at a diff.
 */
export function evaluateManualHeadings(src, { full, expected = null, label }) {
  const failures = [];
  const headings = parseHeadings(src);

  for (const artifact of MT_ARTIFACTS) {
    if (artifact.test(src)) {
      failures.push(`${label}: machine-translation artifact in body (${artifact})`);
    }
  }

  const h1 = headings.filter((h) => h.level === 1);
  if (h1.length !== 1) {
    failures.push(`${label}: expected exactly one "# " title, found ${h1.length}`);
  }

  const sections = headings.filter((h) => h.level === 2);
  const signature = headingSignature(headings);

  if (full) {
    if (!expected) {
      throw new Error(`[check-manual-headings] missing English signature for ${label}`);
    }
    if (sections.length === 0) {
      failures.push(`${label}: no "## " sections at all`);
      return failures;
    }
    // Report the sections that are missing, unexpected or out of order as
    // plain section numbers: that is what a translator has to go fix.
    const got = sectionNumbers(signature);
    const want = sectionNumbers(expected);
    const missing = want.filter((n) => !got.includes(n));
    const extra = got.filter((n) => !want.includes(n));
    if (missing.length) {
      failures.push(
        `${label}: lost section(s) ${missing.join(", ")} that the English source declares`,
      );
    }
    if (extra.length) {
      failures.push(`${label}: has section(s) ${extra.join(", ")} absent from the English source`);
    }
    if (!missing.length && !extra.length && signature.join("|") !== expected.join("|")) {
      failures.push(
        `${label}: section order or level differs from the English skeleton ` +
          `(expected ${want.join(" ")}, got ${got.join(" ")})`,
      );
    }
  } else {
    if (sections.length !== CONDENSED_SECTION_COUNT) {
      failures.push(
        `${label}: condensed manual must carry ${CONDENSED_SECTION_COUNT} "## " sections, found ${sections.length}`,
      );
    }
    const numbered = sections.filter((h) => h.number !== null);
    if (numbered.length) {
      failures.push(
        `${label}: condensed manual has numbered section heading(s) ` +
          `[${numbered.map((h) => h.number).join(", ")}] — the condensed shape is unnumbered`,
      );
    }
    const deeper = headings.filter((h) => h.level >= 3);
    if (deeper.length) {
      failures.push(
        `${label}: condensed manual has ${deeper.length} subsection heading(s); the condensed shape has none`,
      );
    }
    if (!sections.length) {
      failures.push(`${label}: no "## " sections at all`);
    }
  }

  return failures;
}

/** Scan every registered manual, using the English source as the skeleton
 * reference for the full family. */
export function scanManuals(root = REPO_ROOT) {
  const englishPath = join(root, manualSourcePath("en"));
  if (!existsSync(englishPath)) {
    throw new Error(
      `[check-manual-headings] missing English master: ${manualSourcePath("en")}`,
    );
  }
  const expected = headingSignature(parseHeadings(readFileSync(englishPath, "utf8")));

  const failures = [];
  const missing = [];
  const counts = { full: 0, condensed: 0 };

  for (const code of LANDING_CODES) {
    const rel = manualSourcePath(code);
    const abs = join(root, rel);
    if (!existsSync(abs)) {
      missing.push(rel);
      continue;
    }
    const full = FULL_MANUAL_CODES.includes(code);
    counts[full ? "full" : "condensed"] += 1;
    failures.push(
      ...evaluateManualHeadings(readFileSync(abs, "utf8"), {
        full,
        expected,
        label: rel.split(/[\\/]/).pop() ?? rel,
      }),
    );
  }

  return { expected, failures, missing, counts };
}

export function runManualHeadingsGate(root = REPO_ROOT) {
  return scanManuals(root);
}

function main() {
  let result;
  try {
    result = runManualHeadingsGate(process.cwd());
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
  if (result.missing.length) {
    console.error("[check-manual-headings] FAIL: missing manual source(s):");
    for (const rel of result.missing) console.error(`  - ${rel}`);
    process.exit(1);
  }
  if (result.failures.length) {
    console.error(`[check-manual-headings] FAIL: ${result.failures.length} manual skeleton drift(s):`);
    for (const failure of result.failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  const sections = result.expected.filter((entry) => entry.startsWith("2:")).length;
  console.log(
    `[check-manual-headings] ok: ${result.counts.full} full manual(s) mirror the English ` +
      `${sections}-section skeleton, ${result.counts.condensed} condensed manual(s) keep their ` +
      `${CONDENSED_SECTION_COUNT}-section shape`,
  );
}

const isMain =
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;
if (isMain) {
  main();
}
