import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const mockNavigate = vi.fn();
const mockLogger = { warn: vi.fn() };
let mockLocation: any;

vi.mock("react-router", () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => mockLocation,
}));
vi.mock("../../utils/logger", () => ({ logger: mockLogger }));

describe("useTabManager", () => {
  let useTabManager: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    localStorage.clear();
    mockLocation = { pathname: "/" };
    const mod = await import("../../hooks/useTabManager");
    useTabManager = mod.useTabManager;
  });

  it("should return dashboard for root path", () => {
    const { result } = renderHook(() => useTabManager());
    expect(result.current.activeTab).toBe("dashboard");
  });

  it("should return dashboard for /app (P74 canonical entry)", () => {
    mockLocation = { pathname: "/app" };
    const { result } = renderHook(() => useTabManager());
    expect(result.current.activeTab).toBe("dashboard");
  });

  it("should return correct tab from path", () => {
    mockLocation = { pathname: "/documents" };
    const { result } = renderHook(() => useTabManager());
    expect(result.current.activeTab).toBe("documents");
  });

  it("setActiveTab should navigate to /app for dashboard (P74)", () => {
    const { result } = renderHook(() => useTabManager());
    act(() => result.current.setActiveTab("dashboard"));
    expect(mockNavigate).toHaveBeenCalledWith("/app");
  });

  it("setActiveTab should navigate to /tab for other tabs", () => {
    const { result } = renderHook(() => useTabManager());
    act(() => result.current.setActiveTab("bookmarks"));
    expect(mockNavigate).toHaveBeenCalledWith("/bookmarks");
  });

  it("setActiveTab should warn on invalid tab", () => {
    const { result } = renderHook(() => useTabManager());
    act(() => result.current.setActiveTab(""));
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it("currentDocId should default from localStorage", () => {
    localStorage.setItem("bookmarkforge_current_doc_id", "custom-doc");
    const { result } = renderHook(() => useTabManager());
    expect(result.current.currentDocId).toBe("custom-doc");
  });

  it("setCurrentDocId should persist to localStorage", () => {
    const { result } = renderHook(() => useTabManager());
    act(() => result.current.setCurrentDocId("new-doc"));
    expect(result.current.currentDocId).toBe("new-doc");
    expect(localStorage.getItem("bookmarkforge_current_doc_id")).toBe(
      "new-doc",
    );
  });

  it("setCurrentDocId should warn on invalid id", () => {
    const { result } = renderHook(() => useTabManager());
    act(() => result.current.setCurrentDocId(""));
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it("should sync docId on storage event", () => {
    const { result } = renderHook(() => useTabManager());
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "bookmarkforge_current_doc_id",
          newValue: "synced-doc",
        }),
      );
    });
    expect(result.current.currentDocId).toBe("synced-doc");
  });
});
