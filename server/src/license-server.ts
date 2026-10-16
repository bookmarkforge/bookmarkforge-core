import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { loadSigningPrivateKey, signLicensePayload, type LicensePayload } from "./license-signing";
import { clientIp } from "./proxy-utils";
import { bindLicenseDevice, boundLicenseDevices, DEFAULT_LICENSE_SEATS, unbindLicenseDevice } from "./license-seats";

const MAX_BODY_BYTES = 16 * 1024;
const MAX_PROVIDER_RESPONSE_CHARS = 128 * 1024;
const MAX_LICENSE_KEY_LENGTH = 512;
const MAX_INSTANCE_LENGTH = 256;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 60;
const ACTIVE_STATUSES = new Set(["active", "paid", "trialing", "valid", "completed"]);
const INACTIVE_STATUSES = new Set(["inactive", "expired", "revoked", "cancelled", "canceled", "disabled", "invalid", "past_due", "unpaid", "pending", "draft"]);
const DEACTIVATED_STATUSES = new Set(["deactivated", "inactive", "revoked", "cancelled", "canceled"]);
const WHOP_NATIVE_HOST = "api.whop.com";
const WHOP_NATIVE_BASE = "https://api.whop.com/api/v2/memberships/";

interface WhopLicenseServerOptions {
  privateKey?: Buffer | null;
  whopApiUrl?: string;
  whopApiKey?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  rateLimit?: number;
  trustProxy?: boolean;
  allowInsecureHttp?: boolean;
}

interface ProviderResponse {
  ok?: boolean;
  success?: boolean;
  valid?: boolean;
  activated?: boolean;
  deactivated?: boolean;
  error?: string;
  message?: string;
  status?: string;
  expires_at?: string | null;
  instance_id?: string;
  instance?: { id?: string; status?: string };
  license?: { status?: string; expires_at?: string | null; activations?: number; limit?: number };
  membership?: { status?: string; expires_at?: string | null };
  data?: unknown;
}

interface LicenseRequest {
  license_key?: unknown;
  instance_name?: unknown;
  instance_id?: unknown;
}

interface WhopMembership {
  id?: string;
  metadata?: Record<string, unknown>;
  status?: string;
}

function securityHeaders(res: ServerResponse): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), geolocation=(), microphone=()");
  res.setHeader("Content-Security-Policy", "default-src 'none'; base-uri 'none'; frame-ancestors 'none'");
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.writableEnded) return;
  securityHeaders(res);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const cleanup = (): void => {
      req.removeListener("data", onData);
      req.removeListener("end", onEnd);
      req.removeListener("error", onError);
      req.removeListener("aborted", onAborted);
    };
    const fail = (message: string): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(message));
    };
    const onData = (chunk: Buffer): void => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.resume();
        fail("body_too_large");
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(Buffer.concat(chunks).toString("utf8"));
    };
    const onError = (): void => fail("request_aborted");
    const onAborted = (): void => fail("request_aborted");
    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
    req.on("aborted", onAborted);
  });
}

function parseExpiry(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value !== "string" || !value) continue;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function unwrapProviderResponse(raw: ProviderResponse): ProviderResponse {
  if (!raw.data || typeof raw.data !== "object") return raw;
  const data = raw.data as Record<string, unknown>;
  const attributes = data.attributes;
  return attributes && typeof attributes === "object"
    ? { ...raw, ...(attributes as ProviderResponse) }
    : { ...raw, ...(data as ProviderResponse) };
}

function providerStatus(response: ProviderResponse): string {
  const normalized = unwrapProviderResponse(response);
  return String(
    normalized.status ??
    normalized.license?.status ??
    normalized.membership?.status ??
    normalized.instance?.status ??
    "",
  ).toLowerCase();
}

function isProviderActive(response: ProviderResponse, action: "activate" | "validate", now: () => number): boolean {
  const normalized = unwrapProviderResponse(response);
  const status = providerStatus(normalized);
  const explicit = action === "activate" ? normalized.activated : normalized.valid;
  const expiryValues = [normalized.expires_at, normalized.license?.expires_at, normalized.membership?.expires_at];
  if (expiryValues.some((value) => value !== undefined && value !== null && (typeof value !== "string" || !Number.isFinite(Date.parse(value))))) {
    return false;
  }
  if (normalized.ok === false || explicit === false || INACTIVE_STATUSES.has(status)) return false;
  const expiry = parseExpiry(...expiryValues);
  return (explicit === true || ACTIVE_STATUSES.has(status)) && (expiry === undefined || expiry > now());
}

function providerError(response: ProviderResponse): { code: string; message: string } {
  const message = typeof response.error === "string"
    ? response.error
    : typeof response.message === "string"
      ? response.message
      : "license key is invalid";
  return /activation|limit|maximum|exceeded/i.test(message)
    ? { code: "MAX_ACTIVATIONS", message: "license activation limit reached" }
    : { code: "INVALID_KEY", message: "license key is invalid" };
}

function normalizeActionUrl(base: string, action: string, allowInsecureHttp = false): string {
  const trimmed = base.trim().replace(/\/+$/, "");
  if (!/^https:\/\//i.test(trimmed) && !(allowInsecureHttp && /^http:\/\//i.test(trimmed))) return "";
  try {
    const url = new URL(trimmed);
    if (url.username || url.password || url.hostname === "whop.com" || url.hostname === "www.whop.com") return "";
    return trimmed.endsWith(`/${action}`) ? trimmed : `${trimmed}/${action}`;
  } catch {
    return "";
  }
}

async function whopGetMembership(apiKey: string, licenseKey: string): Promise<WhopMembership | null> {
  const response = await fetch(`${WHOP_NATIVE_BASE}${encodeURIComponent(licenseKey)}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`provider_http_${response.status}`);
  const raw = await response.text();
  if (raw.length > MAX_PROVIDER_RESPONSE_CHARS) throw new Error("provider_response_too_large");
  try {
    return JSON.parse(raw) as WhopMembership;
  } catch {
    throw new Error("provider_invalid_response");
  }
}

async function whopUpdateMembershipMetadata(apiKey: string, membershipId: string, metadata: Record<string, unknown>): Promise<void> {
  const response = await fetch(`https://api.whop.com/api/v1/memberships/${encodeURIComponent(membershipId)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ metadata }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`provider_http_${response.status}`);
  const raw = await response.text();
  if (raw.length > MAX_PROVIDER_RESPONSE_CHARS) throw new Error("provider_response_too_large");
}

async function whopNativeValidateLicense(apiKey: string, licenseKey: string, metadata: Record<string, unknown>): Promise<ProviderResponse> {
  const response = await fetch(`${WHOP_NATIVE_BASE}${encodeURIComponent(licenseKey)}/validate_license`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ metadata }),
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 400 || response.status === 404) {
    await response.body?.cancel().catch(() => {});
    return { ok: false, valid: false, activated: false, status: "invalid" };
  }
  if (!response.ok) throw new Error(`provider_http_${response.status}`);
  const raw = await response.text();
  if (raw.length > MAX_PROVIDER_RESPONSE_CHARS) throw new Error("provider_response_too_large");
  try {
    const parsed = JSON.parse(raw) as ProviderResponse;
    return { ...parsed, ok: true, valid: true, activated: true, status: String(parsed.status ?? parsed.membership?.status ?? "active").toLowerCase() };
  } catch {
    throw new Error("provider_invalid_response");
  }
}

async function whopNativeActivate(apiKey: string, licenseKey: string, deviceId: string): Promise<ProviderResponse> {
  const membership = await whopGetMembership(apiKey, licenseKey);
  if (!membership) return { ok: false, activated: false, status: "invalid" };
  if (!membership.id) throw new Error("provider_missing_membership_id");

  const existing = { ...(membership.metadata ?? {}) };
  const binding = bindLicenseDevice(existing, deviceId, DEFAULT_LICENSE_SEATS);
  if (!binding.added) {
    if (binding.atLimit) {
      return {
        ok: false,
        activated: false,
        error: "activation limit reached",
        status: "invalid",
        license: { status: "invalid", activations: binding.bound.length, limit: DEFAULT_LICENSE_SEATS },
      };
    }
    return whopNativeValidateLicense(apiKey, licenseKey, binding.metadata);
  }

  await whopUpdateMembershipMetadata(apiKey, membership.id, binding.metadata);
  const response = await whopNativeValidateLicense(apiKey, licenseKey, binding.metadata);
  if (!response.ok) {
    try {
      await whopUpdateMembershipMetadata(apiKey, membership.id, existing);
    } catch {
      // Keep the original provider validation failure.
    }
    return response;
  }
  response.license = {
    status: response.license?.status ?? response.status,
    activations: binding.bound.length,
    limit: DEFAULT_LICENSE_SEATS,
  };
  return response;
}

async function whopNativeDeactivate(apiKey: string, licenseKey: string, deviceId: string): Promise<ProviderResponse> {
  const membership = await whopGetMembership(apiKey, licenseKey);
  if (!membership) return { ok: true, deactivated: true };
  if (!membership.id) throw new Error("provider_missing_membership_id");
  const existing = { ...(membership.metadata ?? {}) };
  if (!boundLicenseDevices(existing).includes(deviceId)) {
    return { ok: false, deactivated: false, error: "deactivation denied for this device" };
  }
  await whopUpdateMembershipMetadata(apiKey, membership.id, unbindLicenseDevice(existing, deviceId));
  return { ok: true, deactivated: true };
}

async function callWhop(options: WhopLicenseServerOptions, action: "activate" | "validate" | "deactivate", body: Record<string, string>): Promise<ProviderResponse> {
  const base = options.whopApiUrl ?? process.env.WHOP_LICENSE_API_URL ?? "https://api.whop.com";
  const apiKey = options.whopApiKey ?? process.env.WHOP_API_KEY ?? "";
  if (!base || !apiKey) throw new Error("whop_not_configured");

  if (new URL(base).hostname.toLowerCase() === WHOP_NATIVE_HOST) {
    const licenseKey = body.license_key;
    const deviceId = body.instance_name || body.instance_id || "";
    if (!licenseKey || !deviceId) throw new Error("provider_missing_identity");
    if (action === "activate") return whopNativeActivate(apiKey, licenseKey, deviceId);
    if (action === "deactivate") return whopNativeDeactivate(apiKey, licenseKey, deviceId);
    const membership = await whopGetMembership(apiKey, licenseKey);
    if (!membership) return { ok: false, valid: false, status: "invalid" };
    const metadata = membership.metadata ?? {};
    if (!boundLicenseDevices(metadata).includes(deviceId)) return { ok: false, valid: false, status: "invalid" };
    return whopNativeValidateLicense(apiKey, licenseKey, metadata);
  }

  const endpoint = normalizeActionUrl(base, action, options.allowInsecureHttp === true);
  if (!endpoint) throw new Error("whop_not_configured");
  const response = await (options.fetchImpl ?? fetch)(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const raw = await response.text();
  if (raw.length > MAX_PROVIDER_RESPONSE_CHARS) throw new Error("provider_response_too_large");
  let parsed: ProviderResponse;
  try {
    parsed = JSON.parse(raw) as ProviderResponse;
  } catch {
    throw new Error("provider_invalid_response");
  }
  if (!response.ok) throw new Error(`provider_http_${response.status}`);
  return parsed;
}

export function createLicenseHandler(options: WhopLicenseServerOptions = {}) {
  const privateKey = options.privateKey === undefined ? loadSigningPrivateKey() : options.privateKey;
  const allowInsecureHttp = options.allowInsecureHttp === true && process.env.NODE_ENV !== "production";
  const allowRequest = createRateLimiter(options);
  return async function handleLicenseRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (req.method === "GET" && (path === "/api/license/health" || path === "/licenses/health")) {
      const providerConfigured = Boolean(
        normalizeActionUrl(options.whopApiUrl ?? process.env.WHOP_LICENSE_API_URL ?? "https://api.whop.com", "validate", allowInsecureHttp) &&
        (options.whopApiKey ?? process.env.WHOP_API_KEY ?? ""),
      );
      const ready = privateKey !== null && providerConfigured;
      sendJson(res, ready ? 200 : 503, { status: ready ? "ok" : "not_configured", providerConfigured, signingConfigured: privateKey !== null });
      return;
    }
    if (!["/activate", "/validate", "/deactivate"].some((suffix) => path.endsWith(suffix))) {
      sendJson(res, 404, { error: { code: "SERVER", message: "not found" } });
      return;
    }
    if (req.method !== "POST") {
      sendJson(res, 405, { error: { code: "SERVER", message: "method not allowed" } });
      return;
    }
    if (!allowRequest(clientIp(req, options.trustProxy === true))) {
      sendJson(res, 429, { error: { code: "SERVER", message: "too many requests" } });
      return;
    }
    if (!privateKey) {
      sendJson(res, 503, { error: { code: "SERVER", message: "license signing service is not configured" } });
      return;
    }

    let input: LicenseRequest;
    try {
      input = JSON.parse(await readBody(req)) as LicenseRequest;
    } catch (error) {
      sendJson(res, error instanceof Error && error.message === "body_too_large" ? 413 : 400, { error: { code: "SERVER", message: "malformed or oversized request" } });
      return;
    }

    const licenseKey = typeof input.license_key === "string" ? input.license_key.trim() : "";
    const instanceName = typeof input.instance_name === "string" ? input.instance_name.trim() : "";
    const instanceId = typeof input.instance_id === "string" ? input.instance_id.trim() : "";
    if (!licenseKey || licenseKey.length > MAX_LICENSE_KEY_LENGTH || (!instanceName && !instanceId) || instanceName.length > MAX_INSTANCE_LENGTH || instanceId.length > MAX_INSTANCE_LENGTH) {
      sendJson(res, 400, { error: { code: "INVALID_KEY", message: "missing or invalid license identity" } });
      return;
    }

    const action = path.endsWith("/activate") ? "activate" : path.endsWith("/validate") ? "validate" : "deactivate";
    const body: Record<string, string> = { license_key: licenseKey };
    if (instanceName) body.instance_name = instanceName;
    if (instanceId) body.instance_id = instanceId;

    try {
      const providerResponse = await callWhop({ ...options, allowInsecureHttp }, action, body);
      if (action === "deactivate") {
        if (!providerResponse.ok && !providerResponse.success && !providerResponse.deactivated && !DEACTIVATED_STATUSES.has(providerStatus(providerResponse))) {
          sendJson(res, 502, { error: { code: "SERVER", message: "license provider did not confirm deactivation" } });
          return;
        }
        sendJson(res, 200, { ok: true });
        return;
      }
      if (!isProviderActive(providerResponse, action, options.now ?? Date.now)) {
        sendJson(res, 400, { error: providerError(providerResponse) });
        return;
      }
      const normalized = unwrapProviderResponse(providerResponse);
      const deviceId = instanceName || instanceId;
      const resolvedInstanceId = normalized.instance?.id || normalized.instance_id || instanceId || randomUUID();
      const payload: LicensePayload = {
        v: 1,
        deviceId,
        validatedAt: (options.now ?? Date.now)(),
        instanceId: resolvedInstanceId,
      };
      const expiry = parseExpiry(normalized.expires_at, normalized.license?.expires_at, normalized.membership?.expires_at);
      if (expiry !== undefined) payload.expiresAt = expiry;
      if (typeof normalized.license?.limit === "number" && typeof normalized.license?.activations === "number") {
        payload.activationsLeft = Math.max(0, normalized.license.limit - normalized.license.activations);
      }
      sendJson(res, 200, { payload, signature: signLicensePayload(payload, privateKey) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message.includes("provider_http_401") || message.includes("provider_http_403") ? 401 : message === "whop_not_configured" ? 503 : 502;
      sendJson(res, status, { error: { code: "SERVER", message: status === 503 ? "license provider is not configured" : "license provider unavailable" } });
    }
  };
}

function createRateLimiter(options: WhopLicenseServerOptions): (ip: string) => boolean {
  const windows = new Map<string, { count: number; windowStart: number }>();
  const now = options.now ?? Date.now;
  const limit = options.rateLimit ?? RATE_LIMIT;
  return (ip: string): boolean => {
    const current = now();
    const existing = windows.get(ip);
    if (!existing || current - existing.windowStart >= RATE_WINDOW_MS) {
      windows.set(ip, { count: 1, windowStart: current });
      return true;
    }
    if (existing.count >= limit) return false;
    existing.count += 1;
    return true;
  };
}
