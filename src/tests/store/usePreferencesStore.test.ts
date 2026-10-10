// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

describe("usePreferencesStore", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("initial state has default values", async () => {
    const { usePreferencesStore } =
      await import("../../store/usePreferencesStore");
    const state = usePreferencesStore.getState();
    expect(state.theme).toBe("system");
    expect(state.language).toBe("en");
    expect(state.globalFont).toBe("Inter");
    expect(state.globalFontSize).toBe(14);
    expect(state.compactMode).toBe(false);
    expect(state.distractionFreeMode).toBe(false);
    expect(state.sidebarCollapsed).toBe(false);
    expect(state.autoSave).toBe(true);
    expect(state.autoSaveInterval).toBe(30000);
    expect(state.autoLockVault).toBe(true);
    expect(state.customPromptsSummarize).toBe("");
    expect(state.customPromptsTagging).toBe("");
    expect(state.customPromptsChat).toBe("");
    expect(state.customPromptsUnified).toBe("");
  });

  describe("setters", () => {
    it("setTheme updates theme", async () => {
      const { usePreferencesStore } =
        await import("../../store/usePreferencesStore");
      usePreferencesStore.getState().setTheme("dark");
      expect(usePreferencesStore.getState().theme).toBe("dark");
    });

    it("setGlobalFont updates font", async () => {
      const { usePreferencesStore } =
        await import("../../store/usePreferencesStore");
      usePreferencesStore.getState().setGlobalFont("Roboto");
      expect(usePreferencesStore.getState().globalFont).toBe("Roboto");
    });

    it("setGlobalFontSize updates size", async () => {
      const { usePreferencesStore } =
        await import("../../store/usePreferencesStore");
      usePreferencesStore.getState().setGlobalFontSize(16);
      expect(usePreferencesStore.getState().globalFontSize).toBe(16);
    });

    it("setCompactMode updates compact mode", async () => {
      const { usePreferencesStore } =
        await import("../../store/usePreferencesStore");
      usePreferencesStore.getState().setCompactMode(true);
      expect(usePreferencesStore.getState().compactMode).toBe(true);
    });

    it("setDistractionFreeMode updates distraction free mode", async () => {
      const { usePreferencesStore } =
        await import("../../store/usePreferencesStore");
      usePreferencesStore.getState().setDistractionFreeMode(true);
      expect(usePreferencesStore.getState().distractionFreeMode).toBe(true);
    });

    it("setSidebarCollapsed updates sidebar collapsed", async () => {
      const { usePreferencesStore } =
        await import("../../store/usePreferencesStore");
      usePreferencesStore.getState().setSidebarCollapsed(true);
      expect(usePreferencesStore.getState().sidebarCollapsed).toBe(true);
    });

    it("setLanguage updates language", async () => {
      const { usePreferencesStore } =
        await import("../../store/usePreferencesStore");
      usePreferencesStore.getState().setLanguage("es");
      expect(usePreferencesStore.getState().language).toBe("es");
    });

    it("setAutoSave updates auto save", async () => {
      const { usePreferencesStore } =
        await import("../../store/usePreferencesStore");
      usePreferencesStore.getState().setAutoSave(false);
      expect(usePreferencesStore.getState().autoSave).toBe(false);
    });

    it("setAutoSaveInterval updates interval", async () => {
      const { usePreferencesStore } =
        await import("../../store/usePreferencesStore");
      usePreferencesStore.getState().setAutoSaveInterval(60000);
      expect(usePreferencesStore.getState().autoSaveInterval).toBe(60000);
    });

    it("setAutoLockVault updates auto lock vault", async () => {
      const { usePreferencesStore } =
        await import("../../store/usePreferencesStore");
      usePreferencesStore.getState().setAutoLockVault(false);
      expect(usePreferencesStore.getState().autoLockVault).toBe(false);
    });

    it("setCustomPromptsSummarize updates summarize prompt", async () => {
      const { usePreferencesStore } =
        await import("../../store/usePreferencesStore");
      usePreferencesStore
        .getState()
        .setCustomPromptsSummarize("summarize this");
      expect(usePreferencesStore.getState().customPromptsSummarize).toBe(
        "summarize this",
      );
    });

    it("setCustomPromptsTagging updates tagging prompt", async () => {
      const { usePreferencesStore } =
        await import("../../store/usePreferencesStore");
      usePreferencesStore.getState().setCustomPromptsTagging("tag this");
      expect(usePreferencesStore.getState().customPromptsTagging).toBe(
        "tag this",
      );
    });

    it("setCustomPromptsChat updates chat prompt", async () => {
      const { usePreferencesStore } =
        await import("../../store/usePreferencesStore");
      usePreferencesStore.getState().setCustomPromptsChat("chat with me");
      expect(usePreferencesStore.getState().customPromptsChat).toBe(
        "chat with me",
      );
    });

    it("setCustomPromptsUnified updates unified prompt", async () => {
      const { usePreferencesStore } =
        await import("../../store/usePreferencesStore");
      usePreferencesStore.getState().setCustomPromptsUnified('{"key":"val"}');
      expect(usePreferencesStore.getState().customPromptsUnified).toBe(
        '{"key":"val"}',
      );
    });
  });

  describe("getItem — reading from legacy localStorage keys", () => {
    it("reads theme with 'dark' value", async () => {
      localStorage.setItem("bookmarkforge-theme", "dark");
      vi.resetModules();
      const { usePreferencesStore } =
        await import("../../store/usePreferencesStore");
      await vi.waitFor(() => {
        expect(usePreferencesStore.getState().theme).toBe("dark");
      });
    });

    it("falls back to default theme when key is missing", async () => {
      vi.resetModules();
      const { usePreferencesStore } =
        await import("../../store/usePreferencesStore");
      await vi.waitFor(() => {
        expect(usePreferencesStore.getState().theme).toBe("system");
      });
    });

    it("reads language from i18nextLng key", async () => {
      localStorage.setItem("i18nextLng", "fr");
      vi.resetModules();
      const { usePreferencesStore } =
        await import("../../store/usePreferencesStore");
      await vi.waitFor(() => {
        expect(usePreferencesStore.getState().language).toBe("fr");
      });
    });

    it("falls back to default language when key is missing", async () => {
      vi.resetModules();
      const { usePreferencesStore } =
        await import("../../store/usePreferencesStore");
      await vi.waitFor(() => {
        expect(usePreferencesStore.getState().language).toBe("en");
      });
    });

    it("reads globalFont from legacy key", async () => {
      localStorage.setItem("global_font", "Roboto");
      vi.resetModules();
      const { usePreferencesStore } =
        await import("../../store/usePreferencesStore");
      await vi.waitFor(() => {
        expect(usePreferencesStore.getState().globalFont).toBe("Roboto");
      });
    });

    it("falls back to default globalFont when key is missing", async () => {
      vi.resetModules();
      const { usePreferencesStore } =
        await import("../../store/usePreferencesStore");
      await vi.waitFor(() => {
        expect(usePreferencesStore.getState().globalFont).toBe("Inter");
      });
    });

    it("reads globalFontSize from legacy key", async () => {
      localStorage.setItem("global_font_size", "18");
      vi.resetModules();
      const { usePreferencesStore } =
        await import("../../store/usePreferencesStore");
      await vi.waitFor(() => {
        expect(usePreferencesStore.getState().globalFontSize).toBe(18);
      });
    });

    it("falls back to default globalFontSize when key is missing", async () => {
      vi.resetModules();
      const { usePreferencesStore } =
        await import("../../store/usePreferencesStore");
      await vi.waitFor(() => {
        expect(usePreferencesStore.getState().globalFontSize).toBe(14);
      });
    });

    it("falls back to default globalFontSize when NaN", async () => {
      localStorage.setItem("global_font_size", "abc");
      vi.resetModules();
      const { usePreferencesStore } =
        await import("../../store/usePreferencesStore");
      await vi.waitFor(() => {
        expect(usePreferencesStore.getState().globalFontSize).toBe(14);
      });
    });

    it("reads distractionFreeMode as true when 'true'", async () => {
      localStorage.setItem("distraction_free_mode", "true");
      vi.resetModules();
      const { usePreferencesStore } =
        await import("../../store/usePreferencesStore");
      await vi.waitFor(() => {
        expect(usePreferencesStore.getState().distractionFreeMode).toBe(true);
      });
    });

    it("reads distractionFreeMode as false when not 'true'", async () => {
      localStorage.setItem("distraction_free_mode", "false");
      vi.resetModules();
      const { usePreferencesStore } =
        await import("../../store/usePreferencesStore");
      await vi.waitFor(() => {
        expect(usePreferencesStore.getState().distractionFreeMode).toBe(false);
      });
    });

    it("autoLockVault defaults to true when key is missing (safeGet returns null)", async () => {
      vi.resetModules();
      const { usePreferencesStore } =
        await import("../../store/usePreferencesStore");
      await vi.waitFor(() => {
        expect(usePreferencesStore.getState().autoLockVault).toBe(true);
      });
    });

    it("autoLockVault is true when key is 'true'", async () => {
      localStorage.setItem("auto_lock_vault", "true");
      vi.resetModules();
      const { usePreferencesStore } =
        await import("../../store/usePreferencesStore");
      await vi.waitFor(() => {
        expect(usePreferencesStore.getState().autoLockVault).toBe(true);
      });
    });

    it("autoLockVault is false when key is 'false'", async () => {
      localStorage.setItem("auto_lock_vault", "false");
      vi.resetModules();
      const { usePreferencesStore } =
        await import("../../store/usePreferencesStore");
      await vi.waitFor(() => {
        expect(usePreferencesStore.getState().autoLockVault).toBe(false);
      });
    });

    it("autoLockVault falls back to default (true) on corrupt value '0' (L-04)", async () => {
      // Before L-04, any value !== "false" ("0", "undefined", …) decided the
      // flag; a corrupt stored value must neither force auto-lock on nor
      // silently turn it off — it falls back to the secure default (true).
      localStorage.setItem("auto_lock_vault", "0");
      vi.resetModules();
      const { usePreferencesStore } =
        await import("../../store/usePreferencesStore");
      await vi.waitFor(() => {
        expect(usePreferencesStore.getState().autoLockVault).toBe(true);
      });
    });

    it("autoLockVault falls back to default (true) on corrupt value 'undefined' (L-04)", async () => {
      localStorage.setItem("auto_lock_vault", "undefined");
      vi.resetModules();
      const { usePreferencesStore } =
        await import("../../store/usePreferencesStore");
      await vi.waitFor(() => {
        expect(usePreferencesStore.getState().autoLockVault).toBe(true);
      });
    });

    it("compactMode reads from legacy key", async () => {
      localStorage.setItem("compact-mode", "true");
      vi.resetModules();
      const { usePreferencesStore } =
        await import("../../store/usePreferencesStore");
      await vi.waitFor(() => {
        expect(usePreferencesStore.getState().compactMode).toBe(true);
      });
    });

    it("autoSave defaults to true when key is missing", async () => {
      vi.resetModules();
      const { usePreferencesStore } =
        await import("../../store/usePreferencesStore");
      await vi.waitFor(() => {
        expect(usePreferencesStore.getState().autoSave).toBe(true);
      });
    });

    it("autoSave is false when key is 'false'", async () => {
      localStorage.setItem("auto-save", "false");
      vi.resetModules();
      const { usePreferencesStore } =
        await import("../../store/usePreferencesStore");
      await vi.waitFor(() => {
        expect(usePreferencesStore.getState().autoSave).toBe(false);
      });
    });

    it("autoSave falls back to default (true) on corrupt value '0' (L-04)", async () => {
      localStorage.setItem("auto-save", "0");
      vi.resetModules();
      const { usePreferencesStore } =
        await import("../../store/usePreferencesStore");
      await vi.waitFor(() => {
        expect(usePreferencesStore.getState().autoSave).toBe(true);
      });
    });

    it("autoSaveInterval reads from legacy key", async () => {
      localStorage.setItem("auto-save-interval", "5000");
      vi.resetModules();
      const { usePreferencesStore } =
        await import("../../store/usePreferencesStore");
      await vi.waitFor(() => {
        expect(usePreferencesStore.getState().autoSaveInterval).toBe(5000);
      });
    });

    it("autoSaveInterval falls back to default when key missing", async () => {
      vi.resetModules();
      const { usePreferencesStore } =
        await import("../../store/usePreferencesStore");
      await vi.waitFor(() => {
        expect(usePreferencesStore.getState().autoSaveInterval).toBe(30000);
      });
    });

    it("autoSaveInterval falls back to default when NaN", async () => {
      localStorage.setItem("auto-save-interval", "not-a-number");
      vi.resetModules();
      const { usePreferencesStore } =
        await import("../../store/usePreferencesStore");
      await vi.waitFor(() => {
        expect(usePreferencesStore.getState().autoSaveInterval).toBe(30000);
      });
    });

    it("sidebarCollapsed reads from legacy key", async () => {
      localStorage.setItem("bookmarkforge_sidebar_collapsed", "true");
      vi.resetModules();
      const { usePreferencesStore } =
        await import("../../store/usePreferencesStore");
      await vi.waitFor(() => {
        expect(usePreferencesStore.getState().sidebarCollapsed).toBe(true);
      });
    });

    it("customPromptsSummarize falls back to empty string", async () => {
      vi.resetModules();
      const { usePreferencesStore } =
        await import("../../store/usePreferencesStore");
      await vi.waitFor(() => {
        expect(usePreferencesStore.getState().customPromptsSummarize).toBe("");
      });
    });

    it("customPromptsUnified falls back to empty string", async () => {
      vi.resetModules();
      const { usePreferencesStore } =
        await import("../../store/usePreferencesStore");
      await vi.waitFor(() => {
        expect(usePreferencesStore.getState().customPromptsUnified).toBe("");
      });
    });
  });

  describe("setItem — writing to legacy localStorage keys", () => {
    it("writes theme on setTheme", async () => {
      const { usePreferencesStore } =
        await import("../../store/usePreferencesStore");
      usePreferencesStore.getState().setTheme("light");
      await vi.waitFor(() => {
        expect(localStorage.getItem("bookmarkforge-theme")).toBe("light");
      });
    });

    it("writes globalFont on setGlobalFont", async () => {
      const { usePreferencesStore } =
        await import("../../store/usePreferencesStore");
      usePreferencesStore.getState().setGlobalFont("Mono");
      await vi.waitFor(() => {
        expect(localStorage.getItem("global_font")).toBe("Mono");
      });
    });

    it("writes compactMode on setCompactMode", async () => {
      const { usePreferencesStore } =
        await import("../../store/usePreferencesStore");
      usePreferencesStore.getState().setCompactMode(true);
      await vi.waitFor(() => {
        expect(localStorage.getItem("compact-mode")).toBe("true");
      });
    });

    it("writes custom prompts on setCustomPromptsChat", async () => {
      const { usePreferencesStore } =
        await import("../../store/usePreferencesStore");
      usePreferencesStore.getState().setCustomPromptsChat("hello");
      await vi.waitFor(() => {
        expect(localStorage.getItem("custom_prompts_chat")).toBe("hello");
      });
    });

    it("writes customPromptsUnified on setCustomPromptsUnified", async () => {
      const { usePreferencesStore } =
        await import("../../store/usePreferencesStore");
      usePreferencesStore.getState().setCustomPromptsUnified("{}");
      await vi.waitFor(() => {
        expect(localStorage.getItem("custom_prompts")).toBe("{}");
      });
    });

    it("writes autoLockVault on setAutoLockVault", async () => {
      const { usePreferencesStore } =
        await import("../../store/usePreferencesStore");
      usePreferencesStore.getState().setAutoLockVault(false);
      await vi.waitFor(() => {
        expect(localStorage.getItem("auto_lock_vault")).toBe("false");
      });
    });
  });

  describe("removeItem", () => {
    it("clears all legacy keys on clearStorage", async () => {
      localStorage.setItem("bookmarkforge-theme", "dark");
      localStorage.setItem("i18nextLng", "en");
      localStorage.setItem("global_font", "Inter");
      localStorage.setItem("global_font_size", "14");
      localStorage.setItem("distraction_free_mode", "true");
      localStorage.setItem("auto_lock_vault", "true");
      localStorage.setItem("compact-mode", "true");
      localStorage.setItem("auto-save", "true");
      localStorage.setItem("auto-save-interval", "30000");
      localStorage.setItem("bookmarkforge_sidebar_collapsed", "false");
      localStorage.setItem("custom_prompts_summarize", "s");
      localStorage.setItem("custom_prompts_tagging", "t");
      localStorage.setItem("custom_prompts_chat", "c");
      localStorage.setItem("custom_prompts", "u");

      const { usePreferencesStore } =
        await import("../../store/usePreferencesStore");
      await (usePreferencesStore as any).persist.clearStorage();

      expect(localStorage.getItem("bookmarkforge-theme")).toBeNull();
      expect(localStorage.getItem("i18nextLng")).toBeNull();
      expect(localStorage.getItem("global_font")).toBeNull();
      expect(localStorage.getItem("global_font_size")).toBeNull();
      expect(localStorage.getItem("distraction_free_mode")).toBeNull();
      expect(localStorage.getItem("auto_lock_vault")).toBeNull();
      expect(localStorage.getItem("compact-mode")).toBeNull();
      expect(localStorage.getItem("auto-save")).toBeNull();
      expect(localStorage.getItem("auto-save-interval")).toBeNull();
      expect(
        localStorage.getItem("bookmarkforge_sidebar_collapsed"),
      ).toBeNull();
      expect(localStorage.getItem("custom_prompts_summarize")).toBeNull();
      expect(localStorage.getItem("custom_prompts_tagging")).toBeNull();
      expect(localStorage.getItem("custom_prompts_chat")).toBeNull();
      expect(localStorage.getItem("custom_prompts")).toBeNull();
    });
  });

  describe("persist integration", () => {
    it("persists theme to legacy key after setTheme", async () => {
      const { usePreferencesStore } =
        await import("../../store/usePreferencesStore");
      usePreferencesStore.getState().setTheme("dark");

      await vi.waitFor(() => {
        expect(localStorage.getItem("bookmarkforge-theme")).toBe("dark");
      });
    });

    it("restores globalFontSize from legacy key on reload", async () => {
      localStorage.setItem("global_font_size", "20");
      localStorage.setItem("auto-save-interval", "10000");

      vi.resetModules();
      const { usePreferencesStore } =
        await import("../../store/usePreferencesStore");

      await vi.waitFor(() => {
        expect(usePreferencesStore.getState().globalFontSize).toBe(20);
        expect(usePreferencesStore.getState().autoSaveInterval).toBe(10000);
      });
    });
  });
});
