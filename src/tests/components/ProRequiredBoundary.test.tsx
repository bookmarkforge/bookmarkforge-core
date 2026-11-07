import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { act } from "react";
import React from "react";

const DICT: Record<string, string> = {
  app_proRequiredTitle: "Available in Open Core",
  app_proRequiredFeatureTitle: "{{feature}} is part of Pro",
  app_proRequiredBody:
    "This build ships without the Pro implementation, so this feature stays quiet instead of pretending to work.",
  app_proRequiredLicenseBody:
    "That one feature is part of Pro and unlocks with a one-time license — your vault, search and export keep working exactly as they are.",
  app_proRequiredGetLicense: "Get a license once — no subscription",
  app_proRequiredRefund: "{{refundDays}}-day money-back guarantee",
  app_proRequiredDismiss: "Close",
  app_freeWallCta: "See Pro — {{price}} once",
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>, opts?: Record<string, unknown>) => {
      const template =
        typeof fallback === "string" ? fallback : (DICT[key] ?? key);
      if (opts && typeof template === "string") {
        return template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) =>
          String(opts[name] ?? `{{${name}}}`),
        );
      }
      return template;
    },
  }),
}));

vi.mock("../../constants/pricing", () => ({
  getActiveProPrice: () => "$59",
  PRICING_CONFIG: { lifetimeVersioned: { refundDays: 30 } },
}));

vi.mock("motion/react", () => ({
  motion: new Proxy({}, {
    get: (_t, prop: string) =>
      React.forwardRef(({ children, ...rest }: any, ref: any) => (
        <div {...rest} ref={ref}>{children}</div>
      )),
  }),
}));

// The boundary imports the panel directly; keep it real.
const { ProRequiredBoundary } = await import("../../components/ProRequiredBoundary");

describe("ProRequiredBoundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.textContent = "";
  });

  it("renders nothing until a Pro surface is reached", () => {
    render(<ProRequiredBoundary />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens on the placeholder-reached event with a feature label", async () => {
    render(<ProRequiredBoundary />);
    act(() => {
      window.dispatchEvent(
        new CustomEvent("open-core:pro-reached", {
          detail: { module: "ProviderManager", property: "callModel" },
        }),
      );
    });
    // The panel mounts through React.lazy: wait for the Suspense boundary.
    await waitFor(() =>
      expect(
        screen.getByText("ProviderManager.callModel is part of Pro"),
      ).toBeTruthy(),
    );
    expect(screen.getByText(/stays quiet instead of pretending/)).toBeTruthy();
    expect(screen.getByText("See Pro — $59 once")).toBeTruthy();
  });

  it("opens on the loader rejection event", async () => {
    render(<ProRequiredBoundary />);
    act(() => {
      window.dispatchEvent(
        new CustomEvent("bmf:pro-unavailable", {
          detail: { feature: "P2P sync" },
        }),
      );
    });
    await waitFor(() =>
      expect(screen.getByText("P2P sync is part of Pro")).toBeTruthy(),
    );
  });

  it("uses license wording for a Free-session rejection and build wording for the Open Core absence", async () => {
    render(<ProRequiredBoundary />);
    act(() => {
      window.dispatchEvent(
        new CustomEvent("bmf:pro-unavailable", {
          detail: { feature: "BackupService", reason: "license" },
        }),
      );
    });
    await waitFor(() =>
      expect(
        screen.getByText(
          /unlocks with a one-time license/,        ),
      ).toBeTruthy(),
    );
    expect(screen.queryByText(/ships without the Pro implementation/)).toBeNull();
  });

  it("closes via the dismiss button and the CTA opens Settings", async () => {
    render(<ProRequiredBoundary />);
    act(() => {
      window.dispatchEvent(
        new CustomEvent("bmf:pro-unavailable", { detail: {} }),
      );
    });
    act(() => {
      window.dispatchEvent(
        new CustomEvent("bmf:pro-unavailable", { detail: {} }),
      );
    });
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    act(() => {
      window.dispatchEvent(
        new CustomEvent("bmf:pro-unavailable", { detail: {} }),
      );
    });
    const spy = vi.fn();
    window.addEventListener("forge:open-settings", spy);
    fireEvent.click(screen.getByText("See Pro — $59 once"));
    expect(spy).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
    window.removeEventListener("forge:open-settings", spy);
  });
});
