import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import {
  loadSigningPrivateKey,
  signLicensePayload,
  type LicensePayload,
} from "./license-signing";

const DEFAULT_WHOP_API_TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 16 * 1024;
const MAX_PROVIDER_RESPONSE_CHARS = 128 * 1024;
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 60;
const MAX_RATE_ENTRIES = 10_000;
const MAX_LICENSE_KEY_LENGTH = 512;
const MAX_INSTANCE_LENGTH = 256;
const MAX_FORWARDED_IP_LENGTH = 128;
const ACTIVE_STATUSES = new Set(["active", "paid", "trialing", "valid", "completed"]);
const INACTIVE_STATUSES = new Set(["inactive", "expired", "revoked", "cancelled", "canceled", "disabled", "invalid"]);
const DEACTIVATED_STATUSES = new Set(["deactivated", "inactive", "revoked", "cancelled", "canceled"]);

interface WhopLicenseServerOptions {
  /** PKCS#8 DER signing key. Defaults to the runtime environment. */
  privateKey?: Buffer | null;
  /** Whop-compatible endpoint base or endpoint template. */
  whopApiUrl?: string;
  /** Server-only Whop API credential. */
  whopApiKey?: string;
  /** Injectable fetch for contract tests. */
  fetchImpl?: typeof fetch;
  now?: () => number;
  rateLimit?: number;
  /** Trust forwarding headers only when the reverse proxy is operator-controlled. */
  trustProxy?: boolean;
  /** Permit HTTP only for an explicitly isolated non-production mock adapter. */
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
  license?: {
    status?: string;
    expires_at?: string | null;
    activations?: number;
    limit?: number;
  };
  membership?: { status?: string; expires_at?: string | null };
  data?: unknown;
}

interface LicenseRequest {
  license_key?: unknown;
  instance_name?: unknown;
  instance_id?: unknown;
}

interface RateWindow {
  count: number;
  windowStart: number;
}

function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.length > 0) {
      const first = forwarded.split(",")[0]?.trim();
      if (first && first.length <= MAX_FORWARDED_IP_LENGTH) return first;
    }
    const realIp = req.headers["x-real-ip"];
    if (typeof realIp === "string" && realIp.length > 0 && realIp.length <= MAX_FORWARDED_IP_LENGTH) {
      return realIp.trim();
    }
  }
  return req.socket.remoteAddress ?? "unknown";
}

function applySecurityHeaders(res: ServerResponse): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), geolocation=(), microphone=()");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  );
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.writableEnded) return;
  applySecurityHeaders(res);
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

function pruneRateWindows(rateWindows: Map<string, RateWindow>, now: number): void {
  const cutoff = now - RATE_WINDOW_MS;
  while (rateWindows.size > 0) {
    const oldest = rateWindows.entries().next().value as
      | [string, RateWindow]
      | undefined;
    if (!oldest || oldest[1].windowStart >= cutoff) break;
    rateWindows.delete(oldest[0]);
  }
}

function createRateLimiter(options: WhopLicenseServerOptions): (ip: string) => boolean {
  const windows = new Map<string, RateWindow>();
  const now = options.now ?? Date.now;
  const limit = options.rateLimit ?? RATE_LIMIT;
  return (ip: string): boolean => {
    const current = now();
    pruneRateWindows(windows, current);
    const existing = windows.get(ip);
    if (!existing || current - existing.windowStart >= RATE_WINDOW_MS) {
      if (!existing && windows.size >= MAX_RATE_ENTRIES) return false;
      windows.set(ip, { count: 1, windowStart: current });
      return true;
    }
    if (existing.count >= limit) return false;
    existing.count += 1;
    return true;
  };
}

function parseExpiry(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value !== "string" || value.length === 0) continue;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function unwrapProviderResponse(raw: ProviderResponse): ProviderResponse {
  if (!raw.data || typeof raw.data !== "object") return raw;
  const data = raw.data as Record<string, unknown>;
  const attributes = data.attributes;
  if (attributes && typeof attributes === "object") {
    return { ...raw, ...(attributes as ProviderResponse) };
  }
  return { ...raw, ...(data as ProviderResponse) };
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

function isProviderActive(
  response: ProviderResponse,
  action: "activate" | "validate",
  now: () => number = Date.now,
): boolean {
  const normalized = unwrapProviderResponse(response);
  const status = providerStatus(normalized);
  const explicit = action === "activate" ? normalized.activated : normalized.valid;
  const expiryValues = [
    normalized.expires_at,
    normalized.license?.expires_at,
    normalized.membership?.expires_at,
  ];
  // An expiry supplied by the adapter must be parseable. Silently treating a
  // malformed expiry as a lifetime entitlement would be an entitlement
  // escalation caused by an adapter/schema regression.
  if (expiryValues.some((value) =>
    value !== undefined && value !== null &&
    (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
  )) return false;
  // Explicit denial always wins over a stale/contradictory status field.
  if (normalized.ok === false || explicit === false || INACTIVE_STATUSES.has(status)) {
    return false;
  }
  // Never grant from a merely truthy/unknown response. The provider must
  // explicitly report success or an allow-listed active status.
  const expiry = parseExpiry(...expiryValues);
  return (explicit === true || ACTIVE_STATUSES.has(status)) &&
    (expiry === undefined || expiry > now());
}

function isProviderDeactivated(response: ProviderResponse): boolean {
  const normalized = unwrapProviderResponse(response);
  const status = providerStatus(normalized);
  // Deactivation must be acknowledged by the provider. A 2xx response with
  // an empty body is not enough: otherwise a transient adapter bug would make
  // the UI believe the activation slot was released.
  return normalized.ok === true || normalized.success === true ||
    normalized.deactivated === true || DEACTIVATED_STATUSES.has(status);
}

function providerError(response: ProviderResponse, fallback: string): { code: string; message: string } {
  const message = typeof response.error === "string"
    ? response.error
    : typeof response.message === "string"
      ? response.message
      : fallback;
  if (/activation|limit|maximum|exceeded/i.test(message)) {
    return { code: "MAX_ACTIVATIONS", message: "license activation limit reached" };
  }
  // Always return the same code for invalid keys and provider errors to
  // prevent license key enumeration via response-code analysis.
  return { code: "INVALID_KEY", message: "license key is invalid" };
}

function buildPayload(
  response: ProviderResponse,
  deviceId: string,
  instanceId: string,
  now: () => number,
): LicensePayload {
  const normalized = unwrapProviderResponse(response);
  const expiry = parseExpiry(
    normalized.expires_at,
    normalized.license?.expires_at,
    normalized.membership?.expires_at,
  );
  const limit = normalized.license?.limit;
  const activations = normalized.license?.activations;
  const payload: LicensePayload = {
    v: 1,
    deviceId,
    validatedAt: now(),
    instanceId,
  };
  if (expiry !== undefined) payload.expiresAt = expiry;
  if (typeof limit === "number" && typeof activations === "number") {
    payload.activationsLeft = Math.max(0, limit - activations);
  }
  return payload;
}

function normalizeActionUrl(base: string, action: string, allowInsecureHttp = false): string {
  const trimmed = base.trim().replace(/\/+$/, "");
  const protocolOk = /^https:\/\//i.test(trimmed) ||
    (allowInsecureHttp && /^http:\/\//i.test(trimmed));
  if (!protocolOk) return "";
  try {
    const url = new URL(trimmed);
    const hostname = url.hostname.toLowerCase();
    // A public storefront URL such as https://whop.com/ is not an API
    // endpoint. Reject it so a misconfigured deployment can never send a
    // license key to the marketing site; use api.whop.com or an operator-owned
    // Whop adapter endpoint instead.
    if (
      hostname === "whop.com" ||
      hostname === "www.whop.com" ||
      url.username ||
      url.password ||
      /[\u0000-\u001f\u007f-\u009f]/.test(trimmed)
    ) return "";
    return trimmed.endsWith(`/${action}`) ? trimmed : `${trimmed}/${action}`;
  } catch {
    return "";
  }
}

async function callWhop(
  options: WhopLicenseServerOptions,
  action: "activate" | "validate" | "deactivate",
  body: Record<string, string>,
): Promise<ProviderResponse> {
  const base = options.whopApiUrl ?? process.env.WHOP_LICENSE_API_URL ?? "";
  const endpoint = normalizeActionUrl(base, action, options.allowInsecureHttp === true);
  const apiKey = options.whopApiKey ?? process.env.WHOP_API_KEY ?? "";
  if (!endpoint || !apiKey) throw new Error("whop_not_configured");
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(DEFAULT_WHOP_API_TIMEOUT_MS),
  });
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_PROVIDER_RESPONSE_CHARS) {
    await response.body?.cancel();
    throw new Error("provider_response_too_large");
  }
  const raw = await response.text();
  if (raw.length > MAX_PROVIDER_RESPONSE_CHARS) throw new Error("provider_response_too_large");
  let parsed: ProviderResponse;
  try {
    parsed = JSON.parse(raw) as ProviderResponse;
  } catch {
    throw new Error("provider_invalid_response");
  }
  if (!response.ok) {
    throw new Error(`provider_http_${response.status}:${providerError(parsed, "provider rejected request").code}`);
  }
  return parsed;
}

export function createLicenseHandler(options: WhopLicenseServerOptions = {}) {
  const privateKey = options.privateKey === undefined
    ? loadSigningPrivateKey()
    : options.privateKey;
  const trustProxy = options.trustProxy ??
    (process.env.TRUST_PROXY === "1" || process.env.TRUST_PROXY === "true");
  // HTTP is never accepted implicitly. It is available only to an explicit,
  // non-production staging/mock configuration; production remains HTTPS-only.
  const allowInsecureHttp = (
    options.allowInsecureHttp === true ||
    process.env.LICENSE_PROVIDER_ALLOW_HTTP === "1"
  ) && process.env.NODE_ENV !== "production";
  const handlerOptions = { ...options, allowInsecureHttp };
  const allowRequest = createRateLimiter(options);

  return async function handleLicenseRequest(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (req.method === "GET" && (path === "/api/license/health" || path === "/licenses/health")) {
      const providerConfigured = Boolean(
        normalizeActionUrl(
          options.whopApiUrl ?? process.env.WHOP_LICENSE_API_URL ?? "",
          "validate",
          allowInsecureHttp,
        ) && (options.whopApiKey ?? process.env.WHOP_API_KEY ?? ""),
      );
      const ready = privateKey !== null && providerConfigured;
      sendJson(res, ready ? 200 : 503, {
        status: ready ? "ok" : "not_configured",
        providerConfigured,
        signingConfigured: privateKey !== null,
      });
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
    if (!allowRequest(clientIp(req, trustProxy))) {
      sendJson(res, 429, { error: { code: "SERVER", message: "too many requests" } });
      return;
    }
    if (!privateKey) {
      sendJson(res, 503, { error: { code: "SERVER", message: "license signing service is not configured" } });
      return;
    }

    let input: LicenseRequest;
    try {
      const raw = await readBody(req);
      input = JSON.parse(raw) as LicenseRequest;
    } catch (error) {
      sendJson(res, error instanceof Error && error.message === "body_too_large" ? 413 : 400, {
        error: { code: "SERVER", message: "malformed or oversized request" },
      });
      return;
    }

    const licenseKey = typeof input.license_key === "string" ? input.license_key.trim() : "";
    const instanceName = typeof input.instance_name === "string" ? input.instance_name.trim() : "";
    const instanceId = typeof input.instance_id === "string" ? input.instance_id.trim() : "";
    if (!licenseKey || licenseKey.length > MAX_LICENSE_KEY_LENGTH ||
        (!instanceName && !instanceId) ||
        instanceName.length > MAX_INSTANCE_LENGTH || instanceId.length > MAX_INSTANCE_LENGTH) {
      sendJson(res, 400, { error: { code: "INVALID_KEY", message: "missing or invalid license identity" } });
      return;
    }

    const action = path.endsWith("/activate")
      ? "activate"
      : path.endsWith("/validate")
        ? "validate"
        : "deactivate";
    const externalBody: Record<string, string> = { license_key: licenseKey };
    if (instanceName) externalBody.instance_name = instanceName;
    if (instanceId) externalBody.instance_id = instanceId;

    try {
      const providerResponse = await callWhop(handlerOptions, action, externalBody);
      if (action === "deactivate") {
        if (!isProviderDeactivated(providerResponse)) {
          sendJson(res, 502, {
            error: { code: "SERVER", message: "license provider did not confirm deactivation" },
          });
          return;
        }
        sendJson(res, 200, { ok: true });
        return;
      }
      if (!isProviderActive(providerResponse, action, options.now ?? Date.now)) {
        const error = providerError(providerResponse, "license is not active");
        // Use the same HTTP status for all error codes to prevent license key
        // enumeration via response-code analysis (400 = invalid, 401 = at limit).
        sendJson(res, 400, { error });
        return;
      }
      const deviceId = instanceName || instanceId;
      const resolvedInstanceId = unwrapProviderResponse(providerResponse).instance?.id ||
        unwrapProviderResponse(providerResponse).instance_id ||
        instanceId ||
        randomUUID();
      const payload = buildPayload(
        providerResponse,
        deviceId,
        resolvedInstanceId,
        options.now ?? Date.now,
      );
      const signature = signLicensePayload(payload, privateKey);
      sendJson(res, 200, { payload, signature });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const configured = !message.startsWith("whop_not_configured");
      const status = message.includes("provider_http_401") || message.includes("provider_http_403") ? 401 : 502;
      sendJson(res, configured ? status : 503, {
        error: {
          code: "SERVER",
          message: configured ? "license provider unavailable" : "license provider is not configured",
        },
      });
    }
  };
}
