import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

vi.mock("react-i18next", () => {
  const t = (key: string, options?: any) => options?.defaultValue || key;
  return { useTranslation: () => ({ t, i18n: { language: "en" } }) };
});

const mockUseAutoProcessor = vi.fn();
vi.mock("../../hooks/useAutoProcessor", () => ({
  useAutoProcessor: () => mockUseAutoProcessor(),
}));

vi.mock("motion/react", async () => {
  const { createMotionMock } = await import("../mocks/motion");
  return createMotionMock();
});

vi.mock("lucide-react", () => {
  const mock = (name: string) => {
    const Icon = (props: any) => (
      <svg data-testid={`icon-${name}`} {...props} />
    );
    Icon.displayName = name;
    return Icon;
  };
  return { Loader2: mock("Loader2"), Sparkles: mock("Sparkles") };
});

describe("BackgroundProgress", () => {
  let BackgroundProgress: React.FC;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockUseAutoProcessor.mockReturnValue({
      isProcessing: false,
      totalItems: 0,
      processedItems: 0,
      currentItem: null,
    });
    const mod = await import("../../components/ai/BackgroundProgress");
    BackgroundProgress = mod.BackgroundProgress;
  });

  it("does not render when isProcessing is false", () => {
    const { container } = render(<BackgroundProgress />);
    expect(
      Array.from(container.children).every((el) => el.tagName === "STYLE"),
    ).toBe(true);
  });

  it("renders when isProcessing is true", () => {
    mockUseAutoProcessor.mockReturnValue({
      isProcessing: true,
      totalItems: 10,
      processedItems: 3,
      currentItem: "Processing...",
    });
    render(<BackgroundProgress />);
    expect(screen.getByText("AI Processing...")).toBeTruthy();
  });

  it("shows the correct percentage", () => {
    mockUseAutoProcessor.mockReturnValue({
      isProcessing: true,
      totalItems: 10,
      processedItems: 5,
      currentItem: null,
    });
    render(<BackgroundProgress />);
    expect(screen.getByText("50%")).toBeTruthy();
  });

  it("shows the items counter", () => {
    mockUseAutoProcessor.mockReturnValue({
      isProcessing: true,
      totalItems: 10,
      processedItems: 3,
      currentItem: "doc.pdf",
    });
    render(<BackgroundProgress />);
    expect(screen.getAllByText(/3/).length).toBeGreaterThan(0);
  });
});
