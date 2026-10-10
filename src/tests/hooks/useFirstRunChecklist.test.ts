import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const mockInitDB = vi.fn();
const mockSecurityState = { isLocked: false };

vi.mock("../../db/database", () => ({ initDB: mockInitDB }));
vi.mock("../../hooks/useSecurityStore", () => ({
  useSecurityStore: (sel: (s: unknown) => unknown) => sel(mockSecurityState),
}));

const {
  useFirstRunChecklist,
  markFirstRunSearchTried,
  FIRST_RUN_PROGRESS_EVENT,
} = await import("../../hooks/useFirstRunChecklist");
const { STORAGE_KEYS } = await import("../../constants/storage-keys");

/** Minimal DB stub whose two counts answer with the given numbers. */
function makeDb(bookmarks: number, documents: number) {
  const bookmarkCount = vi.fn(() => ({
    exec: vi.fn().mockResolvedValue(bookmarks),
  }));
  const documentCount = vi.fn(() => ({
    exec: vi.fn().mockResolvedValue(documents),
  }));
  return {
    db: {
      bookmarks: { count: bookmarkCount },
      documents: { count: documentCount },
    },
    bookmarkCount,
    documentCount,
  };
}

describe("useFirstRunChecklist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockSecurityState.isLocked = false;
  });

  it("counts non-deleted bookmarks and documents", async () => {
    const { db, bookmarkCount, documentCount } = makeDb(3, 5);
    mockInitDB.mockResolvedValue(db);

    const { result } = renderHook(() => useFirstRunChecklist());

    await waitFor(() => expect(result.current.bookmarkCount).toBe(3));
    expect(result.current.documentCount).toBe(5);
    expect(bookmarkCount).toHaveBeenCalledWith({
      selector: { isDeleted: false },
    });
    expect(documentCount).toHaveBeenCalledWith({
      selector: { isDeleted: false },
    });
  });

  it("reads the persisted search and dismissal flags on mount", async () => {
    localStorage.setItem(STORAGE_KEYS.FIRST_RUN_SEARCH_TRIED, "1");
    localStorage.setItem(STORAGE_KEYS.FIRST_RUN_CHECKLIST_DISMISSED, "true");
    const { db } = makeDb(0, 0);
    mockInitDB.mockResolvedValue(db);

    const { result } = renderHook(() => useFirstRunChecklist());

    expect(result.current.searchTried).toBe(true);
    expect(result.current.dismissed).toBe(true);
  });

  it("stays idle while the vault is locked", async () => {
    mockSecurityState.isLocked = true;
    const { db } = makeDb(1, 1);
    mockInitDB.mockResolvedValue(db);

    const { result } = renderHook(() => useFirstRunChecklist());
    await new Promise((r) => setTimeout(r, 10));

    expect(mockInitDB).not.toHaveBeenCalled();
    expect(result.current.bookmarkCount).toBeUndefined();
    expect(result.current.documentCount).toBeUndefined();
  });

  it("keeps the loading state when the DB is unavailable", async () => {
    mockInitDB.mockRejectedValue(new Error("vault locked"));

    const { result } = renderHook(() => useFirstRunChecklist());
    await new Promise((r) => setTimeout(r, 10));

    expect(result.current.bookmarkCount).toBeUndefined();
    expect(result.current.documentCount).toBeUndefined();
  });

  it("dismiss persists and flips the flag immediately", async () => {
    const { db } = makeDb(0, 0);
    mockInitDB.mockResolvedValue(db);

    const { result } = renderHook(() => useFirstRunChecklist());
    expect(result.current.dismissed).toBe(false);

    act(() => {
      result.current.dismiss();
    });

    expect(result.current.dismissed).toBe(true);
    expect(localStorage.getItem(STORAGE_KEYS.FIRST_RUN_CHECKLIST_DISMISSED)).toBe(
      "true",
    );
  });

  it("markFirstRunSearchTried records the flag and notifies mounted hooks", async () => {
    const { db } = makeDb(1, 1);
    mockInitDB.mockResolvedValue(db);

    const { result } = renderHook(() => useFirstRunChecklist());
    expect(result.current.searchTried).toBe(false);

    const listener = vi.fn();
    window.addEventListener(FIRST_RUN_PROGRESS_EVENT, listener);

    act(() => {
      markFirstRunSearchTried();
    });

    expect(listener).toHaveBeenCalled();
    expect(result.current.searchTried).toBe(true);
    expect(localStorage.getItem(STORAGE_KEYS.FIRST_RUN_SEARCH_TRIED)).toBe("1");

    window.removeEventListener(FIRST_RUN_PROGRESS_EVENT, listener);
  });

  it("degrades to the unset flags when storage is unreadable", async () => {
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("storage blocked");
      });
    const { db } = makeDb(0, 0);
    mockInitDB.mockResolvedValue(db);

    const { result } = renderHook(() => useFirstRunChecklist());
    await new Promise((r) => setTimeout(r, 10));

    expect(result.current.searchTried).toBe(false);
    expect(result.current.dismissed).toBe(false);

    getItem.mockRestore();
  });
});
