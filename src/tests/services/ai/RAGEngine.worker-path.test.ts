// RAGEngine.worker-path.test.ts — regression guard for P84.
//
// The embedding worker used to be emitted into dist/assets as a RAW .ts file
// (Vite's static worker detection was defeated by the getWorkerPool()
// indirection), so `new Worker(embedding.worker-*.ts)` threw at runtime and
// every embedding silently fell back to the main thread. This spec locks the
// worker path: when the worker pool is available, generateEmbedding MUST
// dispatch the task to the worker (execute) and MUST NOT touch the main-thread
// transformers pipeline.
//
// Scope: this is the UNIT layer (does RAGEngine dispatch to the pool?). The
// build-time `isRawSourceEmitted` guard in scripts/check-bundle-budget.mjs
// covers the compiled-chunk aspect, and embedding.worker.test.ts covers the
// worker logic in isolation.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockPipeline = vi.fn();
vi.mock("@huggingface/transformers", () => ({
  pipeline: mockPipeline,
  env: {
    allowLocalModels: true,
    useBrowserCache: true,
    remoteHost: "https://huggingface.co",
    remotePathTemplate: "{model}/resolve/{revision}/",
    backends: { onnx: { wasm: { proxy: false } } },
  },
}));

// Mock the worker pool module: RAGEngine imports getWorkerPool from it.
const executeMock = vi.fn();
vi.mock("../../../utils/WorkerPool", () => ({
  getWorkerPool: () => ({
    execute: executeMock,
    terminate: vi.fn(),
    getStats: () => ({ workers: 2, busy: 0, queue: 0 }),
  }),
}));

// describe.sequential: tests share ragEngineMod and global mocks; parallel
// in-file execution can race worker teardown under heavy machine load
// (the source of rare flakes in full runs).
describe.sequential("RAGEngine worker path", () => {
  let ragEngineMod: typeof import("../../../services/ai/RAGEngine");

  beforeEach(async () => {
    vi.resetModules();
    // mockReset (not clearAllMocks): also clears mockResolvedValue/
    // mockRejectedValue so a future test cannot inherit stale behavior.
    executeMock.mockReset();
    vi.clearAllMocks();
    // jsdom has no real Worker; provide a no-op so WorkerPool code paths that
    // run at import time (if any) don't crash.
    class MockWorker {
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror: ((e: ErrorEvent) => void) | null = null;
      postMessage(_d: unknown, _t?: unknown[]) {}
      terminate() {}
    }
    vi.stubGlobal("Worker", MockWorker as any);
    // Surgical stub: patch only hardwareConcurrency on the real navigator
    // so transitive imports reading other navigator fields stay intact.
    Object.defineProperty(navigator, "hardwareConcurrency", {
      value: 4,
      configurable: true,
    });
    ragEngineMod = await import("../../../services/ai/RAGEngine");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (navigator as { hardwareConcurrency?: number }).hardwareConcurrency;
  });

  it("dispatches embeddings to the worker instead of the main-thread fallback", async () => {
    executeMock.mockResolvedValue([0.1, 0.2, 0.3]);

    const result = await ragEngineMod.ragEngine.generateEmbedding("hello");

    // Worker path: the task went through the pool...
    expect(executeMock).toHaveBeenCalledWith(
      "embed",
      "hello",
      undefined,
      expect.any(Function),
      undefined,
    );
    // ...and the main-thread pipeline was never touched.
    expect(mockPipeline).not.toHaveBeenCalled();
    expect(result).toEqual([0.1, 0.2, 0.3]);
  });

  it("falls back to main thread only when the worker path fails", async () => {
    executeMock.mockRejectedValue(new Error("worker crashed"));

    const mockEmbedder = vi.fn().mockResolvedValue({ data: [9, 9] });
    mockPipeline.mockResolvedValue(mockEmbedder);

    const result = await ragEngineMod.ragEngine.generateEmbedding("fallback");

    expect(executeMock).toHaveBeenCalled();
    expect(mockPipeline).toHaveBeenCalled();
    expect(result).toEqual([9, 9]);
  });

  it("propagates worker capacity backpressure without main-thread fallback", async () => {
    const capacityError = new Error("queue is full");
    capacityError.name = "WorkerPoolCapacityError";
    executeMock.mockRejectedValue(capacityError);
    mockPipeline.mockResolvedValue(vi.fn().mockResolvedValue({ data: [9, 9] }));

    await expect(
      ragEngineMod.ragEngine.generateEmbedding("backpressure"),
    ).rejects.toMatchObject({
      name: "WorkerPoolCapacityError",
      message: "queue is full",
    });
    expect(mockPipeline).not.toHaveBeenCalled();
  });
});
