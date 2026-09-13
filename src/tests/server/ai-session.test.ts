import {
  constants,
  createPrivateKey,
  createSign,
  generateKeyPairSync,
} from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAiSessionManager } from "../../../server/src/ai-session";
import type { RedisValueStore } from "../../../server/src/ai-proxy";
import { canonicalLicenseJson } from "../../../server/src/entitlement";

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

describe("AI session entitlement enforcement", () => {
  function memoryStore(): RedisValueStore {
    const data = new Map<string, string>();
    return {
      get: async (key) => data.get(key) ?? null,
      set: async (key, value) => { data.set(key, value); },
      delete: async (key) => { data.delete(key); },
    };
  }

  function licensedKeyPair() {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "der" },
      privateKeyEncoding: { type: "pkcs8", format: "der" },
    });
    return { publicKeySpki: publicKey.toString("base64"), privateKey };
  }

  function signedProof(
    payload: Record<string, unknown>,
    privateKey: Buffer,
  ): { payload: Record<string, unknown>; signature: string } {
    const signer = createSign("sha256");
    signer.update(canonicalLicenseJson(payload));
    const signature = signer
      .sign({
        key: createPrivateKey({ key: privateKey, format: "der", type: "pkcs8" }),
        padding: constants.RSA_PKCS1_PSS_PADDING,
        saltLength: 32,
      })
      .toString("base64");
    return { payload, signature };
  }

  async function postSession(base: string, body: unknown) {
    return fetch(`${base}/api/services/ai/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("requires a verified license proof by default, in every environment", async () => {
    // The old default only required a license when NODE_ENV was exactly
    // "production", so staging/preview/misconfigured deployments served cloud
    // AI anonymously. Fail closed is the default now.
    const manager = createAiSessionManager({ sessionStore: memoryStore() });
    expect(manager.licenseEnforced).toBe(true);
    const base = await start((req, res) => { void manager.createSessionHandler()(req, res); });

    const response = await postSession(base, {});
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: "LICENSE_REQUIRED", reason: "MISSING_PROOF" },
    });
  });

  it("issues anonymous sessions only under an explicit non-production opt-out", async () => {
    vi.stubEnv("AI_SESSION_REQUIRE_LICENSE", "0");
    const manager = createAiSessionManager({ sessionStore: memoryStore() });
    expect(manager.licenseEnforced).toBe(false);
    expect(manager.anonymousSessionsReason).toBe("AI_SESSION_REQUIRE_LICENSE=0");

    const base = await start((req, res) => { void manager.createSessionHandler()(req, res); });
    const response = await postSession(base, {});
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ csrfToken: expect.any(String) });
  });

  it("refuses the anonymous opt-out in production", () => {
    vi.stubEnv("AI_SESSION_REQUIRE_LICENSE", "0");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => createAiSessionManager({})).toThrow(/refused in production/);
  });

  it("fails closed on an unrecognized policy value", async () => {
    vi.stubEnv("AI_SESSION_REQUIRE_LICENSE", "maybe");
    const manager = createAiSessionManager({ sessionStore: memoryStore() });
    expect(manager.licenseEnforced).toBe(true);
  });

  it("accepts a server-signed proof and stops the session when the license expires", async () => {
    const { publicKeySpki, privateKey } = licensedKeyPair();
    let current = 1_750_000_000_000;
    const expiry = current + 60_000;
    const proof = signedProof(
      { v: 1, deviceId: "device-entitled", validatedAt: current, expiresAt: expiry },
      privateKey,
    );
    const manager = createAiSessionManager({
      licensePublicKeySpki: publicKeySpki,
      now: () => current,
      sessionStore: memoryStore(),
    });
    const base = await start((req, res) => { void manager.createSessionHandler()(req, res); });

    const session = await postSession(base, proof);
    expect(session.status).toBe(200);
    const csrf = (await session.json() as { csrfToken: string }).csrfToken;
    const cookie = cookieHeader(session.headers.get("set-cookie") ?? "");
    const request = {
      headers: { cookie, "x-csrf-token": csrf },
    } as unknown as IncomingMessage;

    // Identity is the proof digest, so one install shares one quota bucket.
    await expect(manager.authenticate(request)).resolves.toMatchObject({
      identity: expect.stringMatching(/^[0-9a-f]{64}$/),
    });

    // The license expires mid-session: the 30-minute cookie TTL must not
    // outlive the entitlement that justified the session.
    current = expiry + 1;
    await expect(manager.authenticate(request)).resolves.toBeNull();
  });

  it("mints a session through the router guard without re-reading the proof", async () => {
    const { publicKeySpki, privateKey } = licensedKeyPair();
    const current = 1_750_000_000_000;
    const manager = createAiSessionManager({
      licensePublicKeySpki: publicKeySpki,
      now: () => current,
      sessionStore: memoryStore(),
    });
    const proof = signedProof(
      { v: 1, deviceId: "device-router", validatedAt: current },
      privateKey,
    );
    // The exact composition server/src/index.ts mounts: the shared guard
    // resolves the proof from the body and attaches it, then the handler runs
    // on that context. A body that was read twice would fail here.
    const base = await start((req, res) => {
      void manager
        .entitlementGuard.middleware("proof", { proofLabel: "session proof" })(
          req,
          res,
          () => manager.createSessionHandler()(req, res),
        );
    });

    const session = await postSession(base, proof);
    expect(session.status).toBe(200);
    const csrf = (await session.json() as { csrfToken: string }).csrfToken;
    const cookie = cookieHeader(session.headers.get("set-cookie") ?? "");

    // The session still carries the proof's identity, so the guard and the
    // handler resolved the same entitlement.
    await expect(
      manager.authenticate({ headers: { cookie, "x-csrf-token": csrf } } as unknown as IncomingMessage),
    ).resolves.toMatchObject({ identity: expect.stringMatching(/^[0-9a-f]{64}$/) });
  });

  it("exposes the deployment's entitlement guard as the router's enforcement point", () => {
    const enforcing = createAiSessionManager({ sessionStore: memoryStore() });
    expect(enforcing.licenseEnforced).toBe(true);
    expect(enforcing.entitlementGuard.enforced).toBe(true);

    vi.stubEnv("AI_SESSION_REQUIRE_LICENSE", "0");
    const anonymous = createAiSessionManager({ sessionStore: memoryStore() });
    expect(anonymous.licenseEnforced).toBe(false);
    expect(anonymous.entitlementGuard.enforced).toBe(false);
  });

  it("answers LICENSE_EXPIRED for an expired proof", async () => {
    const { publicKeySpki, privateKey } = licensedKeyPair();
    const current = 1_750_000_000_000;
    const proof = signedProof(
      { v: 1, deviceId: "device-expired", validatedAt: current - 1_000, expiresAt: current - 1 },
      privateKey,
    );
    const manager = createAiSessionManager({
      licensePublicKeySpki: publicKeySpki,
      now: () => current,
      sessionStore: memoryStore(),
    });
    const base = await start((req, res) => { void manager.createSessionHandler()(req, res); });

    const response = await postSession(base, proof);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: "LICENSE_EXPIRED", reason: "EXPIRED" },
    });
  });

  it("rejects a proof signed by a foreign key", async () => {
    const { publicKeySpki } = licensedKeyPair();
    const foreign = licensedKeyPair();
    const current = 1_750_000_000_000;
    const manager = createAiSessionManager({
      licensePublicKeySpki: publicKeySpki,
      now: () => current,
      sessionStore: memoryStore(),
    });
    const base = await start((req, res) => { void manager.createSessionHandler()(req, res); });

    const response = await postSession(
      base,
      signedProof({ v: 1, deviceId: "device-forged", validatedAt: current }, foreign.privateKey),
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: "LICENSE_REQUIRED", reason: "INVALID_SIGNATURE" },
    });
  });
});
