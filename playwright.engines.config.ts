import baseConfig from "./playwright.config";
import { defineConfig, devices } from "@playwright/test";

/**
 * Cross-engine profile for the launch-day critical paths — the second and
 * third browser engines the product must not break on (Safari/WebKit drives
 * iOS and macOS, Firefox is the remaining desktop engine; CI covers Chromium
 * everywhere already).
 *
 *   npm run e2e:engines            # firefox + webkit, test-mode dev server
 *   npm run e2e:engines -- --project=webkit   # just Safari's engine
 *
 * Reuses the launch-smoke topology EXACTLY (companion + license mock + test
 * dev server, spread webServer — see playwright.launch-smoke.config.ts for
 * why the spread is mandatory) and runs the same spec:
 * tests/e2e/launch-smoke-critical-paths.spec.ts. The license activation
 * describe-block skips with a marker when no signing key is available, so
 * the battery is meaningful on CI runners too.
 *
 * Scoping: testMatch pins the launch-smoke spec only — the full 40+ spec
 * surface is out of scope here (it has its own profiles); the point of this
 * profile is the reputational paths, per engine.
 *
 * Local prerequisites (mirroring the base config's assumptions):
 *   npx playwright install firefox webkit
 *
 * Linux/WebKit note: WebKit on Linux needs extra system dependencies —
 * `npx playwright install-deps webkit` (Ubuntu: libwoff, gstreamer, etc.).
 */
const port = Number(process.env.PLAYWRIGHT_PORT ?? 4173);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;
const licenseMockPort = Number(process.env.LICENSE_MOCK_PORT ?? 8082);
const signalingPort = Number(process.env.SIGNALING_PORT ?? 8787);
const LICENSE_MOCK_KEY = process.env.LICENSE_MOCK_KEY ?? "license-mock-key";

export default defineConfig({
  ...baseConfig,
  // Spread, not merge — defineConfig(baseConfig, overrides) CONCATENATES
  // webServer arrays and the base's dev server (proxy → crisis 8799) would
  // boot first and be reused, running every test against a dead proxy target.
  testMatch: ["tests/e2e/launch-smoke-critical-paths.spec.ts"],
  timeout: 300_000,
  expect: { timeout: 30_000 },
  // WebKit is the slowest engine and the KDF-heavy flows dominate the
  // runtime; serial per engine, engines via `workers` config below.
  fullyParallel: false,
  workers: 1,
  // Engines can be flaky on first-class UI flows (font/scroll differences);
  // one retry so a genuine cross-engine regression is distinguishable from a
  // cosmetic race. The release-day chromium battery keeps retries: 0.
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["line"]] : "list",
  use: { ...baseConfig.use, baseURL },
  projects: [
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: [
    {
      ...baseConfig.webServer[0],
      env: {
        ...baseConfig.webServer[0].env,
        WHOP_LICENSE_API_URL: `http://127.0.0.1:${licenseMockPort}/license`,
        WHOP_API_KEY: LICENSE_MOCK_KEY,
        LICENSE_PROVIDER_ALLOW_HTTP: "1",
        HOST: "127.0.0.1",
        PORT: String(signalingPort),
      },
    },
    {
      command: "node scripts/license-mock.mjs",
      url: `http://127.0.0.1:${licenseMockPort}/health`,
      // Always-fresh mock — same rationale as the launch-smoke profile.
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        LICENSE_MOCK_PORT: String(licenseMockPort),
        LICENSE_MOCK_KEY,
      },
    },
    {
      command: `npm run dev -- --host 127.0.0.1 --port ${port} --mode test`,
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        NODE_ENV: "test",
        VITE_TEST_BUILD: "true",
        VITE_FORCE_DEXIE_STORAGE: "true",
        VITE_P2P_SIGNALING_URL: `ws://127.0.0.1:${signalingPort}`,
        VITE_API_PROXY_TARGET: `http://127.0.0.1:${signalingPort}`,
        SIGNALING_ADMIN_TOKEN:
          process.env.SIGNALING_ADMIN_TOKEN ?? "e2e-admin-token",
      },
    },
  ],
});
