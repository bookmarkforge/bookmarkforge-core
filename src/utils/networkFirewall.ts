/// <reference types="vite/client" />

import { env as registryEnv, readDynamicEnv, parseBool } from "../env.config";
import { logger, redactSecrets } from "./logger";
import { isLoopbackHost } from "./ipSecurity";

// ── Dependency Injection Interfaces ────────────────────────────────
interface SecureStorageLike {
  getSecret(id: string): Promise<string | null>;
  setSecret(id: string, value: string): Promise<void>;
}

interface AuditLogLike {
  record(params: {
    action: string;
    target?: string;
    result: string;
    origin: string;
    context?: Record<string, string>;
  }): Promise<void>;
}

// Module-level dep holders (no-op defaults)
let injectedSecureStorage: SecureStorageLike = {
  async getSecret() { return null; },
  async setSecret() { /* no-op */ },
};
let injectedAuditLog: AuditLogLike = {
  async record() { /* no-op */ },
};

export function configureNetworkFirewall(deps: {
  secureStorage: SecureStorageLike;
  auditLog: AuditLogLike;
}): void {
  injectedSecureStorage = deps.secureStorage;
  injectedAuditLog = deps.auditLog;
  // P1 audit fix: invalidate cache when storage dependencies change.
  // If the storage backend changes during a context/session/vault transition,
  // the previous cache must not be used. Without this, a stale whitelist
  // from the old storage could persist for up to 5 minutes.
  invalidateWhitelistCache();
}

const WHITELIST_STORAGE_KEY = "network_whitelist";

// Read dynamic-key env vars via the registry's `readDynamicEnv` escape hatch
// (same fallback chain as the typed accessors: Vite first, then process.env
// for Node/SSR/test). This keeps audit + boot-validation uniform even when
// the env-var name is decided at runtime.
const getEnvValue = (name: string): string | undefined => readDynamicEnv(name);

function getP2pSignalingPreset(): string[] {
  const presets = ["wss://signaling.rxdb.info", "wss://signaling.pubnub.com"];
  const customUrl = getEnvValue("VITE_P2P_SIGNALING_URL")?.trim();
  if (customUrl && !presets.includes(customUrl)) {
    presets.unshift(customUrl);
  }
  return presets;
}

function getLicenseSigningPreset(): string[] {
  // The license signing service is same-origin by default (/api/license),
  // which the firewall always allows. A self-hosted override
  // (VITE_LICENSE_SIGNING_URL) is preseeded here so the app-level firewall
  // does not block it; the build-time CSP still governs the actual request.
  const url = getEnvValue("VITE_LICENSE_SIGNING_URL")?.trim();
  if (!url) {return [];}
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {return [];}
    if (parsed.username || parsed.password) {return [];}
    return [parsed.origin];
  } catch {
    return [];
  }
}

function getTurnPreset(): string[] {
  // Live read (not the frozen registry snapshot) so tests / runtime config
  // overrides via vi.stubEnv take effect, mirroring getP2pSignalingPreset.
  const turnUrl = getEnvValue("VITE_TURN_URL");
  if (!turnUrl) {return [];}
  // turn: URLs are non-special-scheme (new URL would treat the host as an
  // opaque pathname, yielding "turn://:"). Extract scheme/host/port by regex.
  const m = /^([a-z][a-z0-9+.-]*):(?:\/\/)?([^:/\s?]+):(\d+)/i.exec(turnUrl);
  if (m) {
    return [`${m[1]}:${m[2]}:${m[3]}`];
  }
  // Invalid format — fall back to the raw string.
  return [turnUrl];
}

function getPresetOrigins(): Record<string, string[]> {
  return {
    ollama: ["http://localhost:11434"],
    p2pSignaling: getP2pSignalingPreset(),
    // License signing service (activation/validation). Same-origin by
    // default; self-hosted overrides are preseeded from
    // VITE_LICENSE_SIGNING_URL.
    licenseSigning: getLicenseSigningPreset(),
    // ICE servers used by WebRTC (STUN/TURN). Declared here so validateIceServers
    // recognizes them and the firewall whitelist stays consistent (M5).
    ice: [
      // Only specific STUN servers are whitelisted. Do NOT add "stun:" wildcard,
      // because arbitrary stun:<host> servers must be blocked by the firewall.
      "stun:stun.l.google.com:19302",
      "stun:stun1.l.google.com:19302",
      // turn:/turns: act as protocol wildcards — any TURN relay is allowed.
      "turn:",
      "turns:",
      ...getTurnPreset(),
    ],
  };
}

function getPresetFlat(): string[] {
  return Object.values(getPresetOrigins()).flat();
}

const MAX_WHITELIST_ENTRY_LENGTH = 2_048;

/**
 * Canonicalize an operator-provided whitelist entry. HTTP/WebSocket entries
 * are reduced to their origin so a path-specific allow cannot accidentally
 * fail open for a different request; ICE schemes retain their protocol form
 * because `validateIceServers()` deliberately supports `turn:` wildcards.
 */
function normalizeWhitelistEntry(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_WHITELIST_ENTRY_LENGTH ||
    /[\u0000-\u001f\u007f-\u009f]/.test(value)
  ) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) {return null;}

  if (/^(stun|stuns|turn|turns):/i.test(trimmed)) {
    const wildcard = /^(turn|turns):$/i.test(trimmed);
    if (!wildcard) {
      const match =
        /^(stun|stuns|turn|turns):(?:\[[0-9a-f:]+\]|[^:/?]+):(\d+)(?:\?[^\s#]*)?$/i.exec(
          trimmed,
        );
      const port = match ? Number(match[2]) : Number.NaN;
      if (!match || !Number.isInteger(port) || port < 1 || port > 65_535) {
        return null;
      }
    }
    return trimmed.replace(/^(stun|stuns|turn|turns):/i, (_, scheme: string) =>
      `${scheme.toLowerCase()}:`,
    );
  }

  try {
    const parsed = new URL(trimmed);
    if (
      !["http:", "https:", "ws:", "wss:"].includes(parsed.protocol) ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password
    ) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function getUserWhitelistOrigins(whitelist: Set<string>): string[] {
  const presets = new Set(getPresetFlat());
  return [...whitelist]
    .filter((origin) => !presets.has(origin))
    .sort();
}

let whitelistMutationQueue: Promise<void> = Promise.resolve();
const WHITELIST_LOCK_NAME = "bookmarkforge::network-whitelist";

async function withWhitelistLock<T>(operation: () => Promise<T>): Promise<T> {
  if (
    typeof navigator !== "undefined" &&
    navigator.locks &&
    typeof navigator.locks.request === "function"
  ) {
    return navigator.locks.request(WHITELIST_LOCK_NAME, operation);
  }
  return operation();
}

function queueWhitelistMutation(
  mutation: () => Promise<void>,
): Promise<void> {
  const next = whitelistMutationQueue
    .catch(() => undefined)
    .then(() => withWhitelistLock(mutation));
  whitelistMutationQueue = next.catch(() => undefined);
  return next;
}

async function persistWhitelist(whitelist: Set<string>): Promise<void> {
  await injectedSecureStorage.setSecret(
    WHITELIST_STORAGE_KEY,
    JSON.stringify(getUserWhitelistOrigins(whitelist)),
  );
}

export class NetworkFirewallError extends Error {
  constructor(url: string, reason: string) {
    super(
      `[NETWORK BLOCKED] ${redactSecrets(url).slice(0, 2_048)} — ${redactSecrets(reason).slice(0, 2_048)}`,
    );
    this.name = "NetworkFirewallError";
  }
}

function extractOrigin(url: string): string {
  try {
    if (url.startsWith("blob:") || url.startsWith("data:"))
      {return url.split(":")[0] + ":";}
    // Browser fetch accepts relative same-origin URLs (e.g. the local WASM
    // hardening module at /wasm/zero-memory.wasm). Resolve them against the
    // current page origin before applying the allowlist; otherwise the raw
    // pathname is compared against an absolute origin and is incorrectly
    // blocked by the firewall.
    const base =
      typeof self !== "undefined" && self.location?.origin
        ? self.location.origin
        : undefined;
    const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(url);
    // Do not let WHATWG URL normalization turn malformed strings containing
    // whitespace (for example `not a valid url://%%`) into same-origin paths.
    // Only scheme-less, whitespace-free values may use the relative URL base.
    return hasScheme || /[\u0000-\u0020]/.test(url)
      ? new URL(url).origin
      : new URL(url, base).origin;
  } catch (_err) {
    // Return a sentinel that can never match a whitelisted origin. The raw
    // URL could theoretically collide with an allowlist entry (e.g. an
    // attacker-crafted string matching a trusted origin). Return a value that
    // is guaranteed to not be in any allowlist so the request is blocked.
    return "__invalid-origin__";
  }
}


function isAlwaysAllowed(url: string): boolean {
  const origin = extractOrigin(url);
  const alwaysAllowed = [
    "blob:",
    "data:",
    ...(typeof self !== "undefined" && self.location?.origin
      ? [self.location.origin]
      : []),
  ];
  // Origins are boundaries, not prefixes: `https://app.example.com.evil`
  // must never inherit the app's same-origin exemption. `blob:` and `data:`
  // have already been reduced to their exact pseudo-origins by extractOrigin.
  if (alwaysAllowed.some((allowed) => origin === allowed)) {return true;}
  // Allow loopback addresses (incl. obfuscated forms) without whitelisting.
  try {
    const parsed = new URL(url);
    if (isLoopbackHost(parsed.hostname)) {return true;}
  } catch { /* INTENTIONAL SILENCE: invalid URLs are rejected by downstream firewall checks. */ }
  return false;
}

const WHITELIST_TTL_MS = 5 * 60 * 1000;
let cachedWhitelist: Set<string> | null = null;
let cachedWhitelistTimestamp: number = 0;

async function loadWhitelist(): Promise<Set<string>> {
  if (
    cachedWhitelist &&
    Date.now() - cachedWhitelistTimestamp < WHITELIST_TTL_MS
  ) {
    return cachedWhitelist;
  }
  let origins: string[] = [];
  try {
    const stored = await injectedSecureStorage.getSecret(WHITELIST_STORAGE_KEY);
    if (stored) {
      const parsed: unknown = JSON.parse(stored);
      origins = Array.isArray(parsed)
        ? parsed
            .map((origin) => normalizeWhitelistEntry(origin))
            .filter((origin): origin is string => origin !== null)
        : [];
    }
  } catch (error) {
    logger.warn(
      "[NetworkFirewall] SecureStorage unavailable; using preset origins only",
      { error },
    );
  }
  cachedWhitelist = new Set([...origins, ...getPresetFlat()]);
  cachedWhitelistTimestamp = Date.now();
  return cachedWhitelist;
}

export function invalidateWhitelistCache(): void {
  cachedWhitelist = null;
  cachedWhitelistTimestamp = 0;
}

async function isWhitelisted(url: string): Promise<boolean> {
  const origin = extractOrigin(url);
  const whitelist = await loadWhitelist();
  return whitelist.has(origin);
}

export async function checkNetworkRequest(
  url: string,
  context?: string,
): Promise<void> {
  if (isAlwaysAllowed(url)) {return;}
  if (await isWhitelisted(url)) {return;}

  const origin = extractOrigin(url);
  logger.warn("[NetworkFirewall] Blocked request", { url: origin, context });

  injectedAuditLog
    .record({
      action: "firewall_blocked_request",
      target: origin,
      result: "denied",
      origin: "NetworkFirewall",
      context: context ? { requestContext: context } : undefined,
    })
    .catch((err) => {
      logger.warn("[NetworkFirewall] auditLog failed", err);
    });

  throw new NetworkFirewallError(
    url,
    `Origin "${origin}" is not in the network whitelist. Add it in Settings > Network Permissions.`,
  );
}

export async function addToWhitelist(origin: string): Promise<void> {
  const normalized = normalizeWhitelistEntry(origin);
  if (!normalized) {
    throw new Error(
      "[NetworkFirewall] Whitelist entry must be a valid HTTP(S)/WS(S) origin or ICE URL",
    );
  }

  await queueWhitelistMutation(async () => {
    // P1 audit fix: invalidate cache before writing to prevent cross-tab
    // consistency issues. Without this, Tab A with cached [X] can write [X,Z]
    // while Tab B already persisted [X,Y], causing Y to be lost.
    invalidateWhitelistCache();
    const whitelist = await loadWhitelist();
    whitelist.add(normalized);
    try {
      await persistWhitelist(whitelist);
    } catch (error) {
      logger.warn(
        "[NetworkFirewall] Failed to persist whitelist; using in-memory only",
        { error },
      );
    }
    cachedWhitelist = whitelist;
    cachedWhitelistTimestamp = Date.now();

    injectedAuditLog
      .record({
        action: "network_origin_added",
        target: normalized,
        result: "success",
        origin: "NetworkFirewall",
      })
      .catch((err) => {
        logger.warn("[NetworkFirewall] auditLog failed", err);
      });
  });
}

export async function removeFromWhitelist(origin: string): Promise<void> {
  const normalized = normalizeWhitelistEntry(origin);
  if (!normalized) {
    throw new Error(
      "[NetworkFirewall] Whitelist entry must be a valid HTTP(S)/WS(S) origin or ICE URL",
    );
  }
  // Presets are policy defaults, not user grants. Removing one from the
  // in-memory set would create a misleading temporary state until the next
  // cache refresh, so keep it active and only allow removal of user entries.
  if (getPresetFlat().includes(normalized)) {return;}

  await queueWhitelistMutation(async () => {
    // P1 audit fix: invalidate cache before writing to prevent cross-tab
    // consistency issues. Without this, Tab A with cached [X] can write [X,Z]
    // while Tab B already persisted [X,Y], causing Y to be lost.
    invalidateWhitelistCache();
    const whitelist = await loadWhitelist();
    whitelist.delete(normalized);
    try {
      await persistWhitelist(whitelist);
    } catch (error) {
      logger.warn(
        "[NetworkFirewall] Failed to persist whitelist; using in-memory only",
        { error },
      );
    }
    cachedWhitelist = whitelist;
    cachedWhitelistTimestamp = Date.now();

    injectedAuditLog
      .record({
        action: "network_origin_removed",
        target: normalized,
        result: "success",
        origin: "NetworkFirewall",
      })
      .catch((err) => {
        logger.warn("[NetworkFirewall] auditLog failed", err);
      });
  });
}

export async function getWhitelistedOrigins(): Promise<string[]> {
  const whitelist = await loadWhitelist();
  return [...whitelist].sort();
}

let _firewallDisabled = false;

export function setFirewallDisabled(disabled: boolean): void {
  // SECURITY: In production, the firewall cannot be disabled via this API.
  // This protects against supply-chain attacks that could call this function.
  // Live read of PROD so production builds (Vite inlines PROD=true) and
  // tests (vi.stubEnv('PROD', 'true')) both hit the guard.
  if (disabled && parseBool(getEnvValue("PROD")) === true) {
    logger.error(
      "[NetworkFirewall] Refusing to disable firewall in production",
    );
    return;
  }
  _firewallDisabled = disabled;
}

export function isFirewallEnabled(): boolean {
  // A production bundle must never honor the test-only environment bypass,
  // even if an operator accidentally injects VITE_DISABLE_NETWORK_FIREWALL.
  // This is independent of setFirewallDisabled() because the env value is
  // captured in the registry snapshot at module load.
  if (parseBool(getEnvValue("PROD")) === true) {return true;}
  if (_firewallDisabled) {return false;}
  return registryEnv.disableNetworkFirewall !== true;
}

export async function firewalledFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  context?: string,
): Promise<Response> {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  if (isFirewallEnabled()) {
    await checkNetworkRequest(url, context);
  }

  // S5/ADR-017: on-prem fetch proxy. When the fetch proxy is set in the
  // registry, all external requests are routed through the user's
  // self-hosted proxy so API keys and prompt data never leave their
  // infrastructure. The original target URL is passed via X-Target-Url
  // header.
  // Live read so runtime/CI overrides (vi.stubEnv) are honored — the frozen
  // env registry snapshot is taken at module load.
  const proxyUrl = getEnvValue("VITE_FETCH_PROXY_URL");
  // Never follow redirects automatically. A redirect target is not visible
  // to the caller before fetch follows it, so it cannot be re-validated by
  // the firewall (SSRF protection must fail closed at this boundary).
  // Force the value after spreading init so callers cannot opt out.
  const safeInit: RequestInit = { ...init, redirect: "error" };

  if (proxyUrl && !isLocalOrigin(url)) {
    if (!isValidProxyUrl(proxyUrl)) {
      throw new NetworkFirewallError(
        proxyUrl,
        "Configured fetch proxy URL is invalid or contains embedded credentials",
      );
    }
    // A Request carries method/body/headers outside of `init`. Materialize
    // those fields before changing the destination to the proxy, otherwise a
    // POST Request can silently become a body-less GET at the proxy.
    const sourceRequest =
      typeof Request !== "undefined" && input instanceof Request
        ? new Request(input, safeInit)
        : null;
    const proxyInit: RequestInit = sourceRequest
      ? {
          ...safeInit,
          method: sourceRequest.method,
          headers: new Headers(sourceRequest.headers),
          body: sourceRequest.body,
          credentials: sourceRequest.credentials,
          cache: sourceRequest.cache,
          mode: sourceRequest.mode,
          referrer: sourceRequest.referrer,
          referrerPolicy: sourceRequest.referrerPolicy,
          integrity: sourceRequest.integrity,
          keepalive: sourceRequest.keepalive,
        }
      : { ...safeInit };
    const headers = new Headers(proxyInit.headers);
    headers.set("X-Target-Url", url);
    if (context) {headers.set("X-Fetch-Context", context);}
    proxyInit.headers = headers;
    return globalThis.fetch(proxyUrl, proxyInit);
  }

  return globalThis.fetch(input, safeInit);
}

/**
 * Validate the configured on-prem proxy before using it as a network sink.
 * The proxy is intentionally treated as operator-controlled rather than a
 * normal user whitelist target, but malformed URLs and embedded credentials
 * must still fail closed.
 */
function isValidProxyUrl(value: string): boolean {
  if (
    value.length === 0 ||
    value.length > 2_048 ||
    /[\u0000-\u001f\u007f-\u009f]/.test(value)
  ) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === "https:" || parsed.protocol === "http:") &&
      !parsed.username &&
      !parsed.password &&
      Boolean(parsed.hostname)
    );
  } catch {
    return false;
  }
}

/** Returns true if the URL targets the local origin (same-origin or loopback). */
function isLocalOrigin(url: string): boolean {
  try {
    // Guard for non-browser contexts (Web Workers, Node.js, tests)
    // where `self` or `self.location` may be undefined.
    const ownOrigin =
      typeof self !== "undefined" && self.location?.origin
        ? self.location.origin
        : undefined;
    const base = ownOrigin ?? "http://localhost";
    const parsed = new URL(url, base);
    if (ownOrigin && parsed.origin === ownOrigin) {return true;}
    return isLoopbackHost(parsed.hostname);
  } catch (_err) {
    return false;
  }
}

/**
 * Creates a WebSocket connection only if the URL passes the firewall.
 * Throws NetworkFirewallError if the origin is not whitelisted.
 */
export async function firewalledWebSocket(
  url: string | URL,
  protocols?: string | string[],
  context?: string,
): Promise<WebSocket> {
  const urlStr = url instanceof URL ? url.href : url;
  if (isFirewallEnabled()) {
    await checkNetworkRequest(urlStr, context);
  }
  return new globalThis.WebSocket(urlStr, protocols);
}

/**
 * Creates an EventSource connection only if the URL passes the firewall.
 * Throws NetworkFirewallError if the origin is not whitelisted.
 */
export async function firewalledEventSource(
  url: string | URL,
  eventSourceInitDict?: EventSourceInit,
  context?: string,
): Promise<EventSource> {
  const urlStr = url instanceof URL ? url.href : url;
  if (isFirewallEnabled()) {
    await checkNetworkRequest(urlStr, context);
  }
  return new EventSource(urlStr, eventSourceInitDict);
}

/**
 * Validates that all ICE server URLs in an RTCPeerConnection config
 * are firewall-whitelisted. Throws NetworkFirewallError on first
 * blocked origin.
 */
export async function validateIceServers(
  config?: RTCConfiguration,
  context?: string,
): Promise<void> {
  if (!config?.iceServers || !isFirewallEnabled()) {return;}
  const whitelist = await loadWhitelist();
  for (const server of config.iceServers) {
    const urls = Array.isArray(server.urls)
      ? server.urls
      : [server.urls as string];
    for (const url of urls) {
      if (
        typeof url !== "string" ||
        url.length === 0 ||
        url.length > 2_048 ||
        /[\u0000-\u001f\u007f-\u009f]/.test(url)
      ) {
        throw new NetworkFirewallError(
          String(url),
          "ICE server URL is missing, malformed, or exceeds the safe length limit",
        );
      }
      const colonIdx = url.indexOf(":");
      // ICE configuration is not a generic URL sink. Fail closed for values
      // without a scheme and for non-ICE schemes; silently accepting a bare
      // hostname here would defer validation to the browser/WebRTC stack.
      if (
        colonIdx <= 0 ||
        !/^(stun|stuns|turn|turns):/i.test(url)
      ) {
        throw new NetworkFirewallError(
          url,
          "ICE server URL must use stun:, stuns:, turn:, or turns:",
        );
      }
      const origin = url.slice(0, colonIdx + 1); // e.g. "turn:" or "stun:"
      // turn:/turns: are protocol wildcards; stun: requires a full URL match
      // against a whitelisted entry (e.g. Google STUN servers).
      const isAllowed = whitelist.has(origin) || whitelist.has(url);
      if (!isAllowed) {
        logger.warn("[NetworkFirewall] Blocked ICE server", { url, context });
        throw new NetworkFirewallError(
          url,
          `ICE server origin "${origin}" is not whitelisted`,
        );
      }
    }
  }
}
