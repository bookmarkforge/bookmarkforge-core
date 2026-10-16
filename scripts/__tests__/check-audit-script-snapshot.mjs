#!/usr/bin/env node
/**
 * Standalone snapshot check for scripts/__tests__/audit-script-inventory.test.mjs.
 *
 * This is the same assertion the test uses, but run directly from the repo root so
 * the path semantics are easy to reason about. If this fails, do NOT relax the test.
 * Instead, update the snapshot as documented in the audit plan.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = path.dirname(THIS_FILE);
const ROOT = path.resolve(THIS_DIR, '..', '..');
const CANDIDATES_FILE = path.resolve(ROOT, '.tmp-audit-script-candidates.txt');
const AUDIT_TEST_FILE = path.resolve(THIS_DIR, 'audit-script-inventory.test.mjs');

{
  const mod = await import(`file://${AUDIT_TEST_FILE}`);
  const { computeUnreferencedCandidates } = mod;
  const computed = computeUnreferencedCandidates().candidates;

  assert.ok(fs.existsSync(CANDIDATES_FILE), `Snapshot file missing at ${CANDIDATES_FILE}.`);
  const current = fs
    .readFileSync(CANDIDATES_FILE, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .sort();

  assert.deepStrictEqual(
    computed,
    current,
    'Snapshot drifted from .tmp-audit-script-candidates.txt. Update the snapshot, do not relax the assertion.',
  );
  assert.ok(
    computed.length < 25,
    `Unreferenced candidate set unexpectedly large (${computed.length}); review before pruning.`,
  );

  console.log('snapshot OK; unreferenced candidates:', current.join(', '));
}
