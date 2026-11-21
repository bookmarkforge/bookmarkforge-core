import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

vi.mock("react-i18next", () => {
  const t = (key: string, options?: any) => options?.defaultValue || key;
  return {
    useTranslation: () => ({ t, i18n: { language: "en" } }),
    initReactI18next: { type: "3rdParty", init: () => {} },
  };
});

vi.mock("../../hooks/useSecurityStore", () => ({ useSecurityStore: vi.fn() }));
vi.mock("../../hooks/useDatabaseInit", () => ({ useDatabaseInit: vi.fn() }));
vi.mock("../../services/ai/ProviderManager", () => ({
  aiManager: { warmup: vi.fn(), unlockVault: vi.fn() },
}));
vi.mock("../../services/RecoveryService", () => ({
  recoveryService: {
    generateRecoveryPhrase: () => "word1 word2 word3 word4",
    encryptMasterPasswordWithRecovery: vi.fn(),
    decryptMasterPasswordWithRecovery: vi.fn(),
  },
}));
vi.mock("../../services/SecurityVault", () => ({
  securityVault: {
    setRecoveryData: vi.fn(),
    getRecoveryData: vi.fn(),
    onLock: vi.fn(() => () => {}),
    onUnlock: vi.fn(() => () => {}),
    registerCaller: vi.fn(),
    unregisterCaller: vi.fn(),
  },
}));
vi.mock("../../db/database", () => ({
  initDB: vi.fn().mockResolvedValue({}),
  destroyDB: vi.fn(),
}));
vi.mock("../../components/SecurityManager", () => ({
  SecurityManager: ({ children }: any) => (
    <div data-testid="security-manager">{children}</div>
  ),
}));
vi.mock("../../components/SecurityConfirmation", () => ({
  SecurityConfirmation: ({ onConfirm, onSetupPassword }: any) => (
    <div data-testid="security-confirmation">
      <button data-testid="create-vault" onClick={onSetupPassword}>
        Create Secure Vault
      </button>
      <button data-testid="skip-password" onClick={onConfirm}>
        Continue Without Encryption
      </button>
    </div>
  ),
}));
vi.mock("../../components/app/MainApp", () => ({
  MainApp: () => <div data-testid="main-app" />,
}));
vi.mock("../../components/WelcomeTour", () => ({
  WelcomeTour: () => <div data-testid="welcome-tour" />,
}));
vi.mock("../../components/Onboarding", () => ({
  Onboarding: () => <div data-testid="onboarding" />,
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
vi.mock("../../hooks/useRxDB", () => ({ DatabaseContextProvider: ({ children }: any) => children }));
vi.mock("rxdb/plugins/react", () => ({ RxDatabaseProvider: ({ children }: any) => children }));
vi.mock("react-router", () => ({
  BrowserRouter: ({ children }: any) => (
    <div data-testid="browser-router">{children}</div>
  ),
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: "/" }),
}));

const { useSecurityStore } = await import("../../hooks/useSecurityStore");
const { useDatabaseInit } = await import("../../hooks/useDatabaseInit");
const { AppContent } = await import("../../components/app/AppContent");

describe("Integration: Security Flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.removeItem("forge_onboarding_complete");
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

  it("starts unlocked with db → shows MainApp", async () => {
    (useSecurityStore as any).mockReturnValue({
      isLocked: false,
      unlock: vi.fn(),
      forceSetup: false,
      setForceSetup: vi.fn(),
    });
    const { findByTestId } = render(<AppContent />);
    expect(await findByTestId("main-app")).toBeTruthy();
  });

  it("locked sin password → SecurityConfirmation", async () => {
    (useSecurityStore as any).mockReturnValue({
      isLocked: true,
      unlock: vi.fn(),
      forceSetup: false,
      setForceSetup: vi.fn(),
    });
    (useDatabaseInit as any).mockReturnValue({
      db: null,
      dbError: null,
      hasPwd: false,
    });
    const { findByTestId } = render(<AppContent />);
    // SecurityConfirmation is lazy-loaded (lucide lives in the ui-runtime
    // vendor chunk); await the Suspense boundary resolving.
    expect(await findByTestId("security-confirmation")).toBeTruthy();
  });

  it("locked con password → SecurityManager", async () => {
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
    const { findByTestId } = render(<AppContent />);
    expect(await findByTestId("security-manager")).toBeTruthy();
  });

  it("forceSetup=true → SecurityManager", async () => {
    (useSecurityStore as any).mockReturnValue({
      isLocked: true,
      unlock: vi.fn(),
      forceSetup: true,
      setForceSetup: vi.fn(),
    });
    (useDatabaseInit as any).mockReturnValue({
      db: null,
      dbError: null,
      hasPwd: false,
    });
    const { findByTestId } = render(<AppContent />);
    expect(await findByTestId("security-manager")).toBeTruthy();
  });

  it('click "Create Secure Vault" → setForceSetup(true)', async () => {
    const setForceSetup = vi.fn();
    (useSecurityStore as any).mockReturnValue({
      isLocked: true,
      unlock: vi.fn(),
      forceSetup: false,
      setForceSetup,
    });
    (useDatabaseInit as any).mockReturnValue({
      db: null,
      dbError: null,
      hasPwd: false,
    });
    render(<AppContent />);
    await userEvent.click(await screen.findByTestId("create-vault"));
    expect(setForceSetup).toHaveBeenCalledWith(true);
  });

  it('click "Continue Without Encryption" → unlock()', async () => {
    const unlock = vi.fn();
    (useSecurityStore as any).mockReturnValue({
      isLocked: true,
      unlock,
      forceSetup: false,
      setForceSetup: vi.fn(),
    });
    (useDatabaseInit as any).mockReturnValue({
      db: null,
      dbError: null,
      hasPwd: false,
    });
    render(<AppContent />);
    await userEvent.click(await screen.findByTestId("skip-password"));
    expect(unlock).toHaveBeenCalled();
  });

  it("dbError → shows error message", () => {
    (useDatabaseInit as any).mockReturnValue({
      db: null,
      dbError: "Connection failed",
      hasPwd: false,
    });
    const { getByText } = render(<AppContent />);
    expect(getByText("Connection failed")).toBeTruthy();
  });

  it("db null and unlocked → shows loading", () => {
    (useDatabaseInit as any).mockReturnValue({
      db: null,
      dbError: null,
      hasPwd: false,
    });
    const { getByText } = render(<AppContent />);
    expect(getByText("app.loading")).toBeTruthy();
  });
});
