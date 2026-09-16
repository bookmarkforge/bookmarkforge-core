import { defineConfig, devices } from "@playwright/test";

/**
 * playwright.ai-upstream.config.ts — isolated topology for the Gemini proxy
 * chain E2E (tests/e2e/gemini-upstream-errors.spec.ts).
 *
 * This is the concrete deliverable of the MSW evaluation thread: instead of
 * MSW (rejected — browser-only interception cannot reach the companion
 * process; `serviceWorkers: "block"` in the shared config; the Vitest suite's
 * module-level mocks would all need rewriting), the upstream is a tiny
 * dependency-free node:http stub (scripts/test-upstream-server.mjs) and the
 * companion's GEMINI_API_BASE points at it. The spec then exercises the FULL
 * production chain with zero production-code changes:
 *
 *   GeminiProvider → /api/services/ai/session (CSRF) → Vite /api proxy
 *     → companion entitlement guard → geminiProxyHandler → upstream stub
 *
 * Why an isolated config (repo convention, cf. playwright.public-relay.config.ts):
 * the shared config's Vite proxy sends /api to CRISIS_COMPANION_PORT (8799),
 * which the crisis specs spawn per-suite on purpose. Starting an always-on
 * server there would change what those specs observe. This topology owns:
 *
 *   8788  fake Gemini upstream (scenarios keyed by model name)
 *   8787  signaling server (same binary; /api on it stays unused)
 *   8790  companion server with GEMINI_API_BASE → the stub
 *   4273  Vite dev server with VITE_API_PROXY_TARGET → the companion
 *
 * Run: npm run e2e:ai-upstream  (package.json)
 */
const port = Number(process.env.PLAYWRIGHT_PORT ?? 4273);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;
const signalingPort = Number(process.env.SIGNALING_PORT ?? 8787);
const companionPort = Number(process.env.AI_UPSTREAM_COMPANION_PORT ?? 8790);
const upstreamPort = Number(process.env.AI_UPSTREAM_PORT ?? 8788);
const upstreamBase = `http://127.0.0.1:${upstreamPort}/v1beta/models`;

export default defineConfig({
  testDir: "./tests/e2e",
  // Only the proxy-chain spec runs in this topology.
  testMatch: /gemini-upstream-errors\.spec\.ts/,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["html", { outputFolder: "playwright-report-ai-upstream", open: "never" }], ["line"]]
    : "list",
  outputDir: "test-results-ai-upstream",
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
      // Fake Gemini upstream (see scripts/test-upstream-server.mjs header:
      // scenarios are keyed by the model name, stateless).
      command: `node scripts/test-upstream-server.mjs`,
      url: `http://127.0.0.1:${upstreamPort}/__health`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: { NODE_ENV: "test", AI_UPSTREAM_PORT: String(upstreamPort) },
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
        AI_SESSION_REQUIRE_LICENSE: "0",
        GEMINI_API_KEY: "e2e-ai-key",
        GEMINI_API_BASE: "http://127.0.0.1:9/v1beta/models",
        WHOP_LICENSE_API_URL: "http://127.0.0.1:9/license",
        WHOP_API_KEY: "e2e-license-key",
        SIGNALING_ADMIN_TOKEN: process.env.SIGNALING_ADMIN_TOKEN ?? "e2e-admin-token",
      },
    },
    {
      // Companion instance: owns the /api routes the spec exercises. Its
      // upstream is the STUB, so geminiProxyHandler performs real HTTP
      // against a controlled fake Gemini.
      command: `npm run server`,
      url: `http://127.0.0.1:${companionPort}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        NODE_ENV: "test",
        HOST: "127.0.0.1",
        PORT: String(companionPort),
        TRUST_PROXY: "0",
        AI_SESSION_REQUIRE_LICENSE: "0",
        GEMINI_API_KEY: "e2e-ai-key",
        GEMINI_API_BASE: upstreamBase,
        WHOP_LICENSE_API_URL: "http://127.0.0.1:9/license",
        WHOP_API_KEY: "e2e-license-key",
      },
    },
    {
      // Vite dev server (--mode test: fast Argon2id parameters, DEXIE storage
      // override) with /api proxied to the ISOLATED companion, matching the
      // production topology (nginx /api → companion) end to end.
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
        AI_UPSTREAM_PORT: String(upstreamPort),
        SIGNALING_ADMIN_TOKEN: process.env.SIGNALING_ADMIN_TOKEN ?? "e2e-admin-token",
      },
    },
  ],
});
