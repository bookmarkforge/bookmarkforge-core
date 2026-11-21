#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * the canonical CSP carries exactly one wildcard,
 * `connect-src https://*.hf.co`, because Hugging Face serves model shards from
 * per-region subdomains (cdn-lfs.hf.co, cas-bridge.xethub.hf.co,...). This
 * gate allows that one scoped host and rejects every other wildcard, including
 * `*.jsdelivr.net`; keep the entry in sync with scripts/csp-config.js.
 */
const ALLOWED_CSP_WILDCARDS = new Set(["connect-src *.hf.co"]);

function findForbiddenCspWildcards(nginx) {
  const forbidden = new Set();
  const cspValues = [
    ...nginx.matchAll(/add_header\s+Content-Security-Policy\s+"([^"]*)"/gi),
  ].map((match) => match[1]);
  for (const csp of cspValues) {
    for (const directive of csp.split(";")) {
      const parts = directive.trim().split(/\s+/).filter(Boolean);
      if (parts.length === 0) continue;
      const name = parts[0].toLowerCase();
      for (const source of parts.slice(1)) {
        const host = source.replace(/^[a-z]+:\/\//i, "").replace(/\/$/, "");
        if (!host.startsWith("*")) continue;
        const wildcard = `${name} ${host}`;
        if (!ALLOWED_CSP_WILDCARDS.has(wildcard)) forbidden.add(wildcard);
      }
    }
  }
  return [...forbidden];
}

export function validateHttpConfig(headers, nginx) {
  const errors = [];
  const headersPath = "public/_headers";
  const nginxPath = "public/nginx.conf";
  for (const required of ["X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy", "Strict-Transport-Security", "Permissions-Policy", "Content-Security-Policy"]) {
    if (!headers.includes(required)) errors.push(`${headersPath}: missing ${required}`);
    if (!nginx.includes(required)) errors.push(`${nginxPath}: missing ${required}`);
  }
  if (!/Strict-Transport-Security:\s*[^\n]*max-age=\d+/i.test(headers)) errors.push(`${headersPath}: HSTS max-age missing`);
  if (!/Strict-Transport-Security:\s*[^\n]*includeSubDomains/i.test(headers)) errors.push(`${headersPath}: HSTS includeSubDomains missing`);
  if (!/add_header\s+Strict-Transport-Security\s+[^;]*max-age=\d+/i.test(nginx)) errors.push(`${nginxPath}: HSTS max-age missing`);
  if (!/add_header\s+Strict-Transport-Security\s+[^\n]*includeSubDomains/i.test(nginx)) errors.push(`${nginxPath}: HSTS includeSubDomains missing`);
  if (!/Content-Security-Policy:[^\n]*default-src\s+'self'/i.test(headers)) errors.push(`${headersPath}: CSP default-src self missing`);
  if (!/Content-Security-Policy:[^\n]*object-src\s+'none'/i.test(headers)) errors.push(`${headersPath}: CSP object-src none missing`);
  if (!/add_header\s+Content-Security-Policy\s+[^\n]*default-src\s+'self'/i.test(nginx)) errors.push(`${nginxPath}: CSP default-src self missing`);
  if (!/add_header\s+Content-Security-Policy\s+[^\n]*object-src\s+['"]?none['"]?/i.test(nginx)) errors.push(`${nginxPath}: CSP object-src none missing`);
  if (/proxy_pass\s+http:\/\/bookmarkforge_api(?!:)/i.test(nginx)) errors.push(`${nginxPath}: upstream proxy_pass lacks explicit port`);
  if (/add_header\s+Content-Security-Policy[^\n]*['"]unsafe-eval['"]/i.test(nginx)) errors.push(`${nginxPath}: unsafe-eval present in production CSP`);
  const forbiddenWildcards = findForbiddenCspWildcards(nginx);
  if (forbiddenWildcards.length > 0) errors.push(`${nginxPath}: wildcard CSP source is forbidden: ${forbiddenWildcards.join(", ")}`);
  return { errors, warnings: [] };
}

function main() {
  const headersPath = "public/_headers";
  const nginxPath = "public/nginx.conf";
  const result = validateHttpConfig(existsSync(headersPath) ? readFileSync(headersPath, "utf8") : "", existsSync(nginxPath) ? readFileSync(nginxPath, "utf8") : "");
  if (result.errors.length) { console.error("[validate-http-config] FAIL"); result.errors.forEach((error) => console.error(`- ${error}`)); process.exit(1); }
  console.log("[validate-http-config] HTTP security configuration passed");
}

// Import-safe: scripts/__tests__/validate-gates.test.mjs imports this module.
// The old module-scope body called process.exit(1) during import whenever the
// tree was red, killing the test process before its assertions ran.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
