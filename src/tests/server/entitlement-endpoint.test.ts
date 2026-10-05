import { constants, createPrivateKey, createSign, generateKeyPairSync } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { canonicalLicenseJson } from "../../../server/src/entitlement";
import { createEntitlementHandler } from "../../../server/src/entitlement-endpoint";

const servers: Array<ReturnType<typeof createServer>> = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(async (server) => {
      if (!server.listening) return;
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }),
  );
});

const NOW = 1_750_000_000_000;

function licensedKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "der" },
  });
  return { publicKeySpki: publicKey.toString("base64"), privateKey };
}

function signedProof(payload: Record<string, unknown>, privateKey: Buffer) {
  const signer = createSign("sha256");
  signer.update(canonicalLicenseJson(payload));
  return {
    payload,
    signature: signer
      .sign({
        key: createPrivateKey({ key: privateKey, format: "der", type: "pkcs8" }),
        padding: constants.RSA_PKCS1_PSS_PADDING,
        saltLength: 32,
      })
      .toString("base64"),
  };
}

async function start(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
): Promise<string> {
  const server = createServer((req, res) => {
    void handler(req, res);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("entitlement endpoint", () => {
  it("answers pro for a server-signed proof", async () => {
    const { publicKeySpki, privateKey } = licensedKeyPair();
    const base = await start(
      createEntitlementHandler({
        licensePublicKeySpki: publicKeySpki,
        now: () => NOW,
        allowMissingOrigin: true,
      }),
    );
    const response = await fetch(`${base}/api/license/entitlement`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        signedProof(
          { v: 1, deviceId: "device-1", validatedAt: NOW, expiresAt: NOW + 60_000 },
          privateKey,
        ),
      ),
    });

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      plan: "pro",
      source: "license",
      deviceId: "device-1",
      isInTrial: false,
      trialDaysRemaining: null,
    });
    // The internal quota identity must never be echoed back.
    expect(body).not.toHaveProperty("identity");
  });

  it("reports the signed trial window with the server-computed days remaining", async () => {
    const { publicKeySpki, privateKey } = licensedKeyPair();
    const DAY = 24 * 60 * 60 * 1000;
    const base = await start(
      createEntitlementHandler({
        licensePublicKeySpki: publicKeySpki,
        now: () => NOW,
        allowMissingOrigin: true,
      }),
    );
    const response = await fetch(`${base}/api/license/entitlement`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        signedProof(
          {
            v: 1,
            deviceId: "device-trial",
            validatedAt: NOW,
            expiresAt: NOW + 3 * DAY,
            trialStartedAt: NOW - 4 * DAY,
            trialExpiresAt: NOW + 3 * DAY,
          },
          privateKey,
        ),
      ),
    });

    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      plan: "pro",
      source: "trial",
      deviceId: "device-trial",
      expiresAt: NOW + 3 * DAY,
      trialStartedAt: NOW - 4 * DAY,
      trialExpiresAt: NOW + 3 * DAY,
      isInTrial: true,
      trialDaysRemaining: 3,
    });
  });

  it("rounds a partial trial day up and never reports a negative remaining", async () => {
    const { publicKeySpki, privateKey } = licensedKeyPair();
    const DAY = 24 * 60 * 60 * 1000;
    const base = await start(
      createEntitlementHandler({
        licensePublicKeySpki: publicKeySpki,
        now: () => NOW,
        allowMissingOrigin: true,
      }),
    );
    const response = await fetch(`${base}/api/license/entitlement`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        signedProof(
          {
            v: 1,
            deviceId: "device-trial-hours",
            validatedAt: NOW,
            trialStartedAt: NOW - 6 * DAY,
            // Less than a full day left → ceil() reports 1, not 0.
            trialExpiresAt: NOW + 6 * 60 * 60 * 1000,
          },
          privateKey,
        ),
      ),
    });

    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({ isInTrial: true, trialDaysRemaining: 1 });
  });

  it("answers free (EXPIRED) for an expired signed trial window", async () => {
    const { publicKeySpki, privateKey } = licensedKeyPair();
    const DAY = 24 * 60 * 60 * 1000;
    const base = await start(
      createEntitlementHandler({
        licensePublicKeySpki: publicKeySpki,
        now: () => NOW,
        allowMissingOrigin: true,
      }),
    );
    const response = await fetch(`${base}/api/license/entitlement`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        signedProof(
          {
            v: 1,
            deviceId: "device-trial-over",
            validatedAt: NOW - DAY,
            // No expiresAt: the trial window alone bounds the entitlement.
            trialStartedAt: NOW - 8 * DAY,
            trialExpiresAt: NOW - 1,
          },
          privateKey,
        ),
      ),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ plan: "free", reason: "EXPIRED" });
  });

  it("answers free (not an error) for a proof it cannot honour", async () => {
    const { publicKeySpki } = licensedKeyPair();
    const foreign = licensedKeyPair();
    const base = await start(
      createEntitlementHandler({
        licensePublicKeySpki: publicKeySpki,
        now: () => NOW,
        allowMissingOrigin: true,
      }),
    );

    const forged = await fetch(`${base}/api/license/entitlement`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        signedProof({ v: 1, deviceId: "device-2", validatedAt: NOW }, foreign.privateKey),
      ),
    });
    expect(forged.status).toBe(200);
    expect(await forged.json()).toMatchObject({ plan: "free", reason: "INVALID_SIGNATURE" });

    const expired = await fetch(`${base}/api/license/entitlement`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        signedProof(
          { v: 1, deviceId: "device-3", validatedAt: NOW - 1_000, expiresAt: NOW - 1 },
          foreign.privateKey,
        ),
      ),
    });
    expect(await expired.json()).toMatchObject({ plan: "free", reason: "EXPIRED" });
  });

  it("never downgrades a client when the deployment's own key is unusable", async () => {
    const base = await start(
      createEntitlementHandler({
        licensePublicKeySpki: "not-base64-der",
        now: () => NOW,
        allowMissingOrigin: true,
      }),
    );
    // Well-formed payload, so the failure is the key itself and not the proof.
    const response = await fetch(`${base}/api/license/entitlement`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        payload: { v: 1, deviceId: "device-4", validatedAt: NOW },
        signature: "x".repeat(64),
      }),
    });

    // 503 (server problem), never 200 { plan: "free" } — a paying user must
    // not be revoked by a misconfigured deployment.
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "SIGNING_KEY_INVALID" },
    });
  });

  it("rejects the wrong method, a foreign origin and a malformed body", async () => {
    const { publicKeySpki } = licensedKeyPair();
    const base = await start(
      createEntitlementHandler({
        licensePublicKeySpki: publicKeySpki,
        now: () => NOW,
        allowedOrigins: ["https://bookmarkforge.com"],
      }),
    );

    const method = await fetch(`${base}/api/license/entitlement`, { method: "GET" });
    expect(method.status).toBe(405);

    const origin = await fetch(`${base}/api/license/entitlement`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.test" },
      body: "{}",
    });
    expect(origin.status).toBe(403);

    const allowed = await fetch(`${base}/api/license/entitlement`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://bookmarkforge.com" },
      body: "not json",
    });
    expect(allowed.status).toBe(400);
  });
});
