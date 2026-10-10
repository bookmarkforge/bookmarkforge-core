import baseConfig from "./playwright.config";
import { defineConfig } from "@playwright/test";

export default defineConfig(baseConfig, {
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  use: {
    ...baseConfig.use,
    contextOptions: { serviceWorkers: "block" },
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  reporter: process.env.CI
    ? process.env.MULTIUSER_BLOB_REPORT
      // CI split-run mode: each shard job writes a blob report into a
      // per-shard folder; the nightly merge job consumes these with
      // `playwright merge-reports` to produce one unified HTML report.
      ? [["blob", { outputDir: `playwright-report-multiuser-${process.env.MULTIUSER_SHARD ?? "1"}`, open: "never" }]]
      : [["html", { outputFolder: "playwright-report-multiuser", open: "never" }], ["line"]]
    : "list",
});
