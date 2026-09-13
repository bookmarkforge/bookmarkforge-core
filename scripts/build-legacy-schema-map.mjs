#!/usr/bin/env node
// scripts/build-legacy-schema-map.mjs
// Generates docs/legacy-schema-version-map.md from src/db/schema.ts.
// Idiomatic ESM, no TypeScript.

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
  '# Mapa de versiones de esquema — BookmarkForge',
  '',
  'Este archivo registra el mapa de versiones del esquema RxDB activo para la codebase actual.',
  '',
  'Se genera automáticamente desde `src/db/schema.ts`. No se edita a mano.',
  'Su función es ofrecer un diagnóstico estable de compatibilidad/migración sin tocar datos reales del vault.',
  '',
  '| Colección | Versión | Campos cifrados |',
  '|---|---|---|',
  ...rows.map(r => `| \`${r.collection}\` | ${r.version} | \`${r.encrypted.join('`, `')}\` |`),
  '',
  'Nota: la versión se lee desde la propiedad `version` declarada en el esquema RxDB correspondiente.',
  '',
].join('\n');

fs.writeFileSync(OUT_PATH, table, 'utf8');
console.log('Wrote', OUT_PATH);
console.log('Collections:', rows.length);
console.log(rows.map(r => `- ${r.collection} v${r.version}`).join('\n'));
