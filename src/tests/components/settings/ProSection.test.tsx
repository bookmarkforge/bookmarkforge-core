// src/tests/components/settings/ProSection.test.tsx
//
// ProSection — the Pro entitlement card in Settings.
// Covers: free state (upgrade/buy/license input), activation flow,
// error display, and pro state (masked key, activations left, deactivate).

import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { act } from "react";
import React from "react";
import type { Entitlements } from "../../../services/LicenseService";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (s: string, fallback?: string, opts?: Record<string, string | number>) =>
      (fallback ?? s).replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(opts?.[k] ?? "")),
    i18n: { language: "en" },
  }),
}));

vi.mock("lucide-react", () => {
  const mock = (name: string) => {
    const Icon = (props: any) => <svg data-testid={`icon-${name}`} {...props} />;
    Icon.displayName = name;
    return Icon;
  };
  return {
    Crown: mock("Crown"),
    Key: mock("Key"),
    BadgeCheck: mock("BadgeCheck"),
    Loader2: mock("Loader2"),
    LogOut: mock("LogOut"),
    Sparkles: mock("Sparkles"),
  };
});

const {
  mockState,
  mockActivate,
  mockStartTrial,
  mockDeactivate,
  mockGetStoredLicenseKey,
  mockGetStoredLicenseKeyAsync,
  mockIsCheckoutConfigured,
} = vi.hoisted(() => {
  const mockState = {
    entitlements: { plan: "free", source: "none" } as Entitlements,
    busy: false,
    error: null as string | null,
  };
  return {
    mockState,
    mockActivate: vi.fn<(key: string) => Promise<boolean>>().mockResolvedValue(true),
    mockStartTrial: vi.fn<() => void>(),
    mockDeactivate: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    mockGetStoredLicenseKey: vi.fn<() => string | null>(() => null),
    mockGetStoredLicenseKeyAsync: vi.fn<() => Promise<string | null>>().mockResolvedValue(null),
    mockIsCheckoutConfigured: vi.fn<() => boolean>(() => true),
  };
});

vi.mock("../../../store/useLicenseStore", () => ({
  useLicenseStore: (sel?: (s: any) => any) => {
    const full = {
      entitlements: mockState.entitlements,
      busy: mockState.busy,
      error: mockState.error,
      activate: mockActivate,
      startTrial: mockStartTrial,
      deactivate: mockDeactivate,
    };
    return sel ? sel(full) : full;
  },
}));

vi.mock("../../../services/LicenseService", () => ({
  licenseService: {
    getStoredLicenseKey: mockGetStoredLicenseKey,
    getStoredLicenseKeyAsync: mockGetStoredLicenseKeyAsync,
  },
}));

vi.mock("../../../constants/license", () => ({
  LICENSE_CONFIG: { checkoutUrlPro: "https://checkout.example.com/pro" },
  isCheckoutConfigured: mockIsCheckoutConfigured,
}));

import { ProSection } from "../../../components/settings/ProSection";

const flushProLicenseLoad = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

describe("ProSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.entitlements = { plan: "free", source: "none" };
    mockState.busy = false;
    mockState.error = null;
    mockGetStoredLicenseKey.mockReturnValue(null);
    mockGetStoredLicenseKeyAsync.mockImplementation(async () =>
      mockGetStoredLicenseKey(),
    );
    mockIsCheckoutConfigured.mockReturnValue(true);
  });

  describe("free state", () => {
    test("shows the upgrade card with a configured buy button", () => {
      render(<ProSection />);
      expect(screen.getByText("Unlock BookmarkForge Pro")).toBeInTheDocument();
      expect(
        // Price is interpolated from PRICING_CONFIG (active phase: early → $59).
        // Pinning it here guards the no-price-drift contract: if the phase or
        // the table changes, this test updates together with the UI.
        screen.getByRole("button", { name: "Get Pro — $59" }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Start 7-day free trial" })).toBeNull();
    });

    test("opens the checkout URL when configured", () => {
      const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
      render(<ProSection />);
      fireEvent.click(screen.getByRole("button", { name: "Get Pro — $59" }));
      expect(openSpy).toHaveBeenCalledWith(
        "https://checkout.example.com/pro",
        "_blank",
        "noopener,noreferrer",
      );
    });

    test("disables buy and shows the checkout note when not configured", () => {
      mockIsCheckoutConfigured.mockReturnValue(false);
      render(<ProSection />);
      expect(
        screen.getByRole("button", { name: "Get Pro — $59" }),
      ).toBeDisabled();
      expect(
        screen.getByText(
          /Checkout isn't connected yet — add your payment provider checkout URL/,
        ),
      ).toBeInTheDocument();
    });

    test("disables Activate until a key is typed", async () => {
      const { unmount } = render(<ProSection />);
      const activate = screen.getByRole("button", { name: "Activate" });
      expect(activate).toBeDisabled();
      fireEvent.change(document.getElementById("license-key-input")!, {
        target: { value: "BF-123" },
      });
      expect(activate).toBeEnabled();
      await flushProLicenseLoad();
      unmount();
    });

    test("activates the typed key on click and clears the input on success", async () => {
      mockActivate.mockResolvedValue(true);
      render(<ProSection />);
      fireEvent.change(document.getElementById("license-key-input")!, {
        target: { value: "BF-1234-ABCD" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Activate" }));
      expect(mockActivate).toHaveBeenCalledWith("BF-1234-ABCD");
      await waitFor(() => {
        expect(
          (document.getElementById("license-key-input") as HTMLInputElement).value,
        ).toBe("");
      });
    });

    test("activates the typed key on Enter", async () => {
      const { unmount } = render(<ProSection />);
      await act(async () => {
        fireEvent.change(document.getElementById("license-key-input")!, {
          target: { value: "BF-5678" },
        });
        fireEvent.keyDown(document.getElementById("license-key-input")!, {
          key: "Enter",
        });
        await vi.waitFor(() => {
          expect(mockActivate).toHaveBeenCalledWith("BF-5678");
        });
        await Promise.resolve();
      });
      unmount();
    });

    test("keeps the input on failure and renders the error", async () => {
      mockActivate.mockResolvedValue(false);
      mockState.error = "Invalid license key";
      const { unmount } = render(<ProSection />);
      await act(async () => {
        fireEvent.change(document.getElementById("license-key-input")!, {
          target: { value: "BF-BAD" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Activate" }));
        await vi.waitFor(() => {
          expect(mockActivate).toHaveBeenCalledWith("BF-BAD");
        });
        await Promise.resolve();
      });
      expect((document.getElementById("license-key-input") as HTMLInputElement).value).toBe(
        "BF-BAD",
      );
      expect(screen.getByRole("alert")).toHaveTextContent("Invalid license key");
      unmount();
    });

  });

  describe("pro state", () => {
    test("shows Pro active with the masked key and activations left", () => {
      mockState.entitlements = {
        plan: "pro",
        source: "license",
        grace: false,
        activationsLeft: 3,
      };
      mockGetStoredLicenseKey.mockReturnValue("BF-1111-2222-3333-4444");
      render(<ProSection />);
      expect(screen.getByText("Pro active")).toBeInTheDocument();
      expect(screen.getByText(/BF-1…4444/)).toBeInTheDocument();
      expect(screen.getByText(/Activations left: 3/)).toBeInTheDocument();
    });

    test("shows the grace note while re-validation is pending", () => {
      mockState.entitlements = { plan: "pro", source: "license", grace: true };
      mockGetStoredLicenseKey.mockReturnValue("BF-1111");
      render(<ProSection />);
      expect(screen.getByText(/Offline grace/)).toBeInTheDocument();
    });

    test("deactivates the license on click", async () => {
      mockState.entitlements = { plan: "pro", source: "license" };
      mockGetStoredLicenseKey.mockReturnValue("BF-1111-2222-3333-4444");
      render(<ProSection />);
      fireEvent.click(
        screen.getByRole("button", { name: "Deactivate license" }),
      );
      expect(mockDeactivate).toHaveBeenCalled();
    });
  });
});
