// @vitest-environment node
/**
 * scripts/__tests__/vercel-config.test.mjs
 *
 * vercel.json is the configuration of the host the product is actually served
 * from, and it used to carry neither half of the repo's deployment contract:
 * no `headers` array at all (so production served the landing and the app shell
 * with no CSP, no COEP/COOP, no nosniff and no clickjacking protection, while
 * `check:csp` happily verified the three other copies) and a `/:path*` rewrite
 * that answered EVERY unknown path with the landing page as a 200 — a soft 404
 * for typos, private paths and crawlers alike.
 *
 * Pinned here:
 *   - every header rule carries the full security set with the canonical values
 *     (never only the catch-all: Vercel's merge semantics for overlapping rules
 *     are not documented clearly enough to bet a security header on);
 *   - the three CSP-derived values equal csp-config.js verbatim;
 *   - no rewrite funnels all paths into a page (the soft-404 mechanism);
 *   - the routes that must resolve, resolve — including /capture, the extension
 *     share target the SPA handles at the ROOT (see docs/PRIVACY-EXTENSION.md);
 *   - unknown paths resolve to nothing, so dist/404.html answers with a 404.
 *
 * `resolveRoute` models the subset of Vercel patterns this config uses
 * (exact paths, `(a|b)` alternations, `:path*` and `(.*)`); it is a model of the
 * intent, not a copy of Vercel's matcher — the live status codes still need a
 * deployment to observe.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  COEP,
  COOP,
  CSP_MODERATE,
  CSP_OPEN,
  REPORT_TO_HEADER,
  REPORTING_ENDPOINTS_HEADER,
} from "../csp-config.js";
import { LEGAL_LOCALE_CODES, LOCALIZED_LANDING_CODES } from "../landing-registry.mjs";
import { CAPTURE_ROUTE, pathVariants, shellRoutes } from "../app-routes.mjs";

const ROOT = process.cwd();
const RAW = readFileSync(join(ROOT, "vercel.json"), "utf8");
const CONFIG = JSON.parse(RAW);

/** The header contract every rule must repeat (see public/_headers' rationale). */
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  "Cross-Origin-Embedder-Policy": COEP,
  "Cross-Origin-Opener-Policy": COOP,
  "Reporting-Endpoints": REPORTING_ENDPOINTS_HEADER,
  "Report-To": REPORT_TO_HEADER,
  "Content-Security-Policy": CSP_MODERATE,
};

const rules = CONFIG.headers ?? [];
const rewrites = CONFIG.rewrites ?? [];

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Vercel `source` → RegExp, for the pattern shapes this config uses. */
function sourceToRegex(source) {
  if (source.includes("(.*)")) {
    const [head, tail] = source.split("(.*)");
    return new RegExp(`^${escapeRe(head)}(.*)${escapeRe(tail)}$`);
  }
  if (source.includes(":path*")) {
    const head = source.replace(/\/:path\*$/, "");
    return new RegExp(`^${escapeRe(head)}(?:/(.*))?$`);
  }
  const group = /\(([^)]+)\)/.exec(source);
  if (group) {
    const [before, after] = source.split(group[0]);
    return new RegExp(`^${escapeRe(before)}(${group[1]})${escapeRe(after)}$`);
  }
  return new RegExp(`^${escapeRe(source)}$`);
}

/** Regular FILES reachable on the deployment (public/ + the SPA shell).
 *  Directories count as non-matches: public/<locale>/ holds the legal pages,
 *  but `/es` itself is served by the rewrite, not by the directory. */
function isFile(path) {
  return existsSync(path) && statSync(path).isFile();
}

function staticFile(pathname) {
  const rel = pathname.replace(/^\//, "");
  // "/" is NOT a directory index any more: there is no public/index.html
  // (the EN landing is landing.html) and no repo-root index.html entry, so
  // the root is resolved by the rewrite below — which is exactly how Vercel
  // resolves it (filesystem first, then rewrites, then 404).
  if (rel === "") return isFile(join(ROOT, "public", "index.html")) ? "index.html" : null;
  if (isFile(join(ROOT, "public", rel))) return rel;
  if (isFile(join(ROOT, rel))) return rel; // app.html lives at the repo root
  return null;
}

/** Filesystem first, then the first matching rewrite — null means Vercel 404s. */
function resolveRoute(pathname) {
  const direct = staticFile(pathname);
  if (direct) return direct;
  for (const rule of rewrites) {
    const match = sourceToRegex(rule.source).exec(pathname);
    if (!match) continue;
    const destination = rule.destination.replace(/\$(\d)/g, (_m, g) => match[Number(g)] ?? "");
    return staticFile(destination) ?? destination;
  }
  return null;
}

describe("vercel.json — security header contract", () => {
  it("declares header rules at all (the production host had none)", () => {
    expect(rules.length).toBeGreaterThan(0);
  });

  it("repeats the full security set on every rule", () => {
    for (const rule of rules) {
      const byKey = Object.fromEntries((rule.headers ?? []).map((h) => [h.key, h.value]));
      for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
        expect(byKey[key], `${rule.source}: ${key}`).toBe(value);
      }
    }
  });

  it("carries the canonical CSP and reporting values verbatim", () => {
    const byKey = Object.fromEntries(rules[0].headers.map((h) => [h.key, h.value]));
    expect(byKey["Content-Security-Policy"]).toBe(CSP_MODERATE);
    expect(byKey["Report-To"]).toBe(REPORT_TO_HEADER);
    expect(byKey["Reporting-Endpoints"]).toBe(REPORTING_ENDPOINTS_HEADER);
  });

  it("never ships the development CSP profile", () => {
    expect(RAW).not.toContain(CSP_OPEN);
    expect(JSON.parse(RAW).headers[0].headers[0].value).not.toContain("unsafe-eval");
  });

  it("keeps the private surfaces out of the index", () => {
    const sources = rules.map((r) => r.source);
    for (const source of ["/app", "/app/(.*)", "/capture", "/capture/(.*)", "/offline(.*)"]) {
      expect(sources, `missing noindex rule ${source}`).toContain(source);
    }
    for (const rule of rules.filter((r) => r.source !== "/(.*)")) {
      expect(
        rule.headers.filter((h) => h.key === "X-Robots-Tag" && h.value === "noindex").length,
      ).toBeGreaterThan(0);
    }
  });
});

describe("vercel.json — routing contract", () => {
  it("has no catch-all rewrite (the old soft 404)", () => {
    for (const rule of rewrites) {
      const matchesEverything = sourceToRegex(rule.source).test("/no-such-page-lol");
      expect(
        !matchesEverything || !["/index.html", "/landing.html"].includes(rule.destination),
        `${rule.source} → ${rule.destination} answers unknown paths with a 200`,
      ).toBe(true);
    }
  });

  it("ships a 404 page for unmatched routes", () => {
    expect(existsSync(join(ROOT, "public", "404.html"))).toBe(true);
  });

  it("routes every declared client route to the SPA shell", () => {
    // The route table is the app's own (AppRoutes.tsx) — see app-routes.mjs and
    // the four-host gate in scripts/check-spa-routes.mjs. Asserting the parsed
    // list here means a new route cannot be added to the app and forgotten in
    // vercel.json, which is how /bookmarks, /settings and /chat were 404s on a
    // cold load while only /app and /capture were rewired.
    for (const route of shellRoutes()) {
      for (const variant of pathVariants(route)) {
        expect(resolveRoute(variant), `vercel.json: ${variant}`).toBe("app.html");
      }
    }
    // /capture is resolved in App.tsx before the router mounts (not in
    // AppRoutes.tsx), so it is the one route the parser cannot see.
    expect(shellRoutes()).toContain(CAPTURE_ROUTE);
  });

  it("does not invent routes the app never declares", () => {
    // Subtrees are not claimed: /app/settings is not a route (the router's
    // declared paths are flat), so it 404s instead of silently rendering the
    // dashboard and hiding a broken link.
    expect(resolveRoute("/app/settings")).toBeNull();
    expect(resolveRoute("/capture/deep")).toBeNull();
  });

  it("serves every localized landing at its clean URL", () => {
    for (const code of LOCALIZED_LANDING_CODES) {
      expect(resolveRoute(`/${code}`), `/${code}`).toBe(`${code}.html`);
      expect(resolveRoute(`/${code}/`), `/${code}/`).toBe(`${code}.html`);
    }
    // EN is the root landing by design: there is no /en route on any host.
    expect(resolveRoute("/en")).toBeNull();
  });

  it("serves the localized legal page, not the landing", () => {
    for (const code of LEGAL_LOCALE_CODES.filter((c) => c !== "en")) {
      expect(resolveRoute(`/${code}/privacy-and-terms`), code).toBe(
        `${code}/privacy-and-terms.html`,
      );
    }
  });

  it("serves the root from the EN landing rewrite, not a directory index", () => {
    const rootRule = rewrites.find((r) => sourceToRegex(r.source).test("/"));
    expect(rootRule, "no rewrite answers /").toBeTruthy();
    expect(rootRule.destination).toBe("/landing.html");
    // The retired copy is unreachable as a file: nothing may answer
    // /index.html with a page — the redirect below is the only rule for it.
    expect(resolveRoute("/index.html")).toBeNull();
  });

  it("retires /index.html with a permanent redirect to the root", () => {
    const rule = (CONFIG.redirects ?? []).find((r) => r.source === "/index.html");
    expect(rule, "vercel.json declares no /index.html redirect").toBeTruthy();
    expect(rule.destination).toBe("/");
    expect(rule.permanent).toBe(true);
  });

  it("keeps the marketing pages reachable at their clean URLs", () => {
    // The root serves the one generated EN landing (landing.html) — the same
    // file nginx, Cloudflare and Netlify serve — while the app shell stays at
    // /app.
    expect(resolveRoute("/")).toBe("landing.html");
    expect(resolveRoute("/help")).toBe("help.html");
    expect(resolveRoute("/help/")).toBe("help.html");
    expect(resolveRoute("/privacy-and-terms")).toBe("privacy-and-terms.html");
    expect(resolveRoute("/privacy")).toBe("privacy-and-terms.html");
    expect(resolveRoute("/terms")).toBe("privacy-and-terms.html");
    expect(resolveRoute("/pocket-alternative")).toBe("pocket-alternative.html");
    expect(resolveRoute("/offline")).toBe("offline.html");
  });

  it("resolves to nothing — so the 404 page answers — for unknown paths", () => {
    for (const path of [
      "/no-such-page-lol",
      "/pricing",
      "/help/typo",
      "/wp-admin",
      "/es/unknown-page",
      "/en",
    ]) {
      expect(resolveRoute(path), path).toBeNull();
    }
  });

  it("covers every committed HTML page", () => {
    const pages = readdirSync(join(ROOT, "public")).filter((f) => f.endsWith(".html"));
    const unreachable = pages.filter((page) => {
      if (page === "404.html") return false; // served by the platform 404 handler
      const bare = page.replace(/\.html$/, "");
      return resolveRoute(`/${bare}`) === null && resolveRoute(`/${page}`) === null;
    });
    expect(unreachable).toEqual([]);
  });
});
