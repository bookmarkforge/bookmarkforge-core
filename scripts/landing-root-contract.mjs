#!/usr/bin/env node
/**
 * scripts/landing-root-contract.mjs — does every host serve the SAME document at `/`?
 *
 * check:landing-root is the gate; this module is its logic.
 *
 * The EN landing used to exist THREE times: the repo-root `index.html` (a Vite
 * entry), a hand-kept `public/index.html` that `npm run build` copied over the
 * emitted `dist/index.html`, and the generated `public/landing.html` the four
 * host configs actually served. The copies drifted (the root pair kept the
 * retired `?lang=` language links, the generated one had clean paths) and, more
 * seriously, `/` answered with DIFFERENT documents depending on the host:
 * nginx, Cloudflare and Netlify rewrote `/` to `/landing.html`, while Vercel had
 * no rule for `/` at all and served `dist/index.html` — the stale copy. The same
 * URL, two documents, and no gate could see it because each gate read the files
 * it owned and nothing compared the hosts against each other.
 *
 * This contract closes that. For every host config (vercel.json, public/
 * _redirects, netlify.toml, public/nginx.conf — the same four check:spa-routes
 * already judges in scripts/spa-route-contract.mjs):
 *
 *   ONE SOURCE — `/` is served with a 200 by `public/landing.html`, the file the
 *   landing generator (scripts/build-landings.cjs) writes and the registry
 *   (scripts/landing-registry.mjs) registers as the `en` landing. A host that
 *   answers `/` with another file, with a redirect, or with nothing is a
 *   finding; so is a returning duplicate (`index.html` / `public/index.html`)
 *   or any extra HTML page claiming the EN landing's canonical URL.
 *
 *   SAME DOCUMENT — the four targets must be byte-for-byte the same document,
 *   which is what the single source gives them: the gate fails on any
 *   divergence between hosts, naming each host's target.
 *
 *   RETIRED URL — `/index.html` no longer exists on disk, so every host must
 *   answer it with a PERMANENT redirect to `/` instead of a 404 (an old
 *   bookmark or backlink keeps working, and no second copy is needed to keep it
 *   working).
 *
 * The parsers are textual, like the sibling gate's: they read the shipped files
 * and the fixture test drives them with broken copies so the gate has to prove
 * it can fail. Freshness of `public/landing.html` against the generator is
 * check:landings-fresh's job; this gate pins that the hosts serve THAT file.
 *
 * Node-core only.
 */
import { basename } from "node:path";
import { APP_SHELL } from "./app-routes.mjs";
import { HOST_FILES, parseRedirectRows } from "./spa-route-contract.mjs";
import { LANDING_LOCALES, SITE_URL } from "./landing-registry.mjs";

/** The canonical root URL — the EN landing's own canonical, and the hop target. */
export const ROOT_ROUTE = "/";

/** The URL the duplicate copies used to answer; retired, never a document. */
export const RETIRED_ROOT_ROUTE = "/index.html";

/** The generated EN landing: the registry row's file, and the builder's output. */
export const EN_LANDING_SOURCE = LANDING_LOCALES.find((l) => l.lang === "en")?.file;

/** The document name that file is served AS (what a host rule points at). */
export const EN_LANDING_TARGET = basename(EN_LANDING_SOURCE);

/** The EN landing's canonical URL, from the same registry check:seo validates. */
export const EN_LANDING_CANONICAL = `${SITE_URL}/`;

/** The SPA shell: noindexed, and allowed to mirror the landing's canonical. */
export const APP_SHELL_FILE = APP_SHELL.replace(/^\//, "");

/** Paths that must NOT exist: they were the duplicate copies of the EN landing. */
export const DUPLICATE_ROOT_PATHS = ["index.html", "public/index.html"];

// ---------------------------------------------------------------------------
// One parser per host syntax, each answering two questions about `/`.
// ---------------------------------------------------------------------------

/** Vercel: JSON. `rewrites[]` serves, `redirects[]` retires. */
export function parseVercelRoot(text) {
  const json = JSON.parse(text);
  const rewrite = (json.rewrites ?? []).find((rule) => rule.source === ROOT_ROUTE);
  const retirement = (json.redirects ?? []).find((rule) => rule.source === RETIRED_ROOT_ROUTE);
  return {
    root: rewrite
      ? { target: basename(rewrite.destination ?? ""), status: 200 }
      : null,
    retirement: retirement
      ? { to: retirement.destination, permanent: retirement.permanent === true }
      : null,
  };
}

/** `_redirects` rows of `from to status` (the sibling gate's parser). */
export function parseRedirectsRoot(text) {
  const { rewrites } = parseRedirectRows(text);
  const row = rewrites.find((rule) => rule.from === ROOT_ROUTE);
  const retirement = rewrites.find((rule) => rule.from === RETIRED_ROOT_ROUTE);
  return {
    root: row ? { target: basename(row.to), status: row.status } : null,
    retirement: retirement ? { to: retirement.to, permanent: retirement.status === 301 } : null,
  };
}

/**
 * netlify.toml: `[[redirects]]` tables. The language negotiation is expressed
 * as `from = "/"` rules carrying a `conditions` block — those answer a
 * *conditional* request, so the rule that answers a plain GET of `/` is the one
 * without conditions.
 */
export function parseNetlifyRoot(text) {
  let root = null;
  let retirement = null;
  for (const block of String(text).split("[[redirects]]").slice(1)) {
    const from = block.match(/^\s*from\s*=\s*"([^"]+)"/m)?.[1];
    const to = block.match(/^\s*to\s*=\s*"([^"]+)"/m)?.[1];
    const status = Number(block.match(/^\s*status\s*=\s*(\d+)/m)?.[1] ?? 200);
    if (!from || !to) continue;
    if (from === ROOT_ROUTE && !/^\s*conditions\s*=/m.test(block) && !root) {
      root = { target: basename(to), status };
    }
    if (from === RETIRED_ROOT_ROUTE && !retirement) {
      retirement = { to, permanent: status === 301 };
    }
  }
  return { root, retirement };
}

/**
 * nginx: exact-match locations. The body of `location = /` is taken up to the
 * first line that closes it (four-space indent — every inner `if` is deeper), so
 * brace matching stays trivial; the target is the LAST `rewrite … last;` in that
 * body, i.e. the fallback the locale branches did not take.
 */
export function parseNginxRoot(text) {
  const conf = String(text);
  const atRoot = /location\s+=\s+\/\s*\{([\s\S]*?)\n\s{4}\}/.exec(conf)?.[1];
  // `if` branches (language negotiation, WebSocket upgrades) are CONDITIONAL:
  // they rewrite `/` only for a matching request, so they cannot be the
  // document a plain GET gets. Stripping them leaves the real default target —
  // and a host that has ONLY branches correctly reads as "no document".
  const unconditional = (atRoot ?? "").replace(/if\s*\([^)]*\)\s*\{[^}]*\}/g, "");
  const targets = [...unconditional.matchAll(/rewrite\s+\^\s+(\S+)\s+last\s*;/g)];
  const retired = /location\s+=\s+\/index\.html\s*\{([\s\S]*?)\n\s{4}\}/.exec(conf)?.[1];
  const redirect = retired === undefined ? null : /return\s+(\d{3})\s+(\S+)\s*;/.exec(retired);
  return {
    root:
      targets.length > 0
        ? { target: basename(targets[targets.length - 1][1]), status: 200 }
        : null,
    retirement: redirect ? { to: redirect[2], permanent: redirect[1] === "301" } : null,
  };
}

const PARSERS = {
  vercel: parseVercelRoot,
  redirects: parseRedirectsRoot,
  netlify: parseNetlifyRoot,
  nginx: parseNginxRoot,
};

// ---------------------------------------------------------------------------
// The document checks: which page is the single EN landing?
// ---------------------------------------------------------------------------

/** The href of a page's `<link rel="canonical">`, or null when it has none. */
export function canonicalHref(html) {
  for (const tag of String(html).matchAll(/<link\b[^>]*>/gi)) {
    if (!/rel=["']canonical["']/i.test(tag[0])) continue;
    const href = /href=["']([^"']+)["']/i.exec(tag[0]);
    if (href) return href[1];
  }
  return null;
}

/**
 * Judge every host against the root contract.
 *
 * @param {object} inputs
 * @param {Record<string, string|null|undefined>} inputs.files host config contents by key
 * @param {(relPath: string) => boolean} inputs.fileExists filesystem probe (repo-relative)
 * @param {Array<{file: string, content: string}>} [inputs.trackedHtml] committed HTML pages
 * @param {string} [inputs.landingSource] the registry's EN landing file
 * @param {string} [inputs.generatorPath] the landing generator's EN output path
 * @returns {{ ok: boolean, failures: string[], checks: number, targets: Record<string,string> }}
 */
export function assessLandingRoot({
  files,
  fileExists,
  trackedHtml = [],
  landingSource = EN_LANDING_SOURCE,
  generatorPath = EN_LANDING_SOURCE,
}) {
  const failures = [];
  const targets = {};
  let checks = 0;

  for (const [host, parse] of Object.entries(PARSERS)) {
    const text = files[host];
    if (text === null || text === undefined) {
      failures.push(`${HOST_FILES[host]}: missing (the root contract cannot be verified)`);
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

    // 1. `/` serves the EN landing, with a 200 (never a redirect away).
    if (!parsed.root) {
      failures.push(
        `${HOST_FILES[host]}: nothing answers ${ROOT_ROUTE} — the canonical root has no document on this host`,
      );
    } else {
      targets[host] = parsed.root.target;
      if (parsed.root.status !== 200) {
        failures.push(
          `${HOST_FILES[host]}: ${ROOT_ROUTE} is answered with ${parsed.root.status} ${parsed.root.target} — the canonical root must SERVE the landing, not send the visitor elsewhere`,
        );
      }
      if (parsed.root.target !== EN_LANDING_TARGET) {
        failures.push(
          `${HOST_FILES[host]}: ${ROOT_ROUTE} is served by ${parsed.root.target}, not by ${EN_LANDING_TARGET} (the generated EN landing)`,
        );
      }
    }

    // 2. The retired duplicate URL is a permanent redirect to the root.
    if (!parsed.retirement) {
      failures.push(
        `${HOST_FILES[host]}: ${RETIRED_ROOT_ROUTE} is not retired — the file is gone from the tree, so an old bookmark would 404; answer it with a permanent redirect to ${ROOT_ROUTE}`,
      );
    } else if (!parsed.retirement.permanent || parsed.retirement.to !== ROOT_ROUTE) {
      failures.push(
        `${HOST_FILES[host]}: ${RETIRED_ROOT_ROUTE} must be a permanent (301) redirect to ${ROOT_ROUTE}, got ${parsed.retirement.to} (${parsed.retirement.permanent ? "301" : "temporary"})`,
      );
    }
  }

  // 3. Same document everywhere: one target, or the hosts disagree.
  const distinct = [...new Set(Object.values(targets))];
  if (distinct.length > 1) {
    const detail = Object.entries(targets)
      .map(([host, target]) => `${HOST_FILES[host]} → ${target}`)
      .join(", ");
    failures.push(`${ROOT_ROUTE} answers with different documents per host: ${detail}`);
  }

  // 4. One generated source, and no duplicate coming back.
  if (landingSource !== generatorPath) {
    failures.push(
      `the EN landing must be the generator's output (${generatorPath}), but the registry points at ${landingSource}`,
    );
  }
  if (!fileExists(landingSource)) {
    failures.push(`${landingSource}: missing — run the landing build (npm run build:landings)`);
  }
  for (const duplicate of DUPLICATE_ROOT_PATHS) {
    if (duplicate === landingSource) continue;
    if (fileExists(duplicate)) {
      failures.push(
        `${duplicate}: duplicate EN landing copy — ${landingSource} is the single generated source every host serves at ${ROOT_ROUTE}`,
      );
    }
  }

  // 5. No other HTML page claims the EN landing's canonical URL. The SPA shell
  //    is allowed to mirror it (it is noindexed — see app.html and public/
  //    _headers); anything else is a landing copy in disguise.
  const claimants = trackedHtml
    .filter((page) => canonicalHref(page.content) === EN_LANDING_CANONICAL)
    .map((page) => page.file);
  if (!claimants.includes(landingSource)) {
    failures.push(
      `${landingSource}: does not declare its own canonical ${EN_LANDING_CANONICAL}`,
    );
  }
  for (const claimant of claimants) {
    if (claimant === landingSource || claimant === APP_SHELL_FILE) continue;
    failures.push(
      `${claimant}: claims the EN landing canonical (${EN_LANDING_CANONICAL}) without being the generated landing — a duplicate root page`,
    );
  }

  return { ok: failures.length === 0, failures, checks, targets };
}
