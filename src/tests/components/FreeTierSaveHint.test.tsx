import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const mockUsage = {
  count: 950 as number | undefined,
  limit: 1000,
  isFree: true,
  canAddBookmark: true as boolean | undefined,
};

vi.mock("../../hooks/useFreeTierUsage", () => ({
  useFreeTierUsage: () => mockUsage,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (
      key: string,
      fallbackOrOptions?: string | Record<string, unknown>,
      options?: Record<string, unknown>,
    ) => {
      const fallback =
        typeof fallbackOrOptions === "string" ? fallbackOrOptions : key;
      const values =
        typeof fallbackOrOptions === "object" && fallbackOrOptions !== null
          ? fallbackOrOptions
          : options;
      return values
        ? Object.entries(values).reduce(
            (text, [name, value]) =>
              text.replace(new RegExp(`{{\\s*${name}\\s*}}`, "g"), String(value)),
            fallback,
          )
        : fallback;
    },
  }),
}));

const { FreeTierSaveHint } = await import("../../components/FreeTierSaveHint");

describe("FreeTierSaveHint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUsage.count = 950;
    mockUsage.isFree = true;
    mockUsage.canAddBookmark = true;
  });

  it("shows the current Free usage before saving", () => {
    render(<FreeTierSaveHint />);
    expect(screen.getByText("app_freeMeterLine")).toBeInTheDocument();
    expect(screen.getByText("95%")).toBeInTheDocument();
    expect(screen.queryByText("See Pro →")).toBeNull();
  });

  it("shows a friendly Pro CTA when canAddBookmarks says the next save will not fit", () => {
    mockUsage.count = 1000;
    mockUsage.canAddBookmark = false;
    render(<FreeTierSaveHint />);
    expect(screen.getByText("See Pro →")).toBeInTheDocument();
    expect(screen.getByText(/Nothing is lost and nothing broke/)).toBeInTheDocument();

    fireEvent.click(screen.getByText("See Pro →"));
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("does not render for Pro users or while the count is loading", () => {
    mockUsage.isFree = false;
    const pro = render(<FreeTierSaveHint />);
    expect(pro.queryByRole("status")).toBeNull();
    pro.unmount();

    mockUsage.isFree = true;
    mockUsage.count = undefined;
    const loading = render(<FreeTierSaveHint />);
    expect(loading.queryByRole("status")).toBeNull();
  });
});
