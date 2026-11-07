#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";

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
  if (/add_header\s+Content-Security-Policy[^\n]*connect-src[^\n]*\*/i.test(nginx)) errors.push(`${nginxPath}: wildcard connect-src is forbidden`);
  if (/add_header\s+Content-Security-Policy[^\n]*\*[^\n]*connect-src/i.test(nginx)) errors.push(`${nginxPath}: wildcard connect-src present`);
  return { errors, warnings: [] };
}

const headersPath = "public/_headers";
const nginxPath = "public/nginx.conf";
const result = validateHttpConfig(existsSync(headersPath) ? readFileSync(headersPath, "utf8") : "", existsSync(nginxPath) ? readFileSync(nginxPath, "utf8") : "");
if (result.errors.length) { console.error("[validate-http-config] FAIL"); result.errors.forEach((error) => console.error(`- ${error}`)); process.exit(1); }
console.log("[validate-http-config] HTTP security configuration passed");
