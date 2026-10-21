import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { Subject } from "rxjs";

const mockLogger = { info: vi.fn(), error: vi.fn() };
vi.mock("../../utils/logger", () => ({ logger: mockLogger }));

const mockStatus$ = new Subject<any>();
const mockService = {
  start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn(),
  status$: mockStatus$.asObservable(),
};

vi.mock("../../services/ai/AutoProcessorService", () => ({
  autoProcessorService: mockService,
  AutoProcessorStatus: {},
}));

describe("useAutoProcessor", () => {
  let useAutoProcessor: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../../hooks/useAutoProcessor");
    useAutoProcessor = mod.useAutoProcessor;
  });

  it("should call service start on mount", () => {
    renderHook(() => useAutoProcessor());
    expect(mockService.start).toHaveBeenCalled();
  });

  it("should return initial status", () => {
    const { result } = renderHook(() => useAutoProcessor());
    expect(result.current).toEqual({
      isProcessing: false,
      totalItems: 0,
      processedItems: 0,
    });
  });

  it("should update status from observable", () => {
    const { result } = renderHook(() => useAutoProcessor());

    act(() => {
      mockStatus$.next({
        isProcessing: true,
        totalItems: 10,
        processedItems: 5,
      });
    });

    expect(result.current).toEqual({
      isProcessing: true,
      totalItems: 10,
      processedItems: 5,
    });
  });

  it("should stop service on unmount", () => {
    const { unmount } = renderHook(() => useAutoProcessor());
    unmount();
    expect(mockService.stop).toHaveBeenCalled();
  });

  it("should log error when service start fails", async () => {
    const mockError = new Error("Service start failed");
    mockService.start.mockRejectedValueOnce(mockError);

    renderHook(() => useAutoProcessor());

    await waitFor(() => {
      expect(mockLogger.error).toHaveBeenCalledWith(
        "[useAutoProcessor] Failed to start service",
        { error: mockError },
      );
    });
  });

  it("should log error on status subscription error", () => {
    renderHook(() => useAutoProcessor());

    act(() => {
      mockStatus$.error(new Error("Subscription stream error"));
    });

    expect(mockLogger.error).toHaveBeenCalledWith(
      "[useAutoProcessor] Status subscription error",
      { error: expect.any(Error) },
    );
  });

  it("should call service start only once across re-renders", () => {
    const { rerender } = renderHook(() => useAutoProcessor());

    expect(mockService.start).toHaveBeenCalledTimes(1);

    rerender();
    expect(mockService.start).toHaveBeenCalledTimes(1);
  });
});
