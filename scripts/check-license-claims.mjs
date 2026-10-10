#!/usr/bin/env node
/**
 * scripts/check-license-claims.mjs
 *
 * CI gate: the BookmarkForge Core is MIT (root LICENSE, package.json
 * of the exported public repo, the open-core model in OPEN-CORE.md
 * and the exported public LICENSE). The private checkout uses dual
 * license notation. This gate exists because one documentation wave
 * still shipped AGPL-3.0 across thirty localized manuals, their PDFs,
 * a landing comparison page and the API metadata: legal drift,
 * exactly the class of error this gate must catch before it reaches
 * the public repository.
 *
 * It enforces two directions:
 *
 *  1. Negative scan — no third-party license token (AGPL, GPL, Apache-2.0,
 *     MPL, EUPL, EPL, CC-BY, ...) may appear in the user-visible corpus:
 *     localized user manuals, landings and their translation sources, legal
 *     pages, the public API metadata, and the two lockfile entries that name
 *     THIS package. A license mentioned in marketing is a claim, not a
 *     dependency fact, so nothing in the corpus may name a non-MIT license.
 *     Package-lock entries of real dependencies are dependency facts and are
 *     not scanned: many dependencies are legitimately MIT-variant, BSD or
 *     Apache.
 *  2. Positive claims — the canonical MIT claims must still exist and be
 *     consistent: the public repo's `package.json` says `"license": "MIT"`,
 *     the root `LICENSE` is the MIT text, the OpenAPI license is MIT, and
 *     every user manual carrying a license header says MIT. In the private
 *     checkout, `package.json` uses the dual notation.
 *
 * Style note: the negative scan is denylist-based on purpose. An allowlist of
 * every MIT formulation would break the next legitimate wording ("dual
 * licensed", a NOTICE reference, ...) and hide the very drift this gate
 * exists for. If a new false positive appears, narrow this file's patterns —
 * never bypass the gate.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { LANDING_CODES, MANUAL_FILES } from "./landing-registry.mjs";

const DEFAULT_ROOT = process.cwd();
const THIS_DIR = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = join(THIS_DIR, "..");

// ---------------------------------------------------------------------------
// Scanned corpus (user-visible license claims)
// ---------------------------------------------------------------------------

/**
 * The localized manual family, DERIVED from the MANUAL_FILES table in
 * scripts/landing-registry.mjs (endonym basenames like `manual-de-usuario-es`,
 * `benutzerhandbuch-de`, `user-manual-ja`) — the same single source the
 * figures gate, the PDF generator and the exporter use, so a renamed or added
 * manual cannot drift out of the license corpus.
 */
const MANUAL_NAMES = LANDING_CODES.map((code) => MANUAL_FILES[code]);

/** Root-relative corpus entries (forward-slash paths, OS-independent). Missing
 * required entries are reported separately, not silently skipped. Entries
 * marked `optional: true` are scanned when present but may be absent in a
 * re-curated tree: the public export drops the `-styled.html` print twins
 * (not in its PUBLIC_DOCS set) and the `scripts/public-export/` overlay
 * sources themselves (private-repo tooling by definition).
 */
function corpusEntries() {
  const entries = [];
  const add = (rel, extra = {}) => entries.push({ rel, kind: "manual", ...extra });

  // Manual sources in docs/ (md + styled html + generated pdf).
  for (const name of MANUAL_NAMES) {
    add(`docs/${name}.md`);
    add(`docs/${name}-styled.html`, { optional: true });
    add(`docs/${name}.pdf`);
  }

  // Public overlay copies (the exported public repo ships the es/en pair).
  for (const code of ["es", "en"]) {
    const name = MANUAL_FILES[code];
    add(`scripts/public-export/${name}.md`, { optional: true });
    add(`scripts/public-export/${name}.pdf`, { optional: true });
  }

  // Landing pages and their translation sources.
  entries.push({ rel: "public/pocket-alternative.html", kind: "landing" });
  entries.push({
    rel: "scripts/translations/pocket-alternative-en.json",
    kind: "landing",
  });

  // Legal / terms pages and their translation source.
  entries.push({ rel: "public/privacy-and-terms.html", kind: "legal" });
  entries.push({ rel: "scripts/privacy-translations.json", kind: "legal" });

  // API metadata.
  entries.push({ rel: "docs/openapi.yaml", kind: "api-metadata" });

  // Lockfile metadata that names THIS package — dependency licenses elsewhere
  // in the file are facts, not claims, and stay unscanned.
  entries.push({ rel: "package-lock.json", kind: "lockfile-self" });
  entries.push({ rel: "package.json", kind: "package-manifest" });

  return entries;
}

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

/**
 * Denylist tokens that would be wrong in any user-visible license claim of
 * this project. Every non-MIT SPDX identifier we plausibly could be confused
 * with, plus common prose spellings, including their lowercase forms.
 */
const LICENSE_TOKENS = [
  /AGPL/i,
  /\bLGPL\b/,
  /\bGPLv?[23]\b/,
  /\bGPL-?[23]\.(?:0|1)\b/,
  /Affero/i,
  /\bApache-2\.0\b/,
  /\bApache License\b/,
  /\bMPL-2\.0\b/,
  /\bMozilla Public License\b/,
  /\bEUPL\b/,
  /\bEPL-2\.0\b/,
  /\bEclipse Public License\b/,
  /\bBSD-[23]-Clause\b/,
  /\bCC-BY(?:-SA|-NC|-ND)?\b/,
  /\bCreative Commons\b/,
  /\bUnlicense\b/,
  /\bWTFPL\b/,
  /\bProprietary License\b/i,
];

const MIT_WORD = /\bMIT\b/;
const MIT_URL = /opensource\.org\/licenses\/MIT/;

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

/**
 * Text extractors. PDFs: score-based linear scan — extract all
 * ASCII-printable runs, keep the ones that look like license vocabulary.
 * Much more robust than assuming a fixed text-object window.
 */
function extractPdfLicenseText(buffer) {
  const latin = buffer.toString("latin1");
  const runs = [];
  const runRe = /[\x20-\x7E]{4,}/g;
  let match;
  while ((match = runRe.exec(latin)) !== null) runs.push(match[0]);

  const LICENSE_RE =
    /licen[cs]e|agpl|gpl|lgpl|apache|mit\b|copyright/i;
  const NOISE_RE =
    /^[-+. /()0-9]+$|file|line|length|filter|index|object|stream|trailer|page|font|type|subtype|creator|producer|bookmarkforge|last updated/i;

  return runs
    .filter((run) => LICENSE_RE.test(run))
    .filter((run) => !NOISE_RE.test(run))
    .join(" ");
}

function extractText(buffer) {
  return buffer.toString("utf8");
}

function contentOf(absPath) {
  const buffer = readFileSync(absPath);
  if (absPath.toLowerCase().endsWith(".pdf")) return extractPdfLicenseText(buffer);
  return extractText(buffer);
}

function scanEntry(entry, root) {
  const absPath = join(root, entry.rel);

  // Lockfile self entry: parse instead of pattern-scan, so dependency license
  // metadata anywhere in the file can never trip the gate and the check is
  // independent of npm's pretty-printing.
  if (entry.kind === "lockfile-self") {
    const problems = [];
    try {
      const lock = JSON.parse(readFileSync(absPath, "utf8"));
      const selfLicense = lock.packages?.[""]?.license ?? lock.license;
      if (selfLicense !== "MIT" && selfLicense !== "SEE LICENSE IN LICENSE AND PRO-LICENSE.md") {
        problems.push(`self entry license must be "MIT" or the dual notation (found ${JSON.stringify(selfLicense ?? null)})`);
      }
    } catch (error) {
      problems.push(`not valid JSON (${error.message})`);
    }
    return { ok: problems.length === 0, rel: entry.rel, problems };
  }

  const text = contentOf(absPath);

  const problems = [];
  for (const pattern of LICENSE_TOKENS) {
    if (pattern.test(text)) problems.push(`mentions a non-MIT license (${pattern})`);
  }

  // Positive claims: wherever this entry carries a license statement, it must
  // say MIT. Only enforced on kinds whose corpus is known to carry one.
  if (entry.kind === "manual" && /licen[cs]e\s*[:：]/i.test(text)) {
    if (!MIT_WORD.test(text)) {
      problems.push(`carries a license statement but does not say MIT`);
    }
  }
  if (entry.kind === "api-metadata") {
    if (!MIT_WORD.test(text) && !MIT_URL.test(text)) {
      problems.push(`OpenAPI license must be MIT`);
    }
  }

  return { ok: problems.length === 0, rel: entry.rel, problems };
}

// ---------------------------------------------------------------------------
// Positive contract: root manifest, LICENSE text and OpenAPI
// ---------------------------------------------------------------------------

export function verifyLicenseContract(root = REPO_ROOT) {
  const failures = [];

  const pkgPath = join(root, "package.json");
  if (!existsSync(pkgPath)) {
    failures.push("package.json: missing (the scanned corpus needs a manifest root)");
  } else {
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    } catch (error) {
      pkg = null;
      failures.push(`package.json: not valid JSON (${error.message})`);
    }
  if (pkg && pkg.license !== "MIT" && pkg.license !== "SEE LICENSE IN LICENSE AND PRO-LICENSE.md") {
      failures.push(`package.json: license must be "MIT" or dual-license notation (found ${JSON.stringify(pkg.license ?? null)})`);
    }
  }

  const licensePath = join(root, "LICENSE");
  if (!existsSync(licensePath)) {
    failures.push("LICENSE: missing — the Core ships under the MIT license");
  } else {
    const licenseText = readFileSync(licensePath, "utf8");
    if (!/MIT License/.test(licenseText)) {
      failures.push('LICENSE: does not look like the MIT text (missing "MIT License")');
    }
    for (const pattern of LICENSE_TOKENS) {
      if (pattern.test(licenseText)) {
        failures.push(`LICENSE: mentions a non-MIT license (${pattern})`);
      }
    }
    if (!MIT_WORD.test(licenseText)) {
      failures.push("LICENSE: does not mention MIT");
    }
  }

  return failures;
}

// ---------------------------------------------------------------------------
// Scan driver
// ---------------------------------------------------------------------------

export function scanLicenseCorpus(root = REPO_ROOT) {
  const contentFailures = [];
  const missing = [];
  for (const entry of corpusEntries()) {
    const absPath = join(root, entry.rel);
    if (!existsSync(absPath)) {
      if (!entry.optional) missing.push(entry.rel);
      continue;
    }
    const result = scanEntry(entry, root);
    if (!result.ok) {
      for (const problem of result.problems) {
        contentFailures.push(`${entry.rel}: ${problem}`);
      }
    }
  }
  return { contentFailures, missing };
}

export function runLicenseGate(root = REPO_ROOT) {
  const contractFailures = verifyLicenseContract(root);
  const { contentFailures, missing } = scanLicenseCorpus(root);
  return { contractFailures, corpusFailures: contentFailures, missing };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main() {
  const root = DEFAULT_ROOT;
  const { contractFailures, corpusFailures, missing } = runLicenseGate(root);

  const failures = [...contractFailures, ...corpusFailures];
  if (failures.length || missing.length) {
    console.error(`[check-license-claims] FAIL: license claim contract is broken:`);
    for (const failure of failures) console.error(`  - ${failure}`);
    for (const rel of missing) console.error(`  - ${rel}: missing from the repository`);
    process.exit(1);
  }
  console.log(
    `[check-license-claims] ok: no non-MIT license tokens in the user-visible corpus; MIT contract intact`,
  );
}

const isMain =
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;
if (isMain) {
  main();
}
