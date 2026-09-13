import { describe, expect, it, vi, afterEach } from "vitest";

const requestAdapter = vi.fn();

// Device memory is read at call time so tests can simulate low-RAM devices
// without re-mocking the module (the factory runs once at import).
let mockDeviceMemory = 8;

vi.mock("../../../utils/browser-types", () => ({
  getNavigatorGPU: () => ({ requestAdapter }),
  getNavigatorExtensions: () => ({ deviceMemory: mockDeviceMemory }),
}));

vi.mock("../../../utils/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../../services/ai/ResourceManager", () => ({
  resourceManager: { switchToWebLLM: vi.fn() },
}));

const { WebLLMService } = await import("../../../services/ai/WebLLMService");

afterEach(() => {
  mockDeviceMemory = 8;
});

describe("WebLLMService GPU selection", () => {
  it("requests a high-performance adapter before falling back to low-power", async () => {
    const adapter = { features: new Set(["shader-f16"]) };
    requestAdapter.mockReset();
    requestAdapter.mockResolvedValueOnce(adapter);

    const service = new WebLLMService();
    await expect(service.isWebGPUSupported()).resolves.toBe(true);

    expect(requestAdapter).toHaveBeenCalledTimes(1);
    expect(requestAdapter).toHaveBeenCalledWith({ powerPreference: "high-performance" });
  });

  it("falls back to low-power only when high-performance returns no adapter", async () => {
    const adapter = { features: new Set(["shader-f16"]) };
    requestAdapter.mockReset();
    requestAdapter.mockResolvedValueOnce(null).mockResolvedValueOnce(adapter);

    const service = new WebLLMService();
    await expect(service.isWebGPUSupported()).resolves.toBe(true);

    expect(requestAdapter).toHaveBeenNthCalledWith(1, { powerPreference: "high-performance" });
    expect(requestAdapter).toHaveBeenNthCalledWith(2, { powerPreference: "low-power" });
  });
});

describe("device profiles without a usable GPU", () => {
  it("reports unsupported when BOTH high-performance and low-power return null", async () => {
    // Device exposes the WebGPU API but has no usable adapter at any
    // preference level (headless GPU, remote/limited environments).
    requestAdapter.mockReset();
    requestAdapter.mockResolvedValue(null);

    const service = new WebLLMService();
    await expect(service.isWebGPUSupported()).resolves.toBe(false);

    expect(requestAdapter).toHaveBeenNthCalledWith(1, {
      powerPreference: "high-performance",
    });
    expect(requestAdapter).toHaveBeenNthCalledWith(2, {
      powerPreference: "low-power",
    });
  });

  it("rejects init when the API exists but no adapter is available", async () => {
    requestAdapter.mockReset();
    requestAdapter.mockResolvedValue(null);

    const service = new WebLLMService();
    await expect(service.init()).rejects.toThrow("WebGPU is not supported");

    const metrics = service.getMetrics();
    expect(metrics.errorCount).toBe(1);
    expect((service as any).lastError).toContain("WebGPU is not supported");
    expect((service as any).f16Supported).toBe(false);
    expect((service as any).engine).toBeNull();
    expect((service as any).isInitializing).toBe(false);
  });

  it("reports canRunLocalLLM=false in health status when no adapter exists", async () => {
    requestAdapter.mockReset();
    requestAdapter.mockResolvedValue(null);

    const service = new WebLLMService();
    const status = await service.getHealthStatus();

    expect(status.webGPUSupported).toBe(false);
    expect(status.f16Supported).toBe(false);
    expect(status.healthy).toBe(false);
    expect(status.canRunLocalLLM).toBe(false);
  });

  it("handles requestAdapter throwing during init without side effects", async () => {
    requestAdapter.mockReset();
    requestAdapter.mockRejectedValue(new Error("GPU error"));

    const service = new WebLLMService();
    await expect(service.init()).rejects.toThrow("WebGPU is not supported");

    const status = await service.getHealthStatus();
    expect(status.webGPUSupported).toBe(false);
    expect(status.f16Supported).toBe(false);
    expect(status.canRunLocalLLM).toBe(false);
    expect((service as any).isInitializing).toBe(false);
  });

  it("caches the false verdict after a rejecting requestAdapter — one probe across two callers — and assertCanRunLocalLLM throws the WebGPU error", async () => {
    // Detection-ERROR path (driver crash / device lost): the rejection must
    // behave exactly like a null adapter — converted to a cached false by
    // the probe's catch — and the cache must then serve every later caller.
    // A probe that re-requested the adapter on every call would re-throw
    // (or re-wake the GPU stack) on every health check; the one-probe
    // contract is what keeps canRunLocalLLM() ~free after boot.
    requestAdapter.mockReset();
    requestAdapter.mockRejectedValue(
      new DOMException(
        "GPU adapter acquisition failed (device lost)",
        "OperationError",
      ),
    );

    const service = new WebLLMService();

    // First probe: the catch converts the rejection into a cached false.
    await expect(service.isWebGPUSupported()).resolves.toBe(false);
    // Second probe: served from cache — the adapter request is NOT retried.
    await expect(service.isWebGPUSupported()).resolves.toBe(false);
    // Exactly ONE adapter request total: the rejecting high-performance
    // attempt (the low-power fallback never runs — the first rejection
    // aborts the whole expression before it).
    expect(requestAdapter).toHaveBeenCalledTimes(1);

    // The throw-based gate shares the same cached verdict: callers needing
    // the PRECISE blocker get the capability error — never the misleading
    // "engine not initialized" state error, never an f16 cross-message —
    // and the assert consumes the cache too (still exactly one request).
    await expect(service.assertCanRunLocalLLM()).rejects.toThrow(
      "WebGPU is not supported in this browser",
    );
    expect(requestAdapter).toHaveBeenCalledTimes(1);
  });
});

describe("adapters without shader-f16 (half-precision)", () => {
  it("reports GPU present but f16 unsupported and not runnable", async () => {
    requestAdapter.mockReset();
    requestAdapter.mockResolvedValueOnce({ features: new Set<string>() });

    const service = new WebLLMService();
    await expect(service.isWebGPUSupported()).resolves.toBe(true);

    const status = await service.getHealthStatus();
    expect(status.webGPUSupported).toBe(true);
    expect(status.f16Supported).toBe(false);
    expect(status.canRunLocalLLM).toBe(false);
  });

  it("rejects init before engine creation when the adapter lacks shader-f16", async () => {
    requestAdapter.mockReset();
    requestAdapter.mockResolvedValueOnce({ features: new Set<string>() });

    const service = new WebLLMService();
    await expect(service.init()).rejects.toThrow(/shader-f16/);

    const metrics = service.getMetrics();
    expect(metrics.errorCount).toBe(1);
    expect((service as any).lastError).toContain("shader-f16");
    expect((service as any).engine).toBeNull();
    expect((service as any).isInitializing).toBe(false);
  });
});

describe("generateText capability guard (defense in depth)", () => {
  it("surfaces the WebGPU error (not 'engine not initialized') on a GPU-less device", async () => {
    // A direct generateText() caller that bypasses ProviderManager's
    // generation path must still fail closed with the precise capability
    // error — never the misleading engine-state error — and must not record
    // a generation attempt.
    requestAdapter.mockReset();
    requestAdapter.mockResolvedValue(null);

    const service = new WebLLMService();
    await expect(service.generateText("Hello")).rejects.toThrow(
      "WebGPU is not supported in this browser",
    );

    const metrics = service.getMetrics();
    expect(metrics.generationCount).toBe(0);
    expect((service as any).engine).toBeNull();
  });

  it("surfaces the shader-f16 error on an adapter without half-precision", async () => {
    requestAdapter.mockReset();
    requestAdapter.mockResolvedValueOnce({ features: new Set<string>() });

    const service = new WebLLMService();
    await expect(service.generateText("Hello")).rejects.toThrow(/shader-f16/);

    const metrics = service.getMetrics();
    expect(metrics.generationCount).toBe(0);
    expect((service as any).engine).toBeNull();
  });
});

describe("assertCanRunLocalLLM low-RAM error (throw-based mirror of canRunLocalLLM)", () => {
  it("throws the dedicated low-RAM error below 4 GB even with a capable GPU", async () => {
    // The throw-based gate must enforce ALL THREE hard blockers. A forced
    // webllm selection on a low-RAM device must fail HERE with the memory
    // error — not slip past the pre-assert and die later with the
    // misleading "engine not initialized" state error.
    mockDeviceMemory = 3;
    requestAdapter.mockReset();
    requestAdapter.mockResolvedValue({
      features: new Set(["shader-f16"]),
    });

    const service = new WebLLMService();

    await expect(service.assertCanRunLocalLLM()).rejects.toThrow(
      /Insufficient device memory for local AI models: 3 GB available, 4 GB required/,
    );
  });

  it("passes at exactly 4 GB (boundary is inclusive)", async () => {
    mockDeviceMemory = 4;
    requestAdapter.mockReset();
    requestAdapter.mockResolvedValue({
      features: new Set(["shader-f16"]),
    });

    const service = new WebLLMService();

    await expect(service.assertCanRunLocalLLM()).resolves.toBeUndefined();
  });

  it("still reports WebGPU first when both WebGPU and memory are blocked", async () => {
    // Deterministic precedence: the most actionable cause is surfaced (no
    // GPU surface trumps low RAM — the remedy order matches the gate order).
    // mockResolvedValue(null), not mockReset(): the real WebGPU API returns
    // null when no adapter exists, and an unconfigured mock returning
    // undefined would slip past the `adapter !== null` surface check.
    mockDeviceMemory = 2;
    requestAdapter.mockReset();
    requestAdapter.mockResolvedValue(null);
    const service = new WebLLMService();

    await expect(service.assertCanRunLocalLLM()).rejects.toThrow(
      /WebGPU is not supported/,
    );
  });

  it("generateText surfaces the low-RAM error without touching the engine (defense in depth)", async () => {
    // The direct-caller path inherits the dedicated error too.
    mockDeviceMemory = 3;
    requestAdapter.mockReset();
    requestAdapter.mockResolvedValue({
      features: new Set(["shader-f16"]),
    });

    const service = new WebLLMService();

    await expect(service.generateText("Test prompt")).rejects.toThrow(
      /Insufficient device memory/,
    );
    expect(service.getMetrics().generationCount).toBe(0);
  });

  it("init surfaces the low-RAM error before engine creation", async () => {
    mockDeviceMemory = 3;
    requestAdapter.mockReset();
    requestAdapter.mockResolvedValue({
      features: new Set(["shader-f16"]),
    });

    const service = new WebLLMService();

    await expect(service.init()).rejects.toThrow(/Insufficient device memory/);
    // The gate fires before engine creation: no engine object exists and the
    // model is not loaded (the attempt is recorded in metrics, as with any
    // other fast-fail — that accounting is what the warmup-savings E2E uses).
    expect(service.isModelLoaded()).toBe(false);
    const status = await service.getHealthStatus();
    expect(status.engineReady).toBe(false);
  });
});

describe("device memory boundary for local LLM viability", () => {
  it("refuses local LLM below 4 GB even with a capable adapter", async () => {
    mockDeviceMemory = 3;
    requestAdapter.mockReset();
    requestAdapter.mockResolvedValueOnce({
      features: new Set(["shader-f16"]),
    });

    const service = new WebLLMService();
    const status = await service.getHealthStatus();

    expect(status.webGPUSupported).toBe(true);
    expect(status.f16Supported).toBe(true);
    expect(status.canRunLocalLLM).toBe(false);
  });

  it("allows local LLM at exactly 4 GB with a capable adapter", async () => {
    mockDeviceMemory = 4;
    requestAdapter.mockReset();
    requestAdapter.mockResolvedValueOnce({
      features: new Set(["shader-f16"]),
    });

    const service = new WebLLMService();
    const status = await service.getHealthStatus();

    expect(status.webGPUSupported).toBe(true);
    expect(status.f16Supported).toBe(true);
    expect(status.canRunLocalLLM).toBe(true);
  });
});