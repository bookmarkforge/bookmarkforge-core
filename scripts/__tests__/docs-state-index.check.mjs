#!/usr/bin/env node
/**
 * scripts/__tests__/docs-state-index.check.mjs
 *
 * Standalone check for docs/docs-state-index.md that runs without vitest.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const INDEX_PATH = path.resolve(ROOT, 'docs/docs-state-index.md');

assert.ok(fs.existsSync(INDEX_PATH), `Expected docs/docs-state-index.md to exist at ${INDEX_PATH}`);

const text = fs.readFileSync(INDEX_PATH, 'utf8');

const STATE_VALUES = new Set(['vivo', 'transitorio', 'archivo', 'retirable']);

function parseRows(markdownText) {
  const lines = markdownText.split('\n');
  const rows = [];
  let inTable = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('| Document | State | Note |') || trimmed.startsWith('| Documento | Estado | Nota |')) {
      inTable = true;
      continue;
    }
    if (inTable) {
      if (trimmed.startsWith('|---')) {
        continue;
      }
      if (trimmed.startsWith('|')) {
        const cells = trimmed.split('|').map((c) => c.trim()).filter(Boolean);
        if (cells.length >= 2) {
          rows.push({
            file: cells[0].replace(/`/g, '').trim(),
            state: cells[1].trim(),
            note: (cells[2] ?? '').trim(),
          });
        } else {
          break;
        }
      } else {
        inTable = false;
      }
    }
  }

  return rows;
}

const rows = parseRows(text);

assert.ok(
  rows.length > 0,
  'docs/docs-state-index.md did not yield any parsed rows in the Document/State/Note table',
);

const knownStates = new Set(rows.map((row) => row.state));
for (const state of knownStates) {
  assert.ok(
    STATE_VALUES.has(state),
    `Unexpected state value in docs/docs-state-index.md: "${state}". Allowed: ${[...STATE_VALUES].join(', ')}`,
  );
}

const fileSet = new Set();
const byPath = new Map();
for (const row of rows) {
  assert.ok(
    row.file.startsWith('docs/'),
    `Row file looks like an unexpected path in docs/docs-state-index.md: ${row.file}`,
  );
  assert.ok(
    !byPath.has(row.file),
    `Duplicate path in docs/docs-state-index.md: ${row.file}`,
  );
  byPath.set(row.file, row);
  fileSet.add(row.file);
}

const missing = [];
for (const file of fileSet) {
  const localPath = path.resolve(ROOT, file).replaceAll('\\', '/');
  if (!fs.existsSync(localPath)) {
    missing.push(file);
  }
}

assert.ok(
  missing.length === 0,
  `docs/docs-state-index.md references missing files:\n${missing.map((f) => ' - ' + f).join('\n')}`,
);

const archiveRows = rows.filter((row) => row.state === 'archivo');
for (const row of archiveRows) {
  assert.ok(
    row.note.length > 0,
    `Archive row in docs/docs-state-index.md for ${row.file} must include a short note`,
  );
}

console.log('docs-state-index OK — parsed rows:', rows.length);
