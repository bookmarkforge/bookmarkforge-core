import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

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

  it("renders but is hidden when show is false (CLS optimization)", () => {
    const { container } = render(
      <BackupReminderBanner show={false} backupAgeMs={null} onDismiss={vi.fn()} />,
    );
    // Banner always renders (reserves space for CLS) but is invisible
    const banner = container.querySelector(".mb-6");
    expect(banner).toBeTruthy();
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

  it("shows stale backup message when backupAgeMs is set", () => {
    const { getByText } = render(
      <BackupReminderBanner show={true} backupAgeMs={5 * 60 * 60 * 1000} onDismiss={vi.fn()} />,
    );
    expect(getByText("Your backup is overdue ⏰")).toBeTruthy();
    expect(
      getByText(/Your last backup is over 48 hours old/),
    ).toBeTruthy();
  });
