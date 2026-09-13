import baseConfig from "./playwright.config";
import { defineConfig } from "@playwright/test";

// Smoke profile — critical vault path only, local push-gate, budget < 60 s
// (measured 2026-09-04: 57 s wall with warm servers; the full `npm run e2e`
// suite is ~60+ specs and unsuitable for a pre-push loop). Selection is by
// testMatch over explicit files so a new vault-*.spec.ts never silently
// joins the budget.
//
// Included, one test each, the shortest specs that cover the three pillars:
//   vault-init            first setup -> vault created and unlocked
//   vault-lock-button     lock -> unlock with the password
//   vault-wrong-password  wrong password -> vault stays locked (fail-closed)
//
// Excluded on cost, measured in isolation on warm servers:
//   vault-idb-persistence 51 s, vault-sidebar-toggle 80 s,
//   vault-auto-lock / vault-backup-flow / vault-corruption-recovery:
//   real-timeout / heavy flows, multi-minute, several fail on a busy box.
// Their logic is covered by the vitest fast profile and the full e2e run.
//
// `--mode test` (inherited webServer) keeps Argon2id on fast test params
// (8 MiB, t=1); a dev server without it spends ~28 s per vault setup.
// reuseExistingServer stays true from the base config: this profile is a
// local loop; nightly/CI run the full configs instead.
export default defineConfig(baseConfig, {
  testMatch: [
    "tests/e2e/vault-init.spec.ts",
    "tests/e2e/vault-lock-button.spec.ts",
    "tests/e2e/vault-wrong-password.spec.ts",
  ],
  fullyParallel: true,
  retries: 0,
  reporter: "line",
});
