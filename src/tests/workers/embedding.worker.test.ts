import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockPipeline = vi.fn();
const mockEnv: Record<string, unknown> = {
  allowLocalModels: false,
  useBrowserCache: true,
  remoteHost: "https://huggingface.co",
  remotePathTemplate: "{model}/resolve/{revision}/",
  backends: { onnx: { wasm: { proxy: false } } },
};
vi.mock("@huggingface/transformers", () => ({
  pipeline: mockPipeline,
  // env is a named export of the real module (no default export exists)
  env: mockEnv,
}));

describe("EmbeddingWorker", () => {
  let postMessageSpy: ReturnType<typeof vi.fn>;
  let latestOutputData: Float32Array | null;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    postMessageSpy = vi.fn();
    self.postMessage = postMessageSpy as any;
    latestOutputData = new Float32Array([1, 2, 3]);
    let isFirstOutput = true;
    const mockEmbedder = vi.fn().mockImplementation(() => {
      const data = isFirstOutput
        ? latestOutputData!
        : new Float32Array([1, 2, 3]);
      isFirstOutput = false;
      return Promise.resolve({ data });
    });
    mockPipeline.mockResolvedValue(mockEmbedder);
    await import("../../services/ai/embedding.worker");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const fireMessage = (data: Record<string, unknown>) => {
    const handler = self.onmessage as unknown as (e: MessageEvent) => void;
    handler({ data } as MessageEvent);
  };

  it("sets onmessage handler after import", () => {
    expect(typeof self.onmessage).toBe("function");
  });

  it("prefetches the model without running inference", async () => {
    fireMessage({ type: "prefetch", taskId: "prefetch-1" });

    await vi.waitFor(() => {
      expect(postMessageSpy).toHaveBeenCalledWith({
        taskId: "prefetch-1",
        result: true,
      });
    });
    expect(mockPipeline).toHaveBeenCalledWith(
      "feature-extraction",
      "Xenova/all-MiniLM-L6-v2",
      { dtype: "q8" },
    );
  });

  it("generates embedding for a text message", async () => {
    fireMessage({ text: "hello world", id: "task-1" });
    await vi.waitFor(() => {
      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({ id: "task-1", embedding: [1, 2, 3] }),
      );
    });
    expect(mockPipeline).toHaveBeenCalledWith(
      "feature-extraction",
      "Xenova/all-MiniLM-L6-v2",
      { dtype: "q8" },
    );
  });

  it("releases the model output buffer after copying the embedding", async () => {
    fireMessage({ text: "release-output", id: "release-output" });
    await vi.waitFor(() => {
      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({ id: "release-output", embedding: [1, 2, 3] }),
      );
    });

    expect(latestOutputData?.every((value) => value === 0)).toBe(true);
  });

  it("handles payload field when text is absent", async () => {
    fireMessage({ payload: "payload text", id: "task-2" });
    await vi.waitFor(() => {
      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({ id: "task-2", embedding: [1, 2, 3] }),
      );
    });
  });

  it("releases original text references before inference starts", async () => {
    const message = {
      text: "large article text",
      payload: "payload text",
      id: "release-text",
    };
    fireMessage(message);

    expect(message.text).toBe("");
    expect(message.payload).toBe("");
    await vi.waitFor(() => {
      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({ id: "release-text", embedding: [1, 2, 3] }),
      );
    });
  });

  it("uses taskId as id when id is missing", async () => {
    fireMessage({ text: "test", taskId: "task-3" });
    await vi.waitFor(() => {
      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({ taskId: "task-3", embedding: [1, 2, 3] }),
      );
    });
  });

  it("reports loading status messages during initialization", async () => {
    fireMessage({ text: "first", id: "init-1" });
    await vi.waitFor(() => {
      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({ id: "init-1", embedding: [1, 2, 3] }),
      );
    });
    const statuses = postMessageSpy.mock.calls
      .filter(
        (c: unknown[]) =>
          (c[0] as Record<string, unknown>).status === "loading",
      )
      .map((c: unknown[]) => (c[0] as Record<string, unknown>).message);
    expect(statuses.length).toBeGreaterThanOrEqual(2);
  });

  it("returns error when pipeline fails", async () => {
    mockPipeline.mockRejectedValue(new Error("model load failed"));
    fireMessage({ text: "fail", id: "err-1" });
    await vi.waitFor(() => {
      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({ id: "err-1", error: "model load failed" }),
      );
    });
  });

  it("processes multiple queued messages sequentially", async () => {
    const mockEmbedder = vi.fn().mockImplementation(() =>
      Promise.resolve({ data: new Float32Array([4, 5]) }),
    );
    mockPipeline.mockResolvedValue(mockEmbedder);
    fireMessage({ text: "a", id: "q1" });
    fireMessage({ text: "b", id: "q2" });
    await vi.waitFor(() => {
      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({ id: "q2", embedding: [4, 5] }),
      );
    });
    const resultIds = postMessageSpy.mock.calls
      .filter((c: unknown[]) => (c[0] as Record<string, unknown>).embedding)
      .map((c: unknown[]) => (c[0] as Record<string, unknown>).id);
    expect(resultIds).toEqual(["q1", "q2"]);
  });

  it("times out model initialization without starting duplicate downloads", async () => {
    vi.useFakeTimers();
    mockPipeline.mockReturnValue(new Promise(() => {}));

    fireMessage({ text: "first", id: "model-timeout-1" });
    fireMessage({ text: "second", id: "model-timeout-2" });
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(120_000);
    await Promise.resolve();
    await Promise.resolve();

    expect(mockPipeline).toHaveBeenCalledTimes(1);
    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "model-timeout-1",
        error: "Timeout: embedding model initialization exceeded 120000ms",
        fatal: true,
      }),
    );
    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "model-timeout-2",
        error: "Embedding worker stopped after model initialization timeout",
        fatal: true,
      }),
    );
    vi.useRealTimers();
  });

  it("rejects queued text when the memory budget is exceeded", async () => {
    const largeText = "x".repeat(1_000_000);
    const rejectedMessage = { text: largeText, id: "memory-limit-9" };

    for (let index = 0; index < 8; index += 1) {
      fireMessage({ text: largeText, id: `memory-limit-${index}` });
    }
    fireMessage(rejectedMessage);

    expect(rejectedMessage.text).toBe("");
    expect(postMessageSpy).toHaveBeenCalledWith({
      taskId: "memory-limit-9",
      error: "Embedding worker queued text memory limit exceeded",
    });
    await vi.waitFor(() => {
      expect(postMessageSpy).toHaveBeenCalledWith(
        expect.objectContaining({ id: "memory-limit-7", embedding: [1, 2, 3] }),
      );
    });
  });

  it("poisons the worker instead of overlapping inference after a timeout", async () => {
    vi.useFakeTimers();
    const mockEmbedder = vi.fn().mockImplementation(() =>
      new Promise(() => {}),
    );
    mockPipeline.mockResolvedValue(mockEmbedder);

    fireMessage({ text: "blocked", id: "timeout-1" });
    fireMessage({ text: "after-timeout", id: "timeout-2" });
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(30_000);
    await Promise.resolve();
    await Promise.resolve();

    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "timeout-1",
        error: "Timeout: embedding inference exceeded 30000ms",
        fatal: true,
      }),
    );
    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "timeout-2",
        error: "Embedding worker stopped after inference timeout",
        fatal: true,
      }),
    );
    expect(mockEmbedder).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("auto-generates id when both id and taskId are missing", async () => {
    fireMessage({ text: "no-id" });
    await vi.waitFor(() => {
      const results = postMessageSpy.mock.calls
        .filter((c: unknown[]) => (c[0] as Record<string, unknown>).embedding)
        .map((c: unknown[]) => (c[0] as Record<string, unknown>).id);
      expect(
        results.some((id: unknown) => (id as string).startsWith("task_")),
      ).toBe(true);
    });
  });
});
