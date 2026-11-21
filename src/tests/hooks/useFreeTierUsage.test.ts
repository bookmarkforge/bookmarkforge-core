import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { BehaviorSubject } from "rxjs";

const mockInitDB = vi.fn();
const mockHasProAccess = vi.fn(() => false);
const mockCanAddBookmarks = vi.fn(async (count: number) => count < 300);
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

/** Reactive count$ mock: a real BehaviorSubject so combineLatest accepts it. */
function makeCountQuery(initial: number) {
  const subject = new BehaviorSubject(initial);
  const count = vi.fn(() => ({ $: subject }));
  return {
    count,
    emit: (n: number) => subject.next(n),
  };
}

/** DB mock with both counted collections (each has its own ceiling). */
function makeDb(bookmarks: number, documents = 0) {
  return {
    bookmarks: makeCountQuery(bookmarks),
    documents: makeCountQuery(documents),
  };
}

describe("useFreeTierUsage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSecurityState.isLocked = false;
    mockHasProAccess.mockReturnValue(false);
    // Keep the wall relative to the live limit so a FREE_LIMITS change
    // cannot silently invalidate these expectations again.
    mockCanAddBookmarks.mockImplementation(
      async (count: number) => count < FREE_LIMITS.maxBookmarks,
    );
  });

  it("subscribes with the same { isDeleted: false } selector on both collections the walls count", async () => {
    const db = makeDb(30, 12);
    mockInitDB.mockResolvedValue(db);
    const { result } = renderHook(() => useFreeTierUsage());
    // The meter reports the fullest collection — here bookmarks (30 > 12).
    await waitFor(() => expect(result.current.count).toBe(30));
    expect(db.bookmarks.count).toHaveBeenCalledWith({ selector: { isDeleted: false } });
    expect(db.documents.count).toHaveBeenCalledWith({ selector: { isDeleted: false } });
    expect(result.current.isFree).toBe(true);
    expect(result.current.limit).toBe(FREE_LIMITS.maxBookmarks);
    expect(result.current.canAddBookmark).toBe(true);
    expect(mockCanAddBookmarks).toHaveBeenCalledWith(30);
  });

  it("each collection has its own wall — documents at the cap while bookmarks have room", async () => {
    const db = makeDb(10, FREE_LIMITS.maxBookmarks);
    mockInitDB.mockResolvedValue(db);
    const { result } = renderHook(() => useFreeTierUsage());
    await waitFor(() => expect(result.current.count).toBe(FREE_LIMITS.maxBookmarks));
    await waitFor(() => expect(result.current.atWall).toBe(true));
    // Bookmark saves still fit — the capture hint must not claim otherwise.
    expect(result.current.canAddBookmark).toBe(true);
    expect(mockCanAddBookmarks).toHaveBeenLastCalledWith(10);
  });

  it("bookmarks at the cap block canAddBookmark even with empty documents", async () => {
    const db = makeDb(FREE_LIMITS.maxBookmarks, 0);
    mockInitDB.mockResolvedValue(db);
    const { result } = renderHook(() => useFreeTierUsage());
    await waitFor(() => expect(result.current.atWall).toBe(true));
    expect(result.current.canAddBookmark).toBe(false);
    expect(mockCanAddBookmarks).toHaveBeenLastCalledWith(FREE_LIMITS.maxBookmarks);
  });

  it("flags nearWall at ≥90% and atWall at the limit", async () => {
    const belowWall = Math.floor(FREE_LIMITS.maxBookmarks * 0.9) - 1;
    const db = makeDb(belowWall);
    mockInitDB.mockResolvedValue(db);
    const { result } = renderHook(() => useFreeTierUsage());
    await waitFor(() => expect(result.current.count).toBe(belowWall));
    expect(result.current.nearWall).toBe(false);

    db.bookmarks.emit(Math.floor(FREE_LIMITS.maxBookmarks * 0.9));
    await waitFor(() => expect(result.current.nearWall).toBe(true));
    expect(result.current.atWall).toBe(false);

    db.bookmarks.emit(FREE_LIMITS.maxBookmarks);
    await waitFor(() => expect(result.current.atWall).toBe(true));
    expect(result.current.canAddBookmark).toBe(false);
    expect(mockCanAddBookmarks).toHaveBeenLastCalledWith(FREE_LIMITS.maxBookmarks);
  });

  it("is a no-op for Pro users — the nudge must not exist for them", async () => {
    mockHasProAccess.mockReturnValue(true);
    const db = makeDb(5000);
    mockInitDB.mockResolvedValue(db);
    const { result } = renderHook(() => useFreeTierUsage());
    await new Promise((r) => setTimeout(r, 10));
    expect(db.bookmarks.count).not.toHaveBeenCalled();
    expect(db.documents.count).not.toHaveBeenCalled();
    expect(result.current.count).toBeUndefined();
    expect(result.current.isFree).toBe(false);
  });

  it("stays quiet while the vault is locked", async () => {
    mockSecurityState.isLocked = true;
    const db = makeDb(100);
    mockInitDB.mockResolvedValue(db);
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
