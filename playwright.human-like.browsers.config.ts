/**
 * Playwright config for cross-engine validation of the human-like example
 * suite (firefox + webkit, alongside chromium). Inherits everything from the
 * human-like config (testDir, 120 s timeout, dev-server, storageState) and
 * only replaces the project list: the human-like config inherits the base's
 * two projects (chromium + the mobile-only Pixel 7 project), which do not
 * include firefox/webkit. Same shape as playwright.browsers.config.ts.
 */
import baseConfig from "./playwright.human-like.config";
import { defineConfig, devices } from "@playwright/test";

export default defineConfig(baseConfig, {
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
