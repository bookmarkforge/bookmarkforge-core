import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

vi.mock("../../utils/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// useReducedMotion is a re-export of motion/react's hook. Mocking the
// underlying package keeps the test deterministic in jsdom instead of
// depending on motion's own matchMedia bookkeeping.
const mockUseReducedMotion = vi.hoisted(() => vi.fn(() => false));
vi.mock("motion/react", async () => {
  const { createMotionMock } = await import("../mocks/motion");
  return createMotionMock({ useReducedMotion: mockUseReducedMotion });
});

import {
  getMotionProps,
  useReducedMotion,
} from "../../hooks/useReducedMotion";

describe("useReducedMotion (re-exported from motion/react)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates to motion/react's useReducedMotion", () => {
    mockUseReducedMotion.mockReturnValue(true);
    const { result } = renderHook(() => useReducedMotion());
    expect(mockUseReducedMotion).toHaveBeenCalled();
    expect(result.current).toBe(true);
  });
});

describe("getMotionProps", () => {
  const motionProps = { initial: { opacity: 0 }, animate: { opacity: 1 } };

  it("returns the motion props unchanged when reduced motion is off", () => {
    expect(getMotionProps(false, motionProps)).toEqual(motionProps);
  });

  it("disables animation when reduced motion is on", () => {
    const result = getMotionProps(true, motionProps);
    expect(result).toEqual({
      initial: false,
      animate: false,
      exit: false,
      transition: { duration: 0 },
    });
  });
});
