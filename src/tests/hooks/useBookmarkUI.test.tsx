import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useBookmarkUI } from "../../hooks/useBookmarkUI";

let lockCb: (() => void) | null = null;

vi.mock("../../services/SecurityVault", () => ({
  securityVault: {
    onLock: vi.fn((cb: () => void) => {
      lockCb = cb;
      return () => {
        lockCb = null;
      };
    }),
    onUnlock: vi.fn(() => () => {}),
  },
}));

describe("useBookmarkUI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lockCb = null;
  });

  it("initializes with default state", () => {
    const { result } = renderHook(() => useBookmarkUI());

    expect(result.current.viewingContent).toBeNull();
    expect(result.current.sharingBookmark).toBeNull();
    expect(result.current.shareEmail).toBe("");
    expect(result.current.showApiSettings).toBe(false);
    expect(result.current.apiKeyInput).toBe("");
    expect(result.current.providerInfo.provider).toBe("unknown");
    expect(result.current.providerInfo.isConfigured).toBe(false);
  });

  it("handleViewContent sets the viewed bookmark", async () => {
    const { result } = renderHook(() => useBookmarkUI());
    const bookmark = {
      id: "1",
      title: "Test",
      url: "https://example.com",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tags: [],
    } as any;

    await act(async () => {
      result.current.handleViewContent(bookmark);
    });

    expect(result.current.viewingContent).toEqual(bookmark);
  });

  it("setters update their respective state", async () => {
    const { result } = renderHook(() => useBookmarkUI());
    const bookmark = {
      id: "2",
      title: "Share",
      url: "https://share.example.com",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tags: [],
    } as any;

    await act(async () => {
      result.current.setSharingBookmark(bookmark);
      result.current.setShareEmail("user@example.com");
      result.current.setShowApiSettings(true);
      result.current.setApiKeyInput("sk-test");
      result.current.setProviderInfo({
        provider: "openai",
        model: "gpt-4",
        fullSupport: true,
        name: "OpenAI",
        availableModels: [],
        isConfigured: true,
      } as any);
    });

    expect(result.current.sharingBookmark).toEqual(bookmark);
    expect(result.current.shareEmail).toBe("user@example.com");
    expect(result.current.showApiSettings).toBe(true);
    expect(result.current.apiKeyInput).toBe("sk-test");
    expect(result.current.providerInfo.provider).toBe("openai");
    expect(result.current.providerInfo.isConfigured).toBe(true);
  });

  // ── Fusionado de src/tests/security/useBookmarkUI.test.tsx (reset flows) ──

  it("can open and clear the share modal", async () => {
    const { result } = renderHook(() => useBookmarkUI());
    const bm = {
      id: "b7",
      title: "X",
      url: "https://x.com",
      tags: [],
    } as any;

    await act(async () => {
      result.current.setSharingBookmark(bm);
    });
    expect(result.current.sharingBookmark).toBe(bm);

    await act(async () => {
      result.current.setSharingBookmark(null);
    });
    expect(result.current.sharingBookmark).toBeNull();
  });

  it("toggles API settings modal open and closed", async () => {
    const { result } = renderHook(() => useBookmarkUI());

    await act(async () => {
      result.current.setShowApiSettings(true);
    });
    expect(result.current.showApiSettings).toBe(true);

    await act(async () => {
      result.current.setShowApiSettings(false);
    });
    expect(result.current.showApiSettings).toBe(false);
  });

  it("updates api key input and provider info independently", async () => {
    const { result } = renderHook(() => useBookmarkUI());

    await act(async () => {
      result.current.setApiKeyInput("sk-test");
    });
    expect(result.current.apiKeyInput).toBe("sk-test");

    await act(async () => {
      result.current.setProviderInfo({
        provider: "openai",
        model: "gpt-4",
        fullSupport: true,
        name: "OpenAI",
        availableModels: ["gpt-4"],
        isConfigured: true,
      } as any);
    });
    expect(result.current.providerInfo.provider).toBe("openai");
    expect(result.current.providerInfo.isConfigured).toBe(true);
  });

  it("subscribes to onLock and purges apiKeyInput when the vault locks", async () => {
    const { result } = renderHook(() => useBookmarkUI());

    await act(async () => {
      result.current.setApiKeyInput("sk-secret-123");
    });
    expect(result.current.apiKeyInput).toBe("sk-secret-123");

    // Lock del vault → la key descifrada en estado React se purga.
    expect(lockCb).not.toBeNull();
    act(() => {
      lockCb?.();
    });

    expect(result.current.apiKeyInput).toBe("");
  });
});
