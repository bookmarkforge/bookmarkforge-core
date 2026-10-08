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
 */
import fs from "node:fs";
import path from "node:path";

const STATE_INDEX = "docs/docs-state-index.md";
const ROOT_DOCUMENTS = ["README.md", "AGENTS.md", "CONTRIBUTING.md", "OPEN-CORE.md"];
const DOCUMENT_EXTENSIONS = new Set([".md", ".yml", ".yaml"]);
const HISTORICAL_DOC_RE = /^docs\/(?:ADR-\d+.*\.md|audit\.md|docs-state-index\.md)$/;
const EXAMPLE_DOC_RE = /^docs\/(?:sast-triage\.md|scripts-inventory-scanner-limits\.md|staging-smoke\.md)$/;
const EXPLICIT_HISTORICAL_REFS = new Set(["scripts/test-upstream-server.mjs"]);
const LOCAL_PATH_RE = /(?:^|[^A-Za-z0-9_.-])((?:docs|scripts|src|server|public|tests|eslint-rules|\.github|docker)\/[A-Za-z0-9_./-]+|(?:package\.json|tsconfig(?:\.[A-Za-z0-9_-]+)?\.json|vite\.config\.[A-Za-z0-9_.-]+))/g;
const ROUTE_RE = /\/(?:api\/[A-Za-z0-9._~:-]+(?:\/[A-Za-z0-9._~:-]+)*|health|admin|csp-report)(?:\?[A-Za-z0-9=&._~-]+)?/g;

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

export function scanDocumentReferences({ root, stateIndexText, routeTableText }) {
  const files = liveDocumentFiles(root, stateIndexText);
  const policies = extractRoutePolicies(routeTableText);
  const missingFiles = [];
  const retiredRoutes = [];
  let localReferences = 0;
  let routeReferences = 0;

  for (const file of files) {
    const relativeFile = normalizeRelative(path.relative(root, file));
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

  return {
    ok: missingFiles.length === 0 && retiredRoutes.length === 0,
    files,
    policies,
    localReferences,
    routeReferences,
    missingFiles,
    retiredRoutes,
  };
}

function main() {
  const root = path.resolve(process.env.DOCUMENTED_DOC_REFERENCES_ROOT ?? process.cwd());
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

  const result = scanDocumentReferences({
    root,
    stateIndexText: fs.readFileSync(indexPath, "utf8"),
    routeTableText: fs.readFileSync(routeTablePath, "utf8"),
  });
  console.log(
    `[check:documented-doc-references] scanned ${result.files.length} live documents, ` +
      `${result.localReferences} local references and ${result.routeReferences} route references`,
  );
  for (const item of result.missingFiles) {
    console.error(
      `[check:documented-doc-references] FAIL ${item.file}:${item.line}: ` +
        `local reference does not exist: ${item.reference}`,
    );
  }
  for (const item of result.retiredRoutes) {
    console.error(
      `[check:documented-doc-references] FAIL ${item.file}:${item.line}: ` +
        `route is not declared by server/src/route-table.ts: ${item.reference}`,
    );
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
