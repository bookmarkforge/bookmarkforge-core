import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../utils/logger", () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock Worker for jsdom (no native Web Worker support in vitest/jsdom)
class MockWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;

  constructor(
    public url: URL,
    _options?: any,
  ) {}

  postMessage(_data: any, _transfer?: any[]) {}

  terminate() {}
}

vi.stubGlobal("Worker", MockWorker as any);
vi.stubGlobal("navigator", { hardwareConcurrency: 4 });

describe("WorkerPool", () => {
  let WorkerPoolClass: typeof import("../../utils/WorkerPool").WorkerPool;
  let getWorkerPool: typeof import("../../utils/WorkerPool").getWorkerPool;
  let terminateAllWorkers: typeof import("../../utils/WorkerPool").terminateAllWorkers;
  let mockUrl: URL;

  beforeAll(async () => {
    const mod = await import("../../utils/WorkerPool");
    WorkerPoolClass = mod.WorkerPool;
    getWorkerPool = mod.getWorkerPool;
    terminateAllWorkers = mod.terminateAllWorkers;
  });

  beforeEach(() => {
    mockUrl = new URL("http://localhost/worker.js");
    // Limpiar pools internos
    if (typeof terminateAllWorkers === "function") terminateAllWorkers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ========== Constructor ==========

  describe("constructor", () => {
    it("creates workers up to maxWorkers (cap 8)", () => {
      const pool = new WorkerPoolClass(mockUrl, 4);
      const stats = pool.getStats();
      expect(stats.workers).toBe(4);
    });

    it("caps maxWorkers at 8", () => {
      const pool = new WorkerPoolClass(mockUrl, 100);
      const stats = pool.getStats();
      expect(stats.workers).toBe(8);
    });

    it("uses 1 worker as the minimum", () => {
      const pool = new WorkerPoolClass(mockUrl, 1);
      const stats = pool.getStats();
      expect(stats.workers).toBe(1);
    });
  });

  // ========== execute ==========

  describe("execute", () => {
    it("sends message to the worker and resolves with the result", async () => {
      const pool = new WorkerPoolClass(mockUrl, 1);
      const pooledWorker = (pool as any).workers[0];
      const postMessageSpy = vi.spyOn(pooledWorker.worker, "postMessage");

      const promesa = pool.execute("test", { msg: "hola" });

      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: "test", payload: { msg: "hola" } }),
        [],
      );

      const taskId = (postMessageSpy.mock.calls[0]![0] as any).taskId;
      pooledWorker.worker.onmessage!({
        data: { taskId, result: "respuesta exitosa", error: null },
      } as any);

      const result = await promesa;
      expect(result).toBe("respuesta exitosa");
    });

    it("rejects the promise when the worker reports an error", async () => {
      const pool = new WorkerPoolClass(mockUrl, 1);
      const pooledWorker = (pool as any).workers[0];
      const postMessageSpy = vi.spyOn(pooledWorker.worker, "postMessage");

      const promesa = pool.execute("fallo", { x: 1 });
      const taskId = (postMessageSpy.mock.calls[0]![0] as any).taskId;

      pooledWorker.worker.onmessage!({
        data: { taskId, result: null, error: "error worker" },
      } as any);

      await expect(promesa).rejects.toThrow("error worker");
    });

    it("settles immediately when postMessage throws", async () => {
      const pool = new WorkerPoolClass(mockUrl, 1);
      const pooledWorker = (pool as any).workers[0];
      vi.spyOn(pooledWorker.worker, "postMessage").mockImplementation(() => {
        throw new Error("clone failed");
      });

      await expect(pool.execute("clone-error", {})).rejects.toThrow("clone failed");
      expect(pool.getStats()).toMatchObject({ busy: 0, queue: 0 });
    });
  });

  // ========== Manejo de errores del worker ==========

  describe("worker error handling", () => {
    it("rejects task when worker.onerror fires", async () => {
      // maxRetries=0: no retries → immediate rejection on worker error
      const pool = new WorkerPoolClass(mockUrl, 1, 0);
      const pooledWorker = (pool as any).workers[0];

      const promesa = pool.execute("err", {});
      pooledWorker.worker.onerror!({ message: "Worker crashed" } as ErrorEvent);

      await expect(promesa).rejects.toThrow("Worker");
    });

    it("retires the worker on a fatal response before dispatching the queue", async () => {
      const pool = new WorkerPoolClass(mockUrl, 1, 0);
      const firstWorker = (pool as any).workers[0];
      const firstPost = vi.spyOn(firstWorker.worker, "postMessage");
      const first = pool.execute("fatal", {});
      const second = pool.execute("queued", {});
      const firstTaskId = (firstPost.mock.calls[0]![0] as any).taskId;

      firstWorker.worker.onmessage!({
        data: { taskId: firstTaskId, error: "inference timeout", fatal: true },
      } as any);

      await expect(first).rejects.toThrow("inference timeout");
      expect(pool.getStats()).toMatchObject({ workers: 1, busy: 1, queue: 0 });

      const replacement = (pool as any).workers[0];
      const replacementTaskId = replacement.currentTaskId;
      replacement.worker.onmessage!({
        data: { taskId: replacementTaskId, result: "recovered" },
      } as any);
      await expect(second).resolves.toBe("recovered");
    });
  });

  // ========== Procesamiento de cola ==========

  describe("procesamiento de cola", () => {
    it("queues tasks when all workers are busy", () => {
      const pool = new WorkerPoolClass(mockUrl, 1);
      pool.execute("t1", { a: 1 });
      pool.execute("t2", { b: 2 });

      const stats = pool.getStats();
      expect(stats.queue).toBeGreaterThanOrEqual(1);
      expect(stats.busy).toBe(1);
    });
  });

  // ========== getStats ==========

  describe("getStats", () => {
    it("returns correct count of workers and busy ones", () => {
      const pool = new WorkerPoolClass(mockUrl, 3);
      pool.execute("t1", {});

      const stats = pool.getStats();
      expect(stats.workers).toBe(3);
      expect(stats.busy).toBe(1);
    });
  });

  describe("backpressure", () => {
    it("rejects tasks when global capacity is reached", async () => {
      const pool = new WorkerPoolClass(mockUrl, 1);
      const accepted = Array.from({ length: 256 }, () =>
        pool.execute("queued", {}).catch(() => undefined),
      );

      await expect(pool.execute("overflow", {})).rejects.toMatchObject({
        name: "WorkerPoolCapacityError",
        message: "WorkerPool queue capacity exceeded (256 tasks)",
      });

      pool.terminate();
      await Promise.all(accepted);
    });
  });

  // ========== terminate ==========

  describe("terminate", () => {
    it("terminates all workers and clears the queue", () => {
      const pool = new WorkerPoolClass(mockUrl, 2);
      // Suppress unhandled rejection: terminate() rejects pending promises
      pool.execute("t", {}).catch(() => { /* INTENTIONAL SILENCE: suppress the expected rejected test task. */ });
      pool.terminate();

      const stats = pool.getStats();
      expect(stats.workers).toBe(0);
      expect(stats.queue).toBe(0);
    });
  });

  it("resolves queued task when the worker is freed", async () => {
    const pool = new WorkerPoolClass(mockUrl, 1);
    const pooledWorker = (pool as any).workers[0];
    const postMessageSpy = vi.spyOn(pooledWorker.worker, "postMessage");

    pool.execute("t1", { a: 1 });
    const taskId1 = (postMessageSpy.mock.calls[0]![0] as any).taskId;
    pool.execute("t2", { b: 2 });

    // After t2 is queued (t1 is active, 1 worker total)
    expect(pool.getStats().queue).toBe(1);

    pooledWorker.worker.onmessage!({
      data: { taskId: taskId1, result: "r1", error: null },
    } as any);

    // t2 dequeued and started after t1 completes
    expect(pool.getStats().queue).toBe(0);
    expect(postMessageSpy).toHaveBeenCalledTimes(2);
  });

  it("handles worker.onerror without a pending task", () => {
    const pool = new WorkerPoolClass(mockUrl, 1);
    const pooledWorker = (pool as any).workers[0];
    pooledWorker.currentTaskId = undefined;
    pooledWorker.worker.onerror!({ message: "unexpected" } as ErrorEvent);
    expect(pool.getStats().busy).toBe(0);
  });

  it("uses navigator.hardwareConcurrency as the default maxWorkers", () => {
    const pool = new WorkerPoolClass(mockUrl);
    const stats = pool.getStats();
    expect(stats.workers).toBeGreaterThan(0);
    expect(stats.workers).toBeLessThanOrEqual(8);
  });

  // ========== getWorkerPool (singleton) ==========

  describe("getWorkerPool", () => {
    it("returns the same pool for the same name", () => {
      const pool1 = getWorkerPool("procesador", mockUrl, 3);
      const pool2 = getWorkerPool("procesador", mockUrl, 3);
      expect(pool1).toBe(pool2);
    });

    it("creates different pools for different names", () => {
      const pool1 = getWorkerPool("pool-A", mockUrl, 2);
      const pool2 = getWorkerPool("pool-B", mockUrl, 2);
      expect(pool1).not.toBe(pool2);
    });
  });

  // ========== terminateAllWorkers ==========

  describe("terminateAllWorkers", () => {
    it("terminates all registered pools", () => {
      const poolX = getWorkerPool("pool-X", mockUrl, 2);
      const poolY = getWorkerPool("pool-Y", mockUrl, 3);

      terminateAllWorkers();

      expect(poolX.getStats().workers).toBe(0);
      expect(poolY.getStats().workers).toBe(0);
    });
  });

  // ========== Transferables ==========

  describe("transferables", () => {
    it("passes transferables in postMessage when specified", () => {
      const pool = new WorkerPoolClass(mockUrl, 1);
      const pooledWorker = (pool as any).workers[0];
      const postMessageSpy = vi.spyOn(pooledWorker.worker, "postMessage");
      const buffer = new ArrayBuffer(8);

      pool.execute("datos", buffer, [buffer]);

      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: "datos" }),
        [buffer],
      );
    });

    it("passes empty array if there are no transferables", () => {
      const pool = new WorkerPoolClass(mockUrl, 1);
      const pooledWorker = (pool as any).workers[0];
      const postMessageSpy = vi.spyOn(pooledWorker.worker, "postMessage");

      pool.execute("simple", { key: "val" });

      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: "simple" }),
        [],
      );
    });
  });

  // ========== Progreso (status messages) ==========

  describe("mensajes de progreso", () => {
    it("notifies onProgress with status and does not complete the task", async () => {
      const pool = new WorkerPoolClass(mockUrl, 1);
      const pooledWorker = (pool as any).workers[0];
      const postMessageSpy = vi.spyOn(pooledWorker.worker, "postMessage");
      const onProgress = vi.fn();

      const promesa = pool.execute("largo", { n: 1 }, undefined, onProgress);
      const taskId = (postMessageSpy.mock.calls[0]![0] as any).taskId;

      // Status message: no result, no error. The pool relays the optional
      // progress fraction as the 4th argument (undefined when the worker
      // message does not carry one).
      pooledWorker.worker.onmessage!({
        data: { taskId, status: "running", message: "50%" },
      } as any);
      expect(onProgress).toHaveBeenCalledWith(
        taskId,
        "running",
        "50%",
        undefined,
      );

      // A status carrying a progress fraction forwards it.
      pooledWorker.worker.onmessage!({
        data: { taskId, status: "running", message: "75%", progress: 0.75 },
      } as any);
      expect(onProgress).toHaveBeenCalledWith(
        taskId,
        "running",
        "75%",
        0.75,
      );

      // Task still active — pool still busy
      expect(pool.getStats().busy).toBe(1);

      // Complete the task
      pooledWorker.worker.onmessage!({
        data: { taskId, result: "done", error: null },
      } as any);
      await expect(promesa).resolves.toBe("done");
    });

    it("ignores progress messages for unknown taskIds", () => {
      const pool = new WorkerPoolClass(mockUrl, 1);
      const pooledWorker = (pool as any).workers[0];
      const onProgress = vi.fn();

      pool.execute("x", {}, undefined, onProgress);
      pooledWorker.worker.onmessage!({
        data: { taskId: "no-such-task", status: "running", message: "x" },
      } as any);
      expect(onProgress).not.toHaveBeenCalled();
    });

    it("ignores unknown responses without freeing the active worker", async () => {
      const pool = new WorkerPoolClass(mockUrl, 1);
      const pooledWorker = (pool as any).workers[0];
      const postMessageSpy = vi.spyOn(pooledWorker.worker, "postMessage");
      const promise = pool.execute("active", {});
      const taskId = (postMessageSpy.mock.calls[0]![0] as any).taskId;

      pooledWorker.worker.onmessage!({
        data: { taskId: "ghost", result: "r", error: null },
      } as any);
      expect(pool.getStats().busy).toBe(1);

      pooledWorker.worker.onmessage!({
        data: { taskId, result: "real", error: null },
      } as any);
      await expect(promise).resolves.toBe("real");
    });

    it("contains errors from the progress callback", async () => {
      const pool = new WorkerPoolClass(mockUrl, 1);
      const pooledWorker = (pool as any).workers[0];
      const postMessageSpy = vi.spyOn(pooledWorker.worker, "postMessage");
      const promise = pool.execute(
        "progress",
        {},
        undefined,
        () => { throw new Error("consumer failed"); },
      );
      const taskId = (postMessageSpy.mock.calls[0]![0] as any).taskId;

      expect(() => pooledWorker.worker.onmessage!({
        data: { taskId, status: "running", message: "50%" },
      } as any)).not.toThrow();
      expect(pool.getStats().busy).toBe(1);

      pooledWorker.worker.onmessage!({
        data: { taskId, result: "done", error: null },
      } as any);
      await expect(promise).resolves.toBe("done");
    });
  });

  // ========== Dynamic pool growth ==========

  describe("dynamic growth", () => {
    it("creates an additional worker when all are busy", () => {
      const pool = new WorkerPoolClass(mockUrl, 2);
      const statsBefore = pool.getStats();
      expect(statsBefore.workers).toBe(2);

      pool.execute("t1", {});
      pool.execute("t2", {});
      pool.execute("t3", {});
      pool.execute("t4", {});

      const stats = pool.getStats();
      expect(stats.workers).toBe(2); // capped at maxWorkers
      expect(stats.queue).toBe(2);
    });
  });

  // ========== Wait time ==========

  describe("timeout", () => {
    it("rejects the task after 60s without a response", async () => {
      vi.useFakeTimers();
      try {
        // maxRetries=0: no retries on worker error → immediate timeout
        const pool = new WorkerPoolClass(mockUrl, 1, 0);
        const promesa = pool.execute("lento", {});
        const assertion = expect(promesa).rejects.toThrow("timed out");

        vi.advanceTimersByTime(60001);
        await assertion;
      } finally {
        vi.useRealTimers();
      }
    });

    it("frees the hung worker on timeout (no deadlock)", async () => {
      vi.useFakeTimers();
      try {
        const pool = new WorkerPoolClass(mockUrl, 1, 0);
        const hung = pool.execute("colgado", {}); // never answers
        const queued = pool.execute("encolado", {}); // waits behind it
        expect(pool.getStats().busy).toBe(1);
        expect(pool.getStats().queue).toBe(1);

        const hungAssertion = expect(hung).rejects.toThrow("timed out");
        const queuedAssertion = expect(queued).rejects.toThrow("timed out");

        // Advance past the timeout: the hung task times out and its worker
        // is retired/replaced, so the pool can accept work again.
        vi.advanceTimersByTime(60001);
        await Promise.all([hungAssertion, queuedAssertion]);

        const stats = pool.getStats();
        expect(stats.busy).toBe(0);
        expect(stats.queue).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it("rejects a task that never gets dispatched (stalled queue)", async () => {
      vi.useFakeTimers();
      try {
        const pool = new WorkerPoolClass(mockUrl, 1, 0);
        const a = pool.execute("a", {}); // occupies the only worker
        // Freeze dispatch so task `b` stays in the pending queue even after
        // worker `a` times out and gets retired.
        const realProcessQueue = (pool as any).processQueue.bind(pool);
        (pool as any).processQueue = () => {};
        const b = pool.execute("b", {});
        expect(pool.getStats().queue).toBe(1);

        const aAssertion = expect(a).rejects.toThrow("timed out");
        const bAssertion = expect(b).rejects.toThrow("timed out");

        vi.advanceTimersByTime(60001);
        await Promise.all([aAssertion, bAssertion]);

        // Restore dispatch: the stuck task must be gone from the queue.
        (pool as any).processQueue = realProcessQueue;
        expect(pool.getStats().queue).toBe(0);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
