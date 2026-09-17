import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const initDBMock = vi.hoisted(() => vi.fn());
const securityVaultMock = vi.hoisted(() => ({
  registerCaller: vi.fn(),
  onUnlock: vi.fn(() => () => {}),
  onLock: vi.fn(() => () => {}),
  isLocked: vi.fn(() => true),
  withMasterPasswordBytes: vi.fn(
    (_caller: object, callback: (bytes: Uint8Array | null) => unknown) =>
      callback(null),
  ),
}));

vi.mock("../../../db/database", () => ({
  initDB: initDBMock,
}));

vi.mock("../../../services/SecurityVault", () => ({
  securityVault: securityVaultMock,
}));

// ADR-046 parity (voy index): SET_KEY carries the per-vault KDF salt read
// from the crypto layer. The mock defaults to a provisioned salt so the
// lifecycle tests exercise the key-installation path; tests that need the
// "no salt" degradation override this via cryptoCoreMock.
const cryptoCoreMock = vi.hoisted(() => ({
  getVaultKdfSaltHex: vi.fn(() => "ab".repeat(16)),
}));
vi.mock("../../../utils/crypto-core", () => cryptoCoreMock);

interface PostedMessage {
  id: number;
  type: string;
  payload?: unknown;
}

class MockWorker {
  static instances: MockWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  posted: PostedMessage[] = [];
  terminate = vi.fn();

  constructor() {
    MockWorker.instances.push(this);
  }

  postMessage(message: PostedMessage): void {
    this.posted.push(message);
  }
}

describe("VectorIndexService worker lifecycle", () => {
  beforeEach(() => {
    vi.resetModules();
    MockWorker.instances = [];
    securityVaultMock.isLocked.mockReturnValue(true);
    securityVaultMock.withMasterPasswordBytes.mockReturnValue(null);
    initDBMock.mockResolvedValue({
      chunks: { find: () => ({ exec: vi.fn().mockResolvedValue([]) }) },
      memory: { find: () => ({ exec: vi.fn().mockResolvedValue([]) }) },
    });
    vi.stubGlobal("Worker", MockWorker as unknown as typeof Worker);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("coalesces concurrent initialize calls onto one worker request", async () => {
    const { vectorIndexService } =
      await import("../../../services/ai/VectorIndexService");

    const first = vectorIndexService.initialize();
    const second = vectorIndexService.initialize();
    await Promise.resolve();

    expect(MockWorker.instances).toHaveLength(1);
    const worker = MockWorker.instances[0]!;
    expect(worker.posted).toHaveLength(1);
    expect(worker.posted[0]!.type).toBe("LOAD_INDEX");

    worker.onmessage!({
      data: {
        id: worker.posted[0]!.id,
        type: "SUCCESS",
        payload: { loaded: true, mode: "polar8" },
      },
    } as MessageEvent);

    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
    expect((vectorIndexService as any).isInitialized).toBe(true);
    expect(vectorIndexService.getLoadStatus()).toBe("loaded");
    expect(vectorIndexService.getLoadDurationMs()).toBeGreaterThanOrEqual(0);
  });

  it("persists normalized legacy IDs after loading them", async () => {
    const { vectorIndexService } =
      await import("../../../services/ai/VectorIndexService");

    const initialization = vectorIndexService.initialize();
    await Promise.resolve();
    const worker = MockWorker.instances[0]!;
    const load = worker.posted[0]!;
    worker.onmessage!({
      data: {
        id: load.id,
        type: "SUCCESS",
        payload: { loaded: true, mode: "polar8", legacyNormalized: true },
      },
    } as MessageEvent);
    await vi.waitFor(() => {
      expect(worker.posted.some((message) => message.type === "SAVE_INDEX")).toBe(true);
    });
    const save = worker.posted.find((message) => message.type === "SAVE_INDEX")!;
    worker.onmessage!({
      data: { id: save.id, type: "SUCCESS", payload: { encrypted: true } },
    } as MessageEvent);

    await expect(initialization).resolves.toBeUndefined();
    expect(vectorIndexService.getLoadStatus()).toBe("legacy-normalized");
    expect(worker.posted.map((message) => message.type)).toEqual([
      "LOAD_INDEX",
      "SAVE_INDEX",
    ]);
  });

  it("installs the vault key before loading an encrypted persisted index", async () => {
    securityVaultMock.isLocked.mockReturnValue(false);
    let suppliedPasswordBytes: Uint8Array | null = null;
    securityVaultMock.withMasterPasswordBytes.mockImplementation(
      (_caller: object, callback: (bytes: Uint8Array | null) => unknown) => {
        suppliedPasswordBytes = new Uint8Array([1, 2, 3, 4]);
        return callback(suppliedPasswordBytes);
      },
    );
    const { vectorIndexService } =
      await import("../../../services/ai/VectorIndexService");

    const initialization = vectorIndexService.initialize();
    await Promise.resolve();
    const worker = MockWorker.instances[0]!;
    expect(worker.posted[0]!.type).toBe("SET_KEY");
    expect(worker.posted[0]!.payload).toMatchObject({
      vaultSalt: "ab".repeat(16),
    });
    // The retired bundle-wide constant must not reach the worker: SET_KEY is
    // keyed to the vault's own salt now (ADR-046 parity).
    expect(JSON.stringify(worker.posted[0]!.payload)).not.toContain(
      "bookmarkforge-voy-index-v1",
    );

    const setKey = worker.posted[0]!;
    worker.onmessage!({
      data: { id: setKey.id, type: "SUCCESS", payload: undefined },
    } as MessageEvent);
    for (let i = 0; i < 10 && !worker.posted.some((m) => m.type === "LOAD_INDEX"); i += 1) {
      await Promise.resolve();
    }
    const load = worker.posted.find((m) => m.type === "LOAD_INDEX")!;
    worker.onmessage!({
      data: {
        id: load.id,
        type: "SUCCESS",
        payload: { loaded: true, mode: "polar8" },
      },
    } as MessageEvent);

    await expect(initialization).resolves.toBeUndefined();
    expect(worker.posted.map((message) => message.type)).toEqual([
      "SET_KEY",
      "LOAD_INDEX",
    ]);
    expect(suppliedPasswordBytes).not.toBeNull();
    expect(suppliedPasswordBytes!.every((byte) => byte === 0)).toBe(true);
  });

  it("terminates the worker when initialization fails after worker creation", async () => {
    initDBMock.mockRejectedValueOnce(new Error("database unavailable"));
    const { vectorIndexService } =
      await import("../../../services/ai/VectorIndexService");

    const initialization = vectorIndexService.initialize();
    await Promise.resolve();
    const worker = MockWorker.instances[0]!;
    const load = worker.posted[0]!;
    worker.onmessage!({
      data: { id: load.id, type: "ERROR", error: "no persisted index" },
    } as MessageEvent);

    await expect(initialization).rejects.toThrow("database unavailable");
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect((vectorIndexService as any).worker).toBeNull();
  });

  it("rejects pending requests when clear terminates the worker", async () => {
    const { vectorIndexService } =
      await import("../../../services/ai/VectorIndexService");

    const initialize = vectorIndexService.initialize();
    await Promise.resolve();
    const worker = MockWorker.instances[0]!;
    const load = worker.posted[0]!;
    worker.onmessage!({
      data: {
        id: load.id,
        type: "SUCCESS",
        payload: { loaded: true, mode: "polar8" },
      },
    } as MessageEvent);
    await initialize;

    const stats = vectorIndexService.getStats();
    await Promise.resolve();
    const statsMessage = worker.posted[1]!;
    const clearing = vectorIndexService.clear();
    await Promise.resolve();
    const clearMessage = worker.posted[2]!;
    worker.onmessage!({
      data: { id: clearMessage.id, type: "SUCCESS", payload: undefined },
    } as MessageEvent);

    await expect(clearing).resolves.toBeUndefined();
    await expect(stats).rejects.toThrow("Vector index cleared");
    expect(vectorIndexService.getLoadStatus()).toBe("unknown");
    expect(vectorIndexService.getLoadDurationMs()).toBeNull();
    expect(statsMessage.type).toBe("GET_STATS");
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("retires the worker when it reports a fatal timeout", async () => {
    const { vectorIndexService } =
      await import("../../../services/ai/VectorIndexService");

    const initialize = vectorIndexService.initialize();
    await Promise.resolve();
    const worker = MockWorker.instances[0]!;
    const load = worker.posted[0]!;
    worker.onmessage!({
      data: {
        id: load.id,
        type: "SUCCESS",
        payload: { loaded: true, mode: "polar8" },
      },
    } as MessageEvent);
    await initialize;

    const stats = vectorIndexService.getStats();
    await Promise.resolve();
    const statsMessage = worker.posted.at(-1)!;
    worker.onmessage!({
      data: {
        id: statsMessage.id,
        type: "ERROR",
        error: "Timeout: SEARCH exceeded 15000ms",
        fatal: true,
      },
    } as MessageEvent);

    await expect(stats).rejects.toThrow("Timeout: SEARCH exceeded 15000ms");
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect((vectorIndexService as any).worker).toBeNull();
    expect((vectorIndexService as any).isInitialized).toBe(false);
  });

  it("reports locked status after vault lock invalidates the index", async () => {
    const { vectorIndexService } =
      await import("../../../services/ai/VectorIndexService");

    const initialize = vectorIndexService.initialize();
    await Promise.resolve();
    const worker = MockWorker.instances[0]!;
    const load = worker.posted[0]!;
    worker.onmessage!({
      data: {
        id: load.id,
        type: "SUCCESS",
        payload: { loaded: true, mode: "polar8" },
      },
    } as MessageEvent);
    await initialize;

    const locking = vectorIndexService.lockVault();
    await Promise.resolve();
    const clearMemory = worker.posted.at(-1)!;
    expect(clearMemory.type).toBe("CLEAR_MEMORY");
    worker.onmessage!({
      data: { id: clearMemory.id, type: "SUCCESS", payload: undefined },
    } as MessageEvent);

    await expect(locking).resolves.toBeUndefined();
    expect(vectorIndexService.getLoadStatus()).toBe("locked");
    expect(vectorIndexService.getLoadDurationMs()).toBeNull();
  });

  it("rebuilds the index from both collections when disk index is malformed", async () => {
    const chunkFind = vi.fn();
    const atomFind = vi.fn();
    chunkFind
      .mockReturnValueOnce({
        exec: vi.fn().mockResolvedValue([
          { toJSON: () => ({ id: "c1", title: "Chunk", embedding: [1, 2] }) },
          { id: "c2", content: "Content", embeddings: [3, 4] },
          { id: "c3", embedding: [] },
          { id: "c4" },
        ]),
      })
      .mockReturnValueOnce({ exec: vi.fn().mockResolvedValue([]) });
    atomFind.mockReturnValue({
      exec: vi.fn().mockResolvedValue([
        { id: "a1", parentId: "Parent", parentType: "memory", embedding: [5] },
      ]),
    });
    initDBMock.mockResolvedValueOnce({
      chunks: { find: chunkFind },
      memory: { find: atomFind },
    });

    const { vectorIndexService } =
      await import("../../../services/ai/VectorIndexService");
    vectorIndexService.setQuantizationMode("polar4");
    const initialization = vectorIndexService.initialize();
    await Promise.resolve();
    const worker = MockWorker.instances[0]!;
    const load = worker.posted[0]!;
    worker.onmessage!({
      data: {
        id: load.id,
        type: "SUCCESS",
        payload: { loaded: false, malformed: true },
      },
    } as MessageEvent);

    for (let i = 0; i < 10 && !worker.posted.some((m) => m.type === "INIT"); i += 1) {
      await Promise.resolve();
    }
    const initMessage = worker.posted.find((m) => m.type === "INIT")!;
    expect(initMessage.payload).toMatchObject({
      quantizationMode: "polar4",
      embeddings: [
        { id: "chunk:c1", title: "Chunk", embeddings: [1, 2] },
        { id: "chunk:c2", title: "Content", embeddings: [3, 4] },
        { id: "atom:a1", title: "Parent", url: "memory", embeddings: [5] },
      ],
    });
    worker.onmessage!({
      data: { id: initMessage.id, type: "SUCCESS", payload: undefined },
    } as MessageEvent);
    for (let i = 0; i < 5 && !worker.posted.some((m) => m.type === "SAVE_INDEX"); i += 1) {
      await Promise.resolve();
    }
    const saveMessage = worker.posted.find((m) => m.type === "SAVE_INDEX")!;
    worker.onmessage!({
      data: { id: saveMessage.id, type: "SUCCESS", payload: undefined },
    } as MessageEvent);

    await expect(initialization).resolves.toBeUndefined();
    expect((vectorIndexService as any).isInitialized).toBe(true);
    expect(vectorIndexService.getLoadStatus()).toBe("malformed-rebuilt");
    expect(vectorIndexService.getLoadDurationMs()).toBeGreaterThanOrEqual(0);
    expect(chunkFind).toHaveBeenCalledWith({ limit: 1000, skip: 0 });
    expect(atomFind).toHaveBeenCalledWith({ selector: { type: "atom" }, limit: 1000, skip: 0 });
  });

  it("serializes concurrent ADDs and keeps their order", async () => {
    const { vectorIndexService } =
      await import("../../../services/ai/VectorIndexService");
    const initialization = vectorIndexService.initialize();
    await Promise.resolve();
    const worker = MockWorker.instances[0]!;
    const load = worker.posted[0]!;
    worker.onmessage!({
      data: { id: load.id, type: "SUCCESS", payload: { loaded: true, mode: "polar8" } },
    } as MessageEvent);
    await initialization;

    const first = vectorIndexService.add("first", [1], "First", "url");
    const second = vectorIndexService.add("second", [2], "Second", "url");
    await Promise.resolve();
    const firstMessage = worker.posted.at(-1)!;
    expect(firstMessage).toMatchObject({ type: "ADD", payload: { id: "first" } });
    expect(worker.posted.filter((message) => message.type === "ADD")).toHaveLength(1);

    worker.onmessage!({ data: { id: firstMessage.id, type: "SUCCESS" } } as MessageEvent);
    for (let i = 0; i < 10 && worker.posted.filter((message) => message.type === "ADD").length < 2; i += 1) {
      await Promise.resolve();
    }
    const secondMessage = worker.posted.filter((message) => message.type === "ADD")[1]!;
    expect(secondMessage).toMatchObject({ type: "ADD", payload: { id: "second" } });
    worker.onmessage!({ data: { id: secondMessage.id, type: "SUCCESS" } } as MessageEvent);

    await expect(Promise.all([first, second])).resolves.toEqual([
      undefined,
      undefined,
    ]);
  });

  it("waits for a pending mutation before COMMIT", async () => {
    const { vectorIndexService } =
      await import("../../../services/ai/VectorIndexService");
    const initialization = vectorIndexService.initialize();
    await Promise.resolve();
    const worker = MockWorker.instances[0]!;
    const load = worker.posted[0]!;
    worker.onmessage!({
      data: { id: load.id, type: "SUCCESS", payload: { loaded: true, mode: "polar8" } },
    } as MessageEvent);
    await initialization;

    const adding = vectorIndexService.add("pending", [1], "Pending", "url");
    const committing = vectorIndexService.commit();
    await Promise.resolve();
    const addMessage = worker.posted.at(-1)!;
    expect(addMessage.type).toBe("ADD");
    expect(worker.posted.some((message) => message.type === "COMMIT")).toBe(false);

    worker.onmessage!({ data: { id: addMessage.id, type: "SUCCESS" } } as MessageEvent);
    for (let i = 0; i < 5 && worker.posted.at(-1)?.type !== "COMMIT"; i += 1) {
      await Promise.resolve();
    }
    const commitMessage = worker.posted.at(-1)!;
    expect(commitMessage.type).toBe("COMMIT");
    worker.onmessage!({ data: { id: commitMessage.id, type: "SUCCESS" } } as MessageEvent);
    for (let i = 0; i < 5 && worker.posted.at(-1)?.type !== "SAVE_INDEX"; i += 1) {
      await Promise.resolve();
    }
    const saveMessage = worker.posted.at(-1)!;
    expect(saveMessage.type).toBe("SAVE_INDEX");
    worker.onmessage!({ data: { id: saveMessage.id, type: "SUCCESS" } } as MessageEvent);

    await expect(Promise.all([adding, committing])).resolves.toEqual([
      undefined,
      undefined,
    ]);
  });

  it("handles normal worker operations and worker error responses", async () => {
    const { vectorIndexService } =
      await import("../../../services/ai/VectorIndexService");
    const initialize = vectorIndexService.initialize();
    await Promise.resolve();
    const worker = MockWorker.instances[0]!;
    const load = worker.posted[0]!;
    worker.onmessage!({
      data: { id: load.id, type: "SUCCESS", payload: { loaded: true, mode: "polar8" } },
    } as MessageEvent);
    await initialize;

    const statsPromise = vectorIndexService.getStats();
    await Promise.resolve();
    const statsMessage = worker.posted.at(-1)!;
    worker.onmessage!({
      data: { id: statsMessage.id, type: "SUCCESS", payload: { count: 2 } },
    } as MessageEvent);
    await expect(statsPromise).resolves.toEqual({ count: 2 });

    const addPromise = vectorIndexService.add("id", [1], "Title", "url");
    await Promise.resolve();
    const addMessage = worker.posted.at(-1)!;
    expect(addMessage).toMatchObject({ type: "ADD", payload: { id: "id" } });
    worker.onmessage!({ data: { id: addMessage.id, type: "SUCCESS" } } as MessageEvent);
    await expect(addPromise).resolves.toBeUndefined();

    const emptyBatch = await vectorIndexService.batchAdd([]);
    expect(emptyBatch).toBeUndefined();
    const batchPromise = vectorIndexService.batchAdd([
      { id: "b", embedding: [2], title: "B", url: "u" },
    ]);
    await Promise.resolve();
    const batchMessage = worker.posted.at(-1)!;
    expect(batchMessage.type).toBe("BATCH_ADD");
    worker.onmessage!({ data: { id: batchMessage.id, type: "SUCCESS" } } as MessageEvent);
    await expect(batchPromise).resolves.toBeUndefined();

    const replacePromise = vectorIndexService.replace(
      ["old-chunk", "chunk:old-chunk"],
      [{ id: "chunk:new-chunk", embedding: [4], title: "New", url: "bookmark" }],
    );
    await Promise.resolve();
    const replaceMessage = worker.posted.at(-1)!;
    expect(replaceMessage).toMatchObject({
      type: "REPLACE",
      payload: {
        removeIds: ["old-chunk", "chunk:old-chunk"],
      },
    });
    worker.onmessage!({ data: { id: replaceMessage.id, type: "SUCCESS" } } as MessageEvent);
    await expect(replacePromise).resolves.toBeUndefined();

    const removePromise = vectorIndexService.remove(["stale-atom"]);
    await Promise.resolve();
    const removeMessage = worker.posted.at(-1)!;
    expect(removeMessage).toMatchObject({
      type: "REPLACE",
      payload: { removeIds: ["stale-atom"], items: [] },
    });
    worker.onmessage!({ data: { id: removeMessage.id, type: "SUCCESS" } } as MessageEvent);
    await expect(removePromise).resolves.toBeUndefined();

    const searchPromise = vectorIndexService.search([3], 2);
    await Promise.resolve();
    const searchMessage = worker.posted.at(-1)!;
    worker.onmessage!({
      data: { id: searchMessage.id, type: "SUCCESS", payload: { neighbors: [] } },
    } as MessageEvent);
    await expect(searchPromise).resolves.toEqual({ neighbors: [] });

    const commitPromise = vectorIndexService.commit();
    const duplicateCommit = vectorIndexService.commit();
    await Promise.resolve();
    expect(worker.posted.filter((message) => message.type === "COMMIT")).toHaveLength(1);
    const commitMessage = worker.posted.at(-1)!;
    worker.onmessage!({ data: { id: commitMessage.id, type: "SUCCESS" } } as MessageEvent);
    for (let i = 0; i < 5 && worker.posted.at(-1)?.type !== "SAVE_INDEX"; i += 1) {
      await Promise.resolve();
    }
    const saveMessage = worker.posted.at(-1)!;
    expect(saveMessage.type).toBe("SAVE_INDEX");
    worker.onmessage!({ data: { id: saveMessage.id, type: "SUCCESS" } } as MessageEvent);
    await expect(Promise.all([commitPromise, duplicateCommit])).resolves.toEqual([
      undefined,
      undefined,
    ]);

    const failingStats = vectorIndexService.getStats();
    await Promise.resolve();
    const failingMessage = worker.posted.at(-1)!;
    worker.onmessage!({
      data: { id: failingMessage.id, type: "ERROR", error: "worker rejected" },
    } as MessageEvent);
    await expect(failingStats).rejects.toThrow("worker rejected");
  });

  it("skips SAVE_INDEX if the generation changes between COMMIT and save", async () => {
    const { vectorIndexService } =
      await import("../../../services/ai/VectorIndexService");
    const initialization = vectorIndexService.initialize();
    await Promise.resolve();
    const worker = MockWorker.instances[0]!;
    const load = worker.posted[0]!;
    worker.onmessage!({
      data: { id: load.id, type: "SUCCESS", payload: { loaded: true, mode: "polar8" } },
    } as MessageEvent);
    await initialization;

    const committing = vectorIndexService.commit();
    await Promise.resolve();
    const commitMessage = worker.posted.at(-1)!;
    expect(commitMessage.type).toBe("COMMIT");
    worker.onmessage!({ data: { id: commitMessage.id, type: "SUCCESS" } } as MessageEvent);
    (vectorIndexService as any).lifecycleGeneration += 1;

    await expect(committing).resolves.toBeUndefined();
    expect(worker.posted.some((message) => message.type === "SAVE_INDEX")).toBe(false);
  });

  it("cleans up after a worker crash and ignores stale worker messages", async () => {
    const { vectorIndexService } =
      await import("../../../services/ai/VectorIndexService");
    const initialize = vectorIndexService.initialize();
    await Promise.resolve();
    const firstWorker = MockWorker.instances[0]!;
    const load = firstWorker.posted[0]!;
    firstWorker.onmessage!({
      data: { id: load.id, type: "SUCCESS", payload: { loaded: true, mode: "polar8" } },
    } as MessageEvent);
    await initialize;

    const pending = vectorIndexService.search([1]);
    const handledPending = pending.catch((error: unknown) => error);
    await Promise.resolve();
    firstWorker.onerror!({ message: "fatal" } as ErrorEvent);
    await expect(handledPending).resolves.toMatchObject({ message: "Worker crashed: fatal" });
    expect((vectorIndexService as any).worker).toBeNull();
    await expect(vectorIndexService.lockVault()).resolves.toBeUndefined();

    const retry = vectorIndexService.initialize();
    await Promise.resolve();
    const secondWorker = MockWorker.instances[1]!;
    const secondLoad = secondWorker.posted[0]!;
    firstWorker.onmessage!({
      data: { id: secondLoad.id, type: "SUCCESS", payload: { loaded: true, mode: "polar8" } },
    } as MessageEvent);
    expect((vectorIndexService as any).isInitialized).toBe(false);
    secondWorker.onmessage!({
      data: { id: secondLoad.id, type: "SUCCESS", payload: { loaded: true, mode: "polar8" } },
    } as MessageEvent);
    await expect(retry).resolves.toBeUndefined();
  });

  it("covers no-op guards, duplicate messages, and initialized fast paths", async () => {
    const { vectorIndexService } =
      await import("../../../services/ai/VectorIndexService");

    await expect(vectorIndexService.getStats()).resolves.toBeNull();
    await expect(vectorIndexService.commit()).resolves.toBeUndefined();
    await expect(vectorIndexService.clear()).resolves.toBeUndefined();
    await expect(vectorIndexService.lockVault()).resolves.toBeUndefined();
    await expect(vectorIndexService.remove(["orphan"])).resolves.toBeUndefined();
    expect(MockWorker.instances).toHaveLength(0);

    const initialization = vectorIndexService.initialize();
    await Promise.resolve();
    const worker = MockWorker.instances[0]!;
    const load = worker.posted[0]!;
    // A response for an unknown request id is ignored safely.
    worker.onmessage!({ data: { id: 999_999, type: "SUCCESS", payload: {} } } as MessageEvent);
    worker.onmessage!({
      data: { id: load.id, type: "SUCCESS", payload: { loaded: true, mode: "polar8" } },
    } as MessageEvent);
    await initialization;

    // Fast paths must not create another worker or issue another request.
    await expect(vectorIndexService.initialize()).resolves.toBeUndefined();
    expect(MockWorker.instances).toHaveLength(1);
  });

  it("rejects requests without a worker, handles postMessage failures, overflow, and timeouts", async () => {
    const { vectorIndexService } =
      await import("../../../services/ai/VectorIndexService");
    const service = vectorIndexService as any;
    await expect(service.sendMessage("NO_WORKER")).rejects.toThrow(
      "Worker not initialized",
    );

    const worker = new MockWorker();
    service.worker = worker;
    worker.postMessage = vi.fn(() => {
      throw "post failed";
    });
    await expect(service.sendMessage("POST_FAILURE")).rejects.toThrow("post failed");

    worker.postMessage = vi.fn((message: PostedMessage) => worker.posted.push(message));
    // sendMessage retires a worker after a postMessage failure; install the
    // repaired test worker again before exercising queue-overflow handling.
    service.worker = worker;
    vi.useFakeTimers();
    try {
      const pending = Array.from({ length: 51 }, () => service.sendMessage("OVERFLOW"));
      // Attach handlers to every promise immediately: the overflow cleanup
      // rejects the oldest request synchronously, while the remaining ones
      // reject together when their timeout fires.
      const handled = pending.map((request) => request.catch((error: unknown) => error));
      await expect(handled[0]).resolves.toMatchObject({ message: expect.stringContaining("queue overflow") });
      await vi.advanceTimersByTimeAsync(30000);
      await expect(handled[50]).resolves.toMatchObject({ message: expect.stringContaining("timed out after 30s") });
    } finally {
      vi.useRealTimers();
    }
  });
});
