/**
 * scripts/__tests__/audit-anchors.test.mjs
 *
 * Vitest unit tests for `scripts/audit-anchors.mjs`. Covers the anchor
 * guarantees, the baseline catalog contract, and the current advisory:
 *   (a) all 24 anchors resolve today, and no canonical-shape file in
 *        the catalog is mis-classified as `discovered`
 *   (b) a `.bak` rename of any anchored file produces exactly 1 missing,
 *        leaving the other 21 anchors intact
 *   (c) a non-test suffix (`.txt`, etc.) that matches the bare regex is
 *        rejected by the suffix filter
 *   (d) `--fix` (i.e. `runAuditAnchors({ fix: true })`) writes baseline
 *        JSON with a freshly-bumped `updatedAt`
 *   (e) a new canonical-shape `p5-*.regression.test.ts` shows up in
 *        `result.discovered` exactly once, never promotes to `failures`
 *        (so the CLI's advisory NEW … line never exits non-zero)
 *   (f) an anchor present in `ANCHORS[]` but absent from the baseline
 *        catalog is reported as catalog inflation and fails
 *   (g) a non-conformant catalog glob using `:` is reported as malformed
 *   (h) strict discovery mode promotes an otherwise advisory discovery to
 *        a hard failure
 *   (i) every `kind: "source"` catalog glob resolves against the actual
 *        repository, not only a synthetic Vitest fixture.
 *
 * Every synthetic test builds a fresh `mkdtempSync()` directory containing
 * the files it needs, chdirs there before `import()`-ing audit-anchors.mjs,
 * and chdirs back on teardown. Test (i) is the deliberate exception: it
 * runs the production catalog from the actual repo root and verifies every
 * source-kind glob against the real tree. Each `import()` carries a unique
 * `?v=…` cache-buster so vitest re-evaluates `ROOT = process.cwd()` for every
 * case.
 */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

// `import.meta.url` of THIS file lives at scripts/__tests__/.repo caches
// many of the modules paths relative-to-file — using a stable absolute
// path keeps the dynamic import below safe across machines.
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");
const AUDIT_SCRIPT = join(REPO_ROOT, "scripts", "audit-anchors.mjs");

/** Build a tmpdir tree containing exactly the files we want audit-anchors to see. */
function setupFakeRepo(files) {
  const root = mkdtempSync(join(tmpdir(), "audit-anchors-test-"));
  mkdirSync(join(root, "scripts"), { recursive: true });
  for (const [relPath, body] of Object.entries(files)) {
    const abs = join(root, relPath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  writeFileSync(
    join(root, "scripts", "audit-anchors-baseline.json"),
    JSON.stringify(
      {
        totalAnchors: BASELINE_ANCHORS.length,
        missingCount: 0,
        presentCount: BASELINE_ANCHORS.length,
        updatedAt: "2026-08-15T12:00:00.000Z",
        anchors: BASELINE_ANCHORS,
      },
      null,
      2,
    ) + "\n",
  );
  return root;
}

/**
 * The full set of 24 anchors from `audit-anchors.mjs`, mapped to fake files
 * we'll install in the tmpdir. Naming mirrors the conventions of the real
 * anchored files (suffix `.regression.test.ts` for the p0–p3 set, plain
 * `.test.ts(x)` for sync/storage/signaling).
 */
const BASELINE_ANCHORS = Object.freeze([
  {
    id: "security-tier-4-p-regression-suite",
    glob: "src/tests/security/p[0-9]-*.regression.test.ts",
  },
  { id: "p0-ice-whitelist", glob: "src/tests/security/p0-ice-whitelist*.regression.test.*" },
  { id: "p1-private-sync", glob: "src/tests/security/p1-private-sync*.regression.test.*" },
  { id: "p2-secure-storage-prod-guard", glob: "src/tests/security/p2-secure-storage-prod-guard*.regression.test.*" },
  { id: "p3-verify-password-private", glob: "src/tests/security/p3-verify-password-private*.regression.test.*" },
  { id: "p3-constant-time-hmac", glob: "src/tests/security/p3-constant-time-hmac*.regression.test.*" },
  { id: "p3-sw-integrity-runtime", glob: "src/tests/security/p3-sw-integrity-runtime*.regression.test.*" },
  { id: "p4-sync-transfer-watchdog", glob: "src/tests/services/WebRTCSyncService.test.ts" },
  { id: "p5-sdp-shape-gate", glob: "src/tests/services/WebRTCSyncService.test.ts" },
  { id: "p4-constant-time-cmp", glob: "src/tests/services/WebRTCSyncService.test.ts" },
  { id: "secure-storage-source", glob: "src/services/SecureStorage.ts", kind: "source" },
  { id: "webrtc-sync-source", glob: "src/services/WebRTCSyncService.ts", kind: "source" },
  { id: "database-core-source", glob: "src/db/database.core.ts", kind: "source" },
  { id: "sync-version-comparator", glob: "src/tests/utils/syncVersion.test.*" },
  {
    id: "sync-version-comparator-source",
    glob: "src/utils/syncVersion.ts",
    kind: "source",
  },
  { id: "secure-storage-device-key-lock", glob: "src/tests/services/SecureStorage.device-key-lock.test.*" },
  { id: "signaling-server-bounded-resources", glob: "src/tests/sync/signaling-server.test.*" },
  { id: "disk-backup-pruning-contract", glob: "src/tests/services/DiskBackupService.test.ts" },
  { id: "wrong-password-no-restore", glob: "src/tests/app/AppContent.test.tsx" },
  { id: "manual-export-refreshes-backup-age", glob: "src/tests/components/settings/StorageSection.test.tsx" },
  { id: "p0-vault-kdf-salt", glob: "src/tests/security/p0-vault-kdf-salt*.regression.test.*" },
  { id: "p0-vault-rotation-rollback-drill", glob: "src/tests/security/p0-vault-rotation-rollback-drill*.test.ts" },
  { id: "v5-sunset-exposure-counter", glob: "src/tests/services/security-vault/kdf-salt-exposure*.test.*" },
  { id: "vault-salt-registry-source", glob: "src/services/security-vault/salt-registry.ts", kind: "source" },
]);

const ALL_ANCHORED_FILES = Object.freeze({
  "src/tests/security/p0-ice-whitelist.fake.regression.test.ts": "anchor-a",
  "src/tests/security/p1-private-sync.fake.regression.test.ts": "anchor-b",
  "src/tests/security/p2-secure-storage-prod-guard.fake.regression.test.ts":
    "anchor-c",
  "src/tests/security/p3-verify-password-private.fake.regression.test.ts":
    "anchor-d",
  "src/tests/security/p3-constant-time-hmac.regression.test.ts": "anchor-k",
  "src/tests/security/p3-sw-integrity-runtime.regression.test.ts": "anchor-l",
  "src/services/SecureStorage.ts": "anchor-secure-storage-source",
  "src/services/WebRTCSyncService.ts": "anchor-webrtc-sync-source",
  "src/tests/services/WebRTCSyncService.test.ts": "anchor-webrtc-sync-test",
  "src/db/database.core.ts": "anchor-database-core-source",
  "src/tests/utils/syncVersion.test.ts": "anchor-e",
  "src/utils/syncVersion.ts": "anchor-e-source",
  "src/tests/services/SecureStorage.device-key-lock.test.tsx": "anchor-f",
  "src/tests/sync/signaling-server.test.ts": "anchor-g",
  "src/tests/services/DiskBackupService.test.ts": "anchor-h",
  "src/tests/app/AppContent.test.tsx": "anchor-i",
  "src/tests/components/settings/StorageSection.test.tsx": "anchor-j",
  "src/tests/security/p0-vault-kdf-salt.fake.regression.test.ts": "anchor-m",
  "src/tests/security/p0-vault-rotation-rollback-drill.test.ts": "anchor-n",
  "src/tests/services/security-vault/kdf-salt-exposure.test.ts": "anchor-o",
  "src/services/security-vault/salt-registry.ts": "anchor-p",
});

/** Dynamic import of audit-anchors.mjs with a per-test cache buster. */
async function importAuditScript(cacheBuster) {
  const url = pathToFileURL(AUDIT_SCRIPT).href + `?v=${cacheBuster}`;
  return import(url);
}

let savedCwd;
let createdTmpDirs = [];

beforeEach(() => {
  savedCwd = process.cwd();
  createdTmpDirs = [];
});

afterEach(() => {
  // Always restore cwd first so subsequent tests / module cleanup see
  // the real repo again. Then sweep tmpdirs.
  try {
    process.chdir(savedCwd);
  } catch {
    process.chdir(REPO_ROOT);
  }
  for (const dir of createdTmpDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
});

function newFakeRepo(files = {}) {
  const dir = setupFakeRepo(files);
  process.chdir(dir);
  createdTmpDirs.push(dir);
  return dir;
}

describe("audit-anchors gate — catalog and resolution contracts", () => {
  test("(a) all 24 anchors resolve when targeted files exist", async () => {

    newFakeRepo(ALL_ANCHORED_FILES);
    const { runAuditAnchors } = await importAuditScript("a");

    const result = runAuditAnchors();

    expect(result.failures).toEqual([]);
    expect(result.present).toHaveLength(24);
    expect(result.total).toBe(24);
    // Every present entry has at least one matching file path.
    for (const present of result.present) {
      expect(present.id).toMatch(/^[a-z0-9-]+$/);
      expect(present.matches.length).toBeGreaterThanOrEqual(1);
    }
    // No "advisory NEW" lines when only the catalog is installed. This
    // pins down the contract that the 24-anchor catalog's regression files
    // themselves never get surfaced as discoveries (they are caught by
    // their anchor's glob).
    expect(result.discovered).toEqual([]);
    // Sanity: the regression suffixes resolved for the p0–p3 group, not
    // for syncVersion / SecureStorage / signaling.
    const byId = Object.fromEntries(result.present.map((p) => [p.id, p.matches]));
    expect(byId["p0-ice-whitelist"][0]).toMatch(/\.regression\.test\.ts$/);
    expect(byId["sync-version-comparator"][0]).toMatch(/\/syncVersion\.test\.ts$/);
    expect(byId["secure-storage-source"][0]).toMatch(/\/SecureStorage\.ts$/);
    expect(byId["webrtc-sync-source"][0]).toMatch(/\/WebRTCSyncService\.ts$/);
    expect(byId["database-core-source"][0]).toMatch(/\/database\.core\.ts$/);
    expect(byId["secure-storage-device-key-lock"][0]).toMatch(
      /SecureStorage\.device-key-lock\.test\.tsx$/,
    );
    expect(byId["signaling-server-bounded-resources"][0]).toMatch(
      /\/signaling-server\.test\.ts$/,
    );
  });

  test("(a2) source-kind anchors fail when a critical source file is removed", async () => {
    const files = { ...ALL_ANCHORED_FILES };
    delete files["src/services/WebRTCSyncService.ts"];
    newFakeRepo(files);

    const { runAuditAnchors } = await importAuditScript("a2");
    const result = runAuditAnchors();

    expect(result.failures).toEqual([
      expect.objectContaining({
        id: "webrtc-sync-source",
        glob: "src/services/WebRTCSyncService.ts",
      }),
    ]);
    expect(result.present).toHaveLength(23);
    expect(result.total).toBe(24);
  });

  test("(b) renaming p0-ice-whitelist to .bak produces 1 missing, others 22 intact", async () => {
    // Copy ALL_ANCHORED_FILES, then surgically rename one file from
    // `.regression.test.ts` → `.regression.test.ts.bak`. The glob regex
    // matches the `.bak` file (bare `*` in the suffix), but the
    // `TEST_SUFFIXES` filter rejects anything not ending in
    // `.test.ts` / `.test.tsx` / `.test.mjs`.
    newFakeRepo(ALL_ANCHORED_FILES);
    const renamedPath = join(
      process.cwd(),
      "src/tests/security/p0-ice-whitelist.fake.regression.test.ts",
    );
    rmSync(renamedPath);
    writeFileSync(`${renamedPath}.bak`, "anchor-a-but-renamed");

    const { runAuditAnchors } = await importAuditScript("b");
    const result = runAuditAnchors();

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({ id: "p0-ice-whitelist" });
    expect(result.present).toHaveLength(23);
    expect(result.total).toBe(24);

    // The remaining 21 must be present (id order is stable per ANCHORS[]).
    const presentIds = result.present.map((p) => p.id).sort();
    expect(presentIds).toEqual(
      [
        "security-tier-4-p-regression-suite",
        "p1-private-sync",
        "p2-secure-storage-prod-guard",
        "p3-verify-password-private",
        "p3-constant-time-hmac",
        "p3-sw-integrity-runtime",
        "p4-sync-transfer-watchdog",
        "p5-sdp-shape-gate",
        "p4-constant-time-cmp",
        "secure-storage-source",
        "webrtc-sync-source",
        "database-core-source",
        "secure-storage-device-key-lock",
        "signaling-server-bounded-resources",
        "sync-version-comparator",
        "sync-version-comparator-source",
        "disk-backup-pruning-contract",
        "wrong-password-no-restore",
        "manual-export-refreshes-backup-age",
        "p0-vault-kdf-salt",
        "p0-vault-rotation-rollback-drill",
        "v5-sunset-exposure-counter",
        "vault-salt-registry-source",
      ].sort(),
    );
  });

  test("(c) non-test suffix (.txt) matching the bare regex is rejected by suffix filter", async () => {
    // Drop the .test.ts file and replace it with .test.txt — same name
    // stem, the bare `*.regression.test.*` regex will still match it,
    // and only the `TEST_SUFFIXES` filter keeps the gate honest.
    const files = {
      ...ALL_ANCHORED_FILES,
    };
    delete files["src/tests/security/p0-ice-whitelist.fake.regression.test.ts"];
    files["src/tests/security/p0-ice-whitelist.fake.regression.test.txt"] =
      "anchor-a-but-wrong-suffix";
    newFakeRepo(files);

    const { runAuditAnchors } = await importAuditScript("c");
    const result = runAuditAnchors();

    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].id).toBe("p0-ice-whitelist");
    expect(result.present).toHaveLength(23);
  });

  test("(d) --fix rewrites scripts/audit-anchors-baseline.json with a new updatedAt", async () => {
    // Pre-seed the baseline with a deliberately old `updatedAt`. After
    // `runAuditAnchors({ fix: true })` the file must still exist, the
    // counts must agree with the actual anchor set, and the freshly-
    // written `updatedAt` must differ from the old one.
    const repo = newFakeRepo(ALL_ANCHORED_FILES);
    const baselinePath = join(repo, "scripts", "audit-anchors-baseline.json");
    const ONE_HUNDRED_YEARS_AGO = "1925-08-15T12:00:00.000Z";
    writeFileSync(
      baselinePath,
      JSON.stringify(
        {
          totalAnchors: 99,
          missingCount: 99,
          presentCount: 0,
          updatedAt: ONE_HUNDRED_YEARS_AGO,
          anchors: BASELINE_ANCHORS,
        },
        null,
        2,
      ) + "\n",
    );

    const { runAuditAnchors } = await importAuditScript("d");
    const result = runAuditAnchors({ fix: true });    expect(result.failures).toEqual([]);
    expect(result.present).toHaveLength(24);
    expect(existsSync(baselinePath)).toBe(true);
    const rewritten = JSON.parse(readFileSync(baselinePath, "utf8"));
    expect(rewritten.totalAnchors).toBe(24);
    expect(rewritten.missingCount).toBe(0);
    expect(rewritten.presentCount).toBe(24);
    expect(rewritten.updatedAt).not.toBe(ONE_HUNDRED_YEARS_AGO);

    // updatedAt must parse as a valid ISO string AND be newer than the
    // pre-seeded value (catches a regression where the gate would write
    // a stringified stale timestamp).
    const oldDate = new Date(ONE_HUNDRED_YEARS_AGO);
    const newDate = new Date(rewritten.updatedAt);
    expect(Number.isNaN(oldDate.getTime())).toBe(false);
    expect(Number.isNaN(newDate.getTime())).toBe(false);
    expect(newDate.getTime()).toBeGreaterThan(oldDate.getTime());

    // Catalog shape must round-trip every anchor by id.
    expect(Array.isArray(rewritten.anchors)).toBe(true);
    expect(rewritten.anchors).toHaveLength(24);
    const ids = rewritten.anchors.map((a) => a.id).sort();
    expect(ids).toEqual(
      [
        "security-tier-4-p-regression-suite",
        "p0-ice-whitelist",
        "p1-private-sync",
        "p2-secure-storage-prod-guard",
        "p3-verify-password-private",
        "p3-constant-time-hmac",
        "p3-sw-integrity-runtime",
        "p4-sync-transfer-watchdog",
        "p5-sdp-shape-gate",
        "p4-constant-time-cmp",
        "secure-storage-source",
        "webrtc-sync-source",
        "database-core-source",
        "sync-version-comparator",
        "sync-version-comparator-source",
        "secure-storage-device-key-lock",
        "signaling-server-bounded-resources",
        "disk-backup-pruning-contract",
        "wrong-password-no-restore",
        "manual-export-refreshes-backup-age",
        "p0-vault-kdf-salt",
        "p0-vault-rotation-rollback-drill",
        "v5-sunset-exposure-counter",
        "vault-salt-registry-source",
      ].sort(),
    );
  });

  test("(e) extra canonical-shape regression test is surfaced as `discovered` (advisory, non-failing)", async () => {
    // Install all 19 non-umbrella anchored files plus a canonical p5 file.
    // Run against the pre-umbrella catalog to preserve the advisory
    // discovery contract; the production catalog now intentionally covers
    // this shape.
    newFakeRepo({
      ...ALL_ANCHORED_FILES,
      "src/tests/security/p5-future.fake.regression.test.ts": "anchor-h",
    });

    const { runAuditAnchors } = await importAuditScript("e");
    const legacyCatalog = BASELINE_ANCHORS.filter(
      (anchor) => anchor.id !== "security-tier-4-p-regression-suite",
    );
    const result = runAuditAnchors({ anchors: legacyCatalog });

    // The legacy catalog tier is unchanged — same 23 of 23, no failures.
    expect(result.failures).toEqual([]);
    expect(result.present).toHaveLength(23);
    expect(result.total).toBe(23);

    // The extra file shows up exactly once, with its full path, and
    // does NOT shadow any anchor (the 14 anchored files are filtered out
    // by the anchoredPaths Set before the regex sweep).
    expect(result.discovered).toEqual([
      "src/tests/security/p5-future.fake.regression.test.ts",
    ]);

    // And critically — `runAuditAnchors` returning success here means
    // `main()` will not exit non-zero, even though a discovery is
    // present. Sanity-check the structural property that powers that:
    // discovered never contributes to `failures`.
    for (const d of result.discovered) {
      expect(result.failures.some((f) => f.id === d)).toBe(false);
    }
  });

  test("(h) strict discovery promotes an advisory discovery to a hard failure", async () => {
    newFakeRepo({
      ...ALL_ANCHORED_FILES,
      "src/tests/security/p5-strict.fake.regression.test.ts": "anchor-strict",
    });

    const { runAuditAnchors, strictDiscoveryRequested } = await importAuditScript("h");
    expect(strictDiscoveryRequested(["--strict-discovery"])).toBe(true);
    expect(strictDiscoveryRequested(["--strict"])).toBe(true);
    expect(strictDiscoveryRequested([])).toBe(false);
    const legacyCatalog = BASELINE_ANCHORS.filter(
      (anchor) => anchor.id !== "security-tier-4-p-regression-suite",
    );
    const result = runAuditAnchors({
      anchors: legacyCatalog,
      strictDiscovery: true,
    });

    expect(result.discovered).toEqual([
      "src/tests/security/p5-strict.fake.regression.test.ts",
    ]);
    expect(result.failures).toEqual([
      expect.objectContaining({
        type: "strict-discovery",
        description: expect.stringContaining("1 canonical regression file"),
        matches: result.discovered,
      }),
    ]);
  });

  test("(f) anchor in ANCHORS[] missing from baseline fails as catalog inflation", async () => {
    const repo = newFakeRepo(ALL_ANCHORED_FILES);
    const baselinePath = join(repo, "scripts", "audit-anchors-baseline.json");
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
    baseline.anchors = baseline.anchors.filter(
      (anchor) => anchor.id !== "p3-verify-password-private",
    );
    baseline.totalAnchors = baseline.anchors.length;
    writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + "\n");

    const { runAuditAnchors } = await importAuditScript("f");
    const result = runAuditAnchors();

    expect(result.catalogInflation).toEqual([
      expect.objectContaining({
        id: "p3-verify-password-private",
        glob: "src/tests/security/p3-verify-password-private*.regression.test.*",
      }),
    ]);
    expect(result.failures).toEqual([
      expect.objectContaining({
        type: "catalog-inflation",
        id: "p3-verify-password-private",
      }),
    ]);
    expect(result.present).toHaveLength(24);
  });

  test("(i) every source-kind anchor resolves against the actual repository", async () => {
    // This is intentionally the only test that does not install a fake
    // repository. It exercises the same gate-time cwd and source index that
    // `npm run check:audit-drift` uses, so a deleted source file fails here
    // immediately rather than being hidden by the synthetic fixtures above.
    process.chdir(REPO_ROOT);
    const { ANCHORS, runAuditAnchors } = await importAuditScript("i");
    const sourceAnchors = ANCHORS.filter(
      (anchor) => anchor.kind === "source",
    );
    expect(sourceAnchors.length).toBeGreaterThan(0);

    const result = runAuditAnchors();
    const sourceIds = new Set(sourceAnchors.map((anchor) => anchor.id));
    const sourceFailures = result.failures.filter((failure) =>
      sourceIds.has(failure.id),
    );

    expect(sourceFailures).toEqual([]);
    for (const anchor of sourceAnchors) {
      const resolved = result.present.find((entry) => entry.id === anchor.id);
      expect(resolved, `${anchor.id} did not resolve at gate time`).toBeDefined();
      // In an Open Core export tree a source anchor whose subject is a
      // proprietary module resolves as an explicit Pro-boundary skip (zero
      // matches); anywhere else it must have resolved to real files.
      const isExportTree = (() => {
        try {
          return JSON.parse(readFileSync(join(REPO_ROOT, "manifest.json"), "utf8")).model === "open-core";
        } catch {
          return false;
        }
      })();
      if (isExportTree && resolved.proBoundarySkip) {
        expect(resolved.matches).toEqual([]);
        continue;
      }
      expect(resolved.matches.length).toBeGreaterThan(0);
      expect(resolved.matches).toContain(anchor.glob);
    }
  });

  test("(g) non-conformant ':' glob in the catalog is reported as malformed", async () => {
    newFakeRepo(ALL_ANCHORED_FILES);
    const { runAuditAnchors } = await importAuditScript("g");
    const malformedCatalog = [
      ...BASELINE_ANCHORS,
      {
        id: "p5-malformed",
        glob: "src/tests/security:p5-malformed.regression.test.ts",
      },
    ];

    const result = runAuditAnchors({ anchors: malformedCatalog });

    expect(result.catalogErrors).toEqual([
      expect.objectContaining({
        id: "p5-malformed",
        glob: "src/tests/security:p5-malformed.regression.test.ts",
        reason: expect.stringContaining("must be a relative POSIX path"),
      }),
    ]);
    expect(result.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "malformed-catalog",
          id: "p5-malformed",
        }),
      ]),
    );
    expect(result.present).toHaveLength(24);
    expect(result.total).toBe(25);
  });
});
