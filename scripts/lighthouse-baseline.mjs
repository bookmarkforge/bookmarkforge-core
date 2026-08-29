#!/usr/bin/env node
/**
 * scripts/lighthouse-baseline.mjs — Lighthouse baseline measurement.
 *
 * Closes AUDIT-2026-08-29 P-104: `docs/MVP-DEFINITION.md` §3.2 sets
 * Performance ≥ 90 and Core Web Vitals targets, but nothing measured them.
 *
 * What it does:
 *   1. Serves `dist/` (built by `npm run build:ci`) on a local port.
 *   2. Runs Lighthouse (Chrome required) over the app entry.
 *   3. Compares Performance / Accessibility / Best-Practices / SEO scores
 *      and LCP/CLS against the MVP gates.
 *   4. Writes `lighthouse-baseline.json` (gitignored) with full results and
 *      exits non-zero on gate failures.
 *
 * Usage:
 *   npm run build:ci && node scripts/lighthouse-baseline.mjs
 *   node scripts/lighthouse-baseline.mjs --url http://localhost:4173  # skip serving
 *
 * Notes:
 *   - First run establishes the baseline; later runs compare against
 *     `--gate` thresholds (MVP targets), not against the baseline file,
 *     so regressions fail immediately without a two-step workflow.
 */
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const ROOT = process.cwd();
const DIST = join(ROOT, "dist");
const REPORT = join(ROOT, "lighthouse-baseline.json");

// MVP-DEFINITION.md §3.2 gates — keep in sync with that document.
const GATES = {
  performance: 90,
  accessibility: 95, // axe-core E2E enforces AA; Lighthouse a11y is advisory
  "best-practices": 90,
  seo: 90,
  LCP_MS: 2500,
  CLS: 0.1,
};

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain",
};

// ── Static server (SPA fallback to index.html) ──────────────────────
function serveDist(port) {
  return new Promise((resolvePort) => {
    const server = createServer(async (req, res) => {
      try {
        const url = new URL(req.url ?? "/", "http://localhost");
        let path = decodeURIComponent(url.pathname);
        if (path.endsWith("/")) path += "index.html";
        let file = join(DIST, path.replace(/^\/+/, ""));
        if (!file.startsWith(resolve(DIST))) {
          res.writeHead(403).end();
          return;
        }
        if (!existsSync(file) || extname(file) === "") {
          file = join(DIST, "index.html"); // SPA fallback
        }
        const body = await readFile(file);
        res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
        res.end(body);
      } catch {
        res.writeHead(404).end();
      }
    });
    server.listen(port, "127.0.0.1", () => resolvePort(server));
  });
}

// ── Lighthouse runner ───────────────────────────────────────────────
async function runLighthouse(url) {
  const { default: lighthouse } = await import("lighthouse");
  const chromeLauncher = await import("chrome-launcher");

  const chrome = await chromeLauncher.launch({ chromeFlags: ["--headless=new"] });
  try {
    const result = await lighthouse(url, {
      port: chrome.port,
      output: "json",
      logLevel: "error",
      onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
      formFactor: "desktop",
      screenEmulation: { desktop: true, width: 1350, height: 940, deviceScaleFactor: 1, mobile: false },
    });
    return result?.lhr ?? null;
  } finally {
    await chrome.kill();
  }
}

// ── Gate evaluation ─────────────────────────────────────────────────
export function evaluateGates(lhr) {
  const failures = [];
  const scores = {};
  for (const cat of ["performance", "accessibility", "best-practices", "seo"]) {
    const score = Math.round((lhr.categories?.[cat]?.score ?? 0) * 100);
    scores[cat] = score;
    if (score < GATES[cat]) failures.push(`${cat}: ${score} < ${GATES[cat]}`);
  }

  const audits = lhr.audits ?? {};
  const lcp = audits["largest-contentful-paint"]?.numericValue;
  const cls = audits["cumulative-layout-shift"]?.numericValue;
  if (typeof lcp === "number" && lcp > GATES.LCP_MS) {
    failures.push(`LCP: ${Math.round(lcp)}ms > ${GATES.LCP_MS}ms`);
  }
  if (typeof cls === "number" && cls > GATES.CLS) {
    failures.push(`CLS: ${cls} > ${GATES.CLS}`);
  }

  return { scores, lcp: Math.round(lcp ?? 0), cls: cls ?? 0, failures };
}

// ── Main ────────────────────────────────────────────────────────────
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop());

if (isMain) {
  const argUrl = process.argv.find((a) => a.startsWith("--url="));
  let server = null;
  let url;

  if (argUrl) {
    url = argUrl.split("=")[1];
  } else {
    if (!existsSync(join(DIST, "index.html"))) {
      console.error("[lighthouse-baseline] dist/index.html missing — run `npm run build:ci` first");
      process.exit(1);
    }
    const port = 4181;
    server = await serveDist(port);
    url = `http://127.0.0.1:${port}/`;
    console.log(`[lighthouse-baseline] serving dist/ on ${url}`);
  }

  console.log("[lighthouse-baseline] running Lighthouse (desktop)…");
  let lhr;
  try {
    lhr = await runLighthouse(url);
  } finally {
    server?.close();
  }

  if (!lhr) {
    console.error("[lighthouse-baseline] Lighthouse returned no report (Chrome installed?)");
    process.exit(1);
  }

  const { scores, lcp, cls, failures } = evaluateGates(lhr);

  const snapshot = {
    generatedAt: new Date().toISOString(),
    url,
    scores,
    lcpMs: lcp,
    cls,
    gates: GATES,
    failures,
  };
  await writeFile(REPORT, JSON.stringify(snapshot, null, 2), "utf8");

  console.log("\n[lighthouse-baseline] scores:");
  for (const [cat, score] of Object.entries(scores)) {
    const gate = GATES[cat];
    console.log(`  ${cat.padEnd(16)} ${String(score).padStart(3)} / ${gate}  ${score >= gate ? "✓" : "✗"}`);
  }
  console.log(`  LCP              ${String(lcp).padStart(5)}ms / ${GATES.LCP_MS}ms  ${lcp <= GATES.LCP_MS ? "✓" : "✗"}`);
  console.log(`  CLS              ${String(cls).padStart(5)}   / ${GATES.CLS}      ${cls <= GATES.CLS ? "✓" : "✗"}`);
  console.log(`\n  report → ${REPORT}`);

  if (failures.length > 0) {
    console.error(`\n[lighthouse-baseline] GATE FAILURES:\n  - ${failures.join("\n  - ")}`);
    process.exit(1);
  }
  console.log("\n[lighthouse-baseline] all MVP §3.2 gates passed");
}
