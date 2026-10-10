#!/usr/bin/env node
// scripts/build-legacy-schema-map.mjs
// Generates docs/legacy-schema-version-map.md from src/db/schema.ts.
// Idiomatic ESM, no TypeScript.
//
// The template text below is English because the committed document is: it was
// translated in c57bf01 (which did not touch this script), and the file declares
// itself generated, so regenerating it must reproduce those bytes exactly.
// Spanish output here is what made every `npm test` rewrite the document.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SCHEMA_PATH = path.resolve(ROOT, 'src/db/schema.ts');
const OUT_PATH = path.resolve(ROOT, 'docs/legacy-schema-version-map.md');

const rxCollection = /(?:export\s+(?:const|interface|type|function|async\s+function)\s+)?([A-Za-z0-9_]+)(?:Schema|:?\s*RxJsonSchema)/;
const rxVersion = /version:\s*(\d+)/;
const rxEncrypted = /encrypted:\s*\[([^\]]*)\]/;

function parseSchemaFile(source) {
  const lines = source.split('\n');
  let current = null;
  const rows = [];
  for (const line of lines) {
    const trim = line.trim();
    if (current === null) {
      const m = trim.match(rxCollection);
      if (m && /Schema/.test(m[1])) { current = m[1]; }
      continue;
    }
    const vm = trim.match(rxVersion);
    if (vm) {
      let enc = [];
      const em = trim.match(rxEncrypted);
      if (em) {
        enc = em[1]
          .split(',')
          .map(s => s.trim().replace(/^["']|["']$/g, ''))
          .filter(Boolean);
      }
      rows.push({ collection: current, version: Number(vm[1]), encrypted: enc });
      current = null;
    }
  }
  return rows;
}

const source = fs.readFileSync(SCHEMA_PATH, 'utf8');
const rows = parseSchemaFile(source);

if (rows.length === 0) {
  throw new Error('No schema entries parsed from src/db/schema.ts');
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
  ...rows.map(r => `| \`${r.collection}\` | ${r.version} | \`${r.encrypted.join('`, `')}\` |`),
  '',
  'Note: the version is read from the `version` property declared in the corresponding RxDB schema.',
  '',
].join('\n');

fs.writeFileSync(OUT_PATH, table, 'utf8');
console.log('Wrote', OUT_PATH);
console.log('Collections:', rows.length);
console.log(rows.map(r => `- ${r.collection} v${r.version}`).join('\n'));
