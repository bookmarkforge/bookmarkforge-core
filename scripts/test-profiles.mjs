// Shared fast/slow test-profile definitions for the bounded runner
// (scripts/test-bounded.mjs) and its curated wrapper (scripts/test-fast.mjs).
//
//   fast — smoke + critical areas (security, db, core services, key
//          components) + the quality-gate script tests. ~2 min on this
//          checkout (2026-09-17: 144 files); a NEW file at/over
//          FAST_THRESHOLD_MS fails enforcement.
//   slow — every test file that is not in the fast profile (the complement).
//          CI runs it (the slow-tests job) and enforces timing with the more
//          forgiving SLOW_THRESHOLD_MS: this is a long tail of legitimately
//          heavier suites, and a 5 s bar would flake on machine noise.
//
// The fast list is deliberately NOT filtered for existence: a stale selector
// silently shrinks the profile (ADR-038 found the MutationGuard .tsx selector
// had dropped its 12 tests for months because the spelling drifted). The
// runner fails loudly via scripts/__tests__/test-profiles.test.mjs instead.
import { readdirSync } from "node:fs";
import { join } from "node:path";

export const FAST_THRESHOLD_MS = 5000;
export const SLOW_THRESHOLD_MS = 10000;

const ROOT = process.cwd();
const rel = (path) => `src/tests/${path}`;

// p0-p3 security regressions are globbed so new tiers are picked up
// automatically; everything else is pinned explicitly for determinism.
const securityRegressions = readdirSync(join(ROOT, "src/tests/security"))
  .filter((file) => /^p\d-.*\.regression\.test\.ts$/.test(file))
  .map((file) => rel(`security/${file}`));

// Quality-gate script tests (scripts/__tests__) run on EVERY PR via the fast
// profile — CI's first job must see gate drift, not the slow job hours later.
// Files whose PINNED time in scripts/test-timing-baseline.json exceeds the
// fast bar (5 s) stay slow-only via SLOW_GATE_TESTS: the timing guard would
// fail the fast profile on them otherwise. A NEW gate test lands in fast
// automatically (they are sub-second); if one ever grows past the bar, CI
// names it and it moves into SLOW_GATE_TESTS — a deliberate, reviewed act.
export const SLOW_GATE_TESTS = new Set([
  "build-ci-secret-scan.test.mjs", // pinned 33.7 s
  "monitoring-alerts.test.mjs", // pinned 9.4 s
]);
const gateTestFiles = readdirSync(join(ROOT, "scripts/__tests__"))
  .filter((file) => /^.+\.test\.mjs$/.test(file))
  .filter((file) => !SLOW_GATE_TESTS.has(file))
  .map((file) => `scripts/__tests__/${file}`);

export const FAST_SELECTORS = [
  // --- smoke: key shell/UX components ---
  rel("components/Omnibar.test.tsx"),
  rel("components/Sidebar.test.tsx"),
  rel("components/QuickCapture.test.tsx"),
  rel("components/sync/SyncStatus.test.tsx"),
  // --- db layer (RxDB, schema, IndexedDB, encryption) ---
  rel("db"),
  rel("env.config.test.ts"),
  rel("security-integration.test.ts"),
  // --- crypto / zeroization / random / sanitization ---
  rel("utils/crypto-core.test.ts"),
  rel("utils/crypto-core.fuzz.test.ts"),
  rel("utils/argon2-kdf.test.ts"),
  rel("utils/argon2-kdf-params.test.ts"),
  rel("utils/argon2-kdf-load-error.test.ts"),
  rel("utils/secureRandom.test.ts"),
  rel("utils/wasm-zero-memory.test.ts"),
  rel("utils/wasm-core.test.ts"),
  rel("utils/sanitization.test.ts"),
  rel("utils/devtoolsProtection.test.ts"),
  rel("utils/indexedDB.test.ts"),
  // --- vault & secure storage ---
  rel("services/SecurityVault.test.ts"),
  rel("services/SecureStorage.test.ts"),
  rel("services/SecureStorage.close-race.test.ts"),
  rel("services/SecureStorage.device-key-lock.test.ts"),
  rel("services/SecureStorage.error-paths.test.ts"),
  rel("services/EncryptionService.test.ts"),
  // --- core services ---
  rel("services/BackupService.test.ts"),
  rel("services/BackupRestore.test.ts"),
  rel("services/SyncService.test.ts"),
  rel("services/SettingsService.test.ts"),
  rel("services/LicenseService.test.ts"),
  rel("services/licenseSigning.test.ts"),
  rel("services/NuclearForgetService.test.ts"),
  rel("services/RecoveryService.test.ts"),
  rel("services/RateLimitService.test.ts"),
  rel("services/SanitizationService.test.ts"),
  rel("services/AuditLogService.test.ts"),
  rel("services/GarbageCollectionService.test.ts"),
  rel("services/verifyBridgeMessage.test.ts"),
  // --- remaining regression-anchor catalog (ADR-032/033/034) ---
  rel("services/DiskBackupService.test.ts"),
  rel("app/AppContent.test.tsx"),
  rel("components/settings/StorageSection.test.tsx"),
  // --- security regressions + firewall ---
  ...securityRegressions,
  // --- quality-gate script tests (gate drift fails the FIRST CI job) ---
  ...gateTestFiles,
  rel("security/real-crypto.integration.test.ts"),
  rel("security/networkFirewall.test.ts"),
  rel("security/rxdb-cache.test.ts"),
  // NOTE: these two must keep their real extensions — a stale selector
  // silently drops tests from the profile (ADR-038). They are asserted in
  // scripts/__tests__/test-profiles.test.mjs.
  rel("security/MutationGuard.test.tsx"),
  rel("security/AttestationChain.test.tsx"),
  rel("security/inputFuzzing.test.tsx"),
];

// Test files the runner's file collector finds but vitest deliberately
// excludes (keep in sync with the `test.exclude` block in
// vitest.config.ts). They are gated by dedicated tooling
// (scripts/check-rxdb17.mjs) or the fuzz harness, so profiles must never
// schedule them: a scheduled-but-excluded file is counted as "passed"
// without ever running.
export const VITEST_EXCLUDED_FILES = new Set([
  "src/tests/scripts/check-rxdb17.test.ts",
  "src/tests/utils/crypto-core.fuzz.test.ts",
]);

// Per-profile knobs applied by the bounded runner when --profile is given
// (env overrides win). Batch sizes come from the 2026-09-04 measurement
// matrix: batch 28 for the fast profile (72 s at 2 workers back then;
// 125 s at 144 files after the gate-test tier joined in 2026-09-17),
// batch 40 for the full suite (482 s -> 312 s at 3 workers).
export const PROFILE_DEFAULTS = {
  fast: { thresholdMs: FAST_THRESHOLD_MS, batchSize: 28 },
  slow: { thresholdMs: SLOW_THRESHOLD_MS, batchSize: 40 },
};