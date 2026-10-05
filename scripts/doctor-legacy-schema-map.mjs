/** @license SPDX-License-Identifier: MIT */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX_PATH = resolve(ROOT, 'docs/docs-state-index.md');
const MAP_PATH = resolve(ROOT, 'docs/legacy-schema-version-map.md');

const ALLOWED_INDEX_STATES = new Set(['vivo', 'transitorio', 'archivo', 'retirable']);

function parseIndexRows(text) {
  const lines = text.split('\n');
  const rows = [];
  let inTable = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('| Documento | Estado | Nota |')) {
      inTable = true;
      continue;
    }
    if (inTable) {
      if (trimmed.startsWith('|---')) continue;
      if (trimmed.startsWith('|')) {
        const raw = trimmed.split('|');
        if (raw.length < 4) break;
        const cells = raw.slice(1, -1).map((c) => c.trim());
        const file = cells[0].replace(/`/g, '').trim();
        const state = cells[1].trim();
        const note = cells[2].trim();
        if (file && state) rows.push({ file, state, note });
        else break;
      } else break;
    }
  }
  return rows;
}

function main() {
  if (!existsSync(INDEX_PATH)) {
    console.error(`Missing index: ${INDEX_PATH}`);
    process.exit(2);
  }
  if (!existsSync(MAP_PATH)) {
    console.error(`Missing legacy schema map: ${MAP_PATH}`);
    process.exit(3);
  }

  const indexRows = parseIndexRows(readFileSync(INDEX_PATH, 'utf8'));
  const knownIndexFiles = new Set(indexRows.map((r) => r.file));

  if (!knownIndexFiles.has('docs/legacy-schema-version-map.md')) {
    console.error('docs/docs-state-index.md does not list docs/legacy-schema-version-map.md');
    process.exit(4);
  }

  const mapRow = indexRows.find((r) => r.file === 'docs/legacy-schema-version-map.md');
  if (!ALLOWED_INDEX_STATES.has(mapRow.state)) {
    console.error(`Unexpected state for legacy schema map: ${mapRow.state}`);
    process.exit(5);
  }
  if (mapRow.note.length === 0) {
    console.error('docs/legacy-schema-version-map.md needs a non-empty note in docs/docs-state-index.md');
    process.exit(6);
  }

  const mapText = readFileSync(MAP_PATH, 'utf8');
  if (!mapText.includes('| Collection | Version | Encrypted fields |')) {
    console.error('docs/legacy-schema-version-map.md missing expected table header');
    process.exit(7);
  }

  const entries = [];
  let inTable = false;
  for (const line of mapText.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('| Collection | Version | Encrypted fields |')) { inTable = true; continue; }
    if (inTable) {
      if (trimmed.startsWith('|---')) continue;
      if (trimmed.startsWith('|')) {
        const raw = trimmed.split('|');
        if (raw.length < 4) break;
        const cells = raw.slice(1, -1).map((c) => c.trim());
        const file = cells[0].replace(/`/g, '').trim();
        const version = cells[1].trim();
        const encrypted = cells[2].replace(/`/g, '').trim();
        if (file && version) entries.push({ file, version, encrypted });
        else break;
      } else break;
    }
  }

  if (entries.length === 0) {
    console.error('docs/legacy-schema-version-map.md has no parsed entries');
    process.exit(8);
  }

  console.log('legacy-schema-map re-check OK');
  console.log(`index rows: ${indexRows.length}`);
  console.log(`map collections: ${entries.length}`);
  console.log(`map row state: ${mapRow.state}`);
}

main();
