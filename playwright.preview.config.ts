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

// NOTE — `defineConfig(baseConfig, { … })` CONCATENATES `webServer` (and
// merges `projects`) instead of replacing them: the merged config carried
// four servers, two claiming 127.0.0.1:4173, so the base dev server won the
// port and the packaged build was never the artifact under test. Readiness
// is /app, not /: the build has no dist/index.html and `/` answers 404
// (same fix as playwright.sw-integrity.config.ts).
export default defineConfig({
  ...baseConfig,
  use: { ...baseConfig.use, baseURL },
  webServer: [
    // Keep the base companion and license mock (specs that reach /api or the
    // signaling socket still find them); drop ONLY the base dev server, which
    // owns baseURL and used to shadow the packaged preview.
    ...baseServers.filter((server) => server.url !== baseURL),
    {
      command: `npm run preview -- --host 127.0.0.1 --port ${port}`,
      url: `${baseURL}/app`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
