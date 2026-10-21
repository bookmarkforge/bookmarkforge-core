import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";

// Interpolating t() mock so assertions can check real rendered text.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (
      key: string,
      defaultOrOptions?: unknown,
      options?: Record<string, string | number>,
    ) => {
      let def: string | null = null;
      let opts: Record<string, string | number> | undefined = options;
      if (typeof defaultOrOptions === "string") {
        def = defaultOrOptions;
      } else if (defaultOrOptions && typeof defaultOrOptions === "object") {
        opts = defaultOrOptions as Record<string, string | number>;
      }
      let out = def ?? key;
      if (opts) {
        for (const [k, v] of Object.entries(opts)) {
          out = out.replace(new RegExp(`{{\\s*${k}\\s*}}`), String(v));
        }
      }
      return out;
    },
  }),
  // src/i18n.ts chains .use(initReactI18next) at import time (reached via
  // EncryptionService → i18n), so the plugin must exist in the mock.
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
}));

vi.mock("lucide-react", () => {
  const mock = (name: string) => {
    const Icon = (props: any) => (
      <svg data-testid={`icon-${name}`} {...props} />
    );
    Icon.displayName = name;
    return Icon;
  };
  return {
    X: mock("X"),
    Download: mock("Download"),
    Trash2: mock("Trash2"),
    Loader2: mock("Loader2"),
    HardDrive: mock("HardDrive"),
    Database: mock("Database"),
  };
});

vi.mock("motion/react", async () => {
  const { createMotionMock } = await import("../../../mocks/motion");
  return createMotionMock();
});

vi.mock("../../../../services/BackupService", () => ({
  BackupService: { exportBackup: vi.fn() },
}));
// StorageCleanupDialog resolves BackupService through the gated Pro loader.
// Without this mock `loadBackupService()` rejects with ProUnavailableError (no
// license in the test env) and `exportBackup` is never reached.
vi.mock("../../../../services/pro-access", () => ({
  ProUnavailableError: class ProUnavailableError extends Error {},
  loadBackupService: async () =>
    (await import("../../../../services/BackupService")).BackupService,
}));

const { mockWithMasterPasswordBytes } = vi.hoisted(() => ({
  mockWithMasterPasswordBytes: vi.fn(),
}));

vi.mock("../../../../services/SecurityVault", () => ({
  securityVault: {
    registerCaller: vi.fn(),
    withMasterPasswordBytes: mockWithMasterPasswordBytes,
    onLock: vi.fn(() => () => {}),
    onUnlock: vi.fn(() => () => {}),
  },
}));

vi.mock("../../../../services/StorageMaintenanceService", () => ({
  clearAICache: vi.fn(),
}));

const { BackupService } = await import("../../../../services/BackupService");
const { clearAICache } = await import(
  "../../../../services/StorageMaintenanceService"
);
const { toast } = await import("sonner");
const { StorageCleanupDialog } = await import(
  "../../../../components/dashboard/components/StorageCleanupDialog"
);

describe("StorageCleanupDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (BackupService.exportBackup as any).mockResolvedValue(undefined);
    // The component only toasts success when clearAICache resolves a valid
    // ClearAICacheResult (useGuardedAction passes the result to onSuccess).
    (clearAICache as any).mockResolvedValue({ bytesFreed: 0 });
    mockWithMasterPasswordBytes.mockImplementation(
      (_caller: unknown, cb: (bytes?: Uint8Array) => Promise<void>) =>
        cb(new Uint8Array([1, 2, 3])),
    );
  });

  it("renders nothing when closed", () => {
    render(<StorageCleanupDialog open={false} onClose={vi.fn()} />);
    expect(screen.queryByText("Storage is almost full")).toBeNull();
  });

  it("renders title, percentage and usage when open", () => {
    render(
      <StorageCleanupDialog
        open
        onClose={vi.fn()}
        percent={96}
        usageLabel="96 GB"
        quotaLabel="100 GB"
      />,
    );
    expect(screen.getByText("Storage is almost full")).toBeTruthy();
    expect(screen.getByText("96%")).toBeTruthy();
    expect(screen.getByText("96 GB used of 100 GB")).toBeTruthy();
  });

  it("exports an encrypted backup using the master password", async () => {
    render(<StorageCleanupDialog open onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("Export backup first"));
    await vi.waitFor(() => {
      expect(mockWithMasterPasswordBytes).toHaveBeenCalledTimes(1);
      expect(BackupService.exportBackup).toHaveBeenCalledTimes(1);
    });
    const arg = (BackupService.exportBackup as any).mock.calls[0][0];
    expect(arg).toBeInstanceOf(Uint8Array);
    expect(Array.from(arg)).toEqual([1, 2, 3]);
  });

  it("clears the AI cache and shows a success toast", async () => {
    render(<StorageCleanupDialog open onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("Clear AI models"));
    await vi.waitFor(() => {
      expect(clearAICache).toHaveBeenCalledTimes(1);
      expect(toast.success).toHaveBeenCalled();
    });
  });

  it("calls onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    render(<StorageCleanupDialog open onClose={onClose} />);
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
