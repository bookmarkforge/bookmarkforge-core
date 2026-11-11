import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";

const mockSafeGet = vi.fn();
const mockDestroyAllDatabases = vi.fn();
const mockConfirm = vi.fn();

vi.mock("../../store/safeStorage", () => ({
  safeGet: (...args: unknown[]) => mockSafeGet(...args),
}));

vi.mock("../../components/app-initializer/initUtils", () => ({
  destroyAllDatabases: (...args: unknown[]) => mockDestroyAllDatabases(...args),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

const { DemoModeBanner } = await import("../../components/DemoModeBanner");

describe("DemoModeBanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDestroyAllDatabases.mockResolvedValue(undefined);
    mockConfirm.mockReturnValue(true);
    vi.stubGlobal("confirm", mockConfirm);
  });

  it("renders nothing when the demo flag is not set", () => {
    mockSafeGet.mockReturnValue(null);
    render(<DemoModeBanner />);
    expect(
      screen.queryByText("Create your vault"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/demo data/),
    ).not.toBeInTheDocument();
  });

  it("renders the exit CTA while the demo flag is set", () => {
    mockSafeGet.mockReturnValue("true");
    render(<DemoModeBanner />);
    expect(
      screen.getByText("You're exploring demo data — nothing here is yours yet."),
    ).toBeInTheDocument();
    expect(screen.getByText("Create your vault")).toBeInTheDocument();
  });

  it("tears down the demo vault and navigates to /app on confirm", async () => {
    mockSafeGet.mockReturnValue("true");
    const originalLocation = window.location;
    // jsdom's location is not writable; spy on the href setter path via
    // a minimal stub that captures the assignment.
    let assigned = "";
    Object.defineProperty(window, "location", {
      value: { ...originalLocation, set href(v: string) { assigned = v; } },
      writable: true,
      configurable: true,
    });
    try {
      render(<DemoModeBanner />);
      fireEvent.click(screen.getByText("Create your vault"));
      await waitFor(() => {
        expect(mockDestroyAllDatabases).toHaveBeenCalledWith("reset");
      });
      await waitFor(() => {
        expect(assigned).toBe("/app");
      });
    } finally {
      Object.defineProperty(window, "location", {
        value: originalLocation,
        writable: true,
        configurable: true,
      });
    }
  });

  it("does nothing when the user cancels the confirm", () => {
    mockSafeGet.mockReturnValue("true");
    mockConfirm.mockReturnValue(false);
    render(<DemoModeBanner />);
    fireEvent.click(screen.getByText("Create your vault"));
    expect(mockDestroyAllDatabases).not.toHaveBeenCalled();
  });
});
