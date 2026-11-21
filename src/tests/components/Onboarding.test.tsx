import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

const { safeGetMock, safeRemoveMock } = vi.hoisted(() => ({
  safeGetMock: vi.fn((_key: string): string | null => null),
  safeRemoveMock: vi.fn(),
}));

const safeSetMock = vi.fn();

vi.mock("../../store/safeStorage", () => ({
  safeGet: safeGetMock,
  safeRemove: safeRemoveMock,
  safeSet: (...args: any[]) => safeSetMock(...args),
  safeSessionClear: vi.fn(),
  createStorageAdapter: vi.fn(() => ({
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  })),
}));

vi.mock("../../constants/storage-keys", () => ({
  STORAGE_KEYS: {
    ONBOARDING_COMPLETE: "bmf_onboarding_complete",
    RESTORE_SUCCESS_PENDING: "forge_restore_success_pending",
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_s: string, fb?: string) => fb || "",
  }),
  // src/i18n.ts chains .use(initReactI18next) at import time (reached via
  // EncryptionService → i18n), so the plugin must exist in the mock.
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("lucide-react", () => ({
  X: () => <svg data-testid="icon-x" />,
  BookOpen: () => <svg data-testid="icon-book" />,
  Shield: () => <svg data-testid="icon-shield" />,
  Sparkles: () => <svg data-testid="icon-sparkles" />,
  Database: () => <svg data-testid="icon-database" />,
  ArrowRight: () => <svg data-testid="icon-arrow" />,
  Check: () => <svg data-testid="icon-check" />,
  Loader2: () => <svg data-testid="icon-loader" />,
  HardDriveDownload: () => <svg data-testid="icon-manual-export" />,
}));

// vi.mock factories are hoisted above any const declarations, so the mock
// functions they reference must be created with vi.hoisted.
const {
  mockImportBackup,
  mockRestoreFromAutoBackup,
  mockGetAutoBackupInfo,
  mockToast,
  mockBackupService,
} = vi.hoisted(() => {
  const importBackup = vi.fn();
  const restoreFromAutoBackup = vi.fn();
  const getAutoBackupInfo = vi.fn();
  return {
    mockImportBackup: importBackup,
    mockRestoreFromAutoBackup: restoreFromAutoBackup,
    mockGetAutoBackupInfo: getAutoBackupInfo,
    // `dismiss` is part of the real sonner surface and the component calls
    // it before rebooting after a successful restore; a mock without it made
    // the restore path throw where production never would.
    mockToast: {
      success: vi.fn(),
      error: vi.fn(),
      dismiss: vi.fn(),
      loading: vi.fn(),
    },
    // The same object is handed to both mocks below: the component reaches the
    // service through the Pro loader, and the assertions reach the spies. If the
    // loader returned a different object the spies would record nothing.
    mockBackupService: {
      importBackup: (...args: unknown[]) => importBackup(...args),
      restoreFromAutoBackup: (...args: unknown[]) =>
        restoreFromAutoBackup(...args),
      getAutoBackupInfo: (...args: unknown[]) => getAutoBackupInfo(...args),
    },
  };
});

vi.mock("../../services/BackupService", () => ({
  BackupService: mockBackupService,
}));
// Onboarding resolves Pro services through the gated loader, not by importing
// BackupService directly. Without this mock `loadBackupService()` rejects with
// ProUnavailableError (no license in the test env) and the restore/import paths
// fail before the mocked functions are ever called.
vi.mock("../../services/pro-access", () => ({
  ProUnavailableError: class ProUnavailableError extends Error {},
  loadBackupService: async () => mockBackupService,
}));

vi.mock("sonner", () => ({ toast: mockToast }));

import { Onboarding } from "../../components/Onboarding";

const reloadMock = vi.fn();

describe("Onboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAutoBackupInfo.mockResolvedValue({ available: false });
    vi.stubGlobal("location", { ...window.location, reload: reloadMock });
  });

  it("shows and consumes a pending restore success after reload", () => {
    safeGetMock.mockReturnValueOnce("true");
    render(<Onboarding onComplete={vi.fn()} />);
    expect(mockToast.success).toHaveBeenCalledWith("Vault restored successfully.");
    expect(safeRemoveMock).toHaveBeenCalledWith("forge_restore_success_pending");
  });

  it("renders the welcome step by default", () => {
    render(<Onboarding onComplete={vi.fn()} />);
    expect(screen.getByText("Welcome to BookmarkForge")).toBeTruthy();
    expect(
      screen.getByText(/Smart search is included free — Raindrop charges yearly for it/),
    ).toBeTruthy();
  });

  it("syncs into recovery mode when vaultIsEmpty arrives after mount", () => {
    // F0-2 race guard: the emptiness check can resolve AFTER the wizard
    // mounts, so the wizard must react to the prop becoming true — not only
    // to its value at first render.
    const { rerender } = render(<Onboarding onComplete={vi.fn()} />);
    expect(screen.getByText("Welcome to BookmarkForge")).toBeTruthy();

    rerender(<Onboarding onComplete={vi.fn()} vaultIsEmpty={true} />);
    expect(screen.getByText("Your vault is empty")).toBeTruthy();
    expect(screen.getByText("Restore from backup file")).toBeTruthy();
  });

  it("renders the 4 progress dots", () => {
    render(<Onboarding onComplete={vi.fn()} />);
    const dots = document.querySelectorAll(".h-1\\.5");
    expect(dots.length).toBe(4);
  });

  it("skip calls onComplete and saves to storage", async () => {
    const onComplete = vi.fn();
    render(<Onboarding onComplete={onComplete} />);
    await userEvent.click(screen.getByLabelText("Skip onboarding"));
    expect(safeSetMock).toHaveBeenCalledWith("bmf_onboarding_complete", "true");
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it("Continue advances to the next step", async () => {
    render(<Onboarding onComplete={vi.fn()} />);
    await userEvent.click(screen.getByText("Continue"));
    expect(screen.getByText("100% Private by Default")).toBeTruthy();
  });

  it("Back returns to the previous step", async () => {
    render(<Onboarding onComplete={vi.fn()} />);
    await userEvent.click(screen.getByText("Continue")); // step 1 → 2
    await userEvent.click(screen.getByText("Back")); // step 2 → 1
    expect(screen.getByText("Welcome to BookmarkForge")).toBeTruthy();
  });

  it("Back is disabled on the first step", () => {
    render(<Onboarding onComplete={vi.fn()} />);
    const backBtn = screen.getByText("Back");
    expect((backBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("Get Started on the last step calls onComplete", async () => {
    const onComplete = vi.fn();
    render(<Onboarding onComplete={onComplete} />);
    // Advance through all 4 steps
    await userEvent.click(screen.getByText("Continue")); // → privacy
    await userEvent.click(screen.getByText("Continue")); // → ai
    await userEvent.click(screen.getByText("Continue")); // → backup
    expect(screen.getByText("Get Started")).toBeTruthy();
    await userEvent.click(screen.getByText("Get Started"));
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it("keeps the welcome step free of credentials", () => {
    render(<Onboarding onComplete={vi.fn()} />);
    expect(screen.queryByLabelText("Set a vault password")).toBeNull();
  });

  it("shows the features list in the privacy step", async () => {
    render(<Onboarding onComplete={vi.fn()} />);
    await userEvent.click(screen.getByText("Continue"));
    expect(screen.getByText("AES-GCM-256 encryption")).toBeTruthy();
    expect(screen.getByText(/No cloud storage/)).toBeTruthy();
  });

  it("shows AI providers in the ai step", async () => {
    render(<Onboarding onComplete={vi.fn()} />);
    await userEvent.click(screen.getByText("Continue")); // → privacy
    await userEvent.click(screen.getByText("Continue")); // → ai
    expect(screen.getByText("WebLLM (Local)")).toBeTruthy();
    expect(screen.getByText("Google Gemini")).toBeTruthy();
    expect(screen.getByText("OpenAI")).toBeTruthy();
    expect(screen.getByText("Anthropic Claude")).toBeTruthy();
  });

  it("reaches the last step (backup) correctly", async () => {
    render(<Onboarding onComplete={vi.fn()} />);
    await userEvent.click(screen.getByText("Continue")); // → privacy
    await userEvent.click(screen.getByText("Continue")); // → ai
    await userEvent.click(screen.getByText("Continue")); // → backup
    expect(screen.getByText("Your Data, Your Control")).toBeTruthy();
    expect(screen.getByText(/Export your data anytime/)).toBeTruthy();
  });

  it("shows the restore-first screen when the vault is empty", () => {
    render(<Onboarding onComplete={vi.fn()} vaultIsEmpty />);
    expect(screen.getByText("Your vault is empty")).toBeTruthy();
    expect(screen.getByText("Restore from backup file")).toBeTruthy();
    expect(screen.getByText("Continue without restoring")).toBeTruthy();
    // The welcome step is not shown first.
    expect(screen.queryByText("Welcome to BookmarkForge")).toBeNull();
  });

  it("does not show the restore screen on a normal first run", () => {
    render(<Onboarding onComplete={vi.fn()} />);
    expect(screen.queryByText("Your vault is empty")).toBeNull();
    expect(screen.getByText("Welcome to BookmarkForge")).toBeTruthy();
  });

  it("Continue without restoring advances to the welcome step", async () => {
    render(<Onboarding onComplete={vi.fn()} vaultIsEmpty />);
    await userEvent.click(screen.getByText("Continue without restoring"));
    expect(screen.getByText("Welcome to BookmarkForge")).toBeTruthy();
  });

  it("restores from a .json backup file and completes onboarding", async () => {
    const onComplete = vi.fn();
    mockImportBackup.mockResolvedValue(undefined);
    const { container } = render(
      <Onboarding onComplete={onComplete} vaultIsEmpty />,
    );

    const file = new File(["{ \"bookmarks\": [] }"], "backup.json", {
      type: "application/json",
    });
    const input = container.querySelector('input[type="file"]');
    expect(input).not.toBeNull();
    fireEvent.change(input as HTMLInputElement, {
      target: { files: [file] },
    });

    await waitFor(() => {
      expect(mockImportBackup).toHaveBeenCalledWith(file, undefined);
    });
    expect(reloadMock).toHaveBeenCalledOnce();
    expect(safeSetMock).toHaveBeenCalledWith(
      "forge_restore_success_pending",
      "true",
    );
    expect(safeSetMock).not.toHaveBeenCalledWith("bmf_onboarding_complete", "true");
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("reboots after a successful restore even if the toast cleanup fails", async () => {
    // The dismiss is cosmetic (clear a stale pre-restore toast). It must not
    // be able to turn a COMMITTED restore into a reported failure: before the
    // guard, a throwing dismiss skipped the reboot and surfaced "Could not
    // restore the backup" while the pending-restore flag was already written.
    const onComplete = vi.fn();
    mockImportBackup.mockResolvedValue(undefined);
    mockToast.dismiss.mockImplementationOnce(() => {
      throw new Error("sonner unavailable");
    });
    const { container } = render(
      <Onboarding onComplete={onComplete} vaultIsEmpty />,
    );

    const file = new File(["{ \"bookmarks\": [] }"], "backup.json", {
      type: "application/json",
    });
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [file] },
    });

    await waitFor(() => {
      expect(reloadMock).toHaveBeenCalledOnce();
    });
    expect(safeSetMock).toHaveBeenCalledWith(
      "forge_restore_success_pending",
      "true",
    );
    expect(mockToast.error).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("requires a password for an encrypted .bmf backup", async () => {
    const onComplete = vi.fn();
    mockImportBackup.mockResolvedValue(undefined);
    const originalPrompt = globalThis.prompt;
    globalThis.prompt = vi.fn(() => ""); // empty password → rejected
    try {
      const { container } = render(
        <Onboarding onComplete={onComplete} vaultIsEmpty />,
      );

      const file = new File(["encrypted"], "backup.bmf", {
        type: "application/octet-stream",
      });
      const input = container.querySelector('input[type="file"]');
      fireEvent.change(input as HTMLInputElement, {
        target: { files: [file] },
      });

      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalledWith(
          "Password is required to restore an encrypted backup.",
        );
      });
      expect(mockImportBackup).not.toHaveBeenCalled();
      expect(onComplete).not.toHaveBeenCalled();
    } finally {
      globalThis.prompt = originalPrompt;
    }
  });

  it("restores from the automatic backup when available", async () => {
    const onComplete = vi.fn();
    mockGetAutoBackupInfo.mockResolvedValue({ available: true });
    mockRestoreFromAutoBackup.mockResolvedValue(true);
    render(<Onboarding onComplete={onComplete} vaultIsEmpty />);

    const autoButton = await screen.findByText(
      "Restore from automatic backup",
    );
    await userEvent.click(autoButton);

    await waitFor(() => {
      expect(mockRestoreFromAutoBackup).toHaveBeenCalledOnce();
    });
    expect(mockToast.success).toHaveBeenCalledWith("Vault restored successfully.");
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it("reports when no automatic backup exists", async () => {
    mockGetAutoBackupInfo.mockResolvedValue({ available: true });
    mockRestoreFromAutoBackup.mockResolvedValue(false);
    render(<Onboarding onComplete={vi.fn()} vaultIsEmpty />);

    const autoButton = await screen.findByText(
      "Restore from automatic backup",
    );
    await userEvent.click(autoButton);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith(
        "No automatic backup was found.",
      );
    });
  });
});
