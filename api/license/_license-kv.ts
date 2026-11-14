/**
 * api/license/_license-kv.ts — minimal key/value store for the AppSumo
 * license provider. Serverless functions are stateless, so device-seat
 * bindings and the issued-key registry need an external store. We talk to
 * Upstash Redis over its REST API with plain fetch — no SDK dependency.
 *
 * Vercel KV (the marketplace Upstash integration) injects
 * KV_REST_API_URL / KV_REST_API_TOKEN automatically; a self-hosted or
 * non-Vercel deployment can point the same options at any Upstash
 * database via UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN.
 *
 * Only GET/SET are used: key records and seat state are small JSON
 * documents, and every write is a full-document replace.
 */

export interface LicenseKeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

const KV_TIMEOUT_MS = 10_000;
const KV_MAX_VALUE_CHARS = 64 * 1024;

function resolveKvEndpoint(config: { restUrl?: string; restToken?: string }): { url: string; token: string } | null {
  const url = (config.restUrl ?? process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL ?? "").trim();
  const token = (config.restToken ?? process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN ?? "").trim();
  if (!url || !token) return null;
  // the bearer token is sent to this URL, so a plain
  // http:// endpoint would leak it. Mirror the Whop provider guard: HTTPS is
  // mandatory in production unless LICENSE_PROVIDER_ALLOW_HTTP opts out
  // (the same opt-out createLicenseHandler ANDs with NODE_ENV).
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const isProduction = (process.env.NODE_ENV ?? "").trim().toLowerCase() === "production";
  const allowHttp = ["1", "true", "yes", "on"].includes(
    (process.env.LICENSE_PROVIDER_ALLOW_HTTP ?? "").trim().toLowerCase(),
  );
  if (parsed.protocol !== "https:" && isProduction && !allowHttp) {
    console.error(
      JSON.stringify({
        event: "license_kv_url_insecure",
        protocol: parsed.protocol,
        hint: "KV_REST_API_URL/UPSTASH_REDIS_REST_URL must use HTTPS in production, or set LICENSE_PROVIDER_ALLOW_HTTP=1 to opt out",
      }),
    );
    return null;
  }
  return { url: url.replace(/\/+$/, ""), token };
}

async function kvCommand(
  endpoint: { url: string; token: string },
  command: [string, ...string[]],
  fetchImpl: typeof fetch,
): Promise<unknown> {
  const response = await fetchImpl(`${endpoint.url}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${endpoint.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([command]),
    signal: AbortSignal.timeout(KV_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`kv_http_${response.status}`);
  const raw = await response.text();
  if (raw.length > KV_MAX_VALUE_CHARS) throw new Error("kv_response_too_large");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("kv_invalid_response");
  }
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("kv_invalid_response");
  const first = parsed[0] as { result?: unknown; error?: string } | undefined;
  if (first && typeof first === "object" && typeof first.error === "string") {
    throw new Error(`kv_error_${first.error.slice(0, 64)}`);
  }
  return first && typeof first === "object" ? first.result : undefined;
}

export interface LicenseKvStoreOptions {
  kvRestUrl?: string;
  kvRestToken?: string;
  fetchImpl?: typeof fetch;
}

/** Build a store from explicit options/env, or null when unconfigured. */
export function createLicenseKeyValueStore(
  options: LicenseKvStoreOptions = {},
): LicenseKeyValueStore | null {
  const endpoint = resolveKvEndpoint({ restUrl: options.kvRestUrl, restToken: options.kvRestToken });
  if (!endpoint) return null;
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    async get(key: string): Promise<string | null> {
      const result = await kvCommand(endpoint, ["GET", key], fetchImpl);
      return typeof result === "string" ? result : null;
    },
    async set(key: string, value: string): Promise<void> {
      if (value.length > KV_MAX_VALUE_CHARS) throw new Error("kv_value_too_large");
      await kvCommand(endpoint, ["SET", key, value], fetchImpl);
    },
  };
}
