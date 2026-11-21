import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const mockDestroy = vi.fn().mockResolvedValue(undefined);
vi.mock("../../services/EncryptionService", () => ({
  encryptionService: { destroy: mockDestroy },
}));

const mockLock = vi.fn().mockResolvedValue(undefined);
const mockIsLocked = vi.fn(() => false);
vi.mock("../../services/SecurityVault", () => ({
  securityVault: {
    lock: mockLock,
    isLocked: mockIsLocked,
    onLock: vi.fn(() => () => {}),
    onUnlock: vi.fn(() => () => {}),
  },
}));

describe("useSecurityStore", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { useSecurityStore } = await import("../../hooks/useSecurityStore");
    useSecurityStore.setState({ isLocked: true, forceSetup: false });
  });

  it("should start locked by default", async () => {
    const { useSecurityStore } = await import("../../hooks/useSecurityStore");
    expect(useSecurityStore.getState().isLocked).toBe(true);
    expect(useSecurityStore.getState().forceSetup).toBe(false);
  });

  it("unlock should set isLocked to false", async () => {
    const { useSecurityStore } = await import("../../hooks/useSecurityStore");
    act(() => {
      useSecurityStore.getState().unlock();
    });
    expect(useSecurityStore.getState().isLocked).toBe(false);
    expect(useSecurityStore.getState().forceSetup).toBe(false);
  });

  it("setForceSetup(true) should call encryptionService.destroy and lock the vault", async () => {
    const { useSecurityStore } = await import("../../hooks/useSecurityStore");
    act(() => {
      useSecurityStore.getState().setForceSetup(true);
    });
    expect(mockDestroy).toHaveBeenCalled();
    // S9: the lock paths (Header button, auto-lock) route through here and
    // must actually lock the vault, not just flip UI state — otherwise the
    // decrypted AI API key survives in memory and cloud AI keeps working.
    expect(mockLock).toHaveBeenCalledTimes(1);
    expect(useSecurityStore.getState().forceSetup).toBe(true);
    expect(useSecurityStore.getState().isLocked).toBe(true);
  });

  it("does not call lock when the vault is already locked", async () => {
    const { useSecurityStore } = await import("../../hooks/useSecurityStore");
    mockIsLocked.mockReturnValue(true);
    act(() => {
      useSecurityStore.getState().setForceSetup(true);
    });
    expect(mockIsLocked).toHaveBeenCalledTimes(1);
    expect(mockLock).not.toHaveBeenCalled();
    expect(useSecurityStore.getState().isLocked).toBe(true);
  });

  it("setForceSetup(false) should set forceSetup to false without locking", async () => {
    const { useSecurityStore } = await import("../../hooks/useSecurityStore");
    useSecurityStore.setState({ isLocked: false, forceSetup: true });
    act(() => {
      useSecurityStore.getState().setForceSetup(false);
    });
    expect(mockDestroy).not.toHaveBeenCalled();
    expect(mockLock).not.toHaveBeenCalled();
    expect(useSecurityStore.getState().forceSetup).toBe(false);
    expect(useSecurityStore.getState().isLocked).toBe(false);
  });
});
