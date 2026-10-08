#!/usr/bin/env node
/**
 * scripts/check-landing-smoke.mjs — ADR-062, the browser half.
 *
 * The public entry pages are static HTML that never passes through the React
 * shell, so a correct build does not prove the routes, links, resources and
 * console behave in a browser. `check:landings-fresh` (ADR-051) covers the
 * offline half (committed HTML == reproducible render); this gate opens the
 * served pages.
 *
 * A local static server applies the SAME routing contract as the edge
 * (`_redirects`: 200 rewrites, the splat, its `!` exclusions and the SPA
 * fallback) over the built `dist/`, and Chromium opens the 31 routes of the
 * landing registry (`landing-registry.mjs`: the 30 landings plus the Pocket
 * page). Per route:
 *
 *   - NAVIGATION — HTTP 200; `<html lang>`/`dir` equal to the translation the
 *     page was rendered from (the registry's locale, RTL for ar/he); a
 *     non-empty `<title>`; and every same-origin link on the page resolving to
 *     200;
 *   - CRITICAL RESOURCES — stylesheets, scripts, icons, manifest, images and
 *     the page's own `og:image`: HTTP 200 with a non-empty body AND a
 *     `content-type` that matches the extension. The status code is not enough:
 *     `_redirects` excludes `.css/.js/.png/…` from the splat but NOT `.gif`, so
 *     a retired GIF answers 200 with the shell's HTML — a broken image with no
 *     404 and no console error — and only the served type reveals it;
 *   - CONSOLE — zero same-origin console errors and zero uncaught exceptions. A
 *     blocked third-party resource is a note, not a failure: this harness has
 *     no network and does not invent one (non-local requests are aborted).
 *
 * The gate is NOT part of `npm run check`: that chain is offline by contract
 * (ADR-064) and this one needs a Chromium binary. It belongs to the release
 * path (`check:deploy`, `check:build-verification`) and to its own named step in
 * the `build` job of `ci.yml`, which installs Chromium for `test:performance`
 * anyway — both run after `build:ci`, because the edge serves `dist/`.
 *
 * Usage:
 *   node scripts/check-landing-smoke.mjs                    # serve dist/, smoke it
 *   node scripts/check-landing-smoke.mjs --base-url <url>   # deployed surface (staging)
 *   node scripts/check-landing-smoke.mjs --json             # machine-readable
 *
 * The local surface is always the built tree (`DEFAULT_ROOT`): a served copy is
 * smoked through `--base-url`, which is also the only other mode any caller
 * uses.
 *
 * Exit 0 clean, 1 findings, 2 environment (no built tree, or no Chromium).
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LANDING_LOCALES, SITE_URL } from "./landing-registry.mjs";

/** The tree the edge serves: `public/` is an input to the build, not the output. */
export const DEFAULT_ROOT = "dist";
export const REDIRECTS_FILE = "_redirects";
/** The one registry route that is not a landing (ADR-062). */
export const POCKET_ROUTE = "/pocket-alternative";
/**
 * The canonical site host. The pages carry their own absolute URLs
 * (`https://bookmarkforgeapp.com/og-image.png`, the hreflang alternates), so those
 * are OUR surface even when the smoke runs against 127.0.0.1 or staging: what
 * gets checked is the path on the served base.
 */
export const CANONICAL_HOST = new URL(SITE_URL).host;
/** RTL locales — mirrors the generator's RTL set (generate-landing-pages.mjs). */
export const RTL_CODES = new Set(["ar", "he"]);
/** The 31 routes: 30 landings (EN at the root) plus the Pocket comparison page. */
export const ROUTES = [
  ...LANDING_LOCALES.map((locale) => ({ route: locale.path, locale: locale.lang })),
  { route: POCKET_ROUTE, locale: "en" },
];

const NAV_TIMEOUT_MS = 20000;
const SETTLE_TIMEOUT_MS = 5000;

/** Content types a file may legitimately be served as, keyed by extension. */
const CONTENT_TYPES = {
  ".html": ["text/html"],
  ".css": ["text/css"],
  ".js": ["text/javascript", "application/javascript"],
  ".mjs": ["text/javascript", "application/javascript"],
  ".json": ["application/json"],
  ".webmanifest": ["application/manifest+json", "application/json"],
  ".png": ["image/png"],
  ".gif": ["image/gif"],
  ".jpg": ["image/jpeg"],
  ".jpeg": ["image/jpeg"],
  ".webp": ["image/webp"],
  ".avif": ["image/avif"],
  ".svg": ["image/svg+xml"],
  ".ico": ["image/x-icon", "image/vnd.microsoft.icon"],
  ".woff": ["font/woff"],
  ".woff2": ["font/woff2"],
  ".ttf": ["font/ttf"],
  ".eot": ["application/vnd.ms-fontobject"],
  ".xml": ["application/xml", "text/xml"],
  ".txt": ["text/plain"],
  ".md": ["text/markdown", "text/plain"],
};

export class SmokeEnvironmentError extends Error {}

/** The content types a served path may carry, judged by its extension. */
export function allowedContentTypes(pathname) {
  return CONTENT_TYPES[extname(pathname).toLowerCase()] ?? null;
}

/**
 * Netlify-style glob used by `_redirects` (`*` spans `/`, `?` is one char).
 * Anything else is literal.
 */
export function matchGlob(pattern, pathname) {
  const source = pattern
    .split("")
    .map((char) => {
      if (char === "*") return ".*";
      if (char === "?") return ".";
      return char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    })
    .join("");
  return new RegExp(`^${source}$`).test(pathname);
}

/**
 * Parse `_redirects`. Lines are `from to [status]`; `!pattern` lines belong to
 * the preceding splat row and exclude paths from it (an excluded path that is
 * not a file on disk is a 404, never the shell).
 */
export function parseRedirects(text) {
  const rewrites = [];
  const splat = { exclusions: [], to: null, status: null };
  let inSplat = false;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    if (line.startsWith("!")) {
      if (inSplat) splat.exclusions.push(line.slice(1).trim());
      continue;
    }
    const parts = line.split(/\s+/);
    if (parts[0] === "/*" && parts.length === 1) {
      inSplat = true;
      continue;
    }
    if (inSplat) {
      // The splat's own destination/status line closes the block.
      splat.to = parts[0];
      splat.status = Number(parts[1] ?? 200);
      continue;
    }
    if (parts.length >= 3) {
      rewrites.push({ from: parts[0], to: parts[1], status: Number(parts[2]) });
    }
  }
  return { rewrites, splat };
}

/**
 * Which response a request gets, following the `_redirects` contract: exact
 * rewrite → file on disk → splat (unless excluded) → 404.
 */
export function resolveRequest({ pathname, root, redirects }) {
  const fileExists = (relative) => {
    const absolute = resolve(root, `.${relative}`);
    return absolute.startsWith(resolve(root)) && existsSync(absolute) && statSync(absolute).isFile()
      ? absolute
      : null;
  };
  for (const rewrite of redirects.rewrites) {
    if (rewrite.from !== pathname) continue;
    if (rewrite.status >= 300 && rewrite.status < 400) {
      return { kind: "redirect", location: rewrite.to, status: rewrite.status };
    }
    const file = fileExists(rewrite.to);
    return file ? { kind: "file", file, status: rewrite.status } : { kind: "missing", path: rewrite.to };
  }
  const direct = fileExists(pathname);
  if (direct) return { kind: "file", file: direct, status: 200 };
  const excluded = redirects.splat.exclusions.some((pattern) => matchGlob(pattern, pathname));
  if (redirects.splat.to && !excluded) {
    const file = fileExists(redirects.splat.to);
    if (file) return { kind: "file", file, status: 200, fallback: true };
  }
  return { kind: "missing", path: pathname };
}

/** The static server implementing the contract above. */
export function createStaticServer({ root, redirects, fallback404 = null }) {
  return createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    const resolution = resolveRequest({ pathname: url.pathname, root, redirects });
    if (resolution.kind === "redirect") {
      response.writeHead(resolution.status, { location: resolution.location });
      response.end();
      return;
    }
    if (resolution.kind === "missing") {
      if (fallback404) {
        response.writeHead(404, { "content-type": "text/html; charset=utf-8" });
        response.end(readFileSync(fallback404));
        return;
      }
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end(`not found: ${resolution.path}\n`);
      return;
    }
    const types = allowedContentTypes(resolution.file);
    const type = types ? types[0] : "application/octet-stream";
    const body = readFileSync(resolution.file);
    response.writeHead(200, {
      "content-type": types && type.startsWith("text/") ? `${type}; charset=utf-8` : type,
      "content-length": body.byteLength,
    });
    response.end(body);
  });
}

/** Strip a URL down to its own-surface path, or null when it is not ours. */
export function localPath(value, { page = "/", origin = null } = {}) {
  const raw = String(value ?? "").trim();
  if (raw.length === 0 || raw.startsWith("#")) return null;
  if (/^(?:mailto:|tel:|javascript:|data:|blob:)/i.test(raw)) return null;
  // Relative references resolve against the surface being smoked, so a
  // `/es/` link on a page served from 127.0.0.1 belongs to that run's origin.
  const base = origin ?? "http://smoke.invalid";
  const pagePath = page.startsWith("/") ? page : `/${page}`;
  let url;
  try {
    url = new URL(raw, `${base}${pagePath}`);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const owned =
    url.host === CANONICAL_HOST ||
    (origin === null ? url.host === "smoke.invalid" : url.origin === origin);
  if (!owned) return null;
  return `${url.pathname}${url.search}`;
}

/**
 * Critical resources of a served page: stylesheets, scripts, icons, manifest,
 * images and the page's own `og:image`. Distinct, same-origin, in document
 * order — the harness checks each one's status, body length and served type.
 */
export function classifyCriticalResources(html, { origin = null } = {}) {
  const found = new Map();
  const add = (raw) => {
    const path = localPath(raw, { origin });
    if (path && !found.has(path)) found.set(path, path);
  };
  for (const match of String(html).matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    const rel = (tag.match(/rel\s*=\s*["']?([a-z0-9 -]+)/i) ?? [])[1] ?? "";
    if (!/stylesheet|icon|manifest|preload|apple-touch-icon/i.test(rel)) continue;
    add((tag.match(/href\s*=\s*["']([^"']+)["']/i) ?? [])[1]);
  }
  for (const match of String(html).matchAll(/<script\b[^>]*src\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    add(match[1]);
  }
  for (const match of String(html).matchAll(/<img\b[^>]*src\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    add(match[1]);
  }
  for (const match of String(html).matchAll(
    /<meta\b[^>]*property\s*=\s*["']og:image["'][^>]*content\s*=\s*["']([^"']+)["'][^>]*>/gi,
  )) {
    add(match[1]);
  }
  for (const match of String(html).matchAll(
    /<meta\b[^>]*content\s*=\s*["']([^"']+)["'][^>]*property\s*=\s*["']og:image["'][^>]*>/gi,
  )) {
    add(match[1]);
  }
  return [...found.keys()];
}

/**
 * Same-origin links of a served page, as paths. The query string is part of the
 * identity (the language links are clean paths; a legacy `?lang=xx` is still
 * preserved) and the fragment is not.
 */
export function extractInternalLinks(html, { page = "/", origin = null } = {}) {
  const found = new Set();
  for (const match of String(html).matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["']/gi)) {
    const path = localPath(match[1], { page, origin });
    if (path) found.add(path);
  }
  return [...found];
}

/** The locale a route must declare, and the direction that implies. */
export function expectedIdentity(route) {
  const entry = ROUTES.find((candidate) => candidate.route === route);
  if (!entry) return null;
  return { locale: entry.locale, dir: RTL_CODES.has(entry.locale) ? "rtl" : "ltr" };
}

/**
 * Navigation findings for one route: HTTP 200, the locale's `lang`/`dir`, a
 * non-empty title. Pure so the suite can drive every mismatch without a
 * browser; the CLI feeds it what Chromium observed.
 */
export function navigationFindings({ route, status, lang, dir, title }) {
  const failures = [];
  if (status !== 200) {
    failures.push(`navigation: ${route} answered HTTP ${status}, expected 200`);
    return failures;
  }
  const identity = expectedIdentity(route);
  if (identity && lang !== identity.locale) {
    failures.push(
      `navigation: ${route} declares lang="${lang ?? ""}", expected "${identity.locale}"`,
    );
  }
  if (identity && dir !== identity.dir) {
    failures.push(
      `navigation: ${route} declares dir="${dir ?? ""}", expected "${identity.dir}"`,
    );
  }
  if (String(title ?? "").trim().length === 0) {
    failures.push(`navigation: ${route} has an empty <title>`);
  }
  return failures;
}

/**
 * Critical-resource findings: 200, non-empty body, and a served type that
 * matches the extension — the `.gif` trap the ADR records (the splat answers a
 * retired asset with the shell's HTML, and only the type reveals it).
 */
export function resourceFindings({ path, route, status, bodyLength, contentType }) {
  if (status !== 200) {
    return [`critical resource: ${path} (from ${route}) answered HTTP ${status}, expected 200`];
  }
  if (bodyLength === 0) {
    return [`critical resource: ${path} (from ${route}) served an empty body`];
  }
  const allowed = allowedContentTypes(path);
  const served = String(contentType ?? "").split(";")[0].trim().toLowerCase();
  if (allowed && !allowed.includes(served)) {
    return [
      `critical resource: ${path} (from ${route}) served as "${served}", expected ` +
        `${allowed.join(" or ")} — a 200 is not proof: the SPA fallback answers with ` +
        `the shell's HTML (that is how a retired .gif breaks)`,
    ];
  }
  return [];
}

/** Same-origin links must resolve to 200 (no query string is dropped here). */
export function linkFindings({ path, route, status }) {
  return status === 200
    ? []
    : [`link: ${path} (linked from ${route}) answered HTTP ${status}, expected 200`];
}

/**
 * The browser half. `launch` is injectable so the suite can drive the failure
 * paths (a missing Chromium) without one installed.
 */
export async function smokeRoutes({
  baseUrl,
  routes = ROUTES,
  launch = null,
  fetchImpl = fetch,
  notes = [],
  failures = [],
} = {}) {
  const resources = new Map();
  const links = new Map();
  const thirdParty = new Set();
  const origin = new URL(baseUrl).origin;
  const browser = await startBrowser(launch);
  try {
    const context = await browser.newContext();
    for (const { route } of routes) {
      const page = await context.newPage();
      const consoleErrors = [];
      const pageErrors = [];
      page.on("console", (message) => {
        if (message.type() !== "error") return;
        const url = message.location()?.url ?? "";
        if (url !== "" && !url.startsWith(origin)) {
          thirdParty.add(`${new URL(url).origin}`);
          notes.push(`${route}: third-party console error noted — ${message.text()}`);
          return;
        }
        consoleErrors.push(message.text());
      });
      page.on("pageerror", (error) => pageErrors.push(String(error?.message ?? error)));
      page.on("requestfailed", (request) => {
        if (!request.url().startsWith(origin)) thirdParty.add(new URL(request.url()).origin);
      });
      // No network by construction: anything off-origin is aborted, so a
      // third-party outage can never masquerade as a landing regression.
      await page.route("**/*", (handler) => {
        const target = handler.request().url();
        if (target.startsWith(origin) || target.startsWith("data:")) return handler.continue();
        return handler.abort();
      });
      const url = `${baseUrl.replace(/\/$/, "")}${route}`;
      try {
        const response = await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: NAV_TIMEOUT_MS,
        });
        const status = response?.status() ?? 0;
        if (status !== 200) {
          failures.push(...navigationFindings({ route, status, lang: null, dir: null, title: "" }));
          continue;
        }
        try {
          await page.waitForLoadState("load", { timeout: SETTLE_TIMEOUT_MS });
        } catch {
          /* INTENTIONAL SILENCE: off-origin subresources are aborted on purpose,
             so `load` may never fire; the DOM and the served HTML are already
             available and are what this gate verifies. */
        }
        const served = await response.text();
        failures.push(
          ...navigationFindings({
            route,
            status,
            lang: await page.getAttribute("html", "lang"),
            dir: await page.getAttribute("html", "dir"),
            title: await page.title(),
          }),
        );
        for (const resource of classifyCriticalResources(served, { origin })) {
          if (!resources.has(resource)) resources.set(resource, route);
        }
        for (const link of extractInternalLinks(served, { page: route, origin })) {
          if (!links.has(link)) links.set(link, route);
        }
        for (const error of consoleErrors) {
          failures.push(`console: ${route} logged an error — ${error}`);
        }
        for (const error of pageErrors) {
          failures.push(`console: ${route} threw an uncaught exception — ${error}`);
        }
      } catch (error) {
        failures.push(`navigation: ${route} failed — ${error.message}`);
      } finally {
        await page.close();
      }
    }
    await context.close();
  } finally {
    await browser.close();
  }

  for (const [resource, route] of resources) {
    const response = await fetchImpl(`${baseUrl}${resource}`).catch((error) => ({ error }));
    if (response.error) {
      failures.push(`critical resource: ${resource} (from ${route}) — ${response.error.message}`);
      continue;
    }
    const body = new Uint8Array(await response.arrayBuffer());
    failures.push(
      ...resourceFindings({
        path: resource,
        route,
        status: response.status,
        bodyLength: body.byteLength,
        contentType: response.headers.get("content-type"),
      }),
    );
  }
  for (const [link, route] of links) {
    const response = await fetchImpl(`${baseUrl}${link}`).catch((error) => ({ error }));
    if (response.error) {
      failures.push(`link: ${link} (linked from ${route}) — ${response.error.message}`);
      continue;
    }
    failures.push(...linkFindings({ path: link, route, status: response.status }));
  }

  return {
    failures,
    notes,
    counts: { routes: routes.length, resources: resources.size, links: links.size },
    thirdParty: [...thirdParty].sort(),
  };
}

/**
 * Launch Chromium, or say exactly what to install. An injected `launch` (the
 * suite) takes the same path as the real one, so its failure modes are the ones
 * CI sees.
 */
export async function startBrowser(launch = null) {
  try {
    if (launch) return await launch();
    const { chromium } = await import("playwright");
    return await chromium.launch({ headless: true });
  } catch (error) {
    // Playwright's launch failure carries a multi-line install banner: keep the
    // first line, which names the missing executable.
    const message = String(error?.message ?? error).split("\n")[0].trim();
    if (/Cannot find (?:package|module)|ERR_MODULE_NOT_FOUND/.test(message)) {
      throw new SmokeEnvironmentError(`Playwright is not installed (${message}) — run: npm ci`);
    }
    throw new SmokeEnvironmentError(
      `Chromium could not be launched (${message}) — run: npx playwright install chromium`,
    );
  }
}

/** Start the local server for `root`, or explain why the tree cannot be served. */
export async function startLocalServer(root) {
  if (!existsSync(join(root, "index.html"))) {
    throw new SmokeEnvironmentError(
      `${root} has no index.html — the edge serves the built tree, so run ` +
        `\`npm run build:ci\` first (or pass --base-url for a deployed surface)`,
    );
  }
  const redirectsPath = join(root, REDIRECTS_FILE);
  const redirects = parseRedirects(existsSync(redirectsPath) ? readFileSync(redirectsPath, "utf8") : "");
  const fallback404 = existsSync(join(root, "404.html")) ? join(root, "404.html") : null;
  const server = createStaticServer({ root, redirects, fallback404 });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

// ── CLI wrapper ──────────────────────────────────────────────────────
const isMain =
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href;

if (isMain) {
  const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const argv = process.argv.slice(2);
  const flag = (name) => {
    const index = argv.indexOf(name);
    return index === -1 ? null : argv[index + 1] ?? null;
  };
  const asJson = argv.includes("--json");
  const baseUrlArg = flag("--base-url");
  const root = resolve(repoRoot, DEFAULT_ROOT);
  let server = null;
  let baseUrl = baseUrlArg?.replace(/\/$/, "") ?? null;
  try {
    if (baseUrl === null) {
      const started = await startLocalServer(root);
      server = started.server;
      baseUrl = started.baseUrl;
    }
  } catch (error) {
    if (asJson) {
      console.log(JSON.stringify({ ok: false, environment: error.message }, null, 2));
    } else {
      console.error(`[check-landing-smoke] FAIL ${error.message}`);
    }
    process.exit(2);
  }

  let result;
  try {
    result = await smokeRoutes({ baseUrl, notes: [], failures: [] });
  } catch (error) {
    if (error instanceof SmokeEnvironmentError) {
      if (asJson) console.log(JSON.stringify({ ok: false, environment: error.message }, null, 2));
      else console.error(`[check-landing-smoke] FAIL ${error.message}`);
      server?.close();
      process.exit(2);
    }
    throw error;
  } finally {
    server?.close();
  }

  const ok = result.failures.length === 0;
  if (asJson) {
    console.log(JSON.stringify({ ok, baseUrl, ...result }, null, 2));
  } else {
    for (const note of result.notes) console.log(`[check-landing-smoke] note ${note}`);
    for (const failure of result.failures) {
      console.error(`[check-landing-smoke] FAIL ${failure}`);
    }
    if (ok) {
      console.log(
        `ok: ${result.counts.routes} route(s), ${result.counts.resources} critical ` +
          `resource(s), ${result.counts.links} internal link(s)`,
      );
      if (result.thirdParty.length > 0) {
        console.log(
          `[check-landing-smoke] note ${result.thirdParty.length} third-party origin(s) ` +
            `not reachable from this harness: ${result.thirdParty.join(", ")}`,
        );
      }
    }
  }
  process.exit(ok ? 0 : 1);
}
