import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

// Private-infra webServers exist only in the full checkout: the public Core
// export ships neither server/ nor api/license/, so those entries compile to
// empty arrays there instead of failing Playwright's webServer health check.
const hasCompanionServer = existsSync("server/src/index.ts");
const hasLicenseStack = existsSync("api/license/[action].ts");

const port = Number(process.env.PLAYWRIGHT_PORT ?? 4173);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;
const companionPort = Number(process.env.CRISIS_COMPANION_PORT ?? 8799);
const signalingPort = Number(process.env.SIGNALING_PORT ?? 8787);
// Ephemeral Whop-compatible license adapter (scripts/license-mock.mjs), same
// pattern scripts/drill-rollback.mjs uses: it is the upstream a license
// handler calls to mint a REAL signed payload with the gitignored dev key.
// The handler is api/license/[action].ts — the companion stopped serving
// /api/license on 2026-10-19 (server/src/route-table.ts), so nothing in this
// stack answers those paths today and Pro-gated specs (backup/restore) cannot
// seed until a dev-only adapter mounts that handler.
const licenseMockPort = Number(process.env.LICENSE_MOCK_PORT ?? 8082);
// Dev-only adapter serving the real api/license/[action].ts handler; the
// E2E proxy sends /api/license here (the companion stopped serving it).
const licenseProxyPort = Number(process.env.LICENSE_PROXY_PORT ?? 8788);

export default defineConfig({
  testDir: "./tests/e2e",
  // *.nightly.spec.ts is nightly-scope by filename contract (see
  // perf-scale.nightly.spec.ts header): the default/CI e2e job must not pay
  // for 10k-seed benchmarks. CI additionally filters by @nightly/@multiuser/
  // @visual/@performance tags, but tags live in test titles — the filename
  // ignore is the mechanism that actually covers untagged nightly specs.
  // playwright.nightly.config.ts overrides this with [] to re-include them.
  testIgnore: /.*\.nightly\.spec\.ts$/,
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
    ...(hasCompanionServer
      ? [
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
              SIGNALING_ADMIN_TOKEN: process.env.SIGNALING_ADMIN_TOKEN ?? "e2e-admin-token",
            },
          },
        ]
      : []),
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
        // vite.config.ts proxies /api/license to the dev adapter below, which
        // serves the real api/license/[action].ts handler. The companion does
        // not serve license routes (retired 2026-10-19). Absent from the
        // public Core export, where the whole license stack is private.
        ...(hasLicenseStack
          ? {
              VITE_LICENSE_PROXY_TARGET: `http://127.0.0.1:${licenseProxyPort}`,
            }
          : {}),
      },
    },
    ...(hasLicenseStack
      ? [
          {
            // Dev-only adapter for the serverless license handler. The companion
            // stopped serving /api/license on 2026-10-19 and re-mounting the routes
            // there would reopen a paid surface without an enforcement point
            // (server/src/route-table.ts), so api/license/[action].ts runs here on
            // its own loopback port and VITE_LICENSE_PROXY_TARGET points at it.
            command: "npx tsx scripts/dev-license-server.ts",
            url: `http://127.0.0.1:${licenseProxyPort}/__health`,
            reuseExistingServer: !process.env.CI,
            timeout: 60_000,
            env: {
              NODE_ENV: "test",
              LICENSE_DEV_HOST: "127.0.0.1",
              LICENSE_DEV_PORT: String(licenseProxyPort),
              WHOP_LICENSE_API_URL: `http://127.0.0.1:${licenseMockPort}/license`,
              WHOP_API_KEY: "e2e-license-key",
              // The mock speaks plain HTTP on loopback; the signing service is
              // HTTPS-only unless this explicit non-production opt-out is set.
              LICENSE_PROVIDER_ALLOW_HTTP: "1",
            },
          },
          {
            command: "node scripts/license-mock.mjs",
            url: `http://127.0.0.1:${licenseMockPort}/health`,
            reuseExistingServer: !process.env.CI,
            timeout: 30_000,
            env: {
              LICENSE_MOCK_PORT: String(licenseMockPort),
              // Must match the license adapter's WHOP_API_KEY above: the mock
              // authenticates the adapter's bearer token.
              LICENSE_MOCK_KEY: "e2e-license-key",
            },
          },
        ]
      : []),
  ],
});
