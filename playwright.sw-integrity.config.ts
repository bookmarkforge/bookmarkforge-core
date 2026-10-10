import baseConfig from "./playwright.config";
import { defineConfig } from "@playwright/test";

// SW integrity tamper profile — ADR-039 browser-level verification.
//
// Unlike every other profile, this one needs the REAL service worker: the
// whole point is to prove the SW-side integrity runtime (embedded into
// dist/sw.js at build time) rejects tampered precache and runtime-cache
// entries in an actual Chromium, end to end. The base config therefore
// deliberately BLOCKS service workers; this profile re-enables them.
//
// Server: the production build (dist/) served by `vite preview`, exactly
// like playwright.preview.config.ts. The `npm run e2e:sw-integrity` script
// runs `build:ci` first so the tested artifact is the gated production
// build (secret scan + SRI + SW embed verification included), never a
// stale dist/.
//
// Consent: seeded OFF for every remote channel (analytics, Sentry, client
// events) so the test measures the integrity surface in isolation — a
// tampered bundle must be caught by the SW, not masked by telemetry noise
// or outbound /api traffic. `forge_consent_decision_made` stays true so
// the first-run banner never intercepts pointer events.
//
// Serial (workers=1): the spec navigates the same app and relies on
// service-worker lifecycle (install → activate → control → cache), and a
// single preview server keeps cache/cache-name contention at zero.
export default defineConfig(baseConfig, {
  testMatch: ["tests/e2e/sw-integrity-tamper.spec.ts"],
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  use: {
    ...baseConfig.use,
    contextOptions: { serviceWorkers: "allow" },
    storageState: {
      cookies: [],
      origins: [
        {
          origin: `http://127.0.0.1:${Number(process.env.PLAYWRIGHT_PORT ?? 4173)}`,
          localStorage: [
            { name: "forge_consent_decision_made", value: "true" },
            { name: "forge_consent_analytics", value: "false" },
            { name: "forge_consent_sentry", value: "false" },
            { name: "forge_consent_error_reporting", value: "false" },
            { name: "forge_consent_client_events", value: "false" },
            { name: "bmf_local_error_storage", value: "true" },
          ],
        },
      ],
    },
  },
  webServer: {
    command: `npm run preview -- --host 127.0.0.1 --port ${Number(process.env.PLAYWRIGHT_PORT ?? 4173)}`,
    url: `http://127.0.0.1:${Number(process.env.PLAYWRIGHT_PORT ?? 4173)}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});