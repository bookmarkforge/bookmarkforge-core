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
    ? [["html", { outputFolder: "playwright-report-multiuser", open: "never" }], ["line"]]
    : "list",
});
