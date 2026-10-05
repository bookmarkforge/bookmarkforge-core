import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

// Return undefined so component's `||` fallback kicks in.
// i18n mock includes language for the LanguageSelector child component.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    // Second-arg fallback (i18next signature) so components using
    // t(key, fallback) — e.g. LanguageSelector's aria-label — resolve;
    // SecurityConfirmation's `t(key) || fallback` pattern keeps working
    // because t returns undefined when no fallback argument is passed.
    t: (key: string, fallback?: string) => (fallback ?? undefined) as any,
    i18n: { language: "en", changeLanguage: vi.fn() },
  }),
  // src/i18n.ts chains .use(initReactI18next) at import time (LanguageSelector
  // pulls SUPPORTED_LANGUAGES from ../i18n), so the mock must expose the
  // plugin object i18next's use() expects — same pattern as Header.test.tsx.
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

// LanguageSelector imports SUPPORTED_LANGUAGES from constants/locales.
// The module is real — no mock needed; it's just a data array.

// SecurityConfirmation uses inline SVG icons (InlineSecurityIcons) — no
// lucide-react mock needed; tests below assert labels/roles, not icon testids.

import { SecurityConfirmation } from "../../components/SecurityConfirmation";

describe("SecurityConfirmation", () => {
  it("renders the title and description", () => {
    render(
      <SecurityConfirmation
        onConfirm={vi.fn()}
        onSetupPassword={vi.fn()}
      />,
    );
    expect(screen.getByText("Secure your vault")).toBeTruthy();
    expect(
      screen.getByText(/Protect your bookmarks/i),
    ).toBeTruthy();
  });

  it("renders set-password button", () => {
    render(
      <SecurityConfirmation
        onConfirm={vi.fn()}
        onSetupPassword={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Set up password")).toBeTruthy();
  });

  it("renders skip button", () => {
    render(
      <SecurityConfirmation
        onConfirm={vi.fn()}
        onSetupPassword={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Skip password")).toBeTruthy();
  });

  it("calls onSetupPassword on click", async () => {
    const onSetup = vi.fn();
    render(
      <SecurityConfirmation
        onConfirm={vi.fn()}
        onSetupPassword={onSetup}
      />,
    );
    await userEvent.click(screen.getByLabelText("Set up password"));
    expect(onSetup).toHaveBeenCalledOnce();
  });

  it("calls onConfirm when clicking skip", async () => {
    const onConfirm = vi.fn();
    render(
      <SecurityConfirmation
        onConfirm={onConfirm}
        onSetupPassword={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByLabelText("Skip password"));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("renders the dialog with role dialog", () => {
    render(
      <SecurityConfirmation
        onConfirm={vi.fn()}
        onSetupPassword={vi.fn()}
      />,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
  });

  it("renders the language selector on the vault creation screen", () => {
    render(
      <SecurityConfirmation
        onConfirm={vi.fn()}
        onSetupPassword={vi.fn()}
      />,
    );
    // LanguageSelector renders a button with aria-label="Language"
    const langButton = screen.getByLabelText("Language");
    expect(langButton).toBeTruthy();
    expect(langButton.getAttribute("aria-haspopup")).toBe("menu");
  });
});
