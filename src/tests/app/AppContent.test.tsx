import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act, waitFor, fireEvent } from "@testing-library/react";
import React from "react";
import { safeGet } from "../../store/safeStorage";

vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal();
  // Resolve the security/DB error keys with their real en.json values so
  // the dbErrorClass ternary in AppContent is observable in tests (a
  // pass-through `t` would render the raw key for every branch, making
  // VAULT_LOCKED vs WRONG_PASSWORD indistinguishable). Other keys fall
  // back to the key itself, matching the previous identity mock.
  const TRANSLATIONS: Record<string, string> = {
    "app.vaultLocked": "Vault is locked. Unlock the vault to continue.",
    "app.invalidPassword": "The vault password is invalid.",
    "app.dbStorageUnavailable":
      "Persistent encrypted storage is unavailable.",
    "app_restoreFromBackup": "Restore from backup file",
    "app_dbCorruptRecoveryHint":
      "Your database appears damaged. Restore from a backup file to recover your data.",
    "app_loadingVault": "Loading vault…",
    "app_loadingVaultDetail": "Preparing {{rows}} items…",
  };
  return {
    ...(actual as any),
    useTranslation: () => ({
      t: (s: string, opts?: Record<string, unknown>) => {
        const base = TRANSLATIONS[s] ?? s;
        if (!opts) {return base;}
        return base.replace(/\{\{(\w+)\}\}/g, (_, k: string) =>
          String(opts[k] ?? ""),
        );
      },
      i18n: { language: "en" },
    }),
    initReactI18next: { type: "3rdParty", init: () => {} },
  };
});
vi.mock("../../hooks/useSecurityStore", () => ({
  useSecurityStore: vi.fn(),
}));
vi.mock("../../hooks/useDatabaseInit", () => ({
  useDatabaseInit: vi.fn(),
}));
vi.mock("../../services/ai/ProviderManager", () => ({
  aiManager: { warmup: vi.fn() },
}));
vi.mock("../../components/SecurityManager", () => ({
  SecurityManager: ({ message }: any) => (
    <div data-testid="security-manager">{message}</div>
  ),
}));
vi.mock("../../components/SecurityConfirmation", () => ({
  SecurityConfirmation: ({ onSkip, onSetupPassword }: any) => (
    <div data-testid="security-confirmation">SecurityConfirmation</div>
  ),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));
vi.mock("../../store/safeStorage", () => ({
  safeGet: vi.fn(() => null),
  safeSet: vi.fn(),
}));
vi.mock("../../services/BackupService", () => ({
  BackupService: {
    importBackup: vi.fn().mockResolvedValue(undefined),
    restoreFromAutoBackup: vi.fn(),
    getAutoBackupInfo: vi.fn(),
  },
}));
// AppContent resolves Pro services through the gated loader, not by importing
// BackupService directly. Without this mock `loadBackupService()` rejects with
// ProUnavailableError (no license in the test env) and the restore path fails
// before `importBackup` is ever called — which is what this mock exists to
// exercise. It re-imports the mocked module above so assertions on
// `BackupService.importBackup` keep observing the same object.
vi.mock("../../services/pro-access", () => ({
  ProUnavailableError: class ProUnavailableError extends Error {},
  loadBackupService: async () =>
    (await import("../../services/BackupService")).BackupService,
}));
vi.mock("../../db/database", () => ({
  destroyDB: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../components/Onboarding", () => ({
  Onboarding: ({ onComplete }: any) => (
    <div data-testid="onboarding">Onboarding</div>
  ),
}));
vi.mock("../../contexts/ThemeContext", () => ({
  ThemeProvider: ({ children }: any) => (
    <div data-testid="theme-provider">{children}</div>
  ),
  useTheme: () => ({
    isDark: false,
    theme: "light",
    toggleTheme: vi.fn(),
    setThemeMode: vi.fn(),
  }),
}));
vi.mock("../../hooks/useRxDB", () => ({
  DatabaseContextProvider: ({ children }: any) => children,
}));
vi.mock("rxdb/plugins/react", () => ({
  RxDatabaseProvider: ({ children }: any) => children,
}));
vi.mock("react-router", () => ({
  BrowserRouter: ({ children }: any) => (
    <div data-testid="browser-router">{children}</div>
  ),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: "/" }),
}));
vi.mock("../../components/app/MainApp", () => ({
  MainApp: () => <div data-testid="main-app" />,
}));
vi.mock("../../components/WelcomeTour", () => ({
  WelcomeTour: () => <div data-testid="welcome-tour" />,
}));

const { useSecurityStore } = await import("../../hooks/useSecurityStore");
const { useDatabaseInit } = await import("../../hooks/useDatabaseInit");
const { AppContent, getDbErrorMessage } = await import(
  "../../components/app/AppContent",
);
const {
  setVaultLoadingRows,
  updateCollectionMigrationProgress,
  resetMigrationProgress,
} = await import("../../db/migration-progress");

describe("AppContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMigrationProgress();
    localStorage.removeItem("forge_onboarding_done");
    (useSecurityStore as any).mockReturnValue({
      isLocked: false,
      unlock: vi.fn(),
      forceSetup: false,
      setForceSetup: vi.fn(),
    });
    (useDatabaseInit as any).mockReturnValue({
      db: {},
      dbError: null,
      hasPwd: false,
    });
  });

  it("renders loading state when db is null", () => {
    (useDatabaseInit as any).mockReturnValue({
      db: null,
      dbError: null,
      hasPwd: false,
    });
    const { container } = render(<AppContent />);
    const div = container.querySelector('[class*="flex"]');
    expect(div).toBeTruthy();
  });

  it("renders error screen when dbError is set", () => {
    (useDatabaseInit as any).mockReturnValue({
      db: null,
      dbError: "Connection failed",
      hasPwd: false,
    });
    const { getByText } = render(<AppContent />);
    expect(getByText("Connection failed")).toBeTruthy();
  });

  it("offers restore-from-backup when the DB error is a corruption class", () => {
    // F0-2: an INACCESSIBLE/UNKNOWN DB error means damaged storage — the
    // screen must offer the recovery path, not just an endless Retry.
    (useDatabaseInit as any).mockReturnValue({
      db: null,
      dbError: "Corrupt IDB state (DB3)",
      dbErrorClass: "INACCESSIBLE",
      hasPwd: true,
    });
    const { getByText } = render(<AppContent />);
    expect(getByText("Restore from backup file")).toBeTruthy();
    expect(
      getByText(
        "Your database appears damaged. Restore from a backup file to recover your data.",
      ),
    ).toBeTruthy();
  });

  it("does not offer restore for WRONG_PASSWORD or VAULT_LOCKED (ADR-033 D3)", () => {
    // ADR-033 D3: authentication problems are fixed with the right password /
    // unlock — offering a destructive-looking restore there would mislead the
    // user and encourage an unnecessary data wipe. The restore button, the
    // corruption hint text, and the hidden file input must ALL be absent.

    // --- WRONG_PASSWORD ---
    (useDatabaseInit as any).mockReturnValue({
      db: null,
      dbError: "Invalid password",
      dbErrorClass: "WRONG_PASSWORD",
      hasPwd: true,
    });
    const { queryByText, queryByTestId } = render(<AppContent />);
    expect(queryByText("Restore from backup file")).toBeNull();
    expect(
      queryByText(
        "Your database appears damaged. Restore from a backup file to recover your data.",
      ),
    ).toBeNull();
    expect(queryByTestId("restore-backup-input")).toBeNull();

    // --- VAULT_LOCKED ---
    (useDatabaseInit as any).mockReturnValue({
      db: null,
      dbError: "Vault is locked",
      dbErrorClass: "VAULT_LOCKED",
      hasPwd: true,
    });
    const { queryByText: q2, queryByTestId: q2t } = render(<AppContent />);
    expect(q2("Restore from backup file")).toBeNull();
    expect(
      q2(
        "Your database appears damaged. Restore from a backup file to recover your data.",
      ),
    ).toBeNull();
    expect(q2t("restore-backup-input")).toBeNull();
  });

  it("restores over a corrupted DB: destroys, imports and reloads", async () => {
    const { destroyDB } = await import("../../db/database");
    const { BackupService } = await import("../../services/BackupService");
    const { toast } = await import("sonner");
    // jsdom's Location#reload is not spy-able; stub the whole location.
    const reloadSpy = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload: reloadSpy });
    (useDatabaseInit as any).mockReturnValue({
      db: null,
      dbError: "Corrupt IDB state (DB3)",
      dbErrorClass: "INACCESSIBLE",
      hasPwd: true,
    });
    const { getByTestId } = render(<AppContent />);

    const file = new File(["{}"], "bookmarkforge-backup.json", {
      type: "application/json",
    });
    fireEvent.change(getByTestId("restore-backup-input"), {
      target: { files: [file] },
    });

    await waitFor(() => expect(destroyDB).toHaveBeenCalledTimes(1));
    expect(BackupService.importBackup).toHaveBeenCalledWith(file, undefined);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalled();
  });

  it("asks for a password when restoring an encrypted .bmf backup", async () => {
    const { BackupService } = await import("../../services/BackupService");
    const { toast } = await import("sonner");
    const promptSpy = vi.spyOn(window, "prompt").mockReturnValue(null);
    (useDatabaseInit as any).mockReturnValue({
      db: null,
      dbError: "Corrupt IDB state (DB3)",
      dbErrorClass: "INACCESSIBLE",
      hasPwd: true,
    });
    const { getByTestId } = render(<AppContent />);

    const file = new File(["x"], "backup.bmf", {
      type: "application/octet-stream",
    });
    fireEvent.change(getByTestId("restore-backup-input"), {
      target: { files: [file] },
    });

    await waitFor(() => expect(promptSpy).toHaveBeenCalled());
    // No password → the import must never start (the corrupt DB stays
    // untouched) and the user gets a clear error toast.
    expect(BackupService.importBackup).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });

  it("VAULT_LOCKED never shows the invalid-password text", () => {
    // The device key is wrapped but not materialized: the password may be
    // correct, so the UI must never claim the password is wrong. In test
    // mode (PROD=false) AppContent renders the raw dbError; the key
    // assertion is that the WRONG_PASSWORD branch is NOT taken — the
    // invalid-password copy must stay absent.
    (useDatabaseInit as any).mockReturnValue({
      db: null,
      dbError: "Vault is locked. Unlock the vault to decrypt your data.",
      dbErrorClass: "VAULT_LOCKED",
      hasPwd: true,
    });
    const { queryByText, getByText } = render(<AppContent />);
    expect(getByText("Vault is locked. Unlock the vault to decrypt your data.")).toBeTruthy();
    expect(queryByText("The vault password is invalid.")).toBeNull();
  });

  it("getDbErrorMessage maps each class to the right copy (production)", () => {
    // Assert the pure ternary directly so the PROD-only branch is covered
    // without faking import.meta.env.PROD.
    const msgs = {
      invalidPassword: "The vault password is invalid.",
      vaultLocked: "Vault is locked. Unlock the vault to continue.",
      storageUnavailable: "Persistent encrypted storage is unavailable.",
    };
    expect(
      getDbErrorMessage("WRONG_PASSWORD", msgs.invalidPassword, msgs.vaultLocked, msgs.storageUnavailable),
    ).toBe(msgs.invalidPassword);
    expect(
      getDbErrorMessage("VAULT_LOCKED", msgs.invalidPassword, msgs.vaultLocked, msgs.storageUnavailable),
    ).toBe(msgs.vaultLocked);
    expect(
      getDbErrorMessage("INACCESSIBLE", msgs.invalidPassword, msgs.vaultLocked, msgs.storageUnavailable),
    ).toBe(msgs.storageUnavailable);
    expect(
      getDbErrorMessage(null, msgs.invalidPassword, msgs.vaultLocked, msgs.storageUnavailable),
    ).toBe(msgs.storageUnavailable);
  });

  it("renders MainApp when db and security are ready", async () => {
    (useSecurityStore as any).mockReturnValue({
      isLocked: false,
      forceSetup: false,
    });
    (useDatabaseInit as any).mockReturnValue({
      db: {},
      dbError: null,
      hasPwd: false,
    });
    const { getByTestId } = render(<AppContent />);
    await waitFor(() => expect(getByTestId("main-app")).toBeTruthy());
  });

  it("renders SecurityConfirmation when locked without password", async () => {
    (useSecurityStore as any).mockReturnValue({
      isLocked: true,
      forceSetup: false,
    });
    (useDatabaseInit as any).mockReturnValue({
      db: null,
      dbError: null,
      hasPwd: false,
    });
    // Mock safeGet to return null for PASSWORD_SKIPPED (not skipped)
    vi.mocked(safeGet).mockReturnValue(null);
    const { getByTestId } = render(<AppContent />);
    // SecurityConfirmation is lazy-loaded (it statically imports lucide
    // from the ui-runtime chunk); wait for the dynamic import to settle.
    await waitFor(() => expect(getByTestId("security-confirmation")).toBeTruthy());
  });

  it("does NOT render SecurityConfirmation when password was skipped", async () => {
    (useSecurityStore as any).mockReturnValue({
      isLocked: true,
      forceSetup: false,
    });
    (useDatabaseInit as any).mockReturnValue({
      db: null,
      dbError: null,
      hasPwd: false,
    });
    // Mock safeGet to return "true" for PASSWORD_SKIPPED (user skipped password)
    vi.mocked(safeGet).mockImplementation((key) => {
      if (key === "forge_password_skipped") return "true";
      return null;
    });
    const { queryByTestId } = render(<AppContent />);
    // SecurityConfirmation should NOT appear when password was skipped
    await waitFor(() => expect(queryByTestId("security-confirmation")).toBeNull());
  });

  describe("migration overlay exit transition", () => {
    beforeEach(() => {
      (useDatabaseInit as any).mockReturnValue({
        db: null,
        dbError: null,
        hasPwd: false,
      });
      vi.useFakeTimers();
    });

    afterEach(() => {
      resetMigrationProgress();
      vi.useRealTimers();
    });

    it("holds at 100% and fades out instead of unmounting instantly when the migration finishes", () => {
      const { queryByTestId } = render(<AppContent />);
      expect(queryByTestId("vault-migrating-screen")).toBeNull();

      // Migration starts: the overlay appears (RUNNING 0/2000).
      act(() => {
        updateCollectionMigrationProgress({
          collectionName: "bookmarks",
          status: "RUNNING",
          total: 2000,
          handled: 0,
          percent: 0,
        });
      });
      const visible = queryByTestId("vault-migrating-screen");
      expect(visible).not.toBeNull();
      expect(visible!.className).not.toContain("opacity-0");

      // Migration completes: the overlay does NOT unmount — it enters the
      // closing phase (opacity-0) frozen at the final 100% state.
      act(() => {
        updateCollectionMigrationProgress({
          collectionName: "bookmarks",
          status: "DONE",
          total: 2000,
          handled: 2000,
          percent: 100,
        });
      });
      const closing = queryByTestId("vault-migrating-screen");
      expect(closing).not.toBeNull();
      expect(closing!.className).toContain("opacity-0");
      // Frozen at 100%: the progress bar is full during the exit hold.
      expect(closing!.querySelector('[style*="100%"]')).not.toBeNull();

      // After the hold (350ms) + fade (300ms) the overlay unmounts.
      act(() => {
        vi.advanceTimersByTime(700);
      });
      expect(queryByTestId("vault-migrating-screen")).toBeNull();
    });

    it("unmounts without a closing phase when no migration ever started", () => {
      const { queryByTestId } = render(<AppContent />);
      expect(queryByTestId("vault-migrating-screen")).toBeNull();
      // Store was never active: no overlay, no timer, nothing to fade.
      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(queryByTestId("vault-migrating-screen")).toBeNull();
    });
  });

  describe("vault reopen loading overlay", () => {
    beforeEach(() => {
      (useDatabaseInit as any).mockReturnValue({
        db: null,
        dbError: null,
        hasPwd: false,
      });
      vi.useFakeTimers();
    });

    afterEach(() => {
      resetMigrationProgress();
      vi.useRealTimers();
    });

    it("shows the loading overlay over the locked screen during a password reopen", async () => {
      // Real timers here: SecurityManager is lazy-loaded, so the overlay
      // (a Suspense sibling) only appears after the chunk resolves —
      // waitFor needs real timers.
      vi.useRealTimers();
      (useSecurityStore as any).mockReturnValue({
        isLocked: true,
        unlock: vi.fn(),
        forceSetup: false,
        setForceSetup: vi.fn(),
      });
      (useDatabaseInit as any).mockReturnValue({
        db: null,
        dbError: null,
        hasPwd: true,
      });
      const { queryByTestId } = render(<AppContent />);
      act(() => {
        setVaultLoadingRows(2000);
      });
      await waitFor(() =>
        expect(queryByTestId("vault-loading-screen")).not.toBeNull(),
      );
      expect(queryByTestId("security-manager")).not.toBeNull();
    });

    it("shows the loading overlay with the row count during a normal reopen", () => {
      const { queryByTestId, getByText } = render(<AppContent />);
      expect(queryByTestId("vault-loading-screen")).toBeNull();

      // addCollections starts: the loading overlay appears with the
      // estimated row count.
      act(() => {
        setVaultLoadingRows(2000);
      });
      const overlay = queryByTestId("vault-loading-screen");
      expect(overlay).not.toBeNull();
      expect(overlay!.className).not.toContain("opacity-0");
      expect(getByText("Loading vault…")).toBeTruthy();
      // The count reaches the copy through toLocaleString(), so its group
      // separator follows the runtime locale ("2,000" under en-US, "2000"
      // under es-ES). Deriving the expected string the same way keeps this
      // assertion on the wiring — the row count really arrives — instead of on
      // the default locale of whichever machine happens to run the suite.
      const expected = `Preparing ${(2000).toLocaleString()} items…`;
      expect(getByText(expected)).toBeTruthy();

      // Init settles: the overlay does NOT unmount instantly — it holds
      // (frozen) then fades out, same anti-flicker contract as migration.
      act(() => {
        resetMigrationProgress();
      });
      const closing = queryByTestId("vault-loading-screen");
      expect(closing).not.toBeNull();
      expect(closing!.className).toContain("opacity-0");
      // Frozen: the row count stays visible during the hold.
      expect(getByText(expected)).toBeTruthy();

      act(() => {
        vi.advanceTimersByTime(700);
      });
      expect(queryByTestId("vault-loading-screen")).toBeNull();
    });

    it("does not flash the loading overlay for an empty vault (0 rows)", () => {
      const { queryByTestId } = render(<AppContent />);
      act(() => {
        setVaultLoadingRows(0);
      });
      expect(queryByTestId("vault-loading-screen")).toBeNull();
    });

    it("a running migration takes precedence over the loading overlay", () => {
      const { queryByTestId } = render(<AppContent />);
      act(() => {
        setVaultLoadingRows(2000);
        updateCollectionMigrationProgress({
          collectionName: "bookmarks",
          status: "RUNNING",
          total: 2000,
          handled: 100,
          percent: 5,
        });
      });
      expect(queryByTestId("vault-loading-screen")).toBeNull();
      expect(queryByTestId("vault-migrating-screen")).not.toBeNull();
    });
  });
});
