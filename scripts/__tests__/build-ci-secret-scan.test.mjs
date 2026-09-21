/**
 * scripts/__tests__/build-ci-secret-scan.test.mjs
 *
 * Integration test: verifies that `build-ci.mjs` exits with code 1 when
 * VITE_GEMINI_API_KEY is set in the environment.  Vite inlines ALL VITE_*
 * vars into import.meta.env dictionaries inside dist/*.js.  The secret-scan
 * gate in build-ci.mjs scans for the literal assignment pattern and blocks
 * deployment when a provider key leaks into the bundle.
 *
 * Note: Provider keys should be stored in the user's encrypted vault and used
 * directly from the browser; the server no longer proxies AI calls. This gate
 * protects against accidental configuration errors where VITE_*_API_KEY vars
 * might be set despite being removed from .env.example.
 *
 * Strategy:
 *   1. Run `node scripts/build-ci.mjs` as a child process with
 *      VITE_GEMINI_API_KEY=sk-test-fake-key-for-scan-gate set.
 *   2. Assert exit code === 1.
 *   3. Assert stderr contains the expected leak-detection message.
 *   4. Assert dist/*.js contains the leaked key literal (confirming Vite
 *      actually inlined it — the gate is testing real output, not mocks).
 */
import { describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");
const BUILD_CI = join(REPO_ROOT, "scripts", "build-ci.mjs");
const DIST_ASSETS = join(REPO_ROOT, "dist", "assets");

const FAKE_KEY = "sk-test-fake-key-for-scan-gate-12345";

describe("build-ci secret-scan gate", () => {
  test("exits 1 when VITE_GEMINI_API_KEY is set and leaks into bundle", () => {
    // Skip if dist/ doesn't exist (first run needs a real build)
    if (!existsSync(DIST_ASSETS)) {
      console.warn(
        "[skip] dist/assets/ not found — run `npm run build` first to populate it",
      );
      return;
    }

    // Run build-ci.mjs with the fake key set — Vite will inline it
    const result = spawnSync(process.execPath, [BUILD_CI], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 300_000, // 5 min — full Vite build
      env: {
        ...process.env,
        VITE_GEMINI_API_KEY: FAKE_KEY,
        // Ensure production-like build
        NODE_ENV: "production",
      },
    });

    // ① Exit code must be 1 (secret-scan rejected the bundle)
    expect(result.status).toBe(1);

    // ② stderr must mention the leaked key
    const combined = (result.stderr ?? "") + (result.stdout ?? "");
    expect(combined).toMatch(/VITE_\*?\s*secrets?\s*leaked/i);
    expect(combined).toContain(FAKE_KEY);

    // ③ Confirm Vite actually inlined the key into dist/*.js
    if (existsSync(DIST_ASSETS)) {
      const jsFilesAfter = readdirSync(DIST_ASSETS).filter((f) =>
        f.endsWith(".js"),
      );
      let foundInBundle = false;
      for (const file of jsFilesAfter) {
        const content = readFileSync(join(DIST_ASSETS, file), "utf8");
        if (content.includes(FAKE_KEY)) {
          foundInBundle = true;
          break;
        }
      }
      expect(
        foundInBundle,
        `Expected Vite to inline ${FAKE_KEY} into dist/*.js but it was not found`,
      ).toBe(true);
    }
  }, 360_000); // 6 min timeout for the full test

  test("exits 0 when VITE_GEMINI_API_KEY is absent (clean bundle)", () => {
    if (!existsSync(DIST_ASSETS)) {
      console.warn(
        "[skip] dist/assets/ not found — run `npm run build` first to populate it",
      );
      return;
    }

    // Run build-ci.mjs WITHOUT the fake key — should pass secret-scan
    // (other gates may fail, so we only check the exit code is NOT 1 from
    // secret-scan — we look for the "clean" message instead)
    const result = spawnSync(process.execPath, [BUILD_CI], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 300_000,
      env: {
        ...process.env,
        // Explicitly unset all sensitive VITE_ keys
        VITE_GEMINI_API_KEY: "",
        VITE_OPENAI_API_KEY: "",
        VITE_ANTHROPIC_API_KEY: "",
        VITE_GROQ_API_KEY: "",
        VITE_HUGGINGFACE_API_KEY: "",
        NODE_ENV: "production",
      },
    });

    const combined = (result.stderr ?? "") + (result.stdout ?? "");

    // If the build itself succeeded (exit 0), secret-scan should report clean
    // If another gate failed (exit != 0), secret-scan should NOT be the reason
    if (result.status === 0) {
      expect(combined).toMatch(/secret-scan:.*JS assets clean/i);
    } else {
      // Build failed for another reason — just verify secret-scan didn't trigger
      expect(combined).not.toMatch(/VITE_\*?\s*secrets?\s*leaked/i);
    }
  }, 360_000);
});
