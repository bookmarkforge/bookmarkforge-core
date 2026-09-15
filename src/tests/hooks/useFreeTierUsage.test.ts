import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const mockInitDB = vi.fn();
const mockHasProAccess = vi.fn(() => false);
const mockCanAddBookmarks = vi.fn(async (count: number) => count < 1000);
const mockSecurityState = { isLocked: false };

vi.mock("../../db/database", () => ({ initDB: mockInitDB }));
vi.mock("../../services/LicenseService", () => ({
  licenseService: {
    hasProAccess: mockHasProAccess,
    canAddBookmarks: mockCanAddBookmarks,
  },
}));
vi.mock("../../hooks/useSecurityStore", () => ({
  useSecurityStore: (sel: (s: unknown) => unknown) => sel(mockSecurityState),
}));

const { useFreeTierUsage } = await import("../../hooks/useFreeTierUsage");
const { FREE_LIMITS } = await import("../../constants/license");

/** Reactive count$ mock: holds one initial value, emits updates live. */
function makeCountQuery(initial: number) {
  const observers = new Set<{ next: (n: number) => void }>();
  const count = vi.fn(() => ({
    $: {
      subscribe: (obs: { next: (n: number) => void }) => {
        observers.add(obs);
        queueMicrotask(() => obs.next(initial));
        return { unsubscribe: () => observers.delete(obs) };
      },
    },
  }));
  return {
    count,
    emit: (n: number) => observers.forEach((o) => o.next(n)),
  };
}

describe("useFreeTierUsage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSecurityState.isLocked = false;
    mockHasProAccess.mockReturnValue(false);
    mockCanAddBookmarks.mockImplementation(async (count: number) => count < 1000);
  });

  it("subscribes with the same { isDeleted: false } selector the wall counts", async () => {
    const q = makeCountQuery(42);
    mockInitDB.mockResolvedValue({ bookmarks: q });
    const { result } = renderHook(() => useFreeTierUsage());
    await waitFor(() => expect(result.current.count).toBe(42));
    expect(q.count).toHaveBeenCalledWith({ selector: { isDeleted: false } });
    expect(result.current.isFree).toBe(true);
    expect(result.current.limit).toBe(FREE_LIMITS.maxBookmarks);
    expect(result.current.canAddBookmark).toBe(true);
    expect(mockCanAddBookmarks).toHaveBeenCalledWith(42);
  });

  it("flags nearWall at ≥90% and atWall at the limit", async () => {
    const q = makeCountQuery(899);
    mockInitDB.mockResolvedValue({ bookmarks: q });
    const { result } = renderHook(() => useFreeTierUsage());
    await waitFor(() => expect(result.current.count).toBe(899));
    expect(result.current.nearWall).toBe(false);

    q.emit(900);
    await waitFor(() => expect(result.current.nearWall).toBe(true));
    expect(result.current.atWall).toBe(false);

    q.emit(1000);
    await waitFor(() => expect(result.current.atWall).toBe(true));
    expect(result.current.canAddBookmark).toBe(false);
    expect(mockCanAddBookmarks).toHaveBeenLastCalledWith(1000);
  });

  it("is a no-op for Pro users — the nudge must not exist for them", async () => {
    mockHasProAccess.mockReturnValue(true);
    const q = makeCountQuery(5000);
    mockInitDB.mockResolvedValue({ bookmarks: q });
    const { result } = renderHook(() => useFreeTierUsage());
    await new Promise((r) => setTimeout(r, 10));
    expect(q.count).not.toHaveBeenCalled();
    expect(result.current.count).toBeUndefined();
    expect(result.current.isFree).toBe(false);
  });

  it("stays quiet while the vault is locked", async () => {
    mockSecurityState.isLocked = true;
    const q = makeCountQuery(100);
    mockInitDB.mockResolvedValue({ bookmarks: q });
    const { result } = renderHook(() => useFreeTierUsage());
    await new Promise((r) => setTimeout(r, 10));
    expect(mockInitDB).not.toHaveBeenCalled();
    expect(result.current.count).toBeUndefined();
    expect(result.current.isFree).toBe(false);
  });

  it("degrades silently when the DB is unavailable", async () => {
    mockInitDB.mockRejectedValue(new Error("vault locked"));
    const { result } = renderHook(() => useFreeTierUsage());
    await new Promise((r) => setTimeout(r, 10));
    expect(result.current.count).toBeUndefined();
    expect(result.current.isFree).toBe(false);
  });
});
