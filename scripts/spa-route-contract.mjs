#!/usr/bin/env node
/**
 * scripts/spa-route-contract.mjs — do the four host configs agree with the app?
 *
 * check:spa-routes is the gate; this module is its logic. Each host speaks a
 * different syntax for "serve this path from that file", so each gets a small
 * parser here and all four are judged against one contract
 * (scripts/app-routes.mjs):
 *
 *   FOR EVERY SHELL ROUTE — the path and its trailing-slash twin must resolve to
 *   dist/app.html with status 200. A missing rule is a 404 in production for a
 *   route the app declares, which is how /bookmarks, /settings and /chat were
 *   unreachable on a cold load: the router declares them, nothing served them.
 *
 *   NEVER FOR THE PUBLIC SURFACE — no host may answer the landing, a localized
 *   landing, the legal pages, /help, /offline or /pocket-alternative with the
 *   private shell. A crawler or a bookmarked marketing URL would land inside the
 *   app instead of the page, and the indexable page would disappear behind it.
 *
 *   NO BLANKET FALLBACK — a root catch-all (`/:path*`, `/(.*)`, the `_redirects`
 *   splat) answers every unknown URL with a page and a 200: a soft 404 that also
 *   makes the app unreachable wherever the catch-all wins. Unknown paths must
 *   reach the host's own 404 document.
 *
 * The parsers are deliberately textual (no toml/nginx dependency): they read the
 * shipped files, and the fixture test drives them with broken copies so the gate
 * has to prove it can fail.
 *
 * Node-core only.
 */
import {
  APP_SHELL,
  CAPTURE_ROUTE,
  HOST_PUBLIC_CLIENT_ROUTES,
  isPublicSurface,
  pathVariants,
  shellRoutes,
} from "./app-routes.mjs";

/** Host configs the contract applies to (key → repo path). */
export const HOST_FILES = {
  vercel: "vercel.json",
  redirects: "public/_redirects",
  netlify: "netlify.toml",
  nginx: "public/nginx.conf",
};

const stripTrailingSlash = (p) => (p.length > 1 ? String(p).replace(/\/+$/, "") : String(p));

/**
 * The platform's dynamic-rule budget for `_redirects` (Cloudflare docs:
 * 2,000 static + 100 dynamic, 2,100 combined).
 */
export const REDIRECT_DYNAMIC_LIMIT = 100;

/**
 * Cloudflare's `_redirects` ORDERING contract.
 *
 * The docs say it in one line — "Static redirects should appear before dynamic
 * redirects" — and the parser is stricter than that reads: the first rule with
 * a splat or a placeholder CLOSES the static budget, and every rule after it is
 * counted as dynamic, so passing the 100-rule cap makes the parser discard the
 * rest of the file silently (the deploy stays green, the rules are just gone).
 *
 * This file learned it the hard way: the /<lang>/* subtree rows used to sit in
 * the middle, the app-route block at the end was dropped by the real runtime,
 * and /settings, /security, /shared, /timeline and /voiceLocal answered 404 on
 * Cloudflare while every local check passed. The gate now enforces the ordering
 * and the budget, so the next insertion cannot repeat it.
 *
 * @param {string} text `_redirects` contents
 * @returns {string[]} failure messages (empty when the ordering is safe)
 */
export function assessRedirectOrdering(text) {
  const failures = [];
  let dynamic = 0;
  let staticAfterDynamic = 0;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("#") || line.startsWith("!")) continue;
    const source = line.split(/\s+/)[0];
    // A bare `/*` is the legacy splat marker; a rule whose source carries a
    // splat or a `:placeholder` is dynamic too.
    const isDynamic = source === "/*" || /[*]|:[A-Za-z]\w*/.test(source);
    if (isDynamic) {
      dynamic += 1;
    } else if (dynamic > 0) {
      staticAfterDynamic += 1;
    }
  }
  if (staticAfterDynamic > 0) {
    failures.push(
      `public/_redirects: ${staticAfterDynamic} static rule(s) sit after the first dynamic rule — Cloudflare's parser counts them as dynamic and drops the file's tail once the cap is reached; move them above the /<lang>/* block`,
    );
  }
  if (dynamic > REDIRECT_DYNAMIC_LIMIT) {
    failures.push(
      `public/_redirects: ${dynamic} dynamic rule(s) — the platform caps them at ${REDIRECT_DYNAMIC_LIMIT}`,
    );
  }
  return failures;
}

/**
 * A source that swallows EVERY path. Subtrees are fine — `/app/:path*` only
 * claims /app/*, and the app owns /app — so only the root-level shapes qualify.
 */
export function isCatchAllSource(source) {
  const s = String(source).trim().replace(/\/+$/, "");
  return s === "*" || s === "/*" || s === "/(.*)" || s === "/:path*";
}

/**
 * Vercel: `rewrites[].source` is an exact path in this repo (path-to-regexp is
 * available but nothing here needs it), so literal sources are the whole story.
 * A parameterized source contributes its static head (`/app/:path*` → `/app`).
 */
export function parseVercelShellPaths(text) {
  const json = JSON.parse(text);
  const shell = new Set();
  const catchAlls = [];
  for (const rule of json.rewrites ?? []) {
    const { source, destination } = rule;
    if (isCatchAllSource(source)) catchAlls.push(`${source} -> ${destination}`);
    if (destination !== APP_SHELL) continue;
    if (/[:(*]/.test(source.slice(1))) {
      const head = stripTrailingSlash(source.split(/[:(*]/)[0]);
      if (head.length > 1) shell.add(head);
      continue;
    }
    shell.add(stripTrailingSlash(source));
  }
  return { shell, catchAlls };
}

/**
 * `_redirects` (and Netlify's `from`/`to` shape): rows of `from to status`, plus
 * the splat row, whose target is the first non-`!` row that follows it.
 */
export function parseRedirectRows(text, { splatMarker = "/*" } = {}) {
  const rewrites = [];
  const splats = [];
  let inSplat = false;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("#") || line.startsWith("!")) continue;
    const parts = line.split(/\s+/);
    if (parts.length === 1 && parts[0] === splatMarker) {
      inSplat = true;
      continue;
    }
    if (inSplat) {
      splats.push(`${parts[0]} (status ${parts[1] ?? 200})`);
      inSplat = false;
      continue;
    }
    if (parts.length >= 3) {
      rewrites.push({ from: parts[0], to: parts[1], status: Number(parts[2]) });
    }
  }
  return { rewrites, splats };
}

export function parseRedirectsShellPaths(text) {
  const { rewrites, splats } = parseRedirectRows(text);
  const shell = new Set();
  for (const rule of rewrites) {
    if (rule.to === APP_SHELL && rule.status === 200) shell.add(stripTrailingSlash(rule.from));
  }
  return { shell, catchAlls: splats };
}

/** Netlify TOML: `[[redirects]]` tables with `from`, `to`, `status` keys. */
export function parseNetlifyShellPaths(text) {
  const shell = new Set();
  const catchAlls = [];
  const blocks = String(text).split(/\[\[redirects\]\]/).slice(1);
  for (const block of blocks) {
    const from = block.match(/^\s*from\s*=\s*"([^"]+)"/m)?.[1];
    const to = block.match(/^\s*to\s*=\s*"([^"]+)"/m)?.[1];
    const status = Number(block.match(/^\s*status\s*=\s*(\d+)/m)?.[1] ?? 200);
    if (!from || !to) continue;
    if (isCatchAllSource(from)) catchAlls.push(`${from} -> ${to}`);
    if (to === APP_SHELL && status === 200) shell.add(stripTrailingSlash(from));
  }
  return { shell, catchAlls };
}

/**
 * nginx: one regex location serves the app routes, and every `try_files` in the
 * file is inspected — a fallback to a document instead of `=404` is the blanket
 * fallback this contract forbids (that is how the marketing page used to answer
 * /chat and /no-such-page alike).
 */
export function parseNginxShellPaths(text) {
  const conf = String(text);
  const shell = new Set();
  const catchAlls = [];
  const block = conf.match(
    /location\s+~\s+\^\/\(\?:([A-Za-z0-9_|.-]+)\)\/\?\$\s*\{([\s\S]*?)\n\s*\}/,
  );
  if (block) {
    const [, alternation, body] = block;
    if (/try_files\s+\/app\.html\s+=404\s*;/.test(body)) {
      for (const name of alternation.split("|")) shell.add(`/${name}`);
    }
  }
  for (const match of conf.matchAll(/try_files\s+([^;]+);/g)) {
    const args = match[1].trim().split(/\s+/);
    const last = args[args.length - 1];
    if (last !== "=404" && /\.html?$/.test(last)) catchAlls.push(`try_files ${match[1].trim()}`);
  }
  return { shell, catchAlls };
}

const PARSERS = {
  vercel: parseVercelShellPaths,
  redirects: parseRedirectsShellPaths,
  netlify: parseNetlifyShellPaths,
  nginx: parseNginxShellPaths,
};

/**
 * Judge every host against the contract.
 *
 * @param {object} inputs
 * @param {Record<string, string|null|undefined>} inputs.files host config contents by key
 * @param {string[]} [inputs.clientRoutes] override for tests (defaults to AppRoutes.tsx)
 * @returns {{ ok: boolean, failures: string[], checks: number }}
 */
export function assessHostContracts({ files, clientRoutes }) {
  const failures = [];
  const routes = shellRoutes(clientRoutes);
  const wanted = [...new Set(routes.flatMap((route) => pathVariants(route).map(stripTrailingSlash)))];
  let checks = 0;

  for (const [host, parse] of Object.entries(PARSERS)) {
    const text = files[host];
    if (text === null || text === undefined) {
      failures.push(`${HOST_FILES[host]}: missing (the route contract cannot be verified)`);
      continue;
    }
    let parsed;
    try {
      parsed = parse(text);
    } catch (error) {
      failures.push(`${HOST_FILES[host]}: unreadable (${error.message})`);
      continue;
    }
    checks += 1;

    // 0. The `_redirects` file has to survive the platform's own parser first:
    // ordering (static before dynamic) and the dynamic-rule budget.
    if (host === "redirects") {
      failures.push(...assessRedirectOrdering(text));
    }

    // 1. Every shell route (with its trailing-slash twin) is served by the shell.
    for (const variant of wanted) {
      if (parsed.shell.has(variant)) continue;
      const owner = routes.find((r) => pathVariants(r).map(stripTrailingSlash).includes(variant));
      failures.push(
        `${HOST_FILES[host]}: ${variant} is not served by ${APP_SHELL} — the app declares ${owner}`,
      );
    }

    // 2. No host may hide a public page behind the private shell.
    for (const served of parsed.shell) {
      if (isPublicSurface(served)) {
        failures.push(`${HOST_FILES[host]}: public path ${served} is served by ${APP_SHELL}`);
      }
    }

    // 3. No blanket fallback.
    for (const catchAll of parsed.catchAlls) {
      failures.push(`${HOST_FILES[host]}: blanket fallback — ${catchAll}`);
    }
  }

  // The contract itself must be well-formed, or every host below is agreeing on
  // the wrong thing.
  if (!wanted.includes(CAPTURE_ROUTE)) {
    failures.push(`contract: ${CAPTURE_ROUTE} is not part of the shell routes`);
  }
  for (const publicRoute of HOST_PUBLIC_CLIENT_ROUTES) {
    if (wanted.includes(stripTrailingSlash(publicRoute)) && publicRoute !== "/") {
      failures.push(`contract: ${publicRoute} must stay a host-served public page`);
    }
  }

  return { ok: failures.length === 0, failures, checks };
}
