import {
  constants,
  createPrivateKey,
  createSign,
  generateKeyPairSync,
} from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  createEntitlementGuard,
  isEntitlementGuarded,
  readEntitlementContext,
  resolveEntitlementContext,
  withEntitlement,
  type EntitlementContext,
} from "../../../server/src/entitlement-guard";
import { canonicalLicenseJson } from "../../../server/src/entitlement";

const servers: Array<ReturnType<typeof createServer>> = [];

async function start(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<string> {
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

const NOW = 1_750_000_000_000;

/**
 * The guard is the single place a request becomes an entitlement. These tests
 * exercise it through a real HTTP server because the body handling (one read,
 * bounded, shared with the handler below it) is part of the contract: a fake
 * request object cannot prove the router's composition works.
 */
describe("entitlement guard", () => {
  it("verifies a signed proof into a context carrying identity and expiry", async () => {
    const { publicKeySpki, privateKey } = licensedKeyPair();
    const proof = signedProof(
      { v: 1, deviceId: "device-1", validatedAt: NOW, expiresAt: NOW + 60_000 },
      privateKey,
    );
    const guard = createEntitlementGuard({ publicKeySpki, now: () => NOW });
    expect(guard.enforced).toBe(true);

    let context: EntitlementContext | null = null;
    const base = await start((req, res) => {
      void guard.middleware("proof", { proofLabel: "license proof" })(req, res, (resolved) => {
        context = resolved;
        res.writeHead(200).end("ok");
      });
    });

    const response = await fetch(`${base}/api/removed-capability`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(proof),
    });
    expect(response.status).toBe(200);
    const resolved = context as unknown as EntitlementContext;
    expect(resolved.via).toBe("proof");
    expect(resolved.identity).toMatch(/^[0-9a-f]{64}$/);
    expect(resolved.entitlementExpiresAt).toBe(NOW + 60_000);
  });

  it("denies a missing proof, an expired proof and a foreign signature", async () => {
    const { publicKeySpki, privateKey } = licensedKeyPair();
    const foreign = licensedKeyPair();
    const guard = createEntitlementGuard({ publicKeySpki, now: () => NOW });
    const base = await start((req, res) => {
      void guard.middleware("proof", { proofLabel: "license proof" })(req, res, () => {
        res.writeHead(200).end("ok");
      });
    });
    const post = (body: unknown) =>
      fetch(`${base}/api/removed-capability`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

    const missing = await post({});
    expect(missing.status).toBe(401);
    expect(await missing.json()).toEqual({
      error: {
        code: "LICENSE_REQUIRED",
        message: expect.any(String),
        reason: "MISSING_PROOF",
      },
    });

    const expired = await post(
      signedProof(
        { v: 1, deviceId: "device-expired", validatedAt: NOW - 1_000, expiresAt: NOW - 1 },
        privateKey,
      ),
    );
    expect(expired.status).toBe(401);
    expect(await expired.json()).toMatchObject({
      error: { code: "LICENSE_EXPIRED", reason: "EXPIRED" },
    });

    const forged = await post(
      signedProof({ v: 1, deviceId: "device-forged", validatedAt: NOW }, foreign.privateKey),
    );
    expect(forged.status).toBe(401);
    expect(await forged.json()).toMatchObject({
      error: { code: "LICENSE_REQUIRED", reason: "INVALID_SIGNATURE" },
    });
  });

  it("answers 503 — never a downgrade — when the deployment's signing key is unusable", async () => {
    const guard = createEntitlementGuard({
      publicKeySpki: "not-a-der-key",
      now: () => NOW,
    });
    const base = await start((req, res) => {
      void guard.middleware("proof")(req, res, () => {
        res.writeHead(200).end("ok");
      });
    });
    // The payload must be well formed for the key to be reached at all: proof
    // shape is validated before the signing key is parsed, so a malformed body
    // would be a 401 regardless of the key.
    const response = await fetch(`${base}/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        payload: { v: 1, deviceId: "device-key", validatedAt: NOW },
        signature: "x".repeat(64),
      }),
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "SIGNING_KEY_INVALID" },
    });
  });

  it("rejects a malformed or oversized proof body with the route's label", async () => {
    const { publicKeySpki } = licensedKeyPair();
    const guard = createEntitlementGuard({ publicKeySpki, now: () => NOW, maxProofBytes: 16 });
    const base = await start((req, res) => {
      void guard.middleware("proof", { proofLabel: "entitlement proof" })(req, res, () => {
        res.writeHead(200).end("ok");
      });
    });

    const malformed = await fetch(`${base}/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({
      error: { code: "INVALID_REQUEST", message: "entitlement proof is invalid" },
    });

    const oversized = await fetch(`${base}/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payload: { v: 1 }, signature: "y".repeat(64) }),
    });
    expect(oversized.status).toBe(400);
  });

  it("issues an anonymous context only under the explicit opt-out", async () => {
    const guard = createEntitlementGuard({ requireEntitlement: false, now: () => NOW });
    expect(guard.enforced).toBe(false);

    let context: EntitlementContext | null = null;
    const base = await start((req, res) => {
      void guard.middleware("proof")(req, res, (resolved) => {
        context = resolved;
        res.writeHead(200).end("ok");
      });
    });
    const response = await fetch(`${base}/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(200);
    expect(context).toMatchObject({ via: "anonymous", identity: "anonymous" });
  });

  it("still rejects a malformed proof body when the deployment opted out of licenses", async () => {
    // Anonymous deployments must keep the body contract: the guard
    // answered 400 for garbage long before its existence, and "we do not
    // check proofs" is not a reason to mint a session for it.
    const guard = createEntitlementGuard({ requireEntitlement: false, now: () => NOW });
    const base = await start((req, res) => {
      void guard.middleware("proof", { proofLabel: "license proof" })(req, res, () => {
        res.writeHead(200).end("ok");
      });
    });
    const response = await fetch(`${base}/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "INVALID_REQUEST", message: "license proof is invalid" },
    });
  });

  it("resolves once per request: the context is attached and reused, never re-read", async () => {
    const { publicKeySpki, privateKey } = licensedKeyPair();
    const proof = signedProof({ v: 1, deviceId: "device-once", validatedAt: NOW }, privateKey);
    const guard = createEntitlementGuard({ publicKeySpki, now: () => NOW });

    let seenInsideHandler: EntitlementContext | null = null;
    let secondAttach: EntitlementContext | null = null;
    const base = await start((req, res) => {
      void guard
        .middleware("proof", { proofLabel: "license proof" })(req, res, async () => {
          seenInsideHandler = readEntitlementContext(req);
          // The body has already been consumed; a second resolution must reuse
          // the attached context instead of reading a spent stream.
          const decision = await resolveEntitlementContext(req, guard, "proof");
          secondAttach = decision.ok ? decision.context : null;
          res.writeHead(200).end("ok");
        });
    });

    const response = await fetch(`${base}/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(proof),
    });
    expect(response.status).toBe(200);
    expect(seenInsideHandler).not.toBeNull();
    expect(secondAttach).toBe(seenInsideHandler);
  });

  it("never calls the wrapped handler on a denial", async () => {
    const { publicKeySpki } = licensedKeyPair();
    const guard = createEntitlementGuard({ publicKeySpki, now: () => NOW });
    let handlerRan = false;
    const wrapped = withEntitlement(guard, "proof", (_req, res) => {
      handlerRan = true;
      res.writeHead(200).end("ok");
    });
    expect(isEntitlementGuarded(wrapped)).toBe(true);
    expect(isEntitlementGuarded(() => {})).toBe(false);

    const base = await start((req, res) => {
      void wrapped(req, res);
    });
    const response = await fetch(`${base}/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(401);
    expect(handlerRan).toBe(false);
  });
});
