import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { webcrypto } from "node:crypto";

/**
 * SecureStorage error-path coverage — targets the branches that the main
 * suite leaves uncovered (ciphertext corruption, legacy formats, quota
 * exceeded, WebCrypto-unavailable fail-closed, DOMException detection,
 * purge cursor logic, init-retry after a rejected initPromise).
 *
 * Uses REAL node webcrypto (like the H5 suite) so AES-GCM authentication
 * failures are genuinely exercised — a corrupt ciphertext must throw.
 *
 * NOTE: the `import.meta.env.PROD` arm of isTestEnv() cannot be covered in
 * Vitest (Vite statically inlines it to `false` under MODE=test); that
 * branch is guarded by the source-scan regression test
 * (src/tests/security/p2-secure-storage-prod-guard.regression.test.ts).
 */

const mockObjectStore = {
  put: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
  clear: vi.fn(),
  openCursor: vi.fn(),
  createIndex: vi.fn(),
  index: vi.fn(),
};
const mockTransaction = {
  objectStore: vi.fn(() => mockObjectStore),
  abort: vi.fn(),
  complete: vi.fn(),
  oncomplete: null as (() => void) | null,
  onerror: null as (() => void) | null,
  onabort: null as (() => void) | null,
};
const mockIndexedDB = {
  open: vi.fn(),
};

function finishMockTransaction(): void {
  const oncomplete = mockTransaction.oncomplete;
  mockTransaction.oncomplete = null;
  mockTransaction.onerror = null;
  mockTransaction.onabort = null;
  oncomplete?.();
}

vi.mock("../../utils/indexedDB", () => ({
  getIndexedDB: vi.fn(() => mockIndexedDB),
}));
vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

function createRequest(result: any = undefined) {
  return { result, error: null, onsuccess: null, onerror: null } as any;
}

/** Sets up a Map-backed IDB mock: put/get/delete round-trip the store. */
function setupMockDb(store: Map<string, any>) {
  mockIndexedDB.open.mockImplementation(() => {
    const req = createRequest(mockDb);
    req.result = mockDb;
    Promise.resolve().then(() => {
      req.onsuccess?.({ target: { result: mockDb } });
    });
    return req;
  });
  mockObjectStore.put.mockImplementation((data: any) => {
    store.set(data.id, data.value);
    const req = createRequest();
    Promise.resolve().then(() => {
      req.onsuccess?.();
      finishMockTransaction();
    });
    return req;
  });
  mockObjectStore.get.mockImplementation((key: string) => {
    const req = createRequest(
      store.has(key) ? { id: key, value: store.get(key) } : undefined,
    );
    Promise.resolve().then(() => {
      req.onsuccess?.();
      finishMockTransaction();
    });
    return req;
  });
  mockObjectStore.delete.mockImplementation((key: string) => {
    store.delete(key);
    const req = createRequest();
    Promise.resolve().then(() => {
      req.onsuccess?.();
      finishMockTransaction();
    });
    return req;
  });
  mockObjectStore.clear.mockImplementation(() => {
    store.clear();
    const req = createRequest();
    Promise.resolve().then(() => {
      req.onsuccess?.();
      finishMockTransaction();
    });
    return req;
  });
  // Default: empty store. Individual tests override to model existing records.
  mockObjectStore.openCursor.mockImplementation(() => {
    const req = createRequest(null);
    Promise.resolve().then(() =>
      req.onsuccess?.({ target: { result: null } }),
    );
    return req;
  });
}

const mockDb: any = {
  objectStoreNames: { contains: vi.fn(() => true) },
  createObjectStore: vi.fn(() => mockObjectStore),
  transaction: vi.fn(() => mockTransaction),
  close: vi.fn(),
};

let secureStorage: any;
let SecureStorageClass: any;

async function loadModule() {
  vi.resetModules();
  const mod = await import("../../services/SecureStorage");
  secureStorage = mod.secureStorage;
  SecureStorageClass = mod.SecureStorage;
  (secureStorage as any).deviceKey = null;
  (secureStorage as any).deviceKeyPromise = null;
  (secureStorage as any).initPromise = null;
  (secureStorage as any).db = null;
  (secureStorage as any).retryCount = 0;
}

async function makeJwk(): Promise<string> {
  const key = await webcrypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
  return JSON.stringify(await webcrypto.subtle.exportKey("jwk", key));
}

/** Production-path harness: real webcrypto + NODE_ENV=production. */
async function prodHarness() {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubGlobal("crypto", webcrypto as any);
  await loadModule();
  const { getIndexedDB } = await import("../../utils/indexedDB");
  (getIndexedDB as any).mockReturnValue(mockIndexedDB);
  localStorage.clear();
}

describe("SecureStorage error paths — ciphertext corrupto (production)", () => {
  beforeEach(prodHarness);
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("invalid base64 in ciphertext → getSecret throws Failed to decrypt", async () => {
    const store = new Map<string, any>();
    setupMockDb(store);
    localStorage.setItem("bmf_device_key_jwk", await makeJwk());
    // Corrupt record: not valid base64, so fromBase64() throws inside decryptValue.
    store.set("k", "!!!not-base64!!!");

    await expect(secureStorage.getSecret("k")).rejects.toThrow(
      "Failed to decrypt secret",
    );
  });

  it("ciphertext corrupto (byte alterado) → fallo de auth AES-GCM", async () => {
    const store = new Map<string, any>();
    setupMockDb(store);
    localStorage.setItem("bmf_device_key_jwk", await makeJwk());
    await secureStorage.setSecret("k", "top-secret");

    // Flip a character inside the base64 payload (ciphertext region).
    const original = store.get("k");
    const corrupted =
      original[0] === "A" ? "B" + original.slice(1) : "A" + original.slice(1);
    expect(corrupted).not.toBe(original);
    store.set("k", corrupted);

    await expect(secureStorage.getSecret("k")).rejects.toThrow(
      "Failed to decrypt secret",
    );
  });

  it("JWK corrupto en localStorage → DEVICE_KEY_CORRUPT se re-lanza (encrypt + decrypt)", async () => {
    const store = new Map<string, any>();
    setupMockDb(store);
    localStorage.setItem("bmf_device_key_jwk", "{not-a-jwk");

    // encryptValue must rethrow DEVICE_KEY_CORRUPT unchanged (fail closed).
    await expect(secureStorage.setSecret("k", "v")).rejects.toMatchObject({
      name: "DEVICE_KEY_CORRUPT",
    });

    // Same for decryptValue when a ciphertext is present.
    store.set("k2", "c2lnaHQ=");
    await expect(secureStorage.getSecret("k2")).rejects.toMatchObject({
      name: "DEVICE_KEY_CORRUPT",
    });
  });

  it("key ausente con registros cifrados existentes → DEVICE_KEY_MISSING", async () => {
    const store = new Map<string, any>();
    setupMockDb(store);
    // Non-metadata encrypted record exists, but no device key anywhere.
    store.set("some_secret", "c2lnaHQ=");
    // hasEncryptedSecretRecords must see the non-metadata record.
    mockObjectStore.openCursor.mockImplementation(() => {
      const req = createRequest(null);
      Promise.resolve().then(() => {
        req.result = {
          value: { id: "some_secret" },
          continue: () => {},
        };
        req.onsuccess?.({ target: { result: req.result } });
      });
      return req;
    });

    await expect(secureStorage.getSecret("some_secret")).rejects.toMatchObject({
      name: "DEVICE_KEY_MISSING",
    });
  });

  it("vault locked with a wrapped device key → DEVICE_KEY_WRAPPED is preserved", async () => {
    const store = new Map<string, any>();
    setupMockDb(store);
    store.set("bmf_device_key_wrapped", "v5:wrapped-device-key");
    store.set("locked_secret", "ciphertext");

    await expect(secureStorage.getSecret("locked_secret")).rejects.toMatchObject({
      name: "DEVICE_KEY_WRAPPED",
    });
  });

  it("generic crypto.subtle.encrypt failure → Failed to encrypt secret", async () => {
    const store = new Map<string, any>();
    setupMockDb(store);
    localStorage.setItem("bmf_device_key_jwk", await makeJwk());
    // Prime the device key in memory, then make encrypt fail.
    await secureStorage.setSecret("probe", "x");

    // Spy + restore in `finally` so the tampering never leaks to later
    // suites (vi.unstubAllGlobals() does NOT undo own-property overrides
    // on the shared node:webcrypto object).
    const spy = vi
      .spyOn(crypto.subtle as any, "encrypt")
      .mockRejectedValue(new Error("boom"));
    try {
      await expect(secureStorage.setSecret("k", "v")).rejects.toThrow(
        "Failed to encrypt secret",
      );
    } finally {
      spy.mockRestore();
    }
  });
});

describe("SecureStorage error paths — formato legacy (fallbacks pre-H5)", () => {
  beforeEach(prodHarness);
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    // Defensive: restore any rawGet/getSecret spies even if an assertion
    // threw mid-test, so they cannot leak into later tests in this suite.
    vi.restoreAllMocks();
  });

  it("JWK legacy en IDB (__device_key__) se migra a localStorage al usarse", async () => {
    const store = new Map<string, any>();
    setupMockDb(store);
    store.set("__device_key__", await makeJwk());

    await secureStorage.setSecret("k", "top-secret");
    // Legacy key migrated: now in localStorage, removed from IDB.
    expect(localStorage.getItem("bmf_device_key_jwk")).toBeTruthy();
    expect(store.has("__device_key__")).toBe(false);
    // And the secret round-trips with the migrated key.
    expect(await secureStorage.getSecret("k")).toBe("top-secret");
  });

  it("unwrap on NON-wrapped vault → falls back to getDeviceKey (legacy)", async () => {
    const store = new Map<string, any>();
    setupMockDb(store);
    localStorage.setItem("bmf_device_key_jwk", await makeJwk());

    const key = await secureStorage.unwrapDeviceKeyWithPassword("hunter2");
    expect(key.algorithm.name).toBe("AES-GCM");
  });

  it("getVerificationToken falls back to the legacy (device-key) format when the raw does not exist", async () => {
    const store = new Map<string, any>();
    setupMockDb(store);
    localStorage.setItem("bmf_device_key_jwk", await makeJwk());

    // rawGet returns null (no raw H5 token) → legacy fallback through the
    // device-key layer (getSecret). Both are spies: rawGet and getSecret
    // read the SAME IDB record, so the fallback is only reachable by
    // controlling them independently.
    const rawGetSpy = vi
      .spyOn(secureStorage, "rawGet")
      .mockResolvedValue(null);
    const getSecretSpy = vi
      .spyOn(secureStorage, "getSecret")
      .mockResolvedValue("v4:legacy-token");

    expect(await secureStorage.getVerificationToken()).toBe("v4:legacy-token");
    expect(getSecretSpy).toHaveBeenCalledWith("vault_verification");
    rawGetSpy.mockRestore();
    getSecretSpy.mockRestore();
  });

  it("getRecoveryDataRaw falls back to the legacy (device-key) format when the raw does not exist", async () => {
    const store = new Map<string, any>();
    setupMockDb(store);
    localStorage.setItem("bmf_device_key_jwk", await makeJwk());

    const rawGetSpy = vi
      .spyOn(secureStorage, "rawGet")
      .mockResolvedValue(null);
    const getSecretSpy = vi
      .spyOn(secureStorage, "getSecret")
      .mockResolvedValue("v4:legacy-recovery");

    expect(await secureStorage.getRecoveryDataRaw()).toBe("v4:legacy-recovery");
    expect(getSecretSpy).toHaveBeenCalledWith("recovery_data");
    rawGetSpy.mockRestore();
    getSecretSpy.mockRestore();
  });
});

describe("SecureStorage error paths — isTestEnv() fallback", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("NODE_ENV=test → bypass de cifrado: se almacena verbatim", async () => {
    vi.stubEnv("NODE_ENV", "test");
    await loadModule();
    const store = new Map<string, any>();
    setupMockDb(store);

    await secureStorage.setSecret("k", "my-api-key");
    expect(store.get("k")).toBe("my-api-key");
    expect(await secureStorage.getSecret("k")).toBe("my-api-key");
  });

  it("NODE_ENV=production → encryption active: never plaintext in store", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubGlobal("crypto", webcrypto as any);
    await loadModule();
    const { getIndexedDB } = await import("../../utils/indexedDB");
    (getIndexedDB as any).mockReturnValue(mockIndexedDB);
    localStorage.clear();
    localStorage.setItem("bmf_device_key_jwk", await makeJwk());
    const store = new Map<string, any>();
    setupMockDb(store);

    await secureStorage.setSecret("k", "my-api-key");
    expect(store.get("k")).not.toBe("my-api-key");
  });
});

describe("SecureStorage error paths — quota-exceeded / localStorage no disponible", () => {
  beforeEach(prodHarness);
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("setItem throws QuotaExceededError → the key stays in memory only, no crash", async () => {
    const store = new Map<string, any>();
    setupMockDb(store);
    const spy = vi
      .spyOn(localStorage, "setItem")
      .mockImplementation(() => {
        throw new DOMException("quota", "QuotaExceededError");
      });

    // New installation: generateKey → exportKey → write JWK (throws, swallowed).
    await secureStorage.setSecret("k", "top-secret");
    expect(store.get("k")).not.toBe("top-secret");
    // In-memory key still decrypts within this session.
    expect(await secureStorage.getSecret("k")).toBe("top-secret");
    expect(spy).toHaveBeenCalled();
  });

  it("getItem throws → readKeyJwkFromLocalStorage returns null (legacy/generate fallback)", async () => {
    const store = new Map<string, any>();
    setupMockDb(store);
    vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });

    await secureStorage.setSecret("k", "top-secret");
    expect(await secureStorage.getSecret("k")).toBe("top-secret");
  });
});

describe("SecureStorage error paths — WebCrypto no disponible (fail-closed)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("encryptValue throws when crypto.subtle does not exist", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubGlobal("crypto", {} as any);
    await loadModule();
    const store = new Map<string, any>();
    setupMockDb(store);

    await expect(secureStorage.setSecret("k", "v")).rejects.toThrow(
      /Web Crypto unavailable|Failed to encrypt/i,
    );
    expect(store.has("k")).toBe(false);
  });

  it("decryptValue throws when crypto.subtle does not exist", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubGlobal("crypto", {} as any);
    await loadModule();
    const store = new Map<string, any>();
    setupMockDb(store);
    store.set("k", "c2lnaHQ=");

    await expect(secureStorage.getSecret("k")).rejects.toThrow(
      /Web Crypto unavailable/,
    );
  });

  it("wrapDeviceKeyWithPassword throws when crypto.subtle does not exist", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubGlobal("crypto", {} as any);
    await loadModule();
    const store = new Map<string, any>();
    setupMockDb(store);

    await expect(
      secureStorage.wrapDeviceKeyWithPassword("hunter2"),
    ).rejects.toThrow(/Web Crypto unavailable/);
  });
});

describe("SecureStorage error paths — corruption detection (hasSecret)", () => {
  beforeEach(prodHarness);
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("hasSecret re-throws DOMException DataError (store corruption)", async () => {
    setupMockDb(new Map());
    mockObjectStore.get.mockImplementation(() => {
      const req = createRequest();
      Promise.resolve().then(() => {
        req.error = new DOMException("bad data", "DataError");
        req.onerror?.();
      });
      return req;
    });

    await expect(secureStorage.hasSecret("k")).rejects.toBeInstanceOf(
      DOMException,
    );
  });

  it("hasEncryptedSecretRecords=true when an encrypted non-metadata record exists", async () => {
    const store = new Map<string, any>();
    setupMockDb(store);
    store.set("real_secret", "c2lnaHQ=");
    mockObjectStore.openCursor.mockImplementation(() => {
      const req = createRequest(null);
      let first = true;
      Promise.resolve().then(() => {
        if (first) {
          req.result = { value: { id: "real_secret" }, continue: () => {} };
          first = false;
        }
        req.onsuccess?.({ target: { result: req.result } });
      });
      return req;
    });

    // With a non-metadata record and no key anywhere → DEVICE_KEY_MISSING.
    await expect(secureStorage.getSecret("real_secret")).rejects.toMatchObject({
      name: "DEVICE_KEY_MISSING",
    });
  });
});

describe("SecureStorage error paths — purgeExpiredPendingKeys", () => {
  beforeEach(prodHarness);
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("purge deletes ONLY the expired pending_api_key and skips other records", async () => {
    setupMockDb(new Map());
    const mockIndex = {
      openCursor: vi.fn(),
    };
    mockObjectStore.index.mockReturnValue(mockIndex);

    const deleteSpy = vi.fn();
    mockIndex.openCursor.mockImplementation(() => {
      const req = createRequest(null);
      let step = 0;
      Promise.resolve().then(() => {
        if (step === 0) {
          req.result = {
            value: { id: "pending_api_key", createdAt: Date.now() - 10 * 86400000 },
            delete: deleteSpy,
            continue: () => {
              step = 1;
              req.result = {
                value: { id: "other_secret", createdAt: Date.now() - 10 * 86400000 },
                delete: vi.fn(),
                continue: () => {
                  step = 2;
                  req.result = null;
                  req.onsuccess?.({ target: { result: null } });
                  finishMockTransaction();
                },
              };
              req.onsuccess?.({ target: { result: req.result } });
            },
          };
        } else if (step === 2) {
          req.result = null;
        }
        req.onsuccess?.({ target: { result: req.result } });
      });
      return req;
    });

    await secureStorage.purgeExpiredPendingKeys();
    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(mockObjectStore.index).toHaveBeenCalledWith("createdAt");
  });

  it("error de escaneo en purge → logger.warn, sin lanzar", async () => {
    setupMockDb(new Map());
    const mockIndex = { openCursor: vi.fn() };
    mockObjectStore.index.mockReturnValue(mockIndex);
    mockIndex.openCursor.mockImplementation(() => {
      const req = createRequest(null);
      Promise.resolve().then(() => {
        req.onerror?.();
      });
      return req;
    });

    const { logger } = await import("../../utils/logger");
    await expect(secureStorage.purgeExpiredPendingKeys()).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });
});

describe("SecureStorage error paths — aliases and restore helpers", () => {
  beforeEach(prodHarness);
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("restoreWrappedDeviceKeyBlob(null) removes the wrapped blob", async () => {
    const store = new Map<string, any>();
    setupMockDb(store);
    store.set("bmf_device_key_wrapped", "v4:wrapped");
    (secureStorage as any).deviceKey = null;

    await secureStorage.restoreWrappedDeviceKeyBlob(null);
    expect(store.has("bmf_device_key_wrapped")).toBe(false);
  });

  it("restoreWrappedDeviceKeyBlob(blob) restores and re-materializes deviceKeyPromise", async () => {
    const store = new Map<string, any>();
    setupMockDb(store);
    (secureStorage as any).deviceKey = { name: "AES-GCM" };

    await secureStorage.restoreWrappedDeviceKeyBlob("v4:new-wrapper");
    expect(store.get("bmf_device_key_wrapped")).toBe("v4:new-wrapper");
    // deviceKey present → promise re-materialized from it (ternary true arm).
    expect((secureStorage as any).deviceKeyPromise).not.toBeNull();
  });

  it("restoreVerificationToken(null) borra el token raw", async () => {
    const store = new Map<string, any>();
    setupMockDb(store);
    store.set("vault_verification", "v4:token");

    await secureStorage.restoreVerificationToken(null);
    expect(store.has("vault_verification")).toBe(false);
  });

  it("get<T> returns null when the secret does not exist; get/set/remove round-trip", async () => {
    const store = new Map<string, any>();
    setupMockDb(store);
    localStorage.setItem("bmf_device_key_jwk", await makeJwk());

    expect(await secureStorage.get("missing")).toBeNull();

    // set with a JSON value (non-string branch) and with a string.
    await secureStorage.set("obj", { a: 1 });
    await secureStorage.set("str", "plain");
    expect(await secureStorage.get("obj")).toEqual({ a: 1 });
    expect(await secureStorage.get("str")).toBe("plain");

    await secureStorage.remove("obj");
    expect(store.has("obj")).toBe(false);
  });

  it("close() with rejected initPromise does not throw and closes db", async () => {
    const store = new Map<string, any>();
    setupMockDb(store);
    const rejected = Promise.reject(new Error("pending init failed"));
    rejected.catch(() => { /* INTENTIONAL SILENCE: the test asserts the rejection separately. */ });
    (secureStorage as any).initPromise = rejected;
    (secureStorage as any).db = mockDb;

    await secureStorage.close();
    expect((secureStorage as any).initPromise).toBeNull();
    expect(mockDb.close).toHaveBeenCalled();
  });

  it("close() with resolved initPromise: awaits it and then closes", async () => {
    const store = new Map<string, any>();
    setupMockDb(store);
    (secureStorage as any).initPromise = Promise.resolve(mockDb);
    (secureStorage as any).db = mockDb;

    await secureStorage.close();
    expect(mockDb.close).toHaveBeenCalled();
    expect((secureStorage as any).db).toBeNull();
  });
});

describe("SecureStorage error paths — init retry after rejected initPromise", () => {
  beforeEach(prodHarness);
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("rejected initPromise → the next init retries and recovers", async () => {
    const store = new Map<string, any>();
    setupMockDb(store);
    // Simulate a failed background init still cached.
    const rejected = Promise.reject(new Error("previous init failed"));
    rejected.catch(() => { /* INTENTIONAL SILENCE: the test asserts the rejection separately. */ });
    (secureStorage as any).initPromise = rejected;

    // NODE_ENV=production here, so the stored value is ciphertext; the
    // important part is that init recovered and the round-trip works.
    await secureStorage.setSecret("k", "v");
    expect(store.get("k")).not.toBe("v");
    expect(await secureStorage.getSecret("k")).toBe("v");
  });
});

describe("SecureStorage error paths — bounded logging (logRateLimited)", () => {
  beforeEach(prodHarness);
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("device-key JWK persistence failure → bounded warning; key stays usable in memory", async () => {
    const { logger } = await import("../../utils/logger");
    const store = new Map<string, any>();
    setupMockDb(store);
    const spy = vi
      .spyOn(localStorage, "setItem")
      .mockImplementation(() => {
        throw new DOMException("quota", "QuotaExceededError");
      });
    (logger.warn as any).mockClear();

    // Fresh install: generateKey → exportKey → write JWK to localStorage
    // (throws, swallowed by writeKeyJwkToLocalStorage → bounded warning).
    await secureStorage.setSecret("k", "top-secret");
    expect(store.get("k")).not.toBe("top-secret");
    expect(await secureStorage.getSecret("k")).toBe("top-secret");
    expect(spy).toHaveBeenCalled();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("[secure-storage-device-key-localstorage]"),
      // DOMException is not instanceof Error here, so the code falls back to
      // String(error) → "QuotaExceededError: quota".
      expect.objectContaining({ error: expect.stringContaining("quota") }),
    );
  });

  it("wrapDeviceKeyWithPassword: plaintext localStorage copy removal fails → bounded warning", async () => {
    const { logger } = await import("../../utils/logger");
    const store = new Map<string, any>();
    setupMockDb(store);
    localStorage.setItem("bmf_device_key_jwk", await makeJwk());
    const removeSpy = vi
      .spyOn(localStorage, "removeItem")
      .mockImplementation(() => {
        throw new DOMException("denied", "SecurityError");
      });
    (logger.warn as any).mockClear();

    await secureStorage.wrapDeviceKeyWithPassword("hunter2");
    expect(removeSpy).toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("[secure-storage-device-key-plaintext-remove]"),
      expect.objectContaining({ error: expect.stringContaining("denied") }),
    );
  });

  it("wrapDeviceKeyWithPassword: legacy IDB record removal fails → bounded warning", async () => {
    const { logger } = await import("../../utils/logger");
    const store = new Map<string, any>();
    setupMockDb(store);
    localStorage.setItem("bmf_device_key_jwk", await makeJwk());
    // The wrapped ciphertext write succeeds, but the legacy plaintext record
    // removal fails → rawDelete rejects → bounded warning.
    mockObjectStore.delete.mockImplementation(() => {
      const req = createRequest();
      Promise.resolve().then(() => {
        req.error = new DOMException("blocked", "AbortError");
        req.onerror?.();
      });
      return req;
    });
    (logger.warn as any).mockClear();

    await secureStorage.wrapDeviceKeyWithPassword("hunter2");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("[secure-storage-device-key-legacy-remove]"),
      expect.objectContaining({ error: expect.stringContaining("blocked") }),
    );
  });

  it("legacy device-key migration: IDB record removal fails → bounded warning", async () => {
    const { logger } = await import("../../utils/logger");
    const store = new Map<string, any>();
    setupMockDb(store);
    store.set("__device_key__", await makeJwk());
    mockObjectStore.delete.mockImplementation(() => {
      const req = createRequest();
      Promise.resolve().then(() => {
        req.error = new DOMException("blocked", "AbortError");
        req.onerror?.();
      });
      return req;
    });
    (logger.warn as any).mockClear();

    await secureStorage.setSecret("k", "v");
    // The legacy key was still migrated to localStorage (write succeeded
    // before the failing delete), and the secret round-trips.
    expect(localStorage.getItem("bmf_device_key_jwk")).toBeTruthy();
    expect(await secureStorage.getSecret("k")).toBe("v");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("[secure-storage-device-key-migration-remove]"),
      expect.objectContaining({ error: expect.stringContaining("blocked") }),
    );
  });

  it("clearAll: device-key recovery copy removal fails → bounded warning", async () => {
    const { logger } = await import("../../utils/logger");
    const store = new Map<string, any>();
    setupMockDb(store);
    localStorage.setItem("bmf_device_key_jwk", await makeJwk());
    const removeSpy = vi
      .spyOn(localStorage, "removeItem")
      .mockImplementation(() => {
        throw new DOMException("denied", "SecurityError");
      });
    (logger.warn as any).mockClear();

    await secureStorage.clearAll();
    expect(removeSpy).toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("[secure-storage-device-key-clear-recovery]"),
      expect.objectContaining({ error: expect.stringContaining("denied") }),
    );
  });
});
