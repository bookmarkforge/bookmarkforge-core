#!/usr/bin/env node
/**
 * scripts/check-csp-collector-parity.mjs
 *
 * The CSP violation collector exists in two real implementations:
 *
 *   - server/src/csp-report.ts      — companion signaling server (env-tunable,
 *                                     defaults inline in readBoundedInteger calls)
 *   - api/_csp-report-core.js       — shared core used by BOTH the Vercel
 *                                     function (api/csp-report.js) and the
 *                                     Netlify/Cloudflare adapter
 *                                     (functions/csp-report.mjs)
 *
 * Security policy must not drift between hosts: a fix applied to one copy
 * (body cap, rate window, rate-table bound) has to reach the others. This
 * gate statically extracts the four policy constants from each implementation
 * and fails when the DEFAULTS differ.
 *
 * Only defaults are compared — operators may legitimately override the
 * server-side values via CSP_REPORT_* env vars.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** env var → canonical constant name (identical in both implementations). */
const POLICY_VARS = [
  "CSP_REPORT_BODY_MAX_BYTES",
  "CSP_REPORT_LIMIT",
  "CSP_REPORT_WINDOW_MS",
  "CSP_REPORT_RATE_MAX_ENTRIES",
];

function parseNumeric(raw) {
  return Number(String(raw).replace(/_/g, ""));
}

/**
 * server/src/csp-report.ts declares each knob as
 *   readBoundedInteger(process.env.X, <default>, <min>, <max>)
 * The first numeric literal after the env reference is the default.
 */
function serverDefaults(source) {
  const defaults = {};
  for (const name of POLICY_VARS) {
    const re = new RegExp(
      `process\\.env\\.${name}[\\s\\S]{0,160}?(\\d[\\d_]*)`,
    );
    const match = source.match(re);
    if (!match) {
      throw new Error(`server/src/csp-report.ts: default for ${name} not found`);
    }
    defaults[name] = parseNumeric(match[1]);
  }
  return defaults;
}

/** api/_csp-report-core.js declares `export const NAME = <n>;`. */
function apiDefaults(source) {
  const defaults = {};
  for (const name of POLICY_VARS) {
    const re = new RegExp(`export const ${name} = ([\\d_]+);`);
    const match = source.match(re);
    if (!match) {
      throw new Error(`api/_csp-report-core.js: constant ${name} not found`);
    }
    defaults[name] = parseNumeric(match[1]);
  }
  return defaults;
}

const failures = [];

const serverPath = join(ROOT, "server", "src", "csp-report.ts");
const apiPath = join(ROOT, "api", "_csp-report-core.js");

// The public Core export ships the api/ collector but not the companion
// server: with a single implementation there is nothing to keep in parity,
// so the gate degrades to validating that the shipped copy still parses.
if (!existsSync(serverPath)) {
  try {
    apiDefaults(readFileSync(apiPath, "utf8"));
  } catch (err) {
    console.error(`[check-csp-collector-parity] FAIL ${err.message}`);
    process.exit(1);
  }
  console.log(
    "[check-csp-collector-parity] ok single-implementation tree (no server/src/csp-report.ts) — api core constants parse",
  );
  process.exit(0);
}

let server;
let apiCore;
try {
  server = serverDefaults(readFileSync(serverPath, "utf8"));
  apiCore = apiDefaults(readFileSync(apiPath, "utf8"));
} catch (err) {
  console.error(`[check-csp-collector-parity] FAIL ${err.message}`);
  process.exit(1);
}

for (const name of POLICY_VARS) {
  if (server[name] !== apiCore[name]) {
    failures.push(
      `${name}: server default ${server[name]} != api core default ${apiCore[name]}`,
    );
  } else {
    console.log(
      `[check-csp-collector-parity] ok ${name} = ${server[name]} (both implementations)`,
    );
  }
}

if (failures.length > 0) {
  console.error(
    `[check-csp-collector-parity] FAIL policy drift between CSP collectors:\n- ${failures.join("\n- ")}`,
  );
  process.exit(1);
}

console.log(
  "[check-csp-collector-parity] ok all collector policy defaults match",
);
