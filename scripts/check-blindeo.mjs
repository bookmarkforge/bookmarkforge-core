#!/usr/bin/env node
/**
 * BookmarkForge — Pre-Deploy Hardening Checklist
 *
 * ALWAYS run before any deploy to production.
 * Failure on any of these checkpoints = deploy BLOCKED.
 */

import { execSync, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const WORKSPACE = process.cwd();

function pass(msg) { console.log(`  ✓ ${msg}`); }
function fail(msg) { console.log(`  ✗ ${msg}`); process.exit(1); }

/**
 * Detects `proxy_pass http://bookmarkforge_api...` lines WITHOUT an explicit
 * port. A port-less upstream (nginx → :80 default) against an api listening
 * on 8787 produces a permanent 502 after rollback. Source of truth:
 * public/nginx.conf of the tag (the one baked into the web image).
 *
 * @param {string} nginxConf content of public/nginx.conf
 * @returns {string[]} offending lines (empty = healthy)
 */
export function findProxyPassWithoutPort(nginxConf) {
  if (typeof nginxConf !== "string") return [];
  const lines = nginxConf.split(/\r?\n/);
  const violations = [];
  for (const line of lines) {
    // Skip nginx comments — a commented-out proxy_pass is harmless.
    if (/^\s*#/.test(line)) continue;
    // proxy_pass http://bookmarkforge_api/api/...  → no port → VIOLATION
    // proxy_pass http://bookmarkforge_api:8787/... → explicit port → OK
    if (/proxy_pass\s+http:\/\/bookmarkforge_api(?!:)/i.test(line)) {
      violations.push(line.trim());
    }
  }
  return violations;
}

/**
 * Selects the rollback target: the second-newest prod-* tag DISTINCT from
 * the current one (last known good), deduplicating by SHA to avoid no-op
 * rollbacks when duplicate tags point at the same commit (regression
 * bb21664). Same logic as selectAutoTarget in rollback.mjs: dedup by
 * case-insensitive SHA, treating tags without a valid SHA as distinct builds
 * by name. `tags` must already be sorted by creatordate desc.
 * Returns null when there are fewer than 2 prod- tags after dedup.
 */
export function selectRollbackTarget(tags) {
  const prodTags = (Array.isArray(tags) ? tags : [])
    .filter((t) => typeof t === "string" && t.startsWith("prod-"));
  const distinct = [];
  const seen = new Set();
  for (const tag of prodTags) {
    const sha = (tag.split("-").pop() ?? "");
    const isSha = /^[0-9a-f]{7,12}$/i.test(sha);
    const key = isSha ? sha.toLowerCase() : `name:${tag}`;
    if (seen.has(key)) continue;
    seen.add(key);
    distinct.push(tag);
  }
  if (distinct.length < 2) return null;
  return distinct[1]; // second-newest DISTINCT build from the current one
}

/**
 * Validates that docker-compose.prod.yml defines the bookmarkforge_api
 * alias. Without this alias nginx cannot resolve the upstream and the stack
 * enters a crash-loop ("host not found in upstream").
 *
 * @param {string} composeContent content of docker-compose.prod.yml
 * @returns {boolean} true when the alias is present
 */
export function hasBookmarkforgeApiAlias(composeContent) {
  if (typeof composeContent !== "string") return false;
  return composeContent.includes("aliases: [bookmarkforge_api]") ||
    composeContent.includes("aliases:\n        - bookmarkforge_api");
}

// The main flow only runs when executed directly, not when imported by unit
// tests (same pattern as rollback.mjs / deploy-prod.mjs /
// monitoring-alerts.mjs).
const isMain =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {

console.log("🔒 BookmarkForge — Pre-Deploy Hardening Checklist");
console.log("=".repeat(50));

// Checkpoint 1: prod- tags available in git
try {
  // Windows-safe: execSync uses cmd.exe, where single-quoted --list patterns
  // are passed literally and match nothing. List all tags and filter in JS.
  const tags = execSync("git tag --sort=-creatordate", { encoding: "utf8" })
    .toString()
    .trim()
    .split("\n")
    .filter(t => t.startsWith("prod-"));
  if (tags.length >= 2) pass(`prod- tags available: ${tags.length}`);
  else fail("You need at least 2 prod- tags for rollback");
} catch (_e) { fail("Cannot list git tags"); }

// Checkpoint 2: CSP config source of truth
try {
  const cspSource = readFileSync(join(WORKSPACE, "scripts", "csp-config.js"), "utf8");
  if (cspSource.includes("CSP_STRICT") && cspSource.includes("CSP_MODERATE")) {
    pass("CSP config source of truth present (scripts/csp-config.js)");
  } else fail("Incomplete CSP config");
} catch (_e) { fail("No scripts/csp-config.js"); }

// Checkpoint 3: CSP inlined in vite.config.ts
try {
  const viteCfg = readFileSync(join(WORKSPACE, "vite.config.ts"), "utf8");
  if (viteCfg.includes("CSP_MODERATE")) pass("CSP inlined in vite.config.ts");
  else fail("CSP not inlined in vite.config.ts");
} catch (_e) { fail("No vite.config.ts"); }

// Checkpoint 4: bundleIntegrity service present + event wired to productionMonitor
try {
  const bi = readFileSync(join(WORKSPACE, "src", "utils", "bundleIntegrity.ts"), "utf8");
  const pm = readFileSync(join(WORKSPACE, "src", "telemetry", "productionMonitor.ts"), "utf8");
  if (bi.includes("bundle-integrity-failed") && pm.includes("bundle-integrity-failed")) {
    pass("bundleIntegrity → productionMonitor wired (bundle-integrity-failed)");
  } else fail("bundleIntegrity.ts or productionMonitor.ts missing the bundle-integrity-failed contract");
} catch (_e) { fail("No src/utils/bundleIntegrity.ts"); }

// Checkpoint 5: productionMonitor.ts with thresholds
try {
  const pm = readFileSync(join(WORKSPACE, "src", "telemetry", "productionMonitor.ts"), "utf8");
  if (pm.includes("INTEGRITY_SPIKE_THRESHOLD") && pm.includes("CSP_SPIKE_THRESHOLD")) {
    pass("productionMonitor.ts with configured thresholds");
  } else fail("productionMonitor.ts without thresholds");
} catch (_e) { fail("No src/telemetry/productionMonitor.ts"); }

// Checkpoint 6: Error handler setup in main.tsx
try {
  const mainTsx = readFileSync(join(WORKSPACE, "src", "main.tsx"), "utf8");
  if (mainTsx.includes("initCrisisHandler")) {
    pass("main.tsx has crisis handlers registered (initCrisisHandler)");
  } else fail("main.tsx without crisis handlers");
} catch (_e) { fail("No src/main.tsx"); }

// Checkpoint 7: Zeroization (double fill with reuse guard) + password validation
try {
  const cryptoCore = readFileSync(join(WORKSPACE, "src", "utils", "crypto-core.ts"), "utf8");
  const config = readFileSync(join(WORKSPACE, "src", "constants", "config.ts"), "utf8");
  if (cryptoCore.includes("zeroPasswordBytes") && cryptoCore.includes("already zero")) {
    pass("zeroPasswordBytes present (double zeroization with reuse guard)");
  } else fail("zeroPasswordBytes not found in crypto-core.ts");
  if (config.includes("MIN_PASSWORD_LENGTH: 12")) pass("MIN_PASSWORD_LENGTH configured (= 12 in constants/config.ts)");
  else fail("MIN_PASSWORD_LENGTH not configured");
} catch (_e) { fail("No src/utils/crypto-core.ts or src/constants/config.ts"); }

// Checkpoint 8: Rollback target (second-newest prod-* tag) with a valid web:
// proxy_pass towards the api with explicit port. Rolling back to a tag whose
// web image cannot reach the api (proxy_pass without :port) leaves the web
// in permanent 502: rollback.mjs --verify detects it, but this gate prevents
// deploying over an unusable target in the first place.
try {
  const tags = execSync("git tag --sort=-creatordate", { encoding: "utf8" })
    .toString()
    .trim()
    .split("\n");
  const target = selectRollbackTarget(tags);
  if (!target) {
    fail("No rollback target (need >= 2 prod- tags)");
  }
  // public/nginx.conf is the one baked into the web image at build time
  // (Dockerfile), so validating the file of the tag == validating the image
  // of the tag.
  const nginxConf = execFileSync("git", ["show", `${target}:public/nginx.conf`], { encoding: "utf8" }).toString();
  const violations = findProxyPassWithoutPort(nginxConf);
  if (violations.length > 0) {
    fail(
      `rollback target ${target}: ${violations.length} proxy_pass without explicit port ` +
      `(the restored web would serve 502). Fix the nginx.conf or deploy a previous healthy tag.`,
    );
  }
  pass(`rollback target ${target}: proxy_pass towards the api with explicit port`);
} catch (_e) {
  fail(`Could not validate the nginx.conf of the rollback target: ${_e.message}`);
}

// Checkpoint 9: docker-compose.prod.yml defines the bookmarkforge_api alias
try {
  const compose = readFileSync(join(WORKSPACE, "docker-compose.prod.yml"), "utf8");
  if (hasBookmarkforgeApiAlias(compose)) {
    pass("docker-compose.prod.yml: alias bookmarkforge_api defined on the api service");
  } else {
    fail("docker-compose.prod.yml: alias bookmarkforge_api NOT found — nginx will enter a crash-loop");
  }
} catch (_e) {
  fail("Could not read docker-compose.prod.yml");
}

// Checkpoint 10: Pre-launch checklist (blocking items) — check:launch-checklist:strict.
// Do not launch while any 🔴 blocker is open (ruleset, RPO/RTO, guard,
// GDPR). The gate emits the full report and exits != 0 with blockers.
try {
  execFileSync(
    process.execPath,
    [join(WORKSPACE, "scripts", "check-launch-checklist.mjs"), "--strict"],
    { stdio: "inherit" },
  );
  pass("Pre-launch checklist: no blockers (check:launch-checklist:strict)");
} catch (_e) {
  fail(
    "Pre-launch checklist has unfinished blockers (check:launch-checklist:strict). " +
    "Fix the 🔴 blockers (docs/launch-checklist.md) before deploying to production.",
  );
}

console.log("\n" + "=".repeat(50));
console.log("✅ Hardening checklist completed successfully");
process.exit(0);

} // end if (isMain)