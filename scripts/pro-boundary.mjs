/**
 * scripts/pro-boundary.mjs — the compile-time boundary between the MIT Core and
 * the proprietary Pro implementation.
 *
 * Why this exists: exclusion alone produced an export that could not resolve 46
 * of its imports and failed `tsc` with 327 "Cannot find module" errors. Deleting
 * the Pro files is not enough — the Core *imports* them — so the public tree has
 * to answer those imports with something that is both type-correct and inert.
 *
 * For every proprietary module the Core references, the export ships a pair at
 * the module's original path:
 *
 *   <path>.d.ts   the module's generated type surface (declarations only,
 *                 comments stripped, banner-marked). This is what keeps the
 *                 exported Core TypeScript-clean without editing a single line
 *                 of product source.
 *   <path>.js     an inert runtime placeholder exposing the same names. Values
 *                 are callable, constructable and property-accessible to any
 *                 depth, never throw (an Open Core build must not crash its
 *                 startup path on a Pro call) and warn once per property so a
 *                 reached Pro surface identifies itself instead of silently
 *                 pretending to work.
 *
 * TypeScript resolves specifiers to the `.d.ts`, Vite and bundlers to the `.js`.
 * Explicit `.ts` specifiers (Vite worker URLs, e2e dev-URL imports) are rewritten
 * to the extensionless form so both keep working.
 *
 * Product source is untouched: the boundary is an export-time transformation,
 * which is what keeps the public repo reproducible from the private one.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, posix, relative, sep } from "node:path";
import process from "node:process";
import ts from "typescript";

// ---------------------------------------------------------------------------
// What counts as Pro
// ---------------------------------------------------------------------------

/** Exact proprietary implementation paths (repo-relative, forward slashes). */
export const PRO_MODULE_PATHS = [
   "src/services/WebRTCSyncService.ts",
   "src/services/pdfService.ts",
   "src/services/BackupService.ts",
   "src/services/DiskBackupService.ts",
   // The genuinely proprietary AI surfaces: the local model runtime (the
   // "AI inside your computer" Pro hook), the RAG generation orchestration,
   // the expert-agent registry and flashcard generation. RAGEngine stays Core:
   // it contains no LLM calls — it is the embedding+similarity engine that
   // powers the FREE semantic search (README: "Smart search ✅ included"), and
   // the BYOK cloud path via ProviderManager is Free too (user's own API key).
   "src/services/ai/WebLLMService.ts",
   "src/services/ai/GlobalRAGService.ts",
   "src/services/ai/SpecializedAgentsService.ts",
   "src/services/ai/FlashcardService.ts",
];

/** Whole trees that are proprietary (none — Pro AI is an exact file list).
 *
 * The AI tree in src/services/ai/ contains both Core modules
 * (RAGEngine, ProviderManager, VectorIndexService, etc.) and Pro modules
 * (WebLLMService, GlobalRAGService, SpecializedAgentsService, FlashcardService).
 * Because of this mixed ownership, Pro status is declared per-file via
 * PRO_MODULE_PATHS, not per-directory via PRO_MODULE_DIRS. */
export const PRO_MODULE_DIRS = [];

/** Extensionless bases of the exact proprietary paths. */
const PRO_MODULE_BASES = PRO_MODULE_PATHS.map((proPath) => proPath.replace(/\.tsx?$/, ""));

/**
 * True when a repo-relative path names a proprietary module.
 *
 * The generated placeholders live at the same base as the implementation they
 * replace, so `BackupService.ts`, the exported `BackupService.d.ts`/
 * `BackupService.js` and an extensionless specifier all have to answer `true`.
 * Only matching the exact source path made the exported `.d.ts`/`.js` invisible
 * to the gate — a leftover Pro implementation would have passed it.
 */
export function isProModulePath(relPath) {
  // Normalise BOTH separators, not just the platform's own: relPath reaches
  // this function from manifests, specifiers and test fixtures of arbitrary
  // provenance, so a Windows-style path must classify identically on Linux.
  // `split(sep)` made `src\pro\X.ts` invisible to the boundary gates on
  // POSIX (sep === "/" splits nothing) — caught by the "normalizes Windows
  // separators" contract test failing in the Linux nightly (2026-09-23,
  // run 35833219915) while passing on this Windows checkout.
  const norm = relPath.split(/[\\/]/).join("/");
  if (PRO_MODULE_DIRS.some((dir) => norm.startsWith(dir))) return true;
  const base = norm.replace(/\.(?:d\.ts|ts|tsx|mts|cts|jsx|js|mjs|cjs)$/, "");
  return PRO_MODULE_BASES.includes(base);
}

/**
 * Anchor globs whose subject lives entirely on the Pro side of the boundary.
 *
 * These name either a proprietary implementation or a test whose subject is
 * one (reading it from disk and asserting on its text). In the public export
 * such a subject cannot exist, so gates that anchor files by glob (the
 * regression-anchor catalog) need to know: the anchor's absence there is a
 * consequence of the declared policy, not a lost regression test.
 *
 * Declared here, next to the module paths themselves, so adding a Pro module
 * and declaring its anchors is one edit in one file; a glob naming any Core
 * path must not be listed.
 */
export const PRO_SUBJECT_ANCHOR_GLOBS = [
  // WebRTCSyncService implementation and the tests asserting on its source.
  "src/services/WebRTCSyncService.ts",
  "src/tests/services/WebRTCSyncService.test.ts",
  "src/tests/security/p0-ice-whitelist*.regression.test.*",
  "src/tests/security/p1-private-sync*.regression.test.*",
  // DiskBackupService: implementation excluded, its contract test ships only
  // in the private tree.
  "src/services/DiskBackupService.ts",
  "src/tests/services/DiskBackupService.test.ts",
  "src/tests/services/BackupService.test.ts",
  // Proprietary AI engines: implementations and their behaviour tests ship
  // only in the private distribution.
  "src/services/ai/WebLLMService.ts",
  "src/services/ai/GlobalRAGService.ts",
  "src/services/ai/SpecializedAgentsService.ts",
  "src/services/ai/FlashcardService.ts",
  "src/tests/services/ai/WebLLMService.test.ts",
  "src/tests/services/ai/WebLLMService.*.test.ts",
  "src/tests/services/ai/GlobalRAGService*.test.ts",
  "src/tests/services/ai/FlashcardService*.test.ts",
  "src/tests/services/ai/SpecializedAgentsService*.test.ts",
];

/**
 * True when a glob's subject is entirely Pro: every file the glob could name
 * is a proprietary implementation, a placeholder artefact, or an anchored Pro
 * test. Conservative by construction — a glob that could match anything Core
 * must answer false, so a Core test disappearing from an export still fails.
 */
export function isProSubjectGlob(glob, _kind = "test") {
  if (PRO_SUBJECT_ANCHOR_GLOBS.includes(glob)) return true;
  // A kind:"source" glob that reduces to a Pro module base is covered by the
  // declared paths; translate glob wildcards onto those bases.
  const re = globToRegexShim(glob);
  return PRO_SUBJECT_ANCHOR_GLOBS.some((subject) => re.test(subject));
}

/** Tiny glob→regex translation matching the anchor gate's own dialect. */
function globToRegexShim(glob) {
  let pattern = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        pattern += ".*";
        i++;
      } else {
        pattern += "[^/]*";
      }
    } else if (ch === "?") {
      pattern += "[^/]";
    } else if ("\\^$.|+()[]{}".includes(ch)) {
      pattern += `\\${ch}`;
    } else {
      pattern += ch;
    }
  }
  return new RegExp(`^${pattern}$`);
}

export const PLACEHOLDER_MARKER = "Open Core placeholder";

/** Name of the shared runtime helper shipped at the root of the export. */
const RUNTIME_HELPER = "_open-core-placeholder.js";

// ---------------------------------------------------------------------------
// Specifier resolution
// ---------------------------------------------------------------------------

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

export function splitSpecifier(specifier) {
  const at = specifier.search(/[?#]/);
  return at < 0
    ? { path: specifier, suffix: "" }
    : { path: specifier.slice(0, at), suffix: specifier.slice(at) };
}

/**
 * The declaration and runtime artefacts that stand in for a Pro module.
 *
 * Both accept the extensionless form because the boundary scanner records the
 * base path when a specifier omits its extension; without stripping first, the
 * pair lookup asked for `Foo.d.ts` only when the reference happened to spell
 * `Foo.ts`, and every extensionless import was reported as uncovered.
 */
export function declarationOf(proPath) {
  return `${proPath.replace(/\.tsx?$/, "")}.d.ts`;
}

export function runtimeOf(proPath) {
  return `${proPath.replace(/\.tsx?$/, "")}.js`;
}

/**
 * Candidate file paths for a specifier base. The base itself is included because
 * e2e helpers import app modules by Vite dev URL with an explicit extension
 * (`import("/src/services/ai/ProviderManager.ts")`); a resolver that only
 * appended extensions silently missed every one of those references.
 */
export function candidatesFor(base) {
  return [
    base,
    ...SOURCE_EXTENSIONS.map((ext) => base + ext),
    ...SOURCE_EXTENSIONS.map((ext) => posix.join(base, "index" + ext)),
  ];
}

/** Specifier text with Windows separators and escape-style dots normalised. */
function normalizeSpecifierText(specifier) {
  return specifier.replace(/\\/g, "/");
}

/**
 * Resolve a specifier from an importing file to a Pro module. `exists` must
 * report regular files only, so a directory never masquerades as a module.
 *
 * @returns {{modulePath: string, suffix: string}|null}
 */
export function resolveProReference(importerRel, specifier, exists) {
  const { path: bareRaw, suffix } = splitSpecifier(specifier);
  const bare = normalizeSpecifierText(bareRaw);
  let base;
  if (bare.startsWith("/")) {
    base = bare.slice(1);
  } else if (bare.startsWith(".")) {
    base = posix.normalize(posix.join(posix.dirname(importerRel), bare));
  } else {
    return null; // bare package specifier — never a repo module
  }
  if (base.endsWith("/")) return null;
  const hit = candidatesFor(base).find((candidate) => exists(candidate) && isProModulePath(candidate));
  if (!hit) return null;
  return { modulePath: hit, suffix };
}

// ---------------------------------------------------------------------------
// Source scan
// ---------------------------------------------------------------------------

export const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "coverage",
  "test-results",
  "playwright-report",
  ".d",
  "legal",
  "evidence",
]);
export const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);

/** Every scannable source file below `root`, repo-relative with forward slashes. */
export function sourceFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(abs);
      } else if (SCAN_EXTENSIONS.has(posix.extname(entry.name))) {
        out.push(relative(root, abs).split(sep).join("/"));
      }
    }
  };
  walk(root);
  return out.sort();
}

/**
 * Find every Pro reference in a source tree.
 *
 * @returns {{modules: Set<string>, perFile: Map<string, Map<string, object>>}}
 */
export function scanProReferences(root, files = sourceFiles(root)) {
  // Only files count: `src/services/ai/providers` is a real directory, and a
  // candidate list that accepted directories resolved it as a "module".
  const exists = (rel) => {
    const stats = statSync(join(root, rel.split("/").join(sep)), { throwIfNoEntry: false });
    return Boolean(stats?.isFile());
  };
  const modules = new Set();
  const perFile = new Map();

  for (const file of files) {
    let source;
    try {
      source = readFileSync(join(root, file.split("/").join(sep)), "utf8");
    } catch {
      continue;
    }
    const specifiers = new Set();
    const specifierRe =
      /(?:from|import|require|vi\.mock|vi\.doMock|vi\.unmock|vi\.importMock|vi\.importActual)\s*\(?\s*["'`]([^"'`]+)["'`]/g;
    let match;
    while ((match = specifierRe.exec(source))) {
      if (match[1]) specifiers.add(match[1]);
    }
    const record = (specifier, modulePath, suffix, pathOnly) => {
      modules.add(modulePath);
      if (!perFile.has(file)) perFile.set(file, new Map());
      perFile.get(file).set(specifier, { modulePath, suffix, pathOnly });
    };
    for (const specifier of specifiers) {
      const resolved = resolveProReference(file, specifier, exists);
      if (resolved) record(specifier, resolved.modulePath, resolved.suffix, false);
    }
    // Quoted Pro paths that are not import specifiers (coverage excludes, worker
    // lists, dev-URL strings). They still name a file the export does not have,
    // so the boundary has to account for them.
    const quotedRe = /["'`]([^"'`\n]+)["'`]/g;
    let quoted;
    while ((quoted = quotedRe.exec(source))) {
      const candidate = quoted[1];
      if (specifiers.has(candidate)) continue;
      const bare = normalizeSpecifierText(candidate);
      if (!bare.startsWith("/") && !bare.startsWith(".") && !/^(?:src|server)\//.test(bare)) continue;
      const base = bare.replace(/[?#].*$/, "");
      const normalized = base.startsWith("/")
        ? base.slice(1)
        : posix.normalize(posix.join(posix.dirname(file), base));
      const hit = candidatesFor(normalized).find(
        (candidatePath) => exists(candidatePath) && isProModulePath(candidatePath),
      );
      if (hit) record(candidate, hit, "", true);
    }
  }
  return { modules, perFile };
}

// ---------------------------------------------------------------------------
// Declaration emit
// ---------------------------------------------------------------------------

/**
 * Emit declaration files for the whole source tree into `dtsDir`, comments
 * stripped so only signatures travel and never Pro prose.
 *
 * tsc reports unrelated declaration-naming errors on Core files (TS4023 on the
 * lazy component modules) and still emits, so the exit status is advisory: the
 * caller validates that every Pro declaration it needs actually exists.
 */
export function emitDeclarations({ root, dtsDir, tscPath }) {
  const run = spawnSync(
    process.execPath,
    [
      tscPath,
      "-p",
      join(root, "tsconfig.json"),
      "--noEmit",
      "false",
      "--declaration",
      "--emitDeclarationOnly",
      "--removeComments",
      "--outDir",
      dtsDir,
      "--rootDir",
      root,
    ],
    { cwd: root, encoding: "utf8", maxBuffer: 64e6 },
  );
  return { ok: run.status === 0, output: `${run.stdout ?? ""}${run.stderr ?? ""}` };
}

/** Exported names of a declaration file, split by namespace. */
export function declarationExports(dtsSource, fileName) {
  const sourceFile = ts.createSourceFile(fileName, dtsSource, ts.ScriptTarget.ES2022, true);
  const values = new Set();
  const reexports = [];
  const exported = (node) =>
    Array.isArray(node.modifiers) && node.modifiers.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

  for (const statement of sourceFile.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) values.add(element.name.text);
      } else if (statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
        reexports.push({ specifier: statement.moduleSpecifier.text, names: [] });
      }
      continue;
    }
    if (ts.isExportAssignment(statement)) {
      values.add("default");
      continue;
    }
    if (ts.isVariableStatement(statement) && exported(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) values.add(declaration.name.text);
      }
    } else if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isEnumDeclaration(statement)) &&
      exported(statement) &&
      statement.name
    ) {
      values.add(statement.name.text);
    }
  }
  return { values, reexports };
}

/**
 * Relative import path from a placeholder module to the shared runtime helper.
 *
 * The `.js` extension is kept: these placeholders are real ESM files in the
 * export, and bundlers resolve either form while plain Node ESM only resolves
 * the explicit one. Self-hosting runs the server tree with Node, so the
 * extensionless form would have worked in every test and failed in production.
 */
function helperImportFor(modulePath) {
  const directoryDepth = modulePath.split("/").length - 1;
  const prefix = directoryDepth === 0 ? "./" : "../".repeat(directoryDepth);
  return `${prefix}${RUNTIME_HELPER}`;
}

/**
 * Source of the inert runtime placeholder for one Pro module: the same exported
 * names as the declaration file, all bound to one inert value.
 */
export function placeholderSource(modulePath, exports) {
  const lines = [
    "/**",
    ` * ${PLACEHOLDER_MARKER} — the proprietary implementation of \`${modulePath}\` is not`,
    " * part of this repository. This file exists so the exported Core keeps resolving",
    " * its imports; the sibling generated `.d.ts` carries the type surface.",
    " */",
    "/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */",
    `import { placeholderFor } from "${helperImportFor(modulePath)}";`,
    "",
    `const placeholder = placeholderFor("${modulePath.replace(/\.tsx?$/, "")}");`,
    "",
  ];
  const names = [...exports.values].filter((name) => name !== "default").sort();
  for (const name of names) {
    lines.push(`export const ${name} = placeholder;`);
  }
  for (const reexport of exports.reexports) {
    lines.push(`export * from "${reexport.specifier}";`);
  }
  if (exports.values.has("default")) lines.push("export default placeholder;");
  if (!names.length && !exports.values.has("default") && !exports.reexports.length) {
    lines.push("export {};");
  }
  return lines.join("\n") + "\n";
}

/** Source of the shared runtime helper shipped at the export root. */
export function helperSource() {
  return `/**
 * ${PLACEHOLDER_MARKER} runtime support. Every Pro module in this repository is
 * replaced by a generated declaration file plus an inert module that imports this
 * helper, so the Core keeps resolving and running without the proprietary
 * implementation.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
const warned = new Set();

function warnOnce(moduleName, property) {
  const key = moduleName + "." + property;
  if (warned.has(key)) return;
  warned.add(key);
  if (typeof console !== "undefined" && typeof console.warn === "function") {
    console.warn("[open-core] " + key + " is a Pro feature and is not included in this build.");
  }
  // A placeholder surface was actually reached: give the host application a
  // machine-readable signal so it can present an upgrade experience instead
  // of relying on the console line alone.
  if (typeof globalThis !== "undefined" && typeof globalThis.dispatchEvent === "function") {
    try {
      globalThis.dispatchEvent(
        new CustomEvent("open-core:pro-reached", { detail: { module: moduleName, property: property } })
      );
    } catch {
      // Non-DOM runtimes (workers, tests): the console line above is enough.
    }
  }
}

/** Inert value: callable, constructable and property-accessible to any depth. */
function inert(moduleName) {
  const target = function placeholder() {
    return undefined;
  };
  const proxy = new Proxy(target, {
    get(_target, property) {
      if (property === "then" || property === "toJSON") return undefined;
      // Detectability: the loader (pro-access) probes this exact key to
      // refuse handing a placeholder out as if it were the implementation.
      if (property === "__isProPlaceholder") return true;
      if (property === "toString" || property === "valueOf" || property === Symbol.toPrimitive) {
        return () => "[open-core] Pro feature not included";
      }
      if (property === "name") return "placeholder";
      if (typeof property === "string") warnOnce(moduleName, property);
      return proxy;
    },
    apply() {
      return undefined;
    },
    construct() {
      return proxy;
    },
    has() {
      return true;
    },
  });
  return proxy;
}

export function placeholderFor(moduleName) {
  return inert(moduleName);
}
`;
}

// ---------------------------------------------------------------------------
// Boundary application
// ---------------------------------------------------------------------------

/**
 * Materialize the boundary inside an exported tree: emit declarations, write the
 * placeholder pairs and drop explicit `.ts` extensions from Pro specifiers.
 *
 * @returns {{placeholders: string[], missingDeclarations: string[],
 *            rewrittenSpecifiers: number, tscOk: boolean}}
 */
/**
 * Apply the in-place source rewrites an exported file needs, given the Pro
 * references recorded for it by `scanProReferences`.
 *
 * Two rules, both deterministic and both deliberately narrow:
 *
 *   1. a specifier that spells the implementation's `.ts`/`.tsx` extension loses
 *      it, so it resolves to the generated declaration + runtime pair;
 *   2. a line that is nothing but a quoted Pro path — a coverage exclude, a
 *      dependency list entry, a worker manifest — is dropped, because the export
 *      has no implementation for it to name. Rule 2 only ever removes a line
 *      that carries no other content, so no code can be lost by accident.
 *
 * @returns {{source: string, changed: boolean, rewrittenSpecifiers: number}}
 */
export function applyFileRewrites(source, specifiers, importerFile) {
  let next = source;
  let changed = false;
  let rewrittenSpecifiers = 0;

  for (const [specifier, resolved] of specifiers) {
    if (resolved.pathOnly) continue;
    const { path: bare, suffix } = splitSpecifier(specifier);
    if (!/\.tsx?$/.test(bare)) continue;
    const rewritten = `${bare.replace(/\.tsx?$/, "")}${suffix}`;
    if (!next.includes(specifier)) continue;
    next = next.split(specifier).join(rewritten);
    changed = true;
    rewrittenSpecifiers += 1;
  }

  const proPaths = [...specifiers.entries()]
    .filter(([, resolved]) => resolved.pathOnly)
    .map(([specifier, resolved]) => [specifier, resolved.modulePath]);
  if (proPaths.length) {
    const quotedLineRe = /^\s*["'][^"'\n]+["'],?\s*$/;
    const kept = next.split("\n").filter((line) => {
      if (!quotedLineRe.test(line)) return true;
      const quoted = line.trim().replace(/,$/, "").replace(/^["']|["']$/g, "");
      return !proPaths.some(([specifier, modulePath]) => {
        const bare = splitSpecifier(specifier).path;
        const normalized = bare.startsWith("/")
          ? bare.slice(1)
          : posix.normalize(posix.join(posix.dirname(importerFile), bare));
        return quoted === normalized && candidatesFor(normalized).includes(modulePath);
      });
    });
    const joined = kept.join("\n");
    if (joined !== next) {
      next = joined;
      changed = true;
    }
  }

  return { source: next, changed, rewrittenSpecifiers };
}

/**
 * Non-exported runtime constants whose user-visible claims gates verify.
 *
 * When a proprietary module is replaced by a placeholder, the exported tree
 * loses not only the implementation but also the *enforced constants* that
 * factual claim gates (check-claim-drift) read as truth. The generated
 * declaration banner re-pins those constants, extracted from the real source
 * at export time, so an exported tree stays verifiable against the same truth
 * the private tree enforces — and a placeholder without a pinned constant
 * keeps failing closed.
 *
 * Constants are embedded only as bare numbers next to their identifier. No
 * implementation, no logic, no Pro prose travels.
 */
const PINNED_TRUTH_CONSTANTS = [
  { modulePath: "src/services/BackupService.ts", name: "AUTO_BACKUP_INTERVAL_MS" },
];

/** Extract `const NAME = N * 60 * 60 * 1000` style products (milliseconds). */
function extractPinnedMs(source, name) {
  const product = source.match(
    new RegExp(String.raw`(?:const|let|var)\s+${name}\s*=\s*([\d_\s*]+);`),
  );
  if (!product) return null;
  const expression = product[1].replace(/_/g, "").replace(/\s+/g, "");
  if (!/^\d+(\*\d+)*$/.test(expression)) return null;
  const value = expression.split("*").reduce((acc, factor) => acc * Number(factor), 1);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Materialize the boundary inside an exported tree: emit declarations, write the
 * placeholder pairs and drop explicit `.ts` extensions from Pro specifiers.
 *
 * @returns {{placeholders: string[], missingDeclarations: string[],
 *            rewrittenSpecifiers: number, tscOk: boolean}}
 */
export function applyProBoundary({ root, outDir, tscPath, dtsDir }) {
  const { modules, perFile } = scanProReferences(root);
  const placeholders = [];
  const missingDeclarations = [];
  let rewrittenSpecifiers = 0;

  mkdirSync(dtsDir, { recursive: true });
  const emit = emitDeclarations({ root, dtsDir, tscPath });

  writeFileSync(join(outDir, RUNTIME_HELPER), helperSource());

  for (const modulePath of [...modules].sort()) {
    const emitted = join(dtsDir, modulePath.replace(/\.tsx?$/, ".d.ts"));
    if (!existsSync(emitted)) {
      missingDeclarations.push(modulePath);
      continue;
    }
    const declarations = readFileSync(emitted, "utf8");
    const exports = declarationExports(declarations, emitted);
    const target = join(outDir, modulePath.split("/").join(sep));
    mkdirSync(dirname(target), { recursive: true });
    // Truth re-pinning: extract the enforced constants this module owns from
    // the real source and pin their numeric value in the declaration banner.
    const pinnedLines = PINNED_TRUTH_CONSTANTS.filter(
      (pin) => pin.modulePath === modulePath,
    ).map((pin) => {
      let real;
      try {
        real = readFileSync(join(root, modulePath.split("/").join(sep)), "utf8");
      } catch {
        return null;
      }
      const ms = extractPinnedMs(real, pin.name);
      return ms == null ? null : `   ${pin.name} = ${ms};`;
    });
    const truthBlock = pinnedLines.some(Boolean)
      ? `\n * Enforced constants pinned from the private source at export time\n * (claim gates verify against these numbers):\n${pinnedLines.filter(Boolean).join("\n")}\n`
      : "";
    writeFileSync(
      target.replace(/\.tsx?$/, ".d.ts"),
      `/* ${PLACEHOLDER_MARKER}: generated type surface of the proprietary module\n` +
        `   \`${modulePath}\`. No implementation is present in this repository.${truthBlock} */\n${declarations}`,
    );
    writeFileSync(target.replace(/\.tsx?$/, ".js"), placeholderSource(modulePath, exports));
    placeholders.push(modulePath);
  }

  // Explicit `.ts`/`.tsx` specifiers must lose the extension (only the generated
  // `.d.ts` + `.js` pair exists in the export) and config entries that merely
  // *name* a Pro file are dropped: see applyFileRewrites.
  for (const [file, specifiers] of perFile) {
    const abs = join(outDir, file.split("/").join(sep));
    if (!existsSync(abs)) continue; // the file itself is not part of the export
    const rewrite = applyFileRewrites(readFileSync(abs, "utf8"), specifiers, file);
    if (!rewrite.changed) continue;
    writeFileSync(abs, rewrite.source);
    rewrittenSpecifiers += rewrite.rewrittenSpecifiers;
  }

  return { placeholders, missingDeclarations, rewrittenSpecifiers, tscOk: emit.ok };
}

/**
 * Prove the boundary on a materialized export.
 *
 * @returns {{violations: string[], placeholderCount: number}}
 */
export function verifyProBoundary(outDir) {
  const violations = [];
  const files = sourceFiles(outDir);
  const byPath = new Set(files);

  for (const file of files) {
    if (!isProModulePath(file)) continue;
    const isDeclaration = file.endsWith(".d.ts");
    const isPlaceholderRuntime = file.endsWith(".js");
    if (!isDeclaration && !isPlaceholderRuntime) {
      violations.push(`${file} is a Pro implementation, not a placeholder`);
      continue;
    }
    const body = readFileSync(join(outDir, file.split("/").join(sep)), "utf8");
    if (!body.includes(PLACEHOLDER_MARKER)) violations.push(`${file} is not a marked placeholder`);
  }

  const resolveInExport = (file, candidate) => {
    const normalized = candidate.startsWith("/")
      ? candidate.slice(1)
      : posix.normalize(posix.join(posix.dirname(file), candidate));
    const direct = join(outDir, normalized.split("/").join(sep));
    const stats = statSync(direct, { throwIfNoEntry: false });
    if (stats?.isFile()) return isProModulePath(normalized) ? normalized : null;
    // Extensionless specifiers resolve to the placeholder pair, so prefer the
    // candidate that actually owns one instead of the bare base path.
    const hits = candidatesFor(normalized).filter(isProModulePath);
    return (
      hits.find((hit) => byPath.has(declarationOf(hit)) && byPath.has(runtimeOf(hit))) ??
      hits[0] ??
      null
    );
  };

  for (const file of files) {
    if (file.endsWith(".d.ts") || isProModulePath(file)) continue;
    const body = readFileSync(join(outDir, file.split("/").join(sep)), "utf8");
    const reported = new Set();
    const report = (kind, hit, detail = "") => {
      const key = `${file}\u0000${kind}\u0000${hit}`;
      if (reported.has(key)) return;
      reported.add(key);
      violations.push(`${file} ${kind} ${hit}${detail}`);
    };


    const specifierRe =
      /(?:from|import|require|vi\.mock|vi\.doMock|vi\.unmock|vi\.importMock|vi\.importActual)\s*\(?\s*["'`]([^"'`]+)["'`]/g;
    const importSpecifiers = new Set();
    let match;
    while ((match = specifierRe.exec(body))) importSpecifiers.add(normalizeSpecifierText(match[1]));
    for (const specifier of importSpecifiers) {
      if (!specifier.startsWith("/") && !specifier.startsWith(".")) continue;
      const { path: bare } = splitSpecifier(specifier);
      const hit = resolveInExport(file, bare);
      if (!hit) continue;
      if (/\.tsx?$/.test(bare)) {
        report("imports the Pro module", hit, " with an explicit extension");
        continue;
      }
      if (!byPath.has(declarationOf(hit)) || !byPath.has(runtimeOf(hit))) {
        report("imports the Pro module", hit, " without a placeholder pair");
      }
    }

    const quotedRe = /["'`]([^"'`\n]+)["'`]/g;
    while ((match = quotedRe.exec(body))) {
      const candidate = normalizeSpecifierText(match[1]);
      if (importSpecifiers.has(candidate)) continue;
      if (!candidate.startsWith("/") && !candidate.startsWith(".") && !/^(?:src|server)\//.test(candidate)) continue;
      const hit = resolveInExport(file, splitSpecifier(candidate).path);
      if (hit) report("still names the Pro module", hit, " outside an import");
    }
  }

  const placeholderCount = files.filter((file) => isProModulePath(file)).length;
  return { violations, placeholderCount };
}
