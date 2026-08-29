import { firewalledFetch } from "../../utils/networkFirewall";
import { licenseService } from "../LicenseService";

const SESSION_ENDPOINT = "/api/services/ai/session";
let sessionPromise: Promise<string> | null = null;

async function createSession(): Promise<string> {
  const proof = await licenseService.getAiSessionProof();
  const response = await firewalledFetch(
    SESSION_ENDPOINT,
    {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(proof ?? {}),
    },
    "ai-session",
  );
  if (!response.ok) {
    try { await response.body?.cancel(); } catch { /* best effort */ }
    throw new Error(`AI session bootstrap failed (${response.status})`);
  }
  const payload = await response.json() as { csrfToken?: unknown };
  if (typeof payload.csrfToken !== "string" || payload.csrfToken.length < 32) {
    throw new Error("AI session bootstrap returned an invalid CSRF token");
  }
  return payload.csrfToken;
}

export function ensureAiSession(): Promise<string> {
  if (!sessionPromise) {
    sessionPromise = createSession().catch((error) => {
      sessionPromise = null;
      throw error;
    });
  }
  return sessionPromise;
}

export function invalidateAiSession(): void {
  sessionPromise = null;
}

export async function withAiSession(options: RequestInit = {}): Promise<RequestInit> {
  const csrfToken = await ensureAiSession();
  const headers = new Headers(options.headers);
  headers.set("X-CSRF-Token", csrfToken);
  return {
    ...options,
    credentials: "include",
    headers,
  };
}

/** Execute one AI request and transparently renew an expired session once. */
export async function fetchWithAiSession(
  request: (options: RequestInit) => Promise<Response>,
  options: RequestInit = {},
): Promise<Response> {
  let response = await request(await withAiSession(options));
  if (response.status !== 401 && response.status !== 403) return response;

  try { await response.body?.cancel(); } catch { /* best effort */ }
  // A streamed body is consumed by the first attempt and cannot be replayed;
  // retrying would send a closed/empty stream and corrupt the request.
  // Propagate the 401/403 (with the fresh session still cached for the next
  // call) instead of silently re-sending a broken body.
  if (typeof ReadableStream !== "undefined" && options.body instanceof ReadableStream) {
    return response;
  }
  invalidateAiSession();
  response = await request(await withAiSession(options));
  return response;
}
