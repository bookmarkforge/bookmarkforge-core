import baseConfig from "./playwright.config";
import { defineConfig } from "@playwright/test";

export default defineConfig(baseConfig, {
  timeout: 120_000,
  expect: { timeout: 30_000 },
  workers: process.env.CI ? 2 : undefined,
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
