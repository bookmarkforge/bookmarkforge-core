import { defineConfig, devices } from "@playwright/test";

/**
 * playwright.custom-provider.config.ts — isolated topology for the Custom
 * (OpenAI Format) provider E2E (tests/e2e/custom-provider.spec.ts and
 * tests/e2e/custom-provider-flow.spec.ts).
 *
 * The app is driven through its REAL settings UI against the local
 * OpenAI-compatible mock (scripts/mock-openai-server.mjs) — no API keys, no
 * page.route interception of the app's own provider calls. Topology:

 *   8789  OpenAI-compatible mock (SSE streaming; scenario models error-401…)
 *   8787  signaling server (same binary; /api on it stays unused)
 *   8791  companion server (licensing + telemetry)
 *   4274  Vite dev server with VITE_API_PROXY_TARGET → the companion
 *
 * The companion is in the chain because ProviderConfiguration's model fetch
 * goes through /api (Vite proxies /api to the companion, matching production
 * nginx). It never talks to the mock — the mock is called DIRECTLY by the
 * browser (firewalledFetch allows loopback). Provider calls themselves never
 * pass through the companion; providers are called directly by the browser.
 *
 * Why an isolated config (repo convention, cf. the other per-surface configs):
 * the shared config's Vite proxy sends /api to CRISIS_COMPANION_PORT (8799),
 * which crisis specs spawn per-suite on purpose; an always-on companion there
 * would change what those specs observe.
 *
 * Run: npm run e2e:custom-provider  (package.json)
 */
const port = Number(process.env.PLAYWRIGHT_PORT ?? 4274);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;
const signalingPort = Number(process.env.SIGNALING_PORT ?? 8787);
const companionPort = Number(process.env.CUSTOM_PROVIDER_COMPANION_PORT ?? 8791);
const mockPort = Number(process.env.MOCK_AI_PORT ?? 8789);

export default defineConfig({
  testDir: "./tests/e2e",
  // Only the custom-provider spec runs in this topology.
  testMatch: /custom-provider.*\.spec\.ts/,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["html", { outputFolder: "playwright-report-custom-provider", open: "never" }], ["line"]]
    : "list",
  outputDir: "test-results-custom-provider",
  use: {
    baseURL,
    contextOptions: { serviceWorkers: "block" },
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
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      // OpenAI-compatible mock with SSE streaming (scripts/mock-openai-server.mjs).
      command: `node scripts/mock-openai-server.mjs`,
      url: `http://127.0.0.1:${mockPort}/__health`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: { NODE_ENV: "test", MOCK_AI_PORT: String(mockPort) },
    },
    {
      // Signaling instance (WebSocket + unused /api). Kept on the default
      // 8787 so the VITE_P2P_SIGNALING_URL contract matches the shared config.
      command: `npm run server`,
      url: `http://127.0.0.1:${signalingPort}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        NODE_ENV: "test",
        HOST: "127.0.0.1",
        PORT: String(signalingPort),
        TRUST_PROXY: "0",
        WHOP_LICENSE_API_URL: "http://127.0.0.1:9/license",
        WHOP_API_KEY: "e2e-license-key",
        SIGNALING_ADMIN_TOKEN: process.env.SIGNALING_ADMIN_TOKEN ?? "e2e-admin-token",
      },
    },
    {
      // Companion instance: owns the /api routes (AI session bootstrap,
      // model-fetch proxy). It is NOT wired to the mock — the browser talks
      // to the mock directly over loopback, which the firewall allows.
      command: `npm run server`,
      url: `http://127.0.0.1:${companionPort}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        NODE_ENV: "test",
        HOST: "127.0.0.1",
        PORT: String(companionPort),
        TRUST_PROXY: "0",
        WHOP_LICENSE_API_URL: "http://127.0.0.1:9/license",
        WHOP_API_KEY: "e2e-license-key",
      },
    },
    {
      // Vite dev server (--mode test: fast Argon2id parameters, DEXIE storage
      // override) with /api proxied to the ISOLATED companion.
      command: `npm run dev -- --host 127.0.0.1 --port ${port} --mode test`,
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        NODE_ENV: "test",
        VITE_TEST_BUILD: "true",
        VITE_FORCE_DEXIE_STORAGE: "true",
        VITE_P2P_SIGNALING_URL: `ws://127.0.0.1:${signalingPort}`,
        VITE_API_PROXY_TARGET: `http://127.0.0.1:${companionPort}`,
        CRISIS_COMPANION_PORT: String(companionPort),
        MOCK_AI_PORT: String(mockPort),
        SIGNALING_ADMIN_TOKEN: process.env.SIGNALING_ADMIN_TOKEN ?? "e2e-admin-token",
      },
    },
  ],
});
