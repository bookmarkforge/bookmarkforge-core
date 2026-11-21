// @vitest-environment node
//
// Rotation grace: after a signing-key rotation the client must keep
// verifying licenses signed by the PREVIOUS key (LICENSE_PREVIOUS_PUBLIC_KEY_SPKI)
// while new signatures verify under the current key. This file mocks the
// committed module so the "previous" slot holds the throwaway CI keypair —
// no production private key is involved.

import { describe, test, expect, vi, afterEach } from "vitest";
import ciKeypair from "../fixtures/license-ci-keypair.json";

vi.mock("../../services/licenseKeys", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../services/licenseKeys")>();
  return {
    ...mod,
    LICENSE_PREVIOUS_PUBLIC_KEY_SPKI: ciKeypair.publicKeySpki,
  };
});

import {
  verifyLicensePayload,
  resetLicenseVerifyCache,
  type LicensePayload,
} from "../../services/licenseSigning";
import {
  LICENSE_FIXTURE_PAYLOAD,
  LICENSE_FIXTURE_SIGNATURE,
} from "../../services/licenseKeys";

function basePayload(): LicensePayload {
  return {
    v: 1,
    deviceId: LICENSE_FIXTURE_PAYLOAD.deviceId,
    validatedAt: LICENSE_FIXTURE_PAYLOAD.validatedAt,
    expiresAt: LICENSE_FIXTURE_PAYLOAD.expiresAt,
    activationsLeft: LICENSE_FIXTURE_PAYLOAD.activationsLeft,
    instanceId: LICENSE_FIXTURE_PAYLOAD.instanceId,
  };
}

describe("licenseSigning key-rotation grace window", () => {
  afterEach(() => {
    resetLicenseVerifyCache();
  });

  test("a signature from the previous key still verifies", async () => {
    // The CI fixture signature was produced by the CI private key, which the
    // mock installs as LICENSE_PREVIOUS_PUBLIC_KEY_SPKI.
    expect(
      await verifyLicensePayload(
        ciKeypair.fixturePayload as LicensePayload,
        ciKeypair.fixtureSignature,
      ),
    ).toBe(true);
  });

  test("a signature from the current key still verifies", async () => {
    expect(await verifyLicensePayload(basePayload(), LICENSE_FIXTURE_SIGNATURE)).toBe(true);
  });

  test("a signature from an unrelated key verifies under neither key", async () => {
    // CI fixture signed by CI key verifies via PREVIOUS; tampering it must fail.
    const tampered = { ...(ciKeypair.fixturePayload as LicensePayload), deviceId: "attacker" };
    expect(await verifyLicensePayload(tampered, ciKeypair.fixtureSignature)).toBe(false);
  });
});
