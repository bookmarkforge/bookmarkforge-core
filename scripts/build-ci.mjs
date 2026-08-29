/**
 * scripts/build-ci.mjs — CI-grade production build.
 *
 * Runs the Vite production build and then verifies the security-critical
 * artifacts the runtime depends on:
 *   1. dist/index.html embeds the __BMF_INTEGRITY_MANIFEST__ (the runtime
 *      integrity check hard-fails without it — src/utils/bundleIntegrity.ts).
 *   2. /assets/ script/link tags carry SRI integrity="sha256-…".
 *   3. dist/sw.js (Workbox service worker) was generated.
 *
 * Exit code is non-zero on any failure. Use via `npm run build:ci`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const VITE_BIN = join(ROOT, "node_modules", "vite", "bin", "vite.js");

const rollupWasmLoader = join(ROOT, "scripts", "rollup-wasm-loader.cjs");
const useRollupWasm = process.platform === "win32" && process.arch === "arm64";
const nodeOptions = [process.env.NODE_OPTIONS, useRollupWasm ? `--require=${rollupWasmLoader}` : ""]
  .filter(Boolean)
  .join(" ");
const run = spawnSync(process.execPath, [VITE_BIN, "build"], {
  stdio: "inherit",
  env: { ...process.env, NODE_OPTIONS: nodeOptions },
});
if (run.status !== 0) process.exit(run.status ?? 1);

// ── P0: Secret-scan gate — reject bundles that leak VITE_* provider keys ──
// Vite inlines ALL VITE_* vars into import.meta.env dictionaries.  Even if
// the frontend never reads a key, the literal value ends up in dist/*.js as
// a string constant.  This gate scans every JS asset for the literal
// assignment pattern (e.g. `VITE_GEMINI_API_KEY:"AIza..."`) and blocks
// deployment when a secret is found.  Use server-side GEMINI_API_KEY instead.
{
  const SENSITIVE_KEYS = [
    "VITE_GEMINI_API_KEY",
    "VITE_OPENAI_API_KEY",
    "VITE_ANTHROPIC_API_KEY",
    "VITE_GROQ_API_KEY",
    "VITE_HUGGINGFACE_API_KEY",
  ];
  // Match Vite's inlining pattern:  KEY:`value`  (backtick, most common)
  // or  KEY:"value"  (double-quote).  The regex is deliberately narrow —
  // it only flags the key name followed by a quoted non-empty value, so
  // an undefined/empty assignment (e.g. KEY:undefined) is harmless.
  const pattern = new RegExp(
    SENSITIVE_KEYS.map((k) => k + ':\\s*["\'`][^"\'`]+["\'`]').join("|"),
    "g",
  );
  const assetsDir = join(ROOT, "dist", "assets");
  if (existsSync(assetsDir)) {
    const jsFiles = readdirSync(assetsDir).filter((f) => f.endsWith(".js"));
    const leaks = [];
    for (const file of jsFiles) {
      const content = readFileSync(join(assetsDir, file), "utf8");
      let match;
      pattern.lastIndex = 0;
      while ((match = pattern.exec(content)) !== null) {
        const snippet = content.slice(
          Math.max(0, match.index - 20),
          match.index + match[0].length + 20,
        );
        leaks.push({ file, match: match[0], snippet });
      }
    }
    if (leaks.length > 0) {
      console.error("\n[build-ci] FAIL — VITE_* secrets leaked into dist/:");
      for (const { file, match, snippet } of leaks) {
        console.error(`  ${file}: ${match}`);
        console.error(`    ...${snippet}...`);
      }
      console.error(
        "\n  Fix: remove the VITE_ prefix from provider keys.  " +
          "Server-side GEMINI_API_KEY is NOT exposed to the browser.",
      );
      process.exit(1);
    }
    console.log(`[build-ci] secret-scan: ${jsFiles.length} JS assets clean`);
  }
}

const failures = [];
const indexHtmlPath = join(ROOT, "dist", "index.html");

if (!existsSync(indexHtmlPath)) {
  failures.push("dist/index.html missing");
} else {
  const html = readFileSync(indexHtmlPath, "utf8");
  if (!html.includes("__BMF_INTEGRITY_MANIFEST__")) {
    failures.push("__BMF_INTEGRITY_MANIFEST__ not injected into dist/index.html");
  }
  if (!html.includes(' integrity="sha256-')) {
    failures.push("no SRI integrity= attributes found on /assets/ tags");
  }
}
if (!existsSync(join(ROOT, "dist", "sw.js"))) {
  failures.push("dist/sw.js (service worker) missing");
}

if (failures.length > 0) {
  console.error(`[build-ci] FAIL: ${failures.join("; ")}`);
  process.exit(1);
}
console.log("[build-ci] integrity manifest + SRI + service worker verified");

// P60 chunk-boundary guard: fail if the ui-runtime vendor chunk (lucide +
// motion) ever leaks into the entry chunk or pre-unlock security screens.
// Kept separate from the checks above so its own failure message is clear.
// --require-dist: this runs right after a production build, so a missing
// dist/ here is a hard failure, never a skip. --json: the gate emits its
// structured per-invariant report on stdout (and the GitHub step summary
// when GITHUB_STEP_SUMMARY is set). Stdout is captured and written to
// ci-chunk-report.json for CI artifact upload; stderr (human-readable +
// GITHUB_STEP_SUMMARY lines) is inherited so it still appears in the log.
const chunks = spawnSync(
  process.execPath,
  [join(ROOT, "scripts", "check-chunk-boundaries.mjs"), "--require-dist", "--json"],
  { stdio: ["inherit", "pipe", "inherit"] },
);
if (chunks.stdout && chunks.stdout.length > 0) {
  writeFileSync(join(ROOT, "ci-chunk-report.json"), chunks.stdout, "utf8");
}
if (chunks.status !== 0) {
  process.exit(chunks.status ?? 1);
}

// P6 bundle-size + report gate: assert the entry/total/single-chunk size
// budgets against the just-built dist/assets and emit bundle-report.md.
// Runs in the same lifecycle as the chunk-boundary guard above (right after
// the production build), so a missing dist/ is a hard failure, never a skip.
// `bundle-report.md` is gitignored — a diagnostic artifact, not source.
const bundleSize = spawnSync(
  process.execPath,
  [join(ROOT, "scripts", "check-bundle-size.mjs")],
  { stdio: "inherit" },
);
if (bundleSize.status !== 0) {
  process.exit(bundleSize.status ?? 1);
}
