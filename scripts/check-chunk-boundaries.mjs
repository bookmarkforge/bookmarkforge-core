/**
 * scripts/check-chunk-boundaries.mjs — P60 chunk-boundary guard.
 *
 * Several source comments (src/components/app/AppContent.tsx, index.ts,
 * ErrorBoundary.tsx, InlineSecurityIcons.tsx, SecurityManager.tsx) claim a
 * "P60 build guard + CI smoke check" exists that fails the build if:
 *
 *   1. the ui-runtime vendor chunk (lucide-react + motion/react, ~910 kB)
 *      ever regresses into the eagerly-loaded shell — the entry chunk and
 *      the pre-unlock screens (SecurityManager / SecurityConfirmation),
 *      which must stay lean and dependency-free for first paint and the
 *      security gate;
 *   2. the eagerly-loaded chains (entry, pre-unlock, post-unlock shell)
 *      exceed their size budgets — so a heavy vendor can never sneak back
 *      into the critical path;
 *   3. the React runtime (hooks dispatcher + reconciler internals) is
 *      duplicated across chunks — two copies of React break hooks/context;
 *   4. the service-worker precache contains heavy optional vendors
 *      (editor, PDF, export, local-AI, emoji, locales) that vite.config.ts
 *      deliberately excludes via globIgnores — precaching them forces every
 *      visitor to download multi-MB bundles they may never use;
 *   5. blocknote, pdfjs-dist and recharts never reach the pre-unlock static
 *      chain (entry + SecurityManager + SecurityConfirmation) — they are
 *      lazy/tree-shaken by design (see Chunk budgets section),
 *      so any static import into the critical path is a regression;
 *   6. the lazy blocknote-mantine and recharts CategoricalChart chunks stay
 *      within their measured size caps — a tree-shaking regression (a
 *      barrel import pulling unused charts, or an optional blocknote module
 *      entering the graph) adds hundreds of KB silently.
 *
 * That guard never existed. This script is it.
 *
 * How it works:
 *   - Walks dist/assets/*.js, builds the static (non-dynamic) import graph
 *     from `from"./x.js"` / `import"./x.js"` statements.
 *   - Marks a chunk as "ui-runtime" if its code contains markers unique to
 *     lucide-react or motion/react (the icon factory and animation runtime).
 *   - Marks a chunk as "heavy vendor" by CONTENT markers (not filename), so
 *     the check survives rolldown renaming chunks (the pdfjs->pdf rename
 *     that previously slipped a 427 kB chunk into the precache).
 *   - Verifies protected roots never statically reach ui-runtime; enforces
 *     size budgets per eager chain; asserts the React dispatcher definition
 *     lives in exactly one chunk; and cross-checks the generated sw.js
 *     precache manifest against the heavy-vendor markers.
 *
 * Exit code is non-zero when any invariant is violated. Wired into
 * `npm run check` (which runs after the production build in CI) and run
 * automatically by `build:ci`.
 *
 * FAILS CLOSED when `dist/` is missing: the invariants cannot be verified
 * without a build, so the default is exit 1 with an actionable message —
 * never a silent pass. `build:ci` reinforces the same rule with an
 * explicit `--require-dist`.
 *
 * The one sanctioned skip is the explicit `--allow-missing-dist` flag,
 * which the `check:chunks` script (called by the source-level `npm run
 * check` aggregate) passes by name: that aggregate must stay runnable on a
 * fresh checkout with no build. The skip is reported as `status=skip` in
 * stdout, `--json` and the step summary, so it is always visible. The flag
 * is REFUSED whenever `CI` is set — in CI a production build is always
 * expected, so a missing `dist/` is a hard failure regardless of flags.
 *
 * Output modes:
 *   - Default (human): one line per check on stdout, FAIL/SKIP on stderr,
 *     exit code 0 (pass/skip) or 1 (fail).
 *   - `--json`: emits a single JSON document on stdout — one structured
 *     record per invariant ({id, label, status, detail, checks}) plus
 *     metrics and overall status — while the human-readable lines move to
 *     stderr so stdout stays machine-parseable (e.g. `| jq .`).
 *   - `GITHUB_STEP_SUMMARY` env var (set on every GitHub Actions step):
 *     appends a markdown table of all invariants to the step summary, in
 *     both human and `--json` modes, so the gate reports per-invariant
 *     results on every CI run without extra wiring.
 */
import { appendFileSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const ASSETS = join(ROOT, "dist", "assets");
const SW = join(ROOT, "dist", "sw.js");

// Fail closed by default: with no build there is nothing to verify, so a
// missing dist/ is a hard failure. `build:ci` also passes --require-dist to
// state that intent at the call site. --allow-missing-dist is the single,
// auditable opt-out, used only by the source-level `npm run check` aggregate
// (see the header); it is refused whenever CI is set.
const REQUIRE_DIST = process.argv.includes("--require-dist");
const ALLOW_MISSING_DIST = process.argv.includes("--allow-missing-dist");
const CI_ENV = Boolean(process.env.CI);

// ---------------------------------------------------------------------------
// Budgets. Current build (Aug 2026): entry 0.51 MB, unlock 0.15 MB,
// mainApp 1.35 MB, precache total ~9.18 MB. Thresholds leave ~2–3x headroom so
// legitimate growth never trips them, but a heavy vendor entering the eager
// path (or the precache) fails loudly.
// ---------------------------------------------------------------------------
const ENTRY_BUDGET = 1.5 * 1024 * 1024; // entry static closure
const UNLOCK_BUDGET = 1.0 * 1024 * 1024; // SecurityManager / SecurityConfirmation closure
const MAINAPP_BUDGET = 3.0 * 1024 * 1024; // post-unlock shell closure
const PRECACHE_BUDGET = 10 * 1024 * 1024; // total sw.js precache payload
const ORT_WASM_BUDGET = 25 * 1024 * 1024; // ort-wasm lazy asset cap (~23.5 MB baseline)

const JSON_MODE = process.argv.includes("--json");
const SUMMARY_FILE = process.env.GITHUB_STEP_SUMMARY || null;

const INV_UI_RUNTIME = { id: 1, label: "no ui-runtime in entry / pre-unlock chain" };
const INV_BUDGETS = { id: 2, label: "eager chain size budgets" };
const INV_REACT = { id: 3, label: "React runtime not duplicated" };
const INV_PRECACHE = { id: 4, label: "sw.js precache has no heavy optional vendors" };
const INV_PREUNLOCK_HEAVY = { id: 5, label: "no blocknote/pdfjs/recharts in pre-unlock static chain" };
const INV_LAZY_VENDOR = { id: 6, label: "lazy vendor chunk caps (blocknote/recharts)" };
const INV_ORT_WASM = { id: 7, label: "ort-wasm size budget" };

// Structured report. In human mode only the invariants/metrics/errors are
// collected and never printed as JSON; in --json mode the whole document is
// emitted on stdout at the end.
const report = {
  tool: "check-chunk-boundaries",
  status: "pass", // pass | fail | skip
  requireDist: REQUIRE_DIST,
  allowMissingDist: ALLOW_MISSING_DIST,
  ciEnv: CI_ENV,
  distPresent: existsDir(ASSETS),
  reason: null, // set when status === "skip"
  invariants: [],
  metrics: {},
  errors: [],
};

function reportInvariant(inv, status, detail, checks) {
  report.invariants.push({
    id: inv.id,
    label: inv.label,
    status,
    detail,
    ...(checks && checks.length > 0 ? { checks } : {}),
  });
}

function reportMetric(key, value) {
  report.metrics[key] = value;
}

// Human "ok" lines: stdout by default, stderr in --json mode so stdout
// carries only the JSON document.
function log(msg) {
  if (JSON_MODE) console.error(msg);
  else console.log(msg);
}

function markdownSummary() {
  const icon = { pass: "✅", fail: "❌", skip: "⏭️" };
  const lines = ["## 🧱 P60 chunk-boundary gate"];
  const head =
    report.status === "skip"
      ? `SKIP${report.reason ? ` — ${report.reason}` : ""}`
      : report.status.toUpperCase();
  lines.push(`**Result:** ${icon[report.status] ?? ""} ${head}`);
  if (report.invariants.length > 0) {
    lines.push("", "| # | Invariant | Status | Detail |", "|---| --- | --- | --- |");
    for (const inv of report.invariants) {
      lines.push(
        `| ${inv.id} | ${inv.label} | ${icon[inv.status] ?? inv.status} | ${(inv.detail ?? "").replaceAll("|", "\\|")} |`,
      );
    }
  }
  const metricEntries = Object.entries(report.metrics);
  if (metricEntries.length > 0) {
    lines.push("", `**Metrics:** ${metricEntries.map(([k, v]) => `${k}=${v}`).join(" · ")}`);
  }
  if (report.errors.length > 0) {
    lines.push("", "**Errors:**", ...report.errors.map((e) => `- \`${e}\``));
  }
  lines.push("");
  return lines.join("\n");
}

function writeSummaryIfCi() {
  if (!SUMMARY_FILE) return;
  try {
    appendFileSync(SUMMARY_FILE, markdownSummary(), "utf8");
  } catch (err) {
    console.error(
      `[check-chunk-boundaries] WARN: could not write GITHUB_STEP_SUMMARY: ${err.message}`,
    );
  }
}

// Flush the JSON document (and the step summary) before exiting, so a
// pipe/CI consumer never sees truncated output. The stdout write is
// SYNCHRONOUS (writeFileSync to fd 1) on purpose: fail()/SKIP call
// process.exit right after, and an async process.stdout.write callback
// would let the top-level script keep running and crash on the next
// readFileSync/readdirSync (ENOENT) before the document flushes.
function emitReport(onDone) {
  if (!JSON_MODE) {
    writeSummaryIfCi();
    onDone?.();
    return;
  }
  writeFileSync(1, `${JSON.stringify(report, null, 2)}\n`);
  writeSummaryIfCi();
  onDone?.();
}

function fail(message, inv, checks) {
  if (inv) reportInvariant(inv, "fail", message, checks);
  report.errors.push(message);
  report.status = "fail";
  console.error(`[check-chunk-boundaries] FAIL: ${message}`);
  emitReport(() => process.exit(1));
}

if (!existsDir(ASSETS)) {
  // Fail closed: only the explicit --allow-missing-dist opt-out, outside CI,
  // may turn a missing build into a reported skip.
  const maySkip = ALLOW_MISSING_DIST && !CI_ENV && !REQUIRE_DIST;
  if (!maySkip) {
    fail(
      "dist/assets not found — the chunk-boundary invariants cannot be verified without a " +
        "build. Run `npm run build:ci` (or `npm run build`) first. " +
        "`--allow-missing-dist` downgrades this to an explicit, exit-0 skip; it is refused in CI.",
    );
  }
  report.status = "skip";
  report.reason =
    "dist/assets not found — explicit --allow-missing-dist outside CI (no build to analyze)";
  console.warn(
    "[check-chunk-boundaries] SKIP: dist/assets not found — nothing to analyze. " +
      "This skip is EXPLICIT (--allow-missing-dist, outside CI) and is reported as " +
      "status=skip; the gate fails closed for every other caller. " +
      "Run `npm run build:ci` first to actually enforce the chunk boundaries.",
  );
  emitReport(() => process.exit(0));
}

const files = readdirSync(ASSETS).filter((f) => f.endsWith(".js") || f.endsWith(".mjs"));
if (files.length === 0) {
  fail("dist/assets has no .js chunks");
}

// Static import graph + content cache.
const staticImports = new Map();
const content = new Map();
for (const f of files) {
  const src = readFileSync(join(ASSETS, f), "utf8");
  content.set(f, src);
  staticImports.set(
    f,
    [...src.matchAll(/(?:from|import)"\.\/([^"]+\.js)"/g)].map((m) => m[1]),
  );
}

const sizeOf = (f) => statSync(join(ASSETS, f)).size;

// ---------------------------------------------------------------------------
// Invariant 1 — ui-runtime must never leak into the eager shell.
// ---------------------------------------------------------------------------
const UI_MARKERS = [/\blucide\b/i, /AnimatePresence/, /\buseAnimation\b/, /motion\.react/];
const isUiRuntime = (f) => UI_MARKERS.some((re) => re.test(content.get(f)));
const uiChunks = files.filter(isUiRuntime);
if (uiChunks.length === 0) {
  fail(
    "no ui-runtime chunk detected — check the UI_MARKERS regex against the build output",
    INV_UI_RUNTIME,
  );
}

// Protected roots: entry + pre-unlock security screens. Some prefixes have
// MORE than one chunk (SecurityManager ships a 79 B re-export wrapper next
// to the real 12 kB chunk), so protect every chunk matching each prefix — a
// leak into any variant must fail the build.
const entry = files.find((f) => f.startsWith("index-"));
const securityManagerChunks = files.filter((f) => f.startsWith("SecurityManager-"));
const securityConfirmationChunks = files.filter((f) => f.startsWith("SecurityConfirmation-"));

if (!entry) fail("entry chunk (index-*.js) not found", INV_UI_RUNTIME);
if (securityManagerChunks.length === 0) fail("SecurityManager chunk not found", INV_UI_RUNTIME);
if (securityConfirmationChunks.length === 0) fail("SecurityConfirmation chunk not found", INV_UI_RUNTIME);

function closure(root) {
  const seen = new Set([root]);
  const queue = [root];
  while (queue.length) {
    const cur = queue.shift();
    for (const dep of staticImports.get(cur) ?? []) {
      if (!seen.has(dep)) {
        seen.add(dep);
        queue.push(dep);
      }
    }
  }
  return seen;
}

// Sanity guard: the static-import regex must actually resolve the graph.
// If rolldown ever changes how it emits static imports (quoting, path form),
// the parser would produce trivial closures and every check below would pass
// vacuously. Fail loudly instead — fail-closed philosophy throughout.
const entryClosure = closure(entry);
if (entryClosure.size < 10) {
  fail(
    `entry static closure looks broken (only ${entryClosure.size} chunk(s)) — ` +
      "the static-import parser may not match this rolldown output",
    INV_UI_RUNTIME,
  );
}

let leaked = 0;
const protectedGroups = [
  ["entry", [entry]],
  ["SecurityManager", securityManagerChunks],
  ["SecurityConfirmation", securityConfirmationChunks],
];
const checks1 = [];
for (const [label, chunks] of protectedGroups) {
  for (const root of chunks) {
    const reachable = closure(root);
    const leaks = [...reachable].filter((f) => uiChunks.includes(f) && f !== root);
    if (leaks.length > 0) {
      leaked += leaks.length;
      checks1.push({
        name: `${label} (${root})`,
        status: "fail",
        detail: `statically imports ui-runtime: ${leaks.join(", ")}`,
      });
      console.error(
        `[check-chunk-boundaries] LEAK: ${label} (${root}) statically imports ui-runtime: ${leaks.join(", ")}`,
      );
    } else {
      checks1.push({
        name: `${label} (${root})`,
        status: "pass",
        detail: `clean (${reachable.size} chunks in static chain)`,
      });
      log(`[check-chunk-boundaries] ok ${label} (${root}): clean (${reachable.size} chunks in static chain)`);
    }
  }
}
if (leaked > 0) {
  fail(`${leaked} ui-runtime chunk(s) leaked into protected roots`, INV_UI_RUNTIME, checks1);
}
reportInvariant(INV_UI_RUNTIME, "pass", "no ui-runtime in entry / pre-unlock chain", checks1);
log("[check-chunk-boundaries] ok: no ui-runtime in entry / pre-unlock chain");

// ---------------------------------------------------------------------------
// Invariant 2 — eager chain size budgets. A vendor must never grow the
// critical path past its budget (the 2.26 MB entry chain regression would
// trip this today).
// ---------------------------------------------------------------------------
const mainApp = files.find((f) => f.startsWith("MainApp-"));
if (!mainApp) fail("MainApp chunk not found", INV_BUDGETS);

// Union closure across every chunk of a protected prefix, so a budget blowup
// in any variant (e.g. the SecurityManager wrapper) is caught too.
function groupClosure(chunks) {
  const union = new Set();
  for (const c of chunks) for (const f of closure(c)) union.add(f);
  return union;
}
function chainBytes(chunksOrRoot) {
  const set = chunksOrRoot instanceof Set ? chunksOrRoot : closure(chunksOrRoot);
  let total = 0;
  for (const f of set) total += sizeOf(f);
  return total;
}

const budgets = [
  ["entry", [entry], ENTRY_BUDGET, "entry"],
  ["unlock (SecurityManager)", securityManagerChunks, UNLOCK_BUDGET, "unlockSecurityManager"],
  ["unlock (SecurityConfirmation)", securityConfirmationChunks, UNLOCK_BUDGET, "unlockSecurityConfirmation"],
  ["post-unlock (MainApp)", [mainApp], MAINAPP_BUDGET, "postUnlockMainApp"],
];
let overBudget = 0;
const checks2 = [];
for (const [label, chunks, budget, slug] of budgets) {
  const bytes = chainBytes(groupClosure(chunks));
  const mb = (bytes / 1024 / 1024).toFixed(2);
  const cap = (budget / 1024 / 1024).toFixed(2);
  reportMetric(`${slug}MB`, Number(mb));
  reportMetric(`${slug}BudgetMB`, Number(cap));
  if (bytes > budget) {
    overBudget++;
    checks2.push({ name: label, status: "fail", detail: `${mb} MB (cap ${cap} MB)` });
    console.error(
      `[check-chunk-boundaries] BUDGET: ${label} static chain is ${mb} MB (cap ${cap} MB)`,
    );
  } else {
    checks2.push({ name: label, status: "pass", detail: `${mb} MB (cap ${cap} MB)` });
    log(`[check-chunk-boundaries] ok ${label}: ${mb} MB (cap ${cap} MB)`);
  }
}
if (overBudget > 0) {
  fail(`${overBudget} eager chain(s) over budget — a heavy vendor may have become eager`, INV_BUDGETS, checks2);
}
reportInvariant(INV_BUDGETS, "pass", "all eager chains within budget", checks2);

// ---------------------------------------------------------------------------
// Invariant 3 — React runtime must not be duplicated.
// The React hooks dispatcher definition (`readContext:<id>,use:`) is emitted
// exactly once by rolldown (inside the single client-*/react-* runtime
// chunk). Two chunks carrying it means React was bundled twice — which
// silently breaks hooks/context — so fail.
// ---------------------------------------------------------------------------
const REACT_DISPATCHER = /readContext:[A-Za-z_$]+(?:,use:)?/;
const reactRuntimeChunks = files.filter((f) => REACT_DISPATCHER.test(content.get(f)));
if (reactRuntimeChunks.length === 0) {
  fail(
    "no chunk carries the React dispatcher definition — the REACT_DISPATCHER marker " +
      "no longer matches this React/rolldown output (fail-closed)",
    INV_REACT,
  );
}
if (reactRuntimeChunks.length > 1) {
  fail(
    `React runtime appears in ${reactRuntimeChunks.length} chunks: ${reactRuntimeChunks.join(", ")} — ` +
      "React is duplicated, hooks/context will break",
    INV_REACT,
  );
}
reportMetric("reactRuntimeChunks", reactRuntimeChunks.length);
reportInvariant(INV_REACT, "pass", `single runtime (${reactRuntimeChunks[0]})`);
log(`[check-chunk-boundaries] ok React: single runtime (${reactRuntimeChunks[0]})`);

// ---------------------------------------------------------------------------
// Invariant 4 — sw.js precache must not contain heavy optional vendors.
// Content markers (not filenames) so the check survives chunk renames. These
// mirror the globIgnores intent in vite.config.ts; keep both in sync.
// ---------------------------------------------------------------------------
// Markers must hit strings that exist ONLY inside the vendor implementation,
// never in the app-side wrapper chunks (which mention the public API, e.g.
// `html2canvas:{scale:2}` in export options, `GlobalWorkerOptions` in the
// PdfUploader shim, `CreateMLCEngine` in the WebLLM service shim). The
// MIN_VENDOR_SIZE floor is the second discriminator: every real heavy vendor
// is >= 400 kB while every wrapper is <= 40 kB, so the floor is safe even if
// a vendor marker string leaks into a large app chunk.
const HEAVY_VENDOR_MARKERS = [
  ["blocknote editor", /ProseMirror-widget/],
  ["html2pdf/export", /data-html2canvas-debug/],
  ["pdfjs viewer", /GlobalWorkerOptions/],
  ["WebLLM", /CreateMLCEngine|MLCEngine\.reload/],
  ["transformers.js", /experimental_transformers/],
  ["emoji dataset", /id:`people`,emoji/],
];
const MIN_VENDOR_SIZE = 200 * 1024; // 200 kB — every heavy vendor exceeds this

function heavyVendorOf(f) {
  const src = content.get(f);
  if (sizeOf(f) < MIN_VENDOR_SIZE) return null;
  for (const [label, re] of HEAVY_VENDOR_MARKERS) {
    if (re.test(src)) return label;
  }
  return null;
}

if (!existsFile(SW)) {
  fail("dist/sw.js not found — run the production build first", INV_PRECACHE);
}
const sw = readFileSync(SW, "utf8");
// Format: precacheAndRoute([{url:"...",revision:...},...],{options})
// The array closes with `],` before the trailing options object.
const precacheBlock = sw.match(/precacheAndRoute\(\[([\s\S]*?)\]\s*,\s*\{/);
if (!precacheBlock) {
  fail("could not locate precacheAndRoute([...]) in sw.js — sw.js format changed?", INV_PRECACHE);
}
const precached = [...precacheBlock[1].matchAll(/url:"([^"]+)"/g)].map((m) => m[1]);
if (precached.length < 50) {
  fail(`precache parse looks broken — only ${precached.length} entries found`, INV_PRECACHE);
}

// Files the manifest points at under assets/ — compare by content. .mjs
// chunks (e.g. pdf.worker.min-*.mjs) are loaded into the content map too so
// a worker vendor sneaking into the precache is caught as well.
const precachedAssets = precached.filter(
  (u) => u.startsWith("assets/") && /\.[cm]?js$/.test(u),
);
const heavyInPrecache = [];
for (const u of precachedAssets) {
  const file = u.slice("assets/".length);
  if (!content.has(file)) continue;
  const vendor = heavyVendorOf(file);
  if (vendor) heavyInPrecache.push(`${file} (${vendor})`);
}
if (heavyInPrecache.length > 0) {
  fail(
    `precache contains heavy optional vendor chunk(s): ${heavyInPrecache.join(", ")} — ` +
      "add the filename pattern to globIgnores in vite.config.ts or fix the split",
    INV_PRECACHE,
  );
}
log(`[check-chunk-boundaries] ok precache: no heavy vendor (${precached.length} entries, ${precachedAssets.length} js assets)`);

// Total precache payload budget — catches gross bloat even if a vendor has
// no content marker match yet.
let precacheBytes = 0;
let ortWasmBytes = 0;
for (const u of precached) {
  try {
    const b = statSync(join(ROOT, "dist", u)).size;
    precacheBytes += b;
    if (u.includes("ort-wasm")) ortWasmBytes += b;
  } catch {
    /* url may be a cross-origin or manifest-only entry — ignore */
  }
}
// ort-wasm is usually lazy-loaded, so also count ort-wasm assets under
// dist/assets/ even when they are not in the precache manifest.
if (ortWasmBytes === 0) {
  try {
    for (const f of readdirSync(ASSETS)) {
      if (f.includes("ort-wasm")) {
        ortWasmBytes += statSync(join(ASSETS, f)).size;
      }
    }
  } catch {
    // ignore missing dist/ here; the top-level skip/hard-failure handles it
  }
}
const precacheMb = (precacheBytes / 1024 / 1024).toFixed(2);
if (precacheBytes > PRECACHE_BUDGET) {
  fail(
    `precache payload is ${precacheMb} MB (cap ${(PRECACHE_BUDGET / 1024 / 1024).toFixed(2)} MB)`,
    INV_PRECACHE,
  );
}
reportMetric("precacheEntries", precached.length);
reportMetric("precacheJsAssets", precachedAssets.length);
reportMetric("precacheMB", Number(precacheMb));
reportMetric("precacheBudgetMB", PRECACHE_BUDGET / 1024 / 1024);
reportMetric("ortWasmMB", Number((ortWasmBytes / 1024 / 1024).toFixed(2)));
reportMetric("ortWasmBytes", ortWasmBytes);
if (ortWasmBytes > ORT_WASM_BUDGET) {
  fail(
    `ort-wasm asset is ${(ortWasmBytes / 1024 / 1024).toFixed(2)} MB (cap ${(ORT_WASM_BUDGET / 1024 / 1024).toFixed(2)} MB)`,
    INV_ORT_WASM,
  );
}
reportInvariant(
  INV_ORT_WASM,
  "pass",
  `ort-wasm ${(ortWasmBytes / 1024 / 1024).toFixed(2)} MB (cap ${(ORT_WASM_BUDGET / 1024 / 1024).toFixed(2)} MB)`,
);
log(`[check-chunk-boundaries] ok ort-wasm: ${(ortWasmBytes / 1024 / 1024).toFixed(2)} MB (cap ${(ORT_WASM_BUDGET / 1024 / 1024).toFixed(2)} MB)`);
reportInvariant(
  INV_PRECACHE,
  "pass",
  `${precached.length} entries, ${precachedAssets.length} js assets, ${precacheMb} MB (cap ${(PRECACHE_BUDGET / 1024 / 1024).toFixed(2)} MB) — no heavy vendor`,
);
log(`[check-chunk-boundaries] ok precache: ${precacheMb} MB (cap ${(PRECACHE_BUDGET / 1024 / 1024).toFixed(2)} MB)`);

// ---------------------------------------------------------------------------
// Invariant 5 — blocknote / pdfjs / recharts must never reach the pre-unlock
// static chain (entry + SecurityManager + SecurityConfirmation).
// These three are deliberately lazy / tree-shaken (verified against the real
// dist/ on 2026-08-14; Chunk budgets & heavy
// dependencies"): @blocknote/mantine ~756K lazy, pdfjs ~420K + 1.3M worker
// lazy, recharts ~288K inside the post-unlock graph. A static import of any
// of them into the critical path would break first-paint / security-gate
// budgets even when the aggregate size caps below still pass (small chains
// can absorb 300-400K without tripping a 1.0-1.5M cap), so check by content
// marker, not by budget.
// ---------------------------------------------------------------------------
// Markers must hit strings that exist ONLY inside the vendor implementation,
// never in app-side wrapper chunks. MIN_VENDOR_SIZE floor protects against
// the app wrappers that legitimately mention the public API (e.g. the
// PdfUploader shim mentions `GlobalWorkerOptions`).
const PREUNLOCK_HEAVY_MARKERS = [
  ["blocknote", /ProseMirror-widget/],
  ["pdfjs", /GlobalWorkerOptions/],
  ["recharts", /setLegendSize/],
];

function preunlockHeavyVendorOf(f) {
  const src = content.get(f);
  if (sizeOf(f) < MIN_VENDOR_SIZE) return null;
  for (const [label, re] of PREUNLOCK_HEAVY_MARKERS) {
    if (re.test(src)) return label;
  }
  return null;
}

// Pre-unlock protected roots: same set Invariant 1 guards. A leak into ANY
// of them (or their static closure) fails.
const preunlockRoots = [
  ["entry", [entry]],
  ["SecurityManager", securityManagerChunks],
  ["SecurityConfirmation", securityConfirmationChunks],
];
const heavyInPreunlock = [];
const checks5 = [];
for (const [label, chunks] of preunlockRoots) {
  for (const root of chunks) {
    const reachable = closure(root);
    for (const f of reachable) {
      const vendor = preunlockHeavyVendorOf(f);
      if (vendor) {
        heavyInPreunlock.push(`${f} (${vendor})`);
        checks5.push({ name: `${label} (${root})`, status: "fail", detail: `${f} is ${vendor}` });
      }
    }
  }
}
if (heavyInPreunlock.length > 0) {
  fail(
    `heavy vendor(s) in pre-unlock static chain: ${heavyInPreunlock.join(", ")} — ` +
      "blocknote/pdfjs/recharts must stay lazy (Chunk budgets policy)",
    INV_PREUNLOCK_HEAVY,
    checks5,
  );
} else {
  reportInvariant(
    INV_PREUNLOCK_HEAVY,
    "pass",
    `no blocknote/pdfjs/recharts in pre-unlock static chain (${preunlockRoots.length} protected roots)`,
    checks5,
  );
  log("[check-chunk-boundaries] ok: no blocknote/pdfjs/recharts in pre-unlock static chain");
}

// ---------------------------------------------------------------------------
// Invariant 6 — lazy vendor chunk size caps.
// blocknote-mantine (756K) and the shared recharts CategoricalChart core
// (288K) must not bloat beyond their measured baselines. Caps = baseline +
// ~15% headroom: a tree-shaking regression (unused charts or optional
// blocknote modules entering the graph) adds hundreds of KB, while a
// dependency patch moves a few KB. Baselines measured 2026-08-14 against
// the real dist/ (blocknote-mantine-u5i31KNQ.js 770,854 B;
// CategoricalChart-D86ycgYG.js 292,677 B).
// ---------------------------------------------------------------------------
const LAZY_VENDOR_CAPS = [
  ["blocknote", /ProseMirror-widget/, 887 * 1024],
  ["recharts", /setLegendSize/, 337 * 1024],
];

const checks6 = [];
let vendorOver6 = 0;
for (const [label, re, budget] of LAZY_VENDOR_CAPS) {
  const found = files.filter(
    (f) => sizeOf(f) >= MIN_VENDOR_SIZE && re.test(content.get(f)),
  );
  if (found.length === 0) {
    fail(
      `lazy vendor chunk "${label}" not found (marker ${re} + ${MIN_VENDOR_SIZE / 1024} kB floor) — ` +
        "build output changed or the vendor was removed; re-verify the split",
      INV_LAZY_VENDOR,
      checks6,
    );
  }
  for (const f of found) {
    const bytes = sizeOf(f);
    const kb = Math.round(bytes / 1024);
    const capKb = Math.round(budget / 1024);
    reportMetric(`lazyVendor${label}KB`, kb);
    if (bytes > budget) {
      vendorOver6 += 1;
      checks6.push({ name: `${label} (${f})`, status: "fail", detail: `${kb} KB (cap ${capKb} KB)` });
      console.error(
        `[check-chunk-boundaries] CAP: ${label} chunk ${f} is ${kb} KB (cap ${capKb} KB) — tree-shaking regression?`,
      );
    } else {
      checks6.push({ name: `${label} (${f})`, status: "pass", detail: `${kb} KB (cap ${capKb} KB)` });
      log(`[check-chunk-boundaries] ok ${label}: ${kb} KB (cap ${capKb} KB)`);
    }
  }
}
if (vendorOver6 > 0) {
  fail(
    `${vendorOver6} lazy vendor chunk(s) over cap — tree-shaking regression or dependency bloat`,
    INV_LAZY_VENDOR,
    checks6,
  );
}
reportInvariant(
  INV_LAZY_VENDOR,
  "pass",
  "blocknote/recharts lazy chunks within caps",
  checks6,
);
log("[check-chunk-boundaries] ok: lazy vendor chunks within caps");

const eagerBytes = chainBytes(entry);
log(
  `[check-chunk-boundaries] entry static chain: ${(eagerBytes / 1024 / 1024).toFixed(2)} MB`,
);
report.status = "pass";
emitReport();
log("[check-chunk-boundaries] ok: all invariants hold");

function existsDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}
function existsFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}
