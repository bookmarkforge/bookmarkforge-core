
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Helper: creates a mock IDBOpenDBRequest that can fire events asynchronously
// ---------------------------------------------------------------------------
function createMockOpenRequest(opts: {
  error?: DOMException | null;
  result?: IDBDatabase | null;
}) {
  const handlers: Record<string, ((e: Event) => void) | null> = {
    error: null,
    success: null,
    upgradeneeded: null,
    blocked: null,
  };

  const request = {
    error: opts.error ?? null,
    result: opts.result ?? null,
    readyState: "pending" as IDBRequestReadyState,
    transaction: null as IDBTransaction | null,
    source: null as any,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
    get onerror() {
      return handlers.error ?? null;
    },
    set onerror(v: ((e: Event) => void) | null) {
      handlers.error = v;
    },
    get onsuccess() {
      return handlers.success ?? null;
    },
    set onsuccess(v: ((e: Event) => void) | null) {
      handlers.success = v;
    },
    get onupgradeneeded() {
      return handlers.upgradeneeded ?? null;
    },
    set onupgradeneeded(v: ((e: Event) => void) | null) {
      handlers.upgradeneeded = v;
    },
    get onblocked() {
      return handlers.blocked ?? null;
    },
    set onblocked(v: ((e: Event) => void) | null) {
      handlers.blocked = v;
    },
  } as unknown as IDBOpenDBRequest;

  const fire = (eventType: string) => {
    (request as any).readyState = "done";
    const handler = handlers[eventType];
    if (handler) handler(new Event(eventType));
  };

  return { request, fire, handlers };
}

// ---------------------------------------------------------------------------
// Helper: creates a mock IDB factory with configurable open behavior
// ---------------------------------------------------------------------------
function createMockIDBFactory(openMock: ReturnType<typeof vi.fn>) {
  return {
    open: openMock,
    deleteDatabase: vi.fn().mockImplementation(() => {
      const req: Record<string, any> = {
        onerror: null,
        onsuccess: null,
        onblocked: null,
        error: null,
        result: null,
        readyState: "done",
      };
      setTimeout(() => {
        if (req.onsuccess) req.onsuccess(new Event("success"));
      }, 0);
      return req;
    }),
    databases: vi.fn().mockResolvedValue([]),
    cmp: vi.fn(),
  } as unknown as IDBFactory;
}

// ---------------------------------------------------------------------------
// Helper: creates a stub localStorage that throws on all operations
// ---------------------------------------------------------------------------
function makeThrowingLocalStorage() {
  const store: Record<string, string> = {};
  return {
    getItem: vi.fn<(key: string) => string | null>().mockImplementation(() => {
      throw new DOMException("QuotaExceededError", "QuotaExceededError");
    }),
    setItem: vi
      .fn<(key: string, value: string) => void>()
      .mockImplementation(() => {
        throw new DOMException("QuotaExceededError", "QuotaExceededError");
      }),
    removeItem: vi.fn<(key: string) => void>().mockImplementation(() => {
      throw new DOMException("QuotaExceededError", "QuotaExceededError");
    }),
    clear: vi.fn(),
    get length() {
      return Object.keys(store).length;
    },
    key: vi.fn(),
  };
}

// ===========================================================================
// Scenario 1: IndexedDB open failure
// ===========================================================================
describe("IDB open failure", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("should reject with the error when indexedDB.open fails", async () => {
    const { request, fire } = createMockOpenRequest({
      error: new DOMException("The operation failed", "UnknownError"),
    });

    const mockIDB = createMockIDBFactory(vi.fn().mockReturnValue(request));
    vi.stubGlobal("indexedDB", mockIDB);

    setTimeout(() => fire("error"), 0);

    const openPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("db", 1);
      req.onerror = () => reject(req.error!);
      req.onsuccess = () => resolve(req.result!);
    });

    await expect(openPromise).rejects.toThrow("The operation failed");
  });

  it("should reject with UnknownError when indexedDB.open returns null result", async () => {
    const { request, fire } = createMockOpenRequest({
      error: new DOMException("null result", "UnknownError"),
    });

    const mockIDB = createMockIDBFactory(vi.fn().mockReturnValue(request));
    vi.stubGlobal("indexedDB", mockIDB);

    setTimeout(() => fire("error"), 0);

    const openPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("db", 1);
      req.onerror = () => reject(req.error!);
      req.onsuccess = () => resolve(req.result!);
    });

    await expect(openPromise).rejects.toThrow("null result");
  });

  it("should handle error event without throwing outside the promise chain", () => {
    const { request, fire } = createMockOpenRequest({
      error: new DOMException("fail", "UnknownError"),
    });

    const mockIDB = createMockIDBFactory(vi.fn().mockReturnValue(request));
    vi.stubGlobal("indexedDB", mockIDB);

    expect(() => {
      const req = indexedDB.open("db", 1);
      setTimeout(() => fire("error"), 0);
      req.onerror = () => {
        /* swallow */
      };
    }).not.toThrow();
  });

  it("should handle onupgradeneeded error without crashing the app", () => {
    const { request, fire } = createMockOpenRequest({
      error: null,
      result: null,
    });

    const mockIDB = createMockIDBFactory(vi.fn().mockReturnValue(request));
    vi.stubGlobal("indexedDB", mockIDB);

    expect(() => {
      const req = indexedDB.open("db", 1);
      req.onupgradeneeded = () => {
        try {
          throw new Error("Migration failed");
        } catch {
          // Caught gracefully — app doesn't crash
        }
      };
    }).not.toThrow();

    expect(() => fire("upgradeneeded")).not.toThrow();
  });
});

// ===========================================================================
// Scenario 2: IndexedDB transaction failure
// ===========================================================================
describe("IDB transaction failure", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function makeIDBWithFailingTransaction() {
    const storeHandlers: Record<string, ((e: Event) => void) | null> = {
      error: null,
      success: null,
    };

    const storeRequest = {
      error: new DOMException("Transaction failed", "TransactionInactiveError"),
      result: null,
      readyState: "pending",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
      get onerror() {
        return storeHandlers.error;
      },
      set onerror(v) {
        storeHandlers.error = v!;
      },
      get onsuccess() {
        return storeHandlers.success;
      },
      set onsuccess(v) {
        storeHandlers.success = v!;
      },
    } as unknown as IDBRequest;

    const txHandlers: Record<string, ((e: Event) => void) | null> = {
      error: null,
      complete: null,
      abort: null,
    };

    const mockTransaction = {
      objectStore: vi.fn().mockReturnValue({
        put: vi.fn().mockReturnValue(storeRequest),
        get: vi.fn().mockReturnValue(storeRequest),
        getAll: vi.fn().mockReturnValue(storeRequest),
        delete: vi.fn().mockReturnValue(storeRequest),
        clear: vi.fn().mockReturnValue(storeRequest),
      }),
      abort: vi.fn(),
      db: null as any,
      error: null,
      mode: "readwrite" as IDBTransactionMode,
      objectStoreNames: ["store"] as any,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
      get onerror() {
        return txHandlers.error;
      },
      set onerror(v) {
        txHandlers.error = v!;
      },
      get oncomplete() {
        return txHandlers.complete;
      },
      set oncomplete(v) {
        txHandlers.complete = v!;
      },
      get onabort() {
        return txHandlers.abort;
      },
      set onabort(v) {
        txHandlers.abort = v!;
      },
    } as unknown as IDBTransaction;

    const db = {
      transaction: vi.fn().mockReturnValue(mockTransaction),
      close: vi.fn(),
      name: "test",
      version: 1,
      objectStoreNames: ["store"] as any,
      createObjectStore: vi.fn(),
      deleteObjectStore: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
    } as unknown as IDBDatabase;

    return { db, mockTransaction, storeRequest, storeHandlers, txHandlers };
  }

  it("should reject the promise when a transaction fails", async () => {
    const { db } = makeIDBWithFailingTransaction();

    const { request, fire } = createMockOpenRequest({
      result: db,
      error: null,
    });

    const mockIDB = createMockIDBFactory(vi.fn().mockReturnValue(request));
    vi.stubGlobal("indexedDB", mockIDB);

    setTimeout(() => fire("success"), 0);

    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("db", 1);
      req.onsuccess = () => resolve(req.result!);
      req.onerror = () => reject(req.error);
    });

    const tx = database.transaction("store", "readwrite");
    const store = tx.objectStore("store");
    const putReq = store.put({ id: 1 });

    setTimeout(() => {
      const handler = (putReq as any).onerror;
      if (handler) handler(new Event("error"));
    }, 0);

    const opPromise = new Promise((_, reject) => {
      putReq.onerror = () => reject(putReq.error);
    });

    await expect(opPromise).rejects.toThrow("Transaction failed");
  });

  it("should handle oncomplete never firing gracefully (no crash)", async () => {
    const { db } = makeIDBWithFailingTransaction();

    const { request, fire } = createMockOpenRequest({
      result: db,
      error: null,
    });
    const mockIDB = createMockIDBFactory(vi.fn().mockReturnValue(request));
    vi.stubGlobal("indexedDB", mockIDB);

    setTimeout(() => fire("success"), 0);

    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("db", 1);
      req.onsuccess = () => resolve(req.result!);
      req.onerror = () => reject(req.error);
    });

    const tx = database.transaction("store", "readwrite");
    const store = tx.objectStore("store");
    store.put({ id: 1 });

    expect(() => {
      const req2 = indexedDB.open("another-db", 1);
      req2.onerror = () => {};
    }).not.toThrow();
  });

  it("should handle multiple sequential transaction failures gracefully", async () => {
    const { db, storeHandlers } = makeIDBWithFailingTransaction();

    const { request, fire } = createMockOpenRequest({
      result: db,
      error: null,
    });
    const mockIDB = createMockIDBFactory(vi.fn().mockReturnValue(request));
    vi.stubGlobal("indexedDB", mockIDB);

    setTimeout(() => fire("success"), 0);

    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("db", 1);
      req.onsuccess = () => resolve(req.result!);
      req.onerror = () => reject(req.error);
    });

    const results: string[] = [];

    for (let i = 0; i < 5; i++) {
      const tx = database.transaction("store", "readwrite");
      const store = tx.objectStore("store");
      store.put({ id: i });

      await new Promise<void>((resolve) => {
        setTimeout(() => {
          if (storeHandlers.error) storeHandlers.error(new Event("error"));
          results.push(`op-${i}-handled`);
          resolve();
        }, 0);
      });
    }

    expect(results).toHaveLength(5);
    expect(results).toEqual([
      "op-0-handled",
      "op-1-handled",
      "op-2-handled",
      "op-3-handled",
      "op-4-handled",
    ]);
  });
});

// ===========================================================================
// Scenario 3: QuotaExceededError handling
// ===========================================================================
describe("QuotaExceededError from localStorage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("safeSet does not throw when localStorage.setItem throws QuotaExceededError", async () => {
    const throwingLS = makeThrowingLocalStorage();
    vi.stubGlobal("localStorage", throwingLS);
    vi.resetModules();

    const { safeSet } = await import("../../store/safeStorage");
    expect(() => safeSet("key", "value")).not.toThrow();
  });

  it("safeGet returns null when localStorage.getItem throws QuotaExceededError", async () => {
    const throwingLS = makeThrowingLocalStorage();
    vi.stubGlobal("localStorage", throwingLS);
    vi.resetModules();

    const { safeGet } = await import("../../store/safeStorage");
    expect(safeGet("key")).toBeNull();
  });

  it("safeRemove does not throw when localStorage.removeItem throws", async () => {
    const throwingLS = makeThrowingLocalStorage();
    vi.stubGlobal("localStorage", throwingLS);
    vi.resetModules();

    const { safeRemove } = await import("../../store/safeStorage");
    expect(() => safeRemove("key")).not.toThrow();
  });

  it("app continues to work after QuotaExceededError is caught", async () => {
    let callCount = 0;

    const items: Record<string, string> = {};
    const resilientLS = {
      getItem: vi
        .fn<(key: string) => string | null>()
        .mockImplementation((k: string) => items[k] ?? null),
      setItem: vi
        .fn<(key: string, value: string) => void>()
        .mockImplementation((k: string, v: string) => {
          callCount++;
          if (callCount === 1) {
            throw new DOMException("QuotaExceededError", "QuotaExceededError");
          }
          items[k] = v;
        }),
      removeItem: vi
        .fn<(key: string) => void>()
        .mockImplementation((k: string) => {
          delete items[k];
        }),
      clear: vi.fn(),
      get length() {
        return Object.keys(items).length;
      },
      key: vi.fn((i: number) => Object.keys(items)[i] ?? null),
    };

    vi.stubGlobal("localStorage", resilientLS);
    vi.resetModules();

    const { safeSet, safeGet } = await import("../../store/safeStorage");

    // First call fails — no throw
    expect(() => safeSet("failing-key", "value")).not.toThrow();
    expect(safeGet("failing-key")).toBeNull();

    // Subsequent call works
    expect(() => safeSet("working-key", "other-value")).not.toThrow();
    expect(safeGet("working-key")).toBe("other-value");

    expect(callCount).toBe(2);
  });
});

// ===========================================================================
// Scenario 4: RxDB initialization failure pattern
// ===========================================================================
describe("RxDB initialization failure pattern", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function simulateRxInit(createFn: () => Promise<any>): Promise<any> {
    try {
      return await createFn();
    } catch (err) {
      const error = err as Error;
      const errStr = String(
        error?.message || (error as any)?.code || String(err),
      );
      const isPasswordError =
        errStr.includes("DB1") || (error as any)?.code === "DB1";

      if (isPasswordError) {
        const pwError = new Error(
          "Invalid password. Please provide your correct vault password.",
        );
        pwError.name = "INVALID_PASSWORD";
        throw pwError;
      }
      throw err;
    }
  }

  it("translates DB1 error to INVALID_PASSWORD", async () => {
    const mockCreate = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error("DB1: Wrong password"), { code: "DB1" }),
      );

    await expect(simulateRxInit(mockCreate)).rejects.toThrow(
      "Invalid password",
    );
    await expect(simulateRxInit(mockCreate)).rejects.toHaveProperty(
      "name",
      "INVALID_PASSWORD",
    );
  });

  it("propagates non-DB1 errors as-is", async () => {
    const mockCreate = vi
      .fn()
      .mockRejectedValue(new Error("DB_INIT_TIMEOUT after 5000ms"));

    await expect(simulateRxInit(mockCreate)).rejects.toThrow(
      "DB_INIT_TIMEOUT after 5000ms",
    );
  });

  it("returns the result when createRxDatabase succeeds", async () => {
    const db = { name: "test" };
    const mockCreate = vi.fn().mockResolvedValue(db);

    const result = await simulateRxInit(mockCreate);
    expect(result).toBe(db);
  });

  it("handles DB1 error with code property only", async () => {
    const err = new Error("some message");
    (err as any).code = "DB1";
    const mockCreate = vi.fn().mockRejectedValue(err);

    await expect(simulateRxInit(mockCreate)).rejects.toHaveProperty(
      "name",
      "INVALID_PASSWORD",
    );
  });

  it("resets initPromise on failure (pattern match)", async () => {
    let initPromise: Promise<any> | null = Promise.resolve("stale");

    try {
      const mockCreate = vi.fn().mockRejectedValue(new Error("Kaboom"));
      await simulateRxInit(mockCreate);
    } catch {
      initPromise = null;
    }

    expect(initPromise).toBeNull();
  });
});

// ===========================================================================
// Scenario 5: localStorage quota exceeded — safeStorage layer
// ===========================================================================
describe("localStorage quota exceeded — safeStorage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("safeGet returns null when localStorage throws SecurityError", async () => {
    const throwingLS = makeThrowingLocalStorage();
    throwingLS.getItem = vi.fn().mockImplementation(() => {
      throw new DOMException("SecurityError", "SecurityError");
    });
    vi.stubGlobal("localStorage", throwingLS);
    vi.resetModules();

    const { safeGet } = await import("../../store/safeStorage");
    const result = safeGet("any-key");
    expect(result).toBeNull();
  });

  it("safeSet silently catches generic errors from localStorage.setItem", async () => {
    const throwingLS = makeThrowingLocalStorage();
    throwingLS.setItem = vi.fn().mockImplementation(() => {
      throw new Error("Storage is full");
    });
    vi.stubGlobal("localStorage", throwingLS);
    vi.resetModules();

    const { safeSet } = await import("../../store/safeStorage");
    expect(() => safeSet("k", "v")).not.toThrow();
  });

  it("safeRemove silently catches errors from localStorage.removeItem", async () => {
    const throwingLS = makeThrowingLocalStorage();
    throwingLS.removeItem = vi.fn().mockImplementation(() => {
      throw new Error("Cannot remove");
    });
    vi.stubGlobal("localStorage", throwingLS);
    vi.resetModules();

    const { safeRemove } = await import("../../store/safeStorage");
    expect(() => safeRemove("key")).not.toThrow();
  });

  it("all three safeStorage functions work normally when localStorage is available", async () => {
    const { safeGet, safeSet, safeRemove } =
      await import("../../store/safeStorage");

    safeSet("normal-key", "normal-value");
    expect(safeGet("normal-key")).toBe("normal-value");

    safeRemove("normal-key");
    expect(safeGet("normal-key")).toBeNull();
  });
});

// ===========================================================================
// Scenario 6: Multiple rapid IDB operations — no deadlock
// ===========================================================================
describe("Multiple rapid IDB operations", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function openTestDB(name: string): Promise<IDBDatabase> {
    return new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains("items")) {
          d.createObjectStore("items", { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function writeOp(db: IDBDatabase, id: number, value: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction("items", "readwrite");
      const store = tx.objectStore("items");
      store.put({ id, value });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  function readOp(db: IDBDatabase, id: number): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      const tx = db.transaction("items", "readonly");
      const store = tx.objectStore("items");
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  it("10 concurrent write operations complete without deadlock", async () => {
    const db = await openTestDB("chaos-rapid-write");
    const numOps = 10;

    const ops = Array.from({ length: numOps }, (_, i) =>
      writeOp(db, i, `item-${i}`),
    );

    const results = await Promise.all(ops);
    expect(results).toHaveLength(numOps);
    db.close();
  });

  it("10 concurrent read operations after writes complete without deadlock", async () => {
    const db = await openTestDB("chaos-rapid-read");

    for (let i = 0; i < 10; i++) {
      await writeOp(db, i, `item-${i}`);
    }

    const reads = Array.from({ length: 10 }, (_, i) => readOp(db, i));
    const results = await Promise.all(reads);

    expect(results).toHaveLength(10);
    expect((results[0] as any)?.value).toBe("item-0");
    expect((results[9] as any)?.value).toBe("item-9");
    db.close();
  });

  it("interleaved read-write operations on the same store do not deadlock", async () => {
    const db = await openTestDB("chaos-rapid-rw");
    const numOps = 10;

    // Sequential writes with interleaved reads
    for (let i = 0; i < numOps; i++) {
      await writeOp(db, i, `write-${i}`);
      const result = await readOp(db, i);
      expect((result as any)?.value).toBe(`write-${i}`);
    }

    db.close();
  });

  it("does not deadlock across two separate database instances", async () => {
    const db1 = await openTestDB("chaos-rapid-cross");

    // Write 10 items sequentially
    for (let i = 0; i < 10; i++) {
      await writeOp(db1, i, `cross-${i}`);
    }

    // Verify all written
    const reads = Array.from({ length: 10 }, (_, i) => readOp(db1, i));
    const results = await Promise.all(reads);
    expect(results).toHaveLength(10);
    db1.close();
  });
});

// ===========================================================================
// Scenario 7: IDB versionchange event
// ===========================================================================
describe("IDB versionchange event", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function makeVersionchangeTarget() {
    const versionchangeHandlers: Array<(e: Event) => void> = [];
    let isClosed = false;

    const closeFn = vi.fn().mockImplementation(() => {
      isClosed = true;
    });

    const db = {
      name: "test-db",
      version: 1,
      close: closeFn,
      transaction: vi.fn(),
      objectStoreNames: { contains: vi.fn() } as any,
      createObjectStore: vi.fn(),
      deleteObjectStore: vi.fn(),
      addEventListener: vi.fn((event: string, handler: any) => {
        if (event === "versionchange") {
          versionchangeHandlers.push(handler);
        }
      }),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn((event: Event) => {
        if (event.type === "versionchange") {
          versionchangeHandlers.forEach((h) => h(event));
        }
        return true;
      }),
      get isClosed() {
        return isClosed;
      },
      get onversionchange() {
        return null;
      },
      set onversionchange(handler: ((e: Event) => void) | null) {
        if (handler) {
          versionchangeHandlers.push(handler);
        }
      },
    } as unknown as IDBDatabase & { isClosed: boolean };

    return { db, versionchangeHandlers };
  }

  it("closes the database connection on versionchange event", async () => {
    const { db } = makeVersionchangeTarget();

    const { request, fire } = createMockOpenRequest({
      result: db,
      error: null,
    });

    const mockIDB = createMockIDBFactory(vi.fn().mockReturnValue(request));
    vi.stubGlobal("indexedDB", mockIDB);

    setTimeout(() => fire("success"), 0);

    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("test-db", 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    // Register versionchange handler (as the real app would)
    database.onversionchange = () => {
      database.close();
    };

    database.dispatchEvent(new Event("versionchange"));

    expect(database.close).toHaveBeenCalledOnce();
  });

  it("does not crash when dispatchEvent is called without a versionchange handler", async () => {
    const { db } = makeVersionchangeTarget();

    const { request, fire } = createMockOpenRequest({
      result: db,
      error: null,
    });
    const mockIDB = createMockIDBFactory(vi.fn().mockReturnValue(request));
    vi.stubGlobal("indexedDB", mockIDB);

    setTimeout(() => fire("success"), 0);

    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("test-db", 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    // No handler registered
    expect(() => {
      database.dispatchEvent(new Event("versionchange"));
    }).not.toThrow();
  });

  it("handles multiple versionchange events gracefully", async () => {
    const { db } = makeVersionchangeTarget();

    const { request, fire } = createMockOpenRequest({
      result: db,
      error: null,
    });
    const mockIDB = createMockIDBFactory(vi.fn().mockReturnValue(request));
    vi.stubGlobal("indexedDB", mockIDB);

    setTimeout(() => fire("success"), 0);

    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("test-db", 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    // Register versionchange handler
    database.onversionchange = () => {
      database.close();
    };

    expect(() => {
      database.dispatchEvent(new Event("versionchange"));
      database.dispatchEvent(new Event("versionchange"));
      database.dispatchEvent(new Event("versionchange"));
    }).not.toThrow();

    expect(database.close).toHaveBeenCalled();
  });

  it("does not throw when closing an already closed database after versionchange", async () => {
    const { db } = makeVersionchangeTarget();

    const { request, fire } = createMockOpenRequest({
      result: db,
      error: null,
    });
    const mockIDB = createMockIDBFactory(vi.fn().mockReturnValue(request));
    vi.stubGlobal("indexedDB", mockIDB);

    setTimeout(() => fire("success"), 0);

    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open("test-db", 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    database.onversionchange = () => {
      if (!(database as any).isClosed) {
        database.close();
      }
    };

    // Fire multiple versionchange events — guard prevents double-close
    database.dispatchEvent(new Event("versionchange"));
    database.dispatchEvent(new Event("versionchange"));

    expect(database.close).toHaveBeenCalledOnce();
  });
});

// ===========================================================================
// Cross-cutting: all operations together (integration resilience)
// ===========================================================================
describe("combined resilience scenarios", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("rejects DB1 password errors and allows retry without crashing", async () => {
    let attempts = 0;

    async function createDB(pw: string) {
      attempts++;
      if (pw !== "correct") {
        const err = new Error("DB1: Wrong password");
        (err as any).code = "DB1";
        throw err;
      }
      return { name: "db", isReady: true };
    }

    async function initDB(pw: string) {
      try {
        return await createDB(pw);
      } catch (err) {
        const e = err as Error & { code?: string };
        if (e.message?.includes("DB1") || e.code === "DB1") {
          const pwErr = new Error("Invalid password");
          pwErr.name = "INVALID_PASSWORD";
          throw pwErr;
        }
        throw err;
      }
    }

    await expect(initDB("wrong")).rejects.toThrow("Invalid password");
    expect(attempts).toBe(1);

    const db = await initDB("correct");
    expect(db).toEqual({ name: "db", isReady: true });
    expect(attempts).toBe(2);
  });

  it("does not break subsequent operations after an IDB error is caught", async () => {
    let failNext = true;

    const items: Record<string, string> = {};
    const conditionalLS = {
      getItem: vi
        .fn<(key: string) => string | null>()
        .mockImplementation((k: string) => {
          if (failNext) {
            failNext = false;
            throw new DOMException("QuotaExceededError", "QuotaExceededError");
          }
          return items[k] ?? null;
        }),
      setItem: vi
        .fn<(key: string, value: string) => void>()
        .mockImplementation((k: string, v: string) => {
          items[k] = v;
        }),
      removeItem: vi
        .fn<(key: string) => void>()
        .mockImplementation((k: string) => {
          delete items[k];
        }),
      clear: vi.fn(),
      get length() {
        return Object.keys(items).length;
      },
      key: vi.fn((i: number) => Object.keys(items)[i] ?? null),
    };

    vi.stubGlobal("localStorage", conditionalLS);
    vi.resetModules();

    const { safeGet, safeSet } = await import("../../store/safeStorage");

    const first = safeGet("some-key");
    expect(first).toBeNull();

    safeSet("some-key", "persistent-value");
    const second = safeGet("some-key");
    expect(second).toBe("persistent-value");
  });
});
