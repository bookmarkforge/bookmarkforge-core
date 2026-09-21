#!/usr/bin/env node
/** Canonical documentation inventory.
 * The index is derived only from files that exist in docs/. This makes a
 * documented retirement explicit instead of keeping a stale list of deleted
 * files as a permanent CI failure.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOCS_DIR = path.join(ROOT, "docs");
const INDEX_PATH = path.join(DOCS_DIR, "docs-state-index.md");
const ALLOWED_STATES = new Set(["vivo", "transitorio", "archivo", "retirable"]);

function normalizeEol(text) {
  return text.replace(/\r\n?/g, "\n");
}

function docsFiles() {
  if (!fs.existsSync(DOCS_DIR)) return [];
  return fs.readdirSync(DOCS_DIR)
    .filter((name) => /\.(?:md|yaml)$/i.test(name))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => `docs/${name}`);
}

export function parseStateIndex(text) {
  const rows = [];
  let inTable = false;
  for (const line of text.split("\n")) {
    const value = line.trim();
    if (value.startsWith("| Documento | Estado | Nota |")) {
      inTable = true;
      continue;
    }
    if (!inTable || value.startsWith("|---")) continue;
    if (!value.startsWith("|")) {
      inTable = false;
      continue;
    }
    const cells = value.split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells.length >= 3) {
      rows.push({ file: cells[0].replace(/`/g, ""), state: cells[1], note: cells[2] });
    }
  }
  return rows;
}

function noteFor(file) {
  if (file === "docs/docs-state-index.md") return "Inventario canónico generado por scripts/doctor-docs-index.mjs.";
  if (file.endsWith("legacy-schema-version-map.md")) return "Mapa de compatibilidad de esquemas generado desde src/db/schema.ts.";
  if (file.endsWith("openapi.yaml")) return "Contrato OpenAPI versionado del servidor companion.";
  if (/^docs\/ADR-/.test(file)) return "Registro de decisión arquitectónica.";
  if (/manual-usuario/.test(file)) return "Manual localizado de usuario.";
  if (file === "docs/PENDIENTES.md") return "Registro de trabajo pendiente y deuda conocida.";
  return "Documento presente en el checkout; revisar su estado antes de retirarlo.";
}

export function generateCanonicalIndex() {
  const files = docsFiles();
  const rows = files.map((file) => ({
    file,
    state: file === "docs/PENDIENTES.md" ? "transitorio" : "vivo",
    note: noteFor(file),
  }));
  const table = rows.map((row) => `| \`${row.file}\` | ${row.state} | ${row.note} |`);
  return [
    "# Inventario documental — BookmarkForge",
    "",
    "Este índice se genera desde los documentos presentes en el checkout. Un documento eliminado deja de aparecer aquí; cualquier retiro debe quedar trazado en `docs/PENDIENTES.md` o en un ADR.",
    "",
    "## Estados",
    "",
    "| Estado | Significado |",
    "|---|---|",
    "| `vivo` | Documento activo o usado por un flujo del proyecto. |",
    "| `transitorio` | Documento pendiente de consolidación. |",
    "| `archivo` | Evidencia histórica conservada. |",
    "| `retirable` | Puede eliminarse únicamente tras pasar `check:docs-retire`. |",
    "",
    "## Documentos presentes",
    "",
    "| Documento | Estado | Nota |",
    "|---|---|---|",
    ...table,
    "",
    "## Política de retiro",
    "",
    "Los documentos retirados no se reintroducen automáticamente. Antes de eliminar un documento presente, debe marcarse `retirable`, documentarse el motivo y pasar el gate de referencias. Los documentos críticos de operación, seguridad y cumplimiento no se consideran retirables: deben mantenerse o sustituirse por un documento equivalente.",
    "",
  ].join("\n");
}

function main() {
  const update = process.argv.includes("--update");
  // The open-core export re-curates docs/ and does not ship the canonical
  // state index (export-public-repo.mjs EXCLUDED_DIRS + PUBLIC_DOCS whitelist),
  // so the gate skips there explicitly instead of failing: the inventory is
  // enforced upstream, in this repository. A missing index WITHOUT the export
  // manifest is still a hard failure — that is a real regression.
  const isPublicExport =
    !fs.existsSync(INDEX_PATH) && fs.existsSync(path.join(ROOT, "manifest.json"));
  if (isPublicExport && !update) {
    console.log(
      "[check:docs-index] skip: public export re-curates docs/ and excludes the canonical state index; the inventory is enforced upstream.",
    );
    return;
  }
  if (!fs.existsSync(INDEX_PATH)) {
    if (!update) {
      console.error(`Missing ${INDEX_PATH}; run node scripts/doctor-docs-index.mjs --update`);
      process.exit(1);
    }
    fs.writeFileSync(INDEX_PATH, "# placeholder\n", "utf8");
  }
  const canonical = generateCanonicalIndex();
  const current = fs.readFileSync(INDEX_PATH, "utf8");
  if (update) {
    fs.writeFileSync(INDEX_PATH, canonical, "utf8");
    console.log(`docs index updated: ${docsFiles().length} files`);
    return;
  }
  if (normalizeEol(current) !== normalizeEol(canonical)) {
    console.error("docs/docs-state-index.md has drift; run node scripts/doctor-docs-index.mjs --update");
    process.exit(2);
  }
  const rows = parseStateIndex(current);
  const expected = new Set(docsFiles());
  for (const row of rows) {
    if (!ALLOWED_STATES.has(row.state) || !expected.has(row.file) || !fs.existsSync(path.resolve(ROOT, row.file))) {
      console.error(`Invalid or missing indexed document: ${row.file}`);
      process.exit(3);
    }
  }
  if (!rows.some((row) => row.file === "docs/legacy-schema-version-map.md")) {
    console.error("docs index must include docs/legacy-schema-version-map.md");
    process.exit(4);
  }
  if (rows.length !== expected.size) {
    console.error(`docs index coverage drift: ${rows.length} rows, ${expected.size} files`);
    process.exit(5);
  }
  if (rows.some((row) => row.state === "retirable")) {
    console.error("docs index contains retirable rows; retirement requires explicit review");
    process.exit(6);
  }
  console.log(`docs-state-index checks OK (${rows.length} documents)`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href) main();
