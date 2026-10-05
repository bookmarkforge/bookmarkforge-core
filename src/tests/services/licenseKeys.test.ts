import { describe, it, expect } from "vitest";
import {
  LICENSE_PUBLIC_KEY_SPKI,
  LICENSE_FIXTURE_SIGNATURE,
  LICENSE_FIXTURE_PAYLOAD,
} from "../../services/licenseKeys";
import { canonicalLicenseJson } from "../../services/licenseSigning";

/**
 * Direct contract tests for src/services/licenseKeys.ts. The module only
 * ships the PUBLIC verification key plus a committed prove-the-keypair
 * fixture; these tests prove — using raw WebCrypto (RSA-PSS/SHA-256, the
 * scheme the signing service uses) and the same key-sorted canonical
 * serialization — that the exported constants form a genuine
 * key/signature/payload triple.
 */

const base64ToBytes = (value: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(atob(value), (char) => char.charCodeAt(0)) as Uint8Array<ArrayBuffer>;

const utf8 = (value: string): Uint8Array<ArrayBuffer> =>
  new TextEncoder().encode(value) as Uint8Array<ArrayBuffer>;

const SIGN_ALG = { name: "RSA-PSS", hash: "SHA-256" } as const;
const SIGN_OPTIONS: RsaPssParams = { name: "RSA-PSS", saltLength: 32 };

async function importVerificationKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "spki",
    base64ToBytes(LICENSE_PUBLIC_KEY_SPKI),
    SIGN_ALG,
    false,
    ["verify"],
  );
}

describe("licenseKeys — public verification material", () => {
  it("exports a well-formed RSA public key importable for RSA-PSS verification", async () => {
    // RSA-2048 SubjectPublicKeyInfo always starts with this base64 prefix.
    expect(
      LICENSE_PUBLIC_KEY_SPKI.startsWith("MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A"),
    ).toBe(true);
    const key = await importVerificationKey();
    expect(key.algorithm.name).toBe("RSA-PSS");
    expect((key.algorithm as { hash?: { name: string } }).hash?.name).toBe("SHA-256");
    expect(key.extractable).toBe(false);
    expect(key.usages).toEqual(["verify"]);
  });

  it("exports a 256-byte (RSA-2048) signature fixture", () => {
    expect(base64ToBytes(LICENSE_FIXTURE_SIGNATURE).length).toBe(256);
  });

  it("the fixture signature verifies the fixture payload under the committed key", async () => {
    const key = await importVerificationKey();
    const ok = await crypto.subtle.verify(
      SIGN_OPTIONS,
      key,
      base64ToBytes(LICENSE_FIXTURE_SIGNATURE),
      utf8(canonicalLicenseJson({ ...LICENSE_FIXTURE_PAYLOAD })),
    );
    expect(ok).toBe(true);
  });

  it("verification fails when the payload is tampered with", async () => {
    const key = await importVerificationKey();
    const ok = await crypto.subtle.verify(
      SIGN_OPTIONS,
      key,
      base64ToBytes(LICENSE_FIXTURE_SIGNATURE),
      utf8(
        canonicalLicenseJson({
          ...LICENSE_FIXTURE_PAYLOAD,
          deviceId: "evil-device",
        }),
      ),
    );
    expect(ok).toBe(false);
  });

  it("verification fails on a garbage signature", async () => {
    const key = await importVerificationKey();
    const ok = await crypto.subtle.verify(
      SIGN_OPTIONS,
      key,
      utf8("not-a-signature"),
      utf8(canonicalLicenseJson({ ...LICENSE_FIXTURE_PAYLOAD })),
    );
    expect(ok).toBe(false);
  });

  it("rejects malformed SPKI key material fail-closed", async () => {
    await expect(
      crypto.subtle.importKey(
        "spki",
        utf8("not-a-key"),
        SIGN_ALG,
        false,
        ["verify"],
      ),
    ).rejects.toThrow();
  });
});
