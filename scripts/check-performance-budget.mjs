#!/usr/bin/env node
/**
 * CI performance-budget gate.
 *
 * Static metrics are measured from the production artifacts:
 *   - entryStaticChainBytes: the index chunk plus its static JS imports;
 *   - precacheBytes: every local file listed by Workbox in dist/sw.js.
 *
 * The browser metric is produced by tests/e2e/performance-budget.spec.ts:
 *   - firstInteractionMs: navigation start to the first real pointerdown on
 *     the pre-unlock action surface.
 *
 * `--static-only` is used by build:ci before a browser is available.
 * `--report <path>` validates all three metrics after the Chromium run.
 */
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { basename, join, normalize, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

export const PERFORMANCE_SCHEMA_LABEL = "bmf.performance-budget/1";
const ROOT = process.cwd();
const DEFAULT_BUDGET_PATH = join(ROOT, "scripts", "performance-budget.json");
const DEFAULT_REPORT_PATH = join(ROOT, "performance-budget-report.json");
const DIST = join(ROOT, "dist");
const ASSETS = join(DIST, "assets");
const SW = join(DIST, "sw.js");

function fail(message) {
  throw new Error(`[performance-budget] ${message}`);
}

export function loadPerformanceBudget(path = DEFAULT_BUDGET_PATH) {
  if (!existsSync(path)) fail(`budget file missing: ${path}`);
  let budget;
  try {
    budget = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`budget file is not valid JSON: ${error.message}`);
  }
  if (budget?.schema !== PERFORMANCE_SCHEMA_LABEL) {
    fail(
      `budget schema mismatch (expected ${PERFORMANCE_SCHEMA_LABEL}, got ${budget?.schema ?? "none"})`,
    );
  }
  const values = budget?.budgets;
  if (
    !values ||
    !Number.isInteger(values.entryStaticChainBytes) ||
    !Number.isInteger(values.precacheBytes) ||
    !Number.isInteger(values.firstInteractionMs) ||
    Object.values(values).some((value) => value <= 0)
  ) {
    fail("budget values must be positive integer byte/millisecond limits");
  }
  return values;
}

/** Extract only static relative JS imports from an emitted asset. */
export function extractStaticImports(source) {
  const imports = [];
  const pattern = /\bfrom\s*["'](\.\/[^"']+\.(?:m?js))["']|\bimport\s*["'](\.\/[^"']+\.(?:m?js))["']/g;
  for (const match of source.matchAll(pattern)) {
    const value = match[1] ?? match[2];
    if (value) imports.push(value);
  }
  return imports;
}

function assetFiles() {
  if (!existsSync(ASSETS) || !statSync(ASSETS).isDirectory()) {
    fail("dist/assets not found; run the production build first");
  }
  return new Map(
    readdirSync(ASSETS)
      .filter((file) => /\.(?:m?js)$/.test(file))
      .map((file) => [file, join(ASSETS, file)]),
  );
}

function resolveAssetImport(importPath, currentFile, files) {
  const currentDir = currentFile.includes("/")
    ? currentFile.slice(0, currentFile.lastIndexOf("/") + 1)
    : "";
  const requested = importPath
    .replace(/^\.\//, `${currentDir}`)
    .split(/[?#]/, 1)[0];
  const resolved = normalize(requested).replaceAll("\\", "/");
  if (resolved.startsWith("../") || resolved === "..") {
    fail(`static import escapes dist/assets: ${currentFile} -> ${importPath}`);
  }
  const file = basename(resolved);
  if (!files.has(file)) {
    fail(`static import target is missing: ${currentFile} -> ${importPath}`);
  }
  return file;
}

/** Return the emitted entry chunk and its complete static JS closure. */
export function collectEntryStaticMetrics() {
  const files = assetFiles();
  const entryNames = [...files.keys()].filter((file) => file.startsWith("index-"));
  if (entryNames.length !== 1) {
    fail(`expected exactly one index-*.js entry chunk, found ${entryNames.length}`);
  }
  const entry = entryNames[0];
  const closure = new Set([entry]);
  const queue = [entry];
  while (queue.length > 0) {
    const current = queue.shift();
    const imports = extractStaticImports(readFileSync(files.get(current), "utf8"));
    for (const importPath of imports) {
      const dependency = resolveAssetImport(importPath, current, files);
      if (!closure.has(dependency)) {
        closure.add(dependency);
        queue.push(dependency);
      }
    }
  }
  if (closure.size < 2) {
    fail(`entry static import graph looks empty (${closure.size} chunk)`);
  }
  const bytes = [...closure].reduce(
    (total, file) => total + statSync(files.get(file)).size,
    0,
  );
  return { entry, files: [...closure].sort(), bytes };
}

export function extractPrecacheUrls(serviceWorkerSource) {
  const block = serviceWorkerSource.match(
    /precacheAndRoute\(\[([\s\S]*?)\]\s*,\s*\{/,
  );
  if (!block) {
    fail("could not locate Workbox precacheAndRoute([...]) in dist/sw.js");
  }
  const urls = [...block[1].matchAll(/url:\"([^\"]+)\"/g)].map(
    (match) => match[1],
  );
  if (urls.length < 1) fail("precache manifest contains no URLs");
  return urls;
}

function localPrecachePath(url) {
  if (/^[a-z][a-z\d+.-]*:/i.test(url)) return null;
  const pathname = decodeURIComponent(url.split(/[?#]/, 1)[0]).replace(/^\/+/, "");
  const resolved = normalize(join(DIST, pathname));
  const rel = relative(DIST, resolved);
  if (rel.startsWith(`..${sep}`) || rel === "..") {
    fail(`precache URL escapes dist/: ${url}`);
  }
  return resolved;
}

export function collectPrecacheMetrics() {
  if (!existsSync(SW)) fail("dist/sw.js not found; run the production build first");
  const urls = extractPrecacheUrls(readFileSync(SW, "utf8"));
  let bytes = 0;
  const missing = [];
  for (const url of urls) {
    const file = localPrecachePath(url);
    if (!file) continue;
    if (!existsSync(file) || !statSync(file).isFile()) {
      missing.push(url);
      continue;
    }
    bytes += statSync(file).size;
  }
  if (missing.length > 0) {
    fail(`precache references missing local files: ${missing.join(", ")}`);
  }
  return { urls, bytes };
}

export function evaluatePerformanceBudget({ budget, metrics, requireFirstInteraction = true }) {
  const failures = [];
  const lines = [];
  const checks = [
    ["entry static chain", metrics.entryStaticChainBytes, budget.entryStaticChainBytes, "bytes"],
    ["precache", metrics.precacheBytes, budget.precacheBytes, "bytes"],
  ];
  if (requireFirstInteraction) {
    checks.push([
      "first interaction",
      metrics.firstInteractionMs,
      budget.firstInteractionMs,
      "ms",
    ]);
  }
  for (const [label, actual, limit, unit] of checks) {
    if (!Number.isFinite(actual)) {
      failures.push(`${label} metric is missing or non-finite`);
      continue;
    }
    const status = actual <= limit ? "ok" : "FAIL";
    const line = `[performance-budget] ${status} ${label}: ${actual} ${unit} (budget ${limit} ${unit})`;
    lines.push(line);
    if (actual > limit) failures.push(line);
  }
  return { ok: failures.length === 0, failures, lines };
}

function loadBrowserReport(path) {
  if (!existsSync(path)) fail(`browser report missing: ${path}`);
  let report;
  try {
    report = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`browser report is not valid JSON: ${error.message}`);
  }
  if (
    report?.schema !== PERFORMANCE_SCHEMA_LABEL ||
    !Number.isFinite(report?.firstInteractionMs) ||
    typeof report?.buildHash !== "string" ||
    report.buildHash.length === 0
  ) {
    fail(
      `browser report must contain schema ${PERFORMANCE_SCHEMA_LABEL}, firstInteractionMs, and buildHash`,
    );
  }
  return report;
}

export function collectStaticMetrics() {
  const entry = collectEntryStaticMetrics();
  const precache = collectPrecacheMetrics();
  const manifestPath = join(DIST, "integrity-manifest.json");
  if (!existsSync(manifestPath)) fail("dist/integrity-manifest.json not found");
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    fail(`integrity manifest is not valid JSON: ${error.message}`);
  }
  if (typeof manifest?.buildHash !== "string" || manifest.buildHash.length === 0) {
    fail("integrity manifest has no buildHash");
  }
  return {
    entryStaticChainBytes: entry.bytes,
    precacheBytes: precache.bytes,
    entryChunk: entry.entry,
    entryStaticFiles: entry.files,
    precacheEntries: precache.urls.length,
    buildHash: manifest.buildHash,
  };
}

function main() {
  const args = process.argv.slice(2);
  const staticOnly = args.includes("--static-only");
  const reportIndex = args.indexOf("--report");
  const reportPath = reportIndex >= 0
    ? join(ROOT, args[reportIndex + 1] ?? "")
    : DEFAULT_REPORT_PATH;
  try {
    const budget = loadPerformanceBudget();
    const staticMetrics = collectStaticMetrics();
    const browserReport = staticOnly ? null : loadBrowserReport(reportPath);
    if (browserReport && browserReport.buildHash !== staticMetrics.buildHash) {
      fail(
        `browser report buildHash ${browserReport.buildHash} does not match ` +
          `dist/integrity-manifest.json ${staticMetrics.buildHash}`,
      );
    }
    const metrics = {
      ...staticMetrics,
      ...(browserReport ? { firstInteractionMs: browserReport.firstInteractionMs } : {}),
    };
    const result = evaluatePerformanceBudget({
      budget,
      metrics,
      requireFirstInteraction: !staticOnly,
    });
    for (const line of result.lines) console.log(line);
    if (!result.ok) {
      for (const failure of result.failures) console.error(failure);
      process.exitCode = 1;
      return;
    }
    console.log(
      `[performance-budget] pass: entry=${(metrics.entryStaticChainBytes / 1024).toFixed(0)} KiB, ` +
        `precache=${(metrics.precacheBytes / 1024 / 1024).toFixed(2)} MiB` +
        (browserReport ? `, firstInteraction=${metrics.firstInteractionMs.toFixed(0)} ms` : ""),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();
