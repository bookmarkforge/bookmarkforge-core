import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const mockInitDB = vi.fn();
const mockToast = { success: vi.fn(), error: vi.fn() };

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

  it("reports the free-tier wall instead of staying silent when the save hits the 2,500 limit", async () => {
    // The preInsert wall throws LicenseError("FREE_LIMIT_REACHED") — this
    // used to fall into INTENTIONAL SILENCE (the worst UX in the app).
    const { LicenseError } = await import("../../services/LicenseService");
    const limitError = new LicenseError(
      "Free plan is limited to 2500 bookmarks. Upgrade to Pro for unlimited bookmarks.",
      "FREE_LIMIT_REACHED",
    );
    mockInitDB.mockResolvedValue({
      bookmarks: {
        insert: vi.fn().mockRejectedValue(limitError),
      },
    });
    // Options-aware t: interpolates {{limit}}.
    const t = (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${JSON.stringify(opts)}` : key;

    renderHook(() =>
      useClipperSync(
        {
          type: "clipper-add",
          data: { title: "Blocked Page", url: "https://blocked.com" },
        },
        t,
        vi.fn(),
        vi.fn(),
      ),
    );

    await vi.waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith(
        expect.stringContaining("app_freeLimitToast"),
        expect.objectContaining({ id: "free-limit", duration: 4000 }),
      );
    });
    // The suite's t() mock returns "key:{opts}" — asserting the interpolated
    // limit validates the {{limit}} substitution end-to-end.
    expect(mockToast.error).toHaveBeenCalledWith(
      expect.stringContaining("2500"),
      expect.anything(),
    );
    expect(mockToast.success).not.toHaveBeenCalled();
  });

  it("shows a user-visible message for non-limit clipper failures", async () => {
    mockInitDB.mockRejectedValue(new Error("quota exceeded"));
    renderHook(() =>
      useClipperSync(
        {
          type: "clipper-add",
          data: { title: "X", url: "https://x.com" },
        },
        (s: string) => s,
        vi.fn(),
        vi.fn(),
      ),
    );
    await new Promise((r) => setTimeout(r, 20));
    await vi.waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith("app_captureError");
    });
    expect(mockToast.success).not.toHaveBeenCalled();
  });
});
