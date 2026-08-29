import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

const mod = await import("../../services/SettingsService");
const SettingsServiceClass = (mod.settingsService as any).constructor;
const settingsService = mod.settingsService;

describe("SettingsService", () => {
  let service: any;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    SettingsServiceClass.instance = undefined;
    service = SettingsServiceClass.getInstance();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe("getInstance (singleton)", () => {
    it("returns the same instance every time", () => {
      const inst1 = SettingsServiceClass.getInstance();
      const inst2 = SettingsServiceClass.getInstance();
      expect(inst1).toBe(inst2);
    });
  });

  describe("exportSettings", () => {
    it("exports settings with default values", () => {
      const settings = service.exportSettings();
      expect(settings.theme).toBe("system");
      expect(settings.ollamaUrl).toBeUndefined();
      expect(settings.ollamaModel).toBeUndefined();
      expect(settings.fontSize).toBeUndefined();
      expect(settings.sidebarCollapsed).toBeUndefined();
      expect(settings.compactMode).toBeUndefined();
    });

    it("exports settings from localStorage", () => {
      localStorage.setItem("bookmarkforge-theme", "dark");
      localStorage.setItem("ollama_url", "http://localhost:11434");
      localStorage.setItem("ollama_model", "llama3");
      localStorage.setItem("selected_provider", "ollama");
      localStorage.setItem("i18nextLng", "es");

      const settings = service.exportSettings();
      expect(settings.theme).toBe("dark");
      expect(settings.ollamaUrl).toBeUndefined();
      expect(settings.ollamaModel).toBe("llama3");
      expect(settings.selectedProvider).toBe("ollama");
      expect(settings.language).toBe("es");
    });

    it("exports numeric values from localStorage", () => {
      localStorage.setItem("global_font_size", "16");
      localStorage.setItem("auto-save-interval", "30000");

      const settings = service.exportSettings();
      expect(settings.fontSize).toBe(16);
      expect(settings.autoSaveInterval).toBe(30000);
    });

    it("exports boolean values from localStorage", () => {
      localStorage.setItem("bookmarkforge_sidebar_collapsed", "true");
      localStorage.setItem("compact-mode", "false");
      localStorage.setItem("auto-save", "true");

      const settings = service.exportSettings();
      expect(settings.sidebarCollapsed).toBe(true);
      expect(settings.compactMode).toBe(false);
      expect(settings.autoSave).toBe(true);
    });

    it("returns undefined for invalid numbers", () => {
      localStorage.setItem("global_font_size", "no-numero");
      const settings = service.exportSettings();
      expect(settings.fontSize).toBeUndefined();
    });

    it("does not partially parse malformed numeric storage", () => {
      localStorage.setItem("global_font_size", "16px");
      const settings = service.exportSettings();
      expect(settings.fontSize).toBeUndefined();
    });
  });

  describe("importSettings", () => {
    it("imports and saves to localStorage", () => {
      vi.stubGlobal("window", {
        ...window,
        dispatchEvent: vi.fn(),
        location: { reload: vi.fn() },
      });

      service.importSettings({
        theme: "dark",
        ollamaUrl: "http://ollama:11434",
        fontSize: 18,
      });

      expect(localStorage.getItem("bookmarkforge-theme")).toBe("dark");
      expect(localStorage.getItem("global_font_size")).toBe("18");
    });

    it("dispatches the settingsUpdated event after importing", () => {
      const dispatchEventMock = vi.fn();
      vi.stubGlobal("window", {
        ...window,
        dispatchEvent: dispatchEventMock,
        location: { reload: vi.fn() },
      });

      service.importSettings({ theme: "light" });
      expect(dispatchEventMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "settingsUpdated",
        }),
      );
    });

    it("does not save undefined values", () => {
      vi.stubGlobal("window", {
        ...window,
        dispatchEvent: vi.fn(),
        location: { reload: vi.fn() },
      });

      service.importSettings({ theme: "light" });
      expect(localStorage.getItem("ollama_url")).toBeNull();
    });

    it("rejects malformed settings before writing or dispatching", () => {
      const dispatchEventMock = vi.fn();
      vi.stubGlobal("window", {
        ...window,
        dispatchEvent: dispatchEventMock,
        location: { reload: vi.fn() },
      });

      expect(() => service.importSettings({ theme: "neon" as any })).toThrow(
        "Invalid theme value",
      );
      expect(localStorage.getItem("bookmarkforge-theme")).toBeNull();
      expect(dispatchEventMock).not.toHaveBeenCalled();
    });

    it("saves booleans as string", () => {
      vi.stubGlobal("window", {
        ...window,
        dispatchEvent: vi.fn(),
        location: { reload: vi.fn() },
      });

      service.importSettings({ sidebarCollapsed: true, compactMode: false });
      expect(localStorage.getItem("bookmarkforge_sidebar_collapsed")).toBe("true");
      expect(localStorage.getItem("compact-mode")).toBe("false");
    });

    it("restores the portable model and provider selections", () => {
      vi.stubGlobal("window", {
        ...window,
        dispatchEvent: vi.fn(),
        location: { reload: vi.fn() },
      });

      service.importSettings({
        ollamaModel: "llama3.2",
        selectedProvider: "ollama",
      });

      expect(localStorage.getItem("ollama_model")).toBe("llama3.2");
      expect(localStorage.getItem("selected_provider")).toBe("ollama");
      expect(localStorage.getItem("selected_ai_provider")).toBe("ollama");
    });

  });

  describe("downloadSettings", () => {
    it("creates Blob, URL and simulates link click", () => {
      vi.useFakeTimers();
      localStorage.setItem("bookmarkforge-theme", "dark");

      const createObjectURL = vi.fn(() => "blob:settings");
      const revokeObjectURL = vi.fn();
      const clickMock = vi.fn();
      const appendChildMock = vi.fn();
      const removeChildMock = vi.fn();

      vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
      vi.stubGlobal("document", {
        createElement: vi
          .fn()
          .mockReturnValue({
            href: "",
            download: "",
            click: clickMock,
            parentNode: { removeChild: removeChildMock },
          }),
        body: { appendChild: appendChildMock, removeChild: removeChildMock },
      });

      service.downloadSettings();
      vi.runAllTimers();
      expect(createObjectURL).toHaveBeenCalled();
      expect(clickMock).toHaveBeenCalled();
      expect(revokeObjectURL).toHaveBeenCalled();
      expect(appendChildMock).toHaveBeenCalled();
      expect(removeChildMock).toHaveBeenCalled();
      vi.useRealTimers();
    });
  });

  describe("uploadSettings", () => {
    it("parses a valid JSON file", async () => {
      const file = new File(
        ['{"theme":"dark","fontSize":16}'],
        "settings.json",
        { type: "application/json" },
      );
      const result = await service.uploadSettings(file);
      expect(result.theme).toBe("dark");
      expect(result.fontSize).toBe(16);
    });

    it("rejects a file with an invalid format", async () => {
      const file = new File(["no-es-json"], "settings.json", {
        type: "application/json",
      });
      await expect(service.uploadSettings(file)).rejects.toThrow(
        "Invalid settings file format",
      );
    });

    it("rejects oversized settings files before reading them", async () => {
      const file = new File(["{}"], "settings.json", {
        type: "application/json",
      });
      Object.defineProperty(file, "size", { value: 1024 * 1024 + 1 });
      await expect(service.uploadSettings(file)).rejects.toThrow(
        /1 MB size limit/i,
      );
    });
  });

  describe("validateSettings (privado)", () => {
    it("throws with an invalid theme", () => {
      expect(() => service.validateSettings({ theme: "neon" as any })).toThrow(
        "Invalid theme value",
      );
    });

    it("throws with an invalid URL", () => {
      expect(() =>
        service.validateSettings({ ollamaUrl: "no-es-url" }),
      ).toThrow("Invalid Ollama URL");
    });

    it("does not throw with valid settings", () => {
      expect(() => service.validateSettings({ theme: "light" })).not.toThrow();
      expect(() => service.validateSettings({ theme: "dark" })).not.toThrow();
      expect(() => service.validateSettings({ theme: "system" })).not.toThrow();
    });

    it("accepts a valid URL for ollama", () => {
      expect(() =>
        service.validateSettings({ ollamaUrl: "http://localhost:11434" }),
      ).not.toThrow();
      expect(() =>
        service.validateSettings({ ollamaUrl: "https://ollama.example.com" }),
      ).not.toThrow();
    });

    it("throws with an invalid fontSize", () => {
      expect(() =>
        service.validateSettings({ fontSize: 5 }),
      ).toThrow("Invalid font size");
      expect(() =>
        service.validateSettings({ fontSize: 100 }),
      ).toThrow("Invalid font size");
    });

    it("throws with an invalid autoSaveInterval", () => {
      expect(() =>
        service.validateSettings({ autoSaveInterval: 500 }),
      ).toThrow("Invalid auto-save interval");
      expect(() =>
        service.validateSettings({ autoSaveInterval: 9999999 }),
      ).toThrow("Invalid auto-save interval");
    });

    it("throws with an invalid boolean", () => {
      expect(() =>
        service.validateSettings({ sidebarCollapsed: "yes" as any }),
      ).toThrow("Invalid sidebarCollapsed value");
    });
  });

  describe("resetSettings", () => {
    it("removes all keys from localStorage", async () => {
      vi.stubGlobal("window", { ...window, location: { reload: vi.fn() } });
      localStorage.setItem("bookmarkforge-theme", "dark");
      localStorage.setItem("ollama_url", "http://localhost");
      localStorage.setItem("global_font_size", "16");
      localStorage.setItem("other-key", "keep");

      await service.resetSettings();

      expect(localStorage.getItem("bookmarkforge-theme")).toBeNull();
      expect(localStorage.getItem("ollama_url")).toBeNull();
      expect(localStorage.getItem("global_font_size")).toBeNull();
      expect(localStorage.getItem("other-key")).toBe("keep");
    });

    it("reloads the page after reset", async () => {
      const reloadMock = vi.fn();
      vi.stubGlobal("window", { ...window, location: { reload: reloadMock } });

      await service.resetSettings();
      expect(reloadMock).toHaveBeenCalled();
    });
  });

  describe("validateSettings - adicionales", () => {
    it("lanza error con null", () => {
      expect(() => service.validateSettings(null as any)).toThrow(
        "Invalid settings object",
      );
    });

    it("lanza error con ollamaModel > 128 chars", () => {
      expect(() =>
        service.validateSettings({ ollamaModel: "x".repeat(129) }),
      ).toThrow("Invalid Ollama model");
    });

    it("accepts 128-char ollamaModel", () => {
      expect(() =>
        service.validateSettings({ ollamaModel: "x".repeat(128) }),
      ).not.toThrow();
    });

    it("throws with an invalid selectedProvider", () => {
      expect(() =>
        service.validateSettings({ selectedProvider: "invalid" as any }),
      ).toThrow("Invalid selected provider");
    });

    it("accepts a valid selectedProvider", () => {
      for (const p of [
        "ollama",
        "webllm",
        "gemini",
        "openai",
        "anthropic",
        "groq",
      ]) {
        expect(() =>
          service.validateSettings({ selectedProvider: p }),
        ).not.toThrow();
      }
    });

    it("throws with an invalid language", () => {
      expect(() =>
        service.validateSettings({ language: "invalid-lang" }),
      ).toThrow("Invalid language");
    });

    it("accepts a valid language with a region", () => {
      expect(() =>
        service.validateSettings({ language: "pt-BR" }),
      ).not.toThrow();
    });

    it("lanza error con fontSize bajo (8)", () => {
      expect(() => service.validateSettings({ fontSize: 7 })).toThrow(
        "Invalid font size",
      );
    });

    it("accepts the minimum fontSize (8)", () => {
      expect(() => service.validateSettings({ fontSize: 8 })).not.toThrow();
    });

    it("accepts the maximum fontSize (72)", () => {
      expect(() => service.validateSettings({ fontSize: 72 })).not.toThrow();
    });

    it("lanza error con compactMode no boolean", () => {
      expect(() =>
        service.validateSettings({ compactMode: "yes" as any }),
      ).toThrow("Invalid compactMode value");
    });

    it("lanza error con autoSave no boolean", () => {
      expect(() =>
        service.validateSettings({ autoSave: 1 as any }),
      ).toThrow("Invalid autoSave value");
    });

    it("treats an ollamaUrl > 2048 chars as invalid", () => {
      expect(() =>
        service.validateSettings({ ollamaUrl: "http://x.com/" + "a".repeat(2049) }),
      ).toThrow("Invalid Ollama URL");
    });

    it("lanza error con ollamaModel tipo number", () => {
      expect(() =>
        service.validateSettings({ ollamaModel: 123 as any }),
      ).toThrow("Invalid Ollama model");
    });
  });

  describe("importSettings - edge cases", () => {
    it("rejects a language with an invalid format", () => {
      vi.stubGlobal("window", {
        ...window,
        dispatchEvent: vi.fn(),
        location: { reload: vi.fn() },
      });

      expect(() => service.importSettings({ language: "english" })).toThrow(
        "Invalid language",
      );
      expect(localStorage.getItem("i18nextLng")).toBeNull();
    });

    it("saves a valid short language (2 chars)", () => {
      vi.stubGlobal("window", {
        ...window,
        dispatchEvent: vi.fn(),
        location: { reload: vi.fn() },
      });

      service.importSettings({ language: "es" });
      expect(localStorage.getItem("i18nextLng")).toBe("es");
    });

    it("rejects non-finite fontSize without partial writes", () => {
      vi.stubGlobal("window", {
        ...window,
        dispatchEvent: vi.fn(),
        location: { reload: vi.fn() },
      });

      expect(() => service.importSettings({ fontSize: NaN })).toThrow(
        "Invalid font size",
      );
      expect(localStorage.getItem("global_font_size")).toBeNull();
    });

    it("rejects non-finite autoSaveInterval without partial writes", () => {
      vi.stubGlobal("window", {
        ...window,
        dispatchEvent: vi.fn(),
        location: { reload: vi.fn() },
      });

      expect(() => service.importSettings({ autoSaveInterval: Infinity })).toThrow(
        "Invalid auto-save interval",
      );
      expect(localStorage.getItem("auto-save-interval")).toBeNull();
    });

    it("saves a valid autoSaveInterval", () => {
      vi.stubGlobal("window", {
        ...window,
        dispatchEvent: vi.fn(),
        location: { reload: vi.fn() },
      });

      service.importSettings({ autoSaveInterval: 30000 });
      expect(localStorage.getItem("auto-save-interval")).toBe("30000");
    });

    it("no sobrescribe valores existentes con undefined", () => {
      vi.stubGlobal("window", {
        ...window,
        dispatchEvent: vi.fn(),
        location: { reload: vi.fn() },
      });

      localStorage.setItem("bookmarkforge-theme", "dark");
      service.importSettings({ theme: undefined as any });
      expect(localStorage.getItem("bookmarkforge-theme")).toBe("dark");
    });
  });

  describe("uploadSettings - reader error", () => {
    it("rejects if FileReader fails", async () => {
      const originalFileReader = globalThis.FileReader;
      globalThis.FileReader = class {
        onerror: (() => void) | null = null;
        onload: (() => void) | null = null;
        readAsText() {
          setTimeout(() => this.onerror?.(), 0);
        }
      } as any;

      const file = new File(["test"], "settings.json", {
        type: "application/json",
      });
      const promise = service.uploadSettings(file);

      await vi.waitFor(() =>
        expect(promise).rejects.toThrow("Failed to read settings file"),
      );

      globalThis.FileReader = originalFileReader;
    });
  });

  describe("exportSecureProviderSettings", () => {
    it("returns null if secureStorage fails", async () => {
      const mod = await import("../../services/SettingsService");
      const svc = (mod.settingsService as any);
      const ss = await import("../../services/SecureStorage");
      vi.spyOn(ss.secureStorage, "getSecret").mockRejectedValue(new Error("fail"));

      const result = await svc.exportSecureProviderSettings();
      expect(result).toBeNull();
    });
  });

  describe("importSecureProviderSettings", () => {
    it("saves a valid ollamaUrl in SecureStorage", async () => {
      const mod = await import("../../services/SettingsService");
      const svc = (mod.settingsService as any);
      const ss = await import("../../services/SecureStorage");
      vi.spyOn(ss.secureStorage, "setSecret").mockResolvedValue(undefined);

      await svc.importSecureProviderSettings({
        ollamaUrl: "http://localhost:11434",
        ollamaModel: "llama3",
        customAiBaseUrl: "https://api.example.com",
        selectedProvider: "ollama",
      });

      expect(ss.secureStorage.setSecret).toHaveBeenCalledWith(
        "ollama_url",
        "http://localhost:11434",
      );
      expect(ss.secureStorage.setSecret).toHaveBeenCalledWith(
        "ollama_model",
        "llama3",
      );
    });

    it("does not save an invalid URL", async () => {
      const mod = await import("../../services/SettingsService");
      const svc = (mod.settingsService as any);
      const ss = await import("../../services/SecureStorage");
      vi.spyOn(ss.secureStorage, "setSecret").mockResolvedValue(undefined);

      await svc.importSecureProviderSettings({
        ollamaUrl: "not-a-url",
      });

      expect(ss.secureStorage.setSecret).not.toHaveBeenCalledWith(
        "ollama_url",
        expect.anything(),
      );
    });

    it("does not save model > 256 chars", async () => {
      const mod = await import("../../services/SettingsService");
      const svc = (mod.settingsService as any);
      const ss = await import("../../services/SecureStorage");
      vi.spyOn(ss.secureStorage, "setSecret").mockResolvedValue(undefined);

      await svc.importSecureProviderSettings({
        ollamaModel: "x".repeat(257),
      });

      expect(ss.secureStorage.setSecret).not.toHaveBeenCalledWith(
        "ollama_model",
        expect.anything(),
      );
    });

    it("does not save provider > 64 chars", async () => {
      const mod = await import("../../services/SettingsService");
      const svc = (mod.settingsService as any);
      const ss = await import("../../services/SecureStorage");
      vi.spyOn(ss.secureStorage, "setSecret").mockResolvedValue(undefined);

      await svc.importSecureProviderSettings({
        selectedProvider: "x".repeat(65),
      });

      expect(ss.secureStorage.setSecret).not.toHaveBeenCalledWith(
        "selected_provider",
        expect.anything(),
      );
    });

    it("despacha evento secureProviderSettingsUpdated", async () => {
      const dispatchSpy = vi.fn();
      vi.stubGlobal("window", { ...window, dispatchEvent: dispatchSpy });

      const mod = await import("../../services/SettingsService");
      const svc = (mod.settingsService as any);
      const ss = await import("../../services/SecureStorage");
      vi.spyOn(ss.secureStorage, "setSecret").mockResolvedValue(undefined);

      await svc.importSecureProviderSettings({ ollamaModel: "test" });

      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: "secureProviderSettingsUpdated" }),
      );
    });
  });

  describe("getNumberSetting / getBooleanSetting (privados)", () => {
    it("returns undefined for NaN value", () => {
      localStorage.setItem("test-num", "abc");
      expect(service.getNumberSetting("test-num")).toBeUndefined();
    });

    it("returns undefined for nonexistent key", () => {
      expect(service.getNumberSetting("nonexistent")).toBeUndefined();
    });

    it("returns undefined for nonexistent boolean", () => {
      expect(service.getBooleanSetting("nonexistent")).toBeUndefined();
    });

    it("returns false for string 'false'", () => {
      localStorage.setItem("test-bool", "false");
      expect(service.getBooleanSetting("test-bool")).toBe(false);
    });

    it("returns undefined for an unknown boolean encoding", () => {
      localStorage.setItem("test-bool", "yes");
      expect(service.getBooleanSetting("test-bool")).toBeUndefined();
    });
  });

  describe("settingsService exportado", () => {
    it("exists and has methods", () => {
      expect(settingsService).toBeDefined();
      expect(typeof settingsService.exportSettings).toBe("function");
      expect(typeof settingsService.importSettings).toBe("function");
      expect(typeof settingsService.downloadSettings).toBe("function");
      expect(typeof settingsService.uploadSettings).toBe("function");
      expect(typeof settingsService.resetSettings).toBe("function");
    });
  });

  describe("coverage gaps", () => {
    it("exportSecureProviderSettings returns the values it read", async () => {
      const ss = await import("../../services/SecureStorage");
      vi.spyOn(ss.secureStorage, "getSecret").mockImplementation((key) =>
        Promise.resolve(`${key}-value`),
      );

      const result = await service.exportSecureProviderSettings();
      expect(result).toEqual({
        ollamaUrl: "ollama_url-value",
        ollamaModel: "ollama_model-value",
        customAiBaseUrl: "custom_ai_base_url-value",
        selectedProvider: "selected_provider-value",
      });
    });

    it("importSecureProviderSettings saves all valid keys", async () => {
      const ss = await import("../../services/SecureStorage");
      vi.spyOn(ss.secureStorage, "setSecret").mockResolvedValue(undefined);

      await service.importSecureProviderSettings({
        ollamaUrl: "http://localhost:11434",
        ollamaModel: "llama3",
        customAiBaseUrl: "https://api.example.com/v1",
        selectedProvider: "openai",
      });

      expect(ss.secureStorage.setSecret).toHaveBeenCalledWith(
        "ollama_url",
        "http://localhost:11434",
      );
      expect(ss.secureStorage.setSecret).toHaveBeenCalledWith(
        "ollama_model",
        "llama3",
      );
      expect(ss.secureStorage.setSecret).toHaveBeenCalledWith(
        "custom_ai_base_url",
        "https://api.example.com/v1",
      );
      expect(ss.secureStorage.setSecret).toHaveBeenCalledWith(
        "selected_provider",
        "openai",
      );
    });

    it("importSecureProviderSettings handles failed setSecret calls", async () => {
      const ss = await import("../../services/SecureStorage");
      vi.spyOn(ss.secureStorage, "setSecret").mockRejectedValue(
        new Error("persist failed"),
      );

      await expect(
        service.importSecureProviderSettings({
          ollamaUrl: "http://localhost:11434",
        }),
      ).resolves.toBeUndefined();
    });

    it("importSecureProviderSettings rejects URL > 2048 chars", async () => {
      const ss = await import("../../services/SecureStorage");
      vi.spyOn(ss.secureStorage, "setSecret").mockResolvedValue(undefined);

      await service.importSecureProviderSettings({
        ollamaUrl: "http://x.com/" + "a".repeat(2050),
      });

      expect(ss.secureStorage.setSecret).not.toHaveBeenCalledWith(
        "ollama_url",
        expect.anything(),
      );
    });

    it("importSecureProviderSettings rejects selectedProvider > 64 chars", async () => {
      const ss = await import("../../services/SecureStorage");
      vi.spyOn(ss.secureStorage, "setSecret").mockResolvedValue(undefined);

      await service.importSecureProviderSettings({
        selectedProvider: "x".repeat(65),
      });

      expect(ss.secureStorage.setSecret).not.toHaveBeenCalledWith(
        "selected_provider",
        expect.anything(),
      );
    });

    it("importSettings saves a language with a region", () => {
      vi.stubGlobal("window", {
        ...window,
        dispatchEvent: vi.fn(),
        location: { reload: vi.fn() },
      });

      service.importSettings({ language: "pt-BR" });
      expect(localStorage.getItem("i18nextLng")).toBe("pt-BR");
    });

    it("importSettings saves compactMode and autoSave", () => {
      vi.stubGlobal("window", {
        ...window,
        dispatchEvent: vi.fn(),
        location: { reload: vi.fn() },
      });

      service.importSettings({
        compactMode: true,
        autoSave: false,
      });

      expect(localStorage.getItem("compact-mode")).toBe("true");
      expect(localStorage.getItem("auto-save")).toBe("false");
    });

    it("validateSettings lanza error con sidebarCollapsed no boolean", () => {
      expect(() =>
        service.validateSettings({ sidebarCollapsed: "yes" as any }),
      ).toThrow("Invalid sidebarCollapsed value");
    });

    it("getBooleanSetting returns true for string 'true'", () => {
      localStorage.setItem("test-bool", "true");
      expect(service.getBooleanSetting("test-bool")).toBe(true);
    });

    it("uploadSettings rejects valid JSON that is not an object", async () => {
      const file = new File(['"not-an-object"'], "settings.json", {
        type: "application/json",
      });
      await expect(service.uploadSettings(file)).rejects.toThrow(
        "Invalid settings file format",
      );
    });
  });
});
