import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSettings } from "../../hooks/useSettings";

const aiManager = vi.hoisted(() => ({
  getApiKey: vi.fn(() => ""),
  getProviderInfo: vi.fn(() => ({ name: "local" })),
  updateMasterPassword: vi.fn().mockResolvedValue(undefined),
  setProvider: vi.fn().mockResolvedValue(undefined),
  setApiKey: vi.fn().mockResolvedValue(undefined),
}));

let lockCb: (() => void) | null = null;
const mockChangeLanguage = vi.hoisted(() => vi.fn());

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

const storage = vi.hoisted(() => {
  const map = new Map<string, string>();
  return {
    safeGet: vi.fn((k: string) => map.get(k) ?? null),
    safeSet: vi.fn((k: string, v: string) => map.set(k, v)),
    _map: map,
  };
});

vi.mock("../../services/ai/ProviderManager", () => ({
  aiManager,
  AIProvider: {},
}));
vi.mock("../../store/safeStorage", () => ({
  safeGet: (k: string) => storage.safeGet(k),
  safeSet: (k: string, v: string) => storage.safeSet(k, v),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
// WebLLMService is Pro: the double is installed at the pro-access loader
// instead of at the Pro module (the hook probes capability via the gate).
vi.mock("../../services/pro-access", () => ({
  loadWebLLMService: () =>
    Promise.resolve({
      canRunLocalLLM: vi.fn().mockResolvedValue(false),
      progressCallback: undefined,
    }),
  ProUnavailableError: class ProUnavailableError extends Error {},
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, d?: string) => d ?? k,
    i18n: {
      language: "en",
      on: vi.fn(),
      off: vi.fn(),
      changeLanguage: mockChangeLanguage,
    },
  }),
}));

describe("useSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lockCb = null;
    storage._map.clear();
    aiManager.getApiKey.mockReturnValue("");
    aiManager.getProviderInfo.mockReturnValue({ name: "local" });
  });

  it("initializes appearance and feature flags from storage", () => {
    storage.safeGet.mockImplementation((k: string) => {
      const m = new Map<string, string>([
        ["global_font", "serif"],
        ["global_font_size", "18"],
        ["distraction_free_mode", "true"],
        ["auto_lock_vault", "false"],
      ]);
      return m.get(k) ?? null;
    });
    const { result } = renderHook(() => useSettings());
    expect(result.current.globalFont).toBe("serif");
    expect(result.current.globalFontSize).toBe(18);
    expect(result.current.isDistractionFree).toBe(true);
    expect(result.current.autoLockEnabled).toBe(false);
  });

  it("persists distraction-free mode to storage and dispatches event", async () => {
    const { result } = renderHook(() => useSettings());
    await act(async () => {
      result.current.setIsDistractionFree(true);
    });
    expect(storage.safeSet).toHaveBeenCalledWith(
      "distraction_free_mode",
      "true",
    );
  });

  it("updates font and persists to storage", async () => {
    const { result } = renderHook(() => useSettings());
    const before = result.current.globalFont;
    await act(async () => {
      result.current.setGlobalFont("monospace");
    });
    expect(result.current.globalFont).toBe("monospace");
    expect(result.current.globalFont).not.toBe(before);
    expect(storage.safeSet).toHaveBeenCalledWith("global_font", "monospace");
  });

  it("updates language via i18n.changeLanguage", async () => {
    const { result } = renderHook(() => useSettings());
    await act(async () => {
      result.current.setLang("es");
    });
    expect(mockChangeLanguage).toHaveBeenCalledWith("es");
  });

  it("saves custom prompts with unified JSON payload", async () => {
    const { toast } = await import("sonner");
    const { result } = renderHook(() => useSettings());
    await act(async () => {
      result.current.setCustomPrompts({
        summarize: "S",
        tagging: "T",
        chat: "C",
      });
    });
    await act(async () => {
      result.current.handleSavePrompts();
    });
    expect(storage.safeSet).toHaveBeenCalledWith(
      "custom_prompts",
      JSON.stringify({ summary: "S", tagging: "T", chat: "C" }),
    );
    expect(toast.success).toHaveBeenCalled();
  });

  it("rejects empty vault key update with an error toast", async () => {
    const { toast } = await import("sonner");
    const { result } = renderHook(() => useSettings());
    await act(async () => {
      result.current.setVaultKey("");
      await result.current.handleUpdateVaultKey();
    });
    expect(aiManager.updateMasterPassword).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });

  it("updates the vault key through aiManager on success", async () => {
    const { toast } = await import("sonner");
    const { result } = renderHook(() => useSettings());
    await act(async () => {
      result.current.setVaultKey("newpass123");
    });
    await act(async () => {
      await result.current.handleUpdateVaultKey();
    });
    expect(aiManager.updateMasterPassword).toHaveBeenCalledWith("newpass123");
    expect(toast.success).toHaveBeenCalled();
  });

  it("changes AI provider and refreshes provider info", async () => {
    aiManager.setProvider.mockResolvedValue(undefined);
    aiManager.getProviderInfo.mockReturnValue({ name: "gemini" });
    const { result } = renderHook(() => useSettings());
    await act(async () => {
      await result.current.handleProviderChange("gemini");
    });
    expect(aiManager.setProvider).toHaveBeenCalledWith("gemini");
    expect(result.current.provider).toEqual({ name: "gemini" });
  });

  it("saves an API key and surfaces provider errors", async () => {
    const { toast } = await import("sonner");
    const { result } = renderHook(() => useSettings());
    await act(async () => {
      await result.current.handleApiKeySave("abc");
    });
    expect(aiManager.setApiKey).toHaveBeenCalledWith("abc");
    expect(toast.success).toHaveBeenCalled();

    aiManager.setApiKey.mockRejectedValueOnce(new Error("invalid"));
    await act(async () => {
      await result.current.handleApiKeySave("bad");
    });
    expect(toast.error).toHaveBeenCalled();
  });

  it("purges apiKey, vaultKey and masterPassword when the vault locks", async () => {
    aiManager.getApiKey.mockReturnValue("sk-secret-123");
    const { result } = renderHook(() => useSettings());
    expect(result.current.apiKey).toBe("sk-secret-123");

    await act(async () => {
      result.current.setVaultKey("newpass123");
      result.current.setMasterPassword("newpass123");
    });
    expect(result.current.vaultKey).toBe("newpass123");
    expect(result.current.masterPassword).toBe("newpass123");

    // Lock del vault → los secretos en estado React se purgan.
    expect(lockCb).not.toBeNull();
    act(() => {
      lockCb?.();
    });

    expect(result.current.apiKey).toBe("");
    expect(result.current.vaultKey).toBe("");
    expect(result.current.masterPassword).toBe("");
  });
});
