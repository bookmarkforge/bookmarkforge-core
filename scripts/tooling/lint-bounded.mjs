#!/usr/bin/env node
/**
 * Bounded, domain-grouped linting.
 *
 * `eslint .` builds a single configuration graph over the whole checkout and
 * can exceed the heap available on development machines. This executor keeps
 * exactly the same ESLint flat config, but processes sequential, isolated
 * batches. Each process's max memory can be tuned with BMF_LINT_HEAP_MB
 * (default 1536 MiB) and the batch size with
 * BMF_LINT_BATCH_SIZE (por defecto 120 archivos).
 *
 * The process is deliberately sequential: this does not trade ESLint's
 * memory cost for N concurrent processes. A failure propagates and is not
 * ocultan warnings ni errores.
 *
 * Uso:
 *   node scripts/tooling/lint-bounded.mjs
 *   BMF_LINT_VERBOSE=1 node scripts/tooling/lint-bounded.mjs
 *   node scripts/tooling/lint-bounded.mjs --no-cache
 */
import { existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const ESLINT_BIN = join(ROOT, "node_modules", "eslint", "bin", "eslint.js");
const CACHE_DIR = join(ROOT, "node_modules", ".cache", "bookmarkforge-eslint");
const EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"]);
const ROOT_FILES = new Set([
  "eslint.config.js",
  "vite.config.ts",
  "vitest.config.ts",
  "vitest.coverage-chunk.config.ts",
  "vitest.extension.config.ts",
  "vitest.universal-coverage.config.ts",
  "playwright.config.ts",
  "playwright.custom-provider.config.ts",
  "playwright.browsers.config.ts",
  "playwright.engines.config.ts",
  "playwright.launch-smoke.config.ts",
  "playwright.mobile.config.ts",
  "playwright.human-like.config.ts",
  "playwright.human-like.browsers.config.ts",
  "playwright.multiuser.config.ts",
  "playwright.nightly.config.ts",
  "playwright.performance.config.ts",
  "playwright.ai-performance.config.ts",
  "playwright.preview.config.ts",
  "playwright.public-relay.config.ts",
  "playwright.smoke.config.ts",
  "playwright.sw-integrity.config.ts",
  "_open-core-placeholder.js",
]);
const EXCLUDED_DIRS = new Set([
  ".git",
  ".freebuff",
  "node_modules",
  "dist",
  "dist-extension",
  "coverage",
  "playwright-report",
  "test-results",
  "test-results-performance",
]);
const DOMAIN_ROOTS = [
  ["app", ["src"]],
  ["server", ["server"]],
  ["extension", ["extension"]],
  ["tests", ["tests"]],
  ["tooling", ["scripts", "eslint-rules"]],
];
const args = process.argv.slice(2);
const useCache = !args.includes("--no-cache");
const verbose = process.env.BMF_LINT_VERBOSE === "1" || args.includes("--verbose");
const batchSize = parsePositiveInt(process.env.BMF_LINT_BATCH_SIZE, 120);
const heapMb = parsePositiveInt(process.env.BMF_LINT_HEAP_MB, 1536);

function parsePositiveInt(raw, fallback) {
  const value = Number.parseInt(raw ?? "", 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function collectFiles(root) {
  const result = [];
  if (!existsSync(root)) return result;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (EXCLUDED_DIRS.has(entry.name)) continue;
    const absolute = join(root, entry.name);
    if (entry.isDirectory()) {
      result.push(...collectFiles(absolute));
      continue;
    }
    const extension = entry.name.slice(entry.name.lastIndexOf("."));
    if (EXTENSIONS.has(extension)) result.push(relative(ROOT, absolute));
  }
  return result;
}

function batches(files) {
  const result = [];
  for (let index = 0; index < files.length; index += batchSize) {
    result.push(files.slice(index, index + batchSize));
  }
  return result;
}

function runBatch(label, files, batchIndex, totalBatches) {
  const display = files.map((file) => file.replaceAll("\\", "/"));
  const cliArgs = [ESLINT_BIN];
  if (useCache) {
    cliArgs.push("--cache", "--cache-location", CACHE_DIR);
  }
  cliArgs.push(...display);

  console.log(
    `[lint-bounded] lote ${batchIndex}/${totalBatches} — ${label} ` +
      `(${display.length} archivos, heap ${heapMb} MiB)`,
  );
  const result = spawnSync(process.execPath, cliArgs, {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_OPTIONS: appendNodeOption(process.env.NODE_OPTIONS, `--max-old-space-size=${heapMb}`),
    },
    stdio: verbose ? "inherit" : ["ignore", "inherit", "inherit"],
  });
  if (result.error) {
    console.error(`[lint-bounded] could not start ESLint: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

function appendNodeOption(existing, option) {
  if (existing?.includes("--max-old-space-size")) return existing;
  return [existing, option].filter(Boolean).join(" ");
}

if (!existsSync(ESLINT_BIN)) {
  console.error(`[lint-bounded] falta el ejecutable de ESLint: ${ESLINT_BIN}`);
  process.exit(1);
}

const allBatches = [];
// ROOT_FILES is an allow-list, so a root-level config added without a line
// there silently leaves the sweep: ESLint never sees it and the run still says
// PASS. Fail fast instead — a root config that cannot be linted is a mistake,
// never an acceptable outcome, and an audit found exactly one file in this
// state after nothing more than adding a new Playwright config.
const lintableRootFiles = readdirSync(ROOT, { withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name)
  .filter((name) => EXTENSIONS.has(name.slice(name.lastIndexOf("."))));
const unregisteredRootFiles = lintableRootFiles.filter((name) => !ROOT_FILES.has(name)).sort();
if (unregisteredRootFiles.length > 0) {
  console.error(
    `[lint-bounded] root files with a lintable extension missing from ROOT_FILES: ` +
      `${unregisteredRootFiles.join(", ")}. Add them to ROOT_FILES: without that ESLint ignores them and lint still says PASS.`,
  );
  process.exit(1);
}
const rootFiles = lintableRootFiles.filter((name) => ROOT_FILES.has(name));
for (const [label, roots] of DOMAIN_ROOTS) {
  const files = [...new Set(roots.flatMap((root) => collectFiles(join(ROOT, root))))].sort();
  for (const batch of batches(files)) allBatches.push({ label, files: batch });
}
for (const batch of batches(rootFiles)) allBatches.push({ label: "root-config", files: batch });

// Markdown ADRs are intentionally explicit because ESLint's CLI does not
// discover .md files from `eslint .` on every supported ESLint minor, while
// the flat config contains a parser/rule contract for them.
const adrFiles = existsSync(join(ROOT, "docs"))
  ? readdirSync(join(ROOT, "docs"))
      .filter((file) => /^ADR-.*\.md$/.test(file))
      .map((file) => `docs/${file}`)
      .sort()
  : [];
for (const batch of batches(adrFiles)) allBatches.push({ label: "adr-docs", files: batch });

const totalFiles = allBatches.reduce((sum, batch) => sum + batch.files.length, 0);
console.log(
  `[lint-bounded] ${totalFiles} archivos en ${allBatches.length} lotes ` +
    `(batch=${batchSize}, heap=${heapMb} MiB, cache=${useCache ? "on" : "off"})`,
);

for (let index = 0; index < allBatches.length; index += 1) {
  const { label, files } = allBatches[index];
  const status = runBatch(label, files, index + 1, allBatches.length);
  if (status !== 0) {
    console.error(`[lint-bounded] FAIL en lote ${index + 1}/${allBatches.length} (${label})`);
    process.exit(status);
  }
}

console.log(`[lint-bounded] PASS — ${totalFiles} files linted without a global 4 GiB heap`);
