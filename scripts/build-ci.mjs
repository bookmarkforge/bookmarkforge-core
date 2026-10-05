/**
 * scripts/build-ci.mjs — CI-grade production build.
 *
 * Runs the Vite production build and then verifies the security-critical
 * artifacts the runtime depends on:
 *   1. dist/index.html embeds the __BMF_INTEGRITY_MANIFEST__ (the runtime
 *      integrity check hard-fails without it — src/utils/bundleIntegrity.ts).
 *   2. /assets/ script/link tags carry SRI integrity="sha256-…".
 *   3. dist/sw.js (Workbox service worker) was generated.
 *   4. ADR-039: dist/sw.js embeds the SW-side integrity runtime + manifest
 *      (scripts/sw-integrity-runtime.js) and the embedded bytes actually run:
 *      enablement, genuine-asset verification and tampered-asset rejection
 *      are proven against the real dist/ artifacts on every build.
 *
 * Exit code is non-zero on any failure. Use via `npm run build:ci`.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { quoteNodeOptionPath } from "./tooling/node-options.mjs";

const ROOT = process.cwd();
const VITE_BIN = join(ROOT, "node_modules", "vite", "bin", "vite.js");

const rollupWasmLoader = join(ROOT, "scripts", "rollup-wasm-loader.cjs");
const useRollupWasm = process.platform === "win32" && process.arch === "arm64";
// The loader path is quoted (and its separators normalized) because
// NODE_OPTIONS is parsed as a command line: unquoted, a checkout under
// `D:\Nueva carpeta\…` splits the option at the space and the wasm loader is
// silently never preloaded — the failure only appears on win32/arm64.
const nodeOptions = [
  process.env.NODE_OPTIONS,
  useRollupWasm ? `--require=${quoteNodeOptionPath(rollupWasmLoader)}` : "",
]
  .filter(Boolean)
  .join(" ");
// A production build must not inherit an ambient NODE_ENV: Vite takes its mode
// from that variable, and mode "test" switches the PWA plugin off, so the
// emitted sw.js carries no precache entries and the bundle-integrity and
// chunk-boundary gates fail on an artifact the code never produced. Pin the
// mode here — the same knob CI's build job sets — instead of trusting the
// environment a caller happens to export.
const run = spawnSync(process.execPath, [VITE_BIN, "build"], {
  stdio: "inherit",
  env: { ...process.env, NODE_ENV: "production", NODE_OPTIONS: nodeOptions },
});
if (run.status !== 0) process.exit(run.status ?? 1);

// ── P0: Secret-scan gate — reject bundles that leak VITE_* provider keys ──
// Vite inlines ALL VITE_* vars into import.meta.env dictionaries.  Even if
// the frontend never reads a key, the literal value ends up in dist/*.js as
// a string constant.  This gate scans every JS asset for the literal
// assignment pattern (e.g. `VITE_GEMINI_API_KEY:"AIza..."`) and blocks
// deployment when a secret is found.  Provider keys should be stored in the
// user's encrypted vault (securityVault) and used directly from the browser;
// the server no longer proxies AI calls.
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

// ── ADR-039: SW integrity embed gate ──────────────────────────────────
// dist/sw.js must embed the hash-verification runtime + manifest, and the
// EMBEDDED BYTES must actually work: this executes the embed in a synthetic
// SW environment and proves (a) the runtime enables against the embedded
// manifest, (b) a genuine shipped asset verifies, (c) a flipped byte is
// rejected. Catches the two failure classes found during development: the
// plugin silently skipping (hook ordering) and the manifest/runtime ASI
// join that made the whole SW throw at eval time.
{
  const swPath = join(ROOT, "dist", "sw.js");
  const sw = readFileSync(swPath, "utf8");
  const START = "// __BMF_SW_INTEGRITY_EMBED_START__";
  const END = "// __BMF_SW_INTEGRITY_EMBED_END__";
  const startIdx = sw.indexOf(START);
  const endIdx = sw.indexOf(END);
  if (
    startIdx !== 0 ||
    endIdx === -1 ||
    (sw.match(/__BMF_SW_INTEGRITY_EMBED_START__/g) ?? []).length !== 1
  ) {
    console.error(
      "[build-ci] FAIL: dist/sw.js missing the ADR-039 integrity embed " +
        "(swIntegrityEmbedPlugin closeBundle did not run or ran twice)",
    );
    process.exit(1);
  }
  const embed = sw.slice(startIdx, endIdx);

  // Extract the embedded manifest (brace-depth scan, string-aware).
  const assignAt = embed.indexOf("self.__BMF_SW_INTEGRITY_MANIFEST__ = ");
  const jsonStart = assignAt === -1 ? -1 : embed.indexOf("{", assignAt);
  if (jsonStart === -1) {
    console.error("[build-ci] FAIL: manifest assignment not found in sw embed");
    process.exit(1);
  }
  let depth = 0;
  let inString = false;
  let escape = false;
  let jsonEnd = -1;
  for (let i = jsonStart; i < embed.length; i++) {
    const ch = embed[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        jsonEnd = i + 1;
        break;
      }
    }
  }
  if (jsonEnd === -1) {
    console.error("[build-ci] FAIL: embedded manifest JSON not terminated");
    process.exit(1);
  }
  let manifest;
  try {
    manifest = JSON.parse(embed.slice(jsonStart, jsonEnd));
  } catch (error) {
    console.error(`[build-ci] FAIL: embedded manifest is not valid JSON: ${error.message}`);
    process.exit(1);
  }
  const entries = Object.keys(manifest.files ?? {});
  if (entries.length === 0) {
    console.error("[build-ci] FAIL: embedded manifest has no files");
    process.exit(1);
  }
  const selfReferential = entries.filter(
    (f) => f === "/index.html" || f === "/sw.js" || f === "/integrity-manifest.json",
  );
  if (selfReferential.length > 0) {
    console.error(
      `[build-ci] FAIL: self-referential entries in embedded manifest: ${selfReferential.join(", ")}`,
    );
    process.exit(1);
  }

  // Execute the embedded runtime against a synthetic SW environment.
  const openedCaches = new Map();
  const fakeSelf = {
    location: { origin: "https://build-ci.local" },
    clients: null,
    caches: {
      keys: async () => [...openedCaches.keys()],
      open: async (name) => {
        if (!openedCaches.has(name)) openedCaches.set(name, new Map());
        const cache = openedCaches.get(name);
        return {
          delete: async (request) => cache.delete(String(request).split("?")[0]),
        };
      },
    },
  };
  class FakeFetchEvent {
    constructor(request) {
      this.request = request;
    }
  }
  // Marker on the pre-patch stub: the runtime wrapper must REPLACE this
  // method, so after eval the marker must be gone from the prototype.
  FakeFetchEvent.prototype.respondWith = function respondWithStub() {};
  FakeFetchEvent.prototype.respondWith.__bmfOriginal = true;
  let api;
  try {
    new Function("self", "FetchEvent", "Response", "crypto", embed)(
      fakeSelf,
      FakeFetchEvent,
      Response,
      globalThis.crypto,
    );
    api = fakeSelf.__BMF_SW_INTEGRITY__;
  } catch (error) {
    console.error(
      `[build-ci] FAIL: embedded SW integrity runtime threw at eval time: ${error.message}`,
    );
    process.exit(1);
  }
  if (!api || api.enabled !== true) {
    console.error("[build-ci] FAIL: embedded SW integrity runtime did not enable");
    process.exit(1);
  }
  if (FakeFetchEvent.prototype.respondWith.__bmfOriginal === true) {
    console.error("[build-ci] FAIL: FetchEvent.respondWith was not wrapped by the embed");
    process.exit(1);
  }

  // Prove genuine verifies and tampering is rejected, using a REAL asset.
  const asset = entries.find((f) => f.startsWith("/assets/") && f.endsWith(".js"));
  if (!asset) {
    console.error("[build-ci] FAIL: no /assets/*.js entry in embedded manifest");
    process.exit(1);
  }
  const good = readFileSync(join(ROOT, "dist", asset));
  const genuineOk = await api.verifyResponse(
    "https://build-ci.local" + asset,
    new Response(good),
  );
  const tampered = Buffer.from(good);
  tampered[0] ^= 0xff;
  const tamperedOk = await api.verifyResponse(
    "https://build-ci.local" + asset,
    new Response(tampered),
  );
  if (!genuineOk || tamperedOk) {
    console.error(
      `[build-ci] FAIL: SW verification verdict wrong for ${asset} ` +
        `(genuineOk=${genuineOk}, tamperedOk=${tamperedOk})`,
    );
    process.exit(1);
  }

  console.log(
    `[build-ci] sw-integrity embed verified: enabled, ${entries.length} files, ` +
      `respondWith wrapped, genuine+tampered verdicts correct (${asset})`,
  );
}

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

// Per-feature budgets: reject a newly large or unclassified lazy feature even
// when the aggregate bundle remains under its global cap.
const featureBudgets = spawnSync(
  process.execPath,
  [join(ROOT, "scripts", "check-feature-budgets.mjs")],
  { stdio: "inherit" },
);
if (featureBudgets.status !== 0) {
  process.exit(featureBudgets.status ?? 1);
}

// Performance budget: static metrics are deterministic build artifacts and
// must fail in the same job as the production build. First interaction is
// measured separately with Chromium against this exact dist/ preview.
const performanceStatic = spawnSync(
  process.execPath,
  [join(ROOT, "scripts", "check-performance-budget.mjs"), "--static-only"],
  { stdio: "inherit" },
);
if (performanceStatic.status !== 0) {
  process.exit(performanceStatic.status ?? 1);
}
