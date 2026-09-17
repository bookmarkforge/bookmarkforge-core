/**
 * AI session utilities.
 *
 * The server-side session endpoint (/api/services/ai/session) was removed
 * when the Gemini proxy was eliminated. Session/CSRF logic is no longer
 * needed — AI requests go directly to provider APIs.
 */

/** Execute one AI request. No session/CSRF overhead — the proxy is gone. */
export async function fetchWithAiSession(
  request: (options: RequestInit) => Promise<Response>,
  options: RequestInit = {},
): Promise<Response> {
  return request(options);
}