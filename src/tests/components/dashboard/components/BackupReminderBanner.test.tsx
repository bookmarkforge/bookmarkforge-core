import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { ProUnavailableError } from "../../../../services/pro-access";

const mockExportBackup = vi.fn();
const mockWithMasterPasswordBytes = vi.fn(
  (_caller: object, fn: (p: Uint8Array | null) => unknown) => fn(new TextEncoder().encode("mypass")),
);
const mockToast = vi.hoisted(() => ({
  loading: vi.fn(),
  dismiss: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("motion/react", async () => {
  const { createMotionMock } = await import("../../../mocks/motion");
  return createMotionMock();
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (s: string, d?: string) => d ?? s }),
}));

vi.mock("sonner", () => ({ toast: mockToast }));

vi.mock("../../../../services/BackupService", () => ({
  BackupService: { exportBackup: mockExportBackup },
}));

// Mock the pro-access seam, not LicenseService: the real pro-access chains
// LicenseService → ai/utils → src/i18n.ts, whose bootstrap fights the
// react-i18next mock above. The error class lives INSIDE the factory (the
// factory is hoisted above top-level consts), and the test imports it from
// the mocked module, so the `instanceof` check inside the banner sees the
// same class the test throws.
const mockAnnounce = vi.hoisted(() => vi.fn());
vi.mock("../../../../services/pro-access", () => {
  class ProUnavailableError extends Error {
    readonly service: string;
    readonly reason: "no-license" | "load-failed";
    constructor(service: string, reason: "no-license" | "load-failed") {
      super(`Pro feature "${service}" requires a Pro license.`);
      this.name = "ProUnavailableError";
      this.service = service;
      this.reason = reason;
    }
  }
  return {
    loadBackupService: vi.fn(async () => ({ exportBackup: mockExportBackup })),
    ProUnavailableError,
    announceProUnavailable: mockAnnounce,
  };
});

vi.mock("../../../../services/SecurityVault", () => ({
  securityVault: {
    withMasterPasswordBytes: mockWithMasterPasswordBytes,
    registerCaller: vi.fn(),
    onLock: vi.fn(() => () => {}),
    onUnlock: vi.fn(() => () => {}),
  },
}));

const { BackupReminderBanner } =
  await import("../../../../components/dashboard/components/BackupReminderBanner");

describe("BackupReminderBanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders collapsed and invisible when show is false", () => {
    const { container } = render(
      <BackupReminderBanner show={false} backupAgeMs={null} onDismiss={vi.fn()} />,
    );
    // Always mounted, but costing no layout space and no accessibility
    // surface (ADR-055).
    const banner = container.querySelector(".mb-6") as HTMLElement;
    expect(banner).toBeTruthy();
    expect(banner.style.height).toBe("0px");
  });

  it("holds its measured height behind a shimmer while pending (ADR-055)", () => {
    const { container } = render(
      <BackupReminderBanner
        show={false}
        pending
        backupAgeMs={null}
        onDismiss={vi.fn()}
      />,
    );
    const banner = container.querySelector(".mb-6") as HTMLElement;
    // jsdom cannot measure, so the hold reserves the estimate — the point is
    // that it is NOT 0: the eventual reveal happens in an already-sized box.
    expect(banner.style.height).not.toBe("0px");
    expect(banner.style.visibility).toBe("visible");
    // The real content stays out of reach while the decision is pending…
    expect(
      screen.getByText(/Protect Your Knowledge Vault/),
    ).not.toBeVisible();
    // …and the shimmer stands in for it, never announced.
    expect(
      document.querySelector("[data-testid=collapsible-surface-placeholder]"),
    ).not.toBeNull();
  });

  it("reveals in place when pending settles to shown — no height jump", () => {
    const { container, rerender } = render(
      <BackupReminderBanner
        show={false}
        pending
        backupAgeMs={null}
        onDismiss={vi.fn()}
      />,
    );
    rerender(
      <BackupReminderBanner
        show
        backupAgeMs={null}
        onDismiss={vi.fn()}
      />,
    );
    const banner = container.querySelector(".mb-6") as HTMLElement;
    expect(banner.style.visibility).toBe("visible");
    expect(
      screen.getByText(/Protect Your Knowledge Vault/),
    ).toBeVisible();
    expect(
      document.querySelector("[data-testid=collapsible-surface-placeholder]"),
    ).toBeNull();
  });

  it("hides the whole subtree from assistive tech while off (not just opacity)", () => {
    const { container } = render(
      <BackupReminderBanner
        show={false}
        backupAgeMs={null}
        onDismiss={vi.fn()}
      />,
    );
    // The backup reminder is the loudest banner in the app; at opacity 0 it
    // would still be announced and its export/dismiss buttons would still
    // take focus while the user sees nothing.
    const banner = container.querySelector(".mb-6") as HTMLElement;
    expect(banner.style.visibility).toBe("hidden");
    expect(screen.getByText("Export Physical Backup File")).not.toBeVisible();
    expect(screen.getByText("Got it, remind me later")).not.toBeVisible();
  });

  it("renders banner when show is true", () => {
    const { getByText } = render(
      <BackupReminderBanner show={true} backupAgeMs={null} onDismiss={vi.fn()} />,
    );
    expect(
      getByText("Protect Your Knowledge Vault: Everything is Local 🔒"),
    ).toBeTruthy();
  });

  it("calls onDismiss when clicking dismiss", async () => {
    const onDismiss = vi.fn();
    const { getByText } = render(
      <BackupReminderBanner show={true} backupAgeMs={null} onDismiss={onDismiss} />,
    );
    await userEvent.click(getByText("Got it, remind me later"));
    expect(onDismiss).toHaveBeenCalled();
  });

  it("calls BackupService.exportBackup when clicking export", async () => {
    mockWithMasterPasswordBytes.mockImplementation((_caller: any, fn: any) => fn(new TextEncoder().encode("mypass")));
    mockExportBackup.mockResolvedValue(undefined);
    const { getByText } = render(
      <BackupReminderBanner show={true} backupAgeMs={null} onDismiss={vi.fn()} />,
    );
    await userEvent.click(getByText("Export Physical Backup File"));
    await vi.waitFor(() => {
      expect(mockWithMasterPasswordBytes).toHaveBeenCalled();
      expect(mockExportBackup).toHaveBeenCalled();
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  it("ignores a second click while the export is still in progress", async () => {
    let resolveExport: (() => void) | undefined;
    mockWithMasterPasswordBytes.mockImplementation(
      (_caller: object, fn: (p: Uint8Array | null) => unknown) =>
        fn(new TextEncoder().encode("mypass")),
    );
    mockExportBackup.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveExport = resolve;
      }),
    );
    const { getByText } = render(
      <BackupReminderBanner show={true} backupAgeMs={null} onDismiss={vi.fn()} />,
    );
    const exportButton = getByText("Export Physical Backup File");
    await userEvent.click(exportButton);
    await userEvent.click(exportButton);

    expect(mockExportBackup).toHaveBeenCalledTimes(1);
    resolveExport?.();
    await vi.waitFor(() => {
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  it("shows error if BackupService fails", async () => {
    mockWithMasterPasswordBytes.mockImplementation((_caller: any, fn: any) => fn(null));
    mockExportBackup.mockRejectedValue(new Error("fail"));
    const { getByText } = render(
      <BackupReminderBanner show={true} backupAgeMs={null} onDismiss={vi.fn()} />,
    );
    await userEvent.click(getByText("Export Physical Backup File"));
    // Wait for the async handler
    await vi.waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it("ignores an export that resolves after unmount (no toasts or onDismiss)", async () => {
    let resolveExport: (() => void) | undefined;
    mockWithMasterPasswordBytes.mockImplementation(
      (_caller: object, fn: (p: Uint8Array | null) => unknown) =>
        fn(new TextEncoder().encode("mypass")),
    );
    mockExportBackup.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveExport = resolve;
      }),
    );
    const onDismiss = vi.fn();
    const { getByText, unmount } = render(
      <BackupReminderBanner show={true} backupAgeMs={null} onDismiss={onDismiss} />,
    );
    await userEvent.click(getByText("Export Physical Backup File"));
    await vi.waitFor(() => expect(mockExportBackup).toHaveBeenCalled());
    unmount();
    resolveExport?.();
    // Flush microtasks: if the late continuation existed, it would have run by now.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockToast.success).not.toHaveBeenCalled();
    expect(mockToast.dismiss).not.toHaveBeenCalled();
    expect(mockToast.error).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });
});

  it("opens the Pro panel (bmf:pro-unavailable) instead of a bare failure toast when the backup service is gated", async () => {
    mockWithMasterPasswordBytes.mockImplementation((_caller: any, fn: any) => fn(null));
    mockExportBackup.mockRejectedValue(
      new ProUnavailableError("BackupService", "no-license"),
    );
    const { getByText } = render(
      <BackupReminderBanner show={true} backupAgeMs={null} onDismiss={vi.fn()} />,
    );
    await userEvent.click(getByText("Export Physical Backup File"));
    await vi.waitFor(() => expect(mockAnnounce).toHaveBeenCalledOnce());
    const announced = mockAnnounce.mock.calls[0]![0] as ProUnavailableError;
    expect(announced.service).toBe("BackupService");
    expect(announced.reason).toBe("no-license");
    expect(mockToast.error).not.toHaveBeenCalled();
  });

  it("shows stale backup message when backupAgeMs is set", () => {
    const { getByText } = render(
      <BackupReminderBanner show={true} backupAgeMs={5 * 60 * 60 * 1000} onDismiss={vi.fn()} />,
    );
    expect(getByText("Your backup is overdue ⏰")).toBeTruthy();
    expect(
      getByText(/Your last backup is over 48 hours old/),
    ).toBeTruthy();
  });
