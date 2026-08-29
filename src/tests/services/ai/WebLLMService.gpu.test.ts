import { describe, expect, it, vi } from "vitest";

const requestAdapter = vi.fn();

vi.mock("../../../utils/browser-types", () => ({
  getNavigatorGPU: () => ({ requestAdapter }),
  getNavigatorExtensions: () => ({ deviceMemory: 8 }),
}));

vi.mock("../../../utils/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../../services/ai/ResourceManager", () => ({
  resourceManager: { switchToWebLLM: vi.fn() },
}));

const { WebLLMService } = await import("../../../services/ai/WebLLMService");

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
