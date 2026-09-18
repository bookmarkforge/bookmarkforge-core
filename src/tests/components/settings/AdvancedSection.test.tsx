import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

vi.mock("lucide-react", () => {
  const mock = (name: string) => {
    const Icon = (props: any) => (
      <svg data-testid={`icon-${name}`} {...props} />
    );
    Icon.displayName = name;
    return Icon;
  };
  return { RefreshCw: mock("RefreshCw"), Copy: mock("Copy"), Check: mock("Check"), LifeBuoy: mock("LifeBuoy") };
});

const mockForceReprocessAll = vi.fn().mockResolvedValue(undefined);
vi.mock("../../../services/ai/AutoProcessorService", () => ({
  autoProcessorService: { forceReprocessAll: mockForceReprocessAll },
}));

const mockToast = { success: vi.fn(), error: vi.fn() };
vi.mock("sonner", () => ({ toast: mockToast }));

const mockT = vi.fn(
  (key: string, options?: any) => options?.defaultValue || key,
);

describe("AdvancedSection", () => {
  let AdvancedSection: React.FC<{ t: any }>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockForceReprocessAll.mockResolvedValue(undefined);
    const mod = await import("../../../components/settings/AdvancedSection");
    AdvancedSection = mod.AdvancedSection;
  });

  it("renders title", () => {
    render(<AdvancedSection t={mockT} />);
    expect(screen.getByText("app_advancedSettings")).toBeTruthy();
  });

  it("shows reprocess button", () => {
    render(<AdvancedSection t={mockT} />);
    expect(screen.getByText("app_forceReprocess")).toBeTruthy();
  });

  it("shows start with fallback button", () => {
    render(<AdvancedSection t={mockT} />);
    expect(screen.getByText("app_start")).toBeTruthy();
  });

  it("ignores a second click while re-processing", async () => {
    let resolveReprocess: (() => void) | undefined;
    mockForceReprocessAll.mockImplementation(
      () => new Promise<void>((resolve) => {
        resolveReprocess = resolve;
      }),
    );
    render(<AdvancedSection t={mockT} />);
    const button = screen.getByText("app_start");
    await userEvent.click(button);
    await userEvent.click(button);

    expect(mockForceReprocessAll).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveReprocess?.();
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  it("calls forceReprocessAll when clicked", async () => {
    render(<AdvancedSection t={mockT} />);
    await userEvent.click(screen.getByText("app_start"));
    expect(mockForceReprocessAll).toHaveBeenCalled();
    // Trasplantado de la copia src/tests/security/AdvancedSection.test.tsx:
    // the success toast must also fire (preserved unique coverage).
    expect(mockToast.success).toHaveBeenCalled();
  });

  it("ignores a reprocess that resolves after unmount (no toast)", async () => {
    let resolveReprocess: (() => void) | undefined;
    mockForceReprocessAll.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveReprocess = resolve;
        }),
    );
    const { unmount } = render(<AdvancedSection t={mockT} />);
    await userEvent.click(screen.getByText("app_start"));
    expect(mockForceReprocessAll).toHaveBeenCalled();
    unmount();
    resolveReprocess?.();
    // Flush microtasks: if the late continuation existed, it would have run by now.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockToast.success).not.toHaveBeenCalled();
  });
});
