/**
 * scripts/nginx-render.mjs — render every static file that carries the
 * deployment domain from the canonical CSP in csp-config.js:
 *   - public/nginx.conf (self-hosted nginx server block)
 *   - public/_headers  (Cloudflare Pages security headers)
 *   - netlify.toml     (Netlify CSP-derived header lines, surgical)
 *   - public/sitemap.xml
 *   - public/robots.txt
 *   - public/404.html, public/privacy-and-terms.html (canonical links, surgical)
 *   - public/manifest.json (related_applications url, surgical)
 *   - extension/PRIVACY.md (privacy policy domain refs, surgical)
 *   - extension/*.js, extension/*.html, extension/manifest*.json (surgical)
 *
 * The rendered files must stay byte-identical to the committed copies
 * (the check-csp-sync.mjs gate validates them). A BOOKMARKFORGE_DOMAIN
 * change propagates to every deployment path with a single --write.
 *
 * Usage:
 *   node scripts/nginx-render.mjs            # verify (fail on drift)
 *   node scripts/nginx-render.mjs --write    # rewrite all targets
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  APP_DOMAIN,
  CSP_MODERATE,
  COEP,
  COOP,
  REPORT_TO_HEADER,
  REPORTING_ENDPOINTS_HEADER,
} from "./csp-config.js";

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

/** Render the nginx server block (matches public/nginx.conf). */
export function renderNginxPolicy(csp = CSP_MODERATE) {
  const pre = SECURITY_HEADERS.slice(0, -1)
    .map((h) => `    ${h}`)
    .join("\n");
  const cspHeader = `    add_header Content-Security-Policy "${csp}" always;`;
  const repeat = SECURITY_HEADERS.map((h) => `        ${h}`).join("\n");

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
    location = /api/services/ai/session {
        proxy_pass http://bookmarkforge_api:8787/api/services/ai/session;
        proxy_http_version 1.1;
        proxy_connect_timeout 5s;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 10s;
        proxy_send_timeout 10s;
        proxy_buffering off;
    }

    # Keep AI/license/CSP traffic on the app origin so the browser CSP and
    # firewall can remain connect-src self. Streaming AI must not be
    # buffered by nginx.
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
    location = /api/services/ai/generate {
        proxy_pass http://bookmarkforge_api:8787/api/services/ai/generate;
        proxy_http_version 1.1;
        proxy_connect_timeout 5s;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
        proxy_buffering off;
    }

    location = /api/services/ai/generate-tts {
        proxy_pass http://bookmarkforge_api:8787/api/services/ai/generate-tts;
        proxy_http_version 1.1;
        proxy_connect_timeout 5s;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_read_timeout 90s;
        proxy_send_timeout 90s;
        proxy_buffering off;
    }

    location = /api/services/ai/generate-image {
        proxy_pass http://bookmarkforge_api:8787/api/services/ai/generate-image;
        proxy_http_version 1.1;
        proxy_connect_timeout 5s;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
        proxy_buffering off;
    }

    location = /api/services/ai/admin {
        proxy_pass http://bookmarkforge_api:8787/api/services/ai/admin;
        proxy_http_version 1.1;
        proxy_connect_timeout 5s;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_read_timeout 30s;
        proxy_send_timeout 30s;
    }

    location = /api/services/ai/metrics {
        proxy_pass http://bookmarkforge_api:8787/api/services/ai/metrics;
        proxy_http_version 1.1;
        proxy_connect_timeout 5s;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_read_timeout 30s;
        proxy_send_timeout 30s;
    }

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

/** Render the Cloudflare Pages _headers file (matches public/_headers). */
export function renderHeaders(csp = CSP_MODERATE) {
  return `# P49: Cache-Control strategy for static assets.
# Content-hashed assets under /assets/ are immutable (fingerprinted by Vite).
# HTML may change across deployments; validate with origin before serving.

# Immutable content-hashed assets (JS, CSS, fonts, images, workers)
/assets/*
  Cache-Control: public, max-age=31536000, immutable

# HTML entry points — always revalidate with origin
/*.html
  Cache-Control: no-cache, must-revalidate

# Locale JSON and manifest — cache briefly, stale-while-revalidate for offline
/*.json
  Cache-Control: public, max-age=86400, stale-while-revalidate=604800

# Service worker — never cache (Workbox manages its own lifecycle)
/sw.js
  Cache-Control: no-cache, must-revalidate

# SECURITY: Only the custom domain \`https://license.${APP_DOMAIN}\` is allowed.
# No workers.dev wildcard — that would match attacker-controlled subdomains.
/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
  Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()
  Cross-Origin-Embedder-Policy: ${COEP}
  Cross-Origin-Opener-Policy: ${COOP}
  Reporting-Endpoints: ${REPORTING_ENDPOINTS_HEADER}
  Report-To: ${REPORT_TO_HEADER}
  Content-Security-Policy: ${csp}

/payment/*
  X-Robots-Tag: noindex

/pricing/*
  X-Robots-Tag: noindex
`;
}

/** Render public/sitemap.xml with the current deployment domain. */
export function renderSitemap(domain = APP_DOMAIN) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://${domain}/</loc>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>https://${domain}/app</loc>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
  </url>
</urlset>
`;
}

/** Render public/robots.txt with the current deployment domain. */
export function renderRobotsTxt(domain = APP_DOMAIN) {
  return `# robots.txt for BookmarkForge

User-agent: *
Allow: /

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
    /https?:\/\/(?!www\.w3\.org)([a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(?:\.[a-z]{2,})?)(?=[\/"'\s<>)]|$)/gi,
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
  { label: "public/_headers", render: () => renderHeaders() },
  { label: "netlify.toml", render: (existing) => renderNetlifyToml(existing) },
  { label: "public/sitemap.xml", render: () => renderSitemap() },
  { label: "public/robots.txt", render: () => renderRobotsTxt() },
  ...TARGETS_SURGICAL,
];

let drift = 0;
for (const target of targets) {
  const path = join(ROOT, target.label);
  const existing = existsSync(path) ? readFileSync(path, "utf8") : null;
  const rendered = target.render(existing);
  if (existing === null) {
    console.error(`[nginx-render] FAIL ${target.label}: file missing (run --write)`);
    drift += 1;
    continue;
  }
  if (normalize(existing) === normalize(rendered)) {
    console.log(`[nginx-render] ok ${target.label}: rendered output matches committed copy`);
  } else {
    console.error(`[nginx-render] DRIFT ${target.label}: rendered output differs (run --write)`);
    drift += 1;
  }
}

if (process.argv.includes("--write")) {
  for (const target of targets) {
    const path = join(ROOT, target.label);
    if (!existsSync(path)) {
      console.error(`[nginx-render] SKIP ${target.label}: file not found (repo-only target)`);
      continue;
    }
    const existing = readFileSync(path, "utf8");
    writeFileSync(path, target.render(existing));
    console.log(`[nginx-render] wrote ${target.label}`);
  }
} else if (drift > 0) {
  process.exit(1);
}
