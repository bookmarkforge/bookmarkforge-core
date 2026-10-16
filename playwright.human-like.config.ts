/**
 * Playwright config for the human-like E2E example suite.
 *
 * Inherits the base config (dev-server, signaling-server, storageState)
 * and overrides:
 *  - testDir  → src/tests/human-like/examples
 *  - timeout  → 90 s per test (human-like flows are slower)
 *  - workers  → 2 (heavier than the core suite)
 *  - reporter → separate output folder so reports don't collide
 */
import baseConfig from "./playwright.config";
import { defineConfig } from "@playwright/test";

export default defineConfig(baseConfig, {
  testDir: "./src/tests/human-like/examples",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? process.env.HUMAN_LIKE_BLOB_REPORT
      // CI split-run mode: two shard jobs each write a blob report into a
      // per-shard folder; the nightly merge job consumes these with
      // `playwright merge-reports` to produce one unified HTML report.
      ? [["blob", { outputDir: `playwright-report-human-like-${process.env.HUMAN_LIKE_SHARD ?? "1"}`, open: "never" }]]
      : [["html", { outputFolder: "playwright-report-human-like", open: "never" }], ["line"]]
    : "list",
  outputDir: "test-results-human-like",
  // Let Playwright manage webServers (base config reuseExistingServer logic).
  // The watch exclusion in vite.config.ts prevents EBUSY on Windows.
});
