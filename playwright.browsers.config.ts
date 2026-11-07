import baseConfig from "./playwright.config";
import { defineConfig, devices } from "@playwright/test";

// Spread, not `defineConfig(baseConfig, …)`: that form merges `projects`
// BY NAME and keeps base-only entries, so this profile's three-engine list
// still carried the base `mobile` project.
export default defineConfig({
  ...baseConfig,
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
