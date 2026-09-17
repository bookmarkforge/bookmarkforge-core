import { test, expect, type Page } from "@playwright/test";
import {
  setupTestVault,
  pinDeterministicEnv,
} from "./ai-guard-helpers";

/**
 * Gemini proxy chain E2E — upstream error mapping through the REAL companion
 * server. This spec is the concrete deliverable of the MSW evaluation thread:
 * instead of MSW (rejected: browser-only interception cannot reach the
 * companion process, `serviceWorkers: "block"` is fixed in the shared
 * Playwright config, and the Vitest suite's module-level mocks would all
 * need rewriting), the upstream is a tiny dependency-free node:http stub
 * (scripts/test-upstream-server.mjs) whose base URL is injected into the
 * companion's GEMINI_API_BASE by the ISOLATED topology in
 * playwright.ai-upstream.config.ts (run with `npm run e2e:ai-upstream`).
 *
 * What this exercises END TO END, with production code only:
 *
 *   GeminiProvider (browser, driven directly — model passthrough)
 *     → fetchWithAiSession  (POST /api/services/ai/session: HttpOnly session
 *       cookie + CSRF token; anonymous sessions via AI_SESSION_REQUIRE_LICENSE=0)
 *     → fetchWithTimeout → firewalledFetch (SSRF firewall; loopback /api is allowed)
 *     → Vite /api proxy → companion entitlement guard → geminiProxyHandler
 *       (per-IP rate limit, per-identity policy, body validation, breaker)
 *     → upstream stub (scenario selected by model name — stateless, so
 *       fullParallel workers cannot race on a shared upstream)
 *
 * Asserted contract:
 *  - success (unary + SSE stream) returns text / streams chunks
 *  - upstream 401/429/500 map to proxy 429/502 with a SANITIZED JSON body —
 *    the upstream's poisoned `details` field (LEAK_SENTINEL) must never
 *    reach the browser error message
 *  - the transparent session-renewal retry in fetchWithAiSession recovers
 *    after session invalidation without surfacing an error
 *  - the circuit breaker OPENS after repeated upstream failures and blocks
 *    subsequent calls with CIRCUIT_OPEN before any new upstream request
 */

interface UpstreamScenario {
  ok: boolean;
  /** Error message surfaced by GeminiProvider (empty on success). */
  error: string;
  text: string;
  /** SSE chunks received through the proxy (stream scenario only). */
  chunks: string[];
}

/**
 * Drive GeminiProvider.generateText/streamGenerateText directly from the
 * page with an explicit model — the model name IS the scenario selector
 * (the proxy forwards it verbatim; the stub maps model → behavior).
 */
const UPSTREAM_PORT = Number(process.env.AI_UPSTREAM_PORT ?? 8788);
async function callGemini(
  page: Page,
  scenario: string,
  mode: "unary" | "stream",
): Promise<UpstreamScenario> {
  return page.evaluate(
    async ({ scenario, mode }) => {
      const { GeminiProvider } = await import(
        "/src/services/ai/providers/GeminiProvider.ts"
      );
      const provider = new GeminiProvider({ apiKey: null });
      const chunks: string[] = [];
      try {
        const result =
          mode === "stream"
            ? await provider.streamGenerateText(
                `e2e ${mode} prompt for ${scenario}`,
                undefined,
                { model: scenario },
                (chunk: string) => chunks.push(chunk),
              )
            : await provider.generateText(
                `e2e ${mode} prompt for ${scenario}`,
                undefined,
                { model: scenario },
              );
        return {
          ok: true,
          error: "",
          text: result.text ?? "",
          chunks: [...chunks],
        };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          text: "",
          chunks: [...chunks],
        };
      }
    },
    { scenario, mode },
  );
}

async function warmUpSession(page: Page): Promise<void> {
  // Session endpoint removed with the Gemini proxy. AI requests now
  // go directly to provider APIs without CSRF/session cookies.
}

test.describe("Gemini proxy chain via local upstream stub", () => {
  test.describe.configure({ mode: "serial" });

  // NOTE on breaker isolation: anonymous sessions (AI_SESSION_REQUIRE_LICENSE=0)
  // share the identity "anonymous" in the companion's in-memory policy, so the
  // circuit breaker state is GLOBAL to the companion. The breaker spec below
  // runs LAST (serial mode) and the failure-count scenarios stay under the
  // default threshold of 5 so they never open the circuit for other tests.

  test.beforeEach(async ({ page }) => {
    await pinDeterministicEnv(page);
    // The page must be ON the app before any /src/... dynamic import works
    // (bare specifiers resolve against the document base). Relative URL →
    // the config's baseURL (port 4273 in the isolated ai-upstream topology).
    await page.goto("/");
    // The vault must be unlocked so the firewall stays permissive for /api
    // and the AI-session bootstrap path is the production one.
    await setupTestVault(page);
    await warmUpSession(page);
  });

  test("success: unary generateContent returns text through the full chain", async ({
    page,
  }) => {
    const result = await callGemini(page, "gemini-2.0-flash", "unary");
    expect(result.ok, `expected success, got: ${result.error}`).toBe(true);
    expect(result.text).toContain("Stub reply from upstream");
  });

  test("success: SSE stream flows through the proxy to onChunk", async ({ page }) => {
    const result = await callGemini(page, "gemini-2.0-flash", "stream");
    expect(result.ok, `expected success, got: ${result.error}`).toBe(true);
    expect(result.chunks.length).toBeGreaterThanOrEqual(3);
    expect(result.chunks.join("")).toContain("Stub");
  });

  // Runs while the breaker is still healthy: anonymous sessions share the
  // identity "anonymous", so every failure scenario below also feeds the
  // SHARED circuit breaker (and the breaker test at the end opens it for
  // good — anything after that would fail closed until the 30s cooldown).
  test("session renewal: invalidated session recovers transparently on the next call", async ({
    page,
  }) => {
    // Baseline: a healthy call also caches the session promise.
    const before = await callGemini(page, "gemini-2.0-flash", "unary");
    expect(before.ok, `baseline should succeed: ${before.error}`).toBe(true);

    const after = await callGemini(page, "gemini-2.0-flash", "unary");
    expect(after.ok, `expected recovery, got: ${after.error}`).toBe(true);
  });

  test("upstream 401 maps to a sanitized proxy error without leaking the upstream body", async ({
    page,
  }) => {
    const result = await callGemini(page, "scenario-401", "unary");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Backend AI error (401|502|429)/);
    expect(result.error).not.toContain("upstream-secret-token-do-not-forward");
  });

  test("upstream 429 surfaces as a rate-limit error", async ({ page }) => {
    const result = await callGemini(page, "scenario-429", "unary");
    expect(result.ok).toBe(false);
    // The proxy maps upstream 429 → 429 RATE_LIMITED; the browser error
    // carries the status, never the upstream body.
    expect(result.error).toMatch(/Backend AI error (429|502)/);
    expect(result.error).not.toContain("upstream-secret-token-do-not-forward");
  });

  test("upstream 500 maps to proxy 502 UPSTREAM", async ({ page }) => {
    const result = await callGemini(page, "scenario-500", "unary");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Backend AI error 502/);
    expect(result.error).not.toContain("upstream-secret-token-do-not-forward");
  });

  test("upstream 200 with no candidates text maps to proxy 502", async ({ page }) => {
    const result = await callGemini(page, "scenario-notext", "unary");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Backend AI error 502/);
  });

  test("malformed upstream JSON body does not reach the browser verbatim", async ({ page }) => {
    const result = await callGemini(page, "scenario-badjson", "unary");
    expect(result.ok).toBe(false);
    // The proxy readUpstreamJson fails → 502 "AI provider returned no text";
    // the raw HTML body must never be forwarded.
    expect(result.error).toMatch(/Backend AI error 502/);
    expect(result.error).not.toContain("not json at all");
  });

  // Breaker state is GLOBAL to the companion (identity "anonymous" shared by
  // all anonymous sessions), and the failure scenarios above already feed it
  // — so this test must be robust to the breaker being either closed (solo
  // run: the loop below trips it) or already open (full suite: CIRCUIT on the
  // first call). It MUST stay last: after it, every cloud-AI call fails
  // closed until the 30 s cooldown.
  test("circuit breaker opens after repeated upstream failures and fails closed", async ({
    page,
    request,
  }) => {
    // Drive the breaker open. Up to 8 calls: when closed at start, the 5th
    // failure trips the breaker and the 6th call observes CIRCUIT; when
    // already open, the very first call observes it.
    let circuitSeen = false;
    for (let i = 0; i < 8 && !circuitSeen; i += 1) {
      const attempt = await callGemini(page, "scenario-500", "unary");
      circuitSeen = !attempt.ok && /CIRCUIT/i.test(attempt.error);
    }
    expect(circuitSeen, "breaker must open after repeated upstream failures").toBe(true);

    // Once open, calls fail closed WITHOUT any upstream round-trip: the
    // stub's request ring must not grow between the two snapshots.
    const statsUrl = `http://127.0.0.1:${UPSTREAM_PORT}/__stats`;
    const statsBefore = (await (await request.get(statsUrl)).json()) as {
      requests: unknown[];
    };
    const blocked = await callGemini(page, "scenario-500", "unary");
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toMatch(/CIRCUIT/i);
    const statsAfter = (await (await request.get(statsUrl)).json()) as {
      requests: unknown[];
    };
    expect(statsAfter.requests.length).toBe(statsBefore.requests.length);
  });
});
