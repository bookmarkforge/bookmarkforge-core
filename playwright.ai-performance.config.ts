import { devices, type PlaywrightTestConfig } from "@playwright/test";
import baseConfig from "./playwright.config";

const config: PlaywrightTestConfig = {
  ...baseConfig,
  testMatch: "ai-first-boot.spec.ts",
  timeout: 180_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "line",
  outputDir: "test-results-ai-performance",
  projects: [
    {
      name: "mobile-ai-performance",
      testMatch: "ai-first-boot.spec.ts",
      use: {
        ...devices["Pixel 7"],
        viewport: { width: 390, height: 844 },
        serviceWorkers: "block",
      },
    },
  ],
};

export default config;
