#!/usr/bin/env node
/**
 * scripts/app-routes.mjs — the React SPA's host-level route contract.
 *
 * The SPA is a private, noindex app that the four shipped host configs have to
 * serve at four different syntaxes:
 *
 *   1. vercel.json        (the domain the product is served from)
 *   2. public/_redirects  (Cloudflare Pages)
 *   3. netlify.toml       (Netlify)
 *   4. public/nginx.conf  (self-hosted Docker)
 *
 * WHAT GOES TO THE SHELL. Every client route is an ordinary root path — the
 * marketing/SPA split (ADR-039) put the app in dist/app.html, but the router
 * still declares /bookmarks, /settings, /chat, … at the root, and App.tsx
 * resolves /capture before the router even mounts. A cold load, a bookmark or a
 * pasted link to any of those must answer with the shell, or the route only
 * works if the user happened to start at /app and click their way there.
 *
 * WHAT MUST NEVER GO TO THE SHELL. The public surface: the indexable landing at
 * `/` and `/<lang>/`, the legal pages, the Help Center, /offline and the Pocket
 * comparison page. They are static HTML and their own SEO contract
 * (check-seo.mjs); answering them with the private shell would hand a crawler
 * an empty app and hide the marketing page from a visitor's bookmark.
 * scripts/sw-navigation-policy.js encodes the same split for offline
 * navigations — it is the same surface, seen from the service worker.
 *
 * WHY THE ROUTES ARE PARSED, NOT RETYPED. A hand-written list in four configs is
 * exactly the per-layer drift this repo has already been bitten by (the
 * 29-code locale list, the CSP copies, the header set). The client routes are
 * read out of src/components/app/AppRoutes.tsx, and check:spa-routes fails the
 * build when a host config does not serve one of them — so adding a route to
 * the app and forgetting the hosts is a red build, not a 404 in production.
 *
 * Node-core only (no deps): a gate, a CLI and tests all import it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LANDING_CODES } from "./landing-registry.mjs";

/** The precached SPA shell Vite emits from the app.html entry point. */
export const APP_SHELL = "/app.html";

/** Where the client routes are declared (parsed — see the module docs). */
export const APP_ROUTES_SOURCE = "src/components/app/AppRoutes.tsx";

/**
 * The capture entry point. App.tsx decides it before the router mounts
 * (`const isCapture = path === "/capture"`), so it is NOT in AppRoutes.tsx and
 * has to be added here — the browser extension and the share flow link to it.
 */
export const CAPTURE_ROUTE = "/capture";

/**
 * Client routes the HOSTS answer with their own public page instead of the
 * shell. `/` is the indexable landing; /privacy and /terms are the public legal
 * pages. They are declared as client routes too, so in-app navigation keeps
 * working (React Router handles them once the shell is loaded) — only a cold
 * load goes to the static page, which is what every host already did and what
 * sw-navigation-policy.js documents on purpose.
 */
export const HOST_PUBLIC_CLIENT_ROUTES = ["/", "/privacy", "/terms"];

/**
 * Extract the declared client routes from AppRoutes.tsx source.
 *
 * Two spellings cover the whole file: a literal `path="/settings"` and the
 * translated form `path={t("routeSettings", "/settings")}`, whose second
 * argument is the default (and, in every shipped locale, the actual) path.
 * `path="*"` is the router's catch-all redirect, not a URL the host serves.
 *
 * @param {string} source AppRoutes.tsx contents
 * @returns {string[]} sorted, de-duplicated, leading-slash paths
 */
export function extractClientRoutes(source) {
  const routes = new Set();
  for (const match of String(source).matchAll(/\bpath="([^"]+)"/g)) {
    if (match[1] !== "*") routes.add(match[1]);
  }
  for (const match of String(source).matchAll(/\bt\(\s*"route[A-Za-z]*"\s*,\s*"([^"]+)"\s*\)/g)) {
    routes.add(match[1]);
  }
  return [...routes].sort();
}

/** Read the client routes from the working tree (the gate and CLI use this). */
export function readClientRoutes(root = process.cwd()) {
  return extractClientRoutes(readFileSync(join(root, APP_ROUTES_SOURCE), "utf8"));
}

/**
 * Every path a host must answer with the SPA shell: the client routes the hosts
 * do not own as public pages, plus /capture. Sorted.
 */
export function shellRoutes(clientRoutes = readClientRoutes()) {
  return [...clientRoutes, CAPTURE_ROUTE]
    .filter((route) => !HOST_PUBLIC_CLIENT_ROUTES.includes(route))
    .sort();
}

/**
 * A path and its trailing-slash twin. Hosts match paths literally (Vercel
 * rewrites, `_redirects`, Netlify `from`), so `/settings/` — what a visitor
 * gets by pasting a URL with a slash — needs its own rule or it 404s.
 */
export function pathVariants(route) {
  return route === "/" ? ["/"] : [route, `${route}/`];
}

/** True when the hosting layer is expected to answer this path with the shell. */
export function isShellPath(pathname, clientRoutes = readClientRoutes()) {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return shellRoutes(clientRoutes).includes(normalized);
}

/**
 * The public surface: never answered by the shell, on any host. Static assets
 * (anything with a file extension) are deliberately NOT part of this list —
 * they are files on disk, and a missing one must be a 404 on every host.
 */
export function isPublicSurface(pathname) {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (path === "/") return true;
  if (path === "/landing.html") return true;
  // The localized landings own their whole subtree: the hosts rewrite
  // /<lang>/<anything> to that locale's page (see check-seo.mjs).
  if (LANDING_CODES.some((code) => code !== "en" && (path === `/${code}` || path.startsWith(`/${code}/`)))) {
    return true;
  }
  return (
    path === "/privacy" ||
    path === "/privacy-and-terms" ||
    path.startsWith("/privacy-and-terms.") ||
    path === "/terms" ||
    path === "/help" ||
    path === "/pocket-alternative" ||
    path === "/offline" ||
    path === "/404" ||
    path.startsWith("/404.")
  );
}
