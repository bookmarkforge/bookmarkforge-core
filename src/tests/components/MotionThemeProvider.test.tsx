import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

const rm = vi.hoisted(() => ({ useReducedMotion: vi.fn(() => false) }));
vi.mock("../../hooks/useReducedMotion", () => ({
  useReducedMotion: rm.useReducedMotion,
}));

vi.mock("motion/react", async () => {
  const { createMotionMock } = await import("../mocks/motion");
  return createMotionMock({
    MotionConfig: ({ children }: { children?: React.ReactNode }) => (
      <div data-testid="motion-config">{children}</div>
    ),
  });
});

import MotionThemeProvider from "../../components/MotionThemeProvider";

describe("MotionThemeProvider", () => {
  beforeEach(() => {
    rm.useReducedMotion.mockReturnValue(false);
  });

  it("renders the children inside MotionConfig", () => {
    render(
      <MotionThemeProvider>
        <span>Hello Motion</span>
      </MotionThemeProvider>,
    );
    expect(screen.getByText("Hello Motion")).toBeTruthy();
    expect(screen.getByTestId("motion-config")).toBeTruthy();
  });

  it("still renders children when reduced motion is enabled", () => {
    // Trasplantado de la copia src/tests/security/MotionThemeProvider.test.tsx:
    // with reduced motion enabled, the children must still render.
    rm.useReducedMotion.mockReturnValue(true);
    render(
      <MotionThemeProvider>
        <span>motion-child-reduced</span>
      </MotionThemeProvider>,
    );
    expect(screen.getByText("motion-child-reduced")).toBeInTheDocument();
  });
});
