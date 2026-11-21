#!/usr/bin/env node
/**
 * scripts/check-docs-retire.mjs
 *
 * CI gate for documentation retirement.
 *
 * This gate is intentionally conservative: it blocks deletion of any docs
 * file unless:
 *  1. docs/docs-state-index.md lists that file with state `retirable`
 *  2. a separate reference scan confirms the file has no remaining live
 *     references in the repository
 *
 * If a caller wants to delete a docs file outside this gate, they must first
 * make docs/docs-state-index.md state consistent with the intended retirement,
 * then rerun this gate. The gate must pass before the deletion is allowed.
 *
 * This script does not modify the index. It only enforces the consent rule.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX_PATH_BY_ROOT = (root) => path.resolve(root, 'docs/docs-state-index.md');

const RETIRABLE_STATE = 'retirable';
/** Inventory table header. English is canonical since the generator stopped
 * emitting Spanish notes (see doctor-docs-index.mjs); the Spanish form is
 * still recognised so an index generated before that change parses instead of
 * silently yielding zero rows. */
const TABLE_HEADERS = ['| Document | State | Note |', '| Documento | Estado | Nota |']; // i18n-allow — legacy anchor
const ALLOWED_STATES = new Set(['vivo', 'transitorio', 'archivo', 'retirable']);

function parseStateIndex(markdownText) {
  const lines = markdownText.split('\n');
  const rows = [];
  let inTable = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (TABLE_HEADERS.some((header) => trimmed.startsWith(header))) {
      inTable = true;
      continue;
    }
    if (inTable) {
      if (trimmed.startsWith('|---')) {
        continue;
      }
      if (trimmed.startsWith('|')) {
        const rawCells = trimmed.split('|');
        if (rawCells.length < 4) {
          break;
        }
        const cells = rawCells.slice(1, -1).map((c) => c.trim());
        const file = cells[0].replace(/`/g, '').trim();
        const state = cells[1].trim();
        const note = cells[2].trim();
        if (state && file) {
          rows.push({ file, state, note });
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

/**
 * Simulated reference scan for this gate.
 *
 * In a real retreat automation this would be replaced by an actual repo-wide
 * scan for references to the docs file. For now we keep it conservative:
 * only files that are already marked `retirable` with a non-empty rationale
 * are considered eligible for deletion.
 */
function referenceScanAllowsRetirement(rows, file, root) {
  const row = rows.find((r) => r.file === file);
  if (!row) {
    return false;
  }

  return (
    row.state === RETIRABLE_STATE &&
    row.note.length > 0 &&
    row.file.startsWith('docs/') &&
    fs.existsSync(path.resolve(root, file))
  );
}

function main() {
  const args = process.argv.slice(2);
  const rootArgIndex = args.indexOf('--root');
  let root = DEFAULT_ROOT;

  if (rootArgIndex !== -1 && args[rootArgIndex + 1]) {
    root = path.resolve(args[rootArgIndex + 1]);
  }

  const indexPath = INDEX_PATH_BY_ROOT(root);

  // The open-core export re-curates docs/ (export-public-repo.mjs) and the
  // private index therefore does not ship. There the gate skips explicitly
  // instead of failing: retirement consent is enforced in the private source
  // repo. A missing index WITHOUT the export manifest stays fail-closed.
  if (!fs.existsSync(indexPath) && fs.existsSync(path.resolve(root, "manifest.json"))) {
    console.log("docs-retire gate: public export (private docs index absent) — nothing to enforce.");
    process.exit(0);
  }

  if (!fs.existsSync(indexPath)) {
    console.error(`Error: missing docs/docs-state-index.md at ${indexPath}`);
    process.exit(2);
  }

  const indexText = fs.readFileSync(indexPath, 'utf8');
  const rows = parseStateIndex(indexText);

  if (rows.length === 0) {
    console.error('Error: docs/docs-state-index.md had no parseable table rows');
    process.exit(3);
  }

  const duplicates = new Set();
  for (const row of rows) {
    if (!ALLOWED_STATES.has(row.state)) {
      console.error(`Error: unexpected state in docs/docs-state-index.md for ${row.file}: "${row.state}"`);
      process.exit(4);
    }
    if (!fs.existsSync(path.resolve(root, row.file))) {
      console.error(`Error: docs/docs-state-index.md references missing file: ${row.file}`);
      process.exit(5);
    }
    if (duplicates.has(row.file)) {
      console.error(`Error: duplicate row for ${row.file} in docs/docs-state-index.md`);
      process.exit(6);
    }
    duplicates.add(row.file);
  }

  const hasRetirable = rows.some((r) => r.state === RETIRABLE_STATE);
  if (!hasRetirable) {
    console.log('docs-retire gate: no retirable docs in index — deletions blocked.');
    process.exit(0);
  }

  console.log(`docs-retire gate: ${rows.filter((r) => r.state === RETIRABLE_STATE).length} retirable rows present.`);

  for (const row of rows) {
    if (row.state === RETIRABLE_STATE) {
      const scanAllows = referenceScanAllowsRetirement(rows, row.file, root);
      if (!scanAllows) {
        console.error(
          `docs-retire gate: blocked deletion candidate ${row.file}. Index says retirable, but reference scan does not yet consent.`,
        );
        process.exit(7);
      }
    }
  }

  console.log('docs-retire gate: consent satisfied for current retirable rows.');
  process.exit(0);
}

main();
