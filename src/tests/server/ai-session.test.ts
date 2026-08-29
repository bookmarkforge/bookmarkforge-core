import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAiSessionManager } from "../../../server/src/ai-session";
import type { RedisValueStore } from "../../../server/src/ai-proxy";

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

function cookieHeader(setCookie: string): string {
  return setCookie
    .split(/,(?=[^;=]+=)/)
    .map((part) => part.split(";")[0]?.trim())
    .filter((part): part is string => Boolean(part))
    .join("; ");
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map(closeServer));
  vi.unstubAllEnvs();
});

describe("AI session manager", () => {
  it("authenticates a session created by another instance using the shared store", async () => {
    const data = new Map<string, string>();
    const store: RedisValueStore = {
      get: async (key) => data.get(key) ?? null,
      set: async (key, value) => { data.set(key, value); },
      delete: async (key) => { data.delete(key); },
    };
    const first = createAiSessionManager({ requireLicense: false, sessionStore: store });
    const second = createAiSessionManager({ requireLicense: false, sessionStore: store });
    const firstBase = await start((req, res) => { void first.createSessionHandler()(req, res); });

    const session = await fetch(`${firstBase}/api/services/ai/session`, {
      method: "POST",
      body: "{}",
    });
    expect(session.status).toBe(200);
    const csrf = (await session.json() as { csrfToken: string }).csrfToken;
    const cookie = cookieHeader(session.headers.get("set-cookie") ?? "");

    const secondBase = await start(async (req, res) => {
      const authenticated = await second.authenticate(req);
      res.writeHead(authenticated ? 200 : 401, { "content-type": "application/json" });
      res.end(JSON.stringify(authenticated ?? { error: "unauthorized" }));
    });
    const response = await fetch(`${secondBase}/api/services/ai/check`, {
      headers: { cookie, "x-csrf-token": csrf },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ identity: "anonymous" });
  });

  it("rejects an expired distributed session even when cleanup fails", async () => {
    let current = 1_000_000;
    const data = new Map<string, string>();
    const store: RedisValueStore = {
      get: async (key) => data.get(key) ?? null,
      set: async (key, value) => { data.set(key, value); },
      delete: async () => { throw new Error("redis unavailable"); },
    };
    const manager = createAiSessionManager({
      requireLicense: false,
      sessionStore: store,
      ttlMs: 60_000,
      now: () => current,
    });
    const base = await start((req, res) => { void manager.createSessionHandler()(req, res); });
    const session = await fetch(`${base}/api/services/ai/session`, { method: "POST", body: "{}" });
    const csrf = (await session.json() as { csrfToken: string }).csrfToken;
    const cookie = cookieHeader(session.headers.get("set-cookie") ?? "");

    current += 61_000;
    const authenticated = await new Promise<boolean>((resolve) => {
      const server = createServer(async (req, res) => {
        resolve((await manager.authenticate(req)) !== null);
        res.end();
      });
      servers.push(server);
      server.listen(0, "127.0.0.1", async () => {
        const address = server.address() as AddressInfo;
        await fetch(`http://127.0.0.1:${address.port}`, {
          headers: { cookie, "x-csrf-token": csrf },
        });
      });
    });
    expect(authenticated).toBe(false);
    expect(data.size).toBe(1); // Redis TTL remains responsible for eventual cleanup
  });

  it("does not bind session authentication to the creating IP", async () => {
    const data = new Map<string, string>();
    const store: RedisValueStore = {
      get: async (key) => data.get(key) ?? null,
      set: async (key, value) => { data.set(key, value); },
      delete: async (key) => { data.delete(key); },
    };
    const manager = createAiSessionManager({ requireLicense: false, sessionStore: store });
    const base = await start((req, res) => { void manager.createSessionHandler()(req, res); });
    const session = await fetch(`${base}/api/services/ai/session`, {
      method: "POST",
      body: "{}",
    });
    expect(session.status).toBe(200);
    const csrf = (await session.json() as { csrfToken: string }).csrfToken;
    const cookie = cookieHeader(session.headers.get("set-cookie") ?? "");

    const authenticateRequest = {
      headers: { cookie, "x-csrf-token": csrf },
      socket: { remoteAddress: "203.0.113.20" },
    } as unknown as IncomingMessage;
    await expect(manager.authenticate(authenticateRequest)).resolves.toMatchObject({
      identity: "anonymous",
      csrfToken: csrf,
    });
  });

  it("fails session creation closed when the distributed store cannot persist", async () => {
    const store: RedisValueStore = {
      get: async () => null,
      set: async () => { throw new Error("redis unavailable"); },
      delete: async () => undefined,
    };
    const manager = createAiSessionManager({ requireLicense: false, sessionStore: store });
    const base = await start((req, res) => { void manager.createSessionHandler()(req, res); });
    const response = await fetch(`${base}/api/services/ai/session`, { method: "POST", body: "{}" });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: { code: "SESSION_STORE_UNAVAILABLE", message: "AI sessions temporarily unavailable" },
    });
  });
});
