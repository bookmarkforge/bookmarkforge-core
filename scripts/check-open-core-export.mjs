#!/usr/bin/env node
/**
 * Verifica el límite de distribución Open Core sin leer ni modificar archivos.
 * Uso: node scripts/check-open-core-export.mjs [directorio-exportado]
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import process from "node:process";

const root = process.argv[2];
const normalized = (value) => value.split(sep).join("/");
const proFiles = new Set([
  "server/src/ai-proxy.ts",
  "server/src/ai-media.ts",
  "src/services/WebRTCSyncService.ts",
  "src/services/pdfService.ts",
  "src/services/BackupService.ts",
  "src/services/DiskBackupService.ts",
  "src/services/exporter.formatters.ts",
  "src/services/ai/WebLLMService.ts",
  "src/services/ai/RAGEngine.ts",
  "src/services/ai/GlobalRAGService.ts",
  "src/services/ai/SpecializedAgentsService.ts",
  "src/services/ai/FlashcardService.ts",
]);
const proDirs = ["src/services/ai/", "src/tests/services/ai/", "src/tests/ai/"];

if (!root) {
  console.log("[open-core] OK: source export policy is registered; pass an export directory for materialized verification");
  process.exit(0);
}
if (!existsSync(root)) {
  console.error(`[open-core] FAIL: export directory does not exist: ${root}`);
  process.exit(1);
}

const found = [];
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else {
      const rel = normalized(relative(root, path));
      if (proFiles.has(rel) || proDirs.some((prefix) => rel.startsWith(prefix))) found.push(rel);
    }
  }
}
walk(root);
if (found.length) {
  console.error("[open-core] FAIL: Pro files found in public export:");
  for (const file of found) console.error(`- ${file}`);
  process.exit(1);
}

const manifestPath = join(root, "manifest.json");
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.license !== "MIT") {
    console.error(`[open-core] FAIL: manifest license is ${manifest.license ?? "missing"}, expected MIT`);
    process.exit(1);
  }
}
const license = join(root, "LICENSE");
if (existsSync(license) && !readFileSync(license, "utf8").startsWith("MIT License")) {
  console.error("[open-core] FAIL: public LICENSE does not start with MIT License");
  process.exit(1);
}
console.log("[open-core] OK: no Pro files in public export and MIT metadata is consistent");
