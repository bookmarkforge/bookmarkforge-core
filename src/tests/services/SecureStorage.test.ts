import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { webcrypto } from "node:crypto";

let mockDb: any;
const mockObjectStore = {
  put: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
  clear: vi.fn(),
  openCursor: vi.fn(),
  createIndex: vi.fn(),
};
const mockTransaction = {
  objectStore: vi.fn(() => mockObjectStore),
  oncomplete: null as (() => void) | null,
  onerror: null as (() => void) | null,
  onabort: null as (() => void) | null,
};
const mockIndexedDB = {
  open: vi.fn(),
};

vi.mock("../../utils/indexedDB", () => ({
  getIndexedDB: vi.fn(() => mockIndexedDB),
}));

function createRequest(result: any = undefined) {
  let successHandler: ((...args: any[]) => unknown) | null = null;
  const req: any = { result, error: null, onerror: null };
  Object.defineProperty(req, "onsuccess", {
    configurable: true,
    get: () =>
      (...args: any[]) => {
        const value = successHandler?.(...args);
        const oncomplete = mockTransaction.oncomplete;
        mockTransaction.oncomplete = null;
        oncomplete?.();
        return value;
      },
    set: (handler: ((...args: any[]) => unknown) | null) => {
      successHandler = handler;
    },
  });
  return req;
}

function setupMockDb() {
  // Re-create all module-level mocks with fresh vi.fn() instances
  Object.assign(mockObjectStore, {
    put: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
    clear: vi.fn(),
    openCursor: vi.fn(),
    createIndex: vi.fn(),
  });

  Object.assign(mockTransaction, {
    objectStore: vi.fn(() => mockObjectStore),
    abort: vi.fn(),
    complete: vi.fn(),
    oncomplete: null,
    onerror: null,
    onabort: null,
  });

  mockDb = {
    objectStoreNames: { contains: vi.fn(() => true) },
    createObjectStore: vi.fn(() => mockObjectStore),
    transaction: vi.fn(() => mockTransaction),
    close: vi.fn(),
  };

  Object.assign(mockIndexedDB, {
    open: vi.fn(),
  });

  mockIndexedDB.open.mockImplementation(() => {
    const req = createRequest(mockDb);
    // Set the result property so that request.result returns the db object
    req.result = mockDb;
    Promise.resolve().then(() => {
      req.onsuccess?.({ target: { result: mockDb } });
    });
    return req;
  });

  // Set up objectStore methods to return requests that resolve successfully
  mockObjectStore.put.mockImplementation((_data) => {
    const req = createRequest();
    Promise.resolve().then(() => {
      req.onsuccess?.({ target: { result: undefined } });
    });
    return req;
  });

  mockObjectStore.get.mockImplementation((_key) => {
    const req = createRequest();
    // Return undefined (not found) by default for hasSecret checks
    Promise.resolve().then(() => {
      req.onsuccess?.({ target: { result: undefined } });
    });
    return req;
  });

  mockObjectStore.delete.mockImplementation((_key) => {
    const req = createRequest();
    Promise.resolve().then(() => {
      req.onsuccess?.({ target: { result: undefined } });
    });
    return req;
  });

  mockObjectStore.clear.mockImplementation(() => {
    const req = createRequest();
    Promise.resolve().then(() => {
      req.onsuccess?.({ target: { result: undefined } });
    });
    return req;
  });

  // Default cursor behavior represents an empty store. Individual tests can
  // override this implementation to model existing encrypted records.
  mockObjectStore.openCursor.mockImplementation(() => {
    const req = createRequest(null);
    Promise.resolve().then(() => {
      req.onsuccess?.({ target: { result: null } });
    });
    return req;
  });
}

function setupMockDbError() {
  mockIndexedDB.open.mockImplementation(() => {
    const req = createRequest(null);
    req.error = new Error("DB error");
    setTimeout(() => {
      req.onerror?.();
    }, 0);
    return req;
  });
}

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

let secureStorage: any;
let SecureStorageClass: any;

beforeAll(async () => {
  const mod = await import("../../services/SecureStorage");
  secureStorage = mod.secureStorage;
  SecureStorageClass = mod.SecureStorage;
});


describe("SecureStorage", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { getIndexedDB } = await import("../../utils/indexedDB");
    (getIndexedDB as any).mockReturnValue(mockIndexedDB);
    (secureStorage as any).initPromise = null;
    (secureStorage as any).db = null;
    (secureStorage as any).retryCount = 0;
    (secureStorage as any).isInitializing = false;
  });

  describe("init", () => {
    it("should handle concurrent initializations", async () => {
      setupMockDb();
      // Call init multiple times concurrently
      const p1 = secureStorage.setSecret("k1", "v1");
      const p2 = secureStorage.setSecret("k2", "v2");

      const putReq1 = createRequest();
      const putReq2 = createRequest();
      mockObjectStore.put
        .mockReturnValueOnce(putReq1)
        .mockReturnValueOnce(putReq2);

      setTimeout(() => {
        putReq1.onsuccess?.();
      }, 10);
      setTimeout(() => {
        putReq2.onsuccess?.();
      }, 20);

      await Promise.all([p1, p2]);
      expect(mockIndexedDB.open).toHaveBeenCalledTimes(1);
    });

    it("should throw if IndexedDB is unavailable", async () => {
      const { getIndexedDB } = await import("../../utils/indexedDB");
      (getIndexedDB as any).mockReturnValue(null);

      await expect(secureStorage.setSecret("k", "v")).rejects.toThrow(
        "IndexedDB not available",
      );
    });

    it("should retry initialization up to MAX_RETRIES", async () => {
      vi.useFakeTimers();
      let attempts = 0;
      mockIndexedDB.open.mockImplementation(() => {
        attempts++;
        const req = createRequest(null);
        req.error = new Error("Open fail");
        setTimeout(() => {
          req.onerror?.();
        }, 0);
        return req;
      });

      const promise = secureStorage.setSecret("k", "v");

      // Attach early reject handler to prevent Node unhandledRejection
      let rejection: any = null;
      promise.catch((err: any) => {
        rejection = err;
      });

      // Advance past all retries (100+200+400 = 700ms)
      await vi.advanceTimersByTimeAsync(1000);

      expect(rejection).toBeInstanceOf(Error);
      expect(attempts).toBe(4); // 1 initial + 3 retries
      await expect(promise).rejects.toThrow();
      vi.useRealTimers();
    });

    it("should recover initialization if the first attempt fails and the next succeeds", async () => {
      let attempts = 0;
      mockIndexedDB.open.mockImplementation(() => {
        attempts++;
        if (attempts === 1) {
          const req = createRequest(null);
          req.error = new Error("First fail");
          Promise.resolve().then(() => {
            req.onerror?.();
          });
          return req;
        } else {
          const db = {
            objectStoreNames: { contains: vi.fn(() => true) },
            createObjectStore: vi.fn(),
            transaction: vi.fn(() => mockTransaction),
            close: vi.fn(),
          };
          const req = createRequest(db);
          Promise.resolve().then(() => {
            req.onsuccess?.({ target: req });
          });
          return req;
        }
      });

      const putReq = createRequest();
      mockObjectStore.put.mockReturnValue(putReq);
      setTimeout(() => {
        putReq.onsuccess?.();
      }, 300); // Ensure it happens AFTER retry

      const promise = secureStorage.setSecret("k", "v");
      await promise;
      expect(attempts).toBe(2);
    });
  });

  describe("setSecret", () => {
    it("should store a secret", async () => {
      setupMockDb();
      const putReq = createRequest();
      mockObjectStore.put.mockReturnValue(putReq);

      const promise = secureStorage.setSecret("key1", "encrypted-value");
      setTimeout(() => {
        putReq.onsuccess?.();
      }, 0);

      await promise;
      expect(mockObjectStore.put).toHaveBeenCalledWith(
        expect.objectContaining({ id: "key1", value: "encrypted-value" }),
      );
    });

    it("should throw if indexedDB fails", async () => {
      setupMockDbError();
      await expect(secureStorage.setSecret("key1", "val")).rejects.toThrow();
    });

    it("should handle an error in the put request", async () => {
      setupMockDb();
      const putReq = createRequest();
      putReq.onerror = null; // will be set by service
      mockObjectStore.put.mockReturnValue(putReq);

      const promise = secureStorage.setSecret("key1", "val");
      setTimeout(() => {
        putReq.error = new Error("Put failed");
        putReq.onerror?.();
      }, 0);

      await expect(promise).rejects.toThrow("Put failed");
    });
  });

  describe("getSecret", () => {
    it("should return the stored value", async () => {
      setupMockDb();
      const getReq = createRequest({ id: "key1", value: "stored-value" });
      mockObjectStore.get.mockReturnValue(getReq);

      const promise = secureStorage.getSecret("key1");
      setTimeout(() => {
        getReq.onsuccess?.();
      }, 0);

      const val = await promise;
      expect(val).toBe("stored-value");
    });

    it("should return null if it does not exist", async () => {
      setupMockDb();
      const getReq = createRequest(undefined);
      mockObjectStore.get.mockReturnValue(getReq);

      const promise = secureStorage.getSecret("nonexistent");
      setTimeout(() => {
        getReq.onsuccess?.();
      }, 0);

      const val = await promise;
      expect(val).toBeNull();
    });

    it("should handle an error in the get request", async () => {
      setupMockDb();
      const getReq = createRequest();
      mockObjectStore.get.mockReturnValue(getReq);

      const promise = secureStorage.getSecret("key1");
      setTimeout(() => {
        getReq.error = new Error("Get failed");
        getReq.onerror?.();
      }, 0);

      await expect(promise).rejects.toThrow("Get failed");
    });
  });

  describe("deleteSecret", () => {
    it("should delete a secret", async () => {
      setupMockDb();
      const delReq = createRequest();
      mockObjectStore.delete.mockReturnValue(delReq);

      const promise = secureStorage.deleteSecret("key1");
      setTimeout(() => {
        delReq.onsuccess?.();
      }, 0);

      await expect(promise).resolves.toBeUndefined();
    });

    it("should handle an error in the delete request", async () => {
      setupMockDb();
      const delReq = createRequest();
      mockObjectStore.delete.mockReturnValue(delReq);

      const promise = secureStorage.deleteSecret("key1");
      setTimeout(() => {
        delReq.error = new Error("Delete failed");
        delReq.onerror?.();
      }, 0);

      await expect(promise).rejects.toThrow("Delete failed");
    });
  });

  describe("hasSecret", () => {
    it("should return true if it exists", async () => {
      setupMockDb();
      const getReq = createRequest({ id: "key1", value: "val" });
      mockObjectStore.get.mockReturnValue(getReq);

      const promise = secureStorage.hasSecret("key1");
      setTimeout(() => {
        getReq.onsuccess?.();
      }, 0);

      const exists = await promise;
      expect(exists).toBe(true);
    });

    it("should return false if it does not exist", async () => {
      setupMockDb();
      const getReq = createRequest(undefined);
      mockObjectStore.get.mockReturnValue(getReq);

      const promise = secureStorage.hasSecret("nonexistent");
      setTimeout(() => {
        getReq.onsuccess?.();
      }, 0);

      const exists = await promise;
      expect(exists).toBe(false);
    });
  });

  describe("clearAll", () => {
    it("should clear all secrets", async () => {
      setupMockDb();
      const clearReq = createRequest();
      mockObjectStore.clear.mockReturnValue(clearReq);

      const promise = secureStorage.clearAll();
      setTimeout(() => {
        clearReq.onsuccess?.();
      }, 0);

      await expect(promise).resolves.toBeUndefined();
    });

    it("should handle an error in the clear request", async () => {
      setupMockDb();
      const clearReq = createRequest();
      mockObjectStore.clear.mockReturnValue(clearReq);

      const promise = secureStorage.clearAll();
      setTimeout(() => {
        clearReq.error = new Error("Clear failed");
        clearReq.onerror?.();
      }, 0);

      await expect(promise).rejects.toThrow("Clear failed");
    });
  });

  describe("migrateFromLocalStorage", () => {
    it("should migrate data from localStorage to IndexedDB", async () => {
      setupMockDb();

      const getReq = createRequest();
      getReq.result = undefined;
      const putReq = createRequest();

      mockObjectStore.get.mockImplementation(() => {
        setTimeout(() => {
          getReq.onsuccess?.({ target: getReq });
        }, 0);
        return getReq;
      });
      mockObjectStore.put.mockImplementation(() => {
        setTimeout(() => {
          putReq.onsuccess?.({ target: putReq });
        }, 0);
        return putReq;
      });

      const ls = {
        store: {} as Record<string, string>,
        getItem: vi.fn((key: string) => ls.store[key] || null),
        setItem: vi.fn((key: string, value: string) => {
          ls.store[key] = value;
        }),
        removeItem: vi.fn((key: string) => {
          delete ls.store[key];
        }),
        clear: vi.fn(() => {
          ls.store = {};
        }),
      };
      vi.stubGlobal("localStorage", ls);
      if (typeof window !== "undefined") {
        Object.defineProperty(window, "localStorage", {
          value: ls,
          configurable: true,
        });
      }

      ls.setItem("local-key", "local-value");

      const result = await secureStorage.migrateFromLocalStorage(
        "local-key",
        "indexed-key",
      );
      expect(result).toBe(true);
      expect(ls.getItem("local-key")).toBeNull();
    });

    it("should return false when there is no data in localStorage", async () => {
      setupMockDb();
      const localStorageMock = {
        store: {} as Record<string, string>,
        getItem: vi.fn((key: string) => localStorageMock.store[key] || null),
        setItem: vi.fn((key: string, value: string) => {
          localStorageMock.store[key] = value;
        }),
        removeItem: vi.fn((key: string) => {
          delete localStorageMock.store[key];
        }),
        clear: vi.fn(() => {
          localStorageMock.store = {};
        }),
      };
      vi.stubGlobal("localStorage", localStorageMock);
      if (typeof window !== "undefined") {
        Object.defineProperty(window, "localStorage", {
          value: localStorageMock,
          configurable: true,
        });
      }

      const result = await secureStorage.migrateFromLocalStorage(
        "local-key",
        "indexed-key",
      );
      expect(result).toBe(false);
    });

    it("should return true and clear localStorage when already migrated", async () => {
      setupMockDb();

      const localStorageMock = {
        store: { "local-key": "local-value" } as Record<string, string>,
        getItem: vi.fn((key: string) => localStorageMock.store[key] || null),
        setItem: vi.fn((key: string, value: string) => {
          localStorageMock.store[key] = value;
        }),
        removeItem: vi.fn((key: string) => {
          delete localStorageMock.store[key];
        }),
        clear: vi.fn(() => {
          localStorageMock.store = {};
        }),
      };
      vi.stubGlobal("localStorage", localStorageMock);
      if (typeof window !== "undefined") {
        Object.defineProperty(window, "localStorage", {
          value: localStorageMock,
          configurable: true,
        });
      }

      const getReq = createRequest();
      getReq.result = {
        id: "indexed-key",
        value: "local-value",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const putReq = createRequest();

      mockObjectStore.get.mockImplementation(() => {
        setTimeout(() => {
          getReq.onsuccess?.({ target: getReq });
        }, 0);
        return getReq;
      });
      mockObjectStore.put.mockImplementation(() => {
        setTimeout(() => {
          putReq.onsuccess?.({ target: putReq });
        }, 0);
        return putReq;
      });

      const result = await secureStorage.migrateFromLocalStorage(
        "local-key",
        "indexed-key",
      );
      expect(result).toBe(true);
      expect(localStorageMock.removeItem).toHaveBeenCalledWith("local-key");
    });
  });

  describe("pre-encrypted storage (no auto-encryption)", () => {
    it("should store and retrieve the exact value without transforming it", async () => {
      setupMockDb();

      // Simulate a v2: ciphertext string as EncryptionService would produce
      const preEncryptedValue = "v2:U2FsdGVkX1+abcdefghijklmnop==";
      let storedRecord: any;

      mockObjectStore.put.mockImplementation((data: any) => {
        storedRecord = data;
        const req = createRequest();
        setTimeout(() => req.onsuccess?.(), 0);
        return req;
      });

      mockObjectStore.get.mockImplementation(() => {
        const req = createRequest(storedRecord);
        setTimeout(
          () => req.onsuccess?.({ target: { result: storedRecord } }),
          0,
        );
        return req;
      });

      await secureStorage.setSecret("encrypted_db_key", preEncryptedValue);
      const retrieved = await secureStorage.getSecret("encrypted_db_key");

      // Value must round-trip exactly — no encryption, no stripping, no re-encoding
      expect(retrieved).toBe(preEncryptedValue);
    });

    it("should store plaintext strings verbatim (caller's responsibility to encrypt)", async () => {
      setupMockDb();

      const plaintext = "my-api-key-sk-proj-1234567890abcdef";
      let storedRecord: any;

      mockObjectStore.put.mockImplementation((data: any) => {
        storedRecord = data;
        const req = createRequest();
        setTimeout(() => req.onsuccess?.(), 0);
        return req;
      });

      mockObjectStore.get.mockImplementation(() => {
        const req = createRequest(storedRecord);
        setTimeout(
          () => req.onsuccess?.({ target: { result: storedRecord } }),
          0,
        );
        return req;
      });

      await secureStorage.setSecret("api_key", plaintext);
      const retrieved = await secureStorage.getSecret("api_key");

      // Plaintext goes in, plaintext comes out — no auto-encryption applied
      expect(retrieved).toBe(plaintext);
    });

    it("should preserve the v2: prefix on ciphertext (not strip or re-encrypt)", async () => {
      setupMockDb();

      const ciphertext = "v2:U2FsdGVkX1/abcdefghijklmnopqrstuvwxyz0123456789";
      let storedRecord: any;

      mockObjectStore.put.mockImplementation((data: any) => {
        storedRecord = data;
        const req = createRequest();
        setTimeout(() => req.onsuccess?.(), 0);
        return req;
      });

      mockObjectStore.get.mockImplementation(() => {
        const req = createRequest(storedRecord);
        setTimeout(
          () => req.onsuccess?.({ target: { result: storedRecord } }),
          0,
        );
        return req;
      });

      await secureStorage.setSecret("vault_crypto_key", ciphertext);
      const retrieved = await secureStorage.getSecret("vault_crypto_key");

      expect(retrieved).toBe(ciphertext);
      expect(retrieved).toMatch(/^v2:/);
    });

    it("should not double-encrypt a value that is already encrypted", async () => {
      setupMockDb();

      // First encryption pass (as done by EncryptionService)
      const firstPass = "v2:U2FsdGVkX1AAAAAABBBBBBBBB";
      let storedRecord: any;

      mockObjectStore.put.mockImplementation((data: any) => {
        storedRecord = data;
        const req = createRequest();
        setTimeout(() => req.onsuccess?.(), 0);
        return req;
      });

      mockObjectStore.get.mockImplementation(() => {
        const req = createRequest(storedRecord);
        setTimeout(
          () => req.onsuccess?.({ target: { result: storedRecord } }),
          0,
        );
        return req;
      });

      // Store the already-encrypted value
      await secureStorage.setSecret("encrypted_api_key", firstPass);

      // If SecureStorage were double-encrypting, the stored value would differ.
      // Retrieve and verify it is byte-for-byte identical.
      const retrieved = await secureStorage.getSecret("encrypted_api_key");
      expect(retrieved).toBe(firstPass);

      // The stored record must NOT contain another v2: wrapping
      // (no "v2:v2:" double prefix)
      expect(storedRecord.value).not.toMatch(/^v2:v2:/);
    });

    it("should store JSON strings verbatim without parsing or re-serializing", async () => {
      setupMockDb();

      const jsonValue = JSON.stringify({
        version: 2,
        createdAt: 1700000000000,
        isActive: true,
      });
      let storedRecord: any;

      mockObjectStore.put.mockImplementation((data: any) => {
        storedRecord = data;
        const req = createRequest();
        setTimeout(() => req.onsuccess?.(), 0);
        return req;
      });

      mockObjectStore.get.mockImplementation(() => {
        const req = createRequest(storedRecord);
        setTimeout(
          () => req.onsuccess?.({ target: { result: storedRecord } }),
          0,
        );
        return req;
      });

      await secureStorage.setSecret("encryption_key_metadata", jsonValue);
      const retrieved = await secureStorage.getSecret(
        "encryption_key_metadata",
      );

      // Must be identical string, not re-serialized (which might reorder keys)
      expect(retrieved).toBe(jsonValue);
    });
  });

  describe("close", () => {
    it("should call init twice without reopening the DB", async () => {
      setupMockDb();
      const putReq1 = createRequest();
      const putReq2 = createRequest();
      mockObjectStore.put
        .mockReturnValueOnce(putReq1)
        .mockReturnValueOnce(putReq2);

      const p1 = secureStorage.setSecret("k1", "v1");
      setTimeout(() => {
        putReq1.onsuccess?.();
      }, 0);
      await p1;

      expect(mockIndexedDB.open).toHaveBeenCalledTimes(1);

      const p2 = secureStorage.setSecret("k2", "v2");
      setTimeout(() => {
        putReq2.onsuccess?.();
      }, 0);
      await p2;

      expect(mockIndexedDB.open).toHaveBeenCalledTimes(1);
    });

    it("should return false from hasSecret when the DB fails", async () => {
      const { getIndexedDB } = await import("../../utils/indexedDB");
      (getIndexedDB as any).mockReturnValue(null);

      const result = await secureStorage.hasSecret("x");
      expect(result).toBe(false);
    });

    it("should close the connection without a prior init", async () => {
      await secureStorage.close();
      expect(secureStorage.isReady()).toBe(false);
    });

    it("should reset and then be able to reinitialize", async () => {
      setupMockDb();
      const putReq = createRequest();
      mockObjectStore.put.mockImplementation(() => {
        setTimeout(() => {
          putReq.onsuccess?.({ target: putReq });
        }, 0);
        return putReq;
      });
      await secureStorage.setSecret("k", "v");
      expect(secureStorage.isReady()).toBe(true);

      await secureStorage.reset();
      expect(secureStorage.isReady()).toBe(false);

      const putReq2 = createRequest();
      mockObjectStore.put.mockImplementation(() => {
        setTimeout(() => {
          putReq2.onsuccess?.({ target: putReq2 });
        }, 0);
        return putReq2;
      });
      await secureStorage.setSecret("k2", "v2");
      expect(secureStorage.isReady()).toBe(true);
    });

    it("should throw in close if db.close fails", async () => {
      setupMockDb();
      const getReq = createRequest({ id: "k", value: "v" });
      mockObjectStore.get.mockReturnValue(getReq);
      const initPromise = secureStorage.hasSecret("x");
      setTimeout(() => {
        getReq.onsuccess?.();
      }, 0);
      await initPromise;
      mockDb.close = vi.fn(() => {
        throw new Error("Close error");
      });
      await secureStorage.close();
    });

    it("should handle onupgradeneeded when the store does not exist", async () => {
      setupMockDb();
      mockIndexedDB.open.mockImplementation(() => {
        const req = createRequest(mockDb);
        req.result = mockDb;
        const db = {
          objectStoreNames: { contains: vi.fn(() => false) },
          createObjectStore: vi.fn(() => mockObjectStore),
        };
        Promise.resolve().then(() => {
          req.onupgradeneeded?.({ target: { result: db } } as any);
        });
        Promise.resolve().then(() => {
          req.onsuccess?.({ target: { result: mockDb } });
        });
        return req;
      });
      const putReq = createRequest();
      mockObjectStore.put.mockImplementation(() => {
        setTimeout(() => {
          putReq.onsuccess?.({ target: putReq });
        }, 0);
        return putReq;
      });
      await secureStorage.setSecret("k", "v");
      expect(mockIndexedDB.open).toHaveBeenCalled();
    });

    it("should migrate with an init error and return false", async () => {
      const { getIndexedDB } = await import("../../utils/indexedDB");
      (getIndexedDB as any).mockReturnValue(null);
      const ls = {
        getItem: vi.fn(() => "val"),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
      };
      vi.stubGlobal("localStorage", ls);
      if (typeof window !== "undefined") {
        Object.defineProperty(window, "localStorage", {
          value: ls,
          configurable: true,
        });
      }

      const result = await secureStorage.migrateFromLocalStorage("k", "ik");
      expect(result).toBe(false);
    });

    it("should close the connection", async () => {
      setupMockDb();
      const getReq = createRequest({ id: "k", value: "v" });
      mockObjectStore.get.mockReturnValue(getReq);
      const initPromise = secureStorage.hasSecret("x");
      setTimeout(() => {
        getReq.onsuccess?.();
      }, 0);
      await initPromise;
      await secureStorage.close();
      expect(mockDb.close).toHaveBeenCalled();
    });
  });

  describe("encryption at rest (production path)", () => {
    beforeEach(async () => {
      // This suite intentionally exercises production encryption. Restore the
      // real storage globals first: an earlier migration test may have left a
      // mock whose clear() is intentionally a no-op.
      vi.unstubAllGlobals();
      localStorage.clear();
      vi.stubEnv("NODE_ENV", "production");
      const xor = (buf: Uint8Array, key: Uint8Array) =>
        buf.map((b, i) => b ^ key[i % key.length]!);
      const simKey = () => new Uint8Array(32).fill(7);
      const simSubtle = {
        generateKey: async () =>
          ({
            algorithm: { name: "AES-GCM" },
            extractable: false,
            type: "secret",
            usages: ["encrypt", "decrypt"],
          }) as unknown as CryptoKey,
        importKey: async () =>
          ({
            algorithm: { name: "AES-GCM" },
            extractable: false,
            type: "secret",
            usages: ["encrypt", "decrypt"],
          }) as unknown as CryptoKey,
        exportKey: async () => ({ k: "AAAA", alg: "A256GCM", kty: "oct" }),
        encrypt: async (_a: any, _k: CryptoKey, data: BufferSource) => {
          const plain = new Uint8Array(
            (data as Uint8Array).buffer,
            (data as Uint8Array).byteOffset,
            (data as Uint8Array).byteLength,
          );
          return xor(plain, simKey()).buffer;
        },
        decrypt: async (_a: any, _k: CryptoKey, data: BufferSource) => {
          const ct = new Uint8Array(
            (data as Uint8Array).buffer,
            (data as Uint8Array).byteOffset,
            (data as Uint8Array).byteLength,
          );
          return xor(ct, simKey()).buffer;
        },
      };
      const simCrypto = {
        getRandomValues: <T extends ArrayBufferView | null>(a: T): T =>
          webcrypto.getRandomValues(a as any),
        subtle: simSubtle,
      };
      // Re-import SecureStorage so it binds to the simulated crypto global.
      // The vi.mock factories (logger, indexedDB) are re-applied on reset.
      vi.resetModules();
      vi.stubGlobal("crypto", simCrypto);
      const mod = await import("../../services/SecureStorage");
      secureStorage = mod.secureStorage;
      SecureStorageClass = mod.SecureStorage;
      (secureStorage as any).deviceKey = null;
      (secureStorage as any).deviceKeyPromise = null;
      (secureStorage as any).initPromise = null;
      (secureStorage as any).db = null;
      (secureStorage as any).retryCount = 0;
    });

    afterEach(() => {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    });

    it("should encrypt and decrypt a secret (never plaintext in the store)", async () => {
      setupMockDb();
      let lastPut: any = null;
      mockObjectStore.put.mockImplementation((data: any) => {
        lastPut = data;
        const req = createRequest();
        Promise.resolve().then(() => req.onsuccess?.());
        return req;
      });
      await secureStorage.setSecret("keyA", "top-secret");

      expect(lastPut.value).not.toBe("top-secret");
      expect(typeof lastPut.value).toBe("string");

      mockObjectStore.get.mockImplementation((key: string) => {
        const req = createRequest({
          id: key,
          value: key === "keyA" ? lastPut.value : undefined,
        });
        Promise.resolve().then(() => req.onsuccess?.());
        return req;
      });
      const result = await secureStorage.getSecret("keyA");
      expect(result).toBe("top-secret");
    });

    it("clears the key-generation timeout after success and error", async () => {
      vi.useFakeTimers();
      try {
        await (secureStorage as any).generateDeviceKeySafe();
        expect(vi.getTimerCount()).toBe(0);

        const currentCrypto = globalThis.crypto;
        vi.stubGlobal("crypto", {
          ...currentCrypto,
          subtle: {
            ...currentCrypto.subtle,
            generateKey: vi.fn().mockRejectedValue(new Error("generation failed")),
          },
        });

        await expect(
          (secureStorage as any).generateDeviceKeySafe(),
        ).rejects.toThrow("generation failed");
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it("must reject a __plain__ marker in production", async () => {
      setupMockDb();
      const getReq = createRequest({
        id: "keyPlain2",
        value: "__plain__" + btoa("leak"),
      });
      mockObjectStore.get.mockReturnValue(getReq);
      const readPromise = secureStorage.getSecret("keyPlain2");
      setTimeout(() => getReq.onsuccess?.(), 0);
      await expect(readPromise).rejects.toThrow(/plaintext/i);
    });
  });

  // ── Audit H5: master-password wrapping of the device key ────────────
  // Uses REAL node webcrypto (not the XOR simulator) so AES-GCM auth
  // failures are exercised — wrong-password unwrap MUST throw.

  describe("H5 — device key wrapping", () => {
    beforeEach(async () => {
      vi.stubGlobal("crypto", webcrypto as any);
      vi.resetModules();
      const mod = await import("../../services/SecureStorage");
      secureStorage = mod.secureStorage;
      SecureStorageClass = mod.SecureStorage;
      (secureStorage as any).deviceKey = null;
      (secureStorage as any).deviceKeyPromise = null;
      (secureStorage as any).initPromise = null;
      (secureStorage as any).db = null;
      localStorage.clear();
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    // Drive put/get/delete through the mocked IDB backed by a Map.
    function idbCapture(store: Map<string, any>) {
      mockObjectStore.put.mockImplementation((data: any) => {
        store.set(data.id, data.value);
        const req = createRequest();
        Promise.resolve().then(() => req.onsuccess?.());
        return req;
      });
      mockObjectStore.get.mockImplementation((key: string) => {
        const req = createRequest(
          store.has(key) ? { id: key, value: store.get(key) } : undefined,
        );
        Promise.resolve().then(() => req.onsuccess?.());
        return req;
      });
      mockObjectStore.delete.mockImplementation((key: string) => {
        store.delete(key);
        const req = createRequest();
        Promise.resolve().then(() => req.onsuccess?.());
        return req;
      });
    }

    // Real AES-256-GCM JWK: importKey() rejects JWKs with an invalid `k`.
    async function makeJwk(): Promise<string> {
      const key = await webcrypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"],
      );
      return JSON.stringify(await webcrypto.subtle.exportKey("jwk", key));
    }

    it("wrap: el JWK sale de localStorage y queda cifrado en IDB", async () => {
      setupMockDb();
      const store = new Map<string, any>();
      idbCapture(store);
      localStorage.setItem("bmf_device_key_jwk", await makeJwk());
      await secureStorage.wrapDeviceKeyWithPassword("hunter2");

      expect(localStorage.getItem("bmf_device_key_jwk")).toBeNull();
      const blob = store.get("bmf_device_key_wrapped");
      expect(blob).toBeTruthy();
      expect(blob).not.toContain("realjwk");
      // the current session keeps the key in memory
      expect((secureStorage as any).deviceKey).not.toBeNull();
    });

    it("wrap is idempotent", async () => {
      setupMockDb();
      const store = new Map<string, any>();
      idbCapture(store);
      localStorage.setItem("bmf_device_key_jwk", JSON.stringify({ k: "x" }));

      await secureStorage.wrapDeviceKeyWithPassword("hunter2");
      const putCalls = (mockObjectStore.put as any).mock.calls.length;
      await secureStorage.wrapDeviceKeyWithPassword("hunter2");
      expect((mockObjectStore.put as any).mock.calls.length).toBe(putCalls);
    });

    it("unwrap: recovers the same key with the correct password", async () => {
      // NODE_ENV=production in THIS test so setSecret/getSecret
      // run real encryption (Argon2id 128MiB — slow, hence only here).
      vi.stubEnv("NODE_ENV", "production");
      setupMockDb();
      const store = new Map<string, any>();
      idbCapture(store);
      localStorage.setItem("bmf_device_key_jwk", await makeJwk());
      await secureStorage.wrapDeviceKeyWithPassword("hunter2");
      // simulate a fresh start: no key in memory
      (secureStorage as any).deviceKey = null;
      (secureStorage as any).deviceKeyPromise = null;

      const key = await secureStorage.unwrapDeviceKeyWithPassword("hunter2");
      expect(key.algorithm.name).toBe("AES-GCM");

      // The session really encrypts with the unwrapped key (real round-trip
      // Argon2id+AES-GCM; the plaintext never touches the store).
      await secureStorage.setSecret("k", "top-secret");
      const raw = store.get("k");
      expect(raw).not.toBe("top-secret");
      const result = await secureStorage.getSecret("k");
      expect(result).toBe("top-secret");
      vi.unstubAllEnvs();
    });

    it("unwrap with the wrong password fails (real AES-GCM auth)", async () => {
      setupMockDb();
      const store = new Map<string, any>();
      idbCapture(store);
      localStorage.setItem("bmf_device_key_jwk", await makeJwk());
      await secureStorage.wrapDeviceKeyWithPassword("hunter2");
      (secureStorage as any).deviceKey = null;
      (secureStorage as any).deviceKeyPromise = null;

      await expect(
        secureStorage.unwrapDeviceKeyWithPassword("wrong-password"),
      ).rejects.toThrow(/unwrap/i);
    });

    it("guard: getDeviceKey refuses to regenerate/persist when wrapped", async () => {
      setupMockDb();
      const store = new Map<string, any>();
      idbCapture(store);
      localStorage.setItem("bmf_device_key_jwk", await makeJwk());
      await secureStorage.wrapDeviceKeyWithPassword("hunter2");
      (secureStorage as any).deviceKey = null;
      (secureStorage as any).deviceKeyPromise = null;
      localStorage.removeItem("bmf_device_key_jwk");

      await expect(
        (secureStorage as any).getDeviceKey(),
      ).rejects.toThrow(/wrapped|unlock/);
      expect(localStorage.getItem("bmf_device_key_jwk")).toBeNull();
      // no spare new key has been created
      expect(store.has("bmf_device_key_wrapped")).toBe(true);
    });

    it("rewrap: the new password unlocks after rotation", async () => {
      setupMockDb();
      const store = new Map<string, any>();
      idbCapture(store);
      localStorage.setItem("bmf_device_key_jwk", await makeJwk());
      await secureStorage.wrapDeviceKeyWithPassword("old-pw");
      (secureStorage as any).deviceKey = null;
      (secureStorage as any).deviceKeyPromise = null;

      // the new password does not yet unlock the old blob
      await expect(
        secureStorage.unwrapDeviceKeyWithPassword("new-pw"),
      ).rejects.toThrow(/unwrap/i);

      const oldPasswordBytes = new TextEncoder().encode("old-pw");
      const newPasswordBytes = new TextEncoder().encode("new-pw");
      await secureStorage.rewrapDeviceKeyWithPasswordBytes(
        oldPasswordBytes,
        newPasswordBytes,
      );

      // SecureStorage passes private copies to crypto-core; the caller-owned
      // buffers remain available for SecurityVault's rotation cleanup.
      expect(new TextDecoder().decode(oldPasswordBytes)).toBe("old-pw");
      expect(new TextDecoder().decode(newPasswordBytes)).toBe("new-pw");

      const key = await secureStorage.unwrapDeviceKeyWithPassword("new-pw");
      expect(key.algorithm.name).toBe("AES-GCM");
    });

    it("rewrap with the wrong old password fails", async () => {
      setupMockDb();
      const store = new Map<string, any>();
      idbCapture(store);
      localStorage.setItem("bmf_device_key_jwk", await makeJwk());
      await secureStorage.wrapDeviceKeyWithPassword("old-pw");

      await expect(
        secureStorage.rewrapDeviceKeyWithPasswordBytes(
          new TextEncoder().encode("wrong-old"),
          new TextEncoder().encode("new-pw"),
        ),
      ).rejects.toThrow(/re-wrap|mismatch/);
    });

    it("lockDeviceKey discards the in-memory key (guard blocks; re-unwrap recovers)", async () => {
      setupMockDb();
      const store = new Map<string, any>();
      idbCapture(store);
      localStorage.setItem("bmf_device_key_jwk", await makeJwk());
      await secureStorage.wrapDeviceKeyWithPassword("hunter2");

      secureStorage.lockDeviceKey();

      expect((secureStorage as any).deviceKey).toBeNull();
      expect((secureStorage as any).deviceKeyPromise).toBeNull();

      // the getDeviceKey guard blocks all cryptographic operations
      await expect(
        (secureStorage as any).getDeviceKey(),
      ).rejects.toThrow(/unlock/i);

      // the blob stays encrypted in IDB: the correct password re-materializes
      const key = await secureStorage.unwrapDeviceKeyWithPassword("hunter2");
      expect(key.algorithm.name).toBe("AES-GCM");
    });

    it("raw tokens (verification/recovery/flag) do not depend on the device key", async () => {
      setupMockDb();
      const store = new Map<string, any>();
      idbCapture(store);

      await secureStorage.storeVerificationToken("v4:token");
      await secureStorage.setRecoveryDataRaw("v4:recovery");
      await secureStorage.setMasterPasswordConfiguredFlag();

      expect(store.get("vault_verification")).toBe("v4:token");
      expect(store.get("recovery_data")).toBe("v4:recovery");
      expect(store.get("master_password_setup")).toBe("true");
      expect(await secureStorage.getVerificationToken()).toBe("v4:token");
      expect(await secureStorage.getRecoveryDataRaw()).toBe("v4:recovery");
      expect(await secureStorage.hasRecoveryDataRaw()).toBe(true);
      await secureStorage.clearRecoveryDataRaw();
      expect(store.has("recovery_data")).toBe(false);
      expect(await secureStorage.hasRecoveryDataRaw()).toBe(false);
      expect(await secureStorage.isDeviceKeyWrapped()).toBe(false);
    });
  });
});
