/**
 * scripts/nginx-render.mjs — propagate the deployment domain (and the
 * canonical CSP from csp-config.js) to every static file that carries it.
 *
 * OWNERSHIP (per file, one and only one kind):
 *   - public/nginx.conf   GENERATED WHOLESALE from this script (self-hosted
 *                         nginx server block). This script is its single owner.
 *   - public/robots.txt   GENERATED WHOLESALE from this script. Single owner.
 *   - public/_headers     HAND-MAINTAINED (A9-1). Cloudflare Pages applies only
 *                         the most-specific rule, so every path block repeats
 *                         the security headers. This script NEVER regenerates
 *                         the file: it surgically rewrites only the three
 *                         CSP-derived header values (Content-Security-Policy,
 *                         Report-To, Reporting-Endpoints) so a
 *                         BOOKMARKFORGE_DOMAIN change still propagates.
 *   - public/sitemap.xml  HAND-MAINTAINED (A9-1). 61 URLs across 30 languages,
 *                         pinned by scripts/check-seo.mjs. This script NEVER
 *                         regenerates the file: it surgically rewrites the URL
 *                         host inside <loc> elements and xhtml:link href
 *                         attributes, preserving paths and structure.
 *   - netlify.toml        HAND-MAINTAINED; only the three CSP-derived lines are
 *                         surgically replaced (see renderNetlifyToml).
 *   - Everything in TARGETS_SURGICAL (HTML pages, manifest, extension files):
 *                         hand-maintained; only domain-bearing substrings are
 *                         replaced.
 *
 * The rendered files must stay byte-identical (modulo trailing whitespace and
 * CRLF) to the committed copies — the verify mode of this script and
 * scripts/check-csp-sync.mjs validate them. `scripts/rollback.mjs` runs
 * `--write` DURING INCIDENTS, so --write is all-or-nothing: if any target
 * fails its safety checks, nothing is written.
 *
 * Usage:
 *   node scripts/nginx-render.mjs            # verify (fail on drift)
 *   node scripts/nginx-render.mjs --write    # rewrite all targets (all-or-nothing)
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  APP_DOMAIN,
  CSP_MODERATE,
  COEP,
  COOP,
  REPORT_TO_HEADER,
  REPORTING_ENDPOINTS_HEADER,
} from "./csp-config.js";
import {
  LEGAL_LOCALE_CODES as REGISTRY_LEGAL,
  LOCALIZED_LANDING_CODES as REGISTRY_LOCALIZED,
  PREF_LANGS as REGISTRY_PREF,
} from "./landing-registry.mjs";

const ROOT = process.cwd();

const SECURITY_HEADERS = [
  'add_header X-Content-Type-Options "nosniff" always;',
  'add_header X-Frame-Options "DENY" always;',
  'add_header Referrer-Policy "strict-origin-when-cross-origin" always;',
  'add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;',
  'add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), interest-cohort=()" always;',
  `add_header Cross-Origin-Embedder-Policy "${COEP}" always;`,
  `add_header Cross-Origin-Opener-Policy "${COOP}" always;`,
  // Reporting-Endpoints is the current Reporting API syntax. Keep the
  // Report-To header below for older browsers that still require it.
  // Single quotes are required here because REPORT_TO_HEADER contains JSON
  // double quotes; the previous double-quoted rendering produced invalid
  // nginx syntax (`"{"group"...}`).
  `add_header Reporting-Endpoints '${REPORTING_ENDPOINTS_HEADER}' always;`,
  `add_header Report-To '${REPORT_TO_HEADER}' always;`,
  `add_header Content-Security-Policy "${CSP_MODERATE}" always;`,
];

/** Comment block above the CSP header in the server block (committed verbatim). */
const CSP_COMMENT = [
  "    # CSP mirrors public/_headers exactly — keep in sync (see P73 note).",
  "    # NOTE: api.microlink.io was REMOVED (zero-knowledge privacy, see",
  "    # src/services/MetadataService.ts) — do not re-add it here or in _headers.",
  "    # wss://signal.${APP_DOMAIN} is the deployment P2P signaling endpoint",    "    # (PRODUCTION.md) — blocking the signaling endpoint there breaks self-hosted",
  "    # sync. (Deliberately token-free: the build renders this file by matching",
  "    # the directive's source list, and a stray token in a comment would get",
  "    # rewritten/corrupt the next line — see vite.config.ts renderStaticPolicy.)",
].join("\n");

/** Landing languages (besides the default /). Kept in sync with the
 *  hreflang sets in scripts/check-seo.mjs LANDING_PAGES — a new language
 *  must be added in both places. */
/** All localized landing routes shipped in public/ and listed in the sitemap.
 * Keep this registry aligned with generate-landing-pages.mjs / _redirects.
 * English is the root landing and is intentionally omitted here. */
/** The 29 localized landing routes shipped in public/<code>.html —
 *  registry-derived (EN is the root landing, intentionally absent here).
 *  Kept aligned with generate-landing-pages.mjs / _redirects. */
export const LANDING_LANGS = REGISTRY_LOCALIZED;

/** Every preference language (?lang= and bf_lang cookie values), en
 *  included ("en" means "stop negotiating, serve the EN landing").
 *  Registry-derived: the preference set IS the negotiation set by design
 *  (Netlify has no separate preference mechanism — see the middleware). */
export const PREF_LANGS = REGISTRY_PREF;

/** Preference cookie, shared by every host. nf_lang is Netlify's native
 *  override for its Language conditions; bf_lang is read by this nginx
 *  config and functions/_middleware.js. Same cookie in landing.js and
 *  pinned by scripts/check-seo.mjs. */
export const LANG_COOKIE_ATTRS = "Path=/; Max-Age=31536000; SameSite=Lax; Secure";

/** Render the nginx server block (matches public/nginx.conf). */
export function renderNginxPolicy(csp = CSP_MODERATE) {
  const pre = SECURITY_HEADERS.slice(0, -1)
    .map((h) => `    ${h}`)
    .join("\n");
  const cspHeader = `    add_header Content-Security-Policy "${csp}" always;`;
  const repeat = SECURITY_HEADERS.map((h) => `        ${h}`).join("\n");
  const langPrefLocations = PREF_LANGS.map((lang) => {
    const cleanTarget = lang === "en" ? "/" : `/${lang}/`;
    return `    location = /_lang/${lang} {
        internal;
${repeat}
        add_header Set-Cookie "bf_lang=${lang}; ${LANG_COOKIE_ATTRS}" always;
        add_header Set-Cookie "nf_lang=${lang}; ${LANG_COOKIE_ATTRS}" always;
        return 302 ${cleanTarget};
    }`;
  }).join("\n\n");

  return `server {
    listen 8080;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    # ── Compression ──────────────────────────────────────────────────
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css application/json application/javascript
               application/xml image/svg+xml font/woff2;

    # ── Security headers (mirror public/_headers for Cloudflare Pages) ─
    # CRITICAL (audit): nginx add_header is NOT inherited into a location
    # block that defines its own add_header. Every location below that sets
    # Cache-Control must therefore REPEAT these ten directives — otherwise
    # /assets/*, *.html, *.json and /sw.js would be served without CSP,
    # HSTS, COEP, COOP, nosniff, frame-ancestors, etc. Cloudflare Pages
    # _headers COMBINES rules instead (the /* block applies everywhere), so
    # this repetition is what keeps the self-hosted Docker path at parity
    # with Cloudflare. check-csp-sync.mjs verifies every CSP occurrence here
    # is identical.
${pre}
${CSP_COMMENT}
${cspHeader}

    # ── Custom error pages (parity with Cloudflare Pages) ────────────
    # Cloudflare Pages serves public/404.html for unmatched routes; the
    # self-hosted path must do the same. error_page performs an INTERNAL
    # redirect to /404.html (the 404 status is preserved), which matches
    # the ~*\\.html$ location below and therefore gets all the security
    # headers — including the CSP — from that location automatically.
    # No headers need repeating here: add_header ... always already
    # applies the security directives to every other response (nginx default
    # error pages and any 301/302 redirect) at the level that handles it.
    # 5xx (500/502/503/504) intentionally keep nginx's default page: the
    # static server does not mask backend/filesystem failures behind a
    # branded page, so operators can see the real outage response.
    error_page 404 /404.html;

    # ── Same-origin companion API ────────────────────────────────────
    # License, CSP-report and client-event traffic stays on the app origin so
    # the browser CSP and firewall can remain connect-src self.
    # Provider calls happen directly in the browser; nginx carries only
    # the live companion endpoints.
    # X-Forwarded-For is OVERWRITTEN with $remote_addr (not appended): the
    # companion server trusts the header only when TRUST_PROXY=1, so an
    # attacker must never be able to inject their own value.
    # CRITICAL: the api service listens on 8787 (compose sets PORT: 8787;
    # Dockerfile EXPOSE 8787). A bare 'http://bookmarkforge_api' would
    # resolve to port 80 and nginx would 502 every /api request. The port
    # must match the api's PORT env in docker-compose.prod.yml and
    # docker-compose.staging.yml.
    # proxy_connect_timeout 5s (vs nginx default 60s): with the api down,
    # nginx otherwise holds every request for a minute before 502, hanging
    # health checks, smoke and monitoring-alerts. Fail fast = detect fast.
    location ^~ /api/license/ {
        proxy_pass http://bookmarkforge_api:8787;
        proxy_http_version 1.1;
        proxy_connect_timeout 5s;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_read_timeout 30s;
        proxy_send_timeout 30s;
        proxy_buffering off;
    }

    location = /csp-report {
        proxy_pass http://bookmarkforge_api:8787/csp-report;
        proxy_http_version 1.1;
        proxy_connect_timeout 5s;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_read_timeout 10s;
        proxy_send_timeout 10s;
        proxy_buffering off;
    }

    # Client events pipeline (storage-pressure / bundle-integrity-spike /
    # error-spike / csp-violation-spike): the PWA reporter POSTs here and the
    # monitoring cron reads the collector's threshold log. Without this rule
    # the endpoint is unreachable behind nginx and CLIENT_CRITICAL alerting
    # dies silently — the production-smoke check 'client-events accepts
    # csp-violation-spike' fails with 405/404.
    location = /api/client-events {
        proxy_pass http://bookmarkforge_api:8787/api/client-events;
        proxy_http_version 1.1;
        proxy_connect_timeout 5s;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_read_timeout 10s;
        proxy_send_timeout 10s;
        proxy_buffering off;
    }

    # Retry-stats diagnostics: the reporter POSTs cumulative delivery counters
    # here; without this rule the telemetry fell on the 426 catch-all and the
    # degraded-delivery alert (client_events_retry_degraded) was dead.
    location = /api/client-events/retry-stats {
        proxy_pass http://bookmarkforge_api:8787/api/client-events/retry-stats;
        proxy_http_version 1.1;
        proxy_connect_timeout 5s;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_read_timeout 10s;
        proxy_send_timeout 10s;
        proxy_buffering off;
    }

    location = /health {
        proxy_pass http://bookmarkforge_api:8787/health;
        proxy_http_version 1.1;
        proxy_connect_timeout 5s;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_read_timeout 10s;
        proxy_send_timeout 10s;
        proxy_buffering off;
    }

    # ── WebSocket signaling (wss://<domain>/) ────────────────────────
    # The PWA connects to the origin ROOT for signaling. nginx must route
    # the Upgrade to the companion server while every plain HTTP request
    # keeps the SPA fallback. The rewrite hops to an internal exact-match
    # location (an if-block cannot proxy_pass directly); the companion's ws
    # server accepts upgrades on any path.
    location = /_ws_ {
        proxy_pass http://bookmarkforge_api:8787;
        proxy_http_version 1.1;
        proxy_connect_timeout 5s;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    # ── Long-cache immutable assets (hashed by Vite) ─────────────────
    location /assets/ {
        # Repeat security headers: location-scoped add_header overrides
        # server-level inheritance (see note at the server block above).
${repeat}
        add_header Cache-Control "public, max-age=31536000, immutable";
        try_files $uri =404;
    }

    # ── HTML entry points — always revalidate (mirrors public/_headers) ──
    location ~*\\.html$ {
        # Repeat security headers (inheritance override — see server block).
        # The SPA's index.html is the security-critical entry: losing CSP here
        # would let the HTML render without any policy on the Docker path.
${repeat}
        add_header Cache-Control "no-cache, must-revalidate";
    }

    # ── Locale JSON / manifests — brief cache, stale-while-revalidate ──
    location ~*\\.json$ {
        # Repeat security headers (inheritance override — see server block).
${repeat}
        add_header Cache-Control "public, max-age=86400, stale-while-revalidate=604800";
    }

    # ── PWA service worker must NOT be cached (update safety) ───────
    location = /sw.js {
        # Repeat security headers (inheritance override — see server block).
${repeat}
        add_header Cache-Control "no-cache, must-revalidate";
    }

    # ── Landing pages (SEO) — static HTML at clean URLs ─────────────
    # The marketing landing (public/landing.html) is the only indexable
    # content: serve it at / with an INTERNAL 200 rewrite so the canonical
    # URL stays https://<domain>/ instead of the private SPA shell (which
    # is noindexed — see robots.txt). /es/ is the Spanish landing
    # (hreflang pair of the English one). Both files are plain .html, so
    # the ~*.html$ location below applies the security headers and the
    # no-cache Cache-Control automatically.
    # WebSocket upgrades to the root (same-origin signaling) must keep
    # routing to /_ws_ exactly as before — only plain HTTP goes to the
    # landing page.
    # Language negotiation with a manual preference override. Order in
    # location = /: (1) explicit ?lang= choice wins over everything — it
    # sets a persistent preference cookie (internal /_lang/<lang> target)
    # and bounces to the clean URL; (2) the bf_lang cookie (set by ?lang=
    # or landing.js) overrides Accept-Language so a manual choice stops
    # the redirect from bouncing the user back; (3) only visitors WITHOUT
    # a preference cookie get Accept-Language negotiation (internal
    # /_negotiate): a browser whose PRIMARY language is one of the
    # localized landings gets a 302 to it (/fr/, /es/, ...). 302 (not 301)
    # on purpose — language negotiation must stay temporary so search
    # engines keep the en canonical at / (Google's guidance). Covers
    # "fr-FR,fr;q=0.9" and "FR" alike (case-insensitive ^ match). Kept in
    # sync with functions/_middleware.js (Cloudflare Pages) and
    # scripts/check-seo.mjs.
    location = / {
        if ($http_upgrade != "") {
            rewrite ^ /_ws_ last;
        }
${PREF_LANGS.map(
      (lang) => `        if ($arg_lang ~* "^${lang}$") { rewrite ^ /_lang/${lang} last; }`,
    ).join("\n")}
${LANDING_LANGS.map(
      (lang) => `        if ($cookie_bf_lang ~* "^${lang}$") { rewrite ^ /${lang}/ redirect; }`,
    ).join("\n")}
        if ($cookie_bf_lang = "") {
            rewrite ^ /_negotiate last;
        }
        # Cookie present with no redirect of its own (en, or a stale value):
        # EN landing, no negotiation (a manual choice never bounces).
        rewrite ^ /landing.html last;
    }

    # Internal: Accept-Language negotiation ONLY for visitors without a
    # preference cookie (first visit). Keeping it out of location = / makes
    # a cookie=en choice short-circuit negotiation entirely.
    location = /_negotiate {
        internal;
${LANDING_LANGS.map(
      (lang) => `        if ($http_accept_language ~* "^${lang}") { rewrite ^ /${lang}/ redirect; }`,
    ).join("\n")}
        rewrite ^ /landing.html last;
    }

    # /_lang/<lang> — internal targets of the ?lang= choice: set the
    # persistent preference cookie (bf_lang read by this config and the
    # Cloudflare middleware; nf_lang is Netlify's native override for its
    # Language conditions) and 302 to the clean landing URL (no query).
    # Security headers are repeated because location-scoped add_header
    # overrides server-level inheritance (see server block above).
${langPrefLocations}

${LANDING_LANGS.map(
      (lang) => `    location = /${lang} {
        rewrite ^ /${lang}.html last;
    }

    location = /${lang}/ {
        rewrite ^ /${lang}.html last;
    }`,
    ).join("\n\n")}

    # Help Center — static HTML at clean URLs (EN-only; localized help is hreflang only, not routed)
    location = /help {
        rewrite ^ /help.html last;
    }

    location = /help/ {
        rewrite ^ /help.html last;
    }

    # Pocket comparison page (SEO) — static HTML at a clean URL
    location = /pocket-alternative {
        rewrite ^ /pocket-alternative.html last;
    }

    # ── SPA fallback + WebSocket routing ─────────────────────────────
    location / {
        if ($http_upgrade != "") {
            rewrite ^ /_ws_ last;
        }
        try_files $uri $uri/ /index.html;
    }
}
`;
}

/**
 * Surgical Cloudflare-Pages _headers localisation (A9-1).
 *
 * public/_headers is HAND-MAINTAINED: Cloudflare Pages applies only the
 * most-specific rule's headers, so each path block repeats all security
 * headers and the file carries per-path prose comments the renderer cannot
 * reproduce. This function therefore rewrites ONLY the value of the three
 * CSP-derived header keys, everywhere they occur, and never adds, moves or
 * deletes lines. If any of the three keys is absent entirely, that is a
 * security regression in the file — refuse loudly instead of "repairing"
 * around it.
 *
 * The rewrite is idempotent and bounded by the key names: prose comments
 * (e.g. the `https://license.<domain>` note) and non-CSP headers
 * (X-Robots-Tag noindex blocks, Cache-Control) are never touched.
 */
export function rewriteHeadersCspValues(existing, csp = CSP_MODERATE) {
  if (existing === null) return null;
  const entries = [
    ["Reporting-Endpoints", REPORTING_ENDPOINTS_HEADER],
    ["Report-To", REPORT_TO_HEADER],
    ["Content-Security-Policy", csp],
  ];
  // Guard: report EVERY missing CSP-derived key at once (an operator
  // restoring the file wants the full list, not one failure per run).
  const missing = entries.filter(([key]) => !new RegExp(`^[ \\t]*${key}:`, "m").test(existing));
  if (missing.length > 0) {
    throw new Error(
      `public/_headers: no ${missing.map(([k]) => `"${k}:"`).join(", ")} header line(s) found — the file looks damaged or was restructured; refusing to rewrite (restore it from git and edit by hand)`,
    );
  }
  let out = existing;
  for (const [key, value] of entries) {
    // The value may contain double quotes (Report-To is JSON), so capture
    // the whole rest of the line. `([ \t]*\r?)$` preserves the line's EOL
    // (and any trailing spaces) exactly as committed.
    const re = new RegExp(`^([ \\t]*${key}: )(.*\\S)([ \\t]*\\r?)$`, "gm");
    let hits = 0;
    out = out.replace(re, (_m, prefix, oldValue, eol) => {
      hits += 1;
      // Already canonical → byte-identical no-op (keeps idempotency and the
      // EOL/trailing-space tail untouched).
      return oldValue === value ? `${prefix}${oldValue}${eol}` : `${prefix}${value}${eol}`;
    });
    if (hits === 0) {
      throw new Error(
        `public/_headers: no "${key}:" header line found — the file looks damaged or was restructured; refusing to rewrite (restore it from git and edit by hand)`,
      );
    }
  }
  return out;
}

/**
 * Surgical sitemap.xml localisation (A9-1).
 *
 * public/sitemap.xml is HAND-MAINTAINED (61 <url> entries across 30
 * languages, pinned by scripts/check-seo.mjs — the old renderSitemap()
 * generator with its 13-URL/6-language template was deleted as obsolete and
 * dangerous). This function rewrites ONLY the URL host inside <loc>…
 * </loc> elements and inside xhtml:link href="…" attributes, preserving
 * paths, lastmod, changefreq, priority and structure. Namespace URIs
 * (xmlns="http://www.w3.org/…" and sitemaps.org) live in xmlns attributes,
 * which this function never matches, so they survive untouched.
 */
export function replaceSitemapLocs(existing, domain = APP_DOMAIN) {
  if (existing === null) return null;
  if (!existing.includes("<urlset")) {
    throw new Error(
      "public/sitemap.xml: no <urlset> element — this does not look like the committed sitemap; refusing to rewrite",
    );
  }
  let touched = 0;
  let out = existing.replace(
    /(<loc>)(https?:\/\/)([^/<\s]+)([^<]*)(<\/loc>)/g,
    (_m, pre, _scheme, _host, path, close) => {
      touched += 1;
      return `${pre}https://${domain}${path}${close}`;
    },
  );
  out = out.replace(
    /(<xhtml:link\b[^>]*\bhref=")(https?:\/\/)([^/<"\s]+)([^"]*)(")/g,
    (_m, pre, _scheme, _host, path, close) => {
      touched += 1;
      return `${pre}https://${domain}${path}${close}`;
    },
  );
  if (touched === 0) {
    throw new Error(
      "public/sitemap.xml: no <loc> or xhtml:link URLs found — refusing to rewrite",
    );
  }
  return out;
}

/** Render public/robots.txt with the current deployment domain. */
export function renderRobotsTxt(domain = APP_DOMAIN) {
  return `# robots.txt for BookmarkForge

# Only the marketing landing (served at / and /es/) is indexable content.
# The app is a private local-first vault behind /app — its routes render an
# empty SPA shell, so nothing under the app must be crawled.

User-agent: *
Allow: /

# Private app routes (local-first vault — no indexable content)
Disallow: /app
Disallow: /capture
Disallow: /offline
Disallow: /api

Sitemap: https://${domain}/sitemap.xml
`;
}

/**
 * Render the CSP-derived header values in netlify.toml.
 *
 * netlify.toml is NOT generated wholesale: its TOML sections, per-path
 * header blocks, redirects, and decorative comments are static. Only the
 * three CSP-derived values (Reporting-Endpoints, Report-To, and
 * Content-Security-Policy) come from csp-config.js, so a
 * BOOKMARKFORGE_DOMAIN change propagates here in one --write without
 * touching the rest of the file.
 */
function renderNetlifyToml(existing, csp = CSP_MODERATE) {
  if (existing === null) {
    throw new Error(
      "[nginx-render] netlify.toml is missing — restore it from git before running --write",
    );
  }
  return existing
    .replace(
      /^([ \t]*Reporting-Endpoints = )[^\r\n]*$/m,
      `$1'${REPORTING_ENDPOINTS_HEADER}'`,
    )
    .replace(
      /^([ \t]*Report-To = )[^\r\n]*$/m,
      `$1'${REPORT_TO_HEADER}'`,
    )
    .replace(
      /^([ \t]*Content-Security-Policy = )[^\r\n]*$/m,
      `$1"${csp}"`,
    );
}

// ---------------------------------------------------------------------------
// Surgical domain-localisation renderers.
//
// These files are NOT generated wholesale — they contain static prose, HTML
// structure, JSON keys, and comments that must survive untouched.  Only the
// domain-bearing lines are replaced so a BOOKMARKFORGE_DOMAIN change
// propagates everywhere with a single `npm run nginx:render`.
// ---------------------------------------------------------------------------

function replaceDefaultBaseUrlJs(existing, domain) {
  if (existing === null) return null;
  return existing.replace(
    /(const DEFAULT_BASE_URL = ")https?:\/\/[^"]+(";)/g,
    `$1https://${domain}$2`,
  );
}

function replaceDomainInFile(existing, domain) {
  if (existing === null) return null;
  // Replace EVERY https?://domain except the W3C XML namespace URIs
  // (xmlns="http://www.w3.org/...") which must never be localised.
  // The negative lookahead guards against false positives from SVG
  // and XHTML namespace declarations embedded in HTML5 files.
  return existing.replace(
    /https?:\/\/(?!www\.w3\.org)([a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(?:\.[a-z]{2,})?)(?=[\/"'\\s<>)]|$)/gi,
    `https://${domain}`,
  );
}

/** Replace only a top-level JSON string field value. Never touches nested
 *  objects — safe for manifests whose CSP lives in a separate value. */
function replaceManifestField(existing, field, domain) {
  if (existing === null) return null;
  return existing.replace(
    new RegExp(`("${field}"\\s*:\\s*")(https?:\\/\\/)[^"]+(")`, "g"),
    `$1https://${domain}$3`,
  );
}

const TARGETS_SURGICAL = [
  // ── Public static pages (canonical links) ─────────────────────────
  {
    label: "public/404.html",
    render: (existing) => replaceDomainInFile(existing, APP_DOMAIN),
  },
  {
    label: "public/privacy-and-terms.html",
    render: (existing) => replaceDomainInFile(existing, APP_DOMAIN),
  },
  // Localized legal pages (canonical/hreflang/OG links carry the domain).
  // EN's root page is handled explicitly above; the rest come from the
  // registry's reviewed legal set — the same six check-seo and the hreflang
  // graph use, so a legal locale cannot be added to one and missed here.
  ...REGISTRY_LEGAL.filter((lang) => lang !== "en").map((lang) => ({
    label: `public/${lang}/privacy-and-terms.html`,
    render: (existing) => replaceDomainInFile(existing, APP_DOMAIN),
  })),
  // ── PWA manifest (related_applications url) ───────────────────────
  {
    label: "public/manifest.json",
    render: (existing) => replaceDomainInFile(existing, APP_DOMAIN),
  },
  // ── Extension JS (DEFAULT_BASE_URL default) ───────────────────────
  {
    label: "extension/background.js",
    render: (existing) => replaceDefaultBaseUrlJs(existing, APP_DOMAIN),
  },
  {
    label: "extension/popup.js",
    render: (existing) => replaceDefaultBaseUrlJs(existing, APP_DOMAIN),
  },
  // ── Extension HTML (placeholder + privacy link) ───────────────────
  {
    label: "extension/popup.html",
    render: (existing) => replaceDomainInFile(existing, APP_DOMAIN),
  },
  // ── Extension manifests (homepage_url only; CSP is handled by check-extension-csp.mjs) ─
  {
    label: "extension/manifest.json",
    render: (existing) => replaceManifestField(existing, "homepage_url", APP_DOMAIN),
  },
  {
    label: "extension/manifest-firefox.json",
    render: (existing) => replaceManifestField(existing, "homepage_url", APP_DOMAIN),
  },
  // ── Extension privacy policy (the last manual-only file goes automated) ──
  {
    label: "extension/PRIVACY.md",
    render: (existing) => replaceDomainInFile(existing, APP_DOMAIN),
  },
];

function normalize(s) {
  return s.replace(/[ \t]+$/gm, "").replace(/\r\n/g, "\n");
}

const targets = [
  { label: "public/nginx.conf", render: () => renderNginxPolicy() },
  { label: "public/_headers", render: (existing) => rewriteHeadersCspValues(existing) },
  { label: "netlify.toml", render: (existing) => renderNetlifyToml(existing) },
  { label: "public/sitemap.xml", render: (existing) => replaceSitemapLocs(existing) },
  { label: "public/robots.txt", render: () => renderRobotsTxt() },
  ...TARGETS_SURGICAL,
];

function main() {
  const write = process.argv.includes("--write");
  const plan = [];
  let drift = 0;
  for (const target of targets) {
    const path = join(ROOT, target.label);
    const existing = existsSync(path) ? readFileSync(path, "utf8") : null;
    if (existing === null) {
      console.error(`[nginx-render] FAIL ${target.label}: file missing (run --write)`);
      drift += 1;
      plan.push({ label: target.label, status: "missing" });
      continue;
    }
    let rendered;
    try {
      rendered = target.render(existing);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[nginx-render] FAIL ${target.label}: ${message}`);
      drift += 1;
      plan.push({ label: target.label, status: "error" });
      continue;
    }
    if (normalize(existing) === normalize(rendered)) {
      console.log(`[nginx-render] ok ${target.label}: rendered output matches committed copy`);
      plan.push({ label: target.label, status: "ok", content: rendered });
    } else {
      console.error(`[nginx-render] DRIFT ${target.label}: rendered output differs (run --write)`);
      drift += 1;
      plan.push({ label: target.label, status: "drift", content: rendered });
    }
  }

  if (!write) {
    if (drift > 0) process.exit(1);
    return;
  }

  // All-or-nothing: a safety guard refused to render a target, so no file
  // may be written. scripts/rollback.mjs runs --write during incidents —
  // a half-repaired tree would be worse than the drift it started with.
  const errors = plan.filter((p) => p.status === "error");
  if (errors.length > 0) {
    console.error(
      `[nginx-render] ABORT --write: ${errors.length} target(s) failed their safety checks — nothing was written (all-or-nothing)`,
    );
    process.exit(1);
  }

  for (const item of plan) {
    if (item.status === "missing") {
      console.error(`[nginx-render] SKIP ${item.label}: file not found (repo-only target)`);
      continue;
    }
    writeFileSync(join(ROOT, item.label), item.content);
    console.log(`[nginx-render] wrote ${item.label}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
