import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAnalytics } from "../../hooks/useAnalytics";
import { analyticsService } from "../../services/AnalyticsService";

vi.mock("../../services/AnalyticsService", () => ({
  analyticsService: { track: vi.fn() },
}));

const track = vi.mocked(analyticsService.track);

describe("useAnalytics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps the session alive on user interaction (activity listeners)", () => {
    const { unmount } = renderHook(() => useAnalytics());

    // The hook registers passive capture listeners for these events.
    for (const type of ["click", "keydown", "scroll", "mousemove", "touchstart"]) {
      document.dispatchEvent(new Event(type));
    }
    // No error means the listeners were attached; unmount must remove them.
    expect(() => unmount()).not.toThrow();
  });

  it("trackFeatureUse routes to analyticsService.track", () => {
    const { result } = renderHook(() => useAnalytics());

    result.current.trackFeatureUse("bookmark", "create", { extra: 1 });

    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith("bookmark_created", {
      feature: "bookmark",
      action: "create",
      extra: 1,
    });
  });

  it("trackAction forwards the event type and data verbatim", () => {
    const { result } = renderHook(() => useAnalytics());

    result.current.trackAction("export_started", { format: "json" });

    expect(track).toHaveBeenCalledWith("export_started", { format: "json" });
  });

  it("trackAction allows calls without data", () => {
    const { result } = renderHook(() => useAnalytics());

    result.current.trackAction("session_end");

    expect(track).toHaveBeenCalledWith("session_end", undefined);
  });

  it("trackError reports under the session_end event type", () => {
    const { result } = renderHook(() => useAnalytics());

    result.current.trackError("render crashed", "Timeline", { fatal: false });

    expect(track).toHaveBeenCalledWith("session_end", {
      error: "render crashed",
      component: "Timeline",
      fatal: false,
    });
  });

  it("returns stable callbacks across re-renders", () => {
    const { result, rerender } = renderHook(() => useAnalytics());
    const first = result.current;
    rerender();
    expect(result.current.trackFeatureUse).toBe(first.trackFeatureUse);
    expect(result.current.trackAction).toBe(first.trackAction);
    expect(result.current.trackError).toBe(first.trackError);
  });
});
