import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

const safeGetMock = vi.fn();
const safeSetMock = vi.fn();

vi.mock("../../store/safeStorage", () => ({
  safeGet: (...args: any[]) => safeGetMock(...args),
  safeSet: (...args: any[]) => safeSetMock(...args),
}));

vi.mock("../../constants/storage-keys", () => ({
  STORAGE_KEYS: { DISMISSED_TIPS: "bmf_dismissed_tips" },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_s: string, fb?: string) => fb !== undefined ? fb : "",
  }),
}));

vi.mock("lucide-react", () => ({
  Lightbulb: () => <svg data-testid="icon-lightbulb" />,
  X: () => <svg data-testid="icon-x" />,
  ChevronRight: () => <svg data-testid="icon-chevron" />,
}));

import { QuickTips } from "../../components/QuickTips";

describe("QuickTips", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    safeGetMock.mockImplementation((key: string) => {
      if (key.includes("forge_tip_shown_")) return null; // not shown today
      return null; // no dismissed tips
    });
  });

  it("renders a tip with title and description", () => {
    render(<QuickTips />);
    expect(screen.getByText("Quick Capture")).toBeTruthy();
    expect(screen.getByText(/Ctrl\+Shift\+B/)).toBeTruthy();
  });

  it("has role='status' for accessibility", () => {
    render(<QuickTips />);
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("dismisses the tip when clicking X", async () => {
    render(<QuickTips />);
    const dismissBtn = screen.getByLabelText("Dismiss tip");
    await userEvent.click(dismissBtn);

    // After dismissing, the component should return null
    expect(screen.queryByText("Quick Capture")).toBeNull();
    expect(safeSetMock).toHaveBeenCalled();
  });

  it("shows the Next tip button when multiple tips are available", () => {
    safeGetMock.mockReturnValue(null); // no tips dismissed
    render(<QuickTips />);
    expect(screen.getByText("Next tip")).toBeTruthy();
  });

  it("the Next tip button exists and is clickable", async () => {
    safeGetMock.mockReturnValue(null);
    render(<QuickTips />);
    const nextBtn = screen.getByText("Next tip");
    expect(nextBtn).toBeTruthy();
    // Click should not throw
    await userEvent.click(nextBtn);
  });

  it("does not render if all tips are dismissed", () => {
    safeGetMock.mockReturnValue(
      JSON.stringify([
        "tip_quick_capture",
        "tip_keyboard_shortcuts",
        "tip_search",
        "tip_analytics",
        "tip_backup",
      ]),
    );
    render(<QuickTips />);
    expect(screen.queryByText("Quick Capture")).toBeNull();
  });

  it("does not show the tip if it was already shown today", () => {
    safeGetMock.mockImplementation((key: string) => {
      if (key.includes("forge_tip_shown_")) return "true";
      return null;
    });
    render(<QuickTips />);
    expect(screen.queryByText("Quick Capture")).toBeNull();
  });
});
