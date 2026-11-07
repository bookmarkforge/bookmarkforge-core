import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkerManager } from "../../utils/WorkerManager";

class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
}

describe("WorkerManager", () => {
  let worker: FakeWorker;
  beforeEach(() => {
    worker = new FakeWorker();
    vi.stubGlobal("Worker", class { constructor() { return worker as unknown as Worker; } });
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "request-1") });
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("enqueues and resolves a worker response", async () => {
    const manager = new WorkerManager({ workerUrl: "worker.js", name: "test" });
    const promise = manager.enqueue("ping", { value: 1 });
    expect(worker.postMessage).toHaveBeenCalledWith({ id: "request-1", type: "ping", payload: { value: 1 } }, []);
    worker.onmessage?.({ data: { id: "request-1", result: "pong" } } as MessageEvent);
    await expect(promise).resolves.toBe("pong");
  });

  it("rejects worker responses containing an error", async () => {
    const manager = new WorkerManager({ workerUrl: "worker.js", name: "test" });
    const promise = manager.enqueue("ping", null);
    worker.onmessage?.({ data: { id: "request-1", error: "bad request" } } as MessageEvent);
    await expect(promise).rejects.toThrow("bad request");
  });

  it("rejects aborted requests and retires the worker", async () => {
    const manager = new WorkerManager({ workerUrl: "worker.js", name: "test" });
    const controller = new AbortController();
    const promise = manager.enqueue("ping", null, { signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(worker.terminate).toHaveBeenCalled();
  });

  it("rejects immediately when the signal was already aborted", () => {
    const manager = new WorkerManager({ workerUrl: "worker.js", name: "test" });
    const controller = new AbortController();
    controller.abort();
    void manager.enqueue("ping", null, { signal: controller.signal }).catch((error: unknown) => {
      expect(error).toMatchObject({ name: "AbortError" });
    });
  });

  it("times out and retires a hung worker", async () => {
    const manager = new WorkerManager({ workerUrl: "worker.js", name: "test", timeoutMs: 10 });
    const promise = manager.enqueue("slow", null);
    vi.advanceTimersByTime(10);
    await expect(promise).rejects.toThrow("timeout");
    expect(worker.terminate).toHaveBeenCalled();
  });

  it("rejects when the worker errors and supports explicit termination", async () => {
    const manager = new WorkerManager({ workerUrl: "worker.js", name: "test" });
    const promise = manager.enqueue("ping", null);
    worker.onerror?.({ message: "crashed" } as ErrorEvent);
    await expect(promise).rejects.toThrow("crashed");
    expect(manager.lifecycleGeneration).toBe(1);
    manager.terminate();
    expect(manager.lifecycleGeneration).toBe(2);
  });

  it("enforces queue capacity and invalidation", async () => {
    const manager = new WorkerManager({ workerUrl: "worker.js", name: "test", maxPending: 1 });
    const first = manager.enqueue("one", null);
    await expect(manager.enqueue("two", null)).rejects.toThrow("queue full");
    manager.invalidate();
    await expect(first).rejects.toThrow("invalidated");
    expect(manager.lifecycleGeneration).toBe(1);
  });
});
