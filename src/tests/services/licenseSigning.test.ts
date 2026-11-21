// src/tests/services/licenseSigning.test.ts
//
// Client-side license-state VERIFICATION. The signing private key no longer
// ships in the bundle (see server/src/license-signing.ts); these tests prove
// the committed PUBLIC key verifies real signatures via the committed
// fixture (produced by the matching private key), and that tampering breaks
// verification.

import { describe, test, expect, afterEach, vi } from "vitest";
import {
  verifyLicensePayload,
  verifyLicenseSignature,
  canonicalLicenseJson,
  resetLicenseVerifyCache,
  type LicensePayload,
} from "../../services/licenseSigning";
import {
  LICENSE_FIXTURE_PAYLOAD,
  LICENSE_FIXTURE_SIGNATURE,
  LICENSE_PUBLIC_KEY_SPKI,
} from "../../services/licenseKeys";
import ciKeypair from "../fixtures/license-ci-keypair.json";

const basePayload = (): LicensePayload => ({
  v: 1,
  deviceId: LICENSE_FIXTURE_PAYLOAD.deviceId,
  validatedAt: LICENSE_FIXTURE_PAYLOAD.validatedAt,
  expiresAt: LICENSE_FIXTURE_PAYLOAD.expiresAt,
  activationsLeft: LICENSE_FIXTURE_PAYLOAD.activationsLeft,
  instanceId: LICENSE_FIXTURE_PAYLOAD.instanceId,
});

describe("licenseSigning (verification-only)", () => {
  afterEach(() => {
    resetLicenseVerifyCache();
  });

  test("the committed public key verifies the committed fixture signature", async () => {
    expect(
      await verifyLicensePayload(basePayload(), LICENSE_FIXTURE_SIGNATURE),
    ).toBe(true);
  });

  test("verifyLicenseSignature accepts an explicitly supplied public key", async () => {
    expect(
      await verifyLicenseSignature(
        basePayload(),
        LICENSE_FIXTURE_SIGNATURE,
        LICENSE_PUBLIC_KEY_SPKI,
      ),
    ).toBe(true);
  });

  test("verification fails on a tampered payload field", async () => {
    const tampered: LicensePayload = {
      ...basePayload(),
      // Hand-edited to extend the offline window.
      validatedAt: Date.now(),
    };
    expect(await verifyLicensePayload(tampered, LICENSE_FIXTURE_SIGNATURE)).toBe(false);
  });

  test("verification fails when expiresAt is changed", async () => {
    const tampered: LicensePayload = {
      ...basePayload(),
      expiresAt: 9_999_999_999_999,
    };
    expect(await verifyLicensePayload(tampered, LICENSE_FIXTURE_SIGNATURE)).toBe(false);
  });

  test("verification fails on a garbage signature", async () => {
    expect(
      await verifyLicensePayload(basePayload(), "not-a-signature"),
    ).toBe(false);
  });

  test("explicit-key verification fails closed on malformed key material", async () => {
    expect(
      await verifyLicenseSignature(
        basePayload(),
        LICENSE_FIXTURE_SIGNATURE,
        "not-a-public-key",
      ),
    ).toBe(false);
  });

  test("verification is false for a valid signature over different data", async () => {
    const other: LicensePayload = {
      ...basePayload(),
      deviceId: "device-2",
    };
    expect(await verifyLicensePayload(other, LICENSE_FIXTURE_SIGNATURE)).toBe(false);
  });

  test("canonical serialization is independent of key insertion order", () => {
    const a: LicensePayload = {
      v: 1,
      deviceId: "device-1",
      validatedAt: 1,
      expiresAt: 2,
      activationsLeft: 3,
      instanceId: "inst-1",
    };
    const b: LicensePayload = {
      instanceId: "inst-1",
      activationsLeft: 3,
      expiresAt: 2,
      validatedAt: 1,
      deviceId: "device-1",
      v: 1,
    };
    expect(canonicalLicenseJson(a)).toBe(canonicalLicenseJson(b));
  });

  test("VITE_LICENSE_PUBLIC_KEY_SPKI overrides the committed verification key", async () => {
    // CI E2E builds inject the throwaway test public key so the production
    // signing private key never has to be a CI secret. The fixture signature
    // was produced by the fixture's matching (test-only) private key.
    vi.stubEnv("VITE_LICENSE_PUBLIC_KEY_SPKI", ciKeypair.publicKeySpki);
    resetLicenseVerifyCache();
    try {
      expect(
        await verifyLicensePayload(
          ciKeypair.fixturePayload as LicensePayload,
          ciKeypair.fixtureSignature,
        ),
      ).toBe(true);
      // And the production fixture must NOT verify under the CI key.
      expect(await verifyLicensePayload(basePayload(), LICENSE_FIXTURE_SIGNATURE)).toBe(false);
    } finally {
      vi.unstubAllEnvs();
      resetLicenseVerifyCache();
    }
  });

  test("an empty VITE_LICENSE_PUBLIC_KEY_SPKI falls back to the committed key", async () => {
    vi.stubEnv("VITE_LICENSE_PUBLIC_KEY_SPKI", "   ");
    resetLicenseVerifyCache();
    try {
      expect(await verifyLicensePayload(basePayload(), LICENSE_FIXTURE_SIGNATURE)).toBe(true);
    } finally {
      vi.unstubAllEnvs();
      resetLicenseVerifyCache();
    }
  });

  test("undefined optional fields are omitted from the canonical form", () => {
    const withExpiry = basePayload();
    const withoutExpiry: LicensePayload = {
      v: 1,
      deviceId: "device-1",
      validatedAt: 1_700_000_000_000,
      activationsLeft: 3,
      instanceId: "inst-1",
    };
    const json = canonicalLicenseJson(withoutExpiry);
    expect(json).not.toContain("expiresAt");
    expect(json).toContain("\"validatedAt\"");
    expect(json).toContain("\"deviceId\"");
    // The with-expiry payload has a DIFFERENT canonical form.
    expect(canonicalLicenseJson(withExpiry)).not.toBe(json);
  });
});
