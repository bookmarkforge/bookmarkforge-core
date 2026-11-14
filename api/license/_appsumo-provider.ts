import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  bindLicenseDevice,
  boundLicenseDevices,
  DEFAULT_LICENSE_SEATS,
  unbindLicenseDevice,
} from "./_license-seats.js";
import {
  createLicenseKeyValueStore,
  type LicenseKeyValueStore,
} from "./_license-kv.js";
import type { ProviderResponse } from "./_license-server.js";

/**
 * api/license/_appsumo-provider.ts — license provider for AppSumo LTD keys.
 *
 * AppSumo buyers never touch Whop: the operator issues `BMF-…` keys after
 * confirming redemption in the AppSumo seller dashboard (see
 * docs/support-ltd-runbook.md). Keys are bearer credentials, so the store
 * only ever holds their SHA-256 hash — the raw key exists solely in the
 * operator's issuance CSV and the buyer's inbox.
 *
 * KV layout (Upstash/Vercel KV via _license-kv.ts):
 * bmf:lic:<sha256(key)> → {"v":1,"status":"active"|"revoked","seats":5,
 * "createdAt":…,"batch":"…","note":"…"}
 * bmf:state:<sha256(key)> → seat-binding metadata (same shape Whop
 * membership.metadata uses: instance_name,
 * bm:<n>, bmsec:<device>)
 *
 * Semantics mirror the Whop native path exactly: 5 seats per key,
 * per-seat possession tokens for /deactivate, TOCTOU re-read after the
 * binding write, fail-closed on any store error.
 */

const DEFAULT_APP_SUMO_KEY_PREFIX = "BMF-";
const KEY_RECORD_PREFIX = "bmf:lic:";
const STATE_RECORD_PREFIX = "bmf:state:";

export interface AppSumoKeyRecord {
  v: 1;
  status: "active" | "revoked";
  seats: number;
  createdAt: number;
  batch?: string;
  note?: string;
}

export interface AppSumoProviderOptions {
  store?: LicenseKeyValueStore | null;
  keyPrefix?: string;
  fetchImpl?: typeof fetch;
  kvRestUrl?: string;
  kvRestToken?: string;
}

export function appSumoKeyHash(licenseKey: string): string {
  return createHash("sha256").update(licenseKey.trim(), "utf8").digest("hex");
}

export function appSumoKeyRecordKey(licenseKey: string): string {
  return `${KEY_RECORD_PREFIX}${appSumoKeyHash(licenseKey)}`;
}

function appSumoStateKey(licenseKey: string): string {
  return `${STATE_RECORD_PREFIX}${appSumoKeyHash(licenseKey)}`;
}

function resolveStore(options: AppSumoProviderOptions): LicenseKeyValueStore | null {
  if (options.store !== undefined) return options.store;
  return createLicenseKeyValueStore({
    kvRestUrl: options.kvRestUrl,
    kvRestToken: options.kvRestToken,
    fetchImpl: options.fetchImpl,
  });
}

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function loadRecord(store: LicenseKeyValueStore, licenseKey: string): Promise<AppSumoKeyRecord | null> {
  const record = parseJson<AppSumoKeyRecord>(await store.get(appSumoKeyRecordKey(licenseKey)));
  if (!record || record.v !== 1 || (record.status !== "active" && record.status !== "revoked")) return null;
  return record;
}

async function loadState(store: LicenseKeyValueStore, licenseKey: string): Promise<Record<string, unknown>> {
  return parseJson<Record<string, unknown>>(await store.get(appSumoStateKey(licenseKey))) ?? {};
}

async function saveState(store: LicenseKeyValueStore, licenseKey: string, metadata: Record<string, unknown>): Promise<void> {
  await store.set(appSumoStateKey(licenseKey), JSON.stringify(metadata));
}

export function isAppSumoLicenseKey(
  licenseKey: string,
  prefix: string = process.env.APP_SUMO_KEY_PREFIX ?? DEFAULT_APP_SUMO_KEY_PREFIX,
): boolean {
  const normalized = (prefix ?? "").trim();
  return normalized.length > 0 && licenseKey.startsWith(normalized);
}

export function appSumoProviderConfigured(options: AppSumoProviderOptions = {}): boolean {
  return resolveStore(options) !== null;
}

const SEAT_SECRET_PREFIX = "bmsec:";

function seatSecretKey(deviceId: string): string {
  return `${SEAT_SECRET_PREFIX}${deviceId}`;
}

function hashSeatToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function generateSeatToken(): string {
  return randomBytes(32).toString("hex");
}

export async function appSumoLicenseCall(
  options: AppSumoProviderOptions,
  action: "activate" | "validate" | "deactivate",
  body: { license_key: string; instance_name?: string; instance_id?: string; seat_token?: string },
): Promise<ProviderResponse> {
  const store = resolveStore(options);
  if (!store) throw new Error("appsumo_not_configured");
  const licenseKey = body.license_key;
  const deviceId = body.instance_name || body.instance_id || "";
  if (!licenseKey || !deviceId) throw new Error("provider_missing_identity");

  const record = await loadRecord(store, licenseKey);
  if (!record) return { ok: false, valid: false, activated: false, status: "invalid" };
  if (record.status !== "active") {
    return { ok: false, valid: false, activated: false, status: "revoked", error: "license key is revoked" };
  }

  const seats = Number.isInteger(record.seats) && record.seats > 0 ? record.seats : DEFAULT_LICENSE_SEATS;

  if (action === "validate") {
    const state = await loadState(store, licenseKey);
    if (!boundLicenseDevices(state).includes(deviceId)) {
      return { ok: false, valid: false, status: "invalid" };
    }
    const bound = boundLicenseDevices(state);
    return {
      ok: true,
      valid: true,
      status: "active",
      license: { status: "active", activations: bound.length, limit: seats },
    };
  }

  if (action === "deactivate") {
    const state = await loadState(store, licenseKey);
    if (!boundLicenseDevices(state).includes(deviceId)) {
      return { ok: false, deactivated: false, error: "deactivation denied for this device" };
    }
    const storedHash = state[seatSecretKey(deviceId)];
    if (typeof storedHash === "string" && storedHash.length === 64) {
      const provided = typeof body.seat_token === "string" ? body.seat_token.trim() : "";
      const providedHash = provided.length > 0 && provided.length <= 256 ? hashSeatToken(provided) : "";
      const providedBuf = Buffer.from(providedHash, "utf8");
      const storedBuf = Buffer.from(storedHash, "utf8");
      if (providedBuf.length !== storedBuf.length || !timingSafeEqual(providedBuf, storedBuf)) {
        return { ok: false, deactivated: false, error: "deactivation denied: invalid seat token" };
      }
    }
    await saveState(store, licenseKey, unbindLicenseDevice(state, deviceId));
    return { ok: true, deactivated: true };
  }

  // activate
  const state = await loadState(store, licenseKey);
  const binding = bindLicenseDevice(state, deviceId, seats);
  if (!binding.added) {
    if (binding.atLimit) {
      return {
        ok: false,
        activated: false,
        error: "activation limit reached",
        status: "invalid",
        license: { status: "invalid", activations: binding.bound.length, limit: seats },
      };
    }
    return {
      ok: true,
      activated: true,
      status: "active",
      license: { status: "active", activations: binding.bound.length, limit: seats },
    };
  }

  const seatToken = generateSeatToken();
  binding.metadata[seatSecretKey(deviceId)] = hashSeatToken(seatToken);

  await saveState(store, licenseKey, binding.metadata);
  // TOCTOU mitigation identical to the Whop path: re-read after the write.
  // the KV store is last-write-wins, so a concurrent
  // activation can overwrite THIS device's binding. Only hand out the seat
  // token when the post-write state still contains this deviceId — a token
  // for a binding that was lost would entitle a seat that validate later
  // rejects. On failure we deliberately do NOT restore the pre-write
  // snapshot: that stale document would clobber the concurrent winner's
  // binding too. Failing closed leaves both devices unactivated and safe
  // to retry.
  try {
    const after = await loadState(store, licenseKey);
    const afterBound = boundLicenseDevices(after);
    if (afterBound.length > seats || !afterBound.includes(deviceId)) {
      return {
        ok: false,
        activated: false,
        error: "activation limit reached",
        status: "invalid",
        license: { status: "invalid", activations: afterBound.length, limit: seats },
      };
    }
  } catch {
    // Verification read failed; the write above still stands.
  }
  return {
    ok: true,
    activated: true,
    status: "active",
    seat_token: seatToken,
    license: { status: "active", activations: binding.bound.length, limit: seats },
  };
}
