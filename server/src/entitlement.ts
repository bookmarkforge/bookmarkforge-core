/**
 * server/src/entitlement.ts — the server's single authority on whether a
 * client is entitled to a paid (Pro) feature.
 *
 * The client proves its entitlement with the `{ payload, signature }` license
 * state the signing service issued for this device. That proof is
 * self-contained: any server surface can verify it against the committed
 * public key with no cooperation from the client beyond presenting it, which
 * is what turns the entitlement from an advisory client-side boolean into
 * something the server can enforce.
 *
 * Wire contract — MUST stay byte-compatible with the client verifier
 * (src/services/licenseSigning.ts) and the signing service
 * (server/src/license-signing.ts), pinned by contract tests:
 *   - canonical JSON: key-sorted, `undefined` omitted
 *   - RSA-PSS, SHA-256, salt length 32; signature is base64
 *   - payload v1: `deviceId` + `validatedAt` are required, `expiresAt`
 *     missing means a lifetime license
 *
 * Fail closed: every rejection returns `{ ok: false, reason }` with a
 * machine-readable reason; a partial or unverifiable payload NEVER yields an
 * entitlement.
 */
import { createHash, createPublicKey, verify } from "node:crypto";
import { LICENSE_PUBLIC_KEY_SPKI as COMMITTED_LICENSE_PUBLIC_KEY_SPKI } from "./license-public-key";

/** A proof older than this is not evidence of a current entitlement. */
export const LICENSE_PROOF_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** Tolerance for a client clock running ahead of the server's. */
export const LICENSE_PROOF_CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_SIGNATURE_LENGTH = 4096;
const MIN_SIGNATURE_LENGTH = 32;
const MAX_DEVICE_ID_LENGTH = 256;
const MAX_INSTANCE_ID_LENGTH = 256;
const SUPPORTED_PAYLOAD_VERSION = 1;

export type EntitlementDenialReason =
  | "MISSING_PROOF"
  | "MALFORMED_PROOF"
  | "UNSUPPORTED_VERSION"
  | "VALIDATION_WINDOW"
  | "EXPIRED"
  | "INVALID_SIGNATURE"
  | "SIGNING_KEY_INVALID";

export interface Entitlement {
  /** Per-install id the proof is bound to. */
  deviceId: string;
  /** Epoch ms of the last successful validation. */
  validatedAt: number;
  /** Epoch ms the entitlement ends; undefined = lifetime license. */
  expiresAt?: number;
  /** Remaining activations reported by the signing service (display only). */
  activationsLeft?: number;
  /** License-server instance id (binds the proof to the activated instance). */
  instanceId?: string;
  /**
   * Stable, non-reversible identity used to key quotas and rate limits.
   * Derived from the proof itself so two requests from the same install share
   * a bucket without the server storing the device id or the signature.
   */
  identity: string;
  /** Epoch ms when the provider trial began (only for server-signed trials). */
  trialStartedAt?: number;
  /** Epoch ms when the provider trial ends; bounds the entitlement. */
  trialExpiresAt?: number;
}

export type EntitlementResult =
  | { ok: true; entitlement: Entitlement }
  | { ok: false; reason: EntitlementDenialReason; message: string };

export interface VerifyLicenseProofOptions {
  now?: number;
  /** Overrides the committed key (contract tests, key rotation). */
  publicKeySpki?: string;
  maxAgeMs?: number;
  clockSkewMs?: number;
}

/**
 * Canonical serialization for signing/verifying: key-sorted JSON, undefined
 * omitted. Byte-must match the client and signing-service copies.
 */
export function canonicalLicenseJson(payload: Record<string, unknown>): string {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(payload).sort()) {
    const value = payload[key];
    if (value !== undefined) sorted[key] = value;
  }
  return JSON.stringify(sorted);
}

/**
 * The public key the server trusts: the deployment's explicit override when
 * set, otherwise the committed key shared with the client.
 *
 * The override exists for key rotation and operator-provided keypairs. The
 * committed default is what makes "no configuration" safe: before this
 * module the server carried its own hand-copied key that no longer matched
 * the signing service, so every legitimately signed proof failed
 * verification — an entitlement check nobody could pass is not enforcement,
 * it is breakage.
 */
export function resolveLicensePublicKeySpki(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const override = env.LICENSE_PUBLIC_KEY_SPKI?.trim();
  return override && override.length > 0 ? override : COMMITTED_LICENSE_PUBLIC_KEY_SPKI;
}

/**
 * Quota/rate-limit identity for a verified proof. Byte-identical to the
 * derivation used before this module existed, so switching to it does NOT
 * reset anyone's daily quota.
 */
export function entitlementIdentity(deviceId: string, signature: string): string {
  return createHash("sha256").update(`${deviceId}:${signature}`).digest("hex");
}

function deny(reason: EntitlementDenialReason, message: string): EntitlementResult {
  return { ok: false, reason, message };
}

/**
 * Verify a client-presented license proof and resolve the entitlement.
 * Never throws: an unusable key or malformed proof is a denial with the
 * matching reason so callers can pick the right status code.
 */
export function verifyLicenseProof(
  proof: unknown,
  options: VerifyLicenseProofOptions = {},
): EntitlementResult {
  const now = options.now ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? LICENSE_PROOF_MAX_AGE_MS;
  const clockSkewMs = options.clockSkewMs ?? LICENSE_PROOF_CLOCK_SKEW_MS;
  const publicKeySpki = options.publicKeySpki ?? resolveLicensePublicKeySpki();

  if (!proof || typeof proof !== "object" || Array.isArray(proof)) {
    return deny("MISSING_PROOF", "a signed license proof is required");
  }
  const { payload: rawPayload, signature } = proof as {
    payload?: unknown;
    signature?: unknown;
  };
  if (
    typeof signature !== "string" ||
    signature.length < MIN_SIGNATURE_LENGTH ||
    signature.length > MAX_SIGNATURE_LENGTH
  ) {
    return deny("MISSING_PROOF", "a signed license proof is required");
  }
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
    return deny("MALFORMED_PROOF", "license proof payload must be an object");
  }

  const payload = rawPayload as Record<string, unknown>;
  if (payload.v !== SUPPORTED_PAYLOAD_VERSION) {
    return deny(
      "UNSUPPORTED_VERSION",
      `license proof version ${String(payload.v ?? "missing")} is not supported`,
    );
  }
  if (
    typeof payload.deviceId !== "string" ||
    payload.deviceId.length === 0 ||
    payload.deviceId.length > MAX_DEVICE_ID_LENGTH
  ) {
    return deny("MALFORMED_PROOF", "license proof is missing a valid device id");
  }
  if (typeof payload.validatedAt !== "number" || !Number.isFinite(payload.validatedAt)) {
    return deny("MALFORMED_PROOF", "license proof is missing a valid validation time");
  }
  if (payload.validatedAt > now + clockSkewMs) {
    return deny("VALIDATION_WINDOW", "license proof is dated in the future");
  }
  if (payload.validatedAt < now - maxAgeMs) {
    return deny("VALIDATION_WINDOW", "license proof is too old — revalidate in Settings");
  }
  if (payload.expiresAt !== undefined) {
    if (typeof payload.expiresAt !== "number" || !Number.isFinite(payload.expiresAt)) {
      return deny("MALFORMED_PROOF", "license proof carries an invalid expiry");
    }
    if (payload.expiresAt <= now) {
      return deny("EXPIRED", "the license has expired");
    }
  }
  if (payload.trialExpiresAt !== undefined) {
    if (typeof payload.trialExpiresAt !== "number" || !Number.isFinite(payload.trialExpiresAt)) {
      return deny("MALFORMED_PROOF", "license proof carries an invalid trial expiry");
    }
    if (payload.trialExpiresAt <= now) {
      return deny("EXPIRED", "the trial has expired");
    }
  }
  if (
    payload.activationsLeft !== undefined &&
    (typeof payload.activationsLeft !== "number" || !Number.isFinite(payload.activationsLeft))
  ) {
    return deny("MALFORMED_PROOF", "license proof carries an invalid activation count");
  }
  if (
    payload.instanceId !== undefined &&
    (typeof payload.instanceId !== "string" ||
      payload.instanceId.length > MAX_INSTANCE_ID_LENGTH)
  ) {
    return deny("MALFORMED_PROOF", "license proof carries an invalid instance id");
  }
  if (
    payload.trialStartedAt !== undefined &&
    (typeof payload.trialStartedAt !== "number" || !Number.isFinite(payload.trialStartedAt))
  ) {
    return deny("MALFORMED_PROOF", "license proof carries an invalid trial start time");
  }
  if (
    payload.trialExpiresAt !== undefined &&
    (typeof payload.trialExpiresAt !== "number" || !Number.isFinite(payload.trialExpiresAt))
  ) {
    return deny("MALFORMED_PROOF", "license proof carries an invalid trial expiry time");
  }
  if (
    payload.trialStartedAt !== undefined &&
    payload.trialExpiresAt !== undefined &&
    payload.trialStartedAt >= payload.trialExpiresAt
  ) {
    return deny("MALFORMED_PROOF", "trial window must have a positive duration");
  }

  let publicKey: ReturnType<typeof createPublicKey>;
  try {
    publicKey = createPublicKey({
      key: Buffer.from(publicKeySpki, "base64"),
      format: "der",
      type: "spki",
    });
  } catch {
    return deny("SIGNING_KEY_INVALID", "the configured license public key is unusable");
  }

  let signatureValid = false;
  try {
    signatureValid = verify(
      "sha256",
      Buffer.from(canonicalLicenseJson(payload), "utf8"),
      // padding 6 = RSA_PKCS1_PSS_PADDING
      { key: publicKey, padding: 6, saltLength: 32 },
      Buffer.from(signature, "base64"),
    );
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) {
    return deny("INVALID_SIGNATURE", "license proof signature did not verify");
  }

  const entitlement: Entitlement = {
    deviceId: payload.deviceId,
    validatedAt: payload.validatedAt,
    identity: entitlementIdentity(payload.deviceId, signature),
  };
  if (typeof payload.expiresAt === "number") entitlement.expiresAt = payload.expiresAt;
  if (typeof payload.activationsLeft === "number") {
    entitlement.activationsLeft = payload.activationsLeft;
  }
  if (typeof payload.instanceId === "string") entitlement.instanceId = payload.instanceId;
  if (typeof payload.trialStartedAt === "number") {
    entitlement.trialStartedAt = payload.trialStartedAt;
  }
  if (typeof payload.trialExpiresAt === "number") {
    entitlement.trialExpiresAt = payload.trialExpiresAt;
  }
  return { ok: true, entitlement };
}
