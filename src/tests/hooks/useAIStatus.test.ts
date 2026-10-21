import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { act } from "react";
import { logger } from "../../utils/logger";

const mockGetProviderInfo = vi.fn();
vi.mock("../../services/ai/ProviderManager", () => ({
  aiManager: { getProviderInfo: mockGetProviderInfo },
}));
vi.mock("../../utils/logger", () => ({ logger: { warn: vi.fn() } }));

describe("useAIStatus", () => {
  let useAIStatus: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    const mod = await import("../../hooks/useAIStatus");
    useAIStatus = mod.useAIStatus;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should return provider info from manager", () => {
    mockGetProviderInfo.mockReturnValue({
      name: "TestAI",
      model: "test-model",
      provider: "test",
      fullSupport: true,
      isConfigured: true,
    });

    const { result } = renderHook(() => useAIStatus());
    expect(result.current.provider).toBe("TestAI");
    expect(result.current.model).toBe("test-model");
    expect(result.current.isConfigured).toBe(true);
  });

  it("should set isLocal for ollama", () => {
    mockGetProviderInfo.mockReturnValue({
      name: "Ollama",
      model: "llama3",
      provider: "ollama",
      fullSupport: true,
      isConfigured: true,
    });

    const { result } = renderHook(() => useAIStatus());
    expect(result.current.isLocal).toBe(true);
  });

  it("should return initial status on error", () => {
    mockGetProviderInfo.mockImplementation(() => {
      throw new Error("fail");
    });

    const { result } = renderHook(() => useAIStatus());
    expect(result.current.provider).toBe("Gemini");
    expect(result.current.model).toBe("gemini-2.0-flash-exp");
    expect(result.current.isConfigured).toBe(false);
  });

  it("should poll for updates every 5s", () => {
    mockGetProviderInfo.mockReturnValue({
      name: "Initial",
      model: "v1",
      provider: "test",
      fullSupport: true,
      isConfigured: false,
    });

    const { result } = renderHook(() => useAIStatus());
    expect(result.current.provider).toBe("Initial");

    mockGetProviderInfo.mockReturnValue({
      name: "Updated",
      model: "v2",
      provider: "test",
      fullSupport: true,
      isConfigured: true,
    });

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(result.current.provider).toBe("Updated");
    expect(result.current.isConfigured).toBe(true);
  });

  it("should clear interval on unmount", () => {
    const clearIntervalSpy = vi.spyOn(global, "clearInterval");
    mockGetProviderInfo.mockReturnValue({
      name: "Test",
      model: "v1",
      provider: "test",
      fullSupport: true,
      isConfigured: true,
    });

    const { unmount } = renderHook(() => useAIStatus());
    unmount();

    expect(clearIntervalSpy).toHaveBeenCalled();
    clearIntervalSpy.mockRestore();
  });

  it("should set isLocal for webllm provider", () => {
    mockGetProviderInfo.mockReturnValue({
      name: "WebLLM",
      model: "qwen2.5",
      provider: "webllm",
      fullSupport: true,
      isConfigured: true,
    });

    const { result } = renderHook(() => useAIStatus());
    expect(result.current.isLocal).toBe(true);
  });

  it("keeps previous state when poll returns identical values", () => {
    mockGetProviderInfo.mockReturnValue({
      name: "Same",
      model: "v1",
      provider: "test",
      fullSupport: true,
      isConfigured: false,
    });

    const { result } = renderHook(() => useAIStatus());
    expect(result.current.provider).toBe("Same");

    // Advance a full tick with unchanged data — state must not be replaced
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current.provider).toBe("Same");
    expect(result.current.isConfigured).toBe(false);
  });

  it("warns and keeps status when poll throws", () => {
    mockGetProviderInfo.mockReturnValue({
      name: "Initial",
      model: "v1",
      provider: "test",
      fullSupport: true,
      isConfigured: false,
    });

    const { result } = renderHook(() => useAIStatus());
    expect(result.current.provider).toBe("Initial");

    mockGetProviderInfo.mockImplementation(() => {
      throw new Error("poll failure");
    });
    (logger.warn as ReturnType<typeof vi.fn>).mockClear();
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(result.current.provider).toBe("Initial");
    expect(logger.warn).toHaveBeenCalled();
  });

  it("skips polling while the document is hidden", () => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    mockGetProviderInfo.mockReturnValue({
      name: "VisibleOnly",
      model: "v1",
      provider: "test",
      fullSupport: true,
      isConfigured: false,
    });

    const { result } = renderHook(() => useAIStatus());
    expect(result.current.provider).toBe("VisibleOnly");

    mockGetProviderInfo.mockReturnValue({
      name: "ShouldNotAppear",
      model: "v2",
      provider: "test",
      fullSupport: true,
      isConfigured: true,
    });
    act(() => {
      vi.advanceTimersByTime(10000);
    });

    expect(result.current.provider).toBe("VisibleOnly");
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
  });

  it("pauses and resumes polling via visibilitychange events (no setInterval tick on hidden tabs)", () => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    mockGetProviderInfo.mockReturnValue({
      name: "Tick1",
      model: "v1",
      provider: "test",
      fullSupport: true,
      isConfigured: false,
    });
    const setIntervalSpy = vi.spyOn(global, "setInterval");

    const { result, unmount } = renderHook(() => useAIStatus());
    // One interval is active while visible.
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);

    // Hide the tab: the visibilitychange listener must call clearInterval
    // and stop the polling. A subsequent tick must NOT fire.
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    setIntervalSpy.mockClear();
    // Track whether setInterval is called again after hide (it must not be).
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      vi.advanceTimersByTime(10000);
    });
    expect(setIntervalSpy).not.toHaveBeenCalled();
    mockGetProviderInfo.mockReturnValue({
      name: "ShouldNotAppear",
      model: "v2",
      provider: "test",
      fullSupport: true,
      isConfigured: true,
    });
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    // Polling is paused: provider has not transitioned.

    // Resume on visibility: a fresh setInterval is scheduled and a refresh
    // runs immediately, so the UI is not stale when the user comes back.
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    mockGetProviderInfo.mockReturnValue({
      name: "Fresh",
      model: "v3",
      provider: "test",
      fullSupport: true,
      isConfigured: true,
    });
    // React 19 fires effects twice in some mount cycles; assert at least
    // one new setInterval was scheduled, not the exact count.
    setIntervalSpy.mockClear();
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(setIntervalSpy).toHaveBeenCalled();
    // The refresh-on-resume must have fired the callback with the new
    // provider name visible in the result.
    expect(result.current.provider).toBe("Fresh");

    setIntervalSpy.mockRestore();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    unmount();
  });
});
