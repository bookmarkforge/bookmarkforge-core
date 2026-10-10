/**
 * server/src/license-signing.ts — server-side license signing.
 *
 * The signing service holds the private key and signs the license state that
 * the app will verify with its committed public key. The private key is
 * loaded from the environment (or the gitignored file emitted by
 * `scripts/generate-license-keys.mjs`), NEVER shipped in the client bundle.
 *
 * Wire compatibility is contractual:
 *   - `canonicalLicenseJson` MUST byte-match the client's
 *     `src/services/licenseSigning.ts#canonicalLicenseJson` (key-sorted JSON,
 *     undefined omitted). The client/server contract test asserts this.
 *   - RSA-PSS with SHA-256 and salt length 32 matches WebCrypto's
 *     `crypto.subtle.verify({ name: "RSA-PSS", saltLength: 32 }, …)`.
 */
import {
  createPrivateKey,
  createSign,
  constants,
} from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface LicensePayload {
  /** Format version — bump on any breaking payload change. */
  v: 1;
  /** Per-install UUID; binds the token to this device install. */
  deviceId: string;
  /** Epoch ms of the last successful validation. */
  validatedAt: number;
  /** Epoch ms when the entitlement ends (undefined = lifetime license). */
  expiresAt?: number;
  /** Remaining activations reported by the license server (display only). */
  activationsLeft?: number;
  /** License server instance id (binds the token to the activated instance). */
  instanceId?: string;
}

/**
 * Canonical serialization: key-sorted JSON, undefined omitted. Byte-must
 * match the client's canonicalization.
 */
export function canonicalLicenseJson(payload: LicensePayload): string {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(payload).sort()) {
    const value = (payload as unknown as Record<string, unknown>)[key];
    if (value !== undefined) {
      sorted[key] = value;
    }
  }
  return JSON.stringify(sorted);
}

/** RSA-PSS (SHA-256, salt 32) sign a payload with a DER PKCS#8 key. */
export function signLicensePayload(
  payload: LicensePayload,
  privateKeyDer: Buffer,
): string {
  const signer = createSign("sha256");
  signer.update(canonicalLicenseJson(payload));
  return signer
    .sign({
      key: createPrivateKey({ key: privateKeyDer, format: "der", type: "pkcs8" }),
      padding: constants.RSA_PKCS1_PSS_PADDING,
      saltLength: 32,
    })
    .toString("base64");
}

/**
 * Load the signing private key (DER PKCS#8) from the environment, falling
 * back to the gitignored file emitted by the key generator. Returns null when
 * no key is configured — the server then fails closed on any signing route.
 *
 * Precedence:
 *   1. LICENSE_SIGNING_PRIVATE_KEY_PKCS8  (base64 PKCS#8 DER)
 *   2. LICENSE_SIGNING_PRIVATE_KEY_FILE   (path to a PEM or DER file)
 *   3. server/.license-signing-key.pkcs8  (gitignored dev key)
 */
export function loadSigningPrivateKey(env: NodeJS.ProcessEnv = process.env): Buffer | null {
  const b64 = env.LICENSE_SIGNING_PRIVATE_KEY_PKCS8?.trim();
  if (b64) {
    try {
      const der = Buffer.from(b64, "base64");
      createPrivateKey({ key: der, format: "der", type: "pkcs8" });
      return der;
    } catch {
      return null;
    }
  }
  const file = env.LICENSE_SIGNING_PRIVATE_KEY_FILE?.trim();
  const candidates = file
    ? [file]
    : [join(process.cwd(), "server", ".license-signing-key.pkcs8")];
  for (const candidate of candidates) {
    try {
      if (!existsSync(candidate)) {continue;}
      const raw = readFileSync(candidate, "utf8").trim();
      if (raw.startsWith("-----BEGIN")) {
        // PEM — the caller expects DER PKCS#8; convert via createPrivateKey.
        return createPrivateKey(raw).export({ type: "pkcs8", format: "der" }) as Buffer;
      }
      const der = Buffer.from(raw, "base64");
      createPrivateKey({ key: der, format: "der", type: "pkcs8" });
      return der;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}
