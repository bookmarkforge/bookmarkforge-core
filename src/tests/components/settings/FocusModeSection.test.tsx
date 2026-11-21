import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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
  return { Maximize2: mock("Maximize2"), Minimize2: mock("Minimize2") };
});

const mockT = vi.fn(
  (key: string, options?: any) => options?.defaultValue || key,
);

describe("FocusModeSection", () => {
  let FocusModeSection: React.FC<{
    isDistractionFree: boolean;
    setIsDistractionFree: (v: boolean) => void;
    t: any;
  }>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../../../components/settings/FocusModeSection");
    FocusModeSection = mod.FocusModeSection;
  });

  it("renders title", () => {
    render(
      <FocusModeSection
        isDistractionFree={false}
        setIsDistractionFree={vi.fn()}
        t={mockT}
      />,
    );
    expect(screen.getByText("app_focusMode")).toBeTruthy();
  });

  it("shows activate button when isDistractionFree=false", () => {
    render(
      <FocusModeSection
        isDistractionFree={false}
        setIsDistractionFree={vi.fn()}
        t={mockT}
      />,
    );
    expect(screen.getByText("app_enableFocusMode")).toBeTruthy();
  });

  it("shows deactivate button when isDistractionFree=true", () => {
    render(
      <FocusModeSection
        isDistractionFree={true}
        setIsDistractionFree={vi.fn()}
        t={mockT}
      />,
    );
    expect(screen.getByText("app_disableFocusMode")).toBeTruthy();
  });

  it("calls setIsDistractionFree when clicked", async () => {
    const setter = vi.fn();
    render(
      <FocusModeSection
        isDistractionFree={false}
        setIsDistractionFree={setter}
        t={mockT}
      />,
    );
    await userEvent.click(screen.getByText("app_enableFocusMode"));
    expect(setter).toHaveBeenCalledWith(true);
  });
});
