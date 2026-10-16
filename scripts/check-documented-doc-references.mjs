#!/usr/bin/env node
/**
 * scripts/check-documented-doc-references.mjs
 *
 * Verify that live operational documentation does not point at files that no
 * longer exist or HTTP routes that the companion server no longer dispatches.
 *
 * The scan is deliberately narrower than a repository-wide text search:
 * historical audit entries and ADRs preserve retired names as evidence and
 * are not operational instructions. The live corpus is the root onboarding
 * docs, .github documentation/workflows, and documents marked `vivo` in
 * docs/docs-state-index.md, excluding those historical record families.
 *
 * RELATIVE LINKS (the second half of the contract)
 *
 * The original scan resolved only references rooted at a known top-level
 * directory (`docs/`, `scripts/`, …) or an explicit filename, so a Markdown
 * link written the way GitHub resolves it — `](user-manual-ar.md)` inside
 * `docs/`, or `](../TRADEMARKS.md)` — was never validated. That is how 50
 * links to localized manuals that do not exist and one link to a
 * `TRADEMARKS.md` living in the wrong directory survived while the gate
 * reported "all live references resolve".
 *
 * Relative link targets are now resolved against the directory of the document
 * that contains them. Because the tree currently carries known, reviewed
 * dangling links, the new rule is a RATCHET rather than a zero-tolerance gate
 * (the same shape as `check:no-spanish` and `check-docs-markdown`, ADR-028):
 * `scripts/documented-doc-references-baseline.json` freezes the current set,
 * each entry with the reason it is still tolerated, and the gate fails on
 *
 *   - a dangling relative link that is not in the baseline (a new one),
 *   - a baseline entry that resolves today (the debt was paid: delete the
 *     entry with `--update` so the ratchet cannot silently widen),
 *   - a baseline entry without a reason, or a changed scan fingerprint,
 *   - a dangling relative link with no baseline file at all.
 *
 * BASENAME REFERENCES (the third half of the contract)
 *
 * The first two rules only ever looked at references that already carried a
 * directory (`src/services/...`) or a relative Markdown link. A backticked
 * basename — `licenseKeys.ts`, `entitlement-guard.ts:152-165` — was never
 * resolved at all: a reference that named a file WITHOUT saying where it lives
 * passed even when the name was ambiguous in the tree or pinned a line range of
 * a file the reader cannot locate. That is how
 * docs/AUDIT-VAULT-LICENSES-2026-10-14.md kept a wrong path
 * (`server/license-public-key.ts`) next to a bare `licenseKeys.ts` in the same
 * table cell.
 *
 * Basename references are now resolved against the tree, and the rule is
 * deliberately narrow because a basename is not always a claim about this
 * repository — `ril_export.html` is a file the USER imports, `QuickCapture.tsx`
 * illustrates a naming convention, `CHANGELOG.md` is history. A reference fails
 * only when the name cannot be followed:
 *
 *   - it carries a line range (`file.ts:12-34`): evidence pins a location, so it
 *     must name the path — "line reference names a basename, not a path";
 *   - it matches two or more files: the reader cannot tell which one is meant —
 *     "ambiguous basename reference", naming the candidates.
 *
 * A name that identifies a file at the repository root (`README.md`,
 * `package.json`, `netlify.toml`) is accepted — the root is where a reader looks
 * for it, which is also how this gate has always resolved `package.json` — and
 * so is a name that identifies exactly one file elsewhere: that one is not
 * ambiguous today, and demanding a path would rewrite naming-convention prose
 * and historical records for no defect.
 *
 * `--update` rewrites the baseline from the tree; new entries are written with
 * an empty reason on purpose, so the gate keeps failing until a reviewer states
 * why each one is tolerated. Regenerating a baseline is a deliberate, reviewed
 * act, which is why this gate is not part of `gate-refresh.mjs`.
 *
 * Usage:
 *   node scripts/check-documented-doc-references.mjs
 *   node scripts/check-documented-doc-references.mjs --update
 */
import fs from "node:fs";
import path from "node:path";

const STATE_INDEX = "docs/docs-state-index.md";
const ROOT_DOCUMENTS = ["README.md", "AGENTS.md", "CONTRIBUTING.md", "OPEN-CORE.md"];
const DOCUMENT_EXTENSIONS = new Set([".md", ".yml", ".yaml"]);
/** Extensions a relative Markdown link must carry to be resolved as a file. */
export const RELATIVE_LINK_EXTENSIONS = new Set([".md", ".pdf", ".yml", ".yaml"]);
export const RELATIVE_LINK_BASELINE_PATH = "scripts/documented-doc-references-baseline.json";
export const RELATIVE_LINK_BASELINE_SCHEMA = "bmf.documented-doc-references-baseline/1";
/**
 * Extensions that identify a file this repository ships. A backticked token
 * carrying one of them and no directory component is a BASENAME REFERENCE: it
 * names a file without saying where that file lives.
 */
export const BASENAME_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".yml",
  ".yaml",
  ".html",
  ".css",
  ".sh",
  ".sql",
  ".toml",
]);
/** Build output, caches and test reports are not files a document can own. */
const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".d",
  ".next",
  "node_modules",
  "dist",
  "dist-extension",
  "coverage",
]);
const IGNORED_DIRECTORY_PREFIXES = ["test-results", "playwright-report"];
/** `` `name.ext` `` / `` `name.ext:12-34` `` as a whole token: no spaces, no path. */
const BASENAME_TOKEN_RE = /^([A-Za-z0-9_][A-Za-z0-9_.-]*)\.([A-Za-z0-9]{1,8})(?::(\d[0-9,\s-]*))?$/;
const BACKTICKED_SPAN_RE = /`([^`\n]+)`/g;
/** Bumped when the resolution rules change, so a narrowed scan fails closed. */
export const RELATIVE_LINK_FINGERPRINT =
  "relative-links/v1: markdown-link-targets, extension-gated, resolved against the document directory";
const HISTORICAL_DOC_RE = /^docs\/(?:ADR-\d+.*\.md|audit\.md|docs-state-index\.md)$/;
const EXAMPLE_DOC_RE = /^docs\/(?:sast-triage\.md|scripts-inventory-scanner-limits\.md|staging-smoke\.md)$/;
const EXPLICIT_HISTORICAL_REFS = new Set(["scripts/test-upstream-server.mjs"]);
const LOCAL_PATH_RE = /(?:^|[^A-Za-z0-9_.-])((?:docs|scripts|src|server|public|tests|eslint-rules|\.github|docker)\/[A-Za-z0-9_./-]+|(?:package\.json|tsconfig(?:\.[A-Za-z0-9_-]+)?\.json|vite\.config\.[A-Za-z0-9_.-]+))/g;
const ROUTE_RE = /\/(?:api\/[A-Za-z0-9._~:-]+(?:\/[A-Za-z0-9._~:-]+)*|health|admin|csp-report)(?:\?[A-Za-z0-9=&._~-]+)?/g;
/** `[label](target)` with an optional title; target cannot contain whitespace. */
const MARKDOWN_LINK_RE = /\[[^\]]*\]\(\s*([^)\s]+)/g;
const SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*:/;

function normalizeRelative(value) {
  return value.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function parseStateIndex(markdownText) {
  const rows = [];
  let inTable = false;
  for (const line of markdownText.split(/\r?\n/)) {
    const trimmed = line.trim();
    // English header is canonical (the generator no longer emits Spanish
    // notes); the Spanish one still parses so a pre-change inventory does not
    // read as an empty one.
    if (
      trimmed.startsWith("| Document | State | Note |") ||
      trimmed.startsWith("| Documento | Estado | Nota |") // i18n-allow — legacy anchor
    ) {
      inTable = true;
      continue;
    }
    if (!inTable) continue;
    if (trimmed.startsWith("|---")) continue;
    if (!trimmed.startsWith("|")) {
      inTable = false;
      continue;
    }
    const cells = trimmed.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 3) {
      inTable = false;
      continue;
    }
    rows.push({
      file: normalizeRelative(cells[0].replaceAll("`", "")),
      state: cells[1],
      note: cells[2],
    });
  }
  return rows;
}

function walkDocuments(directory, root, output = []) {
  if (!fs.existsSync(directory)) return output;
  const info = fs.statSync(directory);
  if (info.isFile()) {
    const extension = path.extname(directory).toLowerCase();
    if (DOCUMENT_EXTENSIONS.has(extension)) output.push(directory);
    return output;
  }
  for (const entry of fs.readdirSync(directory)) {
    if (entry === ".git" || entry === "node_modules") continue;
    walkDocuments(path.join(directory, entry), root, output);
  }
  return output;
}

export function liveDocumentFiles(root, stateIndexText) {
  const files = [];
  for (const relativePath of ROOT_DOCUMENTS) {
    const absolutePath = path.resolve(root, relativePath);
    if (fs.existsSync(absolutePath)) files.push(absolutePath);
  }
  files.push(...walkDocuments(path.resolve(root, ".github"), root));

  const rows = parseStateIndex(stateIndexText);
  for (const row of rows) {
    if (row.state !== "vivo" || HISTORICAL_DOC_RE.test(row.file)) continue;
    const absolutePath = path.resolve(root, row.file);
    if (fs.existsSync(absolutePath) && DOCUMENT_EXTENSIONS.has(path.extname(absolutePath).toLowerCase())) {
      files.push(absolutePath);
    }
  }
  return [...new Set(files)].sort();
}

function cleanLocalPath(value) {
  return normalizeRelative(value)
    .replace(/[),;:]+$/g, "")
    .replace(/\.$/, "");
}

function isConcreteLocalPath(candidate, line) {
  if (candidate.includes("*") || candidate.includes("<") || candidate.includes(">")) return false;
  // Bare directory/module names in prose are conventions, not filesystem
  // contracts. Concrete references must identify a file or package manifest.
  if (!path.extname(candidate) && !candidate.endsWith("package.json")) return false;
  return line.includes(`\`${candidate}\``) || line.includes(`](${candidate})`) || line.includes(`](${candidate}#`);
}

/**
 * Markdown link targets that a reader's client resolves relative to the
 * document: no scheme, no root-relative path, no pure anchor, and an extension
 * that identifies a document we ship.
 */
export function extractRelativeLinkTargets(line) {
  const targets = [];
  MARKDOWN_LINK_RE.lastIndex = 0;
  for (const match of line.matchAll(MARKDOWN_LINK_RE)) {
    let target = match[1].trim();
    if (target.startsWith("<") && target.endsWith(">")) target = target.slice(1, -1);
    if (!target || target.startsWith("#") || target.startsWith("/")) continue;
    if (SCHEME_RE.test(target)) continue;
    const withoutAnchor = target.split("#")[0];
    if (!withoutAnchor) continue;
    const extension = path.extname(withoutAnchor).toLowerCase();
    if (!RELATIVE_LINK_EXTENSIONS.has(extension)) continue;
    targets.push(withoutAnchor);
  }
  return [...new Set(targets)];
}

/**
 * Every file in the tree, keyed by basename (repo-relative paths, sorted).
 * Built once per scan so a basename reference can be resolved against the real
 * layout instead of guessed from the sentence around it.
 */
export function buildBasenameIndex(root) {
  const byBasename = new Map();
  const walk = (directory) => {
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue;
      if (IGNORED_DIRECTORY_PREFIXES.some((prefix) => entry.name.startsWith(prefix))) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const relativePath = normalizeRelative(path.relative(root, absolute));
      const list = byBasename.get(entry.name);
      if (list) list.push(relativePath);
      else byBasename.set(entry.name, [relativePath]);
    }
  };
  walk(root);
  for (const list of byBasename.values()) list.sort();
  return byBasename;
}

/**
 * Basename references in a line: backticked tokens that name a file (known
 * extension) and carry no directory. A token with a line range reports it, since
 * that shape claims a location rather than mentioning a name.
 */
export function extractBasenameReferences(line) {
  const references = [];
  const seen = new Set();
  BACKTICKED_SPAN_RE.lastIndex = 0;
  for (const match of line.matchAll(BACKTICKED_SPAN_RE)) {
    const span = match[1].trim();
    if (!span || span.includes("/") || seen.has(span)) continue;
    const parsed = BASENAME_TOKEN_RE.exec(span);
    if (!parsed) continue;
    const extension = `.${parsed[2].toLowerCase()}`;
    if (!BASENAME_EXTENSIONS.has(extension)) continue;
    seen.add(span);
    references.push({
      reference: span,
      name: `${parsed[1]}${extension}`,
      lineSuffix: parsed[3] ?? null,
    });
  }
  return references;
}

/**
 * Verdict for one basename reference, or null when the name is followable (see
 * the BASENAME REFERENCES note in this file's header for why the tolerant cases
 * are tolerated).
 */
export function classifyBasenameReference(reference, matches) {
  if (matches.includes(reference.name)) return null;
  if (reference.lineSuffix) return "unnamed_path";
  if (matches.length > 1) return "ambiguous";
  return null;
}

export function extractReferencesFromLine(line) {
  const localPaths = [];
  LOCAL_PATH_RE.lastIndex = 0;
  for (const match of line.matchAll(LOCAL_PATH_RE)) {
    const candidate = cleanLocalPath(match[1]);
    if (isConcreteLocalPath(candidate, line)) localPaths.push(candidate);
  }

  const routes = [];
  ROUTE_RE.lastIndex = 0;
  for (const match of line.matchAll(ROUTE_RE)) {
    const candidate = match[0].replace(/[),.;:]+$/g, "");
    const suffix = line.slice((match.index ?? 0) + match[0].length);
    // Wildcard examples describe a family rather than a dispatchable route.
    if (!candidate.includes("*") && !candidate.includes("{") && !suffix.startsWith("*") && !suffix.startsWith("/*")) {
      routes.push(candidate.split("?")[0]);
    }
  }
  return {
    localPaths: [...new Set(localPaths)],
    routes: [...new Set(routes)],
  };
}

export function extractRoutePolicies(routeTableText) {
  const policies = [];
  const pathPattern = /\bpath\s*:\s*["']([^"']+)["']/g;
  for (const match of routeTableText.matchAll(pathPattern)) {
    if (match[1].startsWith("/")) policies.push(match[1]);
  }
  return [...new Set(policies)];
}

function routeIsDeclared(route, policies) {
  return policies.some((policy) => route === policy || route.startsWith(`${policy}/`));
}

export function loadRelativeLinkBaseline(root) {
  const absolutePath = path.resolve(root, RELATIVE_LINK_BASELINE_PATH);
  if (!fs.existsSync(absolutePath)) {
    return { path: RELATIVE_LINK_BASELINE_PATH, exists: false, fingerprint: null, entries: [], issues: [] };
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  } catch (error) {
    return {
      path: RELATIVE_LINK_BASELINE_PATH,
      exists: true,
      fingerprint: null,
      entries: [],
      issues: [`baseline is not valid JSON: ${error.message}`],
    };
  }
  const issues = [];
  if (parsed?.schema !== RELATIVE_LINK_BASELINE_SCHEMA) {
    issues.push(`baseline schema mismatch (expected ${RELATIVE_LINK_BASELINE_SCHEMA})`);
  }
  if (parsed?.fingerprint !== RELATIVE_LINK_FINGERPRINT) {
    issues.push(
      "baseline fingerprint does not match the current resolution rules — the scan scope moved, " +
        "so the frozen set cannot be trusted; re-review and regenerate with --update",
    );
  }
  const entries = Array.isArray(parsed?.knownMissingLinks) ? parsed.knownMissingLinks : [];
  if (!Array.isArray(parsed?.knownMissingLinks)) issues.push("baseline is missing knownMissingLinks[]");
  return { path: RELATIVE_LINK_BASELINE_PATH, exists: true, fingerprint: parsed?.fingerprint ?? null, entries, issues };
}

/**
 * Compare the dangling relative links found in the tree against the frozen set.
 * A dangling link with no baseline at all fails: a missing baseline is a
 * decision nobody made, not a pass (same rule as `check:no-spanish`).
 */
export function evaluateRelativeLinkBaseline({ missingRelativeLinks, baseline }) {
  const key = (item) => `${item.file}::${item.reference}`;
  const known = new Map(baseline.entries.map((entry) => [`${entry.file}::${entry.reference}`, entry ?? {}]));
  const newLinks = missingRelativeLinks.filter((item) => !known.has(key(item)));
  const staleEntries = baseline.entries.filter(
    (entry) => !missingRelativeLinks.some((item) => key(item) === `${entry.file}::${entry.reference}`),
  );
  const unexplained = baseline.entries.filter((entry) => !entry?.reason || !String(entry.reason).trim());
  const issues = [];
  if (missingRelativeLinks.length > 0 && !baseline.exists) {
    issues.push(
      `no baseline at ${RELATIVE_LINK_BASELINE_PATH} while ${missingRelativeLinks.length} relative link(s) dangle — ` +
        "run `node scripts/check-documented-doc-references.mjs --update` and justify each entry",
    );
  }
  issues.push(...baseline.issues);
  for (const entry of unexplained) {
    issues.push(`baseline entry needs a reason: ${entry?.file}:${entry?.reference}`);
  }
  return { newLinks, staleEntries, unexplained, issues };
}

export function scanDocumentReferences({ root, stateIndexText, routeTableText, baseline }) {
  const files = liveDocumentFiles(root, stateIndexText);
  const policies = extractRoutePolicies(routeTableText);
  const resolvedBaseline = baseline ?? loadRelativeLinkBaseline(root);
  const missingFiles = [];
  const basenameFindings = [];
  const basenameIndex = buildBasenameIndex(root);
  const retiredRoutes = [];
  const missingRelativeLinks = [];
  let localReferences = 0;
  let basenameReferences = 0;
  let routeReferences = 0;
  let relativeLinkReferences = 0;

  for (const file of files) {
    const relativeFile = normalizeRelative(path.relative(root, file));
    const documentDirectory = path.dirname(file);
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    let inFence = false;
    lines.forEach((lineText, index) => {
      if (/^\s*(```|~~~)/.test(lineText)) {
        inFence = !inFence;
        return;
      }
      if (inFence || EXAMPLE_DOC_RE.test(relativeFile)) return;
      // Explicitly historical/planned prose is not an active contract: it
      // records a removed component or names a file to create after a future
      // external run. Active Markdown links and concrete commands remain
      // checked.
      if (/\b(?:Removed|Retirada|Pendiente:.*(?:crear|registrar)|crear el archivo)\b/i.test(lineText)) return;
      const references = extractReferencesFromLine(lineText);
      for (const referencedPath of references.localPaths) {
        localReferences += 1;
        if (EXPLICIT_HISTORICAL_REFS.has(referencedPath)) continue;
        const target = path.resolve(root, referencedPath.split("#")[0]);
        if (!fs.existsSync(target)) {
          missingFiles.push({ file: relativeFile, line: index + 1, reference: referencedPath });
        }
      }
      for (const reference of extractBasenameReferences(lineText)) {
        basenameReferences += 1;
        const matches = basenameIndex.get(reference.name) ?? [];
        const verdict = classifyBasenameReference(reference, matches);
        if (!verdict) continue;
        basenameFindings.push({
          file: relativeFile,
          line: index + 1,
          reference: reference.reference,
          kind: verdict,
          candidates: matches,
        });
      }

      for (const target of extractRelativeLinkTargets(lineText)) {
        relativeLinkReferences += 1;
        if (!fs.existsSync(path.resolve(documentDirectory, target))) {
          missingRelativeLinks.push({ file: relativeFile, line: index + 1, reference: target });
        }
      }
      for (const route of references.routes) {
        const routeEnd = lineText.indexOf(route) + route.length;
        if (lineText.slice(routeEnd).startsWith("*")) continue;
        routeReferences += 1;
        if (!routeIsDeclared(route, policies)) {
          retiredRoutes.push({ file: relativeFile, line: index + 1, reference: route });
        }
      }
    });
  }

  const relativeVerdict = evaluateRelativeLinkBaseline({ missingRelativeLinks, baseline: resolvedBaseline });
  return {
    ok:
      missingFiles.length === 0 &&
      basenameFindings.length === 0 &&
      retiredRoutes.length === 0 &&
      relativeVerdict.newLinks.length === 0 &&
      relativeVerdict.staleEntries.length === 0 &&
      relativeVerdict.issues.length === 0,
    files,
    policies,
    localReferences,
    basenameReferences,
    routeReferences,
    relativeLinkReferences,
    missingFiles,
    basenameFindings,
    retiredRoutes,
    missingRelativeLinks,
    baseline: resolvedBaseline,
    newRelativeLinks: relativeVerdict.newLinks,
    staleRelativeLinks: relativeVerdict.staleEntries,
    baselineIssues: relativeVerdict.issues,
  };
}

/** Rewrite the baseline from the tree, preserving the reasons already reviewed. */
export function writeRelativeLinkBaseline(root, missingRelativeLinks, previousBaseline) {
  const previousReasons = new Map(
    (previousBaseline?.entries ?? []).map((entry) => [`${entry.file}::${entry.reference}`, entry.reason ?? ""]),
  );
  const entries = [...missingRelativeLinks]
    .map((item) => ({
      file: item.file,
      reference: item.reference,
      reason: previousReasons.get(`${item.file}::${item.reference}`) ?? "",
    }))
    .sort((a, b) => `${a.file}:${a.reference}`.localeCompare(`${b.file}:${b.reference}`));
  const absolutePath = path.resolve(root, RELATIVE_LINK_BASELINE_PATH);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(
    absolutePath,
    `${JSON.stringify(
      {
        schema: RELATIVE_LINK_BASELINE_SCHEMA,
        fingerprint: RELATIVE_LINK_FINGERPRINT,
        note:
          "Frozen dangling relative links in live documents. The gate fails when this set grows, when an entry " +
          "resolves today (pay the debt and drop the entry), or when an entry has no reason.",
        knownMissingLinks: entries,
      },
      null,
      2,
    )}\n`,
  );
  return { path: RELATIVE_LINK_BASELINE_PATH, entries };
}

function main() {
  const root = path.resolve(process.env.DOCUMENTED_DOC_REFERENCES_ROOT ?? process.cwd());
  const update = process.argv.includes("--update");
  const indexPath = path.resolve(root, STATE_INDEX);
  const routeTablePath = path.resolve(root, "server/src/route-table.ts");
  if (!fs.existsSync(indexPath)) {
    console.error(`[check:documented-doc-references] FAIL missing ${STATE_INDEX}`);
    process.exitCode = 1;
    return;
  }
  if (!fs.existsSync(routeTablePath)) {
    console.error("[check:documented-doc-references] FAIL missing server/src/route-table.ts");
    process.exitCode = 1;
    return;
  }

  const baseline = loadRelativeLinkBaseline(root);
  const result = scanDocumentReferences({
    root,
    stateIndexText: fs.readFileSync(indexPath, "utf8"),
    routeTableText: fs.readFileSync(routeTablePath, "utf8"),
    baseline,
  });

  if (update) {
    const written = writeRelativeLinkBaseline(root, result.missingRelativeLinks, baseline);
    console.log(
      `[check:documented-doc-references] ${written.path}: ${written.entries.length} known dangling relative link(s) recorded`,
    );
    const withoutReason = written.entries.filter((entry) => !entry.reason);
    if (withoutReason.length > 0) {
      console.error(
        `[check:documented-doc-references] FAIL ${withoutReason.length} new baseline entr(ies) carry no reason — ` +
          "state why each tolerated link is allowed before this gate can pass",
      );
      process.exitCode = 1;
      return;
    }
    return;
  }

  console.log(
    `[check:documented-doc-references] scanned ${result.files.length} live documents, ` +
      `${result.localReferences} local references, ${result.relativeLinkReferences} relative link(s) and ` +
      `${result.routeReferences} route references`,
  );
  for (const item of result.missingFiles) {
    console.error(
      `[check:documented-doc-references] FAIL ${item.file}:${item.line}: ` +
        `local reference does not exist: ${item.reference}`,
    );
  }
  for (const item of result.basenameFindings) {
    const matched =
      item.candidates.length > 0 ? ` (matched: ${item.candidates.join(", ")})` : "";
    const reason =
      item.kind === "ambiguous"
        ? "ambiguous basename reference"
        : "line reference names a basename, not a path";
    console.error(
      `[check:documented-doc-references] FAIL ${item.file}:${item.line}: ` +
        `${reason}: ${item.reference} — write the full repo-relative path${matched}`,
    );
  }
  for (const item of result.retiredRoutes) {
    console.error(
      `[check:documented-doc-references] FAIL ${item.file}:${item.line}: ` +
        `route is not declared by server/src/route-table.ts: ${item.reference}`,
    );
  }
  for (const item of result.newRelativeLinks) {
    console.error(
      `[check:documented-doc-references] FAIL ${item.file}:${item.line}: ` +
        `relative link does not resolve: ${item.reference}`,
    );
  }
  for (const entry of result.staleRelativeLinks) {
    console.error(
      `[check:documented-doc-references] FAIL ${entry.file}: ${entry.reference} is listed as dangling but resolves — ` +
        "drop the entry with --update so the ratchet shrinks",
    );
  }
  for (const issue of result.baselineIssues) {
    console.error(`[check:documented-doc-references] FAIL ${issue}`);
  }
  if (!result.ok) {
    process.exitCode = 1;
    return;
  }
  console.log("[check:documented-doc-references] all live references resolve");
}

const isMain = process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1].replaceAll("\\", "/")}`).href;
if (isMain) main();
