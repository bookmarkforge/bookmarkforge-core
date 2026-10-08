/** @license SPDX-License-Identifier: MIT */
// Template text is English on purpose: this generator must reproduce the
// committed docs/legacy-schema-version-map.md byte for byte (translated in
// c57bf01). Keep it byte-identical to build-legacy-schema-map.mjs.
import { writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA_PATH = resolve(ROOT, 'src/db/schema.ts');
const OUT_PATH = resolve(ROOT, 'docs/legacy-schema-version-map.md');

/** @typedef {{ collection: string, version: number, encrypted: string[] }} SchemaEntry */

function parseSchemaFile(source) {
  const entries = [];
  const collectionRegex = /(?:export\s+(?:const|interface|async\s+function|function|class|type)\s+)?([A-Za-z0-9_]+)(?:Schema|:?\s*RxJsonSchema)/;
  const versionRegex = /version:\s*(\d+)/;
  const encryptedRegex = /encrypted:\s*\[([^\]]*)\]/;

  const lines = source.split('\n');
  let currentCollection = null;
  let insideSchemaLiteral = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!insideSchemaLiteral) {
      const match = trimmed.match(collectionRegex);
      if (match && /Schema/.test(match[1])) {
        currentCollection = match[1];
        insideSchemaLiteral = true;
      }
      continue;
    }

    if (!insideSchemaLiteral) continue;

    const versionMatch = trimmed.match(versionRegex);
    if (versionMatch) {
      currentCollection = currentCollection ?? 'unknown';
      let encrypted = [];
      const encryptedMatch = trimmed.match(encryptedRegex);
      if (encryptedMatch) {
        encrypted = encryptedMatch[1]
          .split(',')
          .map((s) => s.trim().replace(/^["']|["']$/g, ''))
          .filter(Boolean);
      }
      entries.push({ collection: currentCollection, version: Number(versionMatch[1]), encrypted });
      currentCollection = null;
      insideSchemaLiteral = false;
    }
  }

  return entries;
}

const source = (await import('node:fs')).readFileSync(SCHEMA_PATH, 'utf8');
const rows = parseSchemaFile(source);

if (rows.length === 0) {
  throw new Error('Could not parse any schema entries from src/db/schema.ts');
}

rows.sort((a, b) => a.collection.localeCompare(b.collection));

const table = [
  '# Schema version map — BookmarkForge',
  '',
  'This file records the RxDB schema version map active for the current codebase.',
  '',
  'It is automatically generated from `src/db/schema.ts`. Do not edit manually.',
  'Its function is to offer a stable compatibility/migration diagnosis without touching real vault data.',
  '',
  '| Collection | Version | Encrypted fields |',
  '|---|---|---|',
  ...rows.map((r) => `| \`${r.collection}\` | ${r.version} | \`${r.encrypted.join('`, `')}\` |`),
  '',
  'Note: the version is read from the `version` property declared in the corresponding RxDB schema.',
  '',
].join('\n');

await writeFile(OUT_PATH, table, 'utf8');

console.log(`Wrote ${OUT_PATH}`);
console.log(`Collections: ${rows.length}`);
