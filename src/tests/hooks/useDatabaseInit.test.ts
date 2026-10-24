import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const {
  mockInitDB,
  mockGetDB,
  mockSecurityStore,
  mockHasMasterPassword,
} = vi.hoisted(() => {
  const mockInitDB = vi.fn().mockResolvedValue({});
  const mockGetDB = vi.fn().mockResolvedValue(null);
  const mockSecurityStore = vi.fn();
  const mockHasMasterPassword = vi.fn().mockResolvedValue(false);
  return { mockInitDB, mockGetDB, mockSecurityStore, mockHasMasterPassword };
});

vi.mock("../../db/database", () => ({
  initDB: mockInitDB,
  getDB: mockGetDB,
  isInvalidDbPasswordError: vi.fn(() => false),
  isDbInaccessibleError: vi.fn(() => false),
  isVaultLockedError: vi.fn(() => false),
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

describe("useDatabaseInit", () => {
  let useDatabaseInit: typeof import("../../hooks/useDatabaseInit").useDatabaseInit;

  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.stubGlobal("location", { search: "" });
    mockInitDB.mockResolvedValue({});
    const mod = await import("../../hooks/useDatabaseInit");
    useDatabaseInit = mod.useDatabaseInit;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("inicializa con db null y sin error", () => {
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
    await waitFor(() => expect(mockInitDB).toHaveBeenCalledWith(undefined));
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

  it("setMasterPassword updates the state", () => {
    mockSecurityStore.mockReturnValue({ isLocked: true, forceSetup: false });
    const { result } = renderHook(() => useDatabaseInit());
    act(() => {
      result.current.setMasterPassword("secret");
    });
    expect(result.current.masterPassword).toBe("secret");
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
