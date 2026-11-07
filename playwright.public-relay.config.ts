import baseConfig from "./playwright.config";
import { defineConfig } from "@playwright/test";

/**
 * PUBLIC-RELAY MODE — the deployment shape where no self-hosted signaling
 * server is configured, so the app falls back to the public rxdb.info relay.
 *
 * A-3 scopes room-secret injection to the origin of the configured server,
 * which makes this the one mode where the secret must never reach the wire —
 * and the base config cannot exercise it: its Vite dev server is started with
 * `VITE_P2P_SIGNALING_URL` pointing at the local signaling server, and Vite
 * bakes the variable into the modules it delivers at start-up. A second dev
 * server, on its own port and with the variable explicitly EMPTY, is the only
 * honest way to boot the app "without VITE_P2P_SIGNALING_URL".
 *
 * Consequences, all deliberate:
 *
 *   - `testDir` is `tests/e2e-public-relay`, so no other config (they point at
 *     `tests/e2e` or `src/tests/human-like/examples`) ever collects this spec:
 *     under any other config the app IS configured and the premise is false.
 *   - The base config's `webServer` block is dropped rather than inherited.
 *     `defineConfig(a, b)` CONCATENATES `webServer` arrays, so extending the
 *     base would boot its two servers as well — the local signaling server AND
 *     a second app build served WITH the variable set. Both are exactly what
 *     this suite must keep out of the picture.
 *   - What remains is one dev server and no signaling server at all: the spec
 *     stands in for the public relay inside the page
 *     (`page.routeWebSocket`), which is also the only way to observe frames a
 *     browser sends to a third-party relay.
 */
const { webServer: _inheritedWebServer, ...baseWithoutWebServer } = baseConfig;

const port = Number(process.env.PUBLIC_RELAY_PORT ?? 4183);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  ...baseWithoutWebServer,
  testDir: "./tests/e2e-public-relay",
  timeout: 90_000,
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${port} --mode test`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      NODE_ENV: "test",
      // Same fast-KDF/test-mode switches as the base config: without them the
      // vault setup runs the 128 MiB desktop Argon2id parameters and blows the
      // setup budget (see playwright.config.ts).
      VITE_TEST_BUILD: "true",
      VITE_FORCE_DEXIE_STORAGE: "true",
      // THE contract under test. Set to the empty string rather than merely
      // omitted: Playwright merges `process.env` into a webServer's environment
      // (`{...process.env, ...env}`), so a shell or CI job that exports the
      // variable — ci.yml's e2e job does — would otherwise leak a configured
      // server into a run whose whole premise is that none is configured. The
      // spec asserts the app sees no configured URL either way.
      VITE_P2P_SIGNALING_URL: "",
    },
  },
  use: {
    ...baseConfig.use,
    baseURL,
    // The inherited storageState is keyed by the base config's origin, so the
    // consent seeds would not apply to this port.
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
  },
});
