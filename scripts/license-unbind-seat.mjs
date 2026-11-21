#!/usr/bin/env node
/**
 * scripts/license-unbind-seat.mjs — operator seat unbind for AppSumo BMF- keys.
 *
 * A buyer who rotates devices can exhaust the 5-seat limit with no
 * self-service unbind (deactivation requires the per-seat token, which a
 * wiped/lost device no longer has). This script lets the operator free a
 * seat directly in the KV registry that api/license/_appsumo-provider.ts
 * reads:
 *
 *   bmf:state:<sha256(key)> → { instance_name, bm:<n>, bmsec:<deviceId>, … }
 *
 * `unbind` removes the device binding AND its `bmsec:` possession-token
 * hash (same semantics as unbindLicenseDevice in
 * api/license/_license-seats.ts — the bm: slot is compacted by promoting
 * the next bound device into instance_name when needed).
 *
 * SECURITY: the store only ever holds SHA-256 hashes of license keys; this
 * script never prints the raw key back and never prints seat tokens (only
 * their hashes exist server-side anyway). The license KEY itself is taken
 * as an argument — treat the shell history like the issuance CSV.
 *
 * Scope: AppSumo BMF- keys only. Whop-managed licenses keep their seats in
 * Whop membership metadata and are unbound through the Whop dashboard or
 * the buyer's own /deactivate call.
 *
 * Storage: Upstash Redis REST (Vercel KV injects KV_REST_API_URL /
 * KV_REST_API_TOKEN; UPSTASH_REDIS_REST_URL / _TOKEN also accepted).
 *
 * Usage:
 *   node scripts/license-unbind-seat.mjs list   <BMF-KEY>
 *   node scripts/license-unbind-seat.mjs unbind <BMF-KEY> <deviceId>
 */
import { createHash } from "node:crypto";

const KEY_RECORD_PREFIX = "bmf:lic:";
const STATE_RECORD_PREFIX = "bmf:state:";

function log(...parts) {
  console.log("[license-unbind-seat]", ...parts);
}
function fail(message, hint) {
  console.error(`[license-unbind-seat] FAIL: ${message}`);
  if (hint) console.error(`[license-unbind-seat] hint: ${hint}`);
  process.exit(1);
}

function kvEndpoint() {
  const url = (process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL ?? "").trim();
  const token = (process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN ?? "").trim();
  if (!url || !token) {
    fail(
      "KV store not configured",
      "set KV_REST_API_URL + KV_REST_API_TOKEN (Vercel KV) or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN",
    );
  }
  return { url: url.replace(/\/+$/, ""), token };
}

async function kv(commands) {
  const { url, token } = kvEndpoint();
  const response = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) fail(`KV request failed: HTTP ${response.status}`);
  const parsed = await response.json().catch(() => null);
  if (!Array.isArray(parsed)) fail("KV returned a non-array response");
  return parsed.map((entry) => {
    if (entry && typeof entry === "object" && typeof entry.error === "string") {
      fail(`KV command error: ${entry.error}`);
    }
    return entry && typeof entry === "object" ? entry.result : undefined;
  });
}

function keyHash(key) {
  return createHash("sha256").update(key.trim(), "utf8").digest("hex");
}
function stateKey(key) {
  return `${STATE_RECORD_PREFIX}${keyHash(key)}`;
}

// Mirrors of api/license/_license-seats.ts — keep in sync. Seat state is
// small JSON metadata; these are the only shapes the provider understands.
function boundLicenseDevices(metadata) {
  const devices = new Set();
  for (const [key, value] of Object.entries(metadata ?? {})) {
    if (
      (key === "instance_name" || key.startsWith("bm:")) &&
      typeof value === "string" &&
      value.length > 0
    ) {
      devices.add(value);
    }
  }
  return [...devices];
}

function unbindLicenseDevice(metadata, deviceId) {
  const desired = { ...(metadata ?? {}) };
  delete desired[`bmsec:${deviceId}`];

  if (desired.instance_name === deviceId) {
    delete desired.instance_name;
    const replacementKey = Object.keys(desired)
      .filter((key) => key.startsWith("bm:") && typeof desired[key] === "string")
      .sort()[0];
    if (replacementKey) {
      desired.instance_name = desired[replacementKey];
      delete desired[replacementKey];
    }
  } else {
    for (const [key, value] of Object.entries(desired)) {
      if (key.startsWith("bm:") && value === deviceId) {
        delete desired[key];
        break;
      }
    }
  }
  return desired;
}

async function loadKeyRecord(key) {
  const [raw] = await kv([["GET", `${KEY_RECORD_PREFIX}${keyHash(key)}`]]);
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function loadState(key) {
  const [raw] = await kv([["GET", stateKey(key)]]);
  if (typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function cmdList(key) {
  const record = await loadKeyRecord(key);
  if (!record) fail("no key record for the given key/hash — never issued, revoked-deleted, or hash mismatch");
  const state = await loadState(key);
  const bound = boundLicenseDevices(state);
  log(`key status: ${record.status} | seats: ${record.seats ?? 5} | batch: ${record.batch ?? "-"}`);
  log(`bound devices (${bound.length}):`);
  for (const device of bound) log(`  - ${device}`);
  if (bound.length === 0) log("  (none)");
}

async function cmdUnbind(key, deviceId) {
  if (!deviceId || deviceId.length > 256) fail("usage: unbind <BMF-KEY> <deviceId> (deviceId ≤ 256 chars)");
  const record = await loadKeyRecord(key);
  if (!record) fail("no key record for the given key/hash — never issued, revoked-deleted, or hash mismatch");
  if (record.status !== "active") fail(`key is ${record.status} — only active keys hold seats`);

  const state = await loadState(key);
  const bound = boundLicenseDevices(state);
  if (!bound.includes(deviceId)) {
    log(`device "${deviceId}" is not bound to this key — nothing to do`);
    log(`bound devices: ${bound.length ? bound.join(", ") : "(none)"}`);
    return;
  }

  const next = unbindLicenseDevice(state, deviceId);
  await kv([["SET", stateKey(key), JSON.stringify(next)]]);
  const remaining = boundLicenseDevices(next);
  log(`unbound "${deviceId}" — ${remaining.length} seat(s) remain: ${remaining.join(", ") || "(none)"}`);
}

const [command, ...rest] = process.argv.slice(2);
const positional = rest.filter((a) => !a.startsWith("--"));
if (command === "list" && positional[0]) await cmdList(positional[0]);
else if (command === "unbind" && positional[0] && positional[1]) await cmdUnbind(positional[0], positional[1]);
else fail("usage: license-unbind-seat.mjs <list|unbind> <BMF-KEY> [deviceId] — see header comment");
