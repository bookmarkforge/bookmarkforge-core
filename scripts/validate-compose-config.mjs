#!/usr/bin/env node
/**
 * scripts/validate-compose-config.mjs — the Compose security contract.
 *
 * Provider credentials live with the user, so the server has no AI key and no
 * cross-replica state to share.
 *
 * The license surface (`/api/license/*`, with its `AI_SESSION_ORIGINS`
 * allowlist, `WHOP_LICENSE_API_URL` and `LICENSE_SIGNING_PRIVATE_KEY_FILE`) is
 * served by the serverless function in `api/license/[action].ts`, not by the
 * signaling container this Compose file builds. Demanding that configuration
 * here described a container that never mounts those routes, and it made the
 * contract impossible to satisfy without declaring variables the container
 * does not read — the exact drift the stale-key rules below reject.
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
    if (!/TRUST_PROXY:\s*(?:["']?1["']?|\\?["']1\\?["']?)/.test(source)) errors.push(`${name}: production TRUST_PROXY must be explicitly enabled`);
    if (/^\s*-\s*"?(?!127\.0\.0\.1)[^"\n]*:\d+:/m.test(source)) errors.push(`${name}: production port should not be broadly published by default`);
    if (/^ {2}redis:/m.test(source)) errors.push(`${name}: production must not bundle a Redis service — nothing reads its state any more`);
  }

  if (name.includes("staging")) {
    if (!/NODE_ENV:\s*staging/.test(source)) errors.push(`${name}: staging NODE_ENV missing`);
    if (!/127\.0\.0\.1:/.test(source)) errors.push(`${name}: staging published ports must bind loopback`);
    if (/bookmarkforge\.com|api\.bookmarkforge\.com|signal\.bookmarkforge\.com/i.test(source)) errors.push(`${name}: production domain referenced by staging compose`);
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
