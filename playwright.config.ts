import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT ?? 4173);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;
const companionPort = Number(process.env.CRISIS_COMPANION_PORT ?? 8799);
const signalingPort = Number(process.env.SIGNALING_PORT ?? 8787);
// Ephemeral Whop-compatible license adapter (scripts/license-mock.mjs), same
// pattern scripts/drill-rollback.mjs uses: the companion's WHOP adapter points
// at it, so /api/license/activate issues REAL signed license payloads with the
// gitignored dev key. Pro-gated E2E specs (backup/restore) seed their
// entitlement through this stack via tests/e2e/pro-entitlement-helpers.ts.
const licenseMockPort = Number(process.env.LICENSE_MOCK_PORT ?? 8082);

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [["html", { outputFolder: "playwright-report", open: "never" }], ["line"]]
    : "list",
  outputDir: "test-results",
  use: {
    baseURL,
    contextOptions: { serviceWorkers: "block" },
    // Seed an accepted consent decision so the bottom-anchored GDPR banner
    // (ConsentBanner) never covers the UI or intercepts pointer events during
    // E2E. Banner behavior itself is unit-tested in vitest; the e2e suite
    // exercises the app, not the first-run consent prompt.
    storageState: {
      cookies: [],
      origins: [
        {
          origin: baseURL,
          localStorage: [
            { name: "forge_consent_decision_made", value: "true" },
            { name: "forge_consent_analytics", value: "true" },
            { name: "forge_consent_error_reporting", value: "true" },
            { name: "forge_consent_client_events", value: "true" },
            { name: "bmf_local_error_storage", value: "true" },
          ],
        },
      ],
    },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    testIdAttribute: "data-testid",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    {
      // dashboard-banner-cls (ADR-055) measures the banner-collapse trade-off
      // on a phone-shaped viewport too: 390x844 with touch + mobile Chrome
      // emulation (Pixel 7 device base — same engine/family as the mobile
      // smoke battery in playwright.mobile.config.ts). testMatch narrows this
      // project to that one spec so `npm run e2e` keeps every other spec
      // running exactly once, on the desktop project.
      name: "mobile",
      testMatch: /dashboard-banner-cls\.spec\.ts$/,
      use: {
        ...devices["Pixel 7"],
        viewport: { width: 390, height: 844 },
      },
    },
  ],
  webServer: [
    {
      command: `npm run server`,
      url: `http://127.0.0.1:${signalingPort}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        NODE_ENV: "test",
        HOST: "127.0.0.1",
        PORT: String(signalingPort),
        TRUST_PROXY: "0",
        // Real ephemeral Whop adapter (dead-port in earlier stacks made every
        // Pro activation fail, so Pro-gated specs could never run).
        WHOP_LICENSE_API_URL: `http://127.0.0.1:${licenseMockPort}/license`,
        WHOP_API_KEY: "e2e-license-key",
        // The mock speaks plain HTTP on loopback; the signing service is
        // HTTPS-only unless this explicit non-production opt-out is set.
        LICENSE_PROVIDER_ALLOW_HTTP: "1",
        SIGNALING_ADMIN_TOKEN: process.env.SIGNALING_ADMIN_TOKEN ?? "e2e-admin-token",
      },
    },
    {
      // --mode test: enables the fast Argon2id test parameters (8 MiB, t=1)
      // via env.mode === "test". Without it Vite runs in development mode and
      // the E2E vault setup does the full 128 MiB desktop KDF (~28 s on slow
      // machines), blowing the 30 s setupVault budget and the 60 s test
      // timeout. Production builds keep the strong parameters via isProdBuild().
      command: `npm run dev -- --host 127.0.0.1 --port ${port} --mode test`,
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        NODE_ENV: "test",
        VITE_TEST_BUILD: "true",
        VITE_FORCE_DEXIE_STORAGE: "true",
        VITE_P2P_SIGNALING_URL: `ws://127.0.0.1:${signalingPort}`,
        CRISIS_COMPANION_PORT: String(companionPort),
        SIGNALING_ADMIN_TOKEN: process.env.SIGNALING_ADMIN_TOKEN ?? "e2e-admin-token",
        // vite.config.ts proxies /api/license to the REAL companion/signing
        // server (8787) instead of the crisis companion that owns /api.
        VITE_LICENSE_PROXY_TARGET: `http://127.0.0.1:${signalingPort}`,
      },
    },
    {
      command: "node scripts/license-mock.mjs",
      url: `http://127.0.0.1:${licenseMockPort}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: {
        LICENSE_MOCK_PORT: String(licenseMockPort),
        // Must match the companion's WHOP_API_KEY above: the adapter
        // authenticates the companion's bearer token.
        LICENSE_MOCK_KEY: "e2e-license-key",
      },
    },
  ],
});
