import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import React from "react";

afterEach(cleanup);

// Partial mock: `src/i18n.ts` (imported through the component's dependency
// chain) calls `i18n.use(initReactI18next)`, so the real module has to stay
// reachable. Only `useTranslation` is overridden, to keep the key-or-fallback
// behaviour the assertions rely on.
vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  const t = (key: string, fb?: string) => fb || key;
  return {
    ...actual,
    useTranslation: () => ({ t, i18n: { language: "en" } }),
  };
});

const mockUseSecurityStore = vi.fn();
vi.mock("../../hooks/useSecurityStore", () => ({
  useSecurityStore: () => mockUseSecurityStore(),
}));

vi.mock("../../services/ai/ProviderManager", () => ({
  aiManager: { unlockVault: vi.fn().mockResolvedValue(true) },
}));

vi.mock("../../services/RecoveryService", () => ({
  recoveryService: {
    generateRecoveryPhrase: vi.fn().mockReturnValue("word1 word2 word3"),
    encryptMasterPasswordWithRecovery: vi.fn().mockResolvedValue("encrypted"),
    decryptMasterPasswordWithRecovery: vi.fn().mockResolvedValue("password"),
  },
}));

vi.mock("../../services/BackupService", () => ({
  BackupService: { exportBackup: vi.fn().mockResolvedValue(undefined) },
}));
// SecurityManager resolves Pro services through the gated loader
// (`loadBackupService`), not by importing BackupService directly. Without this
// mock the .bmf recovery-kit flow rejects with ProUnavailableError before
// `exportBackup` is reached. It re-imports the mocked module above so the
// existing assertions observe the same object.
vi.mock("../../services/pro-access", () => ({
  ProUnavailableError: class ProUnavailableError extends Error {},
  loadBackupService: async () =>
    (await import("../../services/BackupService")).BackupService,
}));

const mockHasMasterPassword = vi.fn();
const mockIsVaultLockedError = vi.fn(() => false);
vi.mock("../../services/SecurityVault", () => ({
  securityVault: {
    hasMasterPassword: mockHasMasterPassword,
    setMasterPasswordFlag: vi.fn().mockResolvedValue(undefined),
    setRecoveryData: vi.fn().mockResolvedValue(undefined),
    getRecoveryData: vi.fn().mockResolvedValue("encrypted-data"),
    onLock: vi.fn(() => () => {}),
    onUnlock: vi.fn(() => () => {}),
  },
}));

// Partial mock: the real module is spread in so the adapter factories
// (`createStorageAdapter`, used by usePreferencesStore via src/i18n.ts) keep
// working. Replacing the module wholesale broke every test in this file the
// moment that dependency appeared — the three primitives are overridden only
// because they need localStorage's real error behaviour here.
vi.mock("../../store/safeStorage", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../store/safeStorage")>();
  return {
    ...actual,
    safeGet: vi.fn((key: string) => {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    }),
    safeSet: vi.fn((key: string, value: string) => {
      try {
        localStorage.setItem(key, value);
      } catch {
        /* INTENTIONAL SILENCE: the mock cleanup is best-effort. */
      }
    }),
    safeRemove: vi.fn((key: string) => {
      try {
        localStorage.removeItem(key);
      } catch {
        /* INTENTIONAL SILENCE: the mock cleanup is best-effort. */
      }
    }),
  };
});

vi.mock("../../db/database", () => ({
  initDB: vi.fn().mockResolvedValue(undefined),
  destroyDB: vi.fn().mockResolvedValue(undefined),
  isInvalidDbPasswordError: vi.fn(() => false),
  isDbInaccessibleError: vi.fn(() => false),
  isVaultLockedError: mockIsVaultLockedError,
}));

// Note: SecurityManager uses inline SVG icons (InlineSecurityIcons) and
// CSS animations instead of lucide-react / motion/react, so the first
// painted pre-unlock screen never statically imports the 910 kB
// ui-runtime vendor chunk. No lucide/motion mocks are needed here.

describe("SecurityManager", () => {
  let SecurityManager: React.FC<any>;

  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.clear();
    mockHasMasterPassword.mockResolvedValue(true);
    mockIsVaultLockedError.mockReturnValue(false);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      writable: true,
      configurable: true,
    });
    mockUseSecurityStore.mockReturnValue({ isLocked: true, unlock: vi.fn() });
    const mod = await import("../../components/SecurityManager");
    SecurityManager = mod.SecurityManager;
  });

  describe("render states", () => {
    it("renders children when isLocked is false", () => {
      mockUseSecurityStore.mockReturnValue({
        isLocked: false,
        unlock: vi.fn(),
      });
      const { container, unmount } = render(
        <SecurityManager>
          <span data-testid="child">content</span>
        </SecurityManager>,
      );
      expect(screen.getByTestId("child")).toBeTruthy();
      expect(container).toBeTruthy();
      unmount();
    });

    it("renders locked screen when isLocked is true and there is a master password", () => {
      localStorage.setItem("forge_has_master_password", "true");
      const { container } = render(
        <SecurityManager>
          <span>content</span>
        </SecurityManager>,
      );
      // Shield is a decorative inline SVG — assert the rendered icon
      // container instead of a lucide-mocked testid.
      expect(container.querySelector(".size-7.ds-text-accent")).toBeTruthy();
    });

    it("renders vault locked title", () => {
      localStorage.setItem("forge_has_master_password", "true");
      render(
        <SecurityManager>
          <span>content</span>
        </SecurityManager>,
      );
      expect(screen.getByText("app_vault_locked")).toBeTruthy();
    });

    it("renders password input on the locked screen", () => {
      localStorage.setItem("forge_has_master_password", "true");
      render(
        <SecurityManager>
          <span>content</span>
        </SecurityManager>,
      );
      expect(screen.getByPlaceholderText("app_master_password")).toBeTruthy();
    });

    it("renders unlock button", () => {
      localStorage.setItem("forge_has_master_password", "true");
      render(
        <SecurityManager>
          <span>content</span>
        </SecurityManager>,
      );
      expect(screen.getByText("app_unlock")).toBeTruthy();
    });
  });

  describe("unlock flow", () => {
    beforeEach(() => {
      localStorage.setItem("forge_has_master_password", "true");
      const unlock = vi.fn().mockResolvedValue(undefined);
      mockUseSecurityStore.mockReturnValue({ isLocked: true, unlock });
    });

    it("unlock success calls unlock and shows children", async () => {
      const { aiManager } = await import("../../services/ai/ProviderManager");
      const { initDB } = await import("../../db/database");
      (aiManager.unlockVault as any).mockResolvedValue(true);
      (initDB as any).mockResolvedValue(undefined);

      render(
        <SecurityManager>
          <span data-testid="child">content</span>
        </SecurityManager>,
      );

      fireEvent.change(screen.getByPlaceholderText("app_master_password"), {
        target: { value: "mypassword" },
      });
      fireEvent.click(screen.getByText("app_unlock"));

      await waitFor(() => {
        expect(aiManager.unlockVault).toHaveBeenCalledWith("mypassword");
        expect(initDB).toHaveBeenCalled();
        const { unlock } = mockUseSecurityStore();
        expect(unlock).toHaveBeenCalled();
      });
    });

    it("unlock fails fast when unlockVault returns false", async () => {
      const { aiManager } = await import("../../services/ai/ProviderManager");
      const { initDB } = await import("../../db/database");
      // Vault verification returns false (does NOT throw) for a wrong
      // password — the flow must surface the error instead of falling
      // through to initDB (which would silently unlock under Memory
      // storage / smoke-test backends).
      (aiManager.unlockVault as any).mockResolvedValue(false);

      render(
        <SecurityManager>
          <span>content</span>
        </SecurityManager>,
      );

      fireEvent.change(screen.getByPlaceholderText("app_master_password"), {
        target: { value: "wrong" },
      });
      fireEvent.click(screen.getByText("app_unlock"));

      await waitFor(() => {
        expect(screen.getByText("app_vault_unlock_error")).toBeTruthy();
      });
      expect(initDB).not.toHaveBeenCalled();
    });

    it("unlock error shows error message", async () => {
      const { aiManager } = await import("../../services/ai/ProviderManager");
      (aiManager.unlockVault as any).mockRejectedValue(
        new Error("Wrong password"),
      );

      render(
        <SecurityManager>
          <span>content</span>
        </SecurityManager>,
      );

      fireEvent.change(screen.getByPlaceholderText("app_master_password"), {
        target: { value: "wrong" },
      });
      fireEvent.click(screen.getByText("app_unlock"));

      await waitFor(() => {
        expect(screen.getByText("app_vault_unlock_error")).toBeTruthy();
      });
    });

    it("shows the locked-vault message for a VAULT_LOCKED database error", async () => {
      const { aiManager } = await import("../../services/ai/ProviderManager");
      const { initDB } = await import("../../db/database");
      (aiManager.unlockVault as any).mockResolvedValue(true);
      (initDB as any).mockRejectedValue(new Error("wrapped device key"));
      mockIsVaultLockedError.mockReturnValue(true);

      render(
        <SecurityManager>
          <span>content</span>
        </SecurityManager>,
      );

      fireEvent.change(screen.getByPlaceholderText("app_master_password"), {
        target: { value: "password" },
      });
      fireEvent.click(screen.getByText("app_unlock"));

      await waitFor(() => {
        expect(screen.getByText("app_vault_locked")).toBeTruthy();
      });
    });

    it("unlock supports Enter key", async () => {
      const { aiManager } = await import("../../services/ai/ProviderManager");
      const { initDB } = await import("../../db/database");
      (aiManager.unlockVault as any).mockResolvedValue(true);
      (initDB as any).mockResolvedValue(undefined);

      render(
        <SecurityManager>
          <span>content</span>
        </SecurityManager>,
      );

      const input = screen.getByPlaceholderText("app_master_password");
      fireEvent.change(input, { target: { value: "mypassword" } });
      fireEvent.keyDown(input, { key: "Enter" });

      await waitFor(() => {
        expect(aiManager.unlockVault).toHaveBeenCalledWith("mypassword");
      });
    });

    it("ignores a second unlock while the first is still in progress", async () => {
      const { aiManager } = await import("../../services/ai/ProviderManager");
      const { initDB } = await import("../../db/database");
      let resolveUnlock: ((value: boolean) => void) | undefined;
      (aiManager.unlockVault as any).mockImplementation(
        () => new Promise<boolean>((resolve) => {
          resolveUnlock = resolve;
        }),
      );
      (initDB as any).mockResolvedValue(undefined);

      render(
        <SecurityManager>
          <span>content</span>
        </SecurityManager>,
      );

      const input = screen.getByPlaceholderText("app_master_password");
      fireEvent.change(input, { target: { value: "mypassword" } });
      fireEvent.keyDown(input, { key: "Enter" });
      fireEvent.keyDown(input, { key: "Enter" });

      await waitFor(() => {
        expect(aiManager.unlockVault).toHaveBeenCalledTimes(1);
      });
      await act(async () => {
        resolveUnlock?.(true);
        await Promise.resolve();
      });
    });
  });

  describe("first-time setup", () => {
    beforeEach(async () => {
      localStorage.removeItem("forge_has_master_password");
      mockHasMasterPassword.mockResolvedValue(false);
      mockUseSecurityStore.mockReturnValue({ isLocked: true, unlock: vi.fn() });
    });

    it("shows setup screen on first time", () => {
      render(
        <SecurityManager>
          <span>content</span>
        </SecurityManager>,
      );
      expect(screen.getByText("app_setup_vault")).toBeTruthy();
    });

    it("shows error when password is too short", async () => {
      render(
        <SecurityManager>
          <span>content</span>
        </SecurityManager>,
      );

      fireEvent.click(screen.getByText("app_copy"));
      fireEvent.change(screen.getByPlaceholderText("app_master_password"), {
        target: { value: "short" },
      });
      fireEvent.click(screen.getByRole("checkbox"));
      fireEvent.click(screen.getByText("app_create_vault"));

      await waitFor(() => {
        expect(screen.getByText("app_password_too_short")).toBeTruthy();
      });
      const { unlock } = mockUseSecurityStore();
      expect(unlock).not.toHaveBeenCalled();
    });

    it("copies the recovery phrase to the clipboard and enables the confirm checkbox", async () => {
      render(
        <SecurityManager>
          <span>content</span>
        </SecurityManager>,
      );

      await waitFor(() =>
        expect(screen.getByLabelText("app_confirmRecovery")).toBeTruthy(),
      );
      fireEvent.click(screen.getByText("app_copy"));
      await waitFor(() => {
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
          "word1 word2 word3",
        );
      });
      const checkbox = screen.getByLabelText(
        "app_confirmRecovery",
      ) as HTMLInputElement;
      expect(checkbox.disabled).toBe(false);
    });

    it("regenerates the recovery phrase", async () => {
      const { recoveryService } =
        await import("../../services/RecoveryService");
      render(
        <SecurityManager>
          <span>content</span>
        </SecurityManager>,
      );
      // The mount effect consumes the first generateRecoveryPhrase() call,
      // so queue the new phrase AFTER the default is on screen.
      await waitFor(() =>
        expect(screen.getByText("word1 word2 word3")).toBeTruthy(),
      );
      const generateRecoveryPhrase =
        recoveryService.generateRecoveryPhrase as ReturnType<typeof vi.fn>;
      generateRecoveryPhrase.mockClear();
      generateRecoveryPhrase.mockReturnValue("new-phrase-xyz");
      const regenerateButton = screen.getByText("app_regeneratePhrase");
      fireEvent.click(regenerateButton);
      fireEvent.click(regenerateButton);
      expect(await screen.findByText("new-phrase-xyz")).toBeTruthy();
      expect(generateRecoveryPhrase).toHaveBeenCalledTimes(1);
    });

    it("completes setup, sets the master password flag and unlocks the vault", async () => {
      const { securityVault } = await import("../../services/SecurityVault");
      const { aiManager } = await import("../../services/ai/ProviderManager");
      (aiManager.unlockVault as any).mockResolvedValue(true);

      render(
        <SecurityManager>
          <span>content</span>
        </SecurityManager>,
      );

      await waitFor(() =>
        expect(
          screen.getByPlaceholderText("app_master_password"),
        ).toBeTruthy(),
      );
      fireEvent.change(screen.getByPlaceholderText("app_master_password"), {
        target: { value: "longenoughpw" },
      });
      fireEvent.click(screen.getByText("app_copy"));
      fireEvent.click(screen.getByLabelText("app_confirmRecovery"));
      fireEvent.click(screen.getByText("app_create_vault"));

      await waitFor(() => {
        const { unlock } = mockUseSecurityStore();
        expect(unlock).toHaveBeenCalled();
      });
      expect(securityVault.setMasterPasswordFlag).toHaveBeenCalled();
      expect(aiManager.unlockVault).toHaveBeenCalledWith("longenoughpw");
    });

    it("shows the optional .bmf recovery kit on the setup screen", () => {
      render(
        <SecurityManager>
          <span>content</span>
        </SecurityManager>,
      );
      expect(screen.getByText("Save recovery kit (.bmf)")).toBeTruthy();
      // F0-4 requires the explicit warning: without the password the file
      // is useless.
      expect(
        screen.getByText(
          "Optional: this file is encrypted with your master password — without the password, it is useless.",
        ),
      ).toBeTruthy();
    });

    it("saves the .bmf kit after the vault is created and unlocks", async () => {
      const { BackupService } = await import("../../services/BackupService");
      const { aiManager } = await import("../../services/ai/ProviderManager");
      const { initDB } = await import("../../db/database");
      (aiManager.unlockVault as any).mockResolvedValue(true);
      (initDB as any).mockResolvedValue(undefined);
      (BackupService.exportBackup as any).mockResolvedValue(undefined);

      render(
        <SecurityManager>
          <span>content</span>
        </SecurityManager>,
      );

      await waitFor(() =>
        expect(
          screen.getByPlaceholderText("app_master_password"),
        ).toBeTruthy(),
      );
      fireEvent.change(screen.getByPlaceholderText("app_master_password"), {
        target: { value: "longenoughpw" },
      });
      fireEvent.click(screen.getByText("app_copy"));
      fireEvent.click(screen.getByLabelText("app_confirmRecovery"));
      fireEvent.click(screen.getByText("Save recovery kit (.bmf)"));

      await waitFor(() => {
        expect(BackupService.exportBackup).toHaveBeenCalledWith(
          "longenoughpw",
        );
        const { unlock } = mockUseSecurityStore();
        expect(unlock).toHaveBeenCalled();
      });
    });

    it("kit requires the recovery confirmation before exporting", async () => {
      const { BackupService } = await import("../../services/BackupService");

      render(
        <SecurityManager>
          <span>content</span>
        </SecurityManager>,
      );

      await waitFor(() =>
        expect(
          screen.getByPlaceholderText("app_master_password"),
        ).toBeTruthy(),
      );
      fireEvent.change(screen.getByPlaceholderText("app_master_password"), {
        target: { value: "longenoughpw" },
      });
      fireEvent.click(screen.getByText("Save recovery kit (.bmf)"));

      await waitFor(() => {
        expect(screen.getByText("app_confirmRecovery")).toBeTruthy();
      });
      expect(BackupService.exportBackup).not.toHaveBeenCalled();
      const { unlock } = mockUseSecurityStore();
      expect(unlock).not.toHaveBeenCalled();
    });

    it("kit export failure keeps the setup screen; Create Vault skips it", async () => {
      const { BackupService } = await import("../../services/BackupService");
      const { aiManager } = await import("../../services/ai/ProviderManager");
      (aiManager.unlockVault as any).mockResolvedValue(true);
      (BackupService.exportBackup as any).mockRejectedValue(
        new Error("Disk full"),
      );

      render(
        <SecurityManager>
          <span>content</span>
        </SecurityManager>,
      );

      await waitFor(() =>
        expect(
          screen.getByPlaceholderText("app_master_password"),
        ).toBeTruthy(),
      );
      fireEvent.change(screen.getByPlaceholderText("app_master_password"), {
        target: { value: "longenoughpw" },
      });
      fireEvent.click(screen.getByText("app_copy"));
      fireEvent.click(screen.getByLabelText("app_confirmRecovery"));
      fireEvent.click(screen.getByText("Save recovery kit (.bmf)"));

      await waitFor(() => {
        expect(
          screen.getByText(
            "Could not save the recovery kit. Retry, or create the vault to skip it (you can export anytime from Settings → Storage).",
          ),
        ).toBeTruthy();
      });
      const { unlock: unlockAfterKit } = mockUseSecurityStore();
      expect(unlockAfterKit).not.toHaveBeenCalled();

      // "Create Vault" proceeds without the kit (optional, never blocking).
      (BackupService.exportBackup as any).mockResolvedValue(undefined);
      fireEvent.click(screen.getByText("app_create_vault"));
      await waitFor(() => {
        const { unlock } = mockUseSecurityStore();
        expect(unlock).toHaveBeenCalled();
      });
      expect(BackupService.exportBackup).toHaveBeenCalledTimes(1);
    });

    it("setup fails fast when unlockVault returns false", async () => {
      const { aiManager } = await import("../../services/ai/ProviderManager");
      const { securityVault } = await import("../../services/SecurityVault");
      (aiManager.unlockVault as any).mockResolvedValue(false);

      render(
        <SecurityManager>
          <span>content</span>
        </SecurityManager>,
      );

      fireEvent.click(screen.getByText("app_copy"));
      fireEvent.change(screen.getByPlaceholderText("app_master_password"), {
        target: { value: "long-enough-pass" },
      });
      fireEvent.click(screen.getByRole("checkbox"));
      fireEvent.click(screen.getByText("app_create_vault"));

      await waitFor(() => {
        expect(screen.getByText("app_vault_setup_error")).toBeTruthy();
      });
      expect(securityVault.setMasterPasswordFlag).not.toHaveBeenCalled();
      const { unlock } = mockUseSecurityStore();
      expect(unlock).not.toHaveBeenCalled();
    });

    it("shows dev mode bypass as disabled for security", async () => {
      render(
        <SecurityManager>
          <span>content</span>
        </SecurityManager>,
      );

      expect(
        screen.getByTitle("DEV mode bypass is disabled for security"),
      ).toBeTruthy();
      expect(screen.getByLabelText("DEV mode bypass removed")).toBeTruthy();
      const { unlock } = mockUseSecurityStore();
      expect(unlock).not.toHaveBeenCalled();
    });
  });

  describe("recovery mode", () => {
    beforeEach(() => {
      localStorage.setItem("forge_has_master_password", "true");
      const unlock = vi.fn().mockResolvedValue(undefined);
      mockUseSecurityStore.mockReturnValue({ isLocked: true, unlock });
    });

    it("clicking forgot password shows recovery screen", async () => {
      render(
        <SecurityManager>
          <span>content</span>
        </SecurityManager>,
      );

      fireEvent.click(screen.getByText("app_forgotPassword"));

      await waitFor(() => {
        expect(
          screen.getByPlaceholderText("app_enterRecoveryPhrase"),
        ).toBeTruthy();
      });
    });

    it("recovery success unlocks vault", async () => {
      const { securityVault } = await import("../../services/SecurityVault");
      const { recoveryService } =
        await import("../../services/RecoveryService");
      const { aiManager } = await import("../../services/ai/ProviderManager");
      const { initDB } = await import("../../db/database");

      (securityVault.getRecoveryData as any).mockResolvedValue(
        "encrypted-data",
      );
      (
        recoveryService.decryptMasterPasswordWithRecovery as any
      ).mockResolvedValue("recovered-pass");
      (aiManager.unlockVault as any).mockResolvedValue(true);
      (initDB as any).mockResolvedValue(undefined);

      render(
        <SecurityManager>
          <span>content</span>
        </SecurityManager>,
      );

      fireEvent.click(screen.getByText("app_forgotPassword"));
      await waitFor(() => {
        expect(
          screen.getByPlaceholderText("app_enterRecoveryPhrase"),
        ).toBeTruthy();
      });

      fireEvent.change(screen.getByPlaceholderText("app_enterRecoveryPhrase"), {
        target: { value: "word1 word2 word3" },
      });
      fireEvent.click(screen.getByRole("button", { name: "app_recoverVault" }));

      await waitFor(() => {
        expect(securityVault.getRecoveryData).toHaveBeenCalled();
        expect(
          recoveryService.decryptMasterPasswordWithRecovery,
        ).toHaveBeenCalled();
        expect(aiManager.unlockVault).toHaveBeenCalledWith("recovered-pass");
        expect(initDB).toHaveBeenCalled();
        const { unlock } = mockUseSecurityStore();
        expect(unlock).toHaveBeenCalled();
      });
    });

    it("recovery fails fast when recovered password is rejected", async () => {
      const { securityVault } = await import("../../services/SecurityVault");
      const { recoveryService } =
        await import("../../services/RecoveryService");
      const { aiManager } = await import("../../services/ai/ProviderManager");
      const { initDB } = await import("../../db/database");

      (securityVault.getRecoveryData as any).mockResolvedValue(
        "encrypted-data",
      );
      (
        recoveryService.decryptMasterPasswordWithRecovery as any
      ).mockResolvedValue("recovered-pass");
      (aiManager.unlockVault as any).mockResolvedValue(false);

      render(
        <SecurityManager>
          <span>content</span>
        </SecurityManager>,
      );

      fireEvent.click(screen.getByText("app_forgotPassword"));
      await waitFor(() => {
        expect(
          screen.getByPlaceholderText("app_enterRecoveryPhrase"),
        ).toBeTruthy();
      });

      fireEvent.change(screen.getByPlaceholderText("app_enterRecoveryPhrase"), {
        target: { value: "word1 word2 word3" },
      });
      fireEvent.click(screen.getByRole("button", { name: "app_recoverVault" }));

      await waitFor(() => {
        expect(screen.getByText("app_invalidRecoveryPhrase")).toBeTruthy();
      });
      expect(initDB).not.toHaveBeenCalled();
      const { unlock } = mockUseSecurityStore();
      expect(unlock).not.toHaveBeenCalled();
    });

    it("recovery failure shows error", async () => {
      const { securityVault } = await import("../../services/SecurityVault");
      (securityVault.getRecoveryData as any).mockRejectedValue(
        new Error("Invalid"),
      );

      render(
        <SecurityManager>
          <span>content</span>
        </SecurityManager>,
      );

      fireEvent.click(screen.getByText("app_forgotPassword"));
      await waitFor(() => {
        expect(
          screen.getByPlaceholderText("app_enterRecoveryPhrase"),
        ).toBeTruthy();
      });

      fireEvent.change(screen.getByPlaceholderText("app_enterRecoveryPhrase"), {
        target: { value: "bad phrase" },
      });
      fireEvent.click(screen.getByRole("button", { name: "app_recoverVault" }));

      await waitFor(() => {
        expect(screen.getByText("app_invalidRecoveryPhrase")).toBeTruthy();
      });
    });

    it("back to login returns to locked screen", async () => {
      render(
        <SecurityManager>
          <span>content</span>
        </SecurityManager>,
      );

      fireEvent.click(screen.getByText("app_forgotPassword"));
      await waitFor(() => {
        expect(
          screen.getByPlaceholderText("app_enterRecoveryPhrase"),
        ).toBeTruthy();
      });

      fireEvent.click(screen.getByText("app_backToLogin"));
      await waitFor(() => {
        expect(screen.getByText("app_vault_locked")).toBeTruthy();
      });
    });
  });

  describe("ADR-052 Fase 2 — v5 residue notice", () => {
    it("hidden when the residue streak has not reached the threshold", () => {
      localStorage.setItem("forge_has_master_password", "true");
      render(
        <SecurityManager>
          <span>content</span>
        </SecurityManager>,
      );
      expect(screen.queryByTestId("v5-residue-notice")).toBeNull();
    });

    it("shown when the streak reached the threshold", () => {
      localStorage.setItem("forge_has_master_password", "true");
      localStorage.setItem("v5_residue_unlock_streak", "2");
      render(
        <SecurityManager>
          <span>content</span>
        </SecurityManager>,
      );
      const notice = screen.getByTestId("v5-residue-notice");
      expect(notice).toBeTruthy();
      expect(notice.textContent).toContain("legacy encryption format");
    });

    it("dismiss is non-blocking: the banner hides but the locked screen stays", () => {
      localStorage.setItem("forge_has_master_password", "true");
      localStorage.setItem("v5_residue_unlock_streak", "2");
      render(
        <SecurityManager>
          <span>content</span>
        </SecurityManager>,
      );
      fireEvent.click(screen.getByText("Dismiss"));
      expect(screen.queryByTestId("v5-residue-notice")).toBeNull();
      expect(screen.getByPlaceholderText("app_master_password")).toBeTruthy();
    });
  });
});
