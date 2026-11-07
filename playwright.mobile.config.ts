import { defineConfig, devices } from "@playwright/test";

/**
 * Mobile profile — emulated Android (Pixel 7, mobile Chrome) against the
 * PRODUCTION build. Run through the runner, which builds dist/ first with
 * the two E2E diagnostic flags:
 *
 *   node scripts/run-mobile-smoke.mjs
 *   npm run e2e:mobile
 *
 * Why a production build: the 64 MiB mobile Argon2id profile only exists
 * where isProdBuild() && !isTestMode() — the dev/test server forces the
 * 8 MiB test parameters, so a dev-server run would prove nothing. The build
 * carries VITE_E2E_KDF_DIAGNOSTICS=true so publishKdfParams (src/db/
 * database.ts) exposes the resolved profile, and
 * VITE_E2E_PREVIEW_DIAGNOSTICS=true for the durable-backend guard. Neither
 * flag is ever set in real production builds — the diagnostic hooks ship
 * nowhere.
 *
 * Spec: tests/e2e/pwa-mobile-android.spec.ts — KDF profile proof + PWA
 * manifest/service-worker/install-prompt surface. Everything else belongs
 * to the launch-smoke and engines batteries.
 *
 * Local prerequisites:
 *   npx playwright install chromium        # mobile Chrome IS chromium
 */
const port = Number(process.env.PLAYWRIGHT_PORT ?? 4175);
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;

const previewServer = {
  command: `npm run preview -- --host 127.0.0.1 --port ${port}`,
  url: baseURL,
  // Fresh preview per run: a stale preview serving an OLD dist/ would let a
  // KDF-flag regression pass ("green" against yesterday's bundle).
  reuseExistingServer: false,
  timeout: 120_000,
  env: {
    // vite preview proxies /api to the companion; these specs need no /api,
    // but keep the proxy target defined so a stray /api call fails fast
    // (connection refused) instead of hanging.
    VITE_API_PROXY_TARGET: "http://127.0.0.1:9",
  },
};

export default defineConfig({
  testMatch: ["tests/e2e/pwa-mobile-android.spec.ts"],
  timeout: 300_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["line"]] : "list",
  use: {
    // Pixel 7: 412x915 @3x, mobile Chrome UA, touch, Android — the device
    // descriptor that makes isMobileDevice() resolve true.
    ...devices["Pixel 7"],
    baseURL,
    // Emulated-Android Chrome headless ships the real mobile UA + touch;
    // locale/timezone pinned for deterministic i18n in assertions.
    locale: "en-US",
    timezoneId: "Europe/Madrid",
  },
  webServer: [previewServer],
});
