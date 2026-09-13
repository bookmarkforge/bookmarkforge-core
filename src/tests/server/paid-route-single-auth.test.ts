import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGeminiProxyHandler, identityKey } from "../../../server/src/ai-proxy";
import { createGeminiMediaHandler } from "../../../server/src/ai-media";
import { createEntitlementGuard } from "../../../server/src/entitlement-guard";
import { createGuardedDispatcher, ROUTE_POLICIES } from "../../../server/src/route-table";
import type { AiSessionManager } from "../../../server/src/ai-session";

/**
 * One request, one admission decision.
 *
 * The router's entitlement guard authenticates a paid request (session cookie +
 * CSRF, or a legacy bearer token) and attaches the context it resolved. The
 * handler used to authenticate the very same request again — a second lookup of
 * the same cookie, the same CSRF constant-time compare — which is not extra
 * safety but a second verdict that can only ever disagree with the first, and
 * which the deployment pays for twice.
 *
 * These tests compose the real pieces the server composes
 * (`createGuardedDispatcher` + `createGeminiProxyHandler` /
 * `createGeminiMediaHandler`) and count the calls into the session
 * authenticator, so "the guard resolved it and the handler reused it" is
 * measured, not assumed.
 */

const servers: Array<ReturnType<typeof createServer>> = [];

async function start(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  if (!server.listening) return;
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(closeServer));
});

/** Every route that admits a caller by session or legacy bearer token. */
const PAID_ROUTES = ROUTE_POLICIES.filter(
  (policy) => policy.access === "entitlement" && policy.guard?.mode === "session-or-bearer",
);

/** A body that satisfies each route's own validation. */
const BODIES: Record<string, string> = {
  "/api/services/ai/generate": JSON.stringify({ prompt: "hola" }),
  "/api/services/ai/generate-tts": JSON.stringify({ text: "hola" }),
  "/api/services/ai/generate-image": JSON.stringify({ prompt: "logo" }),
};

/** Upstream stub: satisfies the text, TTS and image contracts in one place. */
function upstreamStub() {
  return vi.fn(async (url: string | URL | Request) => {
    const target = String(url);
    if (target.endsWith(":predict")) {
      return new Response(JSON.stringify({ predictions: [{ bytesBase64: "QUJD" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: "ok" }, { inlineData: { data: "QUJD" } }] } }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  });
}

/** The server's real composition, with a countable session authenticator. */
function compose(options: {
  authenticate: (req: IncomingMessage) => Promise<{ identity: string; csrfToken: string } | null>;
  bearerTokens?: readonly string[];
}) {
  const bearerTokens = new Set(options.bearerTokens ?? []);
  const guard = createEntitlementGuard({
    authenticateSession: (req) => options.authenticate(req),
    bearerTokens,
  });
  const sessionManager = { authenticate: options.authenticate } as unknown as AiSessionManager;
  const upstream = upstreamStub();
  const proxy = createGeminiProxyHandler({
    apiKey: "server-key",
    sessionManager,
    ...(bearerTokens.size > 0 ? { authTokens: [...bearerTokens] } : {}),
    fetchImpl: upstream as unknown as typeof fetch,
  });
  // index.ts shares the text proxy's policy with the media handlers so both
  // modalities charge the same identity; the composition must match.
  const media = createGeminiMediaHandler({
    apiKey: "server-key",
    sessionManager,
    ...(bearerTokens.size > 0 ? { authTokens: [...bearerTokens] } : {}),
    accessPolicy: proxy.accessPolicy,
    fetchImpl: upstream as unknown as typeof fetch,
  });
  const dispatcher = createGuardedDispatcher({
    guard,
    dispatch: (req: IncomingMessage, res: ServerResponse) => {
      const path = new URL(req.url ?? "/", "http://localhost").pathname;
      if (path === "/api/services/ai/generate") return proxy(req, res);
      return media(req, res);
    },
  });
  return { guard, proxy, dispatcher, upstream };
}

describe("paid routes authenticate once per request", () => {
  it("covers every session-or-bearer route the route table declares", () => {
    // A new paid modality must be added here (and made single-admission) rather
    // than silently escaping the contract below.
    expect(PAID_ROUTES.map((policy) => policy.path).sort()).toEqual(Object.keys(BODIES).sort());
  });

  it("lets the guard resolve the session and the handler reuse that verdict", async () => {
    const authenticate = vi.fn(async () => ({ identity: "session-identity", csrfToken: "csrf" }));
    const { dispatcher, upstream } = compose({ authenticate });
    const base = await start((req, res) => void dispatcher(req, res));

    for (const route of PAID_ROUTES) {
      authenticate.mockClear();
      const response = await fetch(`${base}${route.path}`, {
        method: "POST",
        body: BODIES[route.path],
        headers: { "content-type": "application/json" },
      });
      expect(response.status).toBe(200);
      // Exactly one: the guard's. Before the fix this was two — the guard's and
      // the handler's re-authentication of the same cookie.
      expect(authenticate).toHaveBeenCalledTimes(1);
    }
    expect(upstream).toHaveBeenCalledTimes(PAID_ROUTES.length);
  });

  it("charges the identity the guard resolved, so reuse cannot drift the quota key", async () => {
    const token = "legacy-bearer-token";
    const authenticate = vi.fn(async () => null);
    const { dispatcher, proxy } = compose({ authenticate, bearerTokens: [token] });
    const base = await start((req, res) => void dispatcher(req, res));

    // Both handlers (text and media) share the policy, exactly as index.ts
    // wires them, so the identity anchor below covers both.
    for (const path of ["/api/services/ai/generate", "/api/services/ai/generate-tts"]) {
      const response = await fetch(`${base}${path}`, {
        method: "POST",
        body: BODIES[path],
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(200);
    }
    // One session lookup per request, the guard's (it tries the session before
    // the bearer fallback) — and none from the handlers, which read the
    // identity straight off the context. Before the fix this was two per
    // request: the guard's and the handler's re-authentication.
    expect(authenticate).toHaveBeenCalledTimes(2);
    // Every request was charged to the hashed token — the same key bearer
    // requests were charged to before the context was reused. A different
    // identity here would silently reset or merge a caller's daily budget.
    const identities = proxy.accessPolicy.getStats().map((entry) => entry.identity);
    expect(identities).toEqual([identityKey(token)]);
  });

  it("still denies a paid request no credential vouches for", async () => {
    const authenticate = vi.fn(async () => null);
    const { dispatcher, upstream } = compose({ authenticate });
    const base = await start((req, res) => void dispatcher(req, res));

    const response = await fetch(`${base}/api/services/ai/generate`, {
      method: "POST",
      body: BODIES["/api/services/ai/generate"],
      headers: { "content-type": "application/json" },
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: "UNAUTHORIZED", message: "AI proxy authentication required" },
    });
    expect(authenticate).toHaveBeenCalledTimes(1);
    expect(upstream).not.toHaveBeenCalled();
  });
});
