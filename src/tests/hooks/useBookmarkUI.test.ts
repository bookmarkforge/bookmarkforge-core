import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useBookmarkUI } from "../../hooks/useBookmarkUI";
import { securityVault } from "../../services/SecurityVault";

vi.mock("../../services/SecurityVault", () => ({
  securityVault: {
    onLock: vi.fn(() => vi.fn()),
    // bmf/no-securityvault-mock-without-lock: the lock/unlock lifecycle must
    // be mocked symmetrically, or a hook that subscribes to both silently
    // loses its unlock path in the test.
    onUnlock: vi.fn(() => () => {}),
  },
}));

describe("useBookmarkUI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("initializes with default state", () => {
    const { result } = renderHook(() => useBookmarkUI());

    expect(result.current.viewingContent).toBeNull();
    expect(result.current.sharingBookmark).toBeNull();
    expect(result.current.shareEmail).toBe("");
    expect(result.current.showApiSettings).toBe(false);
    expect(result.current.apiKeyInput).toBe("");
    expect(result.current.providerInfo).toEqual({
      provider: "unknown",
      model: "",
      fullSupport: false,
      name: "",
      availableModels: [],
      isConfigured: false,
    });
  });

  it("allows setting viewing content", () => {
    const { result } = renderHook(() => useBookmarkUI());
    const bookmark = { id: "1", url: "https://example.com", title: "Test" } as any;

    act(() => {
      result.current.setViewingContent(bookmark);
    });

    expect(result.current.viewingContent).toBe(bookmark);
  });

  it("allows setting sharing bookmark", () => {
    const { result } = renderHook(() => useBookmarkUI());
    const bookmark = { id: "1", url: "https://example.com", title: "Test" } as any;

    act(() => {
      result.current.setSharingBookmark(bookmark);
    });

    expect(result.current.sharingBookmark).toBe(bookmark);
  });

  it("allows setting share email", () => {
    const { result } = renderHook(() => useBookmarkUI());

    act(() => {
      result.current.setShareEmail("test@example.com");
    });

    expect(result.current.shareEmail).toBe("test@example.com");
  });

  it("allows toggling API settings modal", () => {
    const { result } = renderHook(() => useBookmarkUI());

    act(() => {
      result.current.setShowApiSettings(true);
    });

    expect(result.current.showApiSettings).toBe(true);

    act(() => {
      result.current.setShowApiSettings(false);
    });

    expect(result.current.showApiSettings).toBe(false);
  });

  it("allows setting API key input", () => {
    const { result } = renderHook(() => useBookmarkUI());

    act(() => {
      result.current.setApiKeyInput("test-api-key");
    });

    expect(result.current.apiKeyInput).toBe("test-api-key");
  });

  it("allows setting provider info", () => {
    const { result } = renderHook(() => useBookmarkUI());
    const providerInfo = {
      provider: "openai" as const,
      model: "gpt-4",
      fullSupport: true,
      name: "OpenAI",
      availableModels: ["gpt-4", "gpt-3.5"],
      isConfigured: true,
    };

    act(() => {
      result.current.setProviderInfo(providerInfo);
    });

    expect(result.current.providerInfo).toEqual(providerInfo);
  });

  it("handleViewContent sets viewing content", () => {
    const { result } = renderHook(() => useBookmarkUI());
    const bookmark = { id: "1", url: "https://example.com", title: "Test" } as any;

    act(() => {
      result.current.handleViewContent(bookmark);
    });

    expect(result.current.viewingContent).toBe(bookmark);
  });

  it("clears API key input on vault lock", () => {
    let onLockCallback: (() => void) | null = null;
    (securityVault.onLock as any).mockImplementation((callback: () => void) => {
      onLockCallback = callback;
      return vi.fn();
    });

    const { result } = renderHook(() => useBookmarkUI());

    act(() => {
      result.current.setApiKeyInput("sensitive-key");
    });

    expect(result.current.apiKeyInput).toBe("sensitive-key");

    act(() => {
      onLockCallback?.();
    });

    expect(result.current.apiKeyInput).toBe("");
  });

  it("registers vault lock listener on mount", () => {
    renderHook(() => useBookmarkUI());

    expect(securityVault.onLock).toHaveBeenCalled();
  });
});
