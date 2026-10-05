#!/usr/bin/env node
/**
 * check-removed-deps — pruned dependencies must not come back into `src/`.
 *
 * Why this exists: `md-to-pdf`, `puppeteer` and `markdown-it` were pruned when
 * nothing in the tree imported them any more. Dropping them from
 * package.json is not enough to keep them out, because the failure mode is
 * silent and cheap to reproduce: `markdown-it` is the obvious-looking way to
 * render Markdown, `md-to-pdf`/`puppeteer` are the obvious-looking way to emit a
 * PDF, and the import only breaks where the bundler resolves it (or, worse,
 * gets "fixed" by re-declaring the dependency, quietly restoring the install
 * weight and the Node-only API surface that the pruning removed from code that
 * has to run in a browser tab).
 *
 * Invariant: no file under the scanned scopes (`src/` by default — the browser
 * and extension surface) references any of the pruned packages.
 *
 * The scan is syntax-aware (TypeScript parser), so only a real *module
 * reference* counts:
 *   - static `import` / `export … from` / `import … = require(…)`;
 *   - side-effect `import "pkg"` and type-only `import type …  from "pkg"`;
 *   - dynamic `import("pkg")`, `require("pkg")` and `require.resolve("pkg")`;
 *   - the test runners' module helpers, which also load by name:
 *     `vi.mock` / `vi.doMock` / `vi.unmock` / `vi.importActual` /
 *     `vi.importMock` and the `jest.requireActual` / `jest.requireMock` twins.
 * A mention inside a comment, a longer string, or a Markdown file is *not* a
 * reference — and neither is a string that merely *names* the package:
 * `userAgent.includes("puppeteer")` in the automation heuristic of
 * src/utils/environmentDetection.ts is the real case in this tree, and flagging
 * it would make the gate lie. Only the callees above count (a module loaded
 * through a locally-bound require alias is out of reach: this is a regression
 * guard, not a sandbox). Subpaths count (`md-to-pdf/dist/x`); a different
 * package that merely shares the prefix (`markdown-it-emoji`, `puppeteer-core`,
 * `@types/markdown-it`) does not.
 *
 * Retiring the list: if one of these packages earns a real consumer again, make
 * it deliberate and visible — re-declare it in package.json and drop it from
 * REMOVED_PACKAGES in the same commit, with the reason in the message.
 *
 * Env overrides (both optional, used by the tests):
 *   BMF_REMOVED_DEPS_ROOT   scan another checkout
 *   BMF_REMOVED_DEPS_SCOPES comma-separated scope list (default: src)
 *
 * Exit codes: 0 = clean, 1 = a pruned package is referenced again.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import process from "node:process";
import ts from "typescript";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = join(SCRIPT_DIR, "..");

/** Packages that were pruned and must not be re-imported.
 *
 * `@whop/sdk`: pruned together with its only consumer, the dead browser-side
 * `src/services/WhopService.ts` (nothing imported it; its `WHOP_API_KEY`
 * account key must never reach the client bundle — license validation lives
 * server-side in `server/src/license-server.ts`). Pinning it here makes a
 * future re-import into `src/` fail CI instead of silently restoring a
 * payment SDK and a Node-only env read to the browser surface. */
export const REMOVED_PACKAGES = ["@whop/sdk", "md-to-pdf", "markdown-it", "puppeteer"];

/** Scopes scanned from the repo root; `src/` is the browser + extension code. */
export const DEFAULT_SCOPES = ["src"];

const SCAN_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);

const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".git",
  ".vite",
  "test-results",
  "playwright-report",
  "storybook-static",
]);

/**
 * The pruned package a specifier refers to, or null.
 *
 * `owner/repo`-style exact matches and subpaths only: `markdown-it-emoji` is a
 * different package from `markdown-it`, and `puppeteer-core` from `puppeteer`.
 */
export function prunedPackageIn(specifier) {
  return (
    REMOVED_PACKAGES.find(
      (pkg) => specifier === pkg || specifier.startsWith(`${pkg}/`),
    ) ?? null
  );
}

/**
 * Callers that resolve a module by name.
 *
 * The string argument is only a module *reference* when the callee actually
 * loads modules. Anything else that happens to take the package name as a
 * string — a user-agent check, a list of blocked tools — is a string, not a
 * dependency.
 */
export function isModuleLoaderCall(calleeText) {
  if (calleeText === "import" || calleeText === "require") return true;
  if (calleeText === "import.meta.resolve") return true;
  if (calleeText.endsWith("require.resolve")) return true;
  return /\.(?:mock|doMock|unmock|importActual|importMock|requireActual|requireMock)$/.test(
    calleeText,
  );
}

function scriptKindFor(relPath) {
  return /\.[jt]sx$/.test(relPath) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

/**
 * Every module reference to a pruned package in `source`.
 *
 * @param {string} source file contents
 * @param {string} relPath repo-relative path (drives the JSX script kind)
 * @returns {Array<{specifier: string, package: string, kind: string, line: number}>}
 */
export function scanSource(source, relPath = "file.ts") {
  const sf = ts.createSourceFile(
    relPath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(relPath),
  );
  const references = [];
  const lineOf = (node) =>
    sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

  const record = (specNode, kind) => {
    const pkg = prunedPackageIn(specNode.text);
    if (!pkg) return;
    references.push({
      specifier: specNode.text,
      package: pkg,
      kind,
      line: lineOf(specNode),
    });
  };

  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      record(node.moduleSpecifier, "import");
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      record(node.moduleSpecifier, "export-from");
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      record(node.moduleReference.expression, "import-require");
    } else if (ts.isCallExpression(node)) {
      const first = node.arguments[0];
      if (first && ts.isStringLiteralLike(first)) {
        const callee = node.expression.getText(sf);
        if (isModuleLoaderCall(callee)) record(first, callee);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

  return references;
}

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let stats;
    try {
      stats = statSync(full);
    } catch {
      continue;
    }
    if (stats.isDirectory()) walk(full, out);
    else if (stats.isFile() && SCAN_EXTENSIONS.has(extname(entry))) out.push(full);
  }
  return out;
}

/**
 * Scan the scopes and return every reference to a pruned package.
 *
 * @param {string} root repo root to scan
 * @param {string[]} scopes repo-relative directories to scan
 * @returns {{references: Array<{file: string, specifier: string, package: string, kind: string, line: number}>, scanned: number}}
 */
export function checkRemovedDeps(root = DEFAULT_ROOT, scopes = DEFAULT_SCOPES) {
  const references = [];
  let scanned = 0;

  for (const scope of scopes) {
    for (const file of walk(join(root, scope))) {
      const source = readFileSync(file, "utf8");
      scanned += 1;
      // Fast path: the parser only runs on files that even mention a pruned
      // package, so the cost of the gate is a substring scan of the tree.
      if (!REMOVED_PACKAGES.some((pkg) => source.includes(pkg))) continue;
      const rel = relative(root, file).split("\\").join("/");
      for (const ref of scanSource(source, rel)) references.push({ file: rel, ...ref });
    }
  }

  return { references, scanned };
}

function main() {
  const root = resolve(process.env.BMF_REMOVED_DEPS_ROOT ?? DEFAULT_ROOT);
  const scopes = process.env.BMF_REMOVED_DEPS_SCOPES
    ? process.env.BMF_REMOVED_DEPS_SCOPES.split(",")
        .map((scope) => scope.trim())
        .filter(Boolean)
    : DEFAULT_SCOPES;
  const { references, scanned } = checkRemovedDeps(root, scopes);

  if (references.length > 0) {
    console.error(
      `[check-removed-deps] FAIL: ${references.length} reference(s) to a pruned dependency — ` +
        `${REMOVED_PACKAGES.join(", ")} were removed from package.json because nothing imported them`,
    );
    for (const ref of references) {
      console.error(`  ${ref.file}:${ref.line} — "${ref.specifier}" (${ref.kind})`);
    }
    console.error(
      "  remedy: use the in-repo path instead (the export/print flows are browser-side), or — if the " +
        "package is genuinely needed again — re-declare it in package.json and drop it from " +
        "REMOVED_PACKAGES in scripts/check-removed-deps.mjs in the same commit, with the reason.",
    );
    process.exit(1);
  }

  console.log(
    `[check-removed-deps] ok: no ${scopes.join("/, ")} file references the pruned packages ` +
      `(${REMOVED_PACKAGES.join(", ")}); ${scanned} file(s) scanned`,
  );
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main();
}
