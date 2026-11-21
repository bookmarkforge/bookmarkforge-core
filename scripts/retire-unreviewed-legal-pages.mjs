#!/usr/bin/env node
/**
 * scripts/retire-unreviewed-legal-pages.mjs — remove the localized legal
 * pages that were never reviewed and never linked.
 *
 * The problem
 * -----------
 * scripts/generate-privacy-pages.mjs produced a legal page for 24 locales
 * out of scripts/privacy-translations.json — a file whose entries were
 * English copies of the English notice. The result was 24 pages that
 * declared `<html lang="cs">` (and 23 more) while serving English text,
 * advertised a 30-language hreflang cluster that the reviewed six never
 * joined, and were linked from nowhere: every landing footer points at
 * /privacy-and-terms.html.
 *
 * A legal notice in a language nobody reviewed is worse than no notice in
 * that language: GDPR Art. 12(1) requires the information to be given in a
 * form the data subject understands, and an English page wearing a Czech
 * `<html lang>` is neither. The six languages the project reviewed by hand
 * (en, es, fr, de, pt, it) keep their pages; the other 24 URLs now answer
 * with the authoritative English notice.
 *
 * The script is idempotent and only touches the legal pages.
 */
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LANDING_CODES,
  LEGAL_LOCALE_CODES,
} from "./landing-registry.mjs";

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(THIS_DIR, "..");
const PUBLIC = join(ROOT, "public");

/** The locales whose legal page is reviewed and stays. */
const REVIEWED = new Set(LEGAL_LOCALE_CODES);
/** The locales whose legal page is retired. */
const RETIRED = LANDING_CODES.filter((code) => !REVIEWED.has(code));

let removed = 0;
for (const code of RETIRED) {
  const file = join(PUBLIC, code, "privacy-and-terms.html");
  if (existsSync(file)) {
    unlinkSync(file);
    removed += 1;
  }
}
console.log(`removed ${removed} unreviewed legal page(s)`);

// ── Netlify: public/_redirects ───────────────────────────────────────────
const redirectsFile = join(PUBLIC, "_redirects");
let redirects = readFileSync(redirectsFile, "utf8");
let redirectChanges = 0;
for (const code of RETIRED) {
  const selfRewrite = `/${code}/privacy-and-terms.html  /${code}/privacy-and-terms.html  200`;
  const toEnglish = `/${code}/privacy-and-terms.html  /privacy-and-terms.html  301`;
  if (redirects.includes(selfRewrite)) {
    redirects = redirects.replace(selfRewrite, toEnglish);
    redirectChanges += 1;
  }
}
writeFileSync(redirectsFile, redirects, "utf8");
console.log(`public/_redirects: ${redirectChanges} route(s) now redirect to the English notice`);

console.log(
  `reviewed legal locales kept: ${[...REVIEWED].join(", ")}\n` +
    `retired: ${RETIRED.length} locale(s)`,
);
