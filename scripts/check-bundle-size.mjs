/**
 * scripts/check-bundle-size.mjs — P6 bundle-size + report gate.
 *
 * Walks dist/assets/*.js after a production build and asserts:
 *   1. entry chunk (app-*.js / index-*.js) <= 1.5 MB (matches P60 gate budget).
 *   2. total JS payload <= 20 MB (soft cap; catches gross bloat even when
 *      individual lazy vendors stay within their own caps).
 *   3. no single JS chunk exceeds 1 MB unless it is a known large lazy
 *      vendor (blocknote, pdfjs, recharts, transformers, web-llm, ort-wasm).
 *
 * Emits bundle-report.md with the top chunks by size, then exits 0/1.
 */
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveEntryChunk } from "./entry-chunk-lib.mjs";

const ROOT = process.cwd();
const ASSETS = join(ROOT, "dist", "assets");
const REPORT = join(ROOT, "bundle-report.md");

const ENTRY_BUDGET = 1.5 * 1024 * 1024;
const TOTAL_BUDGET = 20 * 1024 * 1024;
const SINGLE_CHUNK_WARN = 1 * 1024 * 1024;

const KNOWN_LARGE_LAZY = [
  "blocknote",
  "pdf",
  "pdfjs",
  "recharts",
  "transformers",
  "lib-",
  "ort-wasm",
  "native-",
  "html2pdf",
];

function isKnownLarge(name) {
  return KNOWN_LARGE_LAZY.some((k) => name.includes(k));
}

function walkJs() {
  if (!statSync(ASSETS).isDirectory()) {
    console.error("[check-bundle-size] FAIL: dist/assets not found — run npm run build first");
    process.exit(1);
  }
  return readdirSync(ASSETS)
    .filter((f) => f.endsWith(".js") || f.endsWith(".mjs"))
    .map((f) => ({ name: f, bytes: statSync(join(ASSETS, f)).size }))
    .sort((a, b) => b.bytes - a.bytes);
}

function fail(msg) {
  console.error(`[check-bundle-size] FAIL: ${msg}`);
  process.exit(1);
}

const files = walkJs();
if (files.length === 0) fail("dist/assets has no .js/.mjs chunks");

// ADR-028: gate drift — entry derived from dist's HTML module script
// (app-*.js since the marketing/SPA split), see scripts/entry-chunk-lib.mjs.
const entryName = resolveEntryChunk(ROOT, files.map((f) => f.name));
const entry = files.find((f) => f.name === entryName);
if (!entry) fail("entry chunk (app-*.js / index-*.js) not found");

const totalBytes = files.reduce((s, f) => s + f.bytes, 0);
const entryMB = (entry.bytes / 1024 / 1024).toFixed(2);
const totalMB = (totalBytes / 1024 / 1024).toFixed(2);

const oversized = files.filter((f) => f.bytes > SINGLE_CHUNK_WARN && !isKnownLarge(f.name));
const bad = [];
if (entry.bytes > ENTRY_BUDGET) bad.push(`entry ${entryMB} MB (cap ${(ENTRY_BUDGET / 1024 / 1024).toFixed(2)} MB)`);
if (totalBytes > TOTAL_BUDGET) bad.push(`total JS ${totalMB} MB (cap ${(TOTAL_BUDGET / 1024 / 1024).toFixed(2)} MB)`);
if (oversized.length > 0) {
  const names = oversized.map((f) => `${f.name} (${(f.bytes / 1024).toFixed(0)} KB)`).join(", ");
  bad.push(`oversized non-lazy chunks: ${names}`);
}

if (bad.length > 0) fail(bad.join("; "));

let md = `# Bundle report — ${new Date().toISOString().slice(0, 10)}\n\n`;
md += `| # | Chunk | Size |\n|---|---|---|\n`;
files.forEach((f, i) => {
  const size = f.bytes > 1024 * 1024
    ? `${(f.bytes / 1024 / 1024).toFixed(2)} MB`
    : `${(f.bytes / 1024).toFixed(0)} KB`;
  md += `| ${i + 1} | \`${f.name}\` | ${size} |\n`;
});
md += `\n**Entry:** \`${entry.name}\` — ${entryMB} MB (cap ${(ENTRY_BUDGET / 1024 / 1024).toFixed(2)} MB)\n`;
md += `**Total JS:** ${totalMB} MB (cap ${(TOTAL_BUDGET / 1024 / 1024).toFixed(2)} MB)\n`;
md += `**Chunks:** ${files.length}\n`;

writeFileSync(REPORT, md, "utf8");
console.log(`[check-bundle-size] ok: entry=${entryMB} MB, total=${totalMB} MB, chunks=${files.length}`);
console.log(`[check-bundle-size] report written to ${REPORT}`);
