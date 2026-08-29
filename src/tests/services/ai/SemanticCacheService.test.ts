import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("voy-search", () => {
  const mockVoy = {
    search: vi.fn(),
    index: vi.fn(),
    remove: vi.fn(),
    clear: vi.fn(),
  };
  // Regular function (not arrow) so `new Voy()` succeeds inside init().
  return { Voy: vi.fn(function () { return mockVoy; }), Neighbor: {} };
});

vi.mock("@huggingface/transformers", () => ({
  pipeline: vi.fn(),
  // env is a named export of the real module (no default export exists)
  env: { allowLocalModels: true },
  FeatureExtractionPipeline: {},
}));

vi.mock("../../../utils/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../../services/SecurityVault", () => ({
  securityVault: {
    registerCaller: vi.fn(),
    onLock: vi.fn(() => () => {}),
    onUnlock: vi.fn(() => () => {}),
    isLocked: vi.fn(() => false),
    withMasterPasswordBytes: vi.fn(
      (_caller: object, callback: (bytes: Uint8Array | null) => unknown) =>
        callback(new Uint8Array([11, 22, 33, 44, 55, 66, 77, 88])),
    ),
  },
}));

vi.mock("../../services/ai/types", () => ({
  AIResponse: {},
}));

const { SemanticCacheService, SEMANTIC_CACHE_DB } =
  await import("../../../services/ai/SemanticCacheService");
const { Voy } = await import("voy-search");
const { pipeline } = await import("@huggingface/transformers");
const PERSIST_STORE = "entries";

/** Wipe the persisted semantic-cache store so each test starts clean. */
async function wipePersistedStore(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.open(SEMANTIC_CACHE_DB, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(PERSIST_STORE)) {
        d.createObjectStore(PERSIST_STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(PERSIST_STORE, "readwrite");
      tx.objectStore(PERSIST_STORE).clear();
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
}

async function readPersistedEntries(): Promise<unknown[]> {
  return await new Promise<unknown[]>((resolve, reject) => {
    const req = indexedDB.open(SEMANTIC_CACHE_DB, 1);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(PERSIST_STORE, "readonly");
      const read = tx.objectStore(PERSIST_STORE).getAll();
      read.onsuccess = () => {
        db.close();
        resolve((read.result ?? []) as unknown[]);
      };
      read.onerror = () => reject(read.error);
    };
    req.onerror = () => reject(req.error);
  });
}

describe("SemanticCacheService", () => {
  let service: InstanceType<typeof SemanticCacheService>;
  let mockVoyInstance: any;
  let mockExtractor: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    await wipePersistedStore();

    mockVoyInstance = {
      search: vi.fn().mockReturnValue({ neighbors: [] }),
      index: vi.fn(),
      remove: vi.fn(),
      clear: vi.fn(),
    };
    (Voy as any).mockImplementation(function () {
      return mockVoyInstance;
    });

    mockExtractor = vi.fn().mockResolvedValue({
      data: new Float32Array(384).fill(0.1),
    });
    (pipeline as any).mockResolvedValue(mockExtractor);

    service = new SemanticCacheService();
  });

  afterEach(async () => {
    await service.wipePersistence();
    service.dispose();
  });

  describe("initialization", () => {
    it("can be instantiated", () => {
      expect(service).toBeTruthy();
    });

    it("does NOT load the 22MB embedding model at construction (lazy init)", () => {
      // The model must only load on first real demand, never at import time.
      expect(pipeline).not.toHaveBeenCalled();
      expect(Voy).not.toHaveBeenCalled();
      expect((service as any).isReady).toBe(false);
    });

    it("initializes extractor and voy on first demand", async () => {
      await (service as any).init();

      expect(pipeline).toHaveBeenCalledWith(
        "feature-extraction",
        "Xenova/all-MiniLM-L6-v2",
      );
      expect(Voy).toHaveBeenCalled();
      expect((service as any).isReady).toBe(true);
    });

    it("does not retry model loading during the failure cooldown", async () => {
      (pipeline as any).mockRejectedValueOnce(new Error("model unavailable"));

      await expect((service as any).init()).resolves.toBeUndefined();
      expect(pipeline).toHaveBeenCalledTimes(1);
      expect((service as any).isReady).toBe(false);
      expect((service as any).initializationFailedUntil).toBeGreaterThan(Date.now());

      await expect((service as any).init()).resolves.toBeUndefined();
      expect(pipeline).toHaveBeenCalledTimes(1);

      // A vault transition explicitly permits a fresh attempt.
      (service as any).initializationFailedUntil = Date.now() + 60_000;
      await (service as any).wipePersistence();
      expect((service as any).initializationFailedUntil).toBe(0);
    });
  });

  describe("getEmbedding", () => {
    it("generates embedding vector", async () => {
      await (service as any).init();
      // Access private method through any
      const embedding = await (service as any).getEmbedding("test query");

      expect(Array.isArray(embedding)).toBe(true);
      expect(embedding.length).toBe(384);
      expect(mockExtractor).toHaveBeenCalledWith("test query", {
        pooling: "mean",
        normalize: true,
      });
    });

    it("throws if extractor not initialized", async () => {
      const uninitializedService = new SemanticCacheService();
      (uninitializedService as any).extractor = null;

      await expect(
        (uninitializedService as any).getEmbedding("test"),
      ).rejects.toThrow("Extractor not initialized");
    });
  });

  describe("findSimilar", () => {
    beforeEach(async () => {
      await (service as any).init();
      // Inject the mock voy into the service instance
      (service as any).voy = mockVoyInstance;
      (service as any).isReady = true;
    });

    it("returns null if not ready", async () => {
      const unreadyService = new SemanticCacheService();
      (unreadyService as any).isReady = false;

      const result = await unreadyService.findSimilar("test");
      expect(result).toBeNull();
    });

    it("returns null if voy not initialized", async () => {
      const unreadyService = new SemanticCacheService();
      (unreadyService as any).voy = null;

      const result = await unreadyService.findSimilar("test");
      expect(result).toBeNull();
    });

    it("returns cached response on cache hit with high similarity", async () => {
      const mockResponse = { content: "cached response", model: "test" };
      const cachedId = "test-id-123";

      mockVoyInstance.search.mockReturnValue({
        neighbors: [{ id: cachedId, distance: 0.05 }], // similarity = 0.95 > 0.92
      });

      (service as any).intentStore.set(cachedId, {
        id: cachedId,
        query: "test query",
        response: mockResponse as any,
        timestamp: Date.now(),
      });

      const result = await service.findSimilar("test query");

      expect(result).toEqual(mockResponse);
    });

    it("returns null on cache miss (score too low)", async () => {
      mockVoyInstance.search.mockReturnValue({
        neighbors: [{ id: "some-id", distance: 0.2 }], // similarity = 0.8 < 0.92
      });

      const result = await service.findSimilar("test query");

      expect(result).toBeNull();
    });

    it("returns null if cached entry expired (TTL)", async () => {
      const mockResponse = { content: "cached response", model: "test" };
      const cachedId = "expired-id";

      mockVoyInstance.search.mockReturnValue({
        neighbors: [{ id: cachedId, distance: 0.05 }],
      });

      (service as any).intentStore.set(cachedId, {
        id: cachedId,
        query: "test query",
        response: mockResponse as any,
        timestamp: Date.now() - 25 * 60 * 60 * 1000, // 25 hours ago
      });

      const result = await service.findSimilar("test query");

      expect(result).toBeNull();
      // Entry should be removed after expiration
      expect((service as any).intentStore.has(cachedId)).toBe(false);
    });

    it("prunes expired entries even if they are not the queried neighbor", async () => {
      const staleId = "unrelated-stale-id";
      (service as any).intentStore.set(staleId, {
        id: staleId,
        response: { content: "stale", model: "test" },
        timestamp: Date.now() - 25 * 60 * 60 * 1000,
      });
      mockVoyInstance.search.mockReturnValue({ neighbors: [] });

      await service.findSimilar("fresh query");

      expect((service as any).intentStore.has(staleId)).toBe(false);
      expect(mockVoyInstance.remove).toHaveBeenCalled();
    });

    it("uses systemPrompt in query context", async () => {
      mockVoyInstance.search.mockReturnValue({ neighbors: [] });

      await service.findSimilar("user prompt", "system prompt");

      // Verify getEmbedding was called with combined context
      expect(mockExtractor).toHaveBeenCalledWith("system prompt\nuser prompt", {
        pooling: "mean",
        normalize: true,
      });
    });

    it("handles search errors gracefully", async () => {
      mockVoyInstance.search.mockImplementation(() => {
        throw new Error("search failed");
      });

      const result = await service.findSimilar("test query");

      expect(result).toBeNull();
    });
  });

  describe("add", () => {
    beforeEach(async () => {
      await (service as any).init();
      (service as any).voy = mockVoyInstance;
      (service as any).isReady = true;
    });

    it("adds entry to cache", async () => {
      const response = { content: "test response", model: "test" };

      await service.add("test prompt", response as any);

      expect(mockVoyInstance.index).toHaveBeenCalled();
      expect((service as any).intentStore.size).toBe(1);
    });

    it("uses systemPrompt in embedding", async () => {
      const response = { content: "test response", model: "test" };

      await service.add("user prompt", response as any, "system prompt");

      expect(mockExtractor).toHaveBeenCalledWith("system prompt\nuser prompt", {
        pooling: "mean",
        normalize: true,
      });
    });

    it("evicts oldest when cache full", async () => {
      const maxSize = (service as any).MAX_CACHE_SIZE;

      // Fill cache
      for (let i = 0; i < maxSize; i++) {
        (service as any).intentStore.set(`id-${i}`, {
          id: `id-${i}`,
          query: `query ${i}`,
          response: { content: `response ${i}`, model: "test" },
          timestamp: Date.now() - i * 1000,
        });
      }

      mockVoyInstance.index.mockClear();

      await service.add("new prompt", {
        content: "new response",
        model: "test",
      } as any);

      expect((service as any).intentStore.size).toBe(maxSize);
    });

    it("handles add errors gracefully", async () => {
      mockVoyInstance.index.mockImplementation(() => {
        throw new Error("index failed");
      });

      await expect(
        service.add("test", { content: "resp", model: "test" } as any),
      ).resolves.not.toThrow();
    });
  });

  describe("remove", () => {
    beforeEach(async () => {
      await (service as any).init();
      (service as any).voy = mockVoyInstance;
      (service as any).isReady = true;
    });

    it("removes entry from cache", async () => {
      const id = "remove-test";
      (service as any).intentStore.set(id, {
        id,
        query: "test",
        response: { content: "resp", model: "test" },
        timestamp: Date.now(),
      });

      (service as any).remove(id);

      expect(mockVoyInstance.remove).toHaveBeenCalled();
      expect((service as any).intentStore.has(id)).toBe(false);
    });
  });

  describe("clear", () => {
    beforeEach(async () => {
      await (service as any).init();
      (service as any).voy = mockVoyInstance;
      (service as any).isReady = true;
    });

    it("clears all entries", async () => {
      (service as any).intentStore.set("id1", {
        id: "id1",
        query: "q",
        response: { content: "r", model: "test" },
        timestamp: Date.now(),
      });
      (service as any).intentStore.set("id2", {
        id: "id2",
        query: "q",
        response: { content: "r", model: "test" },
        timestamp: Date.now(),
      });

      service.clear();

      expect((service as any).intentStore.size).toBe(0);
      expect(mockVoyInstance.clear).toHaveBeenCalled();
    });
  });

  describe("evictOldest", () => {
    beforeEach(async () => {
      await (service as any).init();
      (service as any).voy = mockVoyInstance;
      (service as any).isReady = true;
    });

    it("removes oldest entry", async () => {
      const now = Date.now();
      (service as any).intentStore.set("newest", {
        id: "newest",
        query: "q",
        response: { content: "r", model: "test" },
        timestamp: now,
      });
      (service as any).intentStore.set("oldest", {
        id: "oldest",
        query: "q",
        response: { content: "r", model: "test" },
        timestamp: now - 10000,
      });
      (service as any).intentStore.set("middle", {
        id: "middle",
        query: "q",
        response: { content: "r", model: "test" },
        timestamp: now - 5000,
      });

      (service as any).evictOldest();

      expect((service as any).intentStore.has("oldest")).toBe(false);
      expect((service as any).intentStore.has("newest")).toBe(true);
      expect((service as any).intentStore.has("middle")).toBe(true);
    });

    it("does nothing if store empty", async () => {
      (service as any).evictOldest();
      expect((service as any).intentStore.size).toBe(0);
    });

    it("removes single item when store has one entry", async () => {
      (service as any).intentStore.set("only", {
        id: "only",
        query: "q",
        response: { content: "r", model: "test" },
        timestamp: Date.now(),
      });
      (service as any).evictOldest();
      expect((service as any).intentStore.size).toBe(0);
    });
  });

  describe("init guard", () => {
    it("does not re-initialize if already initializing", async () => {
      (service as any).isInitializing = true;
      const initSpy = vi.spyOn(service as any, "init");
      (service as any).init();
      expect(initSpy).toHaveReturned();
    });
  });

  describe("findSimilar edge cases", () => {
    beforeEach(async () => {
      await (service as any).init();
      (service as any).voy = mockVoyInstance;
      (service as any).isReady = true;
    });

    it("returns null when search returns null neighbors", async () => {
      mockVoyInstance.search.mockReturnValue(null);
      const result = await service.findSimilar("test");
      expect(result).toBeNull();
    });

    it("returns null when search returns empty neighbors", async () => {
      mockVoyInstance.search.mockReturnValue({ neighbors: [] });
      const result = await service.findSimilar("test");
      expect(result).toBeNull();
    });

    it("returns null when score meets threshold but id not in store", async () => {
      mockVoyInstance.search.mockReturnValue({
        neighbors: [{ id: "phantom-id", distance: 0.02 }],
      });
      const result = await service.findSimilar("test");
      expect(result).toBeNull();
    });
  });

  describe("add edge cases", () => {
    it("does not throw when service not ready", async () => {
      const unreadyService = new SemanticCacheService();
      (unreadyService as any).isReady = false;
      (unreadyService as any).voy = null;
      await expect(
        unreadyService.add("test", { content: "r", model: "test" } as any),
      ).resolves.not.toThrow();
    });
  });

  describe("IndexedDB persistence", () => {
    it("persists entries and restores them in a new session", async () => {
      // Session 1: init + add an entry.
      await (service as any).init();
      (service as any).voy = mockVoyInstance;
      (service as any).isReady = true;
      await service.add("persisted prompt", {
        content: "persisted response",
        model: "test",
      } as any);
      // Allow the fire-and-forget persist to flush. The persist path runs
      // Argon2id encryption on the main-thread fallback, so a fixed sleep is
      // racy across machines — poll until the entry lands or time out.
      let rawEntries: unknown[] = [];
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        rawEntries = await readPersistedEntries();
        if (rawEntries.length >= 1) {break;}
        await new Promise((r) => setTimeout(r, 25));
      }
      expect(rawEntries).toHaveLength(1);
      expect(rawEntries[0]).toMatchObject({
        id: expect.any(String),
        ciphertext: expect.stringMatching(/^v[45]:/),
      });
      expect(rawEntries[0]).not.toHaveProperty("query");
      expect(rawEntries[0]).not.toHaveProperty("response");
      expect(rawEntries[0]).not.toHaveProperty("embedding");

      // Session 2: a fresh service restores the index from IndexedDB.
      const service2 = new SemanticCacheService();
      await (service2 as any).init();

      expect((service2 as any).intentStore.size).toBe(1);
      const entry = (service2 as any).intentStore.values().next().value;
      // The persisted envelope deliberately omits the query text (privacy:
      // user prompts are never written to IndexedDB) — only the response and
      // timestamp survive the roundtrip.
      expect(entry.query).toBeUndefined();
      expect(entry.response.content).toBe("persisted response");
      // The Voy index was rebuilt from the persisted embeddings.
      expect(mockVoyInstance.index).toHaveBeenCalledWith(
        expect.objectContaining({
          embeddings: expect.arrayContaining([
            expect.objectContaining({ id: entry.id }),
          ]),
        }),
      );
    });

    it("does not restore expired entries (TTL) and prunes them", async () => {
      // Seed an expired entry directly into IndexedDB (before init).
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open(SEMANTIC_CACHE_DB, 1);
        req.onupgradeneeded = () => {
          const d = req.result;
          if (!d.objectStoreNames.contains(PERSIST_STORE)) {
            d.createObjectStore(PERSIST_STORE, { keyPath: "id" });
          }
        };
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(PERSIST_STORE, "readwrite");
          tx.objectStore(PERSIST_STORE).put({
            id: "stale-id",
            query: "stale",
            response: { content: "stale", model: "test" },
            timestamp: Date.now() - 25 * 60 * 60 * 1000,
            embedding: new Array(384).fill(0.1),
          });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      });

      const deleteSpy = vi.spyOn(service as any, "deletePersisted");
      await (service as any).init();

      expect((service as any).intentStore.has("stale-id")).toBe(false);
      expect(deleteSpy).toHaveBeenCalledWith("stale-id");
    });

    it("caps restored entries and deletes persisted overflow", async () => {
      const { encryptionService } =
        await import("../../../services/EncryptionService");
      const entries = Array.from({ length: 102 }, (_, index) => ({
        id: `overflow-${index}`,
        ciphertext: `cipher-${index}`,
      }));
      const request: { onsuccess?: () => void; onerror?: () => void; result?: unknown[] } = {
        result: entries,
      };
      const fakeDb = {
        transaction: vi.fn(() => ({
          objectStore: vi.fn(() => ({
            getAll: vi.fn(() => {
              queueMicrotask(() => request.onsuccess?.());
              return request;
            }),
          })),
        })),
      };
      const decryptSpy = vi
        .spyOn(encryptionService, "decryptWithBytes")
        .mockImplementation(async (ciphertext) => {
          const id = String(ciphertext).replace("cipher-", "overflow-");
          return JSON.stringify({
            id,
            response: { content: id, model: "test" },
            timestamp: Date.now(),
            embedding: new Array(384).fill(0.1),
          });
        });
      const dbSpy = vi
        .spyOn(service as any, "getDB")
        .mockResolvedValue(fakeDb);
      const deleteSpy = vi
        .spyOn(service as any, "deletePersisted")
        .mockImplementation(() => {});
      vi.spyOn(service as any, "withVaultPassword").mockImplementation(
        async (...args: any[]) => {
          const operation = args[0] as (bytes: Uint8Array) => Promise<unknown>;
          return operation(new Uint8Array([1, 2, 3]));
        },
      );
      (service as any).voy = mockVoyInstance;

      await (service as any).restoreFromPersist();

      expect((service as any).intentStore.size).toBe(100);
      expect(mockVoyInstance.index).toHaveBeenCalledWith({
        embeddings: expect.arrayContaining([
          expect.objectContaining({ id: "overflow-0" }),
        ]),
      });
      expect(deleteSpy).toHaveBeenCalledWith("overflow-100");
      expect(deleteSpy).toHaveBeenCalledWith("overflow-101");
      decryptSpy.mockRestore();
      dbSpy.mockRestore();
    });

    it("clear() wipes the persisted store too", async () => {
      await (service as any).init();
      (service as any).voy = mockVoyInstance;
      (service as any).isReady = true;
      await service.add("wipe prompt", {
        content: "wipe response",
        model: "test",
      } as any);
      await new Promise((r) => setTimeout(r, 10));

      service.clear();
      await new Promise((r) => setTimeout(r, 10));

      const service2 = new SemanticCacheService();
      await (service2 as any).init();
      expect((service2 as any).intentStore.size).toBe(0);
    });

    it("wipePersistence() clears the store and releases the connection", async () => {
      await (service as any).init();
      (service as any).voy = mockVoyInstance;
      (service as any).isReady = true;
      await service.add("wipe2 prompt", {
        content: "wipe2 response",
        model: "test",
      } as any);
      await new Promise((r) => setTimeout(r, 10));

      const staleGeneration = (service as any).vaultGeneration;
      await (service as any).wipePersistence();

      // A persistence operation that belongs to the pre-wipe generation must
      // be ignored rather than recreating the deleted entry.
      await (service as any).persistEntry(
        {
          id: "stale-after-wipe",
          response: { content: "stale", model: "test" },
          timestamp: Date.now(),
          embedding: new Array(384).fill(0.1),
        },
        staleGeneration,
      );

      // Connection released so a later deleteDatabase is not blocked.
      expect((service as any).db).toBeNull();
      expect(await readPersistedEntries()).toHaveLength(0);
      const service2 = new SemanticCacheService();
      await (service2 as any).init();
      expect((service2 as any).intentStore.size).toBe(0);
    });
  });

  describe("add performance", () => {
    beforeEach(async () => {
      await (service as any).init();
      (service as any).voy = mockVoyInstance;
      (service as any).isReady = true;
    });

    it("handles many adds without error", async () => {
      const promises: Promise<void>[] = [];
      for (let i = 0; i < 50; i++) {
        promises.push(
          service.add(`query-${i}`, {
            content: `response-${i}`,
            model: "test",
          } as any),
        );
      }
      await expect(Promise.all(promises)).resolves.not.toThrow();
      expect(mockVoyInstance.index).toHaveBeenCalled();
    });
  });

  describe("performance", () => {
    beforeEach(async () => {
      await (service as any).init();
      (service as any).voy = mockVoyInstance;
      (service as any).isReady = true;
    });

    it("findSimilar completes within acceptable time under full cache", async () => {
      const maxSize = (service as any).MAX_CACHE_SIZE;
      for (let i = 0; i < maxSize; i++) {
        (service as any).intentStore.set(`perf-${i}`, {
          id: `perf-${i}`,
          query: `q-${i}`,
          response: { content: `r-${i}`, model: "test" },
          timestamp: Date.now(),
        });
      }

      mockVoyInstance.search.mockReturnValue({
        neighbors: [{ id: "perf-1", distance: 0.05 }],
      });

      const start = performance.now();
      const result = await service.findSimilar("q-1");
      const elapsed = performance.now() - start;

      expect(result).toEqual({ content: "r-1", model: "test" });
      expect(elapsed).toBeLessThan(5000);
    });
  });
});
