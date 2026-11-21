import baseConfig from "./playwright.config";
import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";

/**
 * Launch-smoke profile — the release-day battery over the critical paths
 * (tests/e2e/launch-smoke-critical-paths.spec.ts): vault create with a
 * 12+ char password, 24-word phrase recovery, license activation through
 * the real signing service, and the encrypted .bmf disaster round-trip.
 *
 * Two modes:
 *
 *   npx playwright test --config=playwright.launch-smoke.config.ts
 *     → default: dev server in `--mode test` (fast Argon2id, 8 MiB).
 *       Full battery in minutes; same semantics as the smoke profile.
 *
 *   BMF_LAUNCH_SMOKE_MODE=prod npx playwright test \
 *     --config=playwright.launch-smoke.config.ts
 *     → `vite preview` over the real production build. The build must
 *       already exist WITH the E2E preview diagnostics so the durable-
 *       backend guard can assert (see scripts/run-launch-smoke.mjs):
 *
 *         VITE_E2E_PREVIEW_DIAGNOSTICS=true npm run build:ci
 *
 *       This profile does NOT rebuild — launch day runs the bundle you
 *       shipped, and the runner script is responsible for the build step.
 *       Strong Argon2id (128 MiB) applies; per-test timeouts are generous.
 *
 *       The /api proxy in vite.config.ts forwards /api/license/* to the
 *       dev-only adapter scripts/dev-license-server.ts (port 8788), which
 *       calls the Whop-adapter mock and signs the entitlement — the REAL
 *       signing path: Whop-adapter mock → RSA-PSS-signed entitlement →
 *       client verification → cached state. (The companion stopped serving
 *       license routes on 2026-10-19; it is signaling-only now.)
 *
 * License wiring: the base config already boots the same adapter + mock
 * pair; this profile overrides the mock key env to match. The companion's
 * WHOP_* overrides below are inert leftovers of the pre-retirement
 * topology — kept so a companion that still validates the provider URL at
 * boot sees a well-formed loopback target.
 *
 * The license adapter signs entitlements with the gitignored dev key
 * (server/.license-signing-key.pkcs8, picked up automatically via
 * loadSigningPrivateKey). Without ANY signing key the license tests are
 * skipped with an explicit marker — never silently.
 */
const prodMode = process.env.BMF_LAUNCH_SMOKE_MODE === "prod";
const port = prodMode
  ? Number(process.env.PLAYWRIGHT_PORT ?? 4174)
  : Number(process.env.PLAYWRIGHT_PORT ?? 4173);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;
const readinessURL = prodMode ? `${baseURL}/app` : baseURL;
const licenseMockPort = Number(process.env.LICENSE_MOCK_PORT ?? 8082);
// Dev-only adapter serving the real api/license/[action].ts handler; the
// E2E proxy sends /api/license here (the companion stopped serving it).
const licenseProxyPort = Number(process.env.LICENSE_PROXY_PORT ?? 8788);
const signalingPort = Number(process.env.SIGNALING_PORT ?? 8787);
// Must match the license adapter's WHOP_API_KEY: the mock authenticates the
// adapter's bearer token (same contract as playwright.config.ts).
const LICENSE_MOCK_KEY = process.env.LICENSE_MOCK_KEY ?? "e2e-license-key";

// Private-infra gating (same contract as playwright.config.ts): the public
// Core export ships neither server/ nor api/license/, so the companion
// spread and the license mock compile out there.
const hasCompanionServer = existsSync("server/src/index.ts");
const hasLicenseStack = existsSync("api/license/[action].ts");
const baseWebServers = Array.isArray(baseConfig.webServer)
  ? baseConfig.webServer
  : baseConfig.webServer
    ? [baseConfig.webServer]
    : [];
const companionBase = baseWebServers[0];

const hasSigningKey =
  existsSync("server/.license-signing-key.pkcs8") ||
  Boolean(process.env.LICENSE_SIGNING_PRIVATE_KEY_FILE) ||
  Boolean(process.env.LICENSE_SIGNING_PRIVATE_KEY_PKCS8);
if (hasLicenseStack && !hasSigningKey) {
  console.warn(
    "[launch-smoke] No license signing key found — license activation tests will be skipped.\n" +
      "[launch-smoke] Generate one with: node scripts/generate-license-keys.mjs --write",
  );
}

export default defineConfig({
  ...baseConfig,
  // NOTE: defineConfig(baseConfig, overrides) CONCATENATES webServer arrays
  // — the base's dev server (whose env points the /api proxy at the crisis
  // suite's 8799) would boot on 4173 first and this profile's own dev server
  // would silently reuse it, running every license test against a dead
  // proxy target. Spreading instead of merging guarantees ONLY the servers
  // declared below run.
  testMatch: ["tests/e2e/launch-smoke-critical-paths.spec.ts"],
  timeout: 300_000,
  expect: { timeout: 30_000 },
  fullyParallel: false, // sequential: KDF-heavy flows on the same machine
  workers: 1,
  retries: 0, // a release gate must report the first failure, not mask it
  reporter: process.env.CI ? [["line"]] : "list",
  use: { ...baseConfig.use, baseURL },
  // companion server (signaling only — license routes retired 2026-10-19),
  // the dev license adapter (8788), the Whop-adapter license mock (8082),
  // then either the dev server (test mode) or `vite preview` over dist/
  // (prod mode).
  webServer: [
    ...(hasCompanionServer && companionBase
      ? [
          {
            ...companionBase,
            env: {
              ...companionBase.env,
              WHOP_LICENSE_API_URL: `http://127.0.0.1:${licenseMockPort}/license`,
              WHOP_API_KEY: LICENSE_MOCK_KEY,
              LICENSE_PROVIDER_ALLOW_HTTP: "1",
            },
          },
        ]
      : []),
    ...(hasLicenseStack
      ? [
          {
            // Dev-only adapter for the serverless license handler — same
            // topology as playwright.config.ts: the companion no longer serves
            // /api/license (retired 2026-10-19), so api/license/[action].ts
            // runs here and VITE_LICENSE_PROXY_TARGET points the proxy at it.
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
              LICENSE_PROVIDER_ALLOW_HTTP: "1",
            },
          },
          {
            command: "node scripts/license-mock.mjs",
            url: `http://127.0.0.1:${licenseMockPort}/health`,
            // Always-fresh mock: the mock holds per-run activation state, and a
            // reused half-dead server from a crashed run is the 502 failure class
            // this battery must never mask. Local only, so killing is safe.
            reuseExistingServer: false,
            timeout: 60_000,
            env: {
              LICENSE_MOCK_PORT: String(licenseMockPort),
              LICENSE_MOCK_KEY,
            },
          },
        ]
      : []),
    prodMode
      ? {
          command: `npm run preview -- --host 127.0.0.1 --port ${port}`,
          url: readinessURL,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          env: {
            // /api/* (non-license) goes to the companion (npm run server)
            // process on SIGNALING_PORT — the crisis suite's 8799 convention
            // only applies when a spec spawns its own companion, which this
            // battery does not. /api/license/* is routed separately by
            // VITE_LICENSE_PROXY_TARGET to the dev adapter on 8788.
            VITE_API_PROXY_TARGET: `http://127.0.0.1:${signalingPort}`,
            ...(hasLicenseStack
              ? {
                  VITE_LICENSE_PROXY_TARGET: `http://127.0.0.1:${licenseProxyPort}`,
                }
              : {}),
          },
        }
      : {
          command: `npm run dev -- --host 127.0.0.1 --port ${port} --mode test`,
          url: baseURL,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          env: {
            NODE_ENV: "test",
            VITE_TEST_BUILD: "true",
            VITE_FORCE_DEXIE_STORAGE: "true",
            VITE_P2P_SIGNALING_URL: `ws://127.0.0.1:${signalingPort}`,
            // Same rationale as the prod branch above: the proxy must reach
            // the RUNNING companion (signaling server), not a dead port.
            VITE_API_PROXY_TARGET: `http://127.0.0.1:${signalingPort}`,
            ...(hasLicenseStack
              ? {
                  VITE_LICENSE_PROXY_TARGET: `http://127.0.0.1:${licenseProxyPort}`,
                }
              : {}),
            SIGNALING_ADMIN_TOKEN:
              process.env.SIGNALING_ADMIN_TOKEN ?? "e2e-admin-token",
          },
        },
  ],
});
