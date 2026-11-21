import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const {
  mockInitDB,
  mockGetDB,
  mockSecurityStore,
  mockHasMasterPassword,
  mockIsInvalidDbPasswordError,
  mockIsDbInaccessibleError,
  mockIsVaultLockedError,
  mockIsStorageBlockedError,
  mockDetectDbBusyError,
} = vi.hoisted(() => {
  const mockInitDB = vi.fn().mockResolvedValue({});
  const mockGetDB = vi.fn().mockResolvedValue(null);
  const mockSecurityStore = vi.fn();
  const mockHasMasterPassword = vi.fn().mockResolvedValue(false);
  const mockIsInvalidDbPasswordError = vi.fn(() => false);
  const mockIsDbInaccessibleError = vi.fn(() => false);
  const mockIsVaultLockedError = vi.fn(() => false);
  const mockIsStorageBlockedError = vi.fn(() => false);
  const mockDetectDbBusyError = vi.fn(() => false);
  return {
    mockInitDB,
    mockGetDB,
    mockSecurityStore,
    mockHasMasterPassword,
    mockIsInvalidDbPasswordError,
    mockIsDbInaccessibleError,
    mockIsVaultLockedError,
    mockIsStorageBlockedError,
    mockDetectDbBusyError,
  };
});

vi.mock("../../db/database", () => ({
  initDB: mockInitDB,
  getDB: mockGetDB,
  isInvalidDbPasswordError: mockIsInvalidDbPasswordError,
  isDbInaccessibleError: mockIsDbInaccessibleError,
  isVaultLockedError: mockIsVaultLockedError,
  isStorageBlockedError: mockIsStorageBlockedError,
  detectDbBusyError: mockDetectDbBusyError,
}));

vi.mock("../../services/EncryptionService", () => ({
  encryptionService: { destroy: vi.fn() },
}));

vi.mock("../../hooks/useSecurityStore", () => ({
  useSecurityStore: mockSecurityStore,
}));

// The hook reads securityVault.hasMasterPassword() on init; without a mock
// the real vault hangs (IndexedDB) and every test times out.
vi.mock("../../services/SecurityVault", () => ({
  securityVault: {
    hasMasterPassword: mockHasMasterPassword,
    registerCaller: vi.fn(),
    onLock: vi.fn(() => () => {}),
    onUnlock: vi.fn(() => () => {}),
  },
}));

const { mockProbeStorageCapabilities, mockIsStorageEnvironmentBroken } =
  vi.hoisted(() => ({
    mockProbeStorageCapabilities: vi.fn(),
    mockIsStorageEnvironmentBroken: vi.fn(() => false),
  }));

vi.mock("../../utils/storageProbe", () => ({
  probeStorageCapabilities: mockProbeStorageCapabilities,
  isStorageEnvironmentBroken: mockIsStorageEnvironmentBroken,
}));

describe("useDatabaseInit", () => {
  let useDatabaseInit: typeof import("../../hooks/useDatabaseInit").useDatabaseInit;

  beforeEach(async () => {
    vi.clearAllMocks();
    // clearAllMocks keeps implementations — reset the classification
    // guards explicitly so a STORAGE_BLOCKED fixture can't leak forward.
    mockIsInvalidDbPasswordError.mockReturnValue(false);
    mockIsDbInaccessibleError.mockReturnValue(false);
    mockIsVaultLockedError.mockReturnValue(false);
    mockIsStorageBlockedError.mockReturnValue(false);
    mockDetectDbBusyError.mockReturnValue(false);
    mockProbeStorageCapabilities.mockResolvedValue({
      indexedDB: "ok",
      cryptoSubtle: true,
      localStorage: true,
    });
    mockIsStorageEnvironmentBroken.mockReturnValue(false);
    localStorage.clear();
    vi.stubGlobal("location", { search: "" });
    mockInitDB.mockResolvedValue({});
    const mod = await import("../../hooks/useDatabaseInit");
    useDatabaseInit = mod.useDatabaseInit;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("initializes with a null db without error", () => {
    mockSecurityStore.mockReturnValue({ isLocked: true, forceSetup: false });
    const { result } = renderHook(() => useDatabaseInit());
    expect(result.current.dbError).toBeNull();
    expect(result.current.hasPwd).toBe(false);
  });

  it("starts initDB when unlocked", async () => {
    const mockDb = { name: "test-db" };
    mockInitDB.mockResolvedValue(mockDb);
    mockSecurityStore.mockReturnValue({ isLocked: false, forceSetup: false });

    const { result } = renderHook(() => useDatabaseInit());
    await waitFor(() => expect(mockInitDB).toHaveBeenCalled());
    await waitFor(() => expect(result.current.db).toEqual(mockDb));
  });

  it("does not start initDB when locked without a password", async () => {
    mockSecurityStore.mockReturnValue({ isLocked: true, forceSetup: false });

    const { result } = renderHook(() => useDatabaseInit());
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockInitDB).not.toHaveBeenCalled();
    expect(result.current.db).toBeNull();
    expect(result.current.dbError).toBeNull();
  });

  it("resumes initDB after unlocking", async () => {
    const mockDb = { name: "test-db" };
    mockInitDB.mockResolvedValue(mockDb);
    mockSecurityStore.mockReturnValue({ isLocked: true, forceSetup: false });

    const { result, rerender } = renderHook(() => useDatabaseInit());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockInitDB).not.toHaveBeenCalled();

    mockSecurityStore.mockReturnValue({ isLocked: false, forceSetup: false });
    rerender();
    // No credential argument: initDB() reads a zeroizing copy from the vault.
    await waitFor(() => expect(mockInitDB).toHaveBeenCalledWith());
    await waitFor(() => expect(result.current.db).toEqual(mockDb));
  });

  it("restarts the instance on lock and re-initializes on unlock", async () => {
    const firstDb = { name: "first-db" };
    const secondDb = { name: "second-db" };
    mockInitDB
      .mockResolvedValueOnce(firstDb)
      .mockResolvedValueOnce(secondDb);
    mockSecurityStore.mockReturnValue({ isLocked: false, forceSetup: false });

    const { result, rerender } = renderHook(() => useDatabaseInit());
    await waitFor(() => expect(result.current.db).toEqual(firstDb));

    mockSecurityStore.mockReturnValue({ isLocked: true, forceSetup: false });
    rerender();
    await waitFor(() => expect(result.current.db).toBeNull());

    mockSecurityStore.mockReturnValue({ isLocked: false, forceSetup: false });
    rerender();
    await waitFor(() => expect(result.current.db).toEqual(secondDb));
    expect(mockInitDB).toHaveBeenCalledTimes(2);
  });

  it("captura error de initDB", async () => {
    mockInitDB.mockRejectedValue(new Error("DB fail"));
    mockSecurityStore.mockReturnValue({ isLocked: false, forceSetup: false });

    const { result } = renderHook(() => useDatabaseInit());
    await waitFor(() => expect(result.current.dbError).toBeTruthy());
  });

  it("retries initialization without reloading the page", async () => {
    const mockDb = { name: "recovered-db" };
    mockInitDB
      .mockRejectedValueOnce(new Error("temporary storage failure"))
      .mockResolvedValueOnce(mockDb);
    mockSecurityStore.mockReturnValue({ isLocked: false, forceSetup: false });

    const { result } = renderHook(() => useDatabaseInit());
    await waitFor(() => expect(result.current.dbError).toBeTruthy());

    act(() => {
      result.current.retry();
    });

    await waitFor(() => expect(result.current.db).toEqual(mockDb));
    expect(mockInitDB).toHaveBeenCalledTimes(2);
  });

  it("does not start twice during a lock/unlock while IndexedDB responds", async () => {
    const firstDb = { name: "late-db" };
    const secondDb = { name: "recovered-db" };
    let resolveFirst: (db: unknown) => void = () => {};
    const firstInit = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    mockInitDB
      .mockReturnValueOnce(firstInit)
      .mockResolvedValueOnce(secondDb);
    mockSecurityStore.mockReturnValue({ isLocked: false, forceSetup: false });

    const { result, rerender } = renderHook(() => useDatabaseInit());
    await waitFor(() => expect(mockInitDB).toHaveBeenCalledTimes(1));

    mockSecurityStore.mockReturnValue({ isLocked: true, forceSetup: false });
    rerender();
    mockSecurityStore.mockReturnValue({ isLocked: false, forceSetup: false });
    rerender();

    act(() => {
      resolveFirst(firstDb);
    });

    await waitFor(() => expect(result.current.db).toEqual(secondDb));
    expect(mockInitDB).toHaveBeenCalledTimes(2);
  });

  it("hasPwd updates when isLocked/forceSetup changes", async () => {
    mockSecurityStore.mockReturnValue({ isLocked: true, forceSetup: false });
    const { result, rerender } = renderHook(() => useDatabaseInit());
    expect(result.current.hasPwd).toBe(false);

    localStorage.setItem("forge_has_master_password", "true");
    mockHasMasterPassword.mockResolvedValue(true);
    mockSecurityStore.mockReturnValue({ isLocked: false, forceSetup: true });
    rerender();
    await waitFor(() => expect(result.current.hasPwd).toBe(true));
  });

  it("never exposes master-password state (bytes live only in the vault)", () => {
    mockSecurityStore.mockReturnValue({ isLocked: true, forceSetup: false });
    const { result } = renderHook(() => useDatabaseInit());
    // AGENTS.md §2: the hook must not hold the credential — initDB() takes a
    // zeroizing copy from the unlocked vault instead.
    expect("masterPassword" in result.current).toBe(false);
    expect("setMasterPassword" in result.current).toBe(false);
  });

  it("initializes hasPwd as true when localStorage has the key", () => {
    localStorage.setItem("forge_has_master_password", "true");
    mockSecurityStore.mockReturnValue({ isLocked: true, forceSetup: false });
    const { result } = renderHook(() => useDatabaseInit());
    expect(result.current.hasPwd).toBe(true);
  });

  it("handles initDB error with non-Error object", async () => {
    mockInitDB.mockRejectedValue({
      name: "CustomError",
      code: "E001",
      message: "custom",
    });
    mockSecurityStore.mockReturnValue({ isLocked: false, forceSetup: false });
    const { result } = renderHook(() => useDatabaseInit());
    await waitFor(() => expect(result.current.dbError).toBeTruthy());
    expect(result.current.dbError).toContain("CustomError");
  });

  it("handles initDB error with primitive string", async () => {
    mockInitDB.mockRejectedValue("string error");
    mockSecurityStore.mockReturnValue({ isLocked: false, forceSetup: false });
    const { result } = renderHook(() => useDatabaseInit());
    await waitFor(() => expect(result.current.dbError).toBeTruthy());
  });

  it("handles error with parameters property", async () => {
    const err = new Error("DB fail");
    (err as any).parameters = { detail: "something" };
    mockInitDB.mockRejectedValue(err);
    mockSecurityStore.mockReturnValue({ isLocked: false, forceSetup: false });
    const { result } = renderHook(() => useDatabaseInit());
    await waitFor(() => expect(result.current.dbError).toBeTruthy());
    expect(result.current.dbError).toContain("Params");
  });

  it("does not start DB when demo is active and locked", async () => {
    localStorage.setItem("forge_demo_active", "true");
    mockSecurityStore.mockReturnValue({ isLocked: true, forceSetup: false });
    renderHook(() => useDatabaseInit());
    await waitFor(() => expect(mockInitDB).not.toHaveBeenCalled());
  });

  it("starts DB via demo=true URL param when locked", async () => {
    vi.stubGlobal("location", { search: "?demo=true" });
    mockSecurityStore.mockReturnValue({ isLocked: true, forceSetup: false });
    renderHook(() => useDatabaseInit());
    await waitFor(() => expect(mockInitDB).not.toHaveBeenCalled());
  });

  it("prefers getDB when it returns a different instance", async () => {
    const db1 = { name: "db1" };
    const db2 = { name: "db2" };
    mockInitDB.mockResolvedValue(db1);
    mockGetDB.mockResolvedValue(db2);
    mockSecurityStore.mockReturnValue({ isLocked: false, forceSetup: false });
    const { result } = renderHook(() => useDatabaseInit());
    await waitFor(() => expect(result.current.db).toEqual(db2));
  });

  it("classifies storage-denied init failures as STORAGE_BLOCKED", async () => {
    // IndexedDB blocked by the browser (site data off, enterprise policy,
    // third-party storage partitioning) must NOT surface as vault
    // corruption — the UI keys off dbErrorClass for the right copy.
    const err = new Error("Database inaccessible.");
    err.name = "DB_INACCESSIBLE";
    mockInitDB.mockRejectedValue(err);
    mockIsDbInaccessibleError.mockReturnValue(true);
    mockIsStorageBlockedError.mockReturnValue(true);
    mockSecurityStore.mockReturnValue({ isLocked: false, forceSetup: false });

    const { result } = renderHook(() => useDatabaseInit());
    await waitFor(() => expect(result.current.dbErrorClass).toBe("STORAGE_BLOCKED"));
  });

  it("keeps INACCESSIBLE when the failure is not storage-denied", async () => {
    const err = new Error("Database inaccessible.");
    err.name = "DB_INACCESSIBLE";
    mockInitDB.mockRejectedValue(err);
    mockIsDbInaccessibleError.mockReturnValue(true);
    mockIsStorageBlockedError.mockReturnValue(false);
    mockSecurityStore.mockReturnValue({ isLocked: false, forceSetup: false });

    const { result } = renderHook(() => useDatabaseInit());
    await waitFor(() => expect(result.current.dbErrorClass).toBe("INACCESSIBLE"));
  });

  it("upgrades INACCESSIBLE to STORAGE_BLOCKED when the probe shows a broken environment", async () => {
    // A hung indexedDB.open surfaces as DB_INIT_TIMEOUT → UNKNOWN class,
    // and SecureStorage retry exhaustion arrives as a plain Error — neither
    // matches the error-shape classifier. The active probe is decisive.
    const err = new Error("DB_INIT_TIMEOUT after 30000ms");
    mockInitDB.mockRejectedValue(err);
    mockIsDbInaccessibleError.mockReturnValue(true);
    mockIsStorageBlockedError.mockReturnValue(false);
    mockProbeStorageCapabilities.mockResolvedValue({
      indexedDB: "timeout",
      cryptoSubtle: true,
      localStorage: true,
    });
    mockIsStorageEnvironmentBroken.mockReturnValue(true);
    mockSecurityStore.mockReturnValue({ isLocked: false, forceSetup: false });

    const { result } = renderHook(() => useDatabaseInit());
    await waitFor(() =>
      expect(result.current.dbErrorClass).toBe("STORAGE_BLOCKED"),
    );
    expect(mockProbeStorageCapabilities).toHaveBeenCalled();
  });

  it("keeps INACCESSIBLE when the probe shows a healthy environment", async () => {
    const err = new Error("Database inaccessible.");
    err.name = "DB_INACCESSIBLE";
    mockInitDB.mockRejectedValue(err);
    mockIsDbInaccessibleError.mockReturnValue(true);
    mockIsStorageBlockedError.mockReturnValue(false);
    mockProbeStorageCapabilities.mockResolvedValue({
      indexedDB: "ok",
      cryptoSubtle: true,
      localStorage: true,
    });
    mockIsStorageEnvironmentBroken.mockReturnValue(false);
    mockSecurityStore.mockReturnValue({ isLocked: false, forceSetup: false });

    const { result } = renderHook(() => useDatabaseInit());
    await waitFor(() => expect(result.current.dbErrorClass).toBe("INACCESSIBLE"));
  });

  it("classifies multi-tab contention as DB_BUSY before storage checks", async () => {
    // A second tab holding the vault produces INACCESSIBLE/UNKNOWN-shaped
    // errors (DB3, DatabaseClosedError, upgrade-blocked) — the UI must show
    // "close other tabs", not "storage unavailable" or "restore backup".
    const err = new Error("Database inaccessible.");
    err.name = "DB_INACCESSIBLE";
    mockInitDB.mockRejectedValue(err);
    mockIsDbInaccessibleError.mockReturnValue(true);
    mockIsStorageBlockedError.mockReturnValue(false);
    mockDetectDbBusyError.mockReturnValue(true);
    mockSecurityStore.mockReturnValue({ isLocked: false, forceSetup: false });

    const { result } = renderHook(() => useDatabaseInit());
    await waitFor(() => expect(result.current.dbErrorClass).toBe("DB_BUSY"));
    // Busy wins over the environment probe: the probe opens its own DB and
    // would report healthy even while the vault DB is held by another tab.
    expect(mockProbeStorageCapabilities).not.toHaveBeenCalled();
  });

  it("does not probe for WRONG_PASSWORD or VAULT_LOCKED classes", async () => {
    const err = new Error("Invalid password.");
    err.name = "INVALID_PASSWORD";
    mockInitDB.mockRejectedValue(err);
    mockIsInvalidDbPasswordError.mockReturnValue(true);
    mockSecurityStore.mockReturnValue({ isLocked: false, forceSetup: false });

    const { result } = renderHook(() => useDatabaseInit());
    await waitFor(() => expect(result.current.dbErrorClass).toBe("WRONG_PASSWORD"));
    expect(mockProbeStorageCapabilities).not.toHaveBeenCalled();
  });

  // Regression: a vault WITHOUT a master password whose password prompt was
  // skipped (PASSWORD_SKIPPED = "true") used to strand on the shell's
  // "Loading…" screen after a reload (isLocked starts true) or an auto-lock:
  // SecurityConfirmation only appears BEFORE the skip, the unlock screen
  // requires hasPwd, and init() returned without a db — so nothing could ever
  // flip the state. The reopen now happens inside init(), gated on
  // SecureStorage's authoritative hasMasterPassword() === false.
  describe("passwordless reopen — no \"Loading…\" strand (reload / auto-lock)", () => {
    type StoreWithGetState = {
      getState?: () => { unlock: () => void };
    };

    const attachGetState = (unlock: () => void) => {
      (mockSecurityStore as unknown as StoreWithGetState).getState = () => ({
        unlock,
      });
    };

    afterEach(() => {
      delete (mockSecurityStore as unknown as StoreWithGetState).getState;
    });

    it("auto-unlocks a skipped passwordless vault and resumes initDB", async () => {
      const unlock = vi.fn(() => {
        // The real store flips isLocked on unlock(); emulate the state the
        // component tree would then render with so the effect re-runs, which
        // is exactly what happens in the app after the reopen.
        mockSecurityStore.mockReturnValue({ isLocked: false, forceSetup: false });
      });
      attachGetState(unlock);
      localStorage.setItem("forge_password_skipped", "true");
      mockHasMasterPassword.mockResolvedValue(false);
      // Explicit fixtures: earlier tests leave persistent implementations on
      // these mocks (clearAllMocks does not reset them).
      mockInitDB.mockResolvedValue({ name: "reopened-db" });
      mockGetDB.mockResolvedValue(null);
      mockSecurityStore.mockReturnValue({ isLocked: true, forceSetup: false });

      const { result, rerender } = renderHook(() => useDatabaseInit());
      await waitFor(() => expect(unlock).toHaveBeenCalled());
      rerender();
      await waitFor(() => expect(mockInitDB).toHaveBeenCalled());
      await waitFor(() => expect(result.current.db).toEqual({ name: "reopened-db" }));
      expect(result.current.dbError).toBeNull();
    });

    it("leaves a fresh passwordless vault locked (confirmation screen owns the choice)", async () => {
      const unlock = vi.fn();
      attachGetState(unlock);
      // PASSWORD_SKIPPED stays unset — the SecurityConfirmation choice has not
      // been made yet, so the hook must keep waiting for it.
      mockHasMasterPassword.mockResolvedValue(false);
      mockSecurityStore.mockReturnValue({ isLocked: true, forceSetup: false });

      const { result } = renderHook(() => useDatabaseInit());
      await waitFor(() => expect(mockHasMasterPassword).toHaveBeenCalled());
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unlock).not.toHaveBeenCalled();
      expect(mockInitDB).not.toHaveBeenCalled();
      expect(result.current.db).toBeNull();
    });

    it("keeps the vault locked when the authoritative read rejects", async () => {
      const unlock = vi.fn();
      attachGetState(unlock);
      // A failed read does not prove absence: treat it as unknown and never
      // reopen a vault without a confirmed `false`.
      localStorage.setItem("forge_password_skipped", "true");
      mockHasMasterPassword.mockRejectedValue(new Error("vault unavailable"));
      mockSecurityStore.mockReturnValue({ isLocked: true, forceSetup: false });

      const { result } = renderHook(() => useDatabaseInit());
      await waitFor(() => expect(mockHasMasterPassword).toHaveBeenCalled());
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unlock).not.toHaveBeenCalled();
      expect(mockInitDB).not.toHaveBeenCalled();
      expect(result.current.db).toBeNull();
    });

    it("never auto-unlocks when SecureStorage says a master password exists", async () => {
      const unlock = vi.fn();
      attachGetState(unlock);
      // Even a stale/corrupt skipped flag must not override the authoritative
      // answer: a locked vault WITH a password stays locked.
      localStorage.setItem("forge_password_skipped", "true");
      mockHasMasterPassword.mockResolvedValue(true);
      mockSecurityStore.mockReturnValue({ isLocked: true, forceSetup: false });

      const { result } = renderHook(() => useDatabaseInit());
      await waitFor(() => expect(mockHasMasterPassword).toHaveBeenCalled());
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unlock).not.toHaveBeenCalled();
      expect(mockInitDB).not.toHaveBeenCalled();
      expect(result.current.db).toBeNull();
    });
  });
});
