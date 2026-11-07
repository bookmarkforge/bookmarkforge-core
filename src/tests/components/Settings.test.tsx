import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

const { mockHandleUpdateVaultKey, mockUseSettingsState } = vi.hoisted(() => {
  const mockHandleUpdateVaultKey = vi.fn();
  const mockUseSettingsState = { isUpdatingPassword: false };
  return { mockHandleUpdateVaultKey, mockUseSettingsState };
});

vi.mock("react-i18next", () => {
  const t = (key: string, options?: any) => options?.defaultValue || key;
  return {
    useTranslation: () => ({ t, i18n: { language: "en" } }),
    initReactI18next: { type: "3rdParty", init: () => {} },
  };
});

vi.mock("../../contexts/ThemeContext", () => ({
  useTheme: () => ({ isDark: false }),
}));

vi.mock("../../hooks/useSecurityStore", () => ({
  useSecurityStore: () => ({ isLocked: false }),
}));

vi.mock("../../hooks/useRxDB", () => ({
  useRxDB: vi.fn(() => ({})),
  // SecurityDashboard (rendered inside the Security settings area) reads the
  // vault item counts. The real hooks require an RxDB provider this suite
  // does not mount, so the double reports an absent collection and a
  // zero-valued count (a count() query resolves to a number, not an array).
  useRxCollection: vi.fn(() => undefined),
  useRxQuery: vi.fn(() => ({ result: 0, loading: false })),
}));

const mockSafeGet = vi.hoisted(() => vi.fn((_key: string) => null));
const mockSafeSet = vi.hoisted(() => vi.fn());
vi.mock("../../store/safeStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../store/safeStorage")>();
  return {
    ...actual,
    safeGet: mockSafeGet,
    safeSet: mockSafeSet,
    safeRemove: vi.fn(),
  };
});

const mockGetSecret = vi.hoisted(() => vi.fn().mockResolvedValue(""));
const mockSetSecret = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("../../services/SecureStorage", () => ({
  secureStorage: {
    getSecret: mockGetSecret,
    setSecret: mockSetSecret,
  },
}));

vi.mock("../../services/pro-access", () => ({
  // BackupService is resolved through the pro-access loader, so the double
  // is installed at the loader instead of at the Pro module.
  loadBackupService: () => Promise.resolve(BackupServiceDouble),
}));
const BackupServiceDouble = {
  importBackup: vi.fn().mockResolvedValue(undefined),
  exportBackup: vi.fn().mockResolvedValue(undefined),
};

vi.mock("../../services/SettingsService", () => ({
  settingsService: {
    downloadSettings: vi.fn(),
    uploadSettings: vi.fn(),
    importSettings: vi.fn(),
    resetSettings: vi.fn(),
  },
}));

vi.mock("../../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../hooks/useSettings", () => ({
  useSettings: () => ({
    t: (key: string, options?: any) => options?.defaultValue || key,
    accentColor: "violet",
    setAccentColor: vi.fn(),
    globalFont: "Inter",
    setGlobalFont: vi.fn(),
    globalFontSize: 16,
    setGlobalFontSize: vi.fn(),
    lang: "en",
    setLang: vi.fn(),
    apiKey: "",
    setApiKey: vi.fn(),
    vaultKey: "test-pass-123",
    setVaultKey: vi.fn(),
    masterPassword: "test-pass-123",
    isUpdatingPassword: mockUseSettingsState.isUpdatingPassword,
    handleUpdateVaultKey: mockHandleUpdateVaultKey,
    provider: "openai",
    canRunWebLLM: false,
    webLlmProgress: null,
    handleProviderChange: vi.fn(),
    handleApiKeySave: vi.fn(),
    isDistractionFree: false,
    setIsDistractionFree: vi.fn(),
    autoLockEnabled: false,
    setAutoLockEnabled: vi.fn(),
    customPrompts: [],
    setCustomPrompts: vi.fn(),
    handleSavePrompts: vi.fn(),
  }),
}));

vi.mock("../../components/settings/components", () => ({
  AppearanceSection: () => (
    <div data-testid="appearance-section">Appearance</div>
  ),
  FocusModeSection: () => <div data-testid="focus-section">Focus</div>,
  CustomPromptsSection: () => <div data-testid="prompts-section">Prompts</div>,
  AIConfigSection: () => <div data-testid="aiconfig-section">AIConfig</div>,
  AdvancedSection: () => <div data-testid="advanced-section">Advanced</div>,
  ModelManagerSection: () => (
    <div data-testid="model-section">ModelManager</div>
  ),
  StorageSection: () => <div data-testid="storage-section">Storage</div>,
  ProSection: () => <div data-testid="pro-section">Pro</div>,
  APIUsageDashboard: () => <div data-testid="apiusage-section">APIUsage</div>,
  CloudSyncSection: () => <div data-testid="cloudsync-section">CloudSync</div>,
  NetworkPermissionsSection: () => (
    <div data-testid="network-section">Network Permissions</div>
  ),
  IntelligentMaintenanceSection: () => (
    <div data-testid="maintenance-section">Maintenance</div>
  ),
}));

vi.mock("../../components/ExportDialog", () => ({
  default: ({ isOpen }: any) =>
    isOpen ? <div data-testid="export-dialog">Export</div> : null,
}));

vi.mock("../../components/bookmarks/DiagnosticsModal", () => ({
  DiagnosticsModal: ({ show }: any) =>
    show ? <div data-testid="diagnostics-modal">Diagnostics</div> : null,
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("lucide-react", () => ({
  Settings: () => <div data-testid="icon-Settings" />,
  FileText: () => <div data-testid="icon-FileText" />,
  Plus: () => <div data-testid="icon-Plus" />,
  Trash2: () => <div data-testid="icon-Trash2" />,
  AlertTriangle: () => <div data-testid="icon-AlertTriangle" />,
  Folder: () => <div data-testid="icon-Folder" />,
  Sparkles: () => <div data-testid="icon-Sparkles" />,
  ChevronRight: () => <div data-testid="icon-ChevronRight" />,
  LayoutGrid: () => <div data-testid="icon-LayoutGrid" />,
  List: () => <div data-testid="icon-List" />,
  Cloud: () => <div data-testid="icon-Cloud" />,
  X: () => <div data-testid="icon-X" />,
  Lock: () => <div data-testid="icon-Lock" />,
  Key: () => <div data-testid="icon-Key" />,
  Save: () => <div data-testid="icon-Save" />,
  Loader2: () => <div data-testid="icon-Loader2" />,
  RotateCcw: () => <div data-testid="icon-RotateCcw" />,
  Database: () => <div data-testid="icon-Database" />,
  Upload: () => <div data-testid="icon-Upload" />,
  Download: () => <div data-testid="icon-Download" />,
  ConfigIcon: () => <div data-testid="icon-Settings" />,
  RefreshCw: () => <div data-testid="icon-RefreshCw" />,
  Shield: () => <div data-testid="icon-Shield" />,
  ShieldCheck: () => <div data-testid="icon-ShieldCheck" />,
  Clock: () => <div data-testid="icon-Clock" />,
  Unlock: () => <div data-testid="icon-Unlock" />,
  Eye: () => <div data-testid="icon-Eye" />,
}));

describe("Settings", () => {
  let Settings: React.FC<{ onClose: () => void }>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockUseSettingsState.isUpdatingPassword = false;
    const mod = await import("../../components/Settings");
    Settings = mod.Settings;
  });

  it("renders the title", () => {
    render(<Settings onClose={vi.fn()} />);
    expect(screen.getByText("app_settings")).toBeTruthy();
  });

  it("shows close button", () => {
    render(<Settings onClose={vi.fn()} />);
    expect(screen.getByText("app_close")).toBeTruthy();
  });

  it("calls onClose when clicking X", async () => {
    const onClose = vi.fn();
    render(<Settings onClose={onClose} />);
    // Target the header close button by its accessible label: the
    // SecurityDashboard rendered in this view also draws an X icon for its
    // "fail" status, so the icon test-id is no longer unique inside the
    // dialog.
    await userEvent.click(screen.getByLabelText("app_close"));
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when clicking the Close button", async () => {
    const onClose = vi.fn();
    render(<Settings onClose={onClose} />);
    await userEvent.click(screen.getByText("app_close"));
    expect(onClose).toHaveBeenCalled();
  });

  it("renders AppearanceSection", () => {
    render(<Settings onClose={vi.fn()} />);
    expect(screen.getByTestId("appearance-section")).toBeTruthy();
  });

  it("renders the settings modal title and all top-level sections", () => {
    render(<Settings onClose={vi.fn()} />);
    expect(screen.getByText("app_settings")).toBeTruthy();
    expect(screen.getByTestId("appearance-section")).toBeTruthy();
    expect(screen.getByTestId("focus-section")).toBeTruthy();
    expect(screen.getByTestId("aiconfig-section")).toBeTruthy();
    expect(screen.getByTestId("cloudsync-section")).toBeTruthy();
    expect(screen.getByTestId("storage-section")).toBeTruthy();
    expect(screen.getByTestId("network-section")).toBeTruthy();
    // SecuritySection (master password + auto-lock + danger zone) renders.
    expect(screen.getByText("app_masterPassword")).toBeTruthy();
    expect(screen.getByText("app_dangerZone")).toBeTruthy();
  });

  it("renders export data button", () => {
    render(<Settings onClose={vi.fn()} />);
    expect(screen.getByText("app_exportData")).toBeTruthy();
  });

  it("renders import data button", () => {
    render(<Settings onClose={vi.fn()} />);
    expect(screen.getByText("app_importData")).toBeTruthy();
  });

  it("renders export settings button", () => {
    render(<Settings onClose={vi.fn()} />);
    expect(screen.getByText("app_exportSettings")).toBeTruthy();
  });

  it("renders import settings button", () => {
    render(<Settings onClose={vi.fn()} />);
    expect(screen.getByText("app_importSettings")).toBeTruthy();
  });

  it("renders update password button", () => {
    render(<Settings onClose={vi.fn()} />);
    expect(screen.getByText("app_updatePassword")).toBeTruthy();
  });

  it("renders reset settings button", () => {
    render(<Settings onClose={vi.fn()} />);
    expect(screen.getByText("app_resetSettings")).toBeTruthy();
  });

  // --- Interaction tests ---

  it("opens ExportDialog when clicking export data button", async () => {
    render(<Settings onClose={vi.fn()} />);
    expect(screen.queryByTestId("export-dialog")).toBeNull();
    await userEvent.click(screen.getByText("app_exportData"));
    expect(screen.getByTestId("export-dialog")).toBeTruthy();
  });

  // --- New import flow tests (modal-based, no window.prompt) ---

  it("imports .json file directly without password modal", async () => {
    render(<Settings onClose={vi.fn()} />);
    const file = new File(['{"test":true}'], "backup.json", {
      type: "application/json",
    });
    const input = screen.getByLabelText("app_importData");
    fireEvent.change(input, { target: { files: [file] } });
    const { loadBackupService } = await import("../../services/pro-access");
    const BackupService = await loadBackupService();
    await waitFor(() => {
      expect(BackupService.importBackup).toHaveBeenCalledWith(file, undefined);
    });
  });

  it("ignores a second restore while the first backup is still in progress", async () => {
    const { loadBackupService } = await import("../../services/pro-access");
    const BackupService = await loadBackupService();
    let resolveImport: (() => void) | undefined;
    (BackupService.importBackup as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise<void>((resolve) => {
        resolveImport = resolve;
      }),
    );
    render(<Settings onClose={vi.fn()} />);
    const file = new File(['{"test":true}'], "backup.json", {
      type: "application/json",
    });
    const input = screen.getByLabelText("app_importData");
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.change(input, { target: { files: [file] } });

    // The import now resolves BackupService through the pro-access loader,
    // so the guarded call lands after a microtask, not synchronously.
    await waitFor(() =>
      expect(BackupService.importBackup).toHaveBeenCalledTimes(1),
    );
    resolveImport?.();
    const { toast } = await import("sonner");
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("app_backupImportSuccess");
    });
  });

  it("selecting a .bmf file shows the password modal", async () => {
    render(<Settings onClose={vi.fn()} />);
    const file = new File(["encrypted"], "backup.bmf", {
      type: "application/octet-stream",
    });
    const input = screen.getByLabelText("app_importData");
    fireEvent.change(input, { target: { files: [file] } });
    // The modal should appear with the password input
    await waitFor(() => {
      expect(screen.getByLabelText("app_enterPasswordDecrypt")).toBeTruthy();
    });
    // The file name should be displayed in the modal
    expect(screen.getByText("backup.bmf")).toBeTruthy();
  });

  it("modal .bmf: ingresar password y hacer click Unlock llama a importBackup", async () => {
    render(<Settings onClose={vi.fn()} />);
    const file = new File(["encrypted"], "backup.bmf", {
      type: "application/octet-stream",
    });
    const input = screen.getByLabelText("app_importData");
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByLabelText("app_enterPasswordDecrypt")).toBeTruthy();
    });

    const passwordInput = screen.getByLabelText("app_enterPasswordDecrypt");
    await userEvent.type(passwordInput, "secret123");
    await userEvent.click(screen.getByText("app_unlock"));

    const { loadBackupService } = await import("../../services/pro-access");
    const BackupService = await loadBackupService();
    await waitFor(() => {
      expect(BackupService.importBackup).toHaveBeenCalledWith(
        file,
        "secret123",
      );
    });
  });

  it("modal .bmf: pressing Enter in the password input submits", async () => {
    render(<Settings onClose={vi.fn()} />);
    const file = new File(["encrypted"], "backup.bmf", {
      type: "application/octet-stream",
    });
    const input = screen.getByLabelText("app_importData");
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByLabelText("app_enterPasswordDecrypt")).toBeTruthy();
    });

    const passwordInput = screen.getByLabelText("app_enterPasswordDecrypt");
    await userEvent.type(passwordInput, "myPass");
    passwordInput.focus();
    await userEvent.keyboard("{Enter}");

    const { loadBackupService } = await import("../../services/pro-access");
    const BackupService = await loadBackupService();
    await waitFor(() => {
      expect(BackupService.importBackup).toHaveBeenCalledWith(file, "myPass");
    });
  });

  it("modal .bmf: empty password shows error toast and does not call importBackup", async () => {
    render(<Settings onClose={vi.fn()} />);
    const file = new File(["encrypted"], "backup.bmf", {
      type: "application/octet-stream",
    });
    const input = screen.getByLabelText("app_importData");
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByLabelText("app_enterPasswordDecrypt")).toBeTruthy();
    });

    // Submit with empty password
    await userEvent.click(screen.getByText("app_unlock"));

    const { loadBackupService } = await import("../../services/pro-access");
    const BackupService = await loadBackupService();
    const { toast } = await import("sonner");
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("app_passwordEmpty");
      expect(BackupService.importBackup).not.toHaveBeenCalled();
    });
  });

  it("modal .bmf: restores focus to the button that opened the dialog", async () => {
    render(<Settings onClose={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: "app_importData" });
    trigger.focus();
    const file = new File(["encrypted"], "backup.bmf", {
      type: "application/octet-stream",
    });
    fireEvent.change(screen.getByLabelText("app_importData"), {
      target: { files: [file] },
    });
    await waitFor(() => {
      expect(screen.getByLabelText("app_enterPasswordDecrypt")).toBeTruthy();
    });
    await userEvent.click(screen.getByText("app_cancel"));
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });
  });

  it("modal .bmf: Cancel button closes the modal without importing", async () => {
    render(<Settings onClose={vi.fn()} />);
    const file = new File(["encrypted"], "backup.bmf", {
      type: "application/octet-stream",
    });
    const input = screen.getByLabelText("app_importData");
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByLabelText("app_enterPasswordDecrypt")).toBeTruthy();
    });

    await userEvent.click(screen.getByText("app_cancel"));

    const { loadBackupService } = await import("../../services/pro-access");
    const BackupService = await loadBackupService();
    await waitFor(() => {
      expect(screen.queryByLabelText("app_enterPasswordDecrypt")).toBeNull();
      expect(BackupService.importBackup).not.toHaveBeenCalled();
    });
  });

  it("importBackup error shows error toast", async () => {
    const { loadBackupService } = await import("../../services/pro-access");
    const BackupService = await loadBackupService();
    (
      BackupService.importBackup as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new Error("import failed"));
    render(<Settings onClose={vi.fn()} />);
    const file = new File(["data"], "backup.json", {
      type: "application/json",
    });
    const input = screen.getByLabelText("app_importData");
    fireEvent.change(input, { target: { files: [file] } });
    const { toast } = await import("sonner");
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("app_backupImportError");
    });
  });

  it("handleExportSettings llama a settingsService.downloadSettings", async () => {
    render(<Settings onClose={vi.fn()} />);
    await userEvent.click(screen.getByText("app_exportSettings"));
    const { settingsService } = await import("../../services/SettingsService");
    expect(settingsService.downloadSettings).toHaveBeenCalledTimes(1);
  });

  it("exports settings via settingsService and shows a success toast", async () => {
    render(<Settings onClose={vi.fn()} />);
    await userEvent.click(screen.getByText("app_exportSettings"));
    const { settingsService } = await import("../../services/SettingsService");
    const { toast } = await import("sonner");
    expect(settingsService.downloadSettings).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("app_settingsExported");
  });

  it("handleImportSettings llama a settingsService.uploadSettings", async () => {
    render(<Settings onClose={vi.fn()} />);
    const file = new File(['{"theme":"dark"}'], "settings.json", {
      type: "application/json",
    });
    const input = screen.getByLabelText("app_importSettings");
    fireEvent.change(input, { target: { files: [file] } });
    const { settingsService } = await import("../../services/SettingsService");
    await waitFor(() => {
      expect(settingsService.uploadSettings).toHaveBeenCalledWith(file);
    });
  });

  it("ignores a second settings import while the first is still in progress", async () => {
    const { settingsService } = await import("../../services/SettingsService");
    let resolveUpload: ((settings: unknown) => void) | undefined;
    (settingsService.uploadSettings as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise<unknown>((resolve) => {
        resolveUpload = resolve;
      }),
    );
    render(<Settings onClose={vi.fn()} />);
    const file = new File(['{"theme":"dark"}'], "settings.json", {
      type: "application/json",
    });
    const input = screen.getByLabelText("app_importSettings");
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.change(input, { target: { files: [file] } });

    expect(settingsService.uploadSettings).toHaveBeenCalledTimes(1);
    resolveUpload?.({ theme: "dark" });
    await waitFor(() => {
      expect(settingsService.importSettings).toHaveBeenCalledWith({
        theme: "dark",
      });
    });
  });

  it("click en Update Password llama a handleUpdateVaultKey", async () => {
    render(<Settings onClose={vi.fn()} />);
    await userEvent.click(screen.getByText("app_updatePassword"));
    expect(mockHandleUpdateVaultKey).toHaveBeenCalledTimes(1);
  });

  it("shows spinner and disabled when isUpdatingPassword is true", () => {
    mockUseSettingsState.isUpdatingPassword = true;
    render(<Settings onClose={vi.fn()} />);
    expect(screen.getByTestId("icon-Loader2")).toBeTruthy();
    const btn = screen.getByText("app_updatePassword").closest("button");
    expect(btn).toBeDisabled();
  });

  it("reset settings con confirm=true llama a resetSettings", async () => {
    window.confirm = vi.fn().mockReturnValue(true);
    render(<Settings onClose={vi.fn()} />);
    await userEvent.click(screen.getByText("app_resetSettings"));
    const { settingsService } = await import("../../services/SettingsService");
    expect(settingsService.resetSettings).toHaveBeenCalledTimes(1);
  });

  it("reset settings con confirm=false no llama a resetSettings", async () => {
    window.confirm = vi.fn().mockReturnValue(false);
    render(<Settings onClose={vi.fn()} />);
    await userEvent.click(screen.getByText("app_resetSettings"));
    const { settingsService } = await import("../../services/SettingsService");
    expect(settingsService.resetSettings).not.toHaveBeenCalled();
  });

  it("import settings fails and shows error toast", async () => {
    const { settingsService } = await import("../../services/SettingsService");
    (
      settingsService.uploadSettings as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new Error("upload failed"));
    render(<Settings onClose={vi.fn()} />);
    const file = new File(['{"theme":"dark"}'], "settings.json", {
      type: "application/json",
    });
    const input = screen.getByLabelText("app_importSettings");
    fireEvent.change(input, { target: { files: [file] } });
    const { toast } = await import("sonner");
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith("app_settingsImportError");
    });
  });

  it("ignores an importBackup that resolves after unmount (no toast)", async () => {
    const { loadBackupService } = await import("../../services/pro-access");
    const BackupService = await loadBackupService();
    (BackupService.importBackup as ReturnType<typeof vi.fn>).mockReset();
    let resolveImport: (() => void) | undefined;
    (BackupService.importBackup as ReturnType<typeof vi.fn>).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveImport = resolve;
        }),
    );
    const { unmount } = render(<Settings onClose={vi.fn()} />);
    const file = new File(['{"test":true}'], "backup.json", {
      type: "application/json",
    });
    fireEvent.change(screen.getByLabelText("app_importData"), {
      target: { files: [file] },
    });
    await waitFor(() => expect(BackupService.importBackup).toHaveBeenCalled());
    unmount();
    resolveImport?.();
    const { toast } = await import("sonner");
    // Flush microtasks: if the late continuation existed, it would have run by now.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    // Restore the default implementation so the deferred does not leak to other tests.
    (BackupService.importBackup as ReturnType<typeof vi.fn>).mockReset();
    (BackupService.importBackup as ReturnType<typeof vi.fn>).mockResolvedValue(
      undefined,
    );
  });

  it("ignores an uploadSettings error after unmount (no toast)", async () => {
    const { settingsService } = await import("../../services/SettingsService");
    (settingsService.uploadSettings as ReturnType<typeof vi.fn>).mockReset();
    let rejectUpload: (e: Error) => void = () => {};
    (settingsService.uploadSettings as ReturnType<typeof vi.fn>).mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectUpload = reject;
        }),
    );
    const { unmount } = render(<Settings onClose={vi.fn()} />);
    const file = new File(['{"theme":"dark"}'], "settings.json", {
      type: "application/json",
    });
    fireEvent.change(screen.getByLabelText("app_importSettings"), {
      target: { files: [file] },
    });
    await waitFor(() =>
      expect(settingsService.uploadSettings).toHaveBeenCalled(),
    );
    unmount();
    rejectUpload(new Error("upload failed"));
    const { toast } = await import("sonner");
    // Flush microtasks: if the late continuation existed, it would have run by now.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    // Restore the default implementation so the deferred does not leak to other tests.
    (settingsService.uploadSettings as ReturnType<typeof vi.fn>).mockReset();
    (settingsService.uploadSettings as ReturnType<typeof vi.fn>).mockResolvedValue(
      {},
    );
  });
});
