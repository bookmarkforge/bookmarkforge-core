// Fast local test profile: smoke + critical areas only. Curates the security
// layer (vault, crypto, p0-p3 regressions), the database layer, core services
// and a handful of key components, then delegates to the bounded runner so it
// keeps the same batching, per-process memory bound and time-budget guard as
// `npm test`. Intended for local dev loops — it must stay well under a couple
// of minutes.
//
// `--watch` runs the same profile through vitest's native watch mode (single
// process, no batching): vitest walks its module graph and re-runs only the
// critical-area tests affected by the file you save.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

const ROOT = process.cwd();
const WATCH = process.argv.slice(2).includes("--watch");
const toPosix = (path) => path.replace(/\\/g, "/");
const rel = (path) => toPosix(join("src/tests", path));
const has = (path) => existsSync(join(ROOT, path));

// p0-p3 security regressions are globbed so new tiers are picked up
// automatically; everything else is pinned explicitly for determinism.
const securityRegressions = readdirSync(join(ROOT, "src/tests/security"))
  .filter((file) => /^p\d-.*\.regression\.test\.ts$/.test(file))
  .map((file) => rel(`security/${file}`));

const selectors = [
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
  rel("security/real-crypto.integration.test.ts"),
  rel("security/networkFirewall.test.ts"),
  rel("security/networkFirewall-proxy.test.ts"),
  rel("security/rxdb-cache.test.ts"),
  // NOTE: these two must keep their real extensions — the `.filter(has)`
  // below silently drops a stale selector (the `.ts` spelling of the
  // `.tsx` MutationGuard file did exactly that: its 12 tests never ran
  // in this profile; found by the 2026-09-02 audit, ADR-038).
  rel("security/MutationGuard.test.tsx"),
  rel("security/AttestationChain.test.tsx"),
  rel("security/inputFuzzing.test.tsx"),
].filter(has);

const env = {
  ...process.env,
  // Keep the vitest transform cache isolated from `vite build` cleanup in
  // both modes (see the cacheDir note in vitest.config.ts).
  BMF_TEST_CACHE_DIR:
    process.env.BMF_TEST_CACHE_DIR ?? "node_modules/.vite-test-bounded",
};

const child = WATCH
  ? spawn(
      process.execPath,
      [
        join(ROOT, "node_modules", "vitest", "vitest.mjs"),
        ...selectors,
        "--watch",
      ],
      { cwd: ROOT, env, stdio: "inherit" },
    )
  :  // The profile is ~60 files: with the runner's default batch size (80) it
    // would run as ONE batch on a single child, leaving the second worker
    // idle. Default to a smaller batch so the two concurrent children split
    // the work; respect an explicit BMF_TEST_BATCH_SIZE override.
    spawn(
      process.execPath,
      ["scripts/test-bounded.mjs", ...selectors],
      {
        cwd: ROOT,
        env: { ...env, BMF_TEST_BATCH_SIZE: process.env.BMF_TEST_BATCH_SIZE ?? "28" },
        stdio: "inherit",
      },
    );
child.once("error", (error) => {
  console.error(
    `[test-fast] failed to start ${WATCH ? "vitest watch" : "the bounded runner"}:`,
    error,
  );
  process.exit(1);
});
child.once("exit", (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
