import { describe, it, expect, vi, beforeEach } from "vitest";

const workerPool = vi.hoisted(() => ({
  getWorkerPool: vi.fn(),
}));
vi.mock("../../utils/WorkerPool", () => ({
  getWorkerPool: workerPool.getWorkerPool,
}));

type FakePool = { execute: ReturnType<typeof vi.fn> };

function fakePool(result?: unknown, error?: Error): FakePool {
  const execute = vi.fn(() =>
    error
      ? Promise.reject(error)
      : Promise.resolve(result),
  );
  return { execute };
}

const ja = { id: "1", title: "日本語の記事", url: "", tags: ["ml"] };
const en = { id: "2", title: "English ML Guide", url: "", tags: ["ml"] };

describe("knowledgeScanService", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  const load = () => import("../../services/knowledgeScanService");

  it("runs the scan in the worker with payload, signal and progress callback", async () => {
    const pool = fakePool([{ topic: "ml", pairs: [] }]);
    workerPool.getWorkerPool.mockReturnValue(pool);
    const { scanCrossLanguageBridges } = await load();
    const controller = new AbortController();
    const progress = vi.fn();

    const result = await scanCrossLanguageBridges(
      [ja, en],
      { maxItemsPerLang: 50 },
      { signal: controller.signal, onProgress: progress },
    );

    expect(result).toEqual([{ topic: "ml", pairs: [] }]);
    expect(workerPool.getWorkerPool).toHaveBeenCalledWith(
      "knowledge-scan",
      expect.anything(),
      1,
    );
    const [type, payload, transferables, onProgress, signal] =
      pool.execute.mock.calls[0]!;
    expect(type).toBe("crossLanguageScan");
    expect(payload).toEqual({
      bookmarks: [ja, en],
      options: { maxItemsPerLang: 50 },
    });
    expect(transferables).toBeUndefined();
    expect(typeof onProgress).toBe("function");
    expect(signal).toBe(controller.signal);

    // The worker's status messages are relayed to the caller callback.
    onProgress("task-1", "comparing", undefined, 0.5);
    expect(progress).toHaveBeenCalledWith("comparing", 0.5);
  });

  it("rethrows an AbortError from the worker instead of falling back inline", async () => {
    const abortError = new Error("Worker task aborted");
    abortError.name = "AbortError";
    const pool = fakePool(undefined, abortError);
    workerPool.getWorkerPool.mockReturnValue(pool);
    const { scanCrossLanguageBridges } = await load();

    await expect(
      scanCrossLanguageBridges([ja, en], {}, {
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("falls back inline on a worker failure and reports progress through the callback", async () => {
    const pool = fakePool(undefined, new Error("worker blew up"));
    workerPool.getWorkerPool.mockReturnValue(pool);
    const { scanCrossLanguageBridges } = await load();
    const progress = vi.fn();

    const result = await scanCrossLanguageBridges(
      [ja, en],
      {},
      { onProgress: progress },
    );

    expect(result).toHaveLength(1);
    expect(progress.mock.calls.length).toBeGreaterThan(0);
    expect(progress.mock.calls[0]).toEqual(["sampling", 0.05]);
    expect(progress.mock.calls[progress.mock.calls.length - 1]).toEqual([
      "done",
      1,
    ]);
  });

  it("aborts the inline fallback when the signal is already aborted", async () => {
    const pool = fakePool(undefined, new Error("worker blew up"));
    workerPool.getWorkerPool.mockReturnValue(pool);
    const controller = new AbortController();
    controller.abort();
    const { scanCrossLanguageBridges } = await load();

    await expect(
      scanCrossLanguageBridges([ja, en], {}, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("falls back inline when the worker result is not an array", async () => {
    const pool = fakePool({ not: "an array" });
    workerPool.getWorkerPool.mockReturnValue(pool);
    const { scanCrossLanguageBridges } = await load();

    const result = await scanCrossLanguageBridges([ja, en]);
    expect(result).toHaveLength(1);
  });

  it("disables the pool after repeated failures and scans inline", async () => {
    const pool = fakePool(undefined, new Error("boom"));
    workerPool.getWorkerPool.mockReturnValue(pool);
    const { scanCrossLanguageBridges } = await load();

    // Two consecutive failures flip poolUnavailable.
    await scanCrossLanguageBridges([ja, en]);
    await scanCrossLanguageBridges([ja, en]);
    expect(pool.execute).toHaveBeenCalledTimes(2);

    // Third call starts with poolUnavailable=true: it must skip pool creation
    // entirely and go directly to the bounded inline implementation.
    workerPool.getWorkerPool.mockClear();
    const result = await scanCrossLanguageBridges([ja, en]);
    expect(result).toHaveLength(1);
    expect(workerPool.getWorkerPool).not.toHaveBeenCalled();
    expect(pool.execute).toHaveBeenCalledTimes(2);
  });

  it("aborts an inline fallback when the signal is cancelled mid-computation", async () => {
    const pool = fakePool(undefined, new Error("worker unavailable"));
    workerPool.getWorkerPool.mockReturnValue(pool);
    const { scanCrossLanguageBridges } = await load();
    const controller = new AbortController();
    const progress: string[] = [];
    const onProgress = vi.fn((phase: string) => {
      progress.push(phase);
      // Cancel after inline sampling has started the comparison phase. The
      // next coarse checkpoint must stop the computation before `done`.
      if (phase === "comparing" && !controller.signal.aborted) {
        controller.abort();
      }
    });

    const bookmarks = [
      ja,
      en,
      { id: "3", title: "Русская статья", url: "", tags: ["ml"] },
      { id: "4", title: "مقالة عربية", url: "", tags: ["ml"] },
      { id: "5", title: "हिन्दी लेख", url: "", tags: ["ml"] },
    ];

    await expect(
      scanCrossLanguageBridges(bookmarks, {}, {
        signal: controller.signal,
        onProgress,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(progress).toContain("sampling");
    expect(progress).toContain("comparing");
    expect(progress).not.toContain("done");
  });
});
