#!/usr/bin/env node
/**
 * scripts/appsumo-keys.mjs — issue and manage AppSumo LTD license keys.
 *
 * AppSumo buyers redeem a deal code on AppSumo; the operator confirms the
 * redemption in the seller dashboard, then issues a `BMF-…` key here. The
 * buyer activates it in the app exactly like a Whop key — the license
 * function routes `BMF-` keys to this KV registry
 * (api/license/_appsumo-provider.ts) instead of Whop.
 *
 * SECURITY: the KV store only ever holds SHA-256 hashes of the keys. The
 * raw keys are written ONCE to a gitignored CSV next to the signing key
 * (server/.appsumo-keys-*.csv) — deliver them to buyers, then guard that
 * file like the signing key. There is no command that prints stored keys.
 *
 * Storage: Upstash Redis REST (Vercel KV injects KV_REST_API_URL /
 * KV_REST_API_TOKEN; UPSTASH_REDIS_REST_URL / _TOKEN also accepted).
 *
 * Usage:
 *   node scripts/appsumo-keys.mjs issue --count 100 --batch launch-1
 *   node scripts/appsumo-keys.mjs revoke BMF-XXXX-XXXX-XXXX-XXXX
 *   node scripts/appsumo-keys.mjs revoke --batch launch-1   (revoke a whole batch)
 *   node scripts/appsumo-keys.mjs list [--batch launch-1]
 *   node scripts/appsumo-keys.mjs verify BMF-XXXX-XXXX-XXXX-XXXX
 *
 * Options for issue: --seats N (default 5), --note "...", --prefix BMF-
 * (must match APP_SUMO_KEY_PREFIX in production if changed).
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const KEYS_DIR = join(ROOT, "server");
const KEY_PREFIX = argValue("prefix") ?? process.env.APP_SUMO_KEY_PREFIX ?? "BMF-";
// Unambiguous alphabet: no 0/O, 1/I/L — keys get read aloud and retyped.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const DEFAULT_SEATS = 5;

const KEY_RECORD_PREFIX = "bmf:lic:";
const STATE_SCAN_NOTE =
  "list/revoke --batch scans bmf:lic:* records; seat state lives under bmf:state:* and is left untouched";

function argValue(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.split("=").slice(1).join("=");
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}
function log(...parts) {
  console.log("[appsumo-keys]", ...parts);
}
function fail(message, hint) {
  console.error(`[appsumo-keys] FAIL: ${message}`);
  if (hint) console.error(`[appsumo-keys] hint: ${hint}`);
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
function recordKey(key) {
  return `${KEY_RECORD_PREFIX}${keyHash(key)}`;
}

function generateKey() {
  const bytes = randomBytes(20);
  const groups = [];
  for (let g = 0; g < 4; g += 1) {
    let group = "";
    for (let i = 0; i < 5; i += 1) group += ALPHABET[bytes[g * 5 + i] % ALPHABET.length];
    groups.push(group);
  }
  return `${KEY_PREFIX}${groups.join("-")}`;
}

async function loadRecordByHash(hash) {
  const [raw] = await kv([["GET", `${KEY_RECORD_PREFIX}${hash}`]]);
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function* scanKeyRecords() {
  // Upstash SCAN via REST: cursor-based. Yield [hash, record] pairs.
  let cursor = "0";
  do {
    const [scanResult] = await kv([["SCAN", cursor, "MATCH", `${KEY_RECORD_PREFIX}*`, "COUNT", "500"]]);
    const [next, keys] = Array.isArray(scanResult) ? scanResult : ["0", []];
    cursor = typeof next === "string" ? next : "0";
    for (const k of Array.isArray(keys) ? keys : []) {
      const hash = String(k).slice(KEY_RECORD_PREFIX.length);
      const record = await loadRecordByHash(hash);
      if (record) yield [hash, record];
    }
  } while (cursor !== "0");
}

async function cmdIssue() {
  const count = Number(argValue("count") ?? "1");
  const seats = Number(argValue("seats") ?? String(DEFAULT_SEATS));
  const batch = argValue("batch") ?? `batch-${new Date().toISOString().slice(0, 10)}`;
  const note = argValue("note") ?? "";
  if (!Number.isInteger(count) || count < 1 || count > 10_000) fail("--count must be an integer between 1 and 10000");
  if (!Number.isInteger(seats) || seats < 1 || seats > 100) fail("--seats must be an integer between 1 and 100");

  const issued = [];
  const commands = [];
  for (let i = 0; i < count; i += 1) {
    const key = generateKey();
    const record = {
      v: 1,
      status: "active",
      seats,
      createdAt: Date.now(),
      batch,
      note,
      id: randomUUID(),
    };
    commands.push(["SET", recordKey(key), JSON.stringify(record)]);
    issued.push({ key, hash: keyHash(key) });
  }
  // Upstash REST accepts batched commands in one POST.
  const { url, token } = kvEndpoint();
  const response = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) fail(`KV batch write failed: HTTP ${response.status}`);

  if (!existsSync(KEYS_DIR)) mkdirSync(KEYS_DIR, { recursive: true });
  const csvPath = join(KEYS_DIR, `.appsumo-keys-${batch}-${Date.now()}.csv`);
  const csv = ["license_key,key_hash,batch,seats,created_at\n"]
    .concat(issued.map(({ key, hash }) => `${key},${hash},${batch},${seats},${new Date().toISOString()}`))
    .join("");
  writeFileSync(csvPath, csv, { mode: 0o600 });

  log(`issued ${count} key(s) — batch "${batch}", ${seats} seats each`);
  log(`raw keys written to ${csvPath} (gitignored — deliver to buyers, then guard it)`);
  log(`KV records: ${KEY_RECORD_PREFIX}<sha256> — raw keys are NOT stored server-side`);
}

async function cmdRevoke() {
  const batch = argValue("batch");
  const positional = process.argv.slice(2).filter((a) => !a.startsWith("--") && !["revoke", "issue", "list", "verify"].includes(a));
  let targets = [];
  if (batch) {
    for await (const [hash, record] of scanKeyRecords()) {
      if (record.batch === batch && record.status !== "revoked") targets.push({ hash, record });
    }
    if (targets.length === 0) fail(`no active keys found for batch "${batch}"`);
  } else {
    const key = positional[0];
    if (!key) fail("usage: revoke <BMF-KEY> | revoke --batch <name>");
    const hash = keyHash(key);
    const record = await loadRecordByHash(hash);
    if (!record) fail(`no key record for the given key/hash`);
    if (record.status === "revoked") {
      log("key already revoked — nothing to do");
      return;
    }
    targets = [{ hash, record }];
  }
  const commands = targets.map(({ hash, record }) => [
    "SET",
    `${KEY_RECORD_PREFIX}${hash}`,
    JSON.stringify({ ...record, status: "revoked", revokedAt: Date.now() }),
  ]);
  const { url, token } = kvEndpoint();
  const response = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) fail(`KV batch write failed: HTTP ${response.status}`);
  log(`revoked ${targets.length} key(s)`);
  log(STATE_SCAN_NOTE);
}

async function cmdList() {
  const batch = argValue("batch");
  let count = 0;
  const byStatus = { active: 0, revoked: 0, other: 0 };
  for await (const [, record] of scanKeyRecords()) {
    if (batch && record.batch !== batch) continue;
    count += 1;
    byStatus[record.status === "active" ? "active" : record.status === "revoked" ? "revoked" : "other"] += 1;
  }
  log(`keys${batch ? ` in batch "${batch}"` : ""}: ${count} total — ${byStatus.active} active, ${byStatus.revoked} revoked`);
  log("(raw keys are never stored or listed — only hashes/metadata)");
}

async function cmdVerify() {
  const positional = process.argv.slice(2).filter((a) => !a.startsWith("--") && a !== "verify");
  const key = positional[0];
  if (!key) fail("usage: verify <BMF-KEY>");
  const record = await loadRecordByHash(keyHash(key));
  if (!record) {
    log("NOT FOUND — key was never issued or hash mismatch");
    return;
  }
  log(`status: ${record.status} | seats: ${record.seats ?? DEFAULT_SEATS} | batch: ${record.batch ?? "-"} | created: ${record.createdAt ? new Date(record.createdAt).toISOString() : "-"}`);
}

const command = process.argv[2];
if (command === "issue") await cmdIssue();
else if (command === "revoke") await cmdRevoke();
else if (command === "list") await cmdList();
else if (command === "verify") await cmdVerify();
else fail("usage: appsumo-keys.mjs <issue|revoke|list|verify> [options] — see header comment");
