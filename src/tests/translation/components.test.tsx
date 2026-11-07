import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import type { TranslationRowState } from "../../hooks/useTranslationSession";

vi.mock("react-i18next", () => ({
  // The pricing module pulls the app i18n bootstrap, which calls
  // `.use(initReactI18next)`; the stub keeps that chain resolvable.
  initReactI18next: { type: "3rdParty", init: () => undefined },
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key} ${JSON.stringify(options)}` : key,
    i18n: { language: "en" },
  }),
}));

const { default: TranslationCostBanner } = await import(
  "../../components/translation/TranslationCostBanner"
);
const { default: TranslationRow } = await import(
  "../../components/translation/TranslationRow"
);

function makeRow(overrides: Partial<TranslationRowState> = {}): TranslationRowState {
  return {
    index: 0,
    sourceText: "The source paragraph.",
    translation: "El párrafo original.",
    kind: "prose",
    translatable: true,
    fromCache: false,
    reviewed: false,
    status: "done",
    ...overrides,
  };
}

describe("TranslationCostBanner", () => {
  it("shows the real spend and the Pro pitch on the free plan", () => {
    render(<TranslationCostBanner totalUSD={0.0042} savedUSD={0} isFreePlan={true} />);

    // Sub-cent amounts must stay visible instead of rounding to $0.00.
    expect(screen.getByText(/\$0\.0042/)).toBeTruthy();
    expect(screen.getByText(/\$59/)).toBeTruthy();
    expect(screen.getByText(/translation_freeBanner/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "translation_proCta" })).toBeTruthy();
  });

  it("opens the Pro panel from the CTA", () => {
    const onProUnavailable = vi.fn();
    window.addEventListener("bmf:pro-unavailable", onProUnavailable);

    render(<TranslationCostBanner totalUSD={0.5} savedUSD={0} isFreePlan={true} />);
    fireEvent.click(screen.getByRole("button", { name: "translation_proCta" }));

    expect(onProUnavailable).toHaveBeenCalledTimes(1);
    const event = onProUnavailable.mock.calls[0]?.[0] as CustomEvent;
    expect(event.detail).toEqual({
      feature: "TranslationLocalEngine",
      reason: "no-license",
    });

    window.removeEventListener("bmf:pro-unavailable", onProUnavailable);
  });

  it("renders nothing when the free run cost nothing", () => {
    render(<TranslationCostBanner totalUSD={0} savedUSD={0} isFreePlan={true} />);
    // Nothing to sell before the user has actually spent anything.
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText(/translation_freeBanner/)).toBeNull();
  });

  it("reports savings on Pro local runs", () => {
    render(<TranslationCostBanner totalUSD={0} savedUSD={0.42} isFreePlan={false} />);
    expect(screen.getByText(/translation_savedWithLocal/)).toBeTruthy();
    expect(screen.getByText(/\$0\.42/)).toBeTruthy();
  });
});

describe("TranslationRow", () => {
  it("pairs the source with an editable translation", () => {
    const onChange = vi.fn();
    render(<TranslationRow row={makeRow()} editable={true} onChange={onChange} />);

    expect(screen.getByText("The source paragraph.")).toBeTruthy();
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(textarea.value).toBe("El párrafo original.");
    expect(textarea.readOnly).toBe(false);

    fireEvent.change(textarea, { target: { value: "El texto editado." } });
    expect(onChange).toHaveBeenCalledWith(0, "El texto editado.");
  });

  it("locks the translation while the run is in flight", () => {
    render(<TranslationRow row={makeRow()} editable={false} onChange={vi.fn()} />);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).readOnly).toBe(true);
  });

  it("echoes non-translatable blocks instead of offering an edit box", () => {
    const { container } = render(
      <TranslationRow
        row={makeRow({
          kind: "code",
          translatable: false,
          sourceText: "const value = 1;",
          translation: "",
        })}
        editable={true}
        onChange={vi.fn()}
      />,
    );

    expect(container.querySelectorAll("pre")).toHaveLength(2);
    expect(screen.queryByRole("textbox")).toBeNull();
    // The echoed block must still be visible, not blank.
    expect(screen.getAllByText("const value = 1;")).toHaveLength(2);
  });

  it("marks rows served from the encrypted cache", () => {
    render(
      <TranslationRow row={makeRow({ fromCache: true })} editable={true} onChange={vi.fn()} />,
    );
    expect(screen.getByText("translation_cached")).toBeTruthy();
  });
});
