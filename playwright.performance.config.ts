import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT ?? 4173);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "performance-budget.spec.ts",
  timeout: 60_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  // One retry: the floor judges sub-second timings on a shared CI runner,
  // where a single cold sample can sit above the regression floor. The hard
  // budget (2500 ms, scripts/performance-budget.json) must still fail on
  // every attempt.
  retries: 1,
  reporter: "line",
  outputDir: "test-results-performance",
  use: {
    baseURL,
    ...devices["Desktop Chrome"],
    contextOptions: { serviceWorkers: "block" },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: `npm run preview -- --host 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
