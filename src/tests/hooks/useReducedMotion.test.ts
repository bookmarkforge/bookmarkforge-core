import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";

vi.mock("motion/react", async () => {
  const { createMotionMock } = await import("../mocks/motion");
  return createMotionMock();
});

describe("useReducedMotion", () => {
  it("should re-export useReducedMotion from motion/react", async () => {
    const { useReducedMotion } = await import("../../hooks/useReducedMotion");
    expect(typeof useReducedMotion).toBe("function");
  });

  it("getMotionProps should return reduced props when reducedMotion is true", async () => {
    const { getMotionProps } = await import("../../hooks/useReducedMotion");
    const result = getMotionProps(true, {
      initial: { opacity: 0 },
      animate: { opacity: 1 },
    });
    expect(result.initial).toBe(false);
    expect(result.animate).toBe(false);
    expect(result.exit).toBe(false);
    expect((result.transition as any).duration).toBe(0);
  });

  it("getMotionProps should return original props when reducedMotion is false", async () => {
    const { getMotionProps } = await import("../../hooks/useReducedMotion");
    const props = { initial: { opacity: 0 }, animate: { opacity: 1 } };
    const result = getMotionProps(false, props);
    expect(result).toEqual(props);
  });
});
