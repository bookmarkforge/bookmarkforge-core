#!/usr/bin/env node
/**
 * Verify that operational documentation does not teach commands that
 * package.json cannot execute.
 *
 * The scan intentionally covers user/operator-facing documentation and
 * workflows, not scripts or tests: tests contain deliberate unknown-command
 * fixtures for validator coverage, while the files scanned here are the
 * release and onboarding contract.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
// `fileURLToPath` decodes the percent-encoding `import.meta.url` carries, so
// the CLI guard below matches even when the checkout lives under a path with
// spaces — a bare string comparison silently skips main() there and the gate
// exits 0 as a no-op.
import { fileURLToPath } from "node:url";

export const DOCUMENT_ROOTS = [
  "README.md",
  "AGENTS.md",
  "CONTRIBUTING.md",
  "OPEN-CORE.md",
  "docs",
  ".github",
];

const DOCUMENT_EXTENSIONS = new Set([".md", ".yml", ".yaml"]);
const NPM_RUN_RE = /\bnpm\s+run\s+([a-z0-9:_-]+)/gi;

function walkFiles(path, root, files = []) {
  const info = statSync(path);
  if (info.isFile()) {
    const extension = path.slice(path.lastIndexOf(".")).toLowerCase();
    if (DOCUMENT_EXTENSIONS.has(extension)) files.push(path);
    return files;
  }

  for (const entry of readdirSync(path)) {
    if (entry === ".git" || entry === "node_modules") continue;
    walkFiles(join(path, entry), root, files);
  }
  return files;
}

export function documentedFiles(root) {
  const files = [];
  for (const entry of DOCUMENT_ROOTS) {
    const path = join(root, entry);
    try {
      walkFiles(path, root, files);
    } catch {
      // Optional roots such as .github are allowed to be absent in exports.
    }
  }
  return [...new Set(files)].sort();
}

export function collectDocumentedCommands(root) {
  const occurrences = [];
  for (const file of documentedFiles(root)) {
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const match of line.matchAll(NPM_RUN_RE)) {
        occurrences.push({
          command: match[1],
          file: relative(root, file).replaceAll("\\", "/"),
          line: index + 1,
          text: line.trim(),
        });
      }
    });
  }
  return occurrences;
}

export function checkDocumentedNpmCommands({ root, packageJson }) {
  const scripts = packageJson?.scripts ?? {};
  const occurrences = collectDocumentedCommands(root);
  const missing = occurrences.filter(({ command }) => !Object.hasOwn(scripts, command));
  return {
    ok: missing.length === 0,
    occurrences,
    missing,
  };
}

function main() {
  const root = resolve(process.env.DOCUMENTED_NPM_COMMANDS_ROOT ?? process.cwd());
  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const result = checkDocumentedNpmCommands({ root, packageJson });
  const uniqueCommands = new Set(result.occurrences.map(({ command }) => command));

  console.log(
    `[check:documented-npm-commands] scanned ${result.occurrences.length} references ` +
      `(${uniqueCommands.size} unique) across ${documentedFiles(root).length} files`,
  );
  if (result.missing.length > 0) {
    for (const item of result.missing) {
      console.error(
        `[check:documented-npm-commands] FAIL ${item.file}:${item.line}: ` +
          `npm run ${item.command} is not declared in package.json`,
      );
    }
    process.exitCode = 1;
    return;
  }
  console.log("[check:documented-npm-commands] all documented commands exist");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
