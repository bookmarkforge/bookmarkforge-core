import baseConfig from "./playwright.config";
import { defineConfig } from "@playwright/test";

export default defineConfig(baseConfig, {
  // Nightly includes real 10k-record and model-startup benchmarks. Run
  // serially so IndexedDB, workers, and the shared Vite server do not
  // contend and turn valid per-test budgets into load-induced timeouts.
  timeout: 360_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["html", { outputFolder: "playwright-report-nightly", open: "never" }], ["line"]]
    : "list",
  use: {
    ...baseConfig.use,
    contextOptions: { serviceWorkers: "block" },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
});
