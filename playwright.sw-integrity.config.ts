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
// NOTE — why this profile does NOT use `defineConfig(baseConfig, { … })`:
// that form CONCATENATES `webServer` (and merges `projects`) instead of
// replacing them. The merged config ended up with four servers, two of them
// claiming 127.0.0.1:4173: the base dev server won the port, the preview
// never bound, and its readiness URL was satisfied by the dev server — so the
// spec ran against Vite in test mode, where /sw.js does not exist and
// `navigator.serviceWorker.ready` can never resolve (4 × 120 s timeouts).
// A single object argument is used verbatim, so the spread below is
// load-bearing, not style (same rule as playwright.smoke.config.ts).
//
// Readiness is /app, not /: the packaged build has no dist/index.html — the
// root is the marketing landing and the SPA shell is /app.html, served at
// /app. Polling / would wait forever on a 404.
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
const port = Number(process.env.PLAYWRIGHT_PORT ?? 4173);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;

export default defineConfig({
  ...baseConfig,
  testMatch: ["tests/e2e/sw-integrity-tamper.spec.ts"],
  // Pin the project list: the base config's `mobile` project could otherwise
  // join this run with a battery this viewport cannot satisfy.
  projects: (baseConfig.projects ?? []).filter(
    (project) => project.name === "chromium",
  ),
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  use: {
    ...baseConfig.use,
    baseURL,
    contextOptions: { serviceWorkers: "allow" },
    storageState: {
      cookies: [],
      origins: [
        {
          origin: baseURL,
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
    command: `npm run preview -- --host 127.0.0.1 --port ${port}`,
    url: `${baseURL}/app`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
