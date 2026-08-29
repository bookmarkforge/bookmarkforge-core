import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createNetServer, type AddressInfo } from "node:net";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFileStateStore,
  createGeminiProxyHandler,
  createMetricsCollector,
  validateStateFilePath,
  createMemoryStateStore,
  createRedisStateStore,
  createRedisClientFromUrl,
} from "../../../server/src/ai-proxy";

const servers: Array<ReturnType<typeof createServer>> = [];
const redisServers: Array<ReturnType<typeof createNetServer>> = [];

async function start(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

/** Close a server immediately, dropping keep-alive sockets so the test can simulate a restart. */
async function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  if (!server.listening) return;
  (server as ReturnType<typeof createNetServer> & { closeAllConnections?: () => void }).closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function closeRedisServer(server: ReturnType<typeof createNetServer>): Promise<void> {
  if (!server.listening) return;
  (server as ReturnType<typeof createNetServer> & { closeAllConnections?: () => void }).closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(closeServer));
  await Promise.all(redisServers.splice(0).map(closeRedisServer));
});

describe("Gemini server proxy", () => {
  it("fails closed when the server-side key is missing", async () => {
    const upstream = vi.fn();
    const base = await start((req, res) => {
      void createGeminiProxyHandler({ fetchImpl: upstream, apiKey: "" })(req, res);
    });

    const response = await fetch(`${base}/api/services/ai/generate`, {
      method: "POST",
      body: JSON.stringify({ prompt: "hello" }),
      headers: {
        "content-type": "application/json",
        authorization: "Bearer proxy-secret",
      },
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: { code: "NOT_CONFIGURED", message: "AI proxy is not configured" },
    });
    expect(upstream).not.toHaveBeenCalled();
  });

  it("translates a bounded request to Gemini and returns only the safe text shape", async () => {
    const upstream = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent",
      );
      expect(init?.headers).toEqual({
        "Content-Type": "application/json",
        "x-goog-api-key": "server-secret",
      });
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.contents).toEqual([
        { role: "user", parts: [{ text: "hello" }] },
      ]);
      expect(body.systemInstruction).toEqual({
        parts: [{ text: "be concise" }],
      });
      return new Response(
        JSON.stringify({
          candidates: [{
            content: { parts: [{ text: "world" }] },
            groundingMetadata: { source: "test" },
          }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const handler = createGeminiProxyHandler({
      apiKey: "server-secret",
      authToken: "proxy-secret",
      fetchImpl: upstream as unknown as typeof fetch,
    });
    const base = await start((req, res) => { void handler(req, res); });

    const response = await fetch(`${base}/api/services/ai/generate`, {
      method: "POST",
      body: JSON.stringify({
        prompt: "hello",
        systemPrompt: "be concise",
        model: "gemini-2.0-flash",
      }),
      headers: {
        "content-type": "application/json",
        authorization: "Bearer proxy-secret",
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      text: "world",
      groundingMetadata: { source: "test" },
    });
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it("rejects unauthenticated requests before calling Gemini", async () => {
    const upstream = vi.fn();
    const handler = createGeminiProxyHandler({
      apiKey: "server-secret",
      authToken: "proxy-secret",
      fetchImpl: upstream as unknown as typeof fetch,
    });
    const base = await start((req, res) => { void handler(req, res); });

    const response = await fetch(`${base}/api/services/ai/generate`, {
      method: "POST",
      body: JSON.stringify({ prompt: "hello" }),
      headers: { "content-type": "application/json" },
    });

    expect(response.status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("enforces the per-client rate limit before calling Gemini", async () => {
    const upstream = vi.fn(async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: "ok" }] } }],
    }), { status: 200 }));
    const handler = createGeminiProxyHandler({
      apiKey: "server-secret",
      authToken: "proxy-secret",
      rateLimit: 1,
      fetchImpl: upstream as unknown as typeof fetch,
    });
    const base = await start((req, res) => { void handler(req, res); });
    const request = () => fetch(`${base}/api/services/ai/generate`, {
      method: "POST",
      body: JSON.stringify({ prompt: "hello" }),
      headers: {
        "content-type": "application/json",
        authorization: "Bearer proxy-secret",
      },
    });

    expect((await request()).status).toBe(200);
    expect((await request()).status).toBe(429);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it("uses the trusted forwarded client IP for rate limiting behind a proxy", async () => {
    const upstream = vi.fn(async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: "ok" }] } }],
    }), { status: 200 }));
    const handler = createGeminiProxyHandler({
      apiKey: "server-secret",
      authToken: "proxy-secret",
      trustProxy: true,
      rateLimit: 1,
      fetchImpl: upstream as unknown as typeof fetch,
    });
    const base = await start((req, res) => { void handler(req, res); });
    const request = (ip: string) => fetch(`${base}/api/services/ai/generate`, {
      method: "POST",
      body: JSON.stringify({ prompt: "hello" }),
      headers: {
        "content-type": "application/json",
        authorization: "Bearer proxy-secret",
        "x-forwarded-for": ip,
      },
    });

    expect((await request("198.51.100.10")).status).toBe(200);
    expect((await request("198.51.100.11")).status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it("adapts Gemini SSE events to the client's OpenAI-compatible stream reader", async () => {
    const encoder = new TextEncoder();
    const upstream = vi.fn(async () => new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(
            `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "one" }] } }] })}\n\n`,
          ));
          controller.enqueue(encoder.encode(
            `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: " two" }] } }] })}\n\n`,
          ));
          controller.close();
        },
      }),
      { status: 200, headers: { "content-type": "text/event-stream" } },
    ));
    const handler = createGeminiProxyHandler({
      apiKey: "server-secret",
      authToken: "proxy-secret",
      fetchImpl: upstream as unknown as typeof fetch,
    });
    const base = await start((req, res) => { void handler(req, res); });

    const response = await fetch(`${base}/api/services/ai/generate`, {
      method: "POST",
      body: JSON.stringify({ prompt: "hello", stream: true }),
      headers: {
        "content-type": "application/json",
        authorization: "Bearer proxy-secret",
      },
    });
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(text).toContain('"content":"one"');
    expect(text).toContain('"content":" two"');
    expect(text).toContain("data: [DONE]");
  });

  it("rejects non-POST methods", async () => {
    const upstream = vi.fn();
    const handler = createGeminiProxyHandler({
      apiKey: "server-secret",
      authToken: "proxy-secret",
      fetchImpl: upstream as unknown as typeof fetch,
    });
    const base = await start((req, res) => { void handler(req, res); });

    const response = await fetch(`${base}/api/services/ai/generate`, {
      method: "GET",
    });

    expect(response.status).toBe(405);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON bodies", async () => {
    const upstream = vi.fn();
    const handler = createGeminiProxyHandler({
      apiKey: "server-secret",
      authToken: "proxy-secret",
      fetchImpl: upstream as unknown as typeof fetch,
    });
    const base = await start((req, res) => { void handler(req, res); });

    const response = await fetch(`${base}/api/services/ai/generate`, {
      method: "POST",
      body: "{not json",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer proxy-secret",
      },
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_REQUEST" } });
    expect(upstream).not.toHaveBeenCalled();
  });

  it("rejects invalid prompts before calling Gemini", async () => {
    const upstream = vi.fn();
    const handler = createGeminiProxyHandler({
      apiKey: "server-secret",
      authToken: "proxy-secret",
      fetchImpl: upstream as unknown as typeof fetch,
    });
    const base = await start((req, res) => { void handler(req, res); });

    const response = await fetch(`${base}/api/services/ai/generate`, {
      method: "POST",
      body: JSON.stringify({ prompt: "" }),
      headers: {
        "content-type": "application/json",
        authorization: "Bearer proxy-secret",
      },
    });

    expect(response.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("does not consume daily quota for malformed or invalid bodies", async () => {
    const upstream = vi.fn(async () => okUpstream());
    const handler = createGeminiProxyHandler({
      apiKey: "server-secret",
      authToken: "proxy-secret",
      identityRateLimit: 100,
      dailyQuota: 1,
      fetchImpl: upstream as unknown as typeof fetch,
    });
    const base = await start((req, res) => { void handler(req, res); });
    const headers = {
      "content-type": "application/json",
      authorization: "Bearer proxy-secret",
    };

    const malformed = await fetch(`${base}/api/services/ai/generate`, {
      method: "POST",
      body: "{not json",
      headers,
    });
    expect(malformed.status).toBe(400);

    const valid = await postGenerate(base, "proxy-secret");
    expect(valid.status).toBe(200);
    expect((await postGenerate(base, "proxy-secret")).status).toBe(429);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it("translates an upstream 429 into a rate-limited response", async () => {
    const upstream = vi.fn(async () => new Response("", { status: 429 }));
    const handler = createGeminiProxyHandler({
      apiKey: "server-secret",
      authToken: "proxy-secret",
      fetchImpl: upstream as unknown as typeof fetch,
    });
    const base = await start((req, res) => { void handler(req, res); });

    const response = await fetch(`${base}/api/services/ai/generate`, {
      method: "POST",
      body: JSON.stringify({ prompt: "hello" }),
      headers: {
        "content-type": "application/json",
        authorization: "Bearer proxy-secret",
      },
    });

    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ error: { code: "RATE_LIMITED" } });
  });

  it("translates an upstream 5xx into a 502", async () => {
    const upstream = vi.fn(async () => new Response("boom", { status: 500 }));
    const handler = createGeminiProxyHandler({
      apiKey: "server-secret",
      authToken: "proxy-secret",
      fetchImpl: upstream as unknown as typeof fetch,
    });
    const base = await start((req, res) => { void handler(req, res); });

    const response = await fetch(`${base}/api/services/ai/generate`, {
      method: "POST",
      body: JSON.stringify({ prompt: "hello" }),
      headers: {
        "content-type": "application/json",
        authorization: "Bearer proxy-secret",
      },
    });

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: { code: "UPSTREAM" } });
  });

  it("returns 502 when the upstream response is not usable JSON", async () => {
    const upstream = vi.fn(async () => new Response("not-json", { status: 200 }));
    const handler = createGeminiProxyHandler({
      apiKey: "server-secret",
      authToken: "proxy-secret",
      fetchImpl: upstream as unknown as typeof fetch,
    });
    const base = await start((req, res) => { void handler(req, res); });

    const response = await fetch(`${base}/api/services/ai/generate`, {
      method: "POST",
      body: JSON.stringify({ prompt: "hello" }),
      headers: {
        "content-type": "application/json",
        authorization: "Bearer proxy-secret",
      },
    });

    expect(response.status).toBe(502);
  });

  it("supports the models/ prefix in the requested model name", async () => {
    const upstream = vi.fn(async (_url: string) => new Response(
      JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }),
      { status: 200 },
    ));
    const handler = createGeminiProxyHandler({
      apiKey: "server-secret",
      authToken: "proxy-secret",
      fetchImpl: upstream as unknown as typeof fetch,
    });
    const base = await start((req, res) => { void handler(req, res); });

    const response = await fetch(`${base}/api/services/ai/generate`, {
      method: "POST",
      body: JSON.stringify({ prompt: "hello", model: "models/gemini-2.0-flash" }),
      headers: {
        "content-type": "application/json",
        authorization: "Bearer proxy-secret",
      },
    });

    expect(response.status).toBe(200);
    const url = upstream.mock.calls[0]?.[0] as string;
    expect(url).toContain("gemini-2.0-flash:generateContent");
    expect(url).not.toContain("models/models/");
  });
});

describe("Gemini server proxy — abuse resistance", () => {
  it("ignores a spoofed X-Forwarded-For header when the proxy is not trusted", async () => {
    const upstream = vi.fn(async () => new Response(
      JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }),
      { status: 200 },
    ));
    const handler = createGeminiProxyHandler({
      apiKey: "server-secret",
      authToken: "proxy-secret",
      trustProxy: false,
      rateLimit: 1,
      fetchImpl: upstream as unknown as typeof fetch,
    });
    const base = await start((req, res) => { void handler(req, res); });
    const request = (ip: string) => fetch(`${base}/api/services/ai/generate`, {
      method: "POST",
      body: JSON.stringify({ prompt: "hello" }),
      headers: {
        "content-type": "application/json",
        authorization: "Bearer proxy-secret",
        "x-forwarded-for": ip,
      },
    });

    // Both requests share the socket address; an attacker cannot reset the
    // per-IP window by rotating a spoofable forwarded header.
    expect((await request("198.51.100.1")).status).toBe(200);
    expect((await request("198.51.100.2")).status).toBe(429);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed and mismatched bearer tokens without reaching Gemini", async () => {
    const upstream = vi.fn();
    const handler = createGeminiProxyHandler({
      apiKey: "server-secret",
      authToken: "proxy-secret",
      fetchImpl: upstream as unknown as typeof fetch,
    });
    const base = await start((req, res) => { void handler(req, res); });

    const attempts: Array<Record<string, string>> = [
      { "content-type": "application/json" }, // missing header
      { "content-type": "application/json", authorization: "Basic cHJveHktc2VjcmV0" },
      { "content-type": "application/json", authorization: "Bearer" },
      { "content-type": "application/json", authorization: "Bearer proxy-secr3t" },
      { "content-type": "application/json", authorization: "Bearer with space" },
      { "content-type": "application/json", authorization: `Bearer ${"x".repeat(5000)}` },
    ];

    for (const headers of attempts) {
      const response = await fetch(`${base}/api/services/ai/generate`, {
        method: "POST",
        body: JSON.stringify({ prompt: "hello" }),
        headers,
      });
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        error: { code: "UNAUTHORIZED", message: "AI proxy authentication required" },
      });
    }
    expect(upstream).not.toHaveBeenCalled();
  });

  it("rejects oversized request bodies with 413 before reaching Gemini", async () => {
    const upstream = vi.fn();
    const handler = createGeminiProxyHandler({
      apiKey: "server-secret",
      authToken: "proxy-secret",
      fetchImpl: upstream as unknown as typeof fetch,
    });
    const base = await start((req, res) => { void handler(req, res); });

    const oversized = "x".repeat(256 * 1024 + 1);
    const response = await fetch(`${base}/api/services/ai/generate`, {
      method: "POST",
      body: oversized,
      headers: {
        "content-type": "application/json",
        authorization: "Bearer proxy-secret",
      },
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      error: { code: "INVALID_REQUEST", message: "request body is invalid or too large" },
    });
    expect(upstream).not.toHaveBeenCalled();
  });

  it("returns 502 when the upstream stream has no readable body", async () => {
    const upstream = vi.fn(async () => new Response(null, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }));
    const handler = createGeminiProxyHandler({
      apiKey: "server-secret",
      authToken: "proxy-secret",
      fetchImpl: upstream as unknown as typeof fetch,
    });
    const base = await start((req, res) => { void handler(req, res); });

    const response = await fetch(`${base}/api/services/ai/generate`, {
      method: "POST",
      body: JSON.stringify({ prompt: "hello", stream: true }),
      headers: {
        "content-type": "application/json",
        authorization: "Bearer proxy-secret",
      },
    });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: { code: "UPSTREAM", message: "AI provider stream unavailable" },
    });
  });

  it("does not count a client-aborted stream as an upstream breaker failure", async () => {
    const encoder = new TextEncoder();
    let release: (() => void) | undefined;
    const upstream = vi.fn(async (url: string) => {
      if (url.includes("streamGenerateContent")) {
        return new Response(new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(
              `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "partial" }] } }] })}\n\n`,
            ));
            release = () => controller.close();
          },
        }), { status: 200, headers: { "content-type": "text/event-stream" } });
      }
      return okUpstream("healthy");
    });
    let current = Date.parse("2026-08-21T10:00:00Z");
    const handler = createGeminiProxyHandler({
      apiKey: "server-secret",
      authToken: "proxy-secret",
      identityRateLimit: 1000,
      dailyQuota: 1000,
      circuitBreaker: { threshold: 1, cooldownMs: 60_000 },
      now: () => current,
      fetchImpl: upstream as unknown as typeof fetch,
    });
    const base = await start((req, res) => { void handler(req, res); });

    const controller = new AbortController();
    const request = fetch(`${base}/api/services/ai/generate`, {
      method: "POST",
      body: JSON.stringify({ prompt: "hello", stream: true }),
      headers: { "content-type": "application/json", authorization: "Bearer proxy-secret" },
      signal: controller.signal,
    });
    const response = await request;
    await response.body?.getReader().read();
    controller.abort();
    release?.();
    await new Promise((resolve) => setTimeout(resolve, 20));

    // A client cancellation must not open the breaker, even with threshold=1.
    expect((await postGenerate(base, "proxy-secret")).status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(2);
    void current;
  });

  it("terminates an upstream stream that errors mid-read and keeps serving", async () => {
    const encoder = new TextEncoder();
    const upstream = vi.fn(async (url: string) => {
      if (url.includes("streamGenerateContent")) {
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(encoder.encode(
                `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "partial" }] } }] })}\n\n`,
              ));
            },
            pull(controller) {
              controller.error(new Error("upstream stream failed"));
            },
          }),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        );
      }
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: "healthy" }] } }] }),
        { status: 200 },
      );
    });
    const handler = createGeminiProxyHandler({
      apiKey: "server-secret",
      authToken: "proxy-secret",
      fetchImpl: upstream as unknown as typeof fetch,
    });
    const base = await start((req, res) => { void handler(req, res); });

    // The handler destroys the socket once the upstream stream fails, so the
    // client side must terminate (either the request or the body read throws)
    // rather than hang. A clean read would mean the interruption never
    // surfaced and is a real failure worth flagging.
    await expect(
      (async () => {
        const streamed = await fetch(`${base}/api/services/ai/generate`, {
          method: "POST",
          body: JSON.stringify({ prompt: "hello", stream: true }),
          headers: {
            "content-type": "application/json",
            authorization: "Bearer proxy-secret",
          },
        });
        await streamed.text();
      })(),
    ).rejects.toBeTruthy();

    // The handler must remain healthy for the next request.
    const followUp = await fetch(`${base}/api/services/ai/generate`, {
      method: "POST",
      body: JSON.stringify({ prompt: "hello" }),
      headers: {
        "content-type": "application/json",
        authorization: "Bearer proxy-secret",
      },
    });
    expect(followUp.status).toBe(200);
    expect(await followUp.json()).toEqual({ text: "healthy" });
  });
});

function postGenerate(base: string, token: string): Promise<Response> {
  return fetch(`${base}/api/services/ai/generate`, {
    method: "POST",
    body: JSON.stringify({ prompt: "hello" }),
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
  });
}

const okUpstream = (text = "ok") => new Response(
  JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }),
  { status: 200 },
);

describe("Gemini server proxy — per-identity policy", () => {
  it("gives each identity token an independent rate budget", async () => {
    const upstream = vi.fn(async () => okUpstream());
    const handler = createGeminiProxyHandler({
      apiKey: "server-secret",
      authTokens: ["token-a", "token-b"],
      identityRateLimit: 1,
      fetchImpl: upstream as unknown as typeof fetch,
    });
    const base = await start((req, res) => { void handler(req, res); });

    // token-a exhausts its own budget; token-b is untouched.
    expect((await postGenerate(base, "token-a")).status).toBe(200);
    expect((await postGenerate(base, "token-a")).status).toBe(429);
    expect((await postGenerate(base, "token-b")).status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it("enforces a per-identity daily quota and rolls over at the UTC day boundary", async () => {
    const upstream = vi.fn(async () => okUpstream());
    let current = Date.parse("2026-08-21T10:00:00Z");
    const handler = createGeminiProxyHandler({
      apiKey: "server-secret",
      authToken: "proxy-secret",
      identityRateLimit: 100,
      dailyQuota: 2,
      now: () => current,
      fetchImpl: upstream as unknown as typeof fetch,
    });
    const base = await start((req, res) => { void handler(req, res); });

    expect((await postGenerate(base, "proxy-secret")).status).toBe(200);
    expect((await postGenerate(base, "proxy-secret")).status).toBe(200);

    const quotaExceeded = await postGenerate(base, "proxy-secret");
    expect(quotaExceeded.status).toBe(429);
    expect(await quotaExceeded.json()).toEqual({
      error: { code: "QUOTA_EXCEEDED", message: "daily quota exceeded" },
    });

    // A new UTC day resets the quota for the same identity.
    current += 24 * 60 * 60 * 1000;
    expect((await postGenerate(base, "proxy-secret")).status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(3);
  });

  it("opens the circuit breaker after consecutive failures and recovers on a half-open probe", async () => {
    let failUpstream = true;
    const upstream = vi.fn(async () => failUpstream
      ? new Response("", { status: 500 })
      : okUpstream("recovered"));
    const metrics = createMetricsCollector();
    let current = Date.parse("2026-08-21T10:00:00Z");
    const handler = createGeminiProxyHandler({
      apiKey: "server-secret",
      authToken: "proxy-secret",
      identityRateLimit: 1000,
      dailyQuota: 1000,
      circuitBreaker: { threshold: 2, cooldownMs: 60_000 },
      now: () => current,
      metrics,
      fetchImpl: upstream as unknown as typeof fetch,
    });
    const base = await start((req, res) => { void handler(req, res); });

    // Two consecutive upstream failures close the circuit after the
    // threshold; the open transition must be observable in the metrics.
    expect((await postGenerate(base, "proxy-secret")).status).toBe(502);
    expect((await postGenerate(base, "proxy-secret")).status).toBe(502);
    expect(metrics.breakerOpens).toBe(1);

    const open = await postGenerate(base, "proxy-secret");
    expect(open.status).toBe(503);
    expect(await open.json()).toEqual({
      error: { code: "CIRCUIT_OPEN", message: "AI provider is temporarily unavailable" },
    });
    expect(upstream).toHaveBeenCalledTimes(2);

    // Once the cooldown elapses, a half-open probe is allowed through, is
    // counted once as admitted, and its success closes the circuit — the
    // probe-success counter follows the transition.
    current += 60_000;
    failUpstream = false;
    expect(metrics.breakerProbes).toBe(0);
    expect((await postGenerate(base, "proxy-secret")).status).toBe(200);
    expect(metrics.breakerProbes).toBe(1);
    expect(metrics.breakerProbeSuccesses).toBe(1);
    expect(metrics.breakerProbeReleases).toBe(0);
    expect((await postGenerate(base, "proxy-secret")).status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(4);
    expect(metrics.breakerProbes).toBe(1);
  });

  it("makes the half-open probe single-flight while it is in flight", async () => {
    let upstreamMode: "fail" | "hold" | "ok" = "fail";
    let releaseHeldProbe: () => void = () => {};
    let markProbeStarted: () => void = () => {};
    const probeStarted = new Promise<void>((resolve) => {
      markProbeStarted = resolve;
    });
    const upstream = vi.fn(async () => {
      if (upstreamMode === "fail") return new Response("", { status: 500 });
      if (upstreamMode === "hold") {
        // Hold the probe in flight at the upstream until the test releases it.
        markProbeStarted();
        await new Promise<void>((resolve) => {
          releaseHeldProbe = resolve;
        });
        return new Response("", { status: 500 });
      }
      return okUpstream("recovered");
    });
    let current = Date.parse("2026-08-21T10:00:00Z");
    const handler = createGeminiProxyHandler({
      apiKey: "server-secret",
      authToken: "proxy-secret",
      identityRateLimit: 1000,
      dailyQuota: 1000,
      circuitBreaker: { threshold: 2, cooldownMs: 60_000 },
      now: () => current,
      fetchImpl: upstream as unknown as typeof fetch,
    });
    const base = await start((req, res) => { void handler(req, res); });

    // Two consecutive upstream failures open the circuit.
    expect((await postGenerate(base, "proxy-secret")).status).toBe(502);
    expect((await postGenerate(base, "proxy-secret")).status).toBe(502);
    expect((await postGenerate(base, "proxy-secret")).status).toBe(503);
    expect(upstream).toHaveBeenCalledTimes(2);

    // Cooldown elapses; the first arriving request becomes the single
    // half-open probe and is held in flight at the upstream.
    current += 60_000;
    upstreamMode = "hold";
    const probe = postGenerate(base, "proxy-secret");
    await probeStarted;

    // Requests arriving while the probe is in flight are rejected fast —
    // they must NOT be admitted as additional probes (a recovery burst).
    const concurrent = await postGenerate(base, "proxy-secret");
    expect(concurrent.status).toBe(503);
    expect(await concurrent.json()).toEqual({
      error: { code: "CIRCUIT_OPEN", message: "AI provider is temporarily unavailable" },
    });
    expect(upstream).toHaveBeenCalledTimes(3);

    // The held probe fails → the breaker re-opens for another cooldown.
    releaseHeldProbe();
    expect((await probe).status).toBe(502);
    expect((await postGenerate(base, "proxy-secret")).status).toBe(503);
    expect(upstream).toHaveBeenCalledTimes(3);

    // After the next cooldown a fresh single probe succeeds and closes the
    // circuit; normal traffic resumes.
    current += 60_000;
    upstreamMode = "ok";
    expect((await postGenerate(base, "proxy-secret")).status).toBe(200);
    expect((await postGenerate(base, "proxy-secret")).status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(5);
  });

  it("releases a probe rejected before the upstream so the breaker is not stuck", async () => {
    let failUpstream = true;
    const upstream = vi.fn(async () => failUpstream
      ? new Response("", { status: 500 })
      : okUpstream("recovered"));
    let current = Date.parse("2026-08-21T10:00:00Z");
    const metrics = createMetricsCollector();
    const handler = createGeminiProxyHandler({
      apiKey: "server-secret",
      authToken: "proxy-secret",
      identityRateLimit: 1000,
      dailyQuota: 1000,
      circuitBreaker: { threshold: 2, cooldownMs: 60_000 },
      now: () => current,
      metrics,
      fetchImpl: upstream as unknown as typeof fetch,
    });
    const base = await start((req, res) => { void handler(req, res); });

    // Two consecutive upstream failures open the circuit.
    expect((await postGenerate(base, "proxy-secret")).status).toBe(502);
    expect((await postGenerate(base, "proxy-secret")).status).toBe(502);
    expect((await postGenerate(base, "proxy-secret")).status).toBe(503);
    expect(upstream).toHaveBeenCalledTimes(2);

    // The first request after the cooldown is the probe, but its body is
    // malformed: the proxy rejects it locally (400) and must release the
    // latch — otherwise the breaker would stay half-open forever.
    current += 60_000;
    const malformedProbe = await fetch(`${base}/api/services/ai/generate`, {
      method: "POST",
      body: "{not json",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer proxy-secret",
      },
    });
    expect(malformedProbe.status).toBe(400);
    expect(upstream).toHaveBeenCalledTimes(2);
    // The probe was admitted and then released locally (invalid body), so
    // the release counter observes the transition; no probe ever reached
    // the upstream, so no success/release double-count.
    expect(metrics.breakerProbeReleases).toBe(1);
    expect(metrics.breakerProbeSuccesses).toBe(0);

    // The latch was released: the next valid request is admitted normally
    // (the breaker is no longer open), succeeds, and closes the circuit.
    failUpstream = false;
    expect((await postGenerate(base, "proxy-secret")).status).toBe(200);
    expect((await postGenerate(base, "proxy-secret")).status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(4);
  });

  it("reads multi-identity tokens and quotas from the environment", async () => {
    vi.stubEnv("AI_PROXY_AUTH_TOKENS", "env-token-a, env-token-b");
    vi.stubEnv("AI_PROXY_DAILY_QUOTA", "1");
    try {
      const upstream = vi.fn(async () => okUpstream());
      const handler = createGeminiProxyHandler({
        apiKey: "server-secret",
        identityRateLimit: 100,
        fetchImpl: upstream as unknown as typeof fetch,
      });
      const base = await start((req, res) => { void handler(req, res); });

      expect((await postGenerate(base, "env-token-a")).status).toBe(200);
      const quotaExceeded = await postGenerate(base, "env-token-a");
      expect(quotaExceeded.status).toBe(429);
      expect(await quotaExceeded.json()).toMatchObject({ error: { code: "QUOTA_EXCEEDED" } });

      // A second identity from the same env list keeps its own quota.
      expect((await postGenerate(base, "env-token-b")).status).toBe(200);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("persists the daily quota across process restarts", async () => {
    const store = createMemoryStateStore();
    const upstream = vi.fn(async () => okUpstream());
    let current = Date.parse("2026-08-21T10:00:00Z");
    const makeHandler = () => createGeminiProxyHandler({
      apiKey: "server-secret",
      authToken: "proxy-secret",
      identityRateLimit: 100,
      dailyQuota: 2,
      now: () => current,
      stateStore: store,
      fetchImpl: upstream as unknown as typeof fetch,
    });

    // Pre-restart process: the identity consumes its full daily quota.
    const first = await start((req, res) => { void makeHandler()(req, res); });
    expect((await postGenerate(first, "proxy-secret")).status).toBe(200);
    expect((await postGenerate(first, "proxy-secret")).status).toBe(200);
    expect((await postGenerate(first, "proxy-secret")).status).toBe(429);
    await closeServer(servers[servers.length - 1]!);

    // Restart: a fresh handler over the same store still enforces the quota.
    const second = await start((req, res) => { void makeHandler()(req, res); });
    const afterRestart = await postGenerate(second, "proxy-secret");
    expect(afterRestart.status).toBe(429);
    expect(await afterRestart.json()).toEqual({
      error: { code: "QUOTA_EXCEEDED", message: "daily quota exceeded" },
    });

    // A new UTC day rolls the quota over for the same identity.
    current += 24 * 60 * 60 * 1000;
    expect((await postGenerate(second, "proxy-secret")).status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(3);
  });

  it("persists an open circuit breaker across process restarts", async () => {
    const store = createMemoryStateStore();
    let failUpstream = true;
    const upstream = vi.fn(async () => failUpstream
      ? new Response("", { status: 500 })
      : okUpstream("recovered"));
    let current = Date.parse("2026-08-21T10:00:00Z");
    const makeHandler = () => createGeminiProxyHandler({
      apiKey: "server-secret",
      authToken: "proxy-secret",
      identityRateLimit: 1000,
      dailyQuota: 1000,
      circuitBreaker: { threshold: 2, cooldownMs: 60_000 },
      now: () => current,
      stateStore: store,
      fetchImpl: upstream as unknown as typeof fetch,
    });

    // Pre-restart process: two consecutive upstream failures open the breaker.
    const first = await start((req, res) => { void makeHandler()(req, res); });
    expect((await postGenerate(first, "proxy-secret")).status).toBe(502);
    expect((await postGenerate(first, "proxy-secret")).status).toBe(502);
    expect((await postGenerate(first, "proxy-secret")).status).toBe(503);
    await closeServer(servers[servers.length - 1]!);

    // Restart: the open breaker is restored — still rejecting during the
    // cooldown, without calling the upstream again.
    const second = await start((req, res) => { void makeHandler()(req, res); });
    const stillOpen = await postGenerate(second, "proxy-secret");
    expect(stillOpen.status).toBe(503);
    expect(await stillOpen.json()).toEqual({
      error: { code: "CIRCUIT_OPEN", message: "AI provider is temporarily unavailable" },
    });
    expect(upstream).toHaveBeenCalledTimes(2);

    // Once the cooldown elapses the restored breaker admits a single probe,
    // which now succeeds and closes the circuit.
    current += 60_000;
    failUpstream = false;
    expect((await postGenerate(second, "proxy-secret")).status).toBe(200);
    expect((await postGenerate(second, "proxy-secret")).status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(4);
  });

  it("rejects all pending Redis commands when a command times out", async () => {
    const sockets = new Set<import("node:net").Socket>();
    const redis = createNetServer((socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
      // Deliberately never answer; the client timeout must settle every waiter.
    });
    redisServers.push(redis);
    await new Promise<void>((resolve) => redis.listen(0, "127.0.0.1", resolve));
    const address = redis.address() as AddressInfo;
    const client = createRedisClientFromUrl(`redis://127.0.0.1:${address.port}`, {
      commandTimeoutMs: 100,
    });
    const started = Date.now();
    const results = await Promise.allSettled([client.get("one"), client.get("two")]);
    expect(results.every((result) => result.status === "rejected")).toBe(true);
    expect(Date.now() - started).toBeLessThan(2_000);
    for (const socket of sockets) socket.destroy();
  });

  it("reconnects once after Redis closes a connection before replying", async () => {
    const crlf = String.fromCharCode(13, 10);
    let connections = 0;
    const sockets = new Set<import("node:net").Socket>();
    const redis = createNetServer((socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
      connections += 1;
      socket.once("data", () => {
        if (connections === 1) {
          socket.destroy();
          return;
        }
        socket.write(`$2${crlf}ok${crlf}`);
      });
    });
    redisServers.push(redis);
    await new Promise<void>((resolve) => redis.listen(0, "127.0.0.1", resolve));
    const address = redis.address() as AddressInfo;
    const client = createRedisClientFromUrl(`redis://127.0.0.1:${address.port}`);

    await expect(client.get("reconnect")).resolves.toBe("ok");
    expect(connections).toBe(2);
    for (const socket of sockets) socket.destroy();
  });

  it("rejects an oversized Redis response before retaining its payload", async () => {
    const crlf = String.fromCharCode(13, 10);
    const sockets = new Set<import("node:net").Socket>();
    const redis = createNetServer((socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
      socket.once("data", () => {
        socket.write(`$70000${crlf}`);
      });
    });
    redisServers.push(redis);
    await new Promise<void>((resolve) => redis.listen(0, "127.0.0.1", resolve));
    const address = redis.address() as AddressInfo;
    const client = createRedisClientFromUrl(`redis://127.0.0.1:${address.port}`, {
      maxResponseBytes: 64 * 1024,
    });

    await expect(client.get("oversized")).rejects.toThrow(/too large|exceeds/i);
    for (const socket of sockets) socket.destroy();
  });

  it("parses a Redis integer reply such as :1 from DEL", async () => {
    const sockets = new Set<import("node:net").Socket>();
    const redis = createNetServer((socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
      socket.once("data", () => socket.write(":1\r\n"));
    });
    redisServers.push(redis);
    await new Promise<void>((resolve) => redis.listen(0, "127.0.0.1", resolve));
    const address = redis.address() as AddressInfo;
    const client = createRedisClientFromUrl(`redis://127.0.0.1:${address.port}`);
    await expect(client.del!("key")).resolves.toBeUndefined();
    for (const socket of sockets) socket.destroy();
  });

  it("counts invalid authenticated bodies toward minute rate limiting but not daily quota", async () => {
    const upstream = vi.fn(async () => okUpstream());
    const handler = createGeminiProxyHandler({
      apiKey: "server-secret",
      authToken: "proxy-secret",
      rateLimit: 1,
      dailyQuota: 1,
      fetchImpl: upstream as unknown as typeof fetch,
    });
    const base = await start((req, res) => { void handler(req, res); });
    const headers = {
      "content-type": "application/json",
      authorization: "Bearer proxy-secret",
    };

    const malformed = await fetch(`${base}/api/services/ai/generate`, {
      method: "POST",
      body: "{not json",
      headers,
    });
    expect(malformed.status).toBe(400);

    const rateLimited = await postGenerate(base, "proxy-secret");
    expect(rateLimited.status).toBe(429);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("parses a fragmented RESP2 array returned by Redis SCAN", async () => {
    const crlf = String.fromCharCode(13, 10);
    const sockets = new Set<import("node:net").Socket>();
    const redis = createNetServer((socket) => {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
      socket.on("data", () => {
        socket.write(["*2", "$1", "0", "*1", "$3", "ke"].join(crlf));
        // The connection stays open until the full chunk arrives.
        setTimeout(() => socket.write(`y${crlf}`), 5);
      });
    });
    redisServers.push(redis);
    await new Promise<void>((resolve) => redis.listen(0, "127.0.0.1", resolve));
    const address = redis.address() as AddressInfo;
    const client = createRedisClientFromUrl(`redis://127.0.0.1:${address.port}`);

    await expect(client.scan!("0", "bf:ai-proxy:identity:*", 100)).resolves.toEqual({
      cursor: "0",
      keys: ["key"],
    });
    for (const socket of sockets) socket.destroy();
  });

  it("round-trips durable state through a Redis state store", async () => {
    const data = new Map<string, string>();
    const client = {
      get: vi.fn(async (key: string) => data.get(key) ?? null),
      set: vi.fn(async (key: string, value: string) => { data.set(key, value); }),
      scan: vi.fn(async (cursor: string, pattern: string) => {
        const prefix = pattern.slice(0, -1);
        const keys = [...data.keys()].filter((k) => k.startsWith(prefix));
        return { cursor: "0", keys };
      }),
    };
    const first = createRedisStateStore(client, { keyPrefix: "test:proxy" });
    await first.init();
    const state = { abc: { dayKey: "2026-08-21", dayCount: 4, breakerFailures: 2, breakerOpenedAt: 123 } };
    first.save(state);
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Per-identity keys: a counter write never clobbers unrelated identities.
    const abcKey = "test:proxy:identity:abc";
    // Identity keys are written with a bounded EX TTL so unused tokens do
    // not accumulate Redis keys forever; the TTL slides on every write.
    expect(client.set).toHaveBeenCalledWith(abcKey, JSON.stringify(state.abc), "EX", 259200);

    const second = createRedisStateStore(client, { keyPrefix: "test:proxy" });
    await second.init();
    expect(second.load()).toEqual(state);
  });

  it("fails open when Redis load or save fails", async () => {
    const error = new Error("redis unavailable");
    const client = {
      get: vi.fn(async () => { throw error; }),
      set: vi.fn(async () => { throw error; }),
    };
    const store = createRedisStateStore(client);
    await expect(store.init()).resolves.toBeUndefined();
    expect(store.load()).toEqual({});
    expect(() => store.save({ abc: { dayKey: "", dayCount: 1, breakerFailures: 0, breakerOpenedAt: null } })).not.toThrow();
  });

  it("persists the daily quota to a state file across restarts", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bf-ai-proxy-state-"));
    const stateFile = join(dir, "state.json");
    try {
      const upstream = vi.fn(async () => okUpstream());
      let current = Date.parse("2026-08-21T10:00:00Z");
      const makeHandler = () => createGeminiProxyHandler({
        apiKey: "server-secret",
        authToken: "proxy-secret",
        identityRateLimit: 100,
        dailyQuota: 2,
        now: () => current,
        // A brand-new store instance per process, backed by the same file.
        stateStore: createFileStateStore(stateFile),
        fetchImpl: upstream as unknown as typeof fetch,
      });

      // First process: consume the quota; the file now carries dayCount.
      const first = await start((req, res) => { void makeHandler()(req, res); });
      expect((await postGenerate(first, "proxy-secret")).status).toBe(200);
      expect((await postGenerate(first, "proxy-secret")).status).toBe(200);
      expect((await postGenerate(first, "proxy-secret")).status).toBe(429);
      await closeServer(servers[servers.length - 1]!);

      // Restart: a fresh handler over the same file still enforces the quota.
      const second = await start((req, res) => { void makeHandler()(req, res); });
      expect((await postGenerate(second, "proxy-secret")).status).toBe(429);

      // The file is a plain JSON the operator can inspect.
      const onDisk = JSON.parse(readFileSync(stateFile, "utf8")) as Record<string, unknown>;
      expect(Object.keys(onDisk).length).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails fast when AI_PROXY_STATE_FILE points to a non-writable directory", () => {
    const missingDirectory = join(tmpdir(), "bf-ai-proxy-no-such-directory", "state.json");
    expect(() => validateStateFilePath(missingDirectory)).toThrow(/not writable/);
  });

  it("fails fast at handler construction for an unwritable state-file directory", () => {
    const missingDirectory = join(tmpdir(), "bf-ai-proxy-no-such-directory", "state.json");
    vi.stubEnv("AI_PROXY_STATE_FILE", missingDirectory);
    try {
      expect(() => createGeminiProxyHandler({ apiKey: "server-secret", authToken: "proxy-secret" }))
        .toThrow(/AI_PROXY_STATE_FILE directory is not writable/);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("tolerates a missing or corrupt state file without throwing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bf-ai-proxy-state-"));
    try {
      expect(createFileStateStore(join(dir, "missing.json")).load()).toEqual({});

      const corrupt = join(dir, "corrupt.json");
      writeFileSync(corrupt, "{not json", "utf8");
      expect(createFileStateStore(corrupt).load()).toEqual({});

      // Malformed entries (non-numeric counters, negative values) are dropped
      // instead of corrupting the in-memory state.
      writeFileSync(
        corrupt,
        JSON.stringify({ bad: "shape", neg: { dayCount: -3 } }),
        "utf8",
      );
      expect(createFileStateStore(corrupt).load()).toEqual({});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("applies per-token daily quotas over the global default", async () => {
    const upstream = vi.fn(async () => okUpstream());
    const handler = createGeminiProxyHandler({
      apiKey: "server-secret",
      authTokens: ["token-a", "token-b", "token-c"],
      identityRateLimit: 100,
      dailyQuota: 100, // generous global fallback for unlisted tokens
      identityQuotas: { "token-a": 2 },
      fetchImpl: upstream as unknown as typeof fetch,
    });
    const base = await start((req, res) => { void handler(req, res); });

    // token-a has its own quota of 2; the third request is rejected.
    expect((await postGenerate(base, "token-a")).status).toBe(200);
    expect((await postGenerate(base, "token-a")).status).toBe(200);
    const exceeded = await postGenerate(base, "token-a");
    expect(exceeded.status).toBe(429);
    expect(await exceeded.json()).toMatchObject({ error: { code: "QUOTA_EXCEEDED" } });

    // Unlisted tokens fall back to the global quota and stay healthy.
    expect((await postGenerate(base, "token-b")).status).toBe(200);
    expect((await postGenerate(base, "token-c")).status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(4);
  });

  it("reads per-token quotas from AI_PROXY_TOKEN_QUOTAS", async () => {
    vi.stubEnv("AI_PROXY_TOKEN_QUOTAS", "env-token-a:1, env-token-b:5");
    try {
      const upstream = vi.fn(async () => okUpstream());
      const handler = createGeminiProxyHandler({
        apiKey: "server-secret",
        authTokens: ["env-token-a", "env-token-b"],
        identityRateLimit: 100,
        dailyQuota: 100,
        fetchImpl: upstream as unknown as typeof fetch,
      });
      const base = await start((req, res) => { void handler(req, res); });

      expect((await postGenerate(base, "env-token-a")).status).toBe(200);
      const exceeded = await postGenerate(base, "env-token-a");
      expect(exceeded.status).toBe(429);
      expect(await exceeded.json()).toMatchObject({ error: { code: "QUOTA_EXCEEDED" } });

      // env-token-b keeps its own, larger quota.
      expect((await postGenerate(base, "env-token-b")).status).toBe(200);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("applies a tightened per-token quota to persisted usage after a restart", async () => {
    const store = createMemoryStateStore();
    const upstream = vi.fn(async () => okUpstream());
    const makeHandler = (quotas: Record<string, number>) => createGeminiProxyHandler({
      apiKey: "server-secret",
      authToken: "proxy-secret",
      identityRateLimit: 100,
      dailyQuota: 100,
      identityQuotas: quotas,
      stateStore: store,
      fetchImpl: upstream as unknown as typeof fetch,
    });

    // Pre-restart: token quota 5, two successful requests persist dayCount=2.
    const first = await start((req, res) => { void makeHandler({ "proxy-secret": 5 })(req, res); });
    expect((await postGenerate(first, "proxy-secret")).status).toBe(200);
    expect((await postGenerate(first, "proxy-secret")).status).toBe(200);
    await closeServer(servers[servers.length - 1]!);

    // Restart with the quota tightened to 1: the persisted dayCount (2) is
    // already above the new limit, so the next request is rejected.
    const second = await start((req, res) => { void makeHandler({ "proxy-secret": 1 })(req, res); });
    expect((await postGenerate(second, "proxy-secret")).status).toBe(429);
  });

  it("applies per-token per-minute rate limits over the global default", async () => {
    const upstream = vi.fn(async () => okUpstream());
    const handler = createGeminiProxyHandler({
      apiKey: "server-secret",
      authTokens: ["token-x", "token-y"],
      identityRateLimit: 100, // generous global fallback for unlisted tokens
      identityRateLimits: { "token-x": 2 },
      dailyQuota: 10000,
      fetchImpl: upstream as unknown as typeof fetch,
    });
    const base = await start((req, res) => { void handler(req, res); });

    // token-x has per-token rate limit of 2; the third request within
    // the same minute is rejected.
    expect((await postGenerate(base, "token-x")).status).toBe(200);
    expect((await postGenerate(base, "token-x")).status).toBe(200);
    const rateLimited = await postGenerate(base, "token-x");
    expect(rateLimited.status).toBe(429);
    expect(await rateLimited.json()).toMatchObject({ error: { code: "RATE_LIMITED" } });

    // Unlisted token-y falls back to the global identityRateLimit (100).
    expect((await postGenerate(base, "token-y")).status).toBe(200);
    expect((await postGenerate(base, "token-y")).status).toBe(200);
    expect((await postGenerate(base, "token-y")).status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(5);
  });

  it("reads per-token rate limits from AI_PROXY_TOKEN_RATE_LIMITS", async () => {
    vi.stubEnv("AI_PROXY_TOKEN_RATE_LIMITS", "env-rl-a:1, env-rl-b:3");
    try {
      const upstream = vi.fn(async () => okUpstream());
      const handler = createGeminiProxyHandler({
        apiKey: "server-secret",
        authTokens: ["env-rl-a", "env-rl-b"],
        identityRateLimit: 100,
        dailyQuota: 10000,
        fetchImpl: upstream as unknown as typeof fetch,
      });
      const base = await start((req, res) => { void handler(req, res); });

      expect((await postGenerate(base, "env-rl-a")).status).toBe(200);
      const rateLimited = await postGenerate(base, "env-rl-a");
      expect(rateLimited.status).toBe(429);
      expect(await rateLimited.json()).toMatchObject({ error: { code: "RATE_LIMITED" } });

      // env-rl-b has its own limit of 3.
      expect((await postGenerate(base, "env-rl-b")).status).toBe(200);
      expect((await postGenerate(base, "env-rl-b")).status).toBe(200);
      expect((await postGenerate(base, "env-rl-b")).status).toBe(200);
      const rlB = await postGenerate(base, "env-rl-b");
      expect(rlB.status).toBe(429);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("GET /admin returns 503 when admin token is not configured", async () => {
    const handler = createGeminiProxyHandler({
      apiKey: "server-secret",
      authToken: "proxy-secret",
    });
    const base = await start((req, res) => { void handler(req, res); });
    const res = await fetch(`${base}/api/services/ai/admin`, {
      headers: { "x-admin-token": "any-token" },
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: { code: "ADMIN_DISABLED" } });
  });

  it("GET /metrics renders the breaker counters", async () => {
    const metrics = createMetricsCollector();
    const handler = createGeminiProxyHandler({
      apiKey: "server-secret",
      authToken: "proxy-secret",
      adminToken: "admin-secret",
      metrics,
    });
    const base = await start((req, res) => { void handler(req, res); });
    metrics.breakerOpens = 3;
    metrics.breakerProbes = 2;
    metrics.breakerProbeSuccesses = 1;
    metrics.breakerProbeReleases = 4;
    const res = await fetch(`${base}/api/services/ai/metrics`, {
      headers: { authorization: "Bearer admin-secret" },
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("bf_ai_proxy_breaker_opens_total 3");
    expect(body).toContain("bf_ai_proxy_breaker_probes_total 2");
    expect(body).toContain("bf_ai_proxy_breaker_probe_successes_total 1");
    expect(body).toContain("bf_ai_proxy_breaker_probe_releases_total 4");
  });

  it("GET /admin returns 401 with wrong admin token", async () => {
    const handler = createGeminiProxyHandler({
      apiKey: "server-secret",
      authToken: "proxy-secret",
      adminToken: "admin-secret",
    });
    const base = await start((req, res) => { void handler(req, res); });
    const res = await fetch(`${base}/api/services/ai/admin`, {
      headers: { "x-admin-token": "wrong-token" },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: { code: "UNAUTHORIZED" } });
  });

  it("GET /admin returns per-identity stats without exposing raw tokens", async () => {
    const upstream = vi.fn(async () => okUpstream());
    const handler = createGeminiProxyHandler({
      apiKey: "server-secret",
      authTokens: ["token-a", "token-b"],
      dailyQuota: 100,
      identityQuotas: { "token-a": 10 },
      identityRateLimits: { "token-a": 5 },
      adminToken: "admin-secret",
      fetchImpl: upstream as unknown as typeof fetch,
    });
    const base = await start((req, res) => { void handler(req, res); });

    // Make 2 requests with token-a and 1 with token-b.
    expect((await postGenerate(base, "token-a")).status).toBe(200);
    expect((await postGenerate(base, "token-a")).status).toBe(200);
    expect((await postGenerate(base, "token-b")).status).toBe(200);

    // GET /admin with the correct admin token.
    const res = await fetch(`${base}/api/services/ai/admin`, {
      headers: { "x-admin-token": "admin-secret" },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { identities: Array<{
      identity: string;
      configuredDailyQuota: number;
      configuredRateLimit: number;
      dayCount: number;
      breakerState: string;
    }> };

    // Two identities present.
    expect(body.identities).toHaveLength(2);

    // No raw tokens anywhere in the response body.
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("token-a");
    expect(raw).not.toContain("token-b");
    expect(raw).not.toContain("proxy-secret");
    expect(raw).not.toContain("admin-secret");

    // token-a: quota 10, rate limit 5, dayCount 2.
    const statsA = body.identities.find((i) => i.configuredDailyQuota === 10);
    expect(statsA).toBeDefined();
    expect(statsA!.dayCount).toBe(2);
    expect(statsA!.configuredRateLimit).toBe(5);
    expect(statsA!.breakerState).toBe("healthy");

    // token-b: uses global defaults (quota 100, rate limit 60), dayCount 1.
    const statsB = body.identities.find((i) => i.configuredDailyQuota === 100);
    expect(statsB).toBeDefined();
    expect(statsB!.dayCount).toBe(1);
    expect(statsB!.configuredRateLimit).toBe(60);
  });

  it("GET /admin reflects breaker state per identity", async () => {
    // Fake upstream that always fails.
    const upstream = vi.fn(async () => new Response(null, { status: 500 }));
    const handler = createGeminiProxyHandler({
      apiKey: "server-secret",
      authToken: "proxy-secret",
      adminToken: "admin-secret",
      circuitBreaker: { threshold: 2, cooldownMs: 60_000 },
      fetchImpl: upstream as unknown as typeof fetch,
    });
    const base = await start((req, res) => { void handler(req, res); });

    // Two failures → breaker opens.
    expect((await postGenerate(base, "proxy-secret")).status).toBe(502);
    expect((await postGenerate(base, "proxy-secret")).status).toBe(502);

    // Third request is rejected by breaker.
    expect((await postGenerate(base, "proxy-secret")).status).toBe(503);

    const res = await fetch(`${base}/api/services/ai/admin`, {
      headers: { "x-admin-token": "admin-secret" },
    });
    const body = await res.json() as { identities: Array<{
      breakerState: string;
      breakerFailures: number;
    }> };
    expect(body.identities).toHaveLength(1);
    expect(body.identities[0]!.breakerState).toBe("open");
    // Only 2 failures recorded — the third request was rejected by the
    // breaker before reaching the upstream, so recordFailure was not called.
    expect(body.identities[0]!.breakerFailures).toBe(2);
  });

  it("GET /admin is not gated by the per-identity rate limiter", async () => {
    const handler = createGeminiProxyHandler({
      apiKey: "server-secret",
      authToken: "proxy-secret",
      adminToken: "admin-secret",
      identityRateLimit: 1, // very tight
      dailyQuota: 1,
      fetchImpl: vi.fn(async () => okUpstream()) as unknown as typeof fetch,
    });
    const base = await start((req, res) => { void handler(req, res); });

    // Exhaust the identity budget.
    expect((await postGenerate(base, "proxy-secret")).status).toBe(200);
    expect((await postGenerate(base, "proxy-secret")).status).toBe(429);

    // /admin still works — it is not subject to the identity rate limiter.
    const res = await fetch(`${base}/api/services/ai/admin`, {
      headers: { "x-admin-token": "admin-secret" },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { identities: Array<{ dayCount: number }> };
    expect(body.identities[0]!.dayCount).toBe(1);
  });

  it("warns at startup when AI_PROXY_TOKEN_QUOTAS references a token not in auth tokens", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      createGeminiProxyHandler({
        apiKey: "server-secret",
        authToken: "proxy-secret",
        identityQuotas: { "orphan-token": 100 },
      });
      const warnings = warnSpy.mock.calls.map((c) => String(c[0]));
      // Warning truncates the token (orphan-to…ken), not full name.
      expect(warnings.some((w) => w.includes("orphan-t") && w.includes("AI_PROXY_TOKEN_QUOTAS"))).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("warns at startup when AI_PROXY_TOKEN_RATE_LIMITS references a token not in auth tokens", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      createGeminiProxyHandler({
        apiKey: "server-secret",
        authToken: "proxy-secret",
        identityRateLimits: { "ghost-token": 5 },
      });
const warnings = warnSpy.mock.calls.map((c) => String(c[0]));
      // Warning truncates the token (ghost-to…ken), not full name.
      expect(warnings.some((w) => w.includes("ghost-to") && w.includes("AI_PROXY_TOKEN_RATE_LIMITS"))).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("does not warn when all quota/rate-limit tokens are also in auth tokens", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      createGeminiProxyHandler({
        apiKey: "server-secret",
        authTokens: ["token-a", "token-b"],
        identityQuotas: { "token-a": 50 },
        identityRateLimits: { "token-b": 10 },
      });
      const warnings = warnSpy.mock.calls.map((c) => String(c[0]));
      expect(warnings.some((w) => w.includes("AI_PROXY_TOKEN_QUOTAS") || w.includes("AI_PROXY_TOKEN_RATE_LIMITS"))).toBe(false);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("warns for env-parsed orphan tokens in AI_PROXY_TOKEN_QUOTAS", async () => {
    vi.stubEnv("AI_PROXY_TOKEN_QUOTAS", "env-orphan:99");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      createGeminiProxyHandler({
        apiKey: "server-secret",
        authToken: "proxy-secret",
      });
      const warnings = warnSpy.mock.calls.map((c) => String(c[0]));
      // Warning truncates the token (env-orp…n), not full name.
      expect(warnings.some((w) => w.includes("env-orp") && w.includes("AI_PROXY_TOKEN_QUOTAS"))).toBe(true);
    } finally {
      warnSpy.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it("accepts the admin token via Authorization: Bearer (documented contract)", async () => {
    const handler = createGeminiProxyHandler({
      apiKey: "server-secret",
      authToken: "proxy-secret",
      adminToken: "admin-secret",
    });
    const base = await start((req, res) => { void handler(req, res); });

    const res = await fetch(`${base}/api/services/ai/admin`, {
      headers: { authorization: "Bearer admin-secret" },
    });
    expect(res.status).toBe(200);

    const wrong = await fetch(`${base}/api/services/ai/admin`, {
      headers: { authorization: "Bearer wrong-secret" },
    });
    expect(wrong.status).toBe(401);
  });

  it("awaits stateStore.init() and refreshes identity state before admission", async () => {
    const init = vi.fn().mockResolvedValue(undefined);
    const refresh = vi.fn().mockResolvedValue(undefined);
    const store = {
      load: () => ({}),
      save: vi.fn(),
      loadIdentity: () => undefined,
      saveIdentity: vi.fn(),
      init,
      refresh,
    };
    const upstream = vi.fn(async () =>
      new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const handler = createGeminiProxyHandler({
      apiKey: "server-secret",
      authToken: "proxy-secret",
      fetchImpl: upstream as unknown as typeof fetch,
      stateStore: store as never,
    });
    const base = await start((req, res) => { void handler(req, res); });

    const response = await fetch(`${base}/api/services/ai/generate`, {
      method: "POST",
      body: JSON.stringify({ prompt: "hi" }),
      headers: { "content-type": "application/json", authorization: "Bearer proxy-secret" },
    });
    expect(response.status).toBe(200);
    expect(init).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    // The policy persists the touched identity through saveIdentity too.
    expect(store.saveIdentity).toHaveBeenCalled();
  });

  it("merges persisted identity counters from loadIdentity before the quota check", async () => {
    let persisted = {
      dayKey: new Date().toISOString().slice(0, 10),
      dayCount: 3,
      breakerFailures: 0,
      breakerOpenedAt: null,
    };
    const upstream = vi.fn(async () =>
      new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const store = {
      load: () => ({}),
      save: vi.fn(),
      loadIdentity: () => persisted,
      saveIdentity: vi.fn((_id: string, entry: { dayCount: number }) => {
        persisted = { ...persisted, ...entry };
      }),
    };
    const handler = createGeminiProxyHandler({
      apiKey: "server-secret",
      authToken: "proxy-secret",
      dailyQuota: 3,
      fetchImpl: upstream as unknown as typeof fetch,
      stateStore: store as never,
    });
    const base = await start((req, res) => { void handler(req, res); });
    const headers = {
      "content-type": "application/json",
      authorization: "Bearer proxy-secret",
    };

    // DayCount 3 of quota 3 → the merge must reject immediately.
    const rejected = await fetch(`${base}/api/services/ai/generate`, {
      method: "POST",
      body: JSON.stringify({ prompt: "hi" }),
      headers,
    });
    expect(rejected.status).toBe(429);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("refuses to start in production with a documented default token", () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(() =>
        createGeminiProxyHandler({ apiKey: "server-secret", authToken: "local-prod-token" }),
      ).toThrow(/refusing to start in production/);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("refuses to start in production with an http upstream base", () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(() =>
        createGeminiProxyHandler({
          apiKey: "server-secret",
          authToken: "abcdefghijklmnopqrstuvwxyz012345",
          apiBase: "http://insecure.example/v1beta/models",
        }),
      ).toThrow(/https/);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("starts in production with a strong token and https base", () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(() =>
        createGeminiProxyHandler({
          apiKey: "server-secret",
          authToken: "abcdefghijklmnopqrstuvwxyz012345",
          apiBase: "https://generativelanguage.googleapis.com/v1beta/models",
        }),
      ).not.toThrow();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("createRedisStateStore — per-identity keys", () => {
  it("loads a merged snapshot from per-identity keys after init()", async () => {
    const data = new Map<string, string>();
    const client = {
      get: async (k: string) => data.get(k) ?? null,
      set: async (k: string, v: string) => { data.set(k, v); },
      scan: async (_cursor: string, pattern: string) => {
        const prefix = pattern.slice(0, -1);
        return { cursor: "0", keys: [...data.keys()].filter((k) => k.startsWith(prefix)) };
      },
    };
    const store = createRedisStateStore(client as never);
    const identityA = "a".repeat(64);
    const redisKey = (identity: string) => `bf:ai-proxy:identity:${identity}`;
    data.set(
      redisKey(identityA),
      JSON.stringify({ dayKey: "2026-08-22", dayCount: 3, breakerFailures: 0, breakerOpenedAt: null }),
    );

    await store.init();
    expect(store.load()[identityA]?.dayCount).toBe(3);

    const identityB = "b".repeat(64);
    store.saveIdentity(identityB, {
      dayKey: "2026-08-22",
      dayCount: 7,
      breakerFailures: 1,
      breakerOpenedAt: null,
    });
    expect(store.loadIdentity(identityB)?.dayCount).toBe(7);
    expect(data.has(redisKey(identityB))).toBe(true);
  });

  it("save() writes per-identity keys without clobbering other identities", async () => {
    const data = new Map<string, string>();
    const client = {
      get: async (k: string) => data.get(k) ?? null,
      set: async (k: string, v: string) => { data.set(k, v); },
      scan: async (_cursor: string, pattern: string) => {
        const prefix = pattern.slice(0, -1);
        return { cursor: "0", keys: [...data.keys()].filter((k) => k.startsWith(prefix)) };
      },
    };
    const store = createRedisStateStore(client as never);
    const identityA = "a".repeat(64);
    const identityB = "b".repeat(64);

    store.save({
      [identityA]: { dayKey: "2026-08-22", dayCount: 1, breakerFailures: 0, breakerOpenedAt: null },
    });
    store.save({
      [identityB]: { dayKey: "2026-08-22", dayCount: 9, breakerFailures: 0, breakerOpenedAt: null },
    });

    const redisKey = (identity: string) => `bf:ai-proxy:identity:${identity}`;
    expect(data.has(redisKey(identityA))).toBe(true);
    expect(data.has(redisKey(identityB))).toBe(true);
    expect(store.loadIdentity(identityA)?.dayCount).toBe(1);
    expect(store.loadIdentity(identityB)?.dayCount).toBe(9);
  });

  it("refresh() reads through to Redis for a single identity", async () => {
    const data = new Map<string, string>();
    const client = {
      get: async (k: string) => data.get(k) ?? null,
      set: async (k: string, v: string) => { data.set(k, v); },
      scan: async (_cursor: string, pattern: string) => {
        const prefix = pattern.slice(0, -1);
        return { cursor: "0", keys: [...data.keys()].filter((k) => k.startsWith(prefix)) };
      },
    };
    const store = createRedisStateStore(client as never);
    await store.init();
    const identity = "c".repeat(64);
    expect(store.loadIdentity(identity)).toBeNull();

    data.set(
      `bf:ai-proxy:identity:${identity}`,
      JSON.stringify({ dayKey: "2026-08-22", dayCount: 11, breakerFailures: 0, breakerOpenedAt: null }),
    );
    await store.refresh(identity);
    expect(store.loadIdentity(identity)?.dayCount).toBe(11);
  });

  it("uses Redis EVAL for an atomic quota reservation", async () => {
    const evalCalls: Array<{ script: string; keys: string[]; args: string[] }> = [];
    const client = {
      get: async () => null,
      set: async () => undefined,
      eval: async (script: string, keys: string[], args: string[]) => {
        evalCalls.push({ script, keys, args });
        return 1;
      },
    };
    const store = createRedisStateStore(client as never);
    const identity = "d".repeat(64);
    await expect(store.reserveQuota(identity, "2026-08-23", 7)).resolves.toBe(true);
    expect(evalCalls).toHaveLength(1);
    expect(evalCalls[0]?.keys).toEqual([`bf:ai-proxy:quota:${identity}:2026-08-23`]);
    expect(evalCalls[0]?.args).toEqual(["7"]);
    expect(evalCalls[0]?.script).toContain("INCR");
    expect(evalCalls[0]?.script).toContain("DECR");
  });
});
