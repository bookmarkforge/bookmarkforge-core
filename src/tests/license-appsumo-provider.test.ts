// @vitest-environment node

import { generateKeyPairSync } from "node:crypto";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  appSumoKeyHash,
  appSumoKeyRecordKey,
  appSumoLicenseCall,
  appSumoProviderConfigured,
  isAppSumoLicenseKey,
  type AppSumoKeyRecord,
} from "../../api/license/_appsumo-provider";
import type { LicenseKeyValueStore } from "../../api/license/_license-kv";
import { createLicenseHandler } from "../../api/license/_license-server";

function memoryStore(seed: Record<string, string> = {}): LicenseKeyValueStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(seed));
  return {
    data,
    async get(key: string) {
      return data.get(key) ?? null;
    },
    async set(key: string, value: string) {
      data.set(key, value);
    },
  };
}

function seedKey(store: LicenseKeyValueStore, key: string, overrides: Partial<AppSumoKeyRecord> = {}): void {
  const record: AppSumoKeyRecord = {
    v: 1,
    status: "active",
    seats: 5,
    createdAt: Date.now(),
    batch: "test",
    ...overrides,
  };
  // memoryStore exposes .data; reach it through a cast for seeding.
  (store as { data?: Map<string, string> }).data?.set(appSumoKeyRecordKey(key), JSON.stringify(record));
}

const KEY = "BMF-AAAAA-BBBBB-CCCCC-DDDDD";
const OTHER_KEY = "BMF-FFFFF-GGGGG-HHHHH-JJJJJ";

describe("appsumo license provider", () => {
  it("routes only prefixed keys", () => {
    expect(isAppSumoLicenseKey(KEY)).toBe(true);
    expect(isAppSumoLicenseKey("B-A499DA-52DE7CA4-F07596W")).toBe(false);
    expect(isAppSumoLicenseKey("whop_key")).toBe(false);
    expect(appSumoKeyHash(KEY)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("reports configured only when a store resolves", () => {
    expect(appSumoProviderConfigured({ store: null })).toBe(false);
    expect(appSumoProviderConfigured({ store: memoryStore() })).toBe(true);
  });

  it("activates, validates and deactivates a seat end to end", async () => {
    const store = memoryStore();
    seedKey(store, KEY);

    const activate = await appSumoLicenseCall({ store }, "activate", { license_key: KEY, instance_name: "device-1" });
    expect(activate.activated).toBe(true);
    expect(activate.seat_token).toBeTruthy();
    expect(activate.license?.activations).toBe(1);

    // Re-activating the same device does not consume a new seat.
    const again = await appSumoLicenseCall({ store }, "activate", { license_key: KEY, instance_name: "device-1" });
    expect(again.license?.activations).toBe(1);

    const validate = await appSumoLicenseCall({ store }, "validate", { license_key: KEY, instance_name: "device-1" });
    expect(validate.valid).toBe(true);

    // A device that never activated cannot validate.
    const stranger = await appSumoLicenseCall({ store }, "validate", { license_key: KEY, instance_name: "device-9" });
    expect(stranger.valid).toBe(false);

    // Wrong seat token cannot deactivate.
    const badToken = await appSumoLicenseCall({ store }, "deactivate", {
      license_key: KEY,
      instance_name: "device-1",
      seat_token: "wrong",
    });
    expect(badToken.deactivated).toBe(false);

    const deactivate = await appSumoLicenseCall({ store }, "deactivate", {
      license_key: KEY,
      instance_name: "device-1",
      seat_token: activate.seat_token,
    });
    expect(deactivate.deactivated).toBe(true);

    const after = await appSumoLicenseCall({ store }, "validate", { license_key: KEY, instance_name: "device-1" });
    expect(after.valid).toBe(false);
  });

  it("enforces the seat limit", async () => {
    const store = memoryStore();
    seedKey(store, KEY, { seats: 2 });

    await appSumoLicenseCall({ store }, "activate", { license_key: KEY, instance_name: "d1" });
    await appSumoLicenseCall({ store }, "activate", { license_key: KEY, instance_name: "d2" });
    const third = await appSumoLicenseCall({ store }, "activate", { license_key: KEY, instance_name: "d3" });

    expect(third.activated).toBe(false);
    expect(third.error).toMatch(/limit/i);
    expect(third.license?.activations).toBe(2);
    expect(third.license?.limit).toBe(2);
  });

  it("rejects unknown and revoked keys", async () => {
    const store = memoryStore();
    seedKey(store, KEY, { status: "revoked" });

    const revoked = await appSumoLicenseCall({ store }, "activate", { license_key: KEY, instance_name: "d1" });
    expect(revoked.activated).toBe(false);
    expect(revoked.status).toBe("revoked");

    const unknown = await appSumoLicenseCall({ store }, "activate", { license_key: OTHER_KEY, instance_name: "d1" });
    expect(unknown.activated).toBe(false);
    expect(unknown.status).toBe("invalid");
  });

  it("keeps seat state isolated per key", async () => {
    const store = memoryStore();
    seedKey(store, KEY);
    seedKey(store, OTHER_KEY);

    await appSumoLicenseCall({ store }, "activate", { license_key: KEY, instance_name: "shared-device" });
    const other = await appSumoLicenseCall({ store }, "validate", { license_key: OTHER_KEY, instance_name: "shared-device" });
    expect(other.valid).toBe(false);
  });

  it("never stores the raw key — only its hash", async () => {
    const store = memoryStore();
    seedKey(store, KEY);
    await appSumoLicenseCall({ store }, "activate", { license_key: KEY, instance_name: "d1" });

    for (const k of store.data.keys()) {
      expect(k).not.toContain(KEY);
      expect(k).toContain(appSumoKeyHash(KEY));
    }
  });
});

describe("license handler AppSumo routing", () => {
  function makeHandler(store: LicenseKeyValueStore) {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "der" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    return {
      handler: createLicenseHandler({
        privateKey,
        appSumoStore: store,
        whopApiKey: "",
        whopApiUrl: "http://127.0.0.1:9/unreachable",
      }),
      privateKey,
    };
  }

  function mockReqRes(body: unknown, url = "/api/license/activate") {
    const req = Readable.from([JSON.stringify(body)]) as unknown as Record<string, unknown>;
    req.method = "POST";
    req.url = url;
    req.headers = {};
    req.socket = { remoteAddress: "127.0.0.1" };
    const headers = new Map<string, string>();
    const res = {
      statusCode: 0,
      headers: {} as Record<string, string>,
      body: "",
      writableEnded: false,
      setHeader(name: string, value: string) {
        this.headers[name.toLowerCase()] = value;
      },
      writeHead(code: number) {
        this.statusCode = code;
      },
      end(chunk?: string) {
        this.body = chunk ?? "";
        this.writableEnded = true;
      },
    };
    return { req, res };
  }

  it("activates a BMF- key through the HTTP handler without Whop", async () => {
    const store = memoryStore();
    seedKey(store, KEY);
    const { handler } = makeHandler(store);
    const { req, res } = mockReqRes({ license_key: KEY, instance_name: "web-device" });

    await handler(req as never, res as never);

    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.body) as { payload: { deviceId: string }; signature: string; seatToken?: string };
    expect(parsed.payload.deviceId).toBe("web-device");
    expect(parsed.seatToken).toBeTruthy();
    expect(parsed.signature.length).toBeGreaterThan(100);
  });

  it("still reports health ok with only the AppSumo provider configured", async () => {
    const store = memoryStore();
    const { handler } = makeHandler(store);
    const req = { method: "GET", url: "/api/license/health" } as never;
    const res = {
      statusCode: 0,
      writableEnded: false,
      setHeader() {},
      writeHead(code: number) {
        this.statusCode = code;
      },
      end(chunk?: string) {
        this.body = chunk ?? "";
        this.writableEnded = true;
      },
      body: "",
    };
    await handler(req, res as never);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ status: "ok" });
  });
});
