#!/usr/bin/env node
import { pathToFileURL } from "node:url";

/**
 * scripts/check-hreflang-graph.mjs — verify the hreflang alternate graphs
 * of the 12 localized pages (6 landings + 6 legal) over real HTTP.
 *
 * Applies the same checks an external hreflang validator performs:
 *   1. Every page responds 200 and declares the FULL alternate set
 *      (6 languages + x-default) — nothing missing.
 *   2. Every declared alternate is one of the 12 cluster URLs and
 *      responds 200 — no broken links.
 *   3. Alternates are BIDIRECTIONAL: if A declares B with hreflang X, B
 *      declares A back with the same hreflang (return links).
 *   4. Each page declares itself, and x-default points at the cluster's
 *      canonical page (landings → /, legal → the EN legal page).
 *   5. No cluster crossover: landing alternates only point at landings,
 *      legal alternates only at legal pages.
 *   6. Cross-source: the xhtml:link sets in sitemap.xml agree with the
 *      HTML <head> sets for every one of the 36 URLs (30 landing + 6 legal).
 *
 * Usage:
 *   node scripts/check-hreflang-graph.mjs http://127.0.0.1:4173 --files
 *     Local mode: resolves the clean landing URLs (/fr/) to their file
 *     paths (/fr.html, / → /landing.html) because static dev servers do
 *     not apply the platform 200-rewrites. The legal pages are already
 *     served at their real paths.
 *   node scripts/check-hreflang-graph.mjs https://bookmarkforgeapp.com
 *     Live mode (post-deploy): relies on the real nginx/Cloudflare/Netlify
 *     rewrites, so clean URLs are fetched as-is.
 *
 * Exit code 0 when every check passes; 1 with a per-page failure list.
 */

import {
  LANDING_CODES,
  LEGAL_LOCALE_CODES,
} from "./landing-registry.mjs";

const BASE = (process.argv[2] ?? "http://127.0.0.1:4173").replace(/\/+$/, "");
const FILES_MODE = process.argv.includes("--files");

/** Languages of each hreflang cluster — both owned by the locale registry:
 * the landing set (30) so it can never lag the generated pages, and the legal
 * set (the six reviewed primaries, see LEGAL_LOCALE_CODES there) so the
 * cluster cannot be widened or narrowed without the legal surfaces following.
 * The legal PAGES exist for every locale (check-sitemap-coverage); only these
 * six are reviewed by hand, which is why the completeness check below is
 * per-cluster rather than one shared list. */
const LEGAL_LANGS = LEGAL_LOCALE_CODES;
/** Expected hreflang set per cluster — the completeness check is per-cluster. */
const EXPECTED_LANGS = { landing: LANDING_CODES, legal: LEGAL_LANGS };

/** The two hreflang clusters: paths + the canonical x-default target. */
export const CLUSTERS = {
  landing: {
    paths: LANDING_CODES.map((c) => (c === "en" ? "/" : `/${c}/`)),
    xDefault: "/",
  },
  legal: {
    paths: LEGAL_LANGS.map((c) =>
      c === "en" ? "/privacy-and-terms.html" : `/${c}/privacy-and-terms.html`,
    ),
    xDefault: "/privacy-and-terms.html",
  },
};

/** Language code of a cluster path ("/" → en, "/fr/" → fr, legal likewise). */
export function langOfPath(path) {
  if (path === "/" || path === "/privacy-and-terms.html") {
    return "en";
  }
  return path.split("/")[1];
}

/** Cluster key ("landing" | "legal") for a path, or null. */
export function clusterOfPath(path) {
  for (const [key, cluster] of Object.entries(CLUSTERS)) {
    if (cluster.paths.includes(path)) {
      return key;
    }
  }
  return null;
}

/** Local-mode resolution of a clean URL path to its static file path. */
export function resolvePath(path, filesMode) {
  if (!filesMode) {
    return path;
  }
  if (path === "/") {
    return "/landing.html";
  }
  if (path.endsWith("/") && !path.includes("privacy-and-terms")) {
    return `/${path.split("/")[1]}.html`;
  }
  return path;
}

/** Extract the hreflang alternates of an HTML document OR a sitemap <url>
 *  block: Map(hreflang → path). Handles both <link ...> and
 *  <xhtml:link ... /> syntax, and normalizes hrefs to pathnames. */
export function parseAlternates(html) {
  const alternates = new Map();
  const re = /<(?:link|xhtml:link)\s+rel="alternate"\s+hreflang="([^"]+)"\s+href="([^"]+)"/g;
  for (const m of html.matchAll(re)) {
    let href = m[2];
    try {
      href = new URL(m[2], "https://bookmarkforgeapp.com").pathname;
    } catch {
      // keep as-is; the graph check will flag it as out-of-cluster
    }
    alternates.set(m[1], href);
  }
  return alternates;
}

/** Fetch one resolved URL; returns { status, html } (html "" on failure). */
async function fetchPage(base, path) {
  try {
    const res = await fetch(`${base}${path}`, { redirect: "follow" });
    return { status: res.status, html: await res.text() };
  } catch {
    return { status: 0, html: "" };
  }
}

async function main() {
  const failures = [];
  const pages = new Map(); // clusterPath → { status, alternates }

  for (const cluster of Object.values(CLUSTERS)) {
    for (const path of cluster.paths) {
      const { status, html } = await fetchPage(BASE, resolvePath(path, FILES_MODE));
      pages.set(path, { status, alternates: status === 200 ? parseAlternates(html) : new Map() });
    }
  }

  for (const [clusterKey, cluster] of Object.entries(CLUSTERS)) {
    for (const path of cluster.paths) {
      const page = pages.get(path);
      const label = `[${clusterKey}] ${path}`;
      if (page.status !== 200) {
        failures.push(`${label}: HTTP ${page.status} (fetch failed)`);
        continue;
      }
      const alts = page.alternates;

      // 1. Full alternate set: every cluster language + x-default.
      const missing = EXPECTED_LANGS[clusterKey].filter((l) => !alts.has(l));
      if (missing.length > 0 || !alts.has("x-default")) {
        failures.push(
          `${label}: incomplete alternate set (missing ${[...missing, !alts.has("x-default") ? "x-default" : ""].filter(Boolean).join(", ")})`,
        );
      }

      // 4. Self-reference.
      const self = alts.get(langOfPath(path));
      if (self !== path) {
        failures.push(`${label}: self alternate hreflang="${langOfPath(path)}" must point to ${path} (found ${self ?? "none"})`);
      }

      // 5. x-default per cluster.
      if (alts.get("x-default") !== cluster.xDefault) {
        failures.push(`${label}: x-default must point to ${cluster.xDefault} (found ${alts.get("x-default") ?? "none"})`);
      }

      // 2/3/5. Every alternate: in-cluster, reachable, symmetric.
      for (const [hreflang, target] of alts) {
        if (clusterOfPath(target) !== clusterKey) {
          failures.push(`${label}: hreflang="${hreflang}" points outside the ${clusterKey} cluster (${target})`);
          continue;
        }
        const targetPage = pages.get(target);
        if (targetPage.status !== 200) {
          failures.push(`${label}: alternate hreflang="${hreflang}" is broken (${target} → HTTP ${targetPage.status})`);
          continue;
        }
        // Return link: the target must declare the SOURCE's language back
        // to the source (A declares es→/es/, so /es/ must declare en→A).
        const sourceLang = langOfPath(path);
        const back = targetPage.alternates.get(sourceLang);
        if (back !== path) {
          failures.push(
            `${label}: alternates are not bidirectional — ${target} must declare hreflang="${sourceLang}" back to ${path} (found ${back ?? "none"})`,
          );
        }
      }
    }
  }

  // 6. Cross-source: sitemap.xml xhtml:link sets must match the HTML sets.
  const { status: smStatus, html: smHtml } = await fetchPage(BASE, resolvePath("/sitemap.xml", FILES_MODE));
  if (smStatus !== 200) {
    failures.push(`sitemap.xml: HTTP ${smStatus} (fetch failed)`);
  } else {
    const urlBlocks = [...smHtml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => m[1]);
    for (const [path, page] of pages) {
      const block = urlBlocks.find((b) => {
        const locMatch = b.match(/<loc>([^<]+)<\/loc>/);
        if (!locMatch) {
          return false;
        }
        try {
          return new URL(locMatch[1]).pathname === path;
        } catch {
          return false;
        }
      });
      if (!block) {
        failures.push(`sitemap.xml: missing <url> block for ${path}`);
        continue;
      }
      const smAlts = parseAlternates(block);
      const mismatch = [...new Set([...page.alternates.keys(), ...smAlts.keys()])].filter(
        (hl) => smAlts.get(hl) !== page.alternates.get(hl),
      );
      if (mismatch.length > 0) {
        failures.push(`sitemap.xml: ${path} xhtml:link set differs from HTML for hreflang(s): ${mismatch.join(", ")}`);
      }
    }
  }

  if (failures.length > 0) {
    for (const f of failures) {
      console.error(`[check-hreflang-graph] FAIL ${f}`);
    }
    console.error(`[check-hreflang-graph] ${failures.length} violation(s) against ${BASE} (files-mode: ${FILES_MODE})`);
    process.exit(1);
  }
  console.log(
    `[check-hreflang-graph] ok  ${pages.size} pages, ${pages.size * 7} alternates, bidirectional graphs intact (${BASE}, files-mode: ${FILES_MODE})`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}