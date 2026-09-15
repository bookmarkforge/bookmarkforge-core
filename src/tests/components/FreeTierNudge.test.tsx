import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";

// Interpolating t() mock with a mini dictionary for the nudge keys, so
// assertions can check real rendered copy (price, device limit, refund
// days) instead of raw keys.
const DICT: Record<string, string> = {
  app_freeWallTitle: "You've reached 1,000 — Free's limit",
  app_freeWallBody:
    "Nothing is lost and nothing broke. Reading, search and export are exactly as they were — only new saves pause.",
  app_freeWallProLifts: "Pro lifts the cap:",
  app_freeWallProUnlimited: "Unlimited saves — the ceiling disappears",
  app_freeWallProSync: "P2P sync between your own devices (up to {{limit}})",
  app_freeWallProLocalAi:
    "AI that runs inside your computer — no API keys, nothing sent anywhere",
  app_freeWallCta: "See Pro — {{price}} once",
  app_freeWallKeepFree: "Keep Free",
  app_freeWallTrust: "One-time payment · yours forever · {{days}}-day money-back",
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    // Repo convention: t(key, fallback, options) — the fallback string is
    // positional arg 2, interpolation opts arg 3.
    t: (
      key: string,
      fallbackOrOpts?: string | Record<string, unknown>,
      opts?: Record<string, unknown>,
    ) => {
      let out =
        (typeof fallbackOrOpts === "string" ? fallbackOrOpts : DICT[key]) ??
        key;
      const o =
        typeof fallbackOrOpts === "object" && fallbackOrOpts !== null
          ? fallbackOrOpts
          : opts;
      if (o) {
        for (const [k, v] of Object.entries(o)) {
          out = out.replace(new RegExp(`{{\\s*${k}\\s*}}`), String(v));
        }
      }
      return out;
    },
  }),
}));

vi.mock("../../constants/pricing", () => ({
  getActiveProPrice: vi.fn(() => "$59"),
  getProDeviceLimit: vi.fn(() => 3),
  PRICING_CONFIG: {
    lifetimeVersioned: { refundDays: 30 },
  },
}));

const { FreeTierNudge } = await import(
  "../../components/dashboard/components/FreeTierNudge"
);

describe("FreeTierNudge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the reassurance-first wall copy with interpolated values", () => {
    render(
      <FreeTierNudge show={true} onDismiss={vi.fn()} onSeePro={vi.fn()} />,
    );
    // The reassure line comes before the sell (design doc stance).
    expect(
      screen.getByText(
        "Nothing is lost and nothing broke. Reading, search and export are exactly as they were — only new saves pause.",
      ),
    ).toBeInTheDocument();
    // Price and refund days come from PRICING_CONFIG helpers, not literals.
    expect(screen.getByText("See Pro — $59 once")).toBeInTheDocument();
    expect(
      screen.getByText("P2P sync between your own devices (up to 3)"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/30-day money-back/),
    ).toBeInTheDocument();
  });

  it("shows the Pro uplift bullets and trust line", () => {
    render(
      <FreeTierNudge show={true} onDismiss={vi.fn()} onSeePro={vi.fn()} />,
    );
    expect(
      screen.getByText("Unlimited saves — the ceiling disappears"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "AI that runs inside your computer — no API keys, nothing sent anywhere",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "One-time payment · yours forever · 30-day money-back",
      ),
    ).toBeInTheDocument();
  });

  it("CTAs fire dismiss/see-pro callbacks", () => {
    const onDismiss = vi.fn();
    const onSeePro = vi.fn();
    render(
      <FreeTierNudge
        show={true}
        onDismiss={onDismiss}
        onSeePro={onSeePro}
      />,
    );
    fireEvent.click(screen.getByText("Keep Free"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("See Pro — $59 once"));
    expect(onSeePro).toHaveBeenCalledTimes(1);
  });

  it("hidden state keeps the CLS-reserving wrapper and disables pointer events", () => {
    const { container } = render(
      <FreeTierNudge show={false} onDismiss={vi.fn()} onSeePro={vi.fn()} />,
    );
    // Same CLS contract as EvictionBanner: wrapper always mounted with
    // overflow hidden (no layout shift), motion layer fades content.
    const wrapper = container.querySelector(".mb-6") as HTMLElement | null;
    expect(wrapper).not.toBeNull();
    expect(wrapper?.getAttribute("style")).toContain("overflow");
  });
});
