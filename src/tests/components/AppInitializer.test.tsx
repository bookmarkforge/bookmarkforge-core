import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, cleanup } from "@testing-library/react";
import React from "react";

const mocks = vi.hoisted(() => ({
  mockUnlock: vi.fn(),
  mockIsLocked: true,
  mockDetectHostile: vi.fn(() => ({ isSuspicious: false })),
  mockInitTabCounting: vi.fn(),
  mockInitDevTools: vi.fn(),
  mockInitDB: vi.fn(),
  mockDestroyDB: vi.fn(),
  mockMigrateFromLocalStorage: vi.fn().mockResolvedValue(undefined),
  mockHasSecret: vi.fn().mockResolvedValue(false),
  mockDecryptSecret: vi.fn(),
  mockClearAll: vi.fn().mockResolvedValue(undefined),
  mockSetMasterPasswordFlag: vi.fn().mockResolvedValue(undefined),
  mockCloseSS: vi.fn().mockResolvedValue(undefined),
  mockStartGC: vi.fn(),
  mockStopGC: vi.fn(),
  mockStartBC: vi.fn(),
  mockStopBC: vi.fn(),
  mockRunAutoBackup: vi.fn(),
  mockCloudSyncInit: vi.fn(),
  mockRegisterLocalBackupProvider: vi.fn(),
  mockCloudSyncSync: vi.fn(),
  mockDetectDebugger: vi.fn().mockResolvedValue(false),
  mockVerifyBuildIdentity: vi.fn(() => true),
  mockAuditRecord: vi.fn().mockResolvedValue(undefined),
  mockToastError: vi.fn(),
  mockTryRunDigest: vi.fn().mockResolvedValue(null),
  mockStartupAIHint: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../db/database", () => ({
  initDB: mocks.mockInitDB,
  destroyDB: mocks.mockDestroyDB,
}));
vi.mock("../../utils/environmentDetection", () => ({
  detectHostileEnvironment: mocks.mockDetectHostile,
  initTabCounting: mocks.mockInitTabCounting,
  detectDebuggerAsync: mocks.mockDetectDebugger,
}));
vi.mock("../../utils/devtoolsProtection", () => ({
  initDevToolsProtection: mocks.mockInitDevTools,
}));
vi.mock("../../services/SecurityVault", () => ({
  securityVault: {
    migrateFromLocalStorage: mocks.mockMigrateFromLocalStorage,
    hasSecret: mocks.mockHasSecret,
    decryptSecret: mocks.mockDecryptSecret,
    clearAll: mocks.mockClearAll,
    close: mocks.mockCloseSS,
    setMasterPasswordFlag: mocks.mockSetMasterPasswordFlag,
    onLock: vi.fn(() => () => {}),
    onUnlock: vi.fn(() => () => {}),
  },
}));
vi.mock("../../services/SecureStorage", () => ({
  secureStorage: {
    clearAll: mocks.mockClearAll,
    close: mocks.mockCloseSS,
    getSecret: vi.fn().mockResolvedValue(null),
    setSecret: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("../../services/GarbageCollectionService", () => ({
  garbageCollectionService: {
    start: mocks.mockStartGC,
    stop: mocks.mockStopGC,
  },
}));
vi.mock("../../services/BroadcastBridgeService", () => ({
  broadcastBridgeService: {
    start: mocks.mockStartBC,
    stop: mocks.mockStopBC,
  },
}));
vi.mock("../../services/BackupService", () => ({
  BackupService: { runAutoBackup: mocks.mockRunAutoBackup },
}));
// AppInitializer resolves Pro services through the gated loader, not by
// importing BackupService directly. Without this mock `loadBackupService()`
// rejects with ProUnavailableError (no license in the test env) and the
// auto-backup path never reaches `runAutoBackup`. It re-imports the mocked
// module above so assertions on `mockRunAutoBackup` observe the same object.
vi.mock("../../services/pro-access", () => ({
  ProUnavailableError: class ProUnavailableError extends Error {},
  loadBackupService: async () =>
    (await import("../../services/BackupService")).BackupService,
}));
vi.mock("../../services/ai/CrossPollinationService", () => ({
  crossPollinationService: { tryRunDigest: mocks.mockTryRunDigest },
}));
vi.mock("../../utils/bundleIntegrity", () => ({
  verifyBuildIdentity: mocks.mockVerifyBuildIdentity,
  startScriptInjectionGuard: vi.fn(),
  stopScriptInjectionGuard: vi.fn(),
  verifyResourceIntegrity: vi.fn().mockResolvedValue(true),
  checkBundleIntegrity: vi.fn().mockResolvedValue({ valid: true, mismatchedFiles: [] }),
  clearManifestCache: vi.fn(),
  setForceIntegrityCheck: vi.fn(),
  getBuildHash: vi.fn(() => "test-hash"),
}));
vi.mock("../../services/AuditLogService", () => ({
  auditLog: { record: mocks.mockAuditRecord },
}));
vi.mock("sonner", () => ({ toast: { error: mocks.mockToastError } }));
vi.mock("../../services/integrations/cloudSync", () => ({
  cloudSyncService: {
    init: mocks.mockCloudSyncInit,
    sync: mocks.mockCloudSyncSync,
  },
  registerLocalBackupProvider: mocks.mockRegisterLocalBackupProvider,
}));
vi.mock("../../services/StartupAIHint", () => ({
  maybeShowStartupAIHint: mocks.mockStartupAIHint,
}));
// Logger is not mocked via vi.mock — we spy on it after import
vi.mock("../../hooks/useSecurityStore", () => ({
  useSecurityStore: vi.fn((sel?: any) => {
    if (typeof sel === "function") {
      return sel({ unlock: mocks.mockUnlock, isLocked: mocks.mockIsLocked });
    }
    return { unlock: mocks.mockUnlock, isLocked: mocks.mockIsLocked };
  }),
}));
vi.mock("react-i18next", () => ({
  default: { t: (k: string, d?: string) => d || k },
  useTranslation: () => ({ t: (k: string, d?: string) => d || k }),
}));
vi.mock("../../i18n", () => ({
  default: { t: (k: string, d?: string) => d || k },
}));
import { AppInitializer } from "../../components/AppInitializer";
import { logger } from "../../utils/logger";

function setUrlSearch(search: string) {
  window.history.replaceState({}, "", search || "/");
}

function setupMockDb({
  docCount = 0,
  bookmarkCount = 0,
  hasFlashcards = true,
  collectionsNotFound = false,
} = {}) {
  if (collectionsNotFound) {
    mocks.mockInitDB.mockResolvedValue({ collections: {} });
    return { documentsCol: null, bookmarksCol: null, flashcardsCol: null };
  }
  const documentsCol = {
    find: () => ({ exec: () => Promise.resolve(Array(docCount).fill({})) }),
    insert: vi.fn().mockResolvedValue(undefined),
  };
  const bookmarksCol = {
    find: () => ({
      exec: () => Promise.resolve(Array(bookmarkCount).fill({})),
    }),
    insert: vi.fn().mockResolvedValue(undefined),
  };
  const collections: Record<string, any> = {
    documents: documentsCol,
    bookmarks: bookmarksCol,
  };
  let flashcardsCol: any = undefined;
  if (hasFlashcards) {
    flashcardsCol = {
      find: () => ({ exec: () => Promise.resolve([]) }),
      insert: vi.fn().mockResolvedValue(undefined),
    };
    collections.flashcards = flashcardsCol;
  }
  mocks.mockInitDB.mockResolvedValue({ collections });
  return { documentsCol, bookmarksCol, flashcardsCol };
}

describe("AppInitializer", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    vi.clearAllMocks();
    vi.spyOn(logger, "info").mockImplementation(() => {});
    vi.spyOn(logger, "error").mockImplementation(() => {});
    vi.spyOn(logger, "warn").mockImplementation(() => {});
    mocks.mockIsLocked = true;
    mocks.mockUnlock.mockReset();
    mocks.mockDetectHostile.mockReturnValue({ isSuspicious: false });
    mocks.mockInitDB.mockReset();
    mocks.mockDestroyDB.mockReset();
    mocks.mockDestroyDB.mockResolvedValue(undefined);
    mocks.mockMigrateFromLocalStorage.mockReset();
    mocks.mockMigrateFromLocalStorage.mockResolvedValue(undefined);
    mocks.mockHasSecret.mockReset();
    mocks.mockHasSecret.mockResolvedValue(false);
    mocks.mockDecryptSecret.mockReset();
    mocks.mockRunAutoBackup.mockReset();
    mocks.mockRunAutoBackup.mockResolvedValue(undefined);
    mocks.mockCloudSyncInit.mockReset();
    mocks.mockCloudSyncInit.mockResolvedValue(undefined);
    mocks.mockRegisterLocalBackupProvider.mockReset();
    mocks.mockCloudSyncSync.mockReset();
    mocks.mockCloudSyncSync.mockResolvedValue(undefined);
    mocks.mockClearAll.mockReset();
    mocks.mockClearAll.mockResolvedValue(undefined);
    mocks.mockSetMasterPasswordFlag.mockReset();
    mocks.mockSetMasterPasswordFlag.mockResolvedValue(undefined);
    mocks.mockCloseSS.mockReset();
    mocks.mockCloseSS.mockResolvedValue(undefined);
    mocks.mockStartGC.mockReset();
    mocks.mockStopGC.mockReset();
    mocks.mockStartBC.mockReset();
    mocks.mockStopBC.mockReset();
    mocks.mockInitTabCounting.mockReset();
    mocks.mockInitDevTools.mockReset();
    mocks.mockDetectDebugger.mockReset();
    mocks.mockDetectDebugger.mockResolvedValue(false);
    mocks.mockVerifyBuildIdentity.mockReset();
    mocks.mockVerifyBuildIdentity.mockReturnValue(true);
    mocks.mockAuditRecord.mockReset();
    mocks.mockAuditRecord.mockResolvedValue(undefined);
    mocks.mockToastError.mockReset();
    mocks.mockTryRunDigest.mockReset();
    mocks.mockTryRunDigest.mockResolvedValue(null);
    mocks.mockStartupAIHint.mockReset();
    mocks.mockStartupAIHint.mockResolvedValue(undefined);
    localStorage.clear();
    sessionStorage.clear();
    setUrlSearch("/");
    (import.meta.env as any).DEV = true;
    (import.meta.env as any).PROD = false;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    setUrlSearch("/");
    cleanup();
  });

  describe("render", () => {
    it("renders null when not resetting", () => {
      const { container } = render(<AppInitializer />);
      expect(
        Array.from(container.children).every((el) => el.tagName === "STYLE"),
      ).toBe(true);
    });

    it("renders reset overlay when ?reset=true", () => {
      setUrlSearch("/?reset=true");
      const { getByText, container } = render(<AppInitializer />);
      expect(getByText(/Resetting/)).toBeTruthy();
      expect(container.querySelector(".animate-spin")).toBeTruthy();
    });
  });

  describe("reset logic", () => {
    it("calls destroyDB and secureStorage.clearAll when reset=true", async () => {
      setUrlSearch("/?reset=true");
      render(<AppInitializer />);
      await act(async () => {
        await vi.dynamicImportSettled();
        vi.advanceTimersByTime(2000);
      });
      expect(mocks.mockDestroyDB).toHaveBeenCalled();
      expect(mocks.mockClearAll).toHaveBeenCalled();
    });

    it("logs error when destroyDB fails during reset", async () => {
      mocks.mockDestroyDB.mockRejectedValueOnce(new Error("destroy failed"));
      setUrlSearch("/?reset=true");
      render(<AppInitializer />);
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("destroying DB"),
        expect.objectContaining({ error: "destroy failed" }),
      );
    });

    it("logs error when secureStorage.clearAll fails during reset", async () => {
      mocks.mockClearAll.mockRejectedValueOnce(new Error("clear failed"));
      setUrlSearch("/?reset=true");
      render(<AppInitializer />);
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("secureStorage"),
        expect.objectContaining({ error: "clear failed" }),
      );
    });

    it("cleans up cancelled flag on unmount during reset", async () => {
      setUrlSearch("/?reset=true");
      const { unmount } = render(<AppInitializer />);
      unmount();
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });
    });

    it("does not trigger reset when reset param is absent", async () => {
      render(<AppInitializer />);
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });
      expect(mocks.mockDestroyDB).not.toHaveBeenCalled();
    });
  });

  describe("demo mode", () => {
    beforeEach(() => {
      // Demo-boot retry tests drive the destroy-and-retry path; mark the
      // vault demo-owned so the guard in initDemoDatabase permits it.
      localStorage.setItem("forge_demo_vault_created", "true");
    });

    it("initializes demo when ?demo=true and isLocked", async () => {
      mocks.mockIsLocked = true;
      mocks.mockInitDB.mockResolvedValue(undefined);
      setUrlSearch("/?demo=true");
      render(<AppInitializer />);
      await act(async () => {
        vi.advanceTimersByTime(0);
      });
      expect(mocks.mockInitDB).toHaveBeenCalledWith("demo_vault_password_2026");
      expect(mocks.mockUnlock).toHaveBeenCalled();
    });

    it("initializes demo when forge_demo_active is set and isLocked", async () => {
      mocks.mockIsLocked = true;
      mocks.mockInitDB.mockResolvedValue(undefined);
      localStorage.setItem("forge_demo_active", "true");
      render(<AppInitializer />);
      await act(async () => {
        vi.advanceTimersByTime(0);
      });
      expect(mocks.mockInitDB).toHaveBeenCalledWith("demo_vault_password_2026");
      expect(mocks.mockUnlock).toHaveBeenCalled();
    });

    it("skips demo init when isResetting", async () => {
      setUrlSearch("/?reset=true&demo=true");
      render(<AppInitializer />);
      await act(async () => {
        vi.advanceTimersByTime(0);
      });
      expect(mocks.mockInitDB).not.toHaveBeenCalled();
    });

    it("skips demo init when not locked", async () => {
      mocks.mockIsLocked = false;
      setUrlSearch("/?demo=true");
      render(<AppInitializer />);
      await act(async () => {
        vi.advanceTimersByTime(0);
      });
      expect(mocks.mockInitDB).not.toHaveBeenCalled();
    });

    it("skips when no demo param and no forge_demo_active", async () => {
      mocks.mockIsLocked = true;
      render(<AppInitializer />);
      await act(async () => {
        vi.advanceTimersByTime(0);
      });
      expect(mocks.mockInitDB).not.toHaveBeenCalled();
    });

    it("retries with destroyDB when initDB throws DB1 error", async () => {
      mocks.mockIsLocked = true;
      mocks.mockInitDB
        .mockRejectedValueOnce(new Error("DB1 error"))
        .mockResolvedValueOnce(undefined);
      setUrlSearch("/?demo=true");
      render(<AppInitializer />);
      await act(async () => {
        vi.advanceTimersByTime(0);
      });
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });
      expect(mocks.mockDestroyDB).toHaveBeenCalled();
      expect(mocks.mockInitDB).toHaveBeenCalledTimes(2);
      expect(mocks.mockUnlock).toHaveBeenCalled();
    });

    it("retries when initDB throws password error", async () => {
      mocks.mockIsLocked = true;
      mocks.mockInitDB
        .mockRejectedValueOnce(new Error("password mismatch"))
        .mockResolvedValueOnce(undefined);
      setUrlSearch("/?demo=true");
      render(<AppInitializer />);
      await act(async () => {
        vi.advanceTimersByTime(0);
      });
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });
      expect(mocks.mockDestroyDB).toHaveBeenCalled();
      expect(mocks.mockInitDB).toHaveBeenCalledTimes(2);
    });

    it("retries when initDB throws adapter error", async () => {
      mocks.mockIsLocked = true;
      mocks.mockInitDB
        .mockRejectedValueOnce(new Error("adapter missing"))
        .mockResolvedValueOnce(undefined);
      setUrlSearch("/?demo=true");
      render(<AppInitializer />);
      await act(async () => {
        vi.advanceTimersByTime(0);
      });
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });
      expect(mocks.mockDestroyDB).toHaveBeenCalled();
      expect(mocks.mockInitDB).toHaveBeenCalledTimes(2);
    });

    it("retries when error object has code containing DB1", async () => {
      mocks.mockIsLocked = true;
      mocks.mockInitDB
        .mockRejectedValueOnce({ code: "DB1_CONNECTION_LOST" })
        .mockResolvedValueOnce(undefined);
      setUrlSearch("/?demo=true");
      render(<AppInitializer />);
      await act(async () => {
        vi.advanceTimersByTime(0);
      });
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });
      expect(mocks.mockDestroyDB).toHaveBeenCalled();
      expect(mocks.mockInitDB).toHaveBeenCalledTimes(2);
    });

    it("retries when error is a plain string containing password", async () => {
      mocks.mockIsLocked = true;
      mocks.mockInitDB
        .mockRejectedValueOnce("password invalid")
        .mockResolvedValueOnce(undefined);
      setUrlSearch("/?demo=true");
      render(<AppInitializer />);
      await act(async () => {
        vi.advanceTimersByTime(0);
      });
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });
      expect(mocks.mockDestroyDB).toHaveBeenCalled();
      expect(mocks.mockInitDB).toHaveBeenCalledTimes(2);
    });

    it("retries when error is null", async () => {
      mocks.mockIsLocked = true;
      mocks.mockInitDB
        .mockRejectedValueOnce(null)
        .mockResolvedValueOnce(undefined);
      setUrlSearch("/?demo=true");
      render(<AppInitializer />);
      await act(async () => {
        vi.advanceTimersByTime(0);
      });
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });
    });

    it("throws non-retryable error and logs it", async () => {
      mocks.mockIsLocked = true;
      mocks.mockInitDB.mockRejectedValueOnce(new Error("unknown error"));
      setUrlSearch("/?demo=true");
      render(<AppInitializer />);
      await act(async () => {
        vi.advanceTimersByTime(0);
      });
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Demo mode failed"),
        expect.objectContaining({ error: "unknown error" }),
      );
      expect(mocks.mockUnlock).not.toHaveBeenCalled();
    });

    it("logs warning when destroyDB fails during retry", async () => {
      mocks.mockIsLocked = true;
      mocks.mockInitDB
        .mockRejectedValueOnce(new Error("DB1 error"))
        .mockResolvedValueOnce(undefined);
      mocks.mockDestroyDB.mockRejectedValueOnce(new Error("destroy failed"));
      setUrlSearch("/?demo=true");
      render(<AppInitializer />);
      await act(async () => {
        vi.advanceTimersByTime(0);
      });
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("destroyDB failed"),
        expect.any(Object),
      );
      expect(mocks.mockUnlock).toHaveBeenCalled();
    });

    it("logs warning when secureStorage clear fails during retry", async () => {
      mocks.mockIsLocked = true;
      mocks.mockInitDB
        .mockRejectedValueOnce(new Error("DB1 error"))
        .mockResolvedValueOnce(undefined);
      mocks.mockClearAll.mockRejectedValueOnce(new Error("clear failed"));
      setUrlSearch("/?demo=true");
      render(<AppInitializer />);
      await act(async () => {
        vi.advanceTimersByTime(0);
      });
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("secureStorage clear failed"),
        expect.any(Object),
      );
      expect(mocks.mockUnlock).toHaveBeenCalled();
    });

    it("cleans up demo param from URL via replaceState", async () => {
      mocks.mockIsLocked = true;
      mocks.mockInitDB.mockResolvedValue(undefined);
      const replaceStateSpy = vi.spyOn(window.history, "replaceState");
      setUrlSearch("/?demo=true");
      render(<AppInitializer />);
      await act(async () => {
        vi.advanceTimersByTime(0);
      });
      expect(replaceStateSpy).toHaveBeenCalled();
      replaceStateSpy.mockRestore();
    });

    it("does not call unlock when cancelled", async () => {
      mocks.mockIsLocked = true;
      let resolveFlag: (v?: any) => void;
      mocks.mockSetMasterPasswordFlag.mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolveFlag = r;
          }),
      );
      let resolveInitDB: (v?: any) => void;
      mocks.mockInitDB.mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolveInitDB = r;
          }),
      );
      setUrlSearch("/?demo=true");
      const { unmount } = render(<AppInitializer />);
      // initDemo is paused at setMasterPasswordFlag
      unmount(); // cleanup sets cancelled = true
      // Let setMasterPasswordFlag resolve -> initDemo continues to initDB
      await act(async () => {
        resolveFlag!();
      });
      // resolveInitDB is now assigned
      await act(async () => {
        resolveInitDB!();
      });
      expect(mocks.mockUnlock).not.toHaveBeenCalled();
    });
  });

  describe("security protections", () => {
    it("calls initTabCounting on mount", () => {
      render(<AppInitializer />);
      expect(mocks.mockInitTabCounting).toHaveBeenCalled();
    });

    it("always calls detectHostileEnvironment and uses its result", () => {
      mocks.mockDetectHostile.mockReturnValue({ isSuspicious: true });
      render(<AppInitializer />);
      expect(mocks.mockDetectHostile).toHaveBeenCalled();
    });

    it("skips hostile env logging in DEV mode even if suspicious", () => {
      mocks.mockDetectHostile.mockReturnValue({ isSuspicious: true });
      (import.meta.env as any).DEV = true;
      render(<AppInitializer />);
      expect(logger.error).not.toHaveBeenCalledWith(
        expect.stringContaining("Hostile environment"),
        expect.any(Object),
      );
    });

    it("skips hostile env when VITE_DEV_MODE is true", () => {
      mocks.mockDetectHostile.mockReturnValue({ isSuspicious: true });
      (import.meta.env as any).DEV = false;
      (import.meta.env as any).VITE_DEV_MODE = true;
      render(<AppInitializer />);
      expect(logger.error).not.toHaveBeenCalledWith(
        expect.stringContaining("Hostile environment"),
        expect.any(Object),
      );
      delete (import.meta.env as any).VITE_DEV_MODE;
    });

    it("does not call initDevToolsProtection in DEV mode (PROD=false)", () => {
      render(<AppInitializer />);
      expect(mocks.mockInitDevTools).not.toHaveBeenCalled();
    });

    it("skips devtools protection in DEV mode", () => {
      (import.meta.env as any).DEV = true;
      (import.meta.env as any).PROD = false;
      render(<AppInitializer />);
      expect(mocks.mockInitDevTools).not.toHaveBeenCalled();
    });

    it("skips all security effects when isResetting", () => {
      setUrlSearch("/?reset=true");
      render(<AppInitializer />);
      expect(mocks.mockInitTabCounting).not.toHaveBeenCalled();
      expect(mocks.mockInitDevTools).not.toHaveBeenCalled();
    });
  });

  describe("data migration", () => {
    it("calls migrateFromLocalStorage on mount", async () => {
      render(<AppInitializer />);
      await act(async () => {});
      expect(mocks.mockMigrateFromLocalStorage).toHaveBeenCalled();
    });

    it("logs info after successful migration", async () => {
      render(<AppInitializer />);
      await act(async () => {});
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("migrated sensitive data"),
      );
    });

    it("logs error when migration fails", async () => {
      mocks.mockMigrateFromLocalStorage.mockRejectedValueOnce(
        new Error("migrate failed"),
      );
      render(<AppInitializer />);
      await act(async () => {});
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to migrate"),
        expect.objectContaining({ error: expect.any(Error) }),
      );
    });

    it("skips migration when isResetting", () => {
      setUrlSearch("/?reset=true");
      render(<AppInitializer />);
      expect(mocks.mockMigrateFromLocalStorage).not.toHaveBeenCalled();
    });
  });

  describe("garbage collection", () => {
    it("does not start GC in DEV mode", () => {
      render(<AppInitializer />);
      expect(mocks.mockStartGC).not.toHaveBeenCalled();
    });

    it("does not start GC when isResetting", () => {
      setUrlSearch("/?reset=true");
      render(<AppInitializer />);
      expect(mocks.mockStartGC).not.toHaveBeenCalled();
    });
  });

  describe("demo vault creation", () => {
    it("skips when isLocked", async () => {
      mocks.mockIsLocked = true;
      setupMockDb({ docCount: 0, bookmarkCount: 0 });
      render(<AppInitializer />);
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });
      expect(mocks.mockInitDB).not.toHaveBeenCalled();
    });

    it("skips when isResetting", async () => {
      mocks.mockIsLocked = false;
      setUrlSearch("/?reset=true");
      setupMockDb({ docCount: 0, bookmarkCount: 0 });
      render(<AppInitializer />);
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });
      expect(mocks.mockInitDB).not.toHaveBeenCalled();
    });

    it("P93: no programa el timer de demo vault sin demo mode", async () => {
      mocks.mockIsLocked = false;
      setupMockDb({ docCount: 0, bookmarkCount: 0 });
      render(<AppInitializer />);
      await act(async () => {
        vi.advanceTimersByTime(1500);
        await vi.dynamicImportSettled();
      });
      expect(mocks.mockInitDB).not.toHaveBeenCalled();
    });

    it("creates demo vault when DB is empty AND demo mode is active", async () => {
      mocks.mockIsLocked = false;
      localStorage.setItem("forge_demo_active", "true");
      const { documentsCol, bookmarksCol, flashcardsCol } = setupMockDb({
        docCount: 0,
        bookmarkCount: 0,
        hasFlashcards: true,
      });
      render(<AppInitializer />);
      await act(async () => {
        vi.advanceTimersByTime(1500);
        await vi.dynamicImportSettled();
      });
      expect(documentsCol!.insert).toHaveBeenCalledTimes(1);
      expect(bookmarksCol!.insert).toHaveBeenCalledTimes(2);
      expect(flashcardsCol!.insert).toHaveBeenCalledTimes(2);
      expect(localStorage.getItem("forge_demo_vault_created")).toBe("true");
    });

    it("creates demo vault without flashcards when flashcards collection missing", async () => {
      mocks.mockIsLocked = false;
      localStorage.setItem("forge_demo_active", "true");
      const { documentsCol, bookmarksCol, flashcardsCol } = setupMockDb({
        docCount: 0,
        bookmarkCount: 0,
        hasFlashcards: false,
      });
      render(<AppInitializer />);
      await act(async () => {
        vi.advanceTimersByTime(1500);
        await vi.dynamicImportSettled();
      });
      expect(documentsCol!.insert).toHaveBeenCalledTimes(1);
      expect(bookmarksCol!.insert).toHaveBeenCalledTimes(2);
      expect(flashcardsCol).toBeUndefined();
    });

    it("skips creation when forge_demo_vault_created is true", async () => {
      mocks.mockIsLocked = false;
      localStorage.setItem("forge_demo_active", "true");
      localStorage.setItem("forge_demo_vault_created", "true");
      const { documentsCol } = setupMockDb({ docCount: 0, bookmarkCount: 0 });
      render(<AppInitializer />);
      await act(async () => {
        vi.advanceTimersByTime(1500);
      });
      expect(documentsCol!.insert).not.toHaveBeenCalled();
    });

    it("skips creation when collections not found", async () => {
      mocks.mockIsLocked = false;
      localStorage.setItem("forge_demo_active", "true");
      setupMockDb({ collectionsNotFound: true });
      render(<AppInitializer />);
      await act(async () => {
        vi.advanceTimersByTime(1500);
      });
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Collections not found"),
      );
    });

    it("skips creation when docCount > 0", async () => {
      mocks.mockIsLocked = false;
      localStorage.setItem("forge_demo_active", "true");
      const { documentsCol } = setupMockDb({ docCount: 3, bookmarkCount: 0 });
      render(<AppInitializer />);
      await act(async () => {
        vi.advanceTimersByTime(1500);
      });
      expect(documentsCol!.insert).not.toHaveBeenCalled();
    });

    it("skips creation when bookmarkCount > 0", async () => {
      mocks.mockIsLocked = false;
      localStorage.setItem("forge_demo_active", "true");
      const { documentsCol } = setupMockDb({ docCount: 0, bookmarkCount: 5 });
      render(<AppInitializer />);
      await act(async () => {
        vi.advanceTimersByTime(1500);
      });
      expect(documentsCol!.insert).not.toHaveBeenCalled();
    });

    it("logs error when createDemoVault initDB fails", async () => {
      mocks.mockIsLocked = false;
      localStorage.setItem("forge_demo_active", "true");
      mocks.mockInitDB.mockRejectedValueOnce(new Error("db init failed"));
      render(<AppInitializer />);
      await act(async () => {
        vi.advanceTimersByTime(1500);
      });
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to create Demo Vault"),
        expect.objectContaining({ error: "db init failed" }),
      );
    });
  });

  describe("auto-backup and cloud sync", () => {
    it("skips when isLocked", async () => {
      mocks.mockIsLocked = true;
      render(<AppInitializer />);
      await act(async () => {
        vi.advanceTimersByTime(3000);
      });
      expect(mocks.mockRunAutoBackup).not.toHaveBeenCalled();
    });

    it("skips when isResetting", () => {
      mocks.mockIsLocked = false;
      setUrlSearch("/?reset=true");
      render(<AppInitializer />);
      expect(mocks.mockRunAutoBackup).not.toHaveBeenCalled();
    });

    it("runs auto-backup on unlock", async () => {
      mocks.mockIsLocked = false;
      render(<AppInitializer />);
      await act(async () => {
        vi.advanceTimersByTime(3000);
      });
      expect(mocks.mockRunAutoBackup).toHaveBeenCalled();
    });

    it("logs info after successful backup", async () => {
      mocks.mockIsLocked = false;
      render(<AppInitializer />);
      await act(async () => {
        vi.advanceTimersByTime(3000);
      });
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("Auto-backup completed"),
      );
    });

    it("logs warning when auto-backup fails", async () => {
      mocks.mockIsLocked = false;
      mocks.mockRunAutoBackup.mockRejectedValueOnce(new Error("backup failed"));
      render(<AppInitializer />);
      await act(async () => {
        vi.advanceTimersByTime(3000);
      });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Auto-backup failed"),
        expect.objectContaining({ error: "backup failed" }),
      );
    });

    it("initializes cloud sync when config exists", async () => {
      mocks.mockIsLocked = false;
      mocks.mockHasSecret.mockResolvedValue(true);
      mocks.mockDecryptSecret.mockResolvedValue(
        JSON.stringify({ provider: "gdrive" }),
      );
      render(<AppInitializer />);
      await act(async () => {
        vi.advanceTimersByTime(3000);
      });
      expect(mocks.mockRegisterLocalBackupProvider).toHaveBeenCalledWith(
        expect.objectContaining({ init: mocks.mockCloudSyncInit }),
      );
      expect(mocks.mockCloudSyncInit).toHaveBeenCalledWith({
        provider: "gdrive",
      });
    });

    it("logs info after cloud sync init", async () => {
      mocks.mockIsLocked = false;
      mocks.mockHasSecret.mockResolvedValue(true);
      mocks.mockDecryptSecret.mockResolvedValue(
        JSON.stringify({ provider: "gdrive" }),
      );
      render(<AppInitializer />);
      await act(async () => {
        vi.advanceTimersByTime(3000);
      });
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("Cloud sync initialized"),
      );
    });

    it("skips cloud sync when no config", async () => {
      mocks.mockIsLocked = false;
      mocks.mockHasSecret.mockResolvedValue(false);
      render(<AppInitializer />);
      await act(async () => {
        vi.advanceTimersByTime(3000);
      });
      expect(mocks.mockCloudSyncInit).not.toHaveBeenCalled();
    });

    it("registers the local provider before initializing and syncing", async () => {
      mocks.mockIsLocked = false;
      mocks.mockHasSecret.mockResolvedValue(true);
      mocks.mockDecryptSecret.mockResolvedValue(
        JSON.stringify({ provider: "gdrive" }),
      );
      localStorage.setItem("forge_auto_sync_cloud", "true");
      const order: string[] = [];
      mocks.mockRegisterLocalBackupProvider.mockImplementation(() => {
        order.push("provider");
      });
      mocks.mockCloudSyncInit.mockImplementation(() => {
        order.push("init");
      });
      mocks.mockCloudSyncSync.mockImplementation(() => {
        order.push("sync");
        return Promise.resolve({ success: true });
      });
      render(<AppInitializer />);
      await act(async () => {
        vi.advanceTimersByTime(3000);
      });
      expect(order).toEqual(["provider", "init", "sync"]);
    });

    it("auto-syncs when forge_auto_sync_cloud is true", async () => {
      mocks.mockIsLocked = false;
      mocks.mockHasSecret.mockResolvedValue(true);
      mocks.mockDecryptSecret.mockResolvedValue(
        JSON.stringify({ provider: "gdrive" }),
      );
      localStorage.setItem("forge_auto_sync_cloud", "true");
      render(<AppInitializer />);
      await act(async () => {
        vi.advanceTimersByTime(3000);
      });
      expect(mocks.mockRegisterLocalBackupProvider).toHaveBeenCalled();
      expect(mocks.mockCloudSyncSync).toHaveBeenCalled();
    });

    it("does not auto-sync when forge_auto_sync_cloud is not true", async () => {
      mocks.mockIsLocked = false;
      mocks.mockHasSecret.mockResolvedValue(true);
      mocks.mockDecryptSecret.mockResolvedValue(
        JSON.stringify({ provider: "gdrive" }),
      );
      render(<AppInitializer />);
      await act(async () => {
        vi.advanceTimersByTime(3000);
      });
      expect(mocks.mockCloudSyncSync).not.toHaveBeenCalled();
    });

    it("logs warning when cloud sync init fails", async () => {
      mocks.mockIsLocked = false;
      mocks.mockHasSecret.mockResolvedValue(true);
      mocks.mockDecryptSecret.mockResolvedValue(
        JSON.stringify({ provider: "gdrive" }),
      );
      mocks.mockCloudSyncInit.mockRejectedValueOnce(
        new Error("sync init failed"),
      );
      render(<AppInitializer />);
      await act(async () => {
        vi.advanceTimersByTime(3000);
      });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Cloud sync init failed"),
        expect.objectContaining({ error: "sync init failed" }),
      );
    });
  });

  describe("startup AI hint", () => {
    it("runs maybeShowStartupAIHint after unlocking the vault", async () => {
      mocks.mockIsLocked = false;
      render(<AppInitializer />);
      await act(async () => {
        vi.advanceTimersByTime(5000);
        await vi.dynamicImportSettled();
      });
      expect(mocks.mockStartupAIHint).toHaveBeenCalled();
    });

    it("does not run the hint while the vault is locked", async () => {
      mocks.mockIsLocked = true;
      render(<AppInitializer />);
      await act(async () => {
        vi.advanceTimersByTime(5000);
      });
      expect(mocks.mockStartupAIHint).not.toHaveBeenCalled();
    });

    it("does not run the hint during reset", async () => {
      mocks.mockIsLocked = false;
      setUrlSearch("/?reset=true");
      render(<AppInitializer />);
      await act(async () => {
        vi.advanceTimersByTime(5000);
      });
      expect(mocks.mockStartupAIHint).not.toHaveBeenCalled();
    });
  });

  describe("broadcast bridge", () => {
    it("starts after the vault is unlocked and stops on unmount", async () => {
      mocks.mockIsLocked = false;
      const { unmount } = render(<AppInitializer />);
      await act(async () => {
        await vi.dynamicImportSettled();
      });
      expect(mocks.mockStartBC).toHaveBeenCalled();
      unmount();
      expect(mocks.mockStopBC).toHaveBeenCalled();
    });

    it("skips start when isResetting", () => {
      setUrlSearch("/?reset=true");
      render(<AppInitializer />);
      expect(mocks.mockStartBC).not.toHaveBeenCalled();
    });
  });

  describe("prod security protections", () => {
    it("calls initDevToolsProtection and detects debugger in PROD", async () => {
      vi.stubEnv("PROD", "true" as any);
      mocks.mockDetectDebugger.mockResolvedValue(true);
      render(<AppInitializer />);
      expect(mocks.mockInitDevTools).toHaveBeenCalled();
      await act(async () => {});
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Debugger detected"),
      );
      expect(mocks.mockAuditRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "suspicious_environment_detected",
          target: "environment",
          result: "denied",
        }),
      );
    });

    it("does not warn when debugger probe resolves false in PROD", async () => {
      vi.stubEnv("PROD", "true" as any);
      mocks.mockDetectDebugger.mockResolvedValue(false);
      render(<AppInitializer />);
      await act(async () => {});
      expect(logger.warn).not.toHaveBeenCalledWith(
        expect.stringContaining("Debugger detected"),
      );
    });

    it("records suspicious environment to audit log when not dev", async () => {
      vi.stubEnv("DEV", "" as any);
      mocks.mockDetectHostile.mockReturnValue({
        isSuspicious: true,
        reasons: ["devtools"],
        details: {
          devToolsOpen: true,
          consoleTampered: false,
          debuggerDetected: false,
          prototypeTampered: false,
        },
      } as any);
      render(<AppInitializer />);
      await act(async () => {});
      expect(mocks.mockAuditRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "suspicious_environment_detected",
          context: expect.objectContaining({ reasons: "devtools" }),
        }),
      );
    });

    it("logs warn when audit record fails for suspicious environment", async () => {
      vi.stubEnv("DEV", "" as any);
      mocks.mockDetectHostile.mockReturnValue({
        isSuspicious: true,
        reasons: ["devtools"],
        details: {
          devToolsOpen: true,
          consoleTampered: false,
          debuggerDetected: false,
          prototypeTampered: false,
        },
      } as any);
      mocks.mockAuditRecord.mockRejectedValueOnce(new Error("audit failed"));
      render(<AppInitializer />);
      await act(async () => {});
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("auditLog.record failed"),
        expect.objectContaining({ error: expect.any(Error) }),
      );
    });

    it("suppresses hostile-env audit + console noise when VITE_TEST_BUILD is true", async () => {
      // Test/CI escape hatch: detection still runs and stays fully intact,
      // but the noisy console error and audit entry are suppressed so CI
      // runs (which always trip the headless/automation signals) produce
      // clean audit logs. PROD behavior is unchanged because production
      // builds never set VITE_TEST_BUILD.
      vi.stubEnv("DEV", "" as any);
      mocks.mockDetectHostile.mockReturnValue({
        isSuspicious: true,
        reasons: ["Headless user agent detected (informational)"],
        details: {
          devToolsOpen: false,
          consoleTampered: false,
          debuggerDetected: false,
          prototypeTampered: false,
        },
      } as any);
      (import.meta.env as any).VITE_TEST_BUILD = "true";
      render(<AppInitializer />);
      await act(async () => {});
      // Detection still ran against the real hostile signals...
      expect(mocks.mockDetectHostile).toHaveBeenCalled();
      // ...but no console error and no audit entry.
      expect(logger.error).not.toHaveBeenCalledWith(
        expect.stringContaining("Hostile environment"),
        expect.any(Object),
      );
      expect(mocks.mockAuditRecord).not.toHaveBeenCalledWith(
        expect.objectContaining({
          action: "suspicious_environment_detected",
        }),
      );
      delete (import.meta.env as any).VITE_TEST_BUILD;
    });

    it("still records hostile env to audit when not a test build (control)", async () => {
      // Control: without VITE_TEST_BUILD the exact same suspicious
      // environment STILL produces the audit entry — proving the flag only
      // silences the noise and never weakens PROD detection.
      vi.stubEnv("DEV", "" as any);
      mocks.mockDetectHostile.mockReturnValue({
        isSuspicious: true,
        reasons: ["canvas"] as string[],
        details: {
          devToolsOpen: true,
          consoleTampered: false,
          debuggerDetected: false,
          prototypeTampered: false,
        },
      } as any);
      render(<AppInitializer />);
      await act(async () => {});
      expect(mocks.mockAuditRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "suspicious_environment_detected",
          target: "environment",
          result: "denied",
        }),
      );
    });

    it("suppresses debugger-probe audit + warn when VITE_TEST_BUILD is true", async () => {
      vi.stubEnv("PROD", "true" as any);
      mocks.mockDetectDebugger.mockResolvedValue(true);
      (import.meta.env as any).VITE_TEST_BUILD = "true";
      render(<AppInitializer />);
      await act(async () => {});
      // The probe still ran — only the warn + audit are suppressed.
      expect(mocks.mockDetectDebugger).toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalledWith(
        expect.stringContaining("Debugger detected"),
      );
      expect(mocks.mockAuditRecord).not.toHaveBeenCalledWith(
        expect.objectContaining({
          action: "suspicious_environment_detected",
        }),
      );
      delete (import.meta.env as any).VITE_TEST_BUILD;
    });

    it("honors parseBool-truthy VITE_TEST_BUILD values (1/yes/on)", async () => {
      // The registry parses the flag with parseBool, so CI workflows that
      // set VITE_TEST_BUILD=1 must get the same escape hatch as "true".
      for (const value of ["1", "yes", "on"]) {
        vi.stubEnv("DEV", "" as any);
        mocks.mockDetectHostile.mockReturnValue({
          isSuspicious: true,
          reasons: ["devtools"],
          details: {
            devToolsOpen: true,
            consoleTampered: false,
            debuggerDetected: false,
            prototypeTampered: false,
          },
        } as any);
        (import.meta.env as any).VITE_TEST_BUILD = value;
        render(<AppInitializer />);
        await act(async () => {});
        expect(logger.error).not.toHaveBeenCalledWith(
          expect.stringContaining("Hostile environment"),
          expect.any(Object),
        );
        expect(mocks.mockAuditRecord).not.toHaveBeenCalledWith(
          expect.objectContaining({
            action: "suspicious_environment_detected",
          }),
        );
        delete (import.meta.env as any).VITE_TEST_BUILD;
        cleanup();
      }
    });
  });

  describe("bundle integrity", () => {
    it("shows toast and records audit when verifyBuildIdentity fails in PROD", async () => {
      (import.meta.env as any).DEV = false;
      (import.meta.env as any).PROD = true;
      mocks.mockVerifyBuildIdentity.mockReturnValue(false);
      render(<AppInitializer />);
      await act(async () => {
        vi.advanceTimersByTime(600);
      });
      expect(mocks.mockToastError).toHaveBeenCalledWith(
        expect.stringContaining("Security Alert"),
        expect.objectContaining({ id: "build-identity-failed" }),
      );
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Build identity verification failed"),
      );
      expect(mocks.mockAuditRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "bundle_integrity_failed",
          target: "build_identity",
          result: "failure",
        }),
      );
    });

    it("does not show toast when verifyBuildIdentity passes in PROD", async () => {
      (import.meta.env as any).DEV = false;
      (import.meta.env as any).PROD = true;
      mocks.mockVerifyBuildIdentity.mockReturnValue(true);
      render(<AppInitializer />);
      await act(async () => {
        vi.advanceTimersByTime(600);
      });
      expect(mocks.mockToastError).not.toHaveBeenCalled();
    });

    it("logs audit failure when auditLog.record rejects in PROD integrity check", async () => {
      (import.meta.env as any).DEV = false;
      (import.meta.env as any).PROD = true;
      mocks.mockVerifyBuildIdentity.mockReturnValue(false);
      mocks.mockAuditRecord.mockRejectedValueOnce(new Error("audit failed"));
      render(<AppInitializer />);
      await act(async () => {
        vi.advanceTimersByTime(600);
      });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("auditLog.record failed"),
        expect.objectContaining({ error: expect.any(Error) }),
      );
    });

    it("handles bundle-integrity-failed event with mismatched files", async () => {
      render(<AppInitializer />);
      await act(async () => {
        window.dispatchEvent(
          new CustomEvent("bundle-integrity-failed", {
            detail: { mismatchedFiles: ["chunk1.js"], checkedAt: "now" },
          }),
        );
      });
      expect(mocks.mockToastError).toHaveBeenCalledWith(
        expect.stringContaining("1 file(s)"),
        expect.objectContaining({ id: "bundle-integrity-failed" }),
      );
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Bundle integrity failure"),
        expect.objectContaining({ mismatchedFiles: ["chunk1.js"] }),
      );
      expect(mocks.mockAuditRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "bundle_integrity_failed",
          target: "bundle",
          context: expect.objectContaining({ fileCount: "1" }),
        }),
      );
    });

    it("uses generic message when bundle-integrity-failed has no files", async () => {
      render(<AppInitializer />);
      await act(async () => {
        window.dispatchEvent(
          new CustomEvent("bundle-integrity-failed", {
            detail: { mismatchedFiles: [], checkedAt: "now" },
          }),
        );
      });
      expect(mocks.mockToastError).toHaveBeenCalledWith(
        expect.stringContaining("integrity check failed"),
        expect.objectContaining({ id: "bundle-integrity-failed" }),
      );
      expect(mocks.mockAuditRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          context: expect.objectContaining({ fileCount: "0" }),
        }),
      );
    });
  });

  describe("weekly digest", () => {
    it("logs info when digest is generated", async () => {
      mocks.mockIsLocked = false;
      mocks.mockTryRunDigest.mockResolvedValue({ title: "Weekly Digest" });
      render(<AppInitializer />);
      await act(async () => {
        vi.advanceTimersByTime(3000);
      });
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("Weekly digest generated"),
        expect.objectContaining({ title: "Weekly Digest" }),
      );
      expect(mocks.mockTryRunDigest.mock.calls[0]?.[1]).toBeInstanceOf(
        AbortSignal,
      );
    });

    it("logs warn when digest generation fails", async () => {
      mocks.mockIsLocked = false;
      mocks.mockTryRunDigest.mockRejectedValueOnce(new Error("digest failed"));
      render(<AppInitializer />);
      await act(async () => {
        vi.advanceTimersByTime(3000);
      });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Weekly digest auto-generation failed"),
        expect.objectContaining({ error: "digest failed" }),
      );
    });
  });

  describe("auto cloud sync failure", () => {
    it("logs warn when auto-sync returns an unsuccessful result", async () => {
      mocks.mockIsLocked = false;
      mocks.mockHasSecret.mockResolvedValue(true);
      mocks.mockDecryptSecret.mockResolvedValue(
        JSON.stringify({ provider: "gdrive" }),
      );
      localStorage.setItem("forge_auto_sync_cloud", "true");
      mocks.mockCloudSyncSync.mockResolvedValueOnce({
        success: false,
        errors: ["No local data provider registered"],
      });
      render(<AppInitializer />);
      await act(async () => {
        vi.advanceTimersByTime(3000);
      });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Auto cloud sync failed"),
        expect.objectContaining({ error: "No local data provider registered" }),
      );
    });

    it("logs warn when auto cloud sync fails", async () => {
      mocks.mockIsLocked = false;
      mocks.mockHasSecret.mockResolvedValue(true);
      mocks.mockDecryptSecret.mockResolvedValue(
        JSON.stringify({ provider: "gdrive" }),
      );
      localStorage.setItem("forge_auto_sync_cloud", "true");
      mocks.mockCloudSyncSync.mockRejectedValueOnce(new Error("sync failed"));
      render(<AppInitializer />);
      await act(async () => {
        vi.advanceTimersByTime(3000);
      });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Auto cloud sync failed"),
        expect.objectContaining({ error: "sync failed" }),
      );
    });
  });
});
