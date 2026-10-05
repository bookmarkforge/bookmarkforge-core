import { describe, expect, it, vi, beforeEach } from "vitest";

const workerPool = vi.hoisted(() => ({
  getWorkerPool: vi.fn(),
}));
vi.mock("../../utils/WorkerPool", () => ({
  getWorkerPool: workerPool.getWorkerPool,
}));

type FakePool = { execute: ReturnType<typeof vi.fn> };

function fakePool(result?: unknown, error?: Error): FakePool {
  const execute = vi.fn(() =>
    error ? Promise.reject(error) : Promise.resolve(result),
  );
  return { execute };
}

const bookmark = {
  id: "1",
  title: "Audit bookmark",
  tags: ["ai"],
  createdAt: new Date().toISOString(),
  lastVisitedAt: "",
  updatedAt: new Date().toISOString(),
};

describe("auditScanService", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  const load = () => import("../../services/auditScanService");

  it("runs in the worker and relays progress plus the AbortSignal", async () => {
    const pool = fakePool({
      totalTags: 1,
      visitedIn30d: 0,
      coverageByTag: [{ tag: "ai", count: 1, lastVisitDays: -1 }],
      outdatedCount: 0,
    });
    workerPool.getWorkerPool.mockReturnValue(pool);
    const { runAuditScan } = await load();
    const controller = new AbortController();
    const progress = vi.fn();

    const result = await runAuditScan([bookmark], {
      signal: controller.signal,
      onProgress: progress,
    });

    expect(result.totalTags).toBe(1);
    expect(workerPool.getWorkerPool).toHaveBeenCalledWith(
      "audit-scan",
      expect.anything(),
      1,
    );
    const [type, payload, transferables, onProgress, signal] =
      pool.execute.mock.calls[0]!;
    expect(type).toBe("auditScan");
    expect(payload).toEqual({ bookmarks: [bookmark] });
    expect(transferables).toBeUndefined();
    expect(typeof onProgress).toBe("function");
    expect(signal).toBe(controller.signal);

    onProgress("task-1", "aggregating", undefined, 0.5);
    expect(progress).toHaveBeenCalledWith("aggregating", 0.5);
  });

  it("propagates worker cancellation instead of falling back inline", async () => {
    const abortError = new Error("Worker task aborted");
    abortError.name = "AbortError";
    workerPool.getWorkerPool.mockReturnValue(fakePool(undefined, abortError));
    const { runAuditScan } = await load();

    await expect(
      runAuditScan([bookmark], { signal: new AbortController().signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("falls back inline and reports progress when the worker fails", async () => {
    workerPool.getWorkerPool.mockReturnValue(
      fakePool(undefined, new Error("worker failed")),
    );
    const { runAuditScan } = await load();
    const progress = vi.fn();

    const result = await runAuditScan([bookmark], { onProgress: progress });

    expect(result.totalTags).toBe(1);
    expect(progress.mock.calls).toEqual([
      ["scanning", 0.05],
      ["aggregating", 0.5],
      ["done", 1],
    ]);
  });

  it("aborts before inline work when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    workerPool.getWorkerPool.mockReturnValue(
      fakePool(undefined, new Error("worker failed")),
    );
    const { runAuditScan } = await load();

    await expect(
      runAuditScan([bookmark], { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
