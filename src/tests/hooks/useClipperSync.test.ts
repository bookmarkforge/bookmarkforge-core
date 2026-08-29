import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const mockInitDB = vi.fn();
const mockToast = { success: vi.fn() };

vi.mock("../../utils/id", () => ({ generateId: () => "mock-uuid-123" }));
vi.mock("../../db/database", () => ({ initDB: mockInitDB }));
vi.mock("sonner", () => ({ toast: mockToast }));

describe("useClipperSync", () => {
  let useClipperSync: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../../hooks/useClipperSync");
    useClipperSync = mod.useClipperSync;
  });

  it("should insert bookmark for clipper-add message", async () => {
    const insertMock = vi.fn();
    mockInitDB.mockResolvedValue({ bookmarks: { insert: insertMock } });

    const t = (s: string) => s;
    renderHook(() =>
      useClipperSync(
        {
          type: "clipper-add",
          data: { title: "Test Page", url: "https://test.com" },
        },
        t,
        vi.fn(),
        vi.fn(),
      ),
    );

    await vi.waitFor(() => {
      expect(insertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "mock-uuid-123",
          title: "Test Page",
          url: "https://test.com",
          summary: "clippedFromWeb",
          tags: ["clipped"],
        }),
      );
    });
    expect(mockToast.success).toHaveBeenCalled();
  });

  it("should do nothing for non-clipper messages", () => {
    renderHook(() =>
      useClipperSync(
        { type: "other", data: {} },
        (s: string) => s,
        vi.fn(),
        vi.fn(),
      ),
    );
    expect(mockInitDB).not.toHaveBeenCalled();
  });

  it("should do nothing for null messages", () => {
    renderHook(() => useClipperSync(null, (s: string) => s, vi.fn(), vi.fn()));
    expect(mockInitDB).not.toHaveBeenCalled();
  });
});
