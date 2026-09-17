#!/usr/bin/env node
/**
 * scripts/__tests__/audit-script-inventory.test.mjs
 *
 * Contract test for the automated entrypoint inventory used by the legacy/noise cleanup plan.
 *
 * It does not assert which scripts "should" exist. It asserts that the inventory
 * generation is stable and reproducible across runs, and that the current unreferenced
 * candidate list matches what this test snapshot expects. Any real script deletion must
 * first be reflected here, so the snapshot is the source of truth for "what we decided
 * was unused" rather than a one-off shell analysis.
 *
 * Reconciliation 2026-09-09: the scanner's SCRIPT_EXTENSIONS was built as
 * `new Set('.js', '.mjs', '.cjs')` — a set of CHARACTERS, which silently made
 * listScripts() return [] and the contract assert [] === snapshot forever.
 * Fixed to `new Set(['.js', '.mjs', '.cjs'])` and the snapshot regenerated
 * from the real scan (21 candidates). "Unreferenced" means unreferenced by
 * THIS scanner only (.js/.mjs/.cjs sources + ci.yml + package.json); known
 * blind spots that keep alive several listed candidates: sibling imports
 * inside scripts/ (`./x.mjs`), non-CI workflows (.github/workflows/*.yml
 * other than ci.yml), docker-compose files, docs, and paths constructed at
 * runtime (e.g. build-ci.mjs joins "scripts", "rollup-wasm-loader.cjs").
 * Per docs/legacy-compatibility-plan.md, candidates are a review queue —
 * NOT a deletion list; removal requires separate evidence and review.
 *
 * Regenerating the snapshot (documented in
 * docs/scripts-inventory-scanner-limits.md) is `node
 * scripts/__tests__/audit-script-inventory.test.mjs --update`. The flag was
 * documented but missing: without it the only way to refresh the snapshot was
 * to hand-copy the diff out of a failing assertion, which is exactly how a
 * snapshot drifts from the scanner it is supposed to mirror.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const THIS_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'audit-script-inventory.test.mjs');
const ROOT = path.resolve(path.dirname(THIS_FILE), '..', '..');
if (!fs.existsSync(ROOT)) throw new Error(`Unexpected ROOT computed by audit-script-inventory.test.mjs: ${ROOT}`);
const CANDIDATES_FILE = path.resolve(ROOT, '.tmp-audit-script-candidates.txt');
// The snapshot is intentionally unversioned (see docs/scripts-inventory-scanner-limits.md
// and scripts/export-public-repo.mjs), so its absence is the normal state of a fresh
// checkout — NOT an error. Checking it here used to throw at import time, which made
// `--update` impossible: the only way to create the snapshot was to import the module
// that refused to load without it. The contract now fails (or skips) where it runs.
const SNAPSHOT_PRESENT = fs.existsSync(CANDIDATES_FILE);

const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'coverage',
  'test-results',
  'playwright-report',
  '.freebuff',
]);

// Set.from argument list: pass ONE array — new Set('.js','.mjs','.cjs')
// would build a set of characters and silently empty listScripts().
const SCRIPT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);

function scanReferences() {
  const refs = new Map();

  function add(rel, kind) {
    if (!refs.has(rel)) refs.set(rel, new Set());
    refs.get(rel).add(kind);
  }

  function scanFile(p) {
    // Keep the relative-path computation available for future diagnostics.
    // The current reference scan works on module name patterns only, but we
    // leave this expression in place so the variable is not flagged as unused.
    void path.relative(ROOT, p).replaceAll('\\', '/');
    const ext = p.slice(p.lastIndexOf('.'));
    if (!SCRIPT_EXTENSIONS.has(ext)) return;

    let src;
    try {
      src = fs.readFileSync(p, 'utf8');
    } catch {
      return;
    }

    if (!/'use strict'|import|require|from\s+|export/.test(src)) return;

    const patterns = [
      { re: /['"`](?:scripts\/)([a-z0-9_.-]+\.(?:mjs|js|cjs))['"`]/g, kind: 'string-literal' },
      {
        re: /from\s+['"`](?:scripts\/)([a-z0-9_.-]+\.(?:mjs|js|cjs))['"`]/g,
        kind: 'import',
      },
      {
        re: /from\s+['"]\.\.\/?scripts\/([a-z0-9_.-]+\.(?:mjs|js|cjs))['"`]/g,
        kind: 'import',
      },
      {
        re: /require\(['"`](?:scripts\/)([a-z0-9_.-]+\.(?:mjs|js|cjs))['"`]\)/g,
        kind: 'require',
      },
      {
        re: /require\(['"]\.\.\/?scripts\/([a-z0-9_.-]+\.(?:mjs|js|cjs))['"`]\)/g,
        kind: 'require',
      },
      {
        re: /(?:node|npm\s+(?:run|exec|s)|\bcall\s+)\s+['"]?scripts\/([a-z0-9_.-]+\.(?:mjs|js|cjs))['"]?/g,
        kind: 'shell-ref',
      },
      {
        re: /(?:^|\s)(?:node|npm\s+(?:run|exec|s)|npx|call)\s+(?:--[^\s]*\s+)*['"]?scripts\/([a-z0-9_.-]+\.(?:mjs|js|cjs))['"]?/gm,
        kind: 'shell-ref',
      },
    ];

    for (const { re, kind } of patterns) {
      let m;
      while ((m = re.exec(src))) {
        add(m[1], kind);
      }
    }
  }

  function walk(base) {
    const dir = path.resolve(base);
    if (!fs.existsSync(dir)) return;

    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (IGNORE_DIRS.has(e.name)) continue;
        walk(p);
      } else {
        scanFile(p);
      }
    }
  }

  walk(ROOT);

  {
    const ci = fs.readFileSync(path.resolve(ROOT, '.github/workflows/ci.yml'), 'utf8');
    const re = /scripts\/([a-z0-9_.-]+\.(?:mjs|js|cjs))/g;
    let m;
    while ((m = re.exec(ci))) {
      add(m[1], 'ci');
    }
  }

  {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(ROOT, 'package.json'), 'utf8'));
    for (const cmd of Object.values(pkg.scripts || {})) {
      if (typeof cmd !== 'string') continue;
      const re = /scripts\/([a-z0-9_.-]+\.(?:mjs|js|cjs))/g;
      let m;
      while ((m = re.exec(cmd))) {
        add(m[1], 'package-script');
      }
    }
  }

  return refs;
}

function listScripts() {
  const scriptsDir = path.resolve(ROOT, 'scripts');
  if (!fs.existsSync(scriptsDir)) return [];
  return fs
    .readdirSync(scriptsDir)
    .map((f) => f.replaceAll('\\', '/'))
    .filter((f) => SCRIPT_EXTENSIONS.has('.' + f.split('.').slice(-1)[0]))
    .sort();
}

export function computeUnreferencedCandidates() {
  const refs = scanReferences();
  const candidates = listScripts().filter((f) => !refs.has(f));
  return { refs, candidates };
}

// The snapshot contract is dual-mode: under vitest it registers as a real
// test (top-level asserts made the file unloadable — "No test suite found");
// under plain node it runs immediately, so `node scripts/__tests__/check-
// audit-script-snapshot.mjs` (which imports this module) still enforces it.
async function runSnapshotContract() {
  assert.ok(SNAPSHOT_PRESENT, `Snapshot file missing at ${CANDIDATES_FILE}. Regenerate it with: node scripts/__tests__/audit-script-inventory.test.mjs --update`);
  const CURRENT_TEXT = fs.readFileSync(CANDIDATES_FILE, 'utf8').trim().split('\n').filter(Boolean).sort();
  const COMPUTED = computeUnreferencedCandidates().candidates;

  assert.deepStrictEqual(
    COMPUTED,
    CURRENT_TEXT,
    `Unreferenced candidate list drifted from snapshot at ${CANDIDATES_FILE}.

If a script was genuinely deleted or newly referenced, update the snapshot by re-running
the inventory command from the audit checklist and then updating this test's expected
list. Do not relax this assertion to silence a real change.`,
  );

  assert.ok(COMPUTED.length < 25, `Unreferenced candidate set is unexpectedly large (${COMPUTED.length}); review before pruning.`);
}

if (process.env.VITEST) {
  const { describe, test } = await import('vitest');
  // Skipped (not failed) without the snapshot: it is unversioned local audit
  // machinery, and a red suite on every fresh checkout teaches people to
  // ignore this test. `test:slow` stays deterministic; regenerate to enforce.
  describe.skipIf(!SNAPSHOT_PRESENT)('entrypoint inventory snapshot contract', () => {
    test('unreferenced candidate list matches the audit snapshot', async () => {
      await runSnapshotContract();
    });
  });
} else if (process.argv.includes("--update")) {
  const { candidates } = computeUnreferencedCandidates();
  fs.writeFileSync(CANDIDATES_FILE, candidates.join("\n") + "\n");
  console.log(
    `[audit-script-inventory] snapshot regenerated: ${candidates.length} unreferenced candidate(s) → ${CANDIDATES_FILE}`,
  );
} else {
  await runSnapshotContract();
}
