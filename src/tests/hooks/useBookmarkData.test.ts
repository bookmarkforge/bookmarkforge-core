import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { Subject } from "rxjs";

let subject: Subject<unknown>;

const mockFind = vi.fn();

vi.mock("../../db/database", () => ({
  initDB: vi.fn().mockResolvedValue({
    bookmarks: { find: vi.fn() },
  }),
}));

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { initDB } from "../../db/database";
import { useBookmarkData } from "../../hooks/useBookmarkData";

describe("useBookmarkData", () => {
  beforeEach(() => {
    subject = new Subject();
    vi.clearAllMocks();
    mockFind.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        $: { subscribe: (handlers: any) => subject.subscribe(handlers) },
      }),
    });
    (initDB as ReturnType<typeof vi.fn>).mockResolvedValue({
      bookmarks: { find: mockFind },
    });
  });

  it("starts in loading state with no bookmarks", () => {
    const { result } = renderHook(() => useBookmarkData());
    expect(result.current.isLoading).toBe(true);
    expect(result.current.bookmarks).toEqual([]);
  });

  it("updates bookmarks when DB emits data", async () => {
    const { result } = renderHook(() => useBookmarkData());
    await vi.waitFor(() => expect(mockFind).toHaveBeenCalled());

    vi.useFakeTimers();
    try {
      await act(async () => {
        subject.next([{ id: "1", title: "Test", url: "https://test.com" }]);
        await vi.advanceTimersByTimeAsync(100);
      });
    } finally {
      vi.useRealTimers();
    }

    expect(result.current.bookmarks).toHaveLength(1);
    expect(result.current.bookmarks[0]!.title).toBe("Test");
    expect(result.current.isLoading).toBe(false);
  });

  it("filters out deleted bookmarks via selector", async () => {
    const { result } = renderHook(() => useBookmarkData());
    await vi.waitFor(() => expect(mockFind).toHaveBeenCalled());
    expect(mockFind).toHaveBeenCalledWith(
      expect.objectContaining({
        selector: { isDeleted: { $ne: true } },
      }),
    );
  });

  it("discards buffered data when the debounce fires after unmount", async () => {
    const { result, unmount } = renderHook(() => useBookmarkData());
    await vi.waitFor(() => expect(mockFind).toHaveBeenCalled());

    vi.useFakeTimers();
    try {
      await act(async () => {
        subject.next([{ id: "1", title: "Late", url: "https://test.com" }]);
      });
      unmount();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(result.current.bookmarks).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("unsubscribes from DB on unmount", async () => {
    const unsubscribeMock = vi.fn();
    mockFind.mockReturnValueOnce({
      sort: vi.fn().mockReturnValue({
        $: { subscribe: vi.fn(() => ({ unsubscribe: unsubscribeMock })) },
      }),
    });
    const { unmount } = renderHook(() => useBookmarkData());
    await vi.waitFor(() => expect(mockFind).toHaveBeenCalled());
    unmount();
    expect(unsubscribeMock).toHaveBeenCalled();
  });

  it("sets isLoading false on subscription error", async () => {
    const { result } = renderHook(() => useBookmarkData());
    await vi.waitFor(() => expect(mockFind).toHaveBeenCalled());
    act(() => {
      subject.error(new Error("boom"));
    });
    await vi.waitFor(() => expect(result.current.isLoading).toBe(false));
  });

  it("stops loading after subscription timeout when no data arrives", async () => {
    // initDB resolves but the subscription never emits → the 5 s
    // guard should fire and clear the loading state.
    const mockSub = { unsubscribe: vi.fn() };
    const mockFind = {
      sort: vi.fn().mockReturnThis(),
      $: { subscribe: vi.fn().mockImplementation(() => mockSub) },
    };
    (initDB as ReturnType<typeof vi.fn>).mockResolvedValue({
      bookmarks: { find: vi.fn().mockReturnValue(mockFind) },
    });

    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useBookmarkData());
      // initDB resolves immediately; subscription never emits.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_100);
      });
      expect(result.current.isLoading).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
