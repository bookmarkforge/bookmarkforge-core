/**
 * server/src/og-handler.ts — Open Graph card generation for social sharing.
 *
 * Two endpoints:
 *   GET /og            -> HTML wrapper with complete OG + Twitter meta tags
 *   GET /og-image.svg  -> The SVG card image served with Content-Type: image/svg+xml
 *
 * Why a real image URL instead of data:image/svg+xml;base64: LinkedIn and X/Twitter
 * fetch og:image as a standalone HTTP request. Many crawlers (including LinkedIn's)
 * do not follow or render data URIs reliably, which results in a broken/blank card.
 * A real URL guarantees the card renders everywhere.
 *
 * Route: GET /og?title=...&desc=...&type=...&locale=...&image=...
 *        GET /og-image.svg?title=...&type=...
 * Returns: HTML wrapper or SVG image with strict security headers.
 *
 * ADR-067: query parameters are untrusted input. `type` is allowlisted before
 * it reaches the template, every interpolated string goes through escapeXml,
 * the card markup uses SVG presentation attributes (no inline styles, so the
 * strict `default-src 'none'` CSP renders it fully), and the response carries
 * the standard strict security headers. Malformed request URLs fail closed to
 * the default card instead of rejecting the handler promise.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { applySecurityHeaders } from "./proxy-utils";

interface OgParams {
  title?: string;
  desc?: string;
  type?: "graph" | "document" | "bookmark";
  locale?: string;
  image?: string; // external URL override for og:image / twitter:image
}

/** ADR-067: the only type values that ever reach the template. */
const OG_TYPES: ReadonlySet<string> = new Set(["graph", "document", "bookmark"]);

const DEFAULT_TITLE = "BookmarkForge";
const DEFAULT_DESC = "Your private, AI-powered knowledge vault. 100% Local-First.";
const DEFAULT_IMAGE_URL = "https://bookmarkforgeapp.com/og-image.png";
const SITE_NAME = "BookmarkForge";
const SITE_URL = "https://bookmarkforgeapp.com";
const CARD_WIDTH = 1200;
const CARD_HEIGHT = 630;
const CARD_ALT = "BookmarkForge — private AI-powered bookmark and notes app";

function parseOgParams(url: string | undefined): OgParams {
  if (!url) return {};
  try {
    const urlObj = new URL(url, "http://localhost");
    // ADR-067: `type` is validated against the allowlist — the raw query
    // value must never reach the SVG/HTML template (reflected XSS).
    const rawType = urlObj.searchParams.get("type") ?? "";
    return {
      title: urlObj.searchParams.get("title") || undefined,
      desc: urlObj.searchParams.get("desc") || undefined,
      type: OG_TYPES.has(rawType) ? (rawType as OgParams["type"]) : undefined,
      locale: urlObj.searchParams.get("locale") || undefined,
      image: urlObj.searchParams.get("image") || undefined,
    };
  } catch {
    // INTENTIONAL SILENCE: a malformed request URL must not reject the async
    // handler — fail closed to the default card.
    return {};
  }
}

function generateSvgCard(params: OgParams): string {
  const title = (params.title || DEFAULT_TITLE).substring(0, 60);
  const type = params.type || "document";
  const accentColor = type === "graph" ? "#06b6d4" : // cyan
                      type === "document" ? "#8b5cf6" : // violet
                      "#f59e0b"; // amber for bookmarks

  return `<svg width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#0f172a" stop-opacity="1" />
        <stop offset="100%" stop-color="#1e293b" stop-opacity="1" />
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#grad)" />

    <!-- Decorative background pattern -->
    <circle cx="120" cy="120" r="220" fill="${accentColor}" opacity="0.08" />
    <circle cx="1080" cy="510" r="180" fill="${accentColor}" opacity="0.08" />

    <!-- BookmarkForge logo mark -->
    <rect x="80" y="80" width="72" height="72" rx="16" fill="${accentColor}" />
    <text x="116" y="132" font-family="system-ui, -apple-system, sans-serif" font-size="40" font-weight="800" fill="#ffffff" text-anchor="middle">BF</text>

    <!-- Title -->
    <text x="80" y="260" font-family="system-ui, -apple-system, sans-serif" font-size="52" font-weight="800" fill="#ffffff">${escapeXml(title)}</text>

    <!-- Type badge -->
    <rect x="80" y="300" width="140" height="40" rx="20" fill="${accentColor}" opacity="0.15" />
    <text x="150" y="330" font-family="system-ui, -apple-system, sans-serif" font-size="18" font-weight="700" fill="${accentColor}" text-anchor="middle">${escapeXml(type.toUpperCase())}</text>

    <!-- Footer -->
    <text x="80" y="580" font-family="system-ui, -apple-system, sans-serif" font-size="18" fill="#94a3b8">${SITE_URL} · Private AI knowledge vault</text>
  </svg>`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Serve the SVG card image with the correct Content-Type. */
async function handleOgImage(req: IncomingMessage, res: ServerResponse, params: OgParams): Promise<void> {
  const svgCard = generateSvgCard(params);

  applySecurityHeaders(res);
  res.writeHead(200, {
    "Content-Type": "image/svg+xml; charset=utf-8",
    "Cache-Control": "public, max-age=3600", // Cache for 1 hour — social crawlers re-fetch rarely
  });
  res.end(svgCard);
}

/** Serve an HTML wrapper with complete Open Graph + Twitter Card meta tags. */
async function handleOgPage(req: IncomingMessage, res: ServerResponse, params: OgParams): Promise<void> {
  const title = escapeXml(params.title || DEFAULT_TITLE);
  const desc = escapeXml(params.desc || DEFAULT_DESC);
  const imageUrl = escapeXml(params.image || DEFAULT_IMAGE_URL);
  const locale = escapeXml(params.locale || "en_US");
  const cardUrl = `${SITE_URL}/og-image.svg?title=${encodeURIComponent(params.title || DEFAULT_TITLE)}&type=${encodeURIComponent(params.type || "document")}`;

  const html = `<!DOCTYPE html>
<html lang="${locale}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>

  <!-- Open Graph / Facebook & LinkedIn -->
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="${SITE_NAME}" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${desc}" />
  <meta property="og:url" content="${SITE_URL}/" />
  <meta property="og:image" content="${imageUrl}" />
  <meta property="og:image:secure_url" content="${imageUrl}" />
  <meta property="og:image:type" content="image/png" />
  <meta property="og:image:width" content="${CARD_WIDTH}" />
  <meta property="og:image:height" content="${CARD_HEIGHT}" />
  <meta property="og:image:alt" content="${escapeXml(CARD_ALT)}" />
  <meta property="og:locale" content="${locale}" />
  <meta property="og:locale:alternate" content="en_US" />

  <!-- Twitter Cards -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:site" content="@bookmarkforge" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${desc}" />
  <meta name="twitter:image" content="${imageUrl}" />
  <meta name="twitter:image:alt" content="${escapeXml(CARD_ALT)}" />
</head>
<body bgcolor="#0f172a" text="#ffffff" marginwidth="0" marginheight="0">
  <img src="${cardUrl}" alt="${escapeXml(CARD_ALT)}" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" />
</body>
</html>`;

  applySecurityHeaders(res);
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "public, max-age=3600",
  });
  res.end(html);
}

export function createOgHandler() {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = req.url ?? "";
    const path = url.split("?")[0];
    const params = parseOgParams(url);

    // Route to the SVG image endpoint or the HTML wrapper endpoint.
    if (path === "/og-image.svg" || path === "/og-image.svg/") {
      return handleOgImage(req, res, params);
    }

    return handleOgPage(req, res, params);
  };
}