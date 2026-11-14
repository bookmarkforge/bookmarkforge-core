import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createScanWorkerBridge } from "../../services/scanWorkerBridge";

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const mocks = vi.hoisted(() => ({
  getWorkerPool: vi.fn(),
  execute: vi.fn(),
}));

vi.mock("../../utils/WorkerPool", () => ({
  getWorkerPool: mocks.getWorkerPool,
}));

interface TestInput {
  items: string[];
}
interface TestResult {
  count: number;
}

function makeBridge(overrides: Record<string, unknown> = {}) {
  return createScanWorkerBridge<TestInput, TestResult>({
    poolName: "test-pool",
    workerUrl: "test-worker.js",
    taskName: "scan",
    timeoutMs: 50,
    abortMessage: "scan aborted",
    timeoutMessage: "scan timed out",
    logTag: "[testScan]",
    isValidResult: (v: unknown): v is TestResult =>
      typeof v === "object" &&
      v !== null &&
      typeof (v as TestResult).count === "number",
    payload: (input: TestInput) => ({ items: input.items }),
    ...overrides,
  });
}

const inlineResult: TestResult = { count: -1 };
const inline = () => inlineResult;

describe("createScanWorkerBridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getWorkerPool.mockReturnValue({ execute: mocks.execute });
    mocks.execute.mockResolvedValue({ count: 42 });
    vi.stubGlobal("Worker", class {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the worker pool and returns its validated result", async () => {
    const run = makeBridge();
    const result = await run({ items: ["a"] }, inline);
    expect(result).toEqual({ count: 42 });
    expect(mocks.getWorkerPool).toHaveBeenCalledWith(
      "test-pool",
      "test-worker.js",
      1,
    );
    expect(mocks.execute).toHaveBeenCalledWith(
      "scan",
      { items: ["a"] },
      undefined,
      expect.any(Function),
      undefined,
    );
  });

  it("relays worker progress fractions to onProgress", async () => {
    mocks.execute.mockImplementation(
      async (
        _task: string,
        _payload: unknown,
        _transfer: unknown,
        onProgress: (id: string, phase: string, msg: string, frac?: number) => void,
      ) => {
        onProgress("t1", "scan", "working", 0.5);
        onProgress("t1", "scan", "working"); // no fraction → ignored
        return { count: 1 };
      },
    );
    const seen: Array<[string, number]> = [];
    const run = makeBridge();
    await run({ items: [] }, inline, {
      onProgress: (phase, fraction) => seen.push([phase, fraction]),
    });
    expect(seen).toEqual([["scan", 0.5]]);
  });

  it("falls back to inline when Worker is unavailable", async () => {
    vi.stubGlobal("Worker", undefined);
    const run = makeBridge();
    expect(await run({ items: [] }, inline)).toBe(inlineResult);
    expect(mocks.getWorkerPool).not.toHaveBeenCalled();
  });

  it("falls back to inline on worker failure, then disables the pool after 2 consecutive failures", async () => {
    mocks.execute.mockRejectedValue(new Error("worker exploded"));
    const run = makeBridge();
    expect(await run({ items: [] }, inline)).toBe(inlineResult);
    expect(await run({ items: [] }, inline)).toBe(inlineResult);
    // Third call: pool is marked unavailable — inline without touching the pool.
    mocks.execute.mockClear();
    mocks.getWorkerPool.mockClear();
    expect(await run({ items: [] }, inline)).toBe(inlineResult);
    expect(mocks.getWorkerPool).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("a single failure does not disable the pool (self-heal window)", async () => {
    mocks.execute
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValue({ count: 7 });
    const run = makeBridge();
    expect(await run({ items: [] }, inline)).toBe(inlineResult);
    expect(await run({ items: [] }, inline)).toEqual({ count: 7 });
  });

  it("falls back to inline when the worker result fails validation", async () => {
    mocks.execute.mockResolvedValue({ bogus: true });
    const run = makeBridge();
    expect(await run({ items: [] }, inline)).toBe(inlineResult);
    // Invalid result is not counted as a worker failure.
    mocks.execute.mockResolvedValue({ count: 9 });
    expect(await run({ items: [] }, inline)).toEqual({ count: 9 });
  });

  it("times out and falls back to inline", async () => {
    mocks.execute.mockReturnValue(new Promise(() => {})); // never settles
    const run = makeBridge({ timeoutMs: 10 });
    expect(await run({ items: [] }, inline)).toBe(inlineResult);
  });

  it("rethrows AbortError without inline fallback", async () => {
    const abort = new Error("scan aborted");
    abort.name = "AbortError";
    mocks.execute.mockRejectedValue(abort);
    const run = makeBridge();
    const inlineSpy = vi.fn(inline);
    await expect(run({ items: [] }, inlineSpy)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(inlineSpy).not.toHaveBeenCalled();
  });

  it("throws AbortError when the signal aborts after a valid result", async () => {
    const controller = new AbortController();
    mocks.execute.mockImplementation(async () => {
      controller.abort();
      return { count: 1 };
    });
    const run = makeBridge();
    await expect(
      run({ items: [] }, inline, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
