import { constants, createPrivateKey, createSign, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canonicalLicenseJson,
  entitlementIdentity,
  resolveLicensePublicKeySpki,
  verifyLicenseProof,
} from "../../../server/src/entitlement";
import { canonicalLicenseJson as signingServiceCanonicalJson } from "../../../server/src/license-signing";
import { canonicalLicenseJson as clientCanonicalJson } from "../../services/licenseSigning";
import {
  LICENSE_FIXTURE_PAYLOAD,
  LICENSE_FIXTURE_SIGNATURE,
  LICENSE_PUBLIC_KEY_SPKI,
} from "../../services/licenseKeys";

const VERIFIED_AT = 1_750_000_000_000;
const FIXTURE_HOLDING_NOW = LICENSE_FIXTURE_PAYLOAD.validatedAt + 1_000;

function signWith(keyPair: { privateKey: Buffer }, payload: Record<string, unknown>): string {
  const signer = createSign("sha256");
  signer.update(canonicalLicenseJson(payload));
  return signer
    .sign({
      key: createPrivateKey({ key: keyPair.privateKey, format: "der", type: "pkcs8" }),
      padding: constants.RSA_PKCS1_PSS_PADDING,
      saltLength: 32,
    })
    .toString("base64");
}

function newKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "der" },
  });
  return { publicKeySpki: publicKey.toString("base64"), privateKey };
}

function validProof(overrides: Record<string, unknown> = {}) {
  const keyPair = newKeyPair();
  const payload: Record<string, unknown> = {
    v: 1,
    deviceId: "device-under-test",
    validatedAt: VERIFIED_AT,
    expiresAt: VERIFIED_AT + 86_400_000,
    ...overrides,
  };
  return {
    keyPair,
    payload,
    proof: { payload, signature: signWith(keyPair, payload) },
  };
}

describe("server entitlement verifier", () => {
  it("trusts exactly the key the client has committed", () => {
    // The server used to carry its own hand-copied key that no longer matched
    // the signing service, so every legitimately signed proof failed and the
    // entitlement was unenforceable in production. This asserts the two
    // emitted copies agree (check:license-keys enforces the same invariant).
    expect(resolveLicensePublicKeySpki({})).toBe(LICENSE_PUBLIC_KEY_SPKI);
  });

  it("verifies the committed fixture signature with the default key", () => {
    const result = verifyLicenseProof(
      { payload: { ...LICENSE_FIXTURE_PAYLOAD }, signature: LICENSE_FIXTURE_SIGNATURE },
      { now: FIXTURE_HOLDING_NOW },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.entitlement.deviceId).toBe(LICENSE_FIXTURE_PAYLOAD.deviceId);
      expect(result.entitlement.expiresAt).toBe(LICENSE_FIXTURE_PAYLOAD.expiresAt);
    }
  });

  it("honours an explicit key override", () => {
    const { keyPair, proof } = validProof();
    expect(resolveLicensePublicKeySpki({ LICENSE_PUBLIC_KEY_SPKI: keyPair.publicKeySpki })).toBe(
      keyPair.publicKeySpki,
    );
    expect(
      verifyLicenseProof(proof, { now: VERIFIED_AT, publicKeySpki: keyPair.publicKeySpki }).ok,
    ).toBe(true);
  });

  it("keeps the three canonicalizations byte-identical", () => {
    const payload = {
      v: 1,
      deviceId: "abc",
      validatedAt: 42,
      undefinedField: undefined,
      expiresAt: 99,
      activationsLeft: 2,
    };
    const expected = clientCanonicalJson(payload as never);
    expect(canonicalLicenseJson(payload)).toBe(expected);
    expect(signingServiceCanonicalJson(payload as never)).toBe(expected);
  });

  it("derives an opaque identity from the proof", () => {
    const { payload, proof } = validProof();
    const identity = entitlementIdentity(payload.deviceId as string, proof.signature);
    expect(identity).toMatch(/^[0-9a-f]{64}$/);
    expect(identity).not.toContain("device-under-test");
    // Stable across calls so quota buckets do not reset per request.
    expect(entitlementIdentity(payload.deviceId as string, proof.signature)).toBe(identity);
  });

  it("rejects a missing or malformed proof", () => {
    expect(verifyLicenseProof({}, { now: VERIFIED_AT })).toMatchObject({
      ok: false,
      reason: "MISSING_PROOF",
    });
    expect(verifyLicenseProof(null, { now: VERIFIED_AT })).toMatchObject({
      ok: false,
      reason: "MISSING_PROOF",
    });
    expect(
      verifyLicenseProof({ payload: [], signature: "x".repeat(64) }, { now: VERIFIED_AT }),
    ).toMatchObject({ ok: false, reason: "MALFORMED_PROOF" });
  });

  it("rejects an unsupported payload version", () => {
    const { proof } = validProof({ v: 2 });
    expect(verifyLicenseProof(proof, { now: VERIFIED_AT })).toMatchObject({
      ok: false,
      reason: "UNSUPPORTED_VERSION",
    });
  });

  it("rejects a proof outside the validation window", () => {
    const { proof } = validProof();
    // Far future: a client clock cannot extend an entitlement.
    expect(verifyLicenseProof(proof, { now: VERIFIED_AT - 60 * 60_000 })).toMatchObject({
      ok: false,
      reason: "VALIDATION_WINDOW",
    });
    // Too old: a copied proof cannot be replayed forever.
    expect(verifyLicenseProof(proof, { now: VERIFIED_AT + 31 * 24 * 60 * 60_000 })).toMatchObject({
      ok: false,
      reason: "VALIDATION_WINDOW",
    });
  });

  it("rejects an expired license", () => {
    const { proof } = validProof({ expiresAt: VERIFIED_AT + 1_000 });
    expect(verifyLicenseProof(proof, { now: VERIFIED_AT + 2_000 })).toMatchObject({
      ok: false,
      reason: "EXPIRED",
    });
  });

  it("treats a missing expiry as a lifetime license", () => {
    const { keyPair, payload } = validProof();
    delete payload.expiresAt;
    const proof = { payload, signature: signWith(keyPair, payload) };
    const result = verifyLicenseProof(proof, {
      now: VERIFIED_AT,
      publicKeySpki: keyPair.publicKeySpki,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.entitlement.expiresAt).toBeUndefined();
  });

  it("rejects a tampered payload and a foreign signing key", () => {
    const tampered = validProof();
    const editedPayload = { ...tampered.payload, expiresAt: VERIFIED_AT + 10 * 365 * 86_400_000 };
    expect(
      verifyLicenseProof(
        { payload: editedPayload, signature: tampered.proof.signature },
        { now: VERIFIED_AT },
      ),
    ).toMatchObject({ ok: false, reason: "INVALID_SIGNATURE" });

    const foreign = validProof();
    expect(
      verifyLicenseProof(foreign.proof, {
        now: VERIFIED_AT,
        publicKeySpki: tampered.keyPair.publicKeySpki,
      }),
    ).toMatchObject({ ok: false, reason: "INVALID_SIGNATURE" });
  });

  it("fails closed on an unusable signing key", () => {
    const { proof } = validProof();
    expect(
      verifyLicenseProof(proof, { now: VERIFIED_AT, publicKeySpki: "not-base64-der" }),
    ).toMatchObject({ ok: false, reason: "SIGNING_KEY_INVALID" });
  });
});
