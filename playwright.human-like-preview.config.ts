/**
 * Human-like suite against the PRODUCTION build (`vite preview`).
 *
 * Same testDir/timeouts as playwright.human-like.config.ts, but the app
 * server is `vite preview` serving dist/ — so the Workbox service worker,
 * precache and integrity runtime are the real artifacts under test.
 * Companion/license mock servers are kept from the base config.
 */
import baseConfig from "./playwright.config";
import { defineConfig, type PlaywrightTestConfig } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT ?? 4173);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;
type WebServerEntry = Exclude<
  NonNullable<PlaywrightTestConfig["webServer"]>,
  readonly unknown[]
>;
const baseServers: WebServerEntry[] = Array.isArray(baseConfig.webServer)
  ? baseConfig.webServer
  : baseConfig.webServer
    ? [baseConfig.webServer]
    : [];

export default defineConfig({
  ...baseConfig,
  testDir: "./src/tests/human-like/examples",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  workers: 1,
  retries: 0,
  reporter: "line",
  outputDir: "test-results-human-like-preview",
  use: { ...baseConfig.use, baseURL },
  webServer: [
    ...baseServers.filter((server) => server.url !== baseURL),
    {
      command: `npm run preview -- --host 127.0.0.1 --port ${port}`,
      url: `${baseURL}/app`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
