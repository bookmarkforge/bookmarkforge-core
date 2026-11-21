import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const mockInitDB = vi.fn();
const mockSecurityVault = {
  isLocked: vi.fn(),
  unlock: vi.fn(),
  lock: vi.fn(),
  onLock: vi.fn(() => () => {}),
  onUnlock: vi.fn(() => () => {}),
};
vi.mock("../../db/database", () => ({
  initDB: mockInitDB,
  getDB: vi.fn(),
  destroyDB: vi.fn(),
}));
vi.mock("../../services/ai/ProviderManager", () => ({ aiManager: {} }));
vi.mock("../../services/SecurityVault", () => ({
  securityVault: mockSecurityVault,
}));
vi.mock("../../utils/logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

describe("useMainAppState", () => {
  let useMainAppState: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../../hooks/useMainAppState");
    useMainAppState = mod.useMainAppState;
  });

  it("should start with loading state", () => {
    mockInitDB.mockResolvedValue({});
    mockSecurityVault.isLocked.mockReturnValue(false);

    const { result, unmount } = renderHook(() => useMainAppState());
    expect(result.current.loading).toBe(true);
    expect(result.current.isInitialized).toBe(false);
    expect(result.current.error).toBeNull();
    unmount();
  });

  it("should initialize app on mount", async () => {
    mockInitDB.mockResolvedValue({});
    mockSecurityVault.isLocked.mockReturnValue(false);

    const { result } = renderHook(() => useMainAppState());
    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    expect(result.current.isDBReady).toBe(true);
    expect(result.current.isAIReady).toBe(true);
    expect(result.current.isVaultUnlocked).toBe(true);
    expect(result.current.loading).toBe(false);
  });

  it("should not initialize twice if already in progress", async () => {
    mockInitDB.mockReturnValue(
      new Promise((resolve) => setTimeout(() => resolve({}), 50)),
    );
    mockSecurityVault.isLocked.mockReturnValue(false);

    const { result } = renderHook(() => useMainAppState());

    await act(async () => {
      result.current.initializeApp();
      result.current.initializeApp();
    });

    expect(mockInitDB).toHaveBeenCalledTimes(1);
  });

  it("should handle init errors", async () => {
    mockInitDB.mockRejectedValue(new Error("DB fail"));

    const { result } = renderHook(() => useMainAppState());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isInitialized).toBe(false);
    expect(result.current.error).toBe("DB fail");
  });

  it("should handle non-Error init errors", async () => {
    mockInitDB.mockRejectedValue("string error");
    const { result } = renderHook(() => useMainAppState());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Unknown initialization error");
  });

  it("unlockVault should unlock and return true", async () => {
    mockInitDB.mockResolvedValue({});
    mockSecurityVault.isLocked.mockReturnValue(true);
    mockSecurityVault.unlock.mockReturnValue(true);

    const { result } = renderHook(() => useMainAppState());
    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    let unlocked = false;
    await act(async () => {
      unlocked = await result.current.unlockVault("password");
    });
    expect(unlocked).toBe(true);
    expect(mockSecurityVault.unlock).toHaveBeenCalledWith("password");
    expect(result.current.isVaultUnlocked).toBe(true);
  });

  it("unlockVault should handle errors", async () => {
    mockInitDB.mockResolvedValue({});
    mockSecurityVault.isLocked.mockReturnValue(true);
    mockSecurityVault.unlock.mockReturnValue(false);

    const { result } = renderHook(() => useMainAppState());
    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    let unlocked = true;
    await act(async () => {
      unlocked = await result.current.unlockVault("wrong");
    });
    expect(unlocked).toBe(false);
    expect(result.current.error).toBe(
      "Invalid password or too many attempts. Please wait 5 minutes.",
    );
  });

  it("lockVault should lock", async () => {
    mockInitDB.mockResolvedValue({});
    mockSecurityVault.isLocked.mockReturnValue(false);
    mockSecurityVault.lock.mockResolvedValue(undefined);

    const { result } = renderHook(() => useMainAppState());
    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    await act(async () => {
      await result.current.lockVault();
    });
    expect(mockSecurityVault.lock).toHaveBeenCalled();
    expect(result.current.isVaultUnlocked).toBe(false);
  });

  it("lockVault should handle errors", async () => {
    mockInitDB.mockResolvedValue({});
    mockSecurityVault.isLocked.mockReturnValue(false);
    mockSecurityVault.lock.mockRejectedValue(new Error("Lock fail"));

    const { result } = renderHook(() => useMainAppState());
    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    await act(async () => {
      await result.current.lockVault();
    });
    expect(mockSecurityVault.lock).toHaveBeenCalled();
    // Should not throw, just log error
  });

  it("resetError should clear error", async () => {
    mockInitDB.mockRejectedValue(new Error("DB fail"));

    const { result } = renderHook(() => useMainAppState());
    await waitFor(() => expect(result.current.error).toBe("DB fail"));

    act(() => {
      result.current.resetError();
    });
    expect(result.current.error).toBeNull();
  });

  it("reinitialize should reset and re-init", async () => {
    mockInitDB.mockResolvedValue({});
    mockSecurityVault.isLocked.mockReturnValue(false);

    const { result } = renderHook(() => useMainAppState());
    await waitFor(() => expect(result.current.isInitialized).toBe(true));

    mockInitDB.mockResolvedValueOnce({});
    await act(async () => {
      await result.current.reinitialize();
    });
    expect(result.current.isInitialized).toBe(true);
  });
});

describe("useAppInit", () => {
  let useAppInit: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { initDB } = await import("../../db/database");
    (initDB as any).mockResolvedValue({});
    const { securityVault } = await import("../../services/SecurityVault");
    (securityVault.isLocked as any).mockReturnValue(false);

    const mod = await import("../../hooks/useMainAppState");
    useAppInit = mod.useAppInit;
  });

  it("should return subset of state", async () => {
    const { result } = renderHook(() => useAppInit());
    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    expect(result.current.isDBReady).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.initializeApp).toBeDefined();
    expect(result.current.resetError).toBeDefined();
    expect(result.current.db).toBeUndefined();
    expect(result.current.unlockVault).toBeUndefined();
  });
});
