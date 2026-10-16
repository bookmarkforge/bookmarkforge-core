/**
 * scripts/__tests__/check-docs-retire.test.mjs
 *
 * Contract tests for scripts/check-docs-retire.mjs.
 *
 * The gate must:
 *  - refuse to run when docs/docs-state-index.md is missing
 *  - fail on unknown states, missing referenced files or duplicate rows
 *  - allow the run when there are no retirable docs
 *  - block deletion candidates where the index says retirable but the
 *    reference scan does not yet consent
 */

import { describe, it } from 'vitest';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GATE_PATH = path.resolve(ROOT, 'scripts/check-docs-retire.mjs');

// spawnSync with argv, never a shell string: an interpolated command splits an
// absolute gate path on its spaces (`node D:\Nueva carpeta\...\gate.mjs` became
// "Cannot find module 'D:\Nueva'"), and joining args into a shell line invites
// injection. The failure mode was silent in the worst way — the two tests that
// assert a NON-zero exit passed for the wrong reason (the spawn error's status
// is non-zero), so only the "expected success" cases caught it.
function runGate(args = []) {
  const result = spawnSync(process.execPath, [GATE_PATH, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exitCode: result.status ?? 1,
  };
}

describe('check-docs-retire', () => {
  it('should fail when docs/docs-state-index.md is missing', () => {
    const tmpRoot = path.resolve(ROOT, '.tmp-docs-retire-nonexistent');
    fs.mkdirSync(tmpRoot, { recursive: true });
    try {
      const result = runGate(['--root', tmpRoot]);
      assert.ok(result.exitCode !== 0, 'expected non-zero exit when index missing');
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('should fail on unknown state values', () => {
    const badIndex = [
      '# Inventario de documentos — BookmarkForge',
      '',
      '## Estado actual',
      '',
      '| Documento | Estado | Nota |',
      '|---|---|---|',
      '| `docs/foo.md` | inventado | foo |',
      '',
    ].join('\n');

    const tmpRoot = path.resolve(ROOT, '.tmp-docs-retire-bad-state');
    fs.mkdirSync(tmpRoot, { recursive: true });
    try {
      fs.mkdirSync(path.join(tmpRoot, 'docs'), { recursive: true });
      fs.writeFileSync(path.join(tmpRoot, 'docs', 'foo.md'), '');
      fs.writeFileSync(path.join(tmpRoot, 'docs/docs-state-index.md'), badIndex);

      const result = runGate(['--root', tmpRoot]);
      assert.ok(result.exitCode !== 0, 'expected non-zero exit for bad state');
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('should fail when the index references a missing file', () => {
    const badIndex = [
      '# Inventario de documentos — BookmarkForge',
      '',
      '## Estado actual',
      '',
      '| Documento | Estado | Nota |',
      '|---|---|---|',
      '| `docs/missing.md` | vivo | missing |',
      '',
    ].join('\n');

    const tmpRoot = path.resolve(ROOT, '.tmp-docs-retire-missing-file');
    fs.mkdirSync(tmpRoot, { recursive: true });
    try {
      fs.mkdirSync(path.join(tmpRoot, 'docs'), { recursive: true });
      fs.writeFileSync(path.join(tmpRoot, 'docs/docs-state-index.md'), badIndex);

      const result = runGate(['--root', tmpRoot]);
      assert.ok(result.exitCode !== 0, 'expected non-zero exit for missing referenced file');
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('should fail on duplicate rows', () => {
    const badIndex = [
      '# Inventario de documentos — BookmarkForge',
      '',
      '## Estado actual',
      '',
      '| Documento | Estado | Nota |',
      '|---|---|---|',
      '| `docs/a.md` | vivo | a |',
      '| `docs/a.md` | vivo | a |',
      '',
    ].join('\n');

    const tmpRoot = path.resolve(ROOT, '.tmp-docs-retire-duplicate');
    fs.mkdirSync(tmpRoot, { recursive: true });
    try {
      fs.mkdirSync(path.join(tmpRoot, 'docs'), { recursive: true });
      fs.writeFileSync(path.join(tmpRoot, 'docs', 'a.md'), '');
      fs.writeFileSync(path.join(tmpRoot, 'docs/docs-state-index.md'), badIndex);

      const result = runGate(['--root', tmpRoot]);
      assert.ok(result.exitCode !== 0, 'expected non-zero exit for duplicate rows');
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('should pass when there are no retirable docs', () => {
    const tmpRoot = path.resolve(ROOT, '.tmp-docs-retire-clean');
    fs.mkdirSync(tmpRoot, { recursive: true });
    try {
      fs.mkdirSync(path.join(tmpRoot, 'docs'), { recursive: true });
      const index = [
        '# Inventario de documentos — BookmarkForge',
        '',
        '## Estado actual',
        '',
        '| Documento | Estado | Nota |',
        '|---|---|---|',
        '| `docs/ok.md` | vivo | ok |',
        '',
      ].join('\n');
      fs.writeFileSync(path.join(tmpRoot, 'docs', 'ok.md'), '');
      fs.writeFileSync(path.join(tmpRoot, 'docs/docs-state-index.md'), index);

      const result = runGate(['--root', tmpRoot]);
      assert.ok(result.exitCode === 0, `expected 0 exit; got ${result.exitCode}\n${result.stderr}`);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('should block when index says retirable but reference scan does not consent', () => {
    const tmpRoot = path.resolve(ROOT, '.tmp-docs-retire-blocked');
    fs.mkdirSync(tmpRoot, { recursive: true });
    try {
      fs.mkdirSync(path.join(tmpRoot, 'docs'), { recursive: true });
      const index = [
        '# Inventario de documentos — BookmarkForge',
        '',
        '## Estado actual',
        '',
        '| Documento | Estado | Nota |',
        '|---|---|---|',
        '| `docs/blocked.md` | retirable |  |',
        '| `docs/ok.md` | vivo | ok |',
        '',
      ].join('\n');
      fs.writeFileSync(path.join(tmpRoot, 'docs', 'blocked.md'), '');
      fs.writeFileSync(path.join(tmpRoot, 'docs', 'ok.md'), '');
      fs.writeFileSync(path.join(tmpRoot, 'docs/docs-state-index.md'), index);

      const result = runGate(['--root', tmpRoot]);
      assert.ok(result.exitCode !== 0, 'expected non-zero exit when consent rule fails');
      assert.ok(result.stderr.includes('blocked') || result.stdout.includes('blocked'), 'expected failure to mention blocked file');
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
