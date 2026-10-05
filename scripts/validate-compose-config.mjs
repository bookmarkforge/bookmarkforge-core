#!/usr/bin/env node
/**
 * scripts/validate-compose-config.mjs — the Compose security contract.
 *
 * Provider credentials live with the user, so the server has no AI key and no
 * cross-replica state to share. `AI_SESSION_ORIGINS` stays — it is the exact
 * origin allowlist for `POST /api/license/entitlement`.
 *
 * The stale-configuration rules below keep retired subsystem configuration from
 * coming back: a compose file that declares `AI_PROXY_*`,
 * `AI_SESSION_REQUIRE_LICENSE` or `GEMINI_API_*` is describing a server that
 * cannot read them, so it fails the gate instead of silently deploying.
 */
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** Retired environment variables with no runtime reader. */
export const STALE_RETIRED_KEYS = Object.freeze([
  "AI_PROXY_",
  "AI_SESSION_REQUIRE_LICENSE",
  "GEMINI_API_KEY",
  "GEMINI_API_BASE",
]);

/** The stale keys a compose file still declares. */
export function findStaleRetiredKeys(source) {
  return STALE_RETIRED_KEYS.filter((key) => source.includes(key));
}

export function validateCompose(name, source) {
  const errors = [];
  if (!/^services:/m.test(source)) errors.push(`${name}: missing services root`);

  for (const key of findStaleRetiredKeys(source)) {
    errors.push(
      `${name}: ${key} is configured but no code reads it — delete the variable or restore the code that consumes it`,
    );
  }

  if (name.includes("prod")) {
    if (/image:\s+[^\n]*:\$\{IMAGE_TAG:-latest\}/.test(source)) errors.push(`${name}: production image defaults to mutable latest`);
    if (!/NODE_ENV:\s*production/.test(source)) errors.push(`${name}: production NODE_ENV missing`);
    if (!/AI_SESSION_ORIGINS:\s*\$\{[^}]+:\?AI_SESSION_ORIGINS is required\}/.test(source)) errors.push(`${name}: production license-endpoint origins must be required`);
    if (!/TRUST_PROXY:\s*(?:["']?1["']?|\\?["']1\\?["']?)/.test(source)) errors.push(`${name}: production TRUST_PROXY must be explicitly enabled`);
    if (!/secrets:\s*\[license_signing_key\]/.test(source)) errors.push(`${name}: signing key must use a Compose secret`);
    if (!/LICENSE_SIGNING_PRIVATE_KEY_FILE:/.test(source)) errors.push(`${name}: production api must load the signing key from a file`);
    if (!/WHOP_LICENSE_API_URL:\s*\$\{[^}]+:\?/.test(source)) errors.push(`${name}: required license provider endpoint missing`);
    if (/^\s*-\s*"?(?!127\.0\.0\.1)[^"\n]*:\d+:/m.test(source)) errors.push(`${name}: production port should not be broadly published by default`);
    if (/^ {2}redis:/m.test(source)) errors.push(`${name}: production must not bundle a Redis service — nothing reads its state any more`);
  }

  if (name.includes("staging")) {
    if (!/NODE_ENV:\s*staging/.test(source)) errors.push(`${name}: staging NODE_ENV missing`);
    if (!/127\.0\.0\.1:/.test(source)) errors.push(`${name}: staging published ports must bind loopback`);
    if (/bookmarkforgeapp.com|api\.bookmarkforgeapp.com|signal\.bookmarkforgeapp.com/i.test(source)) errors.push(`${name}: production domain referenced by staging compose`);
    if (!/AI_SESSION_ORIGINS:[^\n]*\$\{HTTP_PORT/.test(source)) errors.push(`${name}: staging license-endpoint origins must interpolate HTTP_PORT (hardcoded 18080 → 403 CSRF_ORIGIN on any other port)`);
    if (/^ {2}redis:/m.test(source)) errors.push(`${name}: staging must not bundle a Redis service — nothing reads its state any more`);
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
