import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (s: string) => s }),
}));
vi.mock("motion/react", async () => {
  const { createMotionMock } = await import("../../mocks/motion");
  return createMotionMock();
});

const { AppearanceSection } =
  await import("../../../components/settings/AppearanceSection");

describe("AppearanceSection", () => {
  const defaultProps = {
    globalFont: "sans-serif" as const,
    setGlobalFont: vi.fn(),
    globalFontSize: 16,
    setGlobalFontSize: vi.fn(),
    lang: "en",
    setLang: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders language selector", () => {
    const { getByLabelText } = render(<AppearanceSection {...defaultProps} />);
    const select = getByLabelText("app_language") as HTMLSelectElement;
    expect(select.value).toBe("en");
  });

  it("renders font options", () => {
    const { getByText } = render(<AppearanceSection {...defaultProps} />);
    expect(getByText("Sans")).toBeTruthy();
    expect(getByText("Seri")).toBeTruthy();
    expect(getByText("Mono")).toBeTruthy();
  });

  it("calls setGlobalFont when font button clicked", async () => {
    const setGlobalFont = vi.fn();
    const { getByText } = render(
      <AppearanceSection {...defaultProps} setGlobalFont={setGlobalFont} />,
    );
    await userEvent.click(getByText("Mono"));
    expect(setGlobalFont).toHaveBeenCalledWith("monospace");
  });

  it("renders font size controls", () => {
    const { getByText } = render(<AppearanceSection {...defaultProps} />);
    expect(getByText("16px")).toBeTruthy();
  });

  it("calls setGlobalFontSize on decrement", async () => {
    const setGlobalFontSize = vi.fn();
    const { getByText } = render(
      <AppearanceSection
        {...defaultProps}
        setGlobalFontSize={setGlobalFontSize}
      />,
    );
    await userEvent.click(getByText("-"));
    expect(setGlobalFontSize).toHaveBeenCalledWith(15);
  });

  it("calls setGlobalFontSize on increment", async () => {
    const setGlobalFontSize = vi.fn();
    const { getByText } = render(
      <AppearanceSection
        {...defaultProps}
        setGlobalFontSize={setGlobalFontSize}
      />,
    );
    await userEvent.click(getByText("+"));
    expect(setGlobalFontSize).toHaveBeenCalledWith(17);
  });

  it("decrements font size but clamps at 12px minimum", async () => {
    const setGlobalFontSize = vi.fn();
    const { getByText } = render(
      <AppearanceSection
        {...defaultProps}
        globalFontSize={12}
        setGlobalFontSize={setGlobalFontSize}
      />,
    );
    await userEvent.click(getByText("-"));
    expect(setGlobalFontSize).toHaveBeenCalledWith(12);
  });

  it("increments font size but clamps at 24px maximum", async () => {
    const setGlobalFontSize = vi.fn();
    const { getByText } = render(
      <AppearanceSection
        {...defaultProps}
        globalFontSize={24}
        setGlobalFontSize={setGlobalFontSize}
      />,
    );
    await userEvent.click(getByText("+"));
    expect(setGlobalFontSize).toHaveBeenCalledWith(24);
  });

  it("renders all supported languages in the select", () => {
    const { getByLabelText, getByText } = render(
      <AppearanceSection {...defaultProps} />,
    );
    const select = getByLabelText("app_language") as HTMLSelectElement;
    expect(select.options).toHaveLength(30);
    expect(getByText("Español (Spanish)")).toBeTruthy();
  });

  it("calls setLang on language change", () => {
    const setLang = vi.fn();
    const { getByLabelText } = render(
      <AppearanceSection {...defaultProps} setLang={setLang} />,
    );
    fireEvent.change(getByLabelText("app_language"), {
      target: { value: "es" },
    });
    expect(setLang).toHaveBeenCalledWith("es");
  });
});
