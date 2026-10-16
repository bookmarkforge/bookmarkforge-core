// @vitest-environment node

import { constants, createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  bindLicenseDevice,
  boundLicenseDevices,
  DEFAULT_LICENSE_SEATS,
  unbindLicenseDevice,
} from "../../server/src/license-seats";
import {
  canonicalLicenseJson,
  signLicensePayload,
} from "../../server/src/license-signing";

describe("license signing", () => {
  it("signs a canonical payload that verifies with the matching RSA public key", () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "der" },
    });

    const payload = {
      v: 1 as const,
      deviceId: "device-001",
      validatedAt: 1_790_000_000_000,
      instanceId: "instance-001",
    };

    const signature = signLicensePayload(payload, privateKey);

    const verifier = createVerify("sha256");
    verifier.update(canonicalLicenseJson(payload));
    verifier.end();

    expect(
      verifier.verify(
        {
          key: publicKey,
          padding: constants.RSA_PKCS1_PSS_PADDING,
          saltLength: 32,
        },
        Buffer.from(signature, "base64"),
      ),
    ).toBe(true);
  });
});

describe("five-device license seats", () => {
  it("binds exactly five distinct devices and rejects the sixth", () => {
    let metadata: Record<string, unknown> = {};

    for (let i = 1; i <= DEFAULT_LICENSE_SEATS; i += 1) {
      const result = bindLicenseDevice(metadata, `device-${i}`);
      expect(result.added).toBe(true);
      expect(result.atLimit).toBe(false);
      metadata = result.metadata;
    }

    expect(boundLicenseDevices(metadata)).toEqual([
      "device-1",
      "device-2",
      "device-3",
      "device-4",
      "device-5",
    ]);

    const sixth = bindLicenseDevice(metadata, "device-6");
    expect(sixth.added).toBe(false);
    expect(sixth.atLimit).toBe(true);
    expect(sixth.metadata).toEqual(metadata);
  });

  it("does not consume a seat when the same device activates again", () => {
    const first = bindLicenseDevice({}, "device-1");
    const second = bindLicenseDevice(first.metadata, "device-1");

    expect(second.added).toBe(false);
    expect(second.atLimit).toBe(false);
    expect(second.bound).toEqual(["device-1"]);
    expect(second.metadata).toEqual(first.metadata);
  });

  it("removes one device and promotes the next device safely", () => {
    let metadata: Record<string, unknown> = {};
    for (let i = 1; i <= 5; i += 1) {
      metadata = bindLicenseDevice(metadata, `device-${i}`).metadata;
    }

    // Unbind promotes the lowest bm:* seat into instance_name and frees its
    // slot — it does not compact the remaining seats.
    const afterFirst = unbindLicenseDevice(metadata, "device-1");
    expect(afterFirst.instance_name).toBe("device-2");
    expect(afterFirst["bm:1"]).toBeUndefined();
    expect(afterFirst["bm:2"]).toBe("device-3");
    expect(afterFirst["bm:3"]).toBe("device-4");
    expect(afterFirst["bm:4"]).toBe("device-5");

    // Rebinding reuses the lowest free slot (bm:1), restoring the 5-seat
    // capacity; boundLicenseDevices reports keys in metadata insertion
    // order, so the rebound device lands after the untouched seats.
    const rebound = bindLicenseDevice(afterFirst, "device-6");
    expect(rebound.added).toBe(true);
    expect(rebound.metadata["bm:1"]).toBe("device-6");
    // boundLicenseDevices returns metadata insertion order, which the
    // unbind delete/re-add shuffle makes unstable — the contract is the
    // SET of bound devices (and the full 5-seat capacity), not its order.
    expect([...boundLicenseDevices(rebound.metadata)].sort()).toEqual([
      "device-2",
      "device-3",
      "device-4",
      "device-5",
      "device-6",
    ]);

    // Capacity is restored: a further device is at the wall again.
    const sixth = bindLicenseDevice(rebound.metadata, "device-7");
    expect(sixth.added).toBe(false);
    expect(sixth.atLimit).toBe(true);
  });
});
