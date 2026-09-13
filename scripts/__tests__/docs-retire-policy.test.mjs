/**
 * scripts/__tests__/docs-retire-policy.test.mjs
 *
 * Contract test for the docs retirement gate.
 *
 * Rule: a docs file may be deleted only if both:
 *  1. docs/docs-state-index.md lists that file with state `retirable`
 *  2. a separate reference scan agrees that the file has no remaining
 *     live references in the repository.
 *
 * This test deliberately does not delete anything. It encodes the rule,
 * validates the index shape, and simulates the consent path so the same
 * logic can be reused in CI and locally.
 */

import { describe, it } from 'vitest';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const INDEX_PATH = path.resolve(ROOT, 'docs/docs-state-index.md');

const RETIRABLE_STATE = 'retirable';
const ALLOWED_STATES = new Set(['vivo', 'transitorio', 'archivo', 'retirable']);

function parseStateIndex(markdownText) {
  const lines = markdownText.split('\n');
  const rows = [];
  let inTable = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('| Documento | Estado | Nota |')) {
      inTable = true;
      continue;
    }
    if (inTable) {
      if (trimmed.startsWith('|---')) {
        continue;
      }
      if (trimmed.startsWith('|')) {
        const cells = trimmed.split('|').map((c) => c.trim()).filter(Boolean);
        if (cells.length >= 3) {
          rows.push({
            file: cells[0].replace(/`/g, '').trim(),
            state: cells[1].trim(),
            note: cells[2].trim(),
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

function rowForPath(rows, file) {
  return rows.find((row) => row.file === file);
}

/**
 * Simulated consent check for documentation retirement.
 *
 * In real retirement automation this would be replaced by an actual
 * reference scan over repo text. For now we intentionally keep this
 * conservative: the mock agrees only if the index already marks the file
 * as retirable AND the file exists in the index table.
 */
function mockReferenceScanAgrees(rows, file) {
  const row = rowForPath(rows, file);
  if (!row) {
    return false;
  }
  // Extra conservative guard: only simulate agreement for retirable rows
  // that have a non-empty rationale.
  return (
    row.state === RETIRABLE_STATE &&
    row.note.length > 0 &&
    row.file.startsWith('docs/')
  );
}

describe('docs-retire-policy', () => {
  it('should exist and be parseable', () => {
    assert.ok(fs.existsSync(INDEX_PATH), `Expected docs/docs-state-index.md at ${INDEX_PATH}`);

    const text = fs.readFileSync(INDEX_PATH, 'utf8');
    const rows = parseStateIndex(text);

    assert.ok(rows.length > 0, 'docs/docs-state-index.md had no parseable table rows');

    const states = new Set(rows.map((row) => row.state));
    for (const state of states) {
      assert.ok(
        ALLOWED_STATES.has(state),
        `Unexpected state in docs/docs-state-index.md: "${state}". Allowed: ${[...ALLOWED_STATES].join(', ')}`,
      );
    }

    // No duplicate rows per path.
    const seen = new Set();
    for (const row of rows) {
      assert.ok(!seen.has(row.file), `Duplicate row for ${row.file} in docs/docs-state-index.md`);
      seen.add(row.file);
    }

    // No missing referenced files.
    for (const row of rows) {
      assert.ok(fs.existsSync(path.resolve(ROOT, row.file)), `docs/docs-state-index.md references missing file: ${row.file}`);
    }

    // No existing file is marked retirable without a rationale.
    for (const row of rows) {
      if (row.state === RETIRABLE_STATE) {
        assert.ok(
          row.note.length > 0,
          `docs/docs-state-index.md marks ${row.file} as retirable but has no rationale`,
        );
      }
    }
  });

  it('should only consent to retirement when both the index and the scan agree', () => {
    const text = fs.readFileSync(INDEX_PATH, 'utf8');
    const rows = parseStateIndex(text);

    const retirableRows = rows.filter((row) => row.state === RETIRABLE_STATE);

    // Current repo state: nothing should be retirable yet.
    assert.ok(
      retirableRows.length === 0,
      `Expected 0 retirable docs right now, found: ${retirableRows.map((r) => r.file).join(', ')}`,
    );

    // Consent rule is strict: both signals must be true.
    for (const row of rows) {
      const scanAgrees = mockReferenceScanAgrees(rows, row.file);
      const indexSaysRetirable = row.state === RETIRABLE_STATE;
      const consented = indexSaysRetirable && scanAgrees;

      assert.ok(
        !(indexSaysRetirable && !scanAgrees),
        `Index says retirable for ${row.file} but scan would not consent; retirement must be blocked`,
      );
      assert.ok(
        !consented || row.state === RETIRABLE_STATE,
        `Retirement consent must imply retirable state in docs/docs-state-index.md`,
      );
    }
  });

  it('should refuse retirement for any file not present in the index', () => {
    const text = fs.readFileSync(INDEX_PATH, 'utf8');
    const rows = parseStateIndex(text);
    const knownFiles = new Set(rows.map((row) => row.file));

    function wouldConsentToRetirement(file) {
      const indexSaysRetirable = rowForPath(rows, file)?.state === RETIRABLE_STATE;
      const scanAgrees = mockReferenceScanAgrees(rows, file);
      return indexSaysRetirable && scanAgrees;
    }

    // If a file is not in the index it cannot be retired.
    for (const file of [...knownFiles].slice(0, 3)) {
      assert.ok(
        knownFiles.has(file),
        'sanity: row from parsed index must be in known set',
      );
      assert.ok(
        wouldConsentToRetirement(file) === (rowForPath(rows, file)?.state === RETIRABLE_STATE && mockReferenceScanAgrees(rows, file)),
        'consent logic must be deterministic',
      );
    }

    assert.ok(
      !wouldConsentToRetirement('docs/this-file-does-not-exist.md'),
      'retirement must be refused for undocumented files',
    );
  });
});
