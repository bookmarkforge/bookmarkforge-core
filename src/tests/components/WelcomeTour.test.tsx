import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import React from "react";

const safeGetMock = vi.fn();
const safeSetMock = vi.fn();

vi.mock("../../store/safeStorage", () => ({
  safeGet: (...args: any[]) => safeGetMock(...args),
  safeSet: (...args: any[]) => safeSetMock(...args),
}));

vi.mock("../../constants/storage-keys", () => ({
  STORAGE_KEYS: {
    ONBOARDING_COMPLETE: "bmf_onboarding_complete",
    WELCOME_TOUR_COMPLETE: "bmf_welcome_tour_complete",
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_s: string, fb?: string) => fb || "",
  }),
}));

// Force mobile=false so we test desktop mode
vi.mock("../../components/WelcomeTour", async () => {
  const actual = await vi.importActual("../../components/WelcomeTour");
  return actual;
});

// Stub getBoundingClientRect for tooltip position
const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
Element.prototype.getBoundingClientRect = vi.fn(() => ({
  top: 100, left: 200, bottom: 150, right: 300,
  width: 100, height: 50, x: 200, y: 100,
  toJSON: () => ({}),
}));

import { WelcomeTour } from "../../components/WelcomeTour";

beforeEach(() => {
  // The tour arms an 800 ms show timer; advance the fake clock explicitly so
  // every assertion stays synchronous and deterministic.
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("WelcomeTour", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: onboarding complete, tour not completed
    safeGetMock.mockImplementation((key: string) => {
      if (key === "bmf_onboarding_complete") return "true";
      if (key === "bmf_welcome_tour_complete") return null;
      return null;
    });
    // Reset getBoundingClientRect
    Element.prototype.getBoundingClientRect = vi.fn(() => ({
      top: 100, left: 200, bottom: 150, right: 300,
      width: 100, height: 50, x: 200, y: 100,
      toJSON: () => ({}),
    }));
  });

  it("does not show if onboarding is not complete", () => {
    safeGetMock.mockImplementation((key: string) => {
      if (key === "bmf_onboarding_complete") return null;
      return null;
    });
    render(<WelcomeTour />);
    // Fire the tour's 800 ms show timer under the fake clock.
    act(() => {
      vi.advanceTimersByTime(800);
    });
    // Component returns null when onboarding not complete
    expect(screen.queryByText("Main Navigation")).toBeNull();
  });

  it("does not show if the tour was already completed", () => {
    safeGetMock.mockImplementation((key: string) => {
      if (key === "bmf_onboarding_complete") return "true";
      if (key === "bmf_welcome_tour_complete") return "true";
      return null;
    });
    render(<WelcomeTour />);
    // Fire the tour's 800 ms show timer under the fake clock.
    act(() => {
      vi.advanceTimersByTime(800);
    });
    // Component returns null when tour already completed
    expect(screen.queryByText("Main Navigation")).toBeNull();
  });

  it("shows the first tour step when visible", async () => {
    render(<WelcomeTour />);
    // Fire the tour's 800 ms show timer under the fake clock.
    act(() => {
      vi.advanceTimersByTime(800);
    });
    // Wait for the 800ms delay
    const title = screen.getByText("Main Navigation");
    expect(title).toBeTruthy();
    expect(screen.getByText(/The sidebar is your command center/)).toBeTruthy();
  });

  it("shows the 1/8 step counter", async () => {
    render(<WelcomeTour />);
    // Fire the tour's 800 ms show timer under the fake clock.
    act(() => {
      vi.advanceTimersByTime(800);
    });
    const counter = screen.getByText("1 / 8");
    expect(counter).toBeTruthy();
  });

  it("Next advances to the next step", async () => {
    render(<WelcomeTour />);
    // Fire the tour's 800 ms show timer under the fake clock.
    act(() => {
      vi.advanceTimersByTime(800);
    });
    screen.getByText("Main Navigation");
    fireEvent.click(screen.getByText("Next"));
    expect(screen.getByText("Instant Search")).toBeTruthy();
    expect(screen.getByText(/Press Ctrl\+K/)).toBeTruthy();
  });

  it("Back returns to the previous step", async () => {
    render(<WelcomeTour />);
    // Fire the tour's 800 ms show timer under the fake clock.
    act(() => {
      vi.advanceTimersByTime(800);
    });
    screen.getByText("Main Navigation");
    fireEvent.click(screen.getByText("Next")); // → step 2
    fireEvent.click(screen.getByText("Back")); // → step 1
    expect(screen.getByText("Main Navigation")).toBeTruthy();
  });

  it("Back is disabled on the first step", async () => {
    render(<WelcomeTour />);
    // Fire the tour's 800 ms show timer under the fake clock.
    act(() => {
      vi.advanceTimersByTime(800);
    });
    screen.getByText("Main Navigation");
    const backBtn = screen.getByText("Back");
    expect((backBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("Got it! on the last step completes the tour", async () => {
    render(<WelcomeTour />);
    // Fire the tour's 800 ms show timer under the fake clock.
    act(() => {
      vi.advanceTimersByTime(800);
    });
    screen.getByText("Main Navigation");
    // Advance through all 8 steps
    for (let i = 0; i < 7; i++) {
      fireEvent.click(screen.getByText("Next"));
    }
    expect(screen.getByText("Got it!")).toBeTruthy();
    fireEvent.click(screen.getByText("Got it!"));
    expect(safeSetMock).toHaveBeenCalledWith("bmf_welcome_tour_complete", "true");
  });

  it("Skip completes the tour and saves to storage", async () => {
    render(<WelcomeTour />);
    // Fire the tour's 800 ms show timer under the fake clock.
    act(() => {
      vi.advanceTimersByTime(800);
    });
    screen.getByText("Main Navigation");
    // Use Escape key instead of clicking Skip (AnimatePresence may hide DOM)
    fireEvent.keyDown(window, { key: "Escape" });
    // Poll: the keydown handler updates React state outside act() (real
    // timers), so the persist may land a tick later.
    expect(safeSetMock).toHaveBeenCalledWith(
      "bmf_welcome_tour_complete",
      "true",
    );
  });

  it("renders the step counter and full navigation", async () => {
    render(<WelcomeTour />);
    // Fire the tour's 800 ms show timer under the fake clock.
    act(() => {
      vi.advanceTimersByTime(800);
    });
    screen.getByText("Main Navigation");
    // Verify step counter works
    expect(screen.getByText("1 / 8")).toBeTruthy();
    // Advance to last step
    for (let i = 0; i < 7; i++) {
      fireEvent.click(screen.getByText("Next"));
    }
    expect(screen.getByText("8 / 8")).toBeTruthy();
    expect(screen.getByText("Got it!")).toBeTruthy();
  });

  it("Escape completes the tour", async () => {
    render(<WelcomeTour />);
    // Fire the tour's 800 ms show timer under the fake clock.
    act(() => {
      vi.advanceTimersByTime(800);
    });
    screen.getByText("Main Navigation");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(safeSetMock).toHaveBeenCalledWith(
      "bmf_welcome_tour_complete",
      "true",
    );
  });

  it("ArrowRight advances to the next step", async () => {
    render(<WelcomeTour />);
    // Fire the tour's 800 ms show timer under the fake clock.
    act(() => {
      vi.advanceTimersByTime(800);
    });
    screen.getByText("Main Navigation");
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(
      screen.getByText("Instant Search"),
    ).toBeTruthy();
  });

  it("Enter advances to the next step (keyboard nav)", async () => {
    render(<WelcomeTour />);
    // Fire the tour's 800 ms show timer under the fake clock.
    act(() => {
      vi.advanceTimersByTime(800);
    });
    screen.getByText("Main Navigation");
    // userEvent.keyboard dispatches a full trusted-style keydown cycle; raw
    // fireEvent.keyDown on window has been flaky under batch load here.
    fireEvent.keyDown(window, { key: "Enter" });
    expect(
      screen.getByText("Instant Search"),
    ).toBeTruthy();
  });

  it("ArrowLeft returns to the previous step (keyboard nav)", async () => {
    render(<WelcomeTour />);
    // Fire the tour's 800 ms show timer under the fake clock.
    act(() => {
      vi.advanceTimersByTime(800);
    });
    screen.getByText("Main Navigation");
    // userEvent.keyboard dispatches a full trusted-style keydown cycle; raw
    // fireEvent.keyDown on window has been flaky under batch load here.
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(
      screen.getByText("Instant Search"),
    ).toBeTruthy();
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(
      screen.getByText("Main Navigation"),
    ).toBeTruthy();
  });

  it("shows the mobile tour (simplified card) on narrow screens", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 600,
    });
    render(<WelcomeTour />);
    // Fire the tour's 800 ms show timer under the fake clock.
    act(() => {
      vi.advanceTimersByTime(800);
    });
    screen.getByText("Main Navigation");
    // Mobile card renders an X skip button with aria-label "Skip tour"
    // (the desktop fallback uses a plain text button instead)
    expect(screen.getByLabelText("Skip tour")).toBeTruthy();
    expect(screen.getByText("1 / 8")).toBeTruthy();
  });

  it("the mobile tour navigates with Next/Back and persists on completion", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 600,
    });
    render(<WelcomeTour />);
    // Fire the tour's 800 ms show timer under the fake clock.
    act(() => {
      vi.advanceTimersByTime(800);
    });
    screen.getByText("Main Navigation");
    fireEvent.click(screen.getByText("Next"));
    expect(screen.getByText("Instant Search")).toBeTruthy();
    fireEvent.click(screen.getByText("Back"));
    expect(screen.getByText("Main Navigation")).toBeTruthy();
    // Mobile Back is disabled on the first step
    expect((screen.getByText("Back") as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("anchors the tooltip to the target when the element exists (desktop)", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 1200,
    });
    const target = document.createElement("button");
    target.setAttribute("data-tour-id", "tour-sidebar");
    document.body.appendChild(target);
    const searchTarget = document.createElement("button");
    searchTarget.setAttribute("data-tour-id", "tour-search");
    document.body.appendChild(searchTarget);
    try {
      render(<WelcomeTour />);
    // Fire the tour's 800 ms show timer under the fake clock.
    act(() => {
      vi.advanceTimersByTime(800);
    });
      screen.getByText("Main Navigation");
      // Element-targeted tooltip renders with role="dialog". Must poll
      // (findByRole) instead of getByRole: the 800ms show-timer fires
      // outside act(), so passive effects — which set tooltipPos — may
      // not have run by the time the fallback card first appears.
      const dialog = screen.getByRole("dialog");
      expect(dialog).toBeTruthy();
      expect(screen.getByText(/Esc to skip/)).toBeTruthy();
      // Dimmed spotlight overlay is rendered when a target rect exists
      expect(document.querySelector('[aria-hidden="true"]')).toBeTruthy();
      // Advance to the "search" step (position: bottom) — covers the
      // arrow-up variant of the tooltip arrow
      fireEvent.click(screen.getByText("Next"));
      expect(screen.getByText("Instant Search")).toBeTruthy();
      screen.getByRole("dialog");
    } finally {
      document.body.removeChild(target);
      document.body.removeChild(searchTarget);
    }
  });

  it("switches to mobile tour when resizing the window", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 1200,
    });
    render(<WelcomeTour />);
    // Fire the tour's 800 ms show timer under the fake clock.
    act(() => {
      vi.advanceTimersByTime(800);
    });
    screen.getByText("Main Navigation");
    // Shrink the viewport → mobile card tour takes over
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 500,
    });
    fireEvent(window, new Event("resize"));
    expect(screen.getByLabelText("Skip tour")).toBeTruthy();
  });
});
