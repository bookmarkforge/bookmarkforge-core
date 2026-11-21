import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useRouteTransitionTiming } from "../../hooks/useRouteTransitionTiming";

vi.mock("react-router", () => ({
  useLocation: vi.fn(() => ({ pathname: "/home" })),
}));

vi.mock("../utils/logger", () => ({
  logger: { info: vi.fn() },
}));

describe("useRouteTransitionTiming", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("mounts without errors", () => {
    renderHook(() => useRouteTransitionTiming());
    expect(true).toBe(true);
  });
});
