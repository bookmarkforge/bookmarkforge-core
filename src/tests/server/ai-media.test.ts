import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGeminiMediaHandler } from "../../../server/src/ai-media";
import { createGeminiProxyHandler } from "../../../server/src/ai-proxy";

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
  vi.unstubAllEnvs();
});

const DEFAULT_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

describe("Gemini media proxy (TTS + image)", () => {
  it("rejects unauthenticated requests before calling the upstream", async () => {
    const upstream = vi.fn();
    const handler = createGeminiMediaHandler({
      apiKey: "server-secret",
      authToken: "proxy-secret",
      fetchImpl: upstream as unknown as typeof fetch,
    });
    const base = await start((req, res) => { void handler(req, res); });

    for (const path of ["/api/services/ai/generate-tts", "/api/services/ai/generate-image"]) {
      const response = await fetch(`${base}${path}`, {
        method: "POST",
        body: JSON.stringify(path.endsWith("tts") ? { text: "hola" } : { prompt: "logo" }),
        headers: { "content-type": "application/json" },
      });
      expect(response.status).toBe(401);
    }
    expect(upstream).not.toHaveBeenCalled();
  });

  it("fails closed when the server-side key is missing", async () => {
    const handler = createGeminiMediaHandler({ apiKey: "" });
    const base = await start((req, res) => { void handler(req, res); });
    const response = await fetch(`${base}/api/services/ai/generate-tts`, {
      method: "POST",
      body: JSON.stringify({ text: "hola" }),
      headers: { "content-type": "application/json", authorization: "Bearer proxy-secret" },
    });
    expect(response.status).toBe(503);
  });

  it("maps Gemini audio inlineData to { audioBase64 }", async () => {
    const upstream = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(
        `${DEFAULT_API_BASE}/gemini-2.5-flash-preview-tts:generateContent`,
      );
      expect(init?.headers).toEqual({
        "Content-Type": "application/json",
        "x-goog-api-key": "server-secret",
      });
      const body = JSON.parse(String(init?.body)) as {
        contents: Array<{ parts: Array<{ text: string }> }>;
        generationConfig: Record<string, unknown>;
      };
      expect(body.contents[0]?.parts[0]?.text).toBe("hola");
      expect(body.generationConfig.responseModalities).toEqual(["AUDIO"]);
      expect(body.generationConfig.languageHint).toBe("es");
      return new Response(
        JSON.stringify({
          candidates: [{
            content: { parts: [{ inlineData: { mimeType: "audio/mpeg", data: "bW9jaw==" } }] },
          }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const handler = createGeminiMediaHandler({
      apiKey: "server-secret",
      authToken: "proxy-secret",
      fetchImpl: upstream as unknown as typeof fetch,
    });
    const base = await start((req, res) => { void handler(req, res); });

    const response = await fetch(`${base}/api/services/ai/generate-tts`, {
      method: "POST",
      body: JSON.stringify({ text: "hola", lang: "es" }),
      headers: { "content-type": "application/json", authorization: "Bearer proxy-secret" },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ audioBase64: "bW9jaw==" });
  });

  it("rejects empty or oversized TTS text", async () => {
    const upstream = vi.fn();
    const handler = createGeminiMediaHandler({
      apiKey: "server-secret",
      authToken: "proxy-secret",
      fetchImpl: upstream as unknown as typeof fetch,
    });
    const base = await start((req, res) => { void handler(req, res); });
    const headers = { "content-type": "application/json", authorization: "Bearer proxy-secret" };

    const empty = await fetch(`${base}/api/services/ai/generate-tts`, {
      method: "POST",
      body: JSON.stringify({ text: "" }),
      headers,
    });
    expect(empty.status).toBe(400);

    const huge = await fetch(`${base}/api/services/ai/generate-tts`, {
      method: "POST",
      body: JSON.stringify({ text: "x".repeat(10_001) }),
      headers,
    });
    expect(huge.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("maps Imagen predictions to { imageBase64 }", async () => {
    const upstream = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(`${DEFAULT_API_BASE}/imagen-3.0-generate-002:predict`);
      expect(init?.headers).toEqual({
        "Content-Type": "application/json",
        "x-goog-api-key": "server-secret",
      });
      const body = JSON.parse(String(init?.body)) as {
        instances: Array<{ prompt: string }>;
        parameters: Record<string, unknown>;
      };
      expect(body.instances[0]?.prompt).toBe("un logo");
      expect(body.parameters.sampleCount).toBe(1);
      return new Response(
        JSON.stringify({ predictions: [{ bytesBase64: "aW1hZ2UtbW9jaw==" }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const handler = createGeminiMediaHandler({
      apiKey: "server-secret",
      authToken: "proxy-secret",
      fetchImpl: upstream as unknown as typeof fetch,
    });
    const base = await start((req, res) => { void handler(req, res); });

    const response = await fetch(`${base}/api/services/ai/generate-image`, {
      method: "POST",
      body: JSON.stringify({ prompt: "un logo" }),
      headers: { "content-type": "application/json", authorization: "Bearer proxy-secret" },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ imageBase64: "aW1hZ2UtbW9jaw==" });
  });

  it("rejects oversized image prompts", async () => {
    const upstream = vi.fn();
    const handler = createGeminiMediaHandler({
      apiKey: "server-secret",
      authToken: "proxy-secret",
      fetchImpl: upstream as unknown as typeof fetch,
    });
    const base = await start((req, res) => { void handler(req, res); });
    const response = await fetch(`${base}/api/services/ai/generate-image`, {
      method: "POST",
      body: JSON.stringify({ prompt: "x".repeat(20_001) }),
      headers: { "content-type": "application/json", authorization: "Bearer proxy-secret" },
    });
    expect(response.status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("releases a half-open probe rejected locally so the breaker is not stuck", async () => {
    // The media handler shares the proxy's admission policy; open the
    // circuit through two upstream failures, then let the first request
    // after the cooldown become the probe. An invalid body must release
    // the probe latch — otherwise the breaker stays half-open forever.
    let failUpstream = true;
    const upstream = vi.fn(async () => failUpstream
      ? new Response("boom", { status: 500 })
      : new Response(JSON.stringify({
          candidates: [{ content: { parts: [{ inlineData: { data: "bW9jaw==" } }] } }],
        }), { status: 200 }));
    let current = Date.parse("2026-08-21T10:00:00Z");
    const policy = createGeminiProxyHandler({
      apiKey: "server-secret",
      authToken: "proxy-secret",
      identityRateLimit: 1000,
      dailyQuota: 1000,
      circuitBreaker: { threshold: 2, cooldownMs: 60_000 },
      now: () => current,
      fetchImpl: upstream as unknown as typeof fetch,
    }).accessPolicy;
    const handler = createGeminiMediaHandler({
      apiKey: "server-secret",
      authToken: "proxy-secret",
      accessPolicy: policy,
      fetchImpl: upstream as unknown as typeof fetch,
    });
    const base = await start((req, res) => { void handler(req, res); });
    const headers = { "content-type": "application/json", authorization: "Bearer proxy-secret" };
    const postTts = (body: string) => fetch(`${base}/api/services/ai/generate-tts`, {
      method: "POST", body, headers,
    });

    // Two consecutive upstream failures open the circuit.
    expect((await postTts(JSON.stringify({ text: "hola" }))).status).toBe(502);
    expect((await postTts(JSON.stringify({ text: "hola" }))).status).toBe(502);
    expect((await postTts(JSON.stringify({ text: "hola" }))).status).toBe(503);
    expect(upstream).toHaveBeenCalledTimes(2);

    // The first request after the cooldown is the probe, but its body is
    // invalid (empty TTS text): the handler rejects it locally (400) and
    // must release the latch.
    current += 60_000;
    const malformedProbe = await postTts(JSON.stringify({ text: "" }));
    expect(malformedProbe.status).toBe(400);
    expect(upstream).toHaveBeenCalledTimes(2);

    // The latch was released: the next valid request is admitted (it becomes
    // the de-facto probe), succeeds, and closes the circuit.
    failUpstream = false;
    const recovered = await postTts(JSON.stringify({ text: "hola" }));
    expect(recovered.status).toBe(200);
    expect(await recovered.json()).toEqual({ audioBase64: "bW9jaw==" });
  });

  it("maps upstream 429 to 429 and other failures to 502", async () => {
    const upstream429 = vi.fn(async () => new Response("nope", { status: 429 }));
    const handler429 = createGeminiMediaHandler({
      apiKey: "server-secret",
      authToken: "proxy-secret",
      fetchImpl: upstream429 as unknown as typeof fetch,
    });
    const base429 = await start((req, res) => { void handler429(req, res); });
    const rateLimited = await fetch(`${base429}/api/services/ai/generate-tts`, {
      method: "POST",
      body: JSON.stringify({ text: "hola" }),
      headers: { "content-type": "application/json", authorization: "Bearer proxy-secret" },
    });
    expect(rateLimited.status).toBe(429);

    const upstream500 = vi.fn(async () => new Response("boom", { status: 500 }));
    const handler500 = createGeminiMediaHandler({
      apiKey: "server-secret",
      authToken: "proxy-secret",
      fetchImpl: upstream500 as unknown as typeof fetch,
    });
    const base500 = await start((req, res) => { void handler500(req, res); });
    const failed = await fetch(`${base500}/api/services/ai/generate-image`, {
      method: "POST",
      body: JSON.stringify({ prompt: "logo" }),
      headers: { "content-type": "application/json", authorization: "Bearer proxy-secret" },
    });
    expect(failed.status).toBe(502);
  });

  it("returns 502 when the upstream omits audio/image payloads", async () => {
    const upstream = vi.fn(async () =>
      new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "nope" }] } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const handler = createGeminiMediaHandler({
      apiKey: "server-secret",
      authToken: "proxy-secret",
      fetchImpl: upstream as unknown as typeof fetch,
    });
    const base = await start((req, res) => { void handler(req, res); });
    const response = await fetch(`${base}/api/services/ai/generate-tts`, {
      method: "POST",
      body: JSON.stringify({ text: "hola" }),
      headers: { "content-type": "application/json", authorization: "Bearer proxy-secret" },
    });
    expect(response.status).toBe(502);
  });

  it("rejects GET and unknown media paths", async () => {
    const upstream = vi.fn();
    const handler = createGeminiMediaHandler({
      apiKey: "server-secret",
      authToken: "proxy-secret",
      fetchImpl: upstream as unknown as typeof fetch,
    });
    const base = await start((req, res) => { void handler(req, res); });

    const get = await fetch(`${base}/api/services/ai/generate-tts`);
    expect(get.status).toBe(405);

    const unknown = await fetch(`${base}/api/services/ai/generate-other`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer proxy-secret" },
    });
    expect(unknown.status).toBe(404);
  });

  it("refuses to start in production with a documented default token", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() =>
      createGeminiMediaHandler({ apiKey: "server-secret", authToken: "local-prod-token" }),
    ).toThrow(/refusing to start in production/);
  });

  it("refuses to start in production with an http upstream base", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() =>
      createGeminiMediaHandler({
        apiKey: "server-secret",
        authToken: "abcdefghijklmnopqrstuvwxyz012345",
        apiBase: "http://insecure.example/v1beta/models",
      }),
    ).toThrow(/https/);
  });
});
