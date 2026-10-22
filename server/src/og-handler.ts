/**
 * server/src/og-handler.ts — Open Graph card generation for social sharing.
 *
 * This handler generates dynamic SVG-based Open Graph cards for BookmarkForge
 * links shared on social media (Twitter/X, Reddit, etc.). It uses pure SVG
 * generation (no native Canvas dependencies) to work across all platforms.
 *
 * Route: GET /og?title=...&type=...&stats=...
 * Returns: HTML with Open Graph meta tags + SVG preview
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
  type?: "graph" | "document" | "bookmark";
  stats?: string;
}

/** ADR-067: the only type values that ever reach the template. */
const OG_TYPES: ReadonlySet<string> = new Set(["graph", "document", "bookmark"]);

function parseOgParams(url: string | undefined): OgParams {
  if (!url) return {};
  try {
    const urlObj = new URL(url, "http://localhost");
    // ADR-067: `type` is validated against the allowlist — the raw query
    // value must never reach the SVG/HTML template (reflected XSS).
    const rawType = urlObj.searchParams.get("type") ?? "";
    return {
      title: urlObj.searchParams.get("title") || undefined,
      type: OG_TYPES.has(rawType) ? (rawType as OgParams["type"]) : undefined,
      stats: urlObj.searchParams.get("stats") || undefined,
    };
  } catch {
    // INTENTIONAL SILENCE: a malformed request URL (e.g. absolute-form with
    // an invalid host) must not reject the async handler — `void` dispatch
    // would turn it into an unhandledRejection and take the process down.
    // Fail closed to the default card.
    return {};
  }
}

function generateSvgCard(params: OgParams): string {
  const title = params.title || "BookmarkForge";
  const type = params.type || "document";
  const stats = params.stats || "";

  // Color scheme based on type
  const accentColor = type === "graph" ? "#06b6d4" : // cyan
                      type === "document" ? "#8b5cf6" : // violet
                      "#f59e0b"; // amber for bookmarks

  return `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#0f172a" stop-opacity="1" />
        <stop offset="100%" stop-color="#1e293b" stop-opacity="1" />
      </linearGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#grad)" />
    
    <!-- Decorative background pattern -->
    <circle cx="100" cy="100" r="200" fill="${accentColor}" opacity="0.1" />
    <circle cx="1100" cy="530" r="150" fill="${accentColor}" opacity="0.1" />
    
    <!-- BookmarkForge logo area -->
    <rect x="60" y="60" width="60" height="60" rx="12" fill="${accentColor}" />
    <path d="M90 85 L90 95 L85 92 L90 85" fill="white" opacity="0.9" />
    
    <!-- Title -->
    <text x="60" y="200" font-family="system-ui, -apple-system, sans-serif" font-size="48" font-weight="bold" fill="white">
      ${escapeXml(title.substring(0, 50))}
    </text>
    
    <!-- Type badge -->
    <rect x="60" y="240" width="120" height="36" rx="18" fill="${accentColor}" opacity="0.2" />
    <text x="120" y="265" font-family="system-ui, -apple-system, sans-serif" font-size="16" font-weight="600" fill="${accentColor}" text-anchor="middle">
      ${escapeXml(type.toUpperCase())}
    </text>
    
    <!-- Stats if provided -->
    ${stats ? `<text x="60" y="320" font-family="system-ui, -apple-system, sans-serif" font-size="20" fill="#94a3b8">
      ${escapeXml(stats.substring(0, 80))}
    </text>` : ''}
    
    <!-- Footer -->
    <text x="60" y="570" font-family="system-ui, -apple-system, sans-serif" font-size="16" fill="#64748b">
      bookmarkforge.com — Your private AI knowledge vault
    </text>
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

export function createOgHandler() {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const params = parseOgParams(req.url);

    // Generate SVG card
    const svgCard = generateSvgCard(params);

    // Return HTML with Open Graph meta tags
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeXml(params.title || "BookmarkForge")}</title>
  
  <!-- Open Graph / Facebook -->
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${escapeXml(params.title || "BookmarkForge")}" />
  <meta property="og:description" content="Your private, AI-powered knowledge vault. 100% Local-First." />
  <meta property="og:image" content="data:image/svg+xml;base64,${Buffer.from(svgCard).toString("base64")}" />
  
  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeXml(params.title || "BookmarkForge")}" />
  <meta name="twitter:description" content="Your private, AI-powered knowledge vault. 100% Local-First." />
  <meta name="twitter:image" content="data:image/svg+xml;base64,${Buffer.from(svgCard).toString("base64")}" />
</head>
<body bgcolor="#0f172a" text="#ffffff" marginwidth="0" marginheight="0">
  ${svgCard}
</body>
</html>`;

    // ADR-067: strict security headers (CSP default-src 'none', nosniff,
    // frame denial) — the card renders from presentation attributes only.
    applySecurityHeaders(res);
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=3600", // Cache for 1 hour
    });
    res.end(html);
  };
}
