import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

/**
 * SecureStorage close/versionchange race coverage.
 *
 * Regression tests for the S9 e2e failure observed in
 * tests/e2e/vault-nuclear-forget-s9-guard.spec.ts: during nuclear forget,
 * `deleteIndexedDB(SECURE_DB)` delivers a `versionchange` to the open
 * SecureStorage connection, which closes it while the AI-guard's
 * `hasSecret()` read sits between `init()` and `transaction()` — the stale
 * handle then throws InvalidStateError ("The database connection is
 * closing") and the guard call fails.
 *
 * The fix (SecureStorage.withLiveConnection + opChain serialization):
 *   - IDB data operations and close() are serialized on a promise chain.
 *   - If the cached connection was closed underneath an operation, the
 *     stale handle is dropped and the operation is retried once against a
 *     freshly opened connection.
 *
 * Unlike the main SecureStorage.test.ts mock (a single shared transaction),
 * this mock creates a FRESH transaction per `db.transaction()` call and
 * completes it after the request succeeds, matching real IndexedDB semantics
 * (resolution happens on transaction.oncomplete).
 */

const storeMap = new Map<string, string>();
let transactions: any[] = [];

const mockObjectStore = {
  put: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
  clear: vi.fn(),
  openCursor: vi.fn(),
  createIndex: vi.fn(),
};
const mockIndexedDB = {
  open: vi.fn(),
};

vi.mock("../../utils/indexedDB", () => ({
  getIndexedDB: vi.fn(() => mockIndexedDB),
}));
vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

function createRequest(result: any = undefined) {
  return { result, error: null, onsuccess: null, onerror: null } as any;
}

/** Fire the owning transaction's oncomplete after the request succeeds. */
function afterRequestSuccess(fire: () => void) {
  Promise.resolve()
    .then(fire)
    .then(() => transactions[transactions.length - 1]?.oncomplete?.());
}

function setupMockDb(options: { failTransactions?: boolean } = {}) {
  mockIndexedDB.open.mockImplementation(() => {
    const req = createRequest();
    const db: any = {
      objectStoreNames: { contains: () => true },
      createObjectStore: vi.fn(() => mockObjectStore),
      transaction: vi.fn(() => {
        const tx: any = {
          objectStore: vi.fn(() => mockObjectStore),
          oncomplete: null,
          onerror: null,
          onabort: null,
        };
        transactions.push(tx);
        if (options.failTransactions) {
          // Real DOMException, matching the browser error that surfaced in
          // the S9 e2e (hasSecret only rethrows InvalidStateError corruption
          // for DOMException instances).
          throw new DOMException(
            "The database connection is closing",
            "InvalidStateError",
          );
        }
        return tx;
      }),
      close: vi.fn(),
    };
    req.result = db;
    Promise.resolve().then(() => {
      req.onsuccess?.({ target: { result: db } });
    });
    return req;
  });

  mockObjectStore.get.mockImplementation((key: string) => {
    const req = createRequest(
      storeMap.has(key) ? { id: key, value: storeMap.get(key) } : undefined,
    );
    afterRequestSuccess(() => req.onsuccess?.({ target: req }));
    return req;
  });

  mockObjectStore.put.mockImplementation((data: any) => {
    storeMap.set(data.id, data.value);
    const req = createRequest();
    afterRequestSuccess(() => req.onsuccess?.({ target: req }));
    return req;
  });

  mockObjectStore.delete.mockImplementation((key: string) => {
    storeMap.delete(key);
    const req = createRequest();
    afterRequestSuccess(() => req.onsuccess?.({ target: req }));
    return req;
  });

  mockObjectStore.clear.mockImplementation(() => {
    storeMap.clear();
    const req = createRequest();
    afterRequestSuccess(() => req.onsuccess?.({ target: req }));
    return req;
  });
}

let secureStorage: any;

beforeAll(async () => {
  const mod = await import("../../services/SecureStorage");
  secureStorage = mod.secureStorage;
});

beforeEach(async () => {
  vi.clearAllMocks();
  storeMap.clear();
  transactions = [];
  (secureStorage as any).initPromise = null;
  (secureStorage as any).db = null;
  (secureStorage as any).opChain = Promise.resolve();
  const { getIndexedDB } = await import("../../utils/indexedDB");
  (getIndexedDB as any).mockReturnValue(mockIndexedDB);
});

describe("SecureStorage close/versionchange race", () => {
  it("retries a read when the cached connection was closed mid-operation", async () => {
    setupMockDb();
    storeMap.set("k", "v");

    // First read opens the connection.
    expect(await secureStorage.hasSecret("k")).toBe(true);
    expect(mockIndexedDB.open).toHaveBeenCalledTimes(1);
    expect(secureStorage.isReady()).toBe(true);

    // Simulate the nuclear-forget race: the underlying connection was closed
    // by a deleteDatabase versionchange, but the cached handle was NOT nulled
    // — leaving this.db pointing at a closing connection whose transaction()
    // throws InvalidStateError, exactly like the e2e failure.
    const staleDb = secureStorage.db;
    staleDb.transaction.mockImplementationOnce(() => {
      throw new DOMException(
        "The database connection is closing",
        "InvalidStateError",
      );
    });

    // The read must transparently reopen and succeed instead of surfacing
    // InvalidStateError to the AI guard (hasSecret would rethrow it as
    // corruption and the S9 e2e would fail).
    expect(await secureStorage.hasSecret("k")).toBe(true);
    expect(mockIndexedDB.open).toHaveBeenCalledTimes(2);
    expect(secureStorage.isReady()).toBe(true);
  });

  it("retries at most once — a second closing connection surfaces the error", async () => {
    setupMockDb({ failTransactions: true });

    // Every connection's transaction() throws InvalidStateError, so both the
    // first attempt AND the retry reopen fail. The error must propagate
    // (bounded retry) rather than loop forever or mask corruption.
    await expect(secureStorage.hasSecret("k")).rejects.toMatchObject({
      name: "InvalidStateError",
    });
    expect(mockIndexedDB.open).toHaveBeenCalledTimes(2);
  });

  it("serializes ops against close(): a read queued after close reopens", async () => {
    setupMockDb();
    storeMap.set("k", "v");

    await secureStorage.hasSecret("k");
    expect(secureStorage.isReady()).toBe(true);

    await secureStorage.close();
    expect(secureStorage.isReady()).toBe(false);

    // A read after close must reopen instead of throwing — the purge /
    // lock path serializes with data operations.
    expect(await secureStorage.hasSecret("k")).toBe(true);
    expect(mockIndexedDB.open).toHaveBeenCalledTimes(2);
  });
});
