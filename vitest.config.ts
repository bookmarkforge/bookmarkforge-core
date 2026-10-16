/**
 * Vitest configuration — BookmarkForge
 *
 * Standalone (does NOT inherit vite.config.ts), so the PWA plugin and the
 * integrity-manifest plugin never run inside the test pipeline. Three
 * bridges to the build-time world are needed here:
 *
 *  - define: the __CSP_*__ tokens that src/utils/cspReportThrottle.ts
 *    expects (canonical strings in scripts/csp-config.js).
 *  - resolve.alias: `virtual:pwa-register[/react]` modules (provided by
 *    vite-plugin-pwa at build time) are pointed at the test mocks so
 *    modules importing them (the ReloadPrompt component inside MainApp) transform cleanly.
 *  - server.deps.inline: `voy-search` is ESM-only (no main/exports field)
 *    and cannot be externalized by vitest's node resolver; inlining makes
 *    vite resolve it via its own (module-field) resolution.
 *
 * Environment: jsdom + globals:true (setup.ts and several test files use
 * bare `beforeAll` / browser globals). A few tests opt out per-file via
 * `// @vitest-environment node` (crypto-core, store tests).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { VitePWA } from "vite-plugin-pwa";
import { CSP_MODERATE, CSP_OPEN, CSP_STRICT } from "./scripts/csp-config.js";
import coverageBudgets from "./scripts/coverage-area-budgets.json" with { type: "json" };

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    // Vite's resolver ignores `virtual:`-prefixed ids for aliases — only a
    // plugin can provide them. Including VitePWA here (inert outside build)
    // lets `virtual:pwa-register` / `virtual:pwa-register/react` resolve in
    // tests; test files override them with vi.mock factories where needed.
    VitePWA({ registerType: "prompt", manifest: false, injectRegister: false }),
  ],
  define: {
    __CSP_STRICT__: JSON.stringify(CSP_STRICT),
    __CSP_MODERATE__: JSON.stringify(CSP_MODERATE),
    __CSP_OPEN__: JSON.stringify(CSP_OPEN),
  },
  resolve: {
    alias: {
      // voy-search is ESM-only (no main/exports field, and it imports a
      // .wasm file directly). Vitest 4 removed `server.deps.inline`; a
      // resolve alias forces vite to process the package (never
      // externalized), so the .wasm import is transformed too.
      "voy-search": path.resolve(here, "node_modules/voy-search/voy_search.js"),
    },
  },
  // The bounded runner (scripts/test-bounded.mjs) points every child at one
  // shared transform-cache dir via BMF_TEST_CACHE_DIR so batches reuse each
  // other's transforms and the cache survives between runs. It lives outside
  // the default node_modules/.vite, which `vite build` wipes, so a build in
  // between test runs no longer resets the warm cache. Unset here means the
  // default (used by test:coverage / watch, which are single-process).
  cacheDir: process.env.BMF_TEST_CACHE_DIR,
  test: {
    environment: "jsdom",
    globals: true,
    css: false,
    setupFiles: ["./src/tests/setup.ts"],
    include: [
      "src/**/*.test.{ts,tsx}",
      // Human-like simulator unit tests (src/tests/human-like/utils). The
      // broad `src/**` glob above already matches them; the explicit entry
      // keeps the framework's unit suite self-documenting here and guards
      // it against a future include change.
      "src/tests/human-like/**/*.test.ts",
      // ESLint-rule unit tests live at the repo root, next to the rule.
      // The default `src/**` glob does not pick them up; an explicit
      // entry here keeps the project convention "tests next to source"
      // for the eslint-rules/ subfolder.
      "eslint-rules/**/*.test.mjs",
      // Quality-gate script tests live under scripts/__tests__/. Adding
      // them here lets us run vitest assertions against the gate logic
      // (e.g. audit-anchors) without standing up a separate test runner.
      "scripts/__tests__/**/*.test.mjs",
    ],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/dist-extension/**",
      "**/extension/**",
      "tests/e2e/**",
      // Public-relay Playwright suite (its own dev server, see
      // playwright.public-relay.config.ts) — a browser suite like tests/e2e.
      "tests/e2e-public-relay/**",
      "src/tests/scripts/check-rxdb17.test.ts",
      "src/tests/utils/crypto-core.fuzz.test.ts",
    ],
    // Argon2id/WebCrypto and stress tests need generous budgets.
    testTimeout: 60_000,
    hookTimeout: 120_000,
    deps: {
      web: {
        // Transform the .wasm imported by voy-search instead of stubbing.
        transformAssets: true,
      },
    },
    coverage: {
      provider: "v8",
      // "json" is REQUIRED: check-coverage-by-area.mjs consumes
      // coverage/coverage-final.json, and the v8 provider only writes it
      // when the json reporter is enabled. Without it the per-directory
      // gate silently skips in CI (input file never produced).
      // "lcov" feeds the codecov badge (nightly upload, CODECOV_TOKEN).
      reporter: ["text", "html", "json", "lcov"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        // Server infra (server/**) is collected by the spawn-based sync
        // tests via child-process coverage, but it is not frontend code and
        // is not covered by any src/ area budget — excluding it keeps the
        // aggregate a truthful measure of the shipped src/ tree.
        "server/**",
        "src/tests/**",
        "src/**/*.test.{ts,tsx}",
        // Declaration files carry no executable statements and would skew
        // the aggregate at 0% (e.g. turndown.d.ts) — exclude them so the
        // thresholds below gate real code only.
        "**/*.d.ts",
        "src/polyfills.ts",
        "src/main.tsx",
        "src/index.ts",
        "src/App.tsx",
        "src/workers/**",
        // Worker files are excluded from coverage gating (src/workers/**
        // above); this embedding worker lives in services/ai but is the
        // same kind of file (no executable test surface in jsdom).
        "src/services/ai/embedding.worker.ts",
        "src/db/__tests__/**",
      ],
      // The aggregate floor is sourced from the same budget document as the
      // per-area gate. Do not duplicate these numbers here: a single edit to
      // scripts/coverage-area-budgets.json must drive both exit codes.
      thresholds: coverageBudgets.global,
    },
  },
});
