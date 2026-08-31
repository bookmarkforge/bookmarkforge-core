#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function validateCompose(name, source) {
  const errors = [];
  if (!/^services:/m.test(source)) errors.push(`${name}: missing services root`);
  if (name.includes("prod")) {
    if (/image:\s+[^\n]*:\$\{IMAGE_TAG:-latest\}/.test(source)) errors.push(`${name}: production image defaults to mutable latest`);
    if (!/NODE_ENV:\s*production/.test(source)) errors.push(`${name}: production NODE_ENV missing`);
    if (!/AI_SESSION_REQUIRE_LICENSE:\s*\$\{[^}]+:-1\}/.test(source)) errors.push(`${name}: production license requirement must default to enabled`);
    if (!/AI_SESSION_ORIGINS:\s*\$\{[^}]+:\?AI_SESSION_ORIGINS is required\}/.test(source)) errors.push(`${name}: production AI session origins must be required`);
    if (!/TRUST_PROXY:\s*(?:["']?1["']?|\\\\?["']1\\\\?["']?)/.test(source)) errors.push(`${name}: production TRUST_PROXY must be explicitly enabled`);
    if (!/GEMINI_API_KEY:\s*\$\{[^}]+:\?/.test(source)) errors.push(`${name}: required server AI key contract missing`);
    if (!/secrets:\s*\[license_signing_key\]/.test(source)) errors.push(`${name}: signing key must use a Compose secret`);
    if (/^\s*-\s*"?(?!127\.0\.0\.1)[^"\n]*:\d+:/m.test(source)) errors.push(`${name}: production port should not be broadly published by default`);
  }
  if (name.includes("staging")) {
    if (!/NODE_ENV:\s*staging/.test(source)) errors.push(`${name}: staging NODE_ENV missing`);
    if (/AI_PROXY_REDIS_FAILURE_MODE:\s*fail-open/.test(source)) errors.push(`${name}: staging Redis failure mode must fail-closed`);
    if (!/127\.0\.0\.1:/.test(source)) errors.push(`${name}: staging published ports must bind loopback`);
    if (/bookmarkforge\.com|api\.bookmarkforge\.com|signal\.bookmarkforge\.com/i.test(source)) errors.push(`${name}: production domain referenced by staging compose`);
    if (!/AI_SESSION_ORIGINS:[^\n]*\$\{HTTP_PORT/.test(source)) errors.push(`${name}: staging AI session origins must interpolate HTTP_PORT (hardcoded 18080 → 403 con puertos no estándar)`);
  }
  return { errors };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const errors = [];
  for (const file of ["docker-compose.prod.yml", "docker-compose.staging.yml"]) if (existsSync(file)) errors.push(...validateCompose(file, readFileSync(file, "utf8")).errors);
  if (errors.length) { console.error("[validate-compose-config] FAIL"); errors.forEach((error) => console.error(`- ${error}`)); process.exit(1); }
  console.log("[validate-compose-config] Compose security configuration passed");
}
