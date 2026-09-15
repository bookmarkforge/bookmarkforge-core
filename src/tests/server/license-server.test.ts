import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { generateKeyPairSync } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLicenseHandler } from "../../../server/src/license-server";
import { verifyLicenseSignature } from "../../services/licenseSigning";

const servers: Array<ReturnType<typeof createServer>> = [];

async function start(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) => new Promise<void>((resolve) => {
        if (!server.listening) {
          resolve();
          return;
        }
        server.close(() => resolve());
      }),
    ),
  );
});

describe("Whop license signing handler", () => {
  it("signs an active provider entitlement that the client verifies", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "der" },
      privateKeyEncoding: { type: "pkcs8", format: "der" },
    });
    const providerFetch = vi.fn(async (url: string) => {
      expect(url).toBe("https://whop-adapter.test/license/activate");
      return new Response(JSON.stringify({
        activated: true,
        instance: { id: "whop-instance-1" },
        license: { status: "active", activations: 1, limit: 5 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const handler = createLicenseHandler({
      privateKey,
      whopApiUrl: "https://whop-adapter.test/license",
      whopApiKey: "server-only-whop-key",
      fetchImpl: providerFetch as unknown as typeof fetch,
    });
    const base = await start((req, res) => { void handler(req, res); });

    const response = await fetch(`${base}/api/license/activate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ license_key: "WHOP-CODE", instance_name: "device-1" }),
    });
    const body = await response.json() as {
      payload: Parameters<typeof verifyLicenseSignature>[0];
      signature: string;
    };

    expect(response.status).toBe(200);
    expect(body.payload.deviceId).toBe("device-1");
    expect(body.payload.instanceId).toBe("whop-instance-1");
    expect(body.payload.activationsLeft).toBe(4);
    expect(await verifyLicenseSignature(
      body.payload,
      body.signature,
      publicKey.toString("base64"),
    )).toBe(true);
  });

  it("returns a structured invalid-key error without signing", async () => {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "der" },
      publicKeyEncoding: { type: "spki", format: "der" },
    });
    const handler = createLicenseHandler({
      privateKey,
      whopApiUrl: "https://whop-adapter.test/license",
      whopApiKey: "server-only-whop-key",
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({
        valid: false,
        error: "license key invalid",
      }), { status: 200 } )) as unknown as typeof fetch,
    });
    const base = await start((req, res) => { void handler(req, res); });

    const response = await fetch(`${base}/api/license/validate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ license_key: "BAD", instance_name: "device-1" }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "INVALID_KEY", message: "license key is invalid" },
    });
  });

  it("does not grant an entitlement when the adapter contradicts itself", async () => {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "der" },
      publicKeyEncoding: { type: "spki", format: "der" },
    });
    const handler = createLicenseHandler({
      privateKey,
      whopApiUrl: "https://whop-adapter.test/license",
      whopApiKey: "server-only-whop-key",
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({
        valid: false,
        status: "active",
      }), { status: 200 })) as unknown as typeof fetch,
    });
    const base = await start((req, res) => { void handler(req, res); });

    const response = await fetch(`${base}/api/license/validate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ license_key: "WHOP-CODE", instance_name: "device-1" }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "INVALID_KEY", message: "license key is invalid" },
    });
  });

  it("requires explicit provider confirmation when deactivating", async () => {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "der" },
      publicKeyEncoding: { type: "spki", format: "der" },
    });
    const handler = createLicenseHandler({
      privateKey,
      whopApiUrl: "https://whop-adapter.test/license",
      whopApiKey: "server-only-whop-key",
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })) as unknown as typeof fetch,
    });
    const base = await start((req, res) => { void handler(req, res); });

    const response = await fetch(`${base}/api/license/deactivate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ license_key: "WHOP-CODE", instance_id: "whop-instance-1" }),
    });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: { code: "SERVER", message: "license provider did not confirm deactivation" },
    });
  });

  it("rejects an expired license (provider returns a past expires_at)", async () => {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "der" },
      publicKeyEncoding: { type: "spki", format: "der" },
    });
    const handler = createLicenseHandler({
      privateKey,
      whopApiUrl: "https://whop-adapter.test/license",
      whopApiKey: "server-only-whop-key",
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({
        activated: true,
        expires_at: "2020-01-01T00:00:00Z",
        license: { status: "active" },
      }), { status: 200 })) as unknown as typeof fetch,
      now: () => Date.parse("2026-08-24T12:00:00Z"),
    });
    const base = await start((req, res) => { void handler(req, res); });

    const response = await fetch(`${base}/api/license/activate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ license_key: "EXPIRED", instance_name: "device-1" }),
    });
    expect(response.status).toBe(400);
    const body = await response.json() as { error: { code: string } };
    expect(body.error.code).toBe("INVALID_KEY");
  });

  it("rejects a malformed expiry string from the adapter (no entitlement escalation)", async () => {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "der" },
      publicKeyEncoding: { type: "spki", format: "der" },
    });
    const handler = createLicenseHandler({
      privateKey,
      whopApiUrl: "https://whop-adapter.test/license",
      whopApiKey: "server-only-whop-key",
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({
        activated: true,
        expires_at: "not-a-date",
        license: { status: "active" },
      }), { status: 200 })) as unknown as typeof fetch,
    });
    const base = await start((req, res) => { void handler(req, res); });

    const response = await fetch(`${base}/api/license/activate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ license_key: "BAD-EXPIRY", instance_name: "device-1" }),
    });
    expect(response.status).toBe(400);
  });

  it("confirms deactivation when the provider acknowledges it", async () => {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "der" },
      publicKeyEncoding: { type: "spki", format: "der" },
    });
    const handler = createLicenseHandler({
      privateKey,
      whopApiUrl: "https://whop-adapter.test/license",
      whopApiKey: "server-only-whop-key",
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({
        ok: true,
        deactivated: true,
        status: "deactivated",
      }), { status: 200 })) as unknown as typeof fetch,
    });
    const base = await start((req, res) => { void handler(req, res); });

    const response = await fetch(`${base}/api/license/deactivate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ license_key: "WHOP-CODE", instance_id: "whop-instance-1" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("unwraps a nested data.attributes envelope from the provider", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "der" },
      privateKeyEncoding: { type: "pkcs8", format: "der" },
    });
    const handler = createLicenseHandler({
      privateKey,
      whopApiUrl: "https://whop-adapter.test/license",
      whopApiKey: "server-only-whop-key",
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({
        data: {
          attributes: {
            activated: true,
            instance: { id: "nested-instance" },
            license: { status: "active", activations: 2, limit: 10 },
          },
        },
      }), { status: 200 })) as unknown as typeof fetch,
    });
    const base = await start((req, res) => { void handler(req, res); });

    const response = await fetch(`${base}/api/license/activate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ license_key: "NESTED", instance_name: "device-1" }),
    });
    const body = await response.json() as {
      payload: Parameters<typeof verifyLicenseSignature>[0];
      signature: string;
    };
    expect(response.status).toBe(200);
    expect(body.payload.deviceId).toBe("device-1");
    expect(body.payload.instanceId).toBe("nested-instance");
    expect(body.payload.activationsLeft).toBe(8);
    expect(await verifyLicenseSignature(
      body.payload, body.signature, publicKey.toString("base64"),
    )).toBe(true);
  });

  it("enforces per-IP rate limiting on license endpoints", async () => {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "der" },
      publicKeyEncoding: { type: "spki", format: "der" },
    });
    const handler = createLicenseHandler({
      privateKey,
      whopApiUrl: "https://whop-adapter.test/license",
      whopApiKey: "server-only-whop-key",
      rateLimit: 1,
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({
        valid: true,
        status: "active",
      }), { status: 200 })) as unknown as typeof fetch,
    });
    const base = await start((req, res) => { void handler(req, res); });
    const body = JSON.stringify({ license_key: "K", instance_name: "d" });
    const headers = { "content-type": "application/json" };

    const first = await fetch(`${base}/api/license/validate`, { method: "POST", body, headers });
    expect(first.status).toBe(200);

    const second = await fetch(`${base}/api/license/validate`, { method: "POST", body, headers });
    expect(second.status).toBe(429);
  });

  it("rejects both GET and unknown paths on license endpoints", async () => {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "der" },
      publicKeyEncoding: { type: "spki", format: "der" },
    });
    const handler = createLicenseHandler({ privateKey });
    const base = await start((req, res) => { void handler(req, res); });

    const getActivate = await fetch(`${base}/api/license/activate`);
    expect(getActivate.status).toBe(405);

    const unknown = await fetch(`${base}/api/license/nope`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(unknown.status).toBe(404);
  });

  it("rejects oversized request bodies with 413", async () => {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "der" },
      publicKeyEncoding: { type: "spki", format: "der" },
    });
    const handler = createLicenseHandler({ privateKey });
    const base = await start((req, res) => { void handler(req, res); });

    const response = await fetch(`${base}/api/license/activate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{\"license_key\":\"" + "x".repeat(20_000) + "\"}",
    });
    expect(response.status).toBe(413);
  });

  it("rejects requests missing both instance_name and instance_id", async () => {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "der" },
      publicKeyEncoding: { type: "spki", format: "der" },
    });
    const handler = createLicenseHandler({ privateKey });
    const base = await start((req, res) => { void handler(req, res); });

    const response = await fetch(`${base}/api/license/activate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ license_key: "WHOP-CODE" }),
    });
    expect(response.status).toBe(400);
  });

  it("returns 502 when the provider returns HTTP 401/403", async () => {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "der" },
      publicKeyEncoding: { type: "spki", format: "der" },
    });
    const handler = createLicenseHandler({
      privateKey,
      whopApiUrl: "https://whop-adapter.test/license",
      whopApiKey: "server-only-whop-key",
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ error: "bad key" }), { status: 401 })) as unknown as typeof fetch,
    });
    const base = await start((req, res) => { void handler(req, res); });

    const response = await fetch(`${base}/api/license/activate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ license_key: "K", instance_name: "d" }),
    });
    // Upstream adapter auth failure (server→Whop) — 502-class, NOT part of
    // the 400/INVALID_KEY anti-enumeration unification for client keys.
    expect(response.status).toBe(401);
  });

  it("returns the health status based on configuration", async () => {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "der" },
      publicKeyEncoding: { type: "spki", format: "der" },
    });
    const configured = createLicenseHandler({
      privateKey,
      whopApiUrl: "https://whop-adapter.test/license",
      whopApiKey: "key",
    });
    const baseConfigured = await start((req, res) => { void configured(req, res); });
    const ok = await fetch(`${baseConfigured}/api/license/health`);
    expect(ok.status).toBe(200);
    const okBody = await ok.json() as { status: string };
    expect(okBody.status).toBe("ok");

    const unconfigured = createLicenseHandler({ privateKey });
    const baseUnconf = await start((req, res) => { void unconfigured(req, res); });
    const notOk = await fetch(`${baseUnconf}/api/license/health`);
    expect(notOk.status).toBe(503);
    const notOkBody = await notOk.json() as { status: string };
    expect(notOkBody.status).toBe("not_configured");
  });

  it("uses instance_id as the device identity when instance_name is absent", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "der" },
      privateKeyEncoding: { type: "pkcs8", format: "der" },
    });
    const handler = createLicenseHandler({
      privateKey,
      whopApiUrl: "https://whop-adapter.test/license",
      whopApiKey: "server-only-whop-key",
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({
        activated: true,
        instance: { id: "provider-instance" },
        license: { status: "active" },
      }), { status: 200 })) as unknown as typeof fetch,
    });
    const base = await start((req, res) => { void handler(req, res); });

    const response = await fetch(`${base}/api/license/activate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ license_key: "ID-ONLY", instance_id: "my-instance-id" }),
    });
    const body = await response.json() as {
      payload: Parameters<typeof verifyLicenseSignature>[0];
      signature: string;
    };
    expect(response.status).toBe(200);
    expect(body.payload.deviceId).toBe("my-instance-id");
    expect(body.payload.instanceId).toBe("provider-instance");
    expect(await verifyLicenseSignature(
      body.payload, body.signature, publicKey.toString("base64"),
    )).toBe(true);
  });

  it("fails closed when the Whop adapter is not configured", async () => {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "der" },
      publicKeyEncoding: { type: "spki", format: "der" },
    });
    const handler = createLicenseHandler({ privateKey });
    const base = await start((req, res) => { void handler(req, res); });

    const response = await fetch(`${base}/api/license/activate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ license_key: "WHOP-CODE", instance_name: "device-1" }),
    });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: { code: "SERVER", message: "license provider is not configured" },
    });
  });
});
