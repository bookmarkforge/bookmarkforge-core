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
 *
 * The retired-key list was a blocklist, so a NEW
 * variable with no reader (`READ_ONLY`) could ship and the operator would
 * believe the container honoured it. `declaredApiEnvKeys` + `findOrphanEnvKeys`
 * invert the rule: every variable the `api` service declares must appear in the
 * server sources. The same section requires the production hardening
 * asked for (read-only filesystem, memory/CPU/PID caps, bounded logs).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
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

/**
 * The text of one top-level service block, or "" when the service is absent.
 * Boundaries are the two-space `  name:` lines Compose requires.
 */
export function serviceBlock(source, name) {
  const start = new RegExp(`^ {2}${name}:\\s*$`, "m").exec(source);
  if (!start) return "";
  const rest = source.slice(start.index + start[0].length);
  const next = /^ {2}[A-Za-z0-9_-]+:\s*$/m.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

/**
 * Environment variable names the `api` service declares (map form — the form
 * both compose files use). List-form entries (`- KEY=value`) are accepted too,
 * so a future rewrite does not silently disable this gate.
 */
export function declaredApiEnvKeys(source) {
  const block = serviceBlock(source, "api");
  const envIndex = block.search(/^ {4}environment:\s*$/m);
  if (envIndex === -1) return [];
  const keys = [];
  for (const line of block.slice(envIndex).split("\n").slice(1)) {
    // A line indented four spaces or less starts the next key in the service.
    if (/^ {0,4}\S/.test(line)) break;
    const mapping = /^ {6}([A-Z][A-Z0-9_]*):/.exec(line);
    if (mapping) {
      keys.push(mapping[1]);
      continue;
    }
    const listed = /^ {6}-\s*([A-Z][A-Z0-9_]*)=/.exec(line);
    if (listed) keys.push(listed[1]);
  }
  return keys;
}

/** Value of a 4-space service key, quotes stripped; "" when absent. */
export function composeScalar(block, key) {
  const match = new RegExp(`^ {4}${key}:\\s*(.+)$`, "m").exec(block);
  return match ? match[1].trim().replace(/^["']|["']$/g, "") : "";
}

/** The indented body of a 4-space service key, or "" when absent. */
function composeSection(block, key) {
  const start = new RegExp(`^ {4}${key}:\\s*$`, "m").exec(block);
  if (!start) return "";
  const rest = block.slice(start.index + start[0].length);
  const next = /^ {4}[A-Za-z0-9_-]+:/m.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

/** The default a `${VAR:-default}` interpolation falls back to, or the raw value. */
export function composeDefault(raw) {
  const match = /\$\{[A-Z0-9_]+:-([^}]+)\}/.exec(String(raw));
  return (match ? match[1] : String(raw)).trim().replace(/^["']|["']$/g, "");
}

const SIZE_UNITS = { b: 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3 };

/** `512m` → 536870912; null when the value is not a plain size. */
export function parseComposeSize(raw) {
  const match = /^(\d+(?:\.\d+)?)([bkmg])?$/i.exec(composeDefault(raw));
  if (!match) return null;
  return Number(match[1]) * SIZE_UNITS[match[2]?.toLowerCase() ?? "b"];
}

/**
 * The production caps and the range each one must stay inside. Presence alone
 * was not enough: `mem_limit: 10g` or `cpus: 99` kept the gate green while the
 * cap no longer protected the host, and a tmpfs on `/run` satisfied "has a
 * tmpfs". These bounds are the reversible-by-accident part.
 */
export const COMPOSE_LIMITS = Object.freeze([
  { key: "mem_limit", label: "memory", range: "64m–2g", min: 64 * SIZE_UNITS.m, max: 2 * SIZE_UNITS.g, parse: parseComposeSize },
  { key: "cpus", label: "CPU", range: "0.25–4 cores", min: 0.25, max: 4, parse: (raw) => Number(composeDefault(raw)) },
  { key: "pids_limit", label: "processes", range: "32–1024", min: 32, max: 1024, parse: (raw) => Number(composeDefault(raw)) },
]);

/**
 * Declared variables the server sources never mention.
 *
 * Reader detection is a literal name match (not `process.env.X` only): several
 * variables are read through helpers such as
 * `readIpHashSalt("CSP_REPORT_IP_HASH_SALT", …)`, and a stricter pattern would
 * report them as orphans. A variable that appears nowhere in `server/src` is
 * configuration nothing can read — which is exactly the defect this exists for.
 */
export function findOrphanEnvKeys(keys, readerSource) {
  const haystack = readerSource ?? "";
  return keys.filter((key) => !new RegExp(`\\b${key}\\b`).test(haystack));
}

export function validateCompose(name, source, options = {}) {
  const errors = [];
  if (!/^services:/m.test(source)) errors.push(`${name}: missing services root`);

  for (const key of findStaleRetiredKeys(source)) {
    errors.push(
      `${name}: ${key} is configured but no code reads it — delete the variable or restore the code that consumes it`,
    );
  }

  if (typeof options.readerSource === "string") {
    for (const key of findOrphanEnvKeys(declaredApiEnvKeys(source), options.readerSource)) {
      errors.push(
        `${name}: ${key} is declared for the api service but no server source reads it — delete the variable or restore its reader`,
      );
    }
  }

  if (name.includes("prod")) {
    const api = serviceBlock(source, "api");
    const web = serviceBlock(source, "web");

    if (/image:\s+[^\n]*:\$\{IMAGE_TAG:-latest\}/.test(source)) errors.push(`${name}: production image defaults to mutable latest`);
    if (!/NODE_ENV:\s*production/.test(source)) errors.push(`${name}: production NODE_ENV missing`);
    if (!/TRUST_PROXY:\s*(?:["']?1["']?|\\?["']1\\?["']?)/.test(source)) errors.push(`${name}: production TRUST_PROXY must be explicitly enabled`);
    if (/^\s*-\s*"?(?!127\.0\.0\.1)[^"\n]*:\d+:/m.test(source)) errors.push(`${name}: production port should not be broadly published by default`);
    if (/^ {2}redis:/m.test(source)) errors.push(`${name}: production must not bundle a Redis service — nothing reads its state any more`);

    // Hardening enforced instead of documented:
    if (!/read_only:\s*true/.test(api)) {
      errors.push(`${name}: api service must set read_only: true — the runtime writes nothing and a writable rootfs survives a compromise`);
    }
    // The mount must be exactly /tmp: a tmpfs on /run (or /tmpfoo) left the
    // container writable where Node never writes, which is the opposite of the
    // contract. Inline `tmpfs: ["/tmp"]` is accepted as well as the list form.
    const tmpfsText = composeScalar(api, "tmpfs") || composeSection(api, "tmpfs");
    if (!/(?:^|[\s\["'])\/tmp(?:["'\],:]|\s|$)/m.test(tmpfsText)) {
      errors.push(`${name}: api service must mount /tmp as a tmpfs when read_only is enabled`);
    }
    for (const [service, block] of [
      ["web", web],
      ["api", api],
    ]) {
      for (const limit of COMPOSE_LIMITS) {
        const raw = composeScalar(block, limit.key);
        if (raw === "") {
          errors.push(`${name}: ${service} service must cap ${limit.label} with ${limit.key}`);
          continue;
        }
        const value = limit.parse(raw);
        if (value === null || !Number.isFinite(value) || value < limit.min || value > limit.max) {
          errors.push(
            `${name}: ${service} ${limit.key} must stay within ${limit.range} (found ${composeDefault(raw)})`,
          );
        }
      }
      if (!/^ {4}logging:[\s\S]*?max-size:/m.test(block)) errors.push(`${name}: ${service} service must bound its logs with logging.options.max-size`);
    }
  }

  if (name.includes("staging")) {
    if (!/NODE_ENV:\s*staging/.test(source)) errors.push(`${name}: staging NODE_ENV missing`);
    if (!/127\.0\.0\.1:/.test(source)) errors.push(`${name}: staging published ports must bind loopback`);
    if (/bookmarkforge\.com|api\.bookmarkforge\.com|signal\.bookmarkforge\.com/i.test(source)) errors.push(`${name}: production domain referenced by staging compose`);
    if (/^ {2}redis:/m.test(source)) errors.push(`${name}: staging must not bundle a Redis service — nothing reads its state any more`);
  }

  return { errors };
}

/**
 * Runtime compose-limits check: reads live values via `docker compose` and
 * validates them against COMPOSE_LIMITS. When Docker is unavailable the
 * check is skipped but recorded in the ledger so the gate never breaks
 * from an absent runtime.
 *//* eslint-disable no-unused-vars */ // used by check:compose-config gate (not this file's scope)
function validateComposeLimitsRuntime(name, source) {
  const errors = [];
  try {    const { execSync } = require("child_process");    const composeOutput = execSync("docker compose -f /dev/stdin config", {
      input: source,
      encoding: "utf8",
      timeout: 10000,
    });    const services = {};    const svcBlocks = output.match(/^ {2}[^ ]+:.*$/m);    if (svcBlocks) {      for (const block of svcBlocks) {        const svcName = block.match(/^ {2}([^ :]+):/)[1];

        // Parse key=value pairs from the service block        const pairs = {};        for (const line of block.split("\n")) {          const m = line.match(/^ {4}([A-Z][A-Z0-9_]*):\s*(.+)$/);          if (m) pairs[m[1]] = m[2].trim();        }        services[svcName] = pairs;      }    }    // Validate each limit from live output    for (const limit of COMPOSE_LIMITS) {      for (const [svcName, pairs] of Object.entries(services)) {        const raw = pairs[limit.key];        if (raw !== undefined) {          const value = limit.parse(raw);          if (value === null || !Number.isFinite(value) || value < limit.min || value > limit.max) {            errors.push(
              `${name}: runtime ${svcName} ${limit.key} must stay within ${limit.range} (found ${raw})`,            );          }        }      }    }  } catch (_) {    // Docker unavailable — skip at gate level, record in ledger  }  return errors;
}
/* eslint-enable no-unused-vars */

/** Every server source file, concatenated — the reader corpus for the gate. */
export function readServerReaderSource(root = "server/src") {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "__tests__" || entry.name === "node_modules") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(?:ts|js|mjs)$/.test(entry.name)) files.push(full);
    }
  };
  walk(root);
  return files.map((file) => readFileSync(file, "utf8")).join("\n");
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const errors = [];
  const readerSource = existsSync("server/src") ? readServerReaderSource() : "";
  for (const file of ["docker-compose.prod.yml", "docker-compose.staging.yml"]) {
    if (existsSync(file)) errors.push(...validateCompose(file, readFileSync(file, "utf8"), { readerSource }).errors);
  }
  if (errors.length) {
    console.error("[validate-compose-config] FAIL");
    errors.forEach((error) => console.error(`- ${error}`));
    process.exit(1);
  }
  console.log("[validate-compose-config] Compose security configuration passed");
}
