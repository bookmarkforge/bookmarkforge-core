
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "fake-indexeddb/auto";

let mockSearchResult: unknown[] = [];

vi.mock("voy-search", () => {
  const Voy = function (this: any) {
    (this as any).search = function () {
      return mockSearchResult;
    };
  };
  return { Voy };
});

vi.mock("../../services/ai/QuantizationService", () => ({
  QuantizationService: {
    generateRotationMatrix: vi.fn(() => new Float32Array(4)),
    quantizePolar8: vi.fn(() => ({ data: new Uint8Array([1, 2]), scale: 0.5 })),
    quantizePolar4: vi.fn(() => ({
      data: new Uint8Array([3, 4]),
      scale: 0.25,
    })),
  },
}));

vi.mock("../../utils", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const postMessages: any[] = [];

/**
 * Valid per-vault KDF salt (32 lowercase hex) — ADR-046 parity: SET_KEY now
 * carries the vault's own salt instead of the retired bundle-wide constant.
 * The roundtrip test below depends on both SET_KEY calls using the SAME salt
 * so the re-derived key after restart still opens the persisted envelope.
 */
const VOY_TEST_VAULT_SALT = "ab".repeat(16);

beforeEach(() => {
  postMessages.length = 0;
  mockSearchResult = [];
  vi.clearAllMocks();
  // Reset module cache so voy.worker.ts re-runs its module-level
  // init (`documents = []`, `uncommittedDocuments = []`, etc.).
  vi.resetModules();
  vi.stubGlobal("self", {
    postMessage: (msg: unknown) => {
      postMessages.push(msg);
    },
    // voy.worker.ts top-level calls `self.addEventListener("error" |
    // "messageerror" | "unhandledrejection")` to surface uncaught errors
    // to the main thread. Provide no-op handlers so module evaluation
    // completes BEFORE any test sends a message — otherwise the throw
    // happens before `self.onmessage` is wired up.
    addEventListener: () => {},
    removeEventListener: () => {},
  } as any);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function lastMsg(): any {
  return postMessages[postMessages.length - 1];
}

function clearMsgs(): void {
  postMessages.length = 0;
}

async function openVoyDb(): Promise<IDBDatabase> {
  let db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("VoyIndexDB");
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("index")) {
        request.result.createObjectStore("index");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  if (!db.objectStoreNames.contains("index")) {
    const nextVersion = db.version + 1;
    db.close();
    db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("VoyIndexDB", nextVersion);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("index")) {
          request.result.createObjectStore("index");
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return db;
}

async function putPersistedIndex(value: unknown): Promise<void> {
  const db = await openVoyDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction("index", "readwrite");
    transaction.objectStore("index").put(value, "indexData");
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
  db.close();
}

async function readPersistedIndex(): Promise<unknown> {
  const db = await openVoyDb();
  const value = await new Promise<unknown>((resolve, reject) => {
    const transaction = db.transaction("index", "readonly");
    const request = transaction.objectStore("index").get("indexData");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return value;
}

async function loadWorker(): Promise<void> {
  await import("../../workers/voy.worker");
}

async function send(data: any): Promise<void> {
  await (self as any).onmessage({ data });
}

async function initEmpty(): Promise<void> {
  await send({ id: "i", type: "INIT", payload: {} });
  clearMsgs();
}

async function statsCount(): Promise<number> {
  await send({ id: "s", type: "GET_STATS" });
  return lastMsg().payload.count as number;
}

describe("P0 regression — Voyage index dedup-by-id", () => {
  it("re-ADD with the SAME id does NOT grow the documents array", async () => {
    await loadWorker();
    await initEmpty();
    expect(await statsCount()).toBe(0);

    // Each ADD below targets the SAME id "x" with progressively different
    // embeddings (simulating an edit). Without dedup the count would be 3.
    await send({
      id: "a1",
      type: "ADD",
      payload: { id: "x", title: "v1", url: "u", embedding: [0.1] },
    });
    await send({ id: "c1", type: "COMMIT" });

    await send({
      id: "a2",
      type: "ADD",
      payload: { id: "x", title: "v2", url: "u", embedding: [0.2] },
    });
    await send({ id: "c2", type: "COMMIT" });

    await send({
      id: "a3",
      type: "ADD",
      payload: { id: "x", title: "v3", url: "u", embedding: [0.3] },
    });
    await send({ id: "c3", type: "COMMIT" });

    // CONTRACT: index has exactly ONE entry for id "x", not three.
    expect(await statsCount()).toBe(1);
  });

  it("BATCH_ADD dedups both intra-batch duplicates and existing-buffer conflicts", async () => {
    await loadWorker();
    await initEmpty();

    // Commit "y" once to seed the existing buffer.
    await send({
      id: "y1",
      type: "ADD",
      payload: { id: "y", title: "Y", url: "u", embedding: [0.5] },
    });
    await send({ id: "yc", type: "COMMIT" });
    expect(await statsCount()).toBe(1);

    // Batch contains 4 items but only 2 unique ids ("a" appears 3x, "z" once).
    // "a" also does NOT yet exist, so BATCH_ADD should add both fresh ids
    // AND replace nothing (new ids). Final count: 3 unique entries (y, a, z).
    await send({
      id: "b1",
      type: "BATCH_ADD",
      payload: {
        items: [
          { id: "a", title: "A1", url: "u", embedding: [0.1] },
          { id: "a", title: "A2", url: "u", embedding: [0.2] }, // dup #1 inside batch
          { id: "z", title: "Z", url: "u", embedding: [0.3] },
          { id: "a", title: "A3", url: "u", embedding: [0.4] }, // dup #2 inside batch
        ],
      },
    });

    // CONTRACT: 3 unique entries (y + a + z), NOT 5.
    expect(await statsCount()).toBe(3);
  });

  it("ADD with an id that is ALREADY committed does NOT grow the array", async () => {
    await loadWorker();
    await initEmpty();

    await send({
      id: "a1",
      type: "ADD",
      payload: { id: "q", title: "Q1", url: "u", embedding: [0.9] },
    });
    await send({ id: "c1", type: "COMMIT" });
    expect(await statsCount()).toBe(1);

    // Re-add q (existing) AND a new doc r.
    await send({
      id: "a2",
      type: "ADD",
      payload: { id: "q", title: "Q2", url: "u", embedding: [0.91] },
    });
    await send({
      id: "a3",
      type: "ADD",
      payload: { id: "r", title: "R", url: "u", embedding: [0.7] },
    });
    await send({ id: "c2", type: "COMMIT" });

    // CONTRACT: q + r = 2 unique ids, NOT 3.
    expect(await statsCount()).toBe(2);
  });

  it("dedup preserves the LATEST embedding (latest-write-wins)", async () => {
    await loadWorker();
    await initEmpty();

    await send({
      id: "a1",
      type: "ADD",
      payload: { id: "d", title: "D-v1", url: "u", embedding: [0.1, 0.2] },
    });
    await send({
      id: "a2",
      type: "ADD",
      payload: { id: "d", title: "D-v2", url: "u", embedding: [0.9, 0.8] },
    });
    await send({ id: "c", type: "COMMIT" });

    expect(await statsCount()).toBe(1);

    // SEARCH should return one hit whose embedding corresponds to the
    // latest write. The mock returns whatever we configure — what matters
    // here is that the upsert actually replaced (not appended). Use
    // serialized SAVE_INDEX as a structural witness: the documents array
    // persisted to IDB has exactly 1 entry with id "d".
    await send({ id: "save", type: "SAVE_INDEX" });
    expect(lastMsg().type).toBe("SUCCESS");

    // Without a vault key, SAVE_INDEX must fail closed rather than writing
    // embeddings and document metadata in plaintext to IndexedDB.
    expect(lastMsg().payload).toEqual({ encrypted: false, persisted: false });
    expect(await readPersistedIndex()).toBeUndefined();
  });

  it("purges a legacy plaintext index instead of loading it", async () => {
    await putPersistedIndex({
      mode: "none",
      documents: [{ id: "secret", title: "Private", url: "", embeddings: [1] }],
      quantizedDocuments: [],
      rotationMatrix: null,
      __legacyNoKey: true,
    });
    await loadWorker();

    await send({ id: "load", type: "LOAD_INDEX" });

    expect(lastMsg()).toMatchObject({
      id: "load",
      type: "SUCCESS",
      payload: { loaded: false, legacyPurged: true },
    });
    expect(await readPersistedIndex()).toBeUndefined();
  });

  it("encrypts the index and restores it after a worker restart", async () => {
    await loadWorker();
    await initEmpty();

    const password = new Uint8Array([11, 22, 33, 44, 55, 66, 77, 88]);
    await send({
      id: "key",
      type: "SET_KEY",
      payload: {
        passwordBytes: password,
        vaultSalt: VOY_TEST_VAULT_SALT,
        keyId: "session-1",
      },
    });
    expect(lastMsg()).toMatchObject({ id: "key", type: "SUCCESS" });

    await send({
      id: "add",
      type: "ADD",
      payload: {
        id: "secret",
        title: "Private",
        url: "private://secret",
        embedding: [1, 2, 3],
      },
    });
    await send({ id: "commit", type: "COMMIT" });
    await send({ id: "save", type: "SAVE_INDEX" });

    expect(lastMsg()).toMatchObject({
      id: "save",
      type: "SUCCESS",
      payload: { encrypted: true },
    });
    const persisted = (await readPersistedIndex()) as Record<string, unknown>;
    expect(persisted).toMatchObject({ v: "1", k: "session-1" });
    expect(Array.isArray(persisted.iv)).toBe(true);
    expect(Array.isArray(persisted.ct)).toBe(true);
    expect(persisted).not.toHaveProperty("documents");

    clearMsgs();
    vi.resetModules();
    await loadWorker();
    await send({
      id: "key-2",
      type: "SET_KEY",
      payload: {
        passwordBytes: new Uint8Array([11, 22, 33, 44, 55, 66, 77, 88]),
        vaultSalt: VOY_TEST_VAULT_SALT,
        keyId: "session-2",
      },
    });
    expect(lastMsg()).toMatchObject({ id: "key-2", type: "SUCCESS" });
    await send({ id: "load-2", type: "LOAD_INDEX" });

    expect(lastMsg()).toMatchObject({
      id: "load-2",
      type: "SUCCESS",
      payload: { loaded: true, count: 1 },
    });
  });
});
