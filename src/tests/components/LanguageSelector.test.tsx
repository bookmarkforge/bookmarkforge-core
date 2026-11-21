import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

const mockI18n = vi.hoisted(() => ({
  language: "en",
  changeLanguage: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => {
    // Return the key verbatim (like Header.test.tsx) so queries can target
    // the i18n key directly instead of the English fallback string.
    const t = (key: string) => key;
    return { t, i18n: mockI18n };
  },
}));

vi.mock("../../i18n", () => ({
  SUPPORTED_LANGUAGES: [
    { code: "en", name: "English" },
    { code: "es", name: "Español" },
    { code: "de", name: "Deutsch" },
  ],
}));

vi.mock("lucide-react", () => {
  const mock = (name: string) => {
    const Icon = ({ className, ...props }: any) => (
      <svg data-testid={`icon-${name}`} className={className} {...props} />
    );
    Icon.displayName = name;
    return Icon;
  };
  return { Globe: mock("Globe") };
});

describe("LanguageSelector", () => {
  let LanguageSelector: React.FC;

  beforeEach(async () => {
    cleanup();
    vi.clearAllMocks();
    mockI18n.language = "en";
    const mod = await import("../../components/LanguageSelector");
    LanguageSelector = mod.LanguageSelector;
  });

  it("renders the trigger button with language aria-label", () => {
    render(<LanguageSelector />);
    expect(screen.getByLabelText("app_language")).toBeTruthy();
    expect(screen.getByTestId("icon-Globe")).toBeTruthy();
  });

  it("starts with the menu closed", () => {
    render(<LanguageSelector />);
    expect(screen.queryByText("English")).toBeNull();
  });

  it("opens the menu on click and lists every supported language", async () => {
    render(<LanguageSelector />);
    await userEvent.click(screen.getByLabelText("app_language"));
    expect(screen.getByText("English")).toBeTruthy();
    expect(screen.getByText("Español")).toBeTruthy();
    expect(screen.getByText("Deutsch")).toBeTruthy();
  });

  it("marks the active language as selected", async () => {
    render(<LanguageSelector />);
    await userEvent.click(screen.getByLabelText("app_language"));
    // Only the active language renders the "selected" marker.
    expect(screen.getByText("app_selected")).toBeTruthy();
  });

  it("calls changeLanguage with the selected code and closes the menu", async () => {
    render(<LanguageSelector />);
    await userEvent.click(screen.getByLabelText("app_language"));
    await userEvent.click(screen.getByText("Deutsch"));
    expect(mockI18n.changeLanguage).toHaveBeenCalledWith("de");
    expect(screen.queryByText("Deutsch")).toBeNull();
  });

  it("closes the menu when clicking outside", async () => {
    render(<LanguageSelector />);
    await userEvent.click(screen.getByLabelText("app_language"));
    expect(screen.getByText("English")).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText("English")).toBeNull();
  });

  it("toggles the menu when clicking the trigger twice", async () => {
    render(<LanguageSelector />);
    const trigger = screen.getByLabelText("app_language");
    await userEvent.click(trigger);
    expect(screen.getByText("English")).toBeTruthy();
    await userEvent.click(trigger);
    expect(screen.queryByText("English")).toBeNull();
  });
});
