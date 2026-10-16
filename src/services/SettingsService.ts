/**
 * SettingsService
 *
 * Manages application settings export and import functionality.
 * Allows users to backup and restore their preferences.
 *
 * NOTE: AI provider URLs/models are persisted BOTH in SecureStorage (encrypted)
 * and in localStorage (cleartext) for sync with the UI; the custom AI base URL
 * is validated to reject embedded credentials/secret query params. Exports do
 * NOT include AI provider URLs to avoid leaking configuration in cleartext.
 */

import { secureStorage } from "./SecureStorage";
import { logger } from "../utils/logger";
import { safeGet, safeSet, safeRemove } from "../store/safeStorage";
import { STORAGE_KEYS } from "../constants/storage-keys";
import { downloadBlob } from "../utils/download";

interface AppSettings {
  theme: "light" | "dark" | "system";
  ollamaUrl?: string;
  ollamaModel?: string;
  customAiBaseUrl?: string;
  selectedProvider?: string;
  language?: string;
  fontSize?: number;
  sidebarCollapsed?: boolean;
  compactMode?: boolean;
  autoSave?: boolean;
  autoSaveInterval?: number;
}

class SettingsService {
  private static instance: SettingsService;
  private static readonly SECURE_PROVIDER_KEYS = [
    // Current ProviderConfiguration namespace.
    "bmf_provider_ollama_url",
    "bmf_provider_ollama_model",
    "bmf_provider_webllm_model",
    "bmf_provider_selected_ai_provider",
    "bmf_provider_custom_ai_base_url",
    // Legacy SettingsService namespace retained for migration cleanup.
    "ollama_url",
    "ollama_model",
    "custom_ai_base_url",
    "selected_provider",
  ] as const;

  private constructor() {}

  public static getInstance(): SettingsService {
    if (!SettingsService.instance) {
      SettingsService.instance = new SettingsService();
    }
    return SettingsService.instance;
  }

  /**
   * Export application settings to JSON. Provider URLs and credentials are
   * intentionally excluded; the non-secret model/provider selections remain
   * portable while sensitive provider values stay in SecureStorage.
   */
  public exportSettings(): AppSettings {
    const settings: AppSettings = {
      theme:
        (safeGet(STORAGE_KEYS.THEME) as AppSettings["theme"]) || "system",
      ollamaModel: safeGet(STORAGE_KEYS.OLLAMA_MODEL) || undefined,
      // The selected provider is not a secret; retain it in the portable
      // settings export while keeping provider URLs and credentials secure.
      selectedProvider:
        safeGet(STORAGE_KEYS.SELECTED_PROVIDER) ||
        safeGet("selected_ai_provider") ||
        undefined,
      language: safeGet(STORAGE_KEYS.I18N_LANGUAGE) || undefined,
      fontSize: this.getNumberSetting(STORAGE_KEYS.GLOBAL_FONT_SIZE),
      sidebarCollapsed: this.getBooleanSetting(STORAGE_KEYS.SIDEBAR_COLLAPSED),
      compactMode: this.getBooleanSetting(STORAGE_KEYS.COMPACT_MODE),
      autoSave: this.getBooleanSetting(STORAGE_KEYS.AUTO_SAVE),
      autoSaveInterval: this.getNumberSetting(STORAGE_KEYS.AUTO_SAVE_INTERVAL),
    };

    return settings;
  }

  /**
   * Exports secure AI provider settings (uses SecureStorage)
   */
  public async exportSecureProviderSettings(): Promise<Pick<
    AppSettings,
    "ollamaUrl" | "ollamaModel" | "customAiBaseUrl" | "selectedProvider"
  > | null> {
    try {
      const ollamaUrl = await secureStorage.getSecret("ollama_url");
      const ollamaModel = await secureStorage.getSecret("ollama_model");
      const customAiBaseUrl =
        await secureStorage.getSecret("custom_ai_base_url");
      const selectedProvider =
        await secureStorage.getSecret("selected_provider");
      return {
        ollamaUrl: ollamaUrl || undefined,
        ollamaModel: ollamaModel || undefined,
        customAiBaseUrl: customAiBaseUrl || undefined,
        selectedProvider: selectedProvider || undefined,
      };
    } catch (_err) {
      logger.error("[SettingsService] Failed to read secure provider settings", { error: _err });
      return null;
    }
  }

  /**
   * Import settings from JSON and apply them
   * Validates each field against expected types/ranges to prevent
   * configuration collision from malformed or incompatible backup data.
   */
  public importSettings(settings: AppSettings): void {
    this.validateSettings(settings);
    const VALID_THEMES: ReadonlySet<string> = new Set([
      "light",
      "dark",
      "system",
    ]);

    if (settings.theme && VALID_THEMES.has(settings.theme)) {
      safeSet(STORAGE_KEYS.THEME, settings.theme);
    }

    if (
      settings.language !== undefined &&
      /^[a-z]{2}(-[A-Z]{2})?$/.test(settings.language)
    ) {
      safeSet(STORAGE_KEYS.I18N_LANGUAGE, settings.language);
    }

    if (settings.ollamaModel !== undefined) {
      safeSet(STORAGE_KEYS.OLLAMA_MODEL, settings.ollamaModel);
    }

    if (settings.selectedProvider !== undefined) {
      // Keep both names while older ProviderConfiguration consumers migrate
      // from the generic settings key to its namespaced key.
      safeSet(STORAGE_KEYS.SELECTED_PROVIDER, settings.selectedProvider);
      safeSet("selected_ai_provider", settings.selectedProvider);
    }

    if (
      settings.fontSize !== undefined &&
      Number.isFinite(settings.fontSize) &&
      settings.fontSize >= 8 &&
      settings.fontSize <= 72
    ) {
      safeSet(STORAGE_KEYS.GLOBAL_FONT_SIZE, settings.fontSize.toString());
    }

    if (settings.sidebarCollapsed !== undefined) {
      safeSet(STORAGE_KEYS.SIDEBAR_COLLAPSED, settings.sidebarCollapsed.toString());
    }

    if (settings.compactMode !== undefined) {
      safeSet(STORAGE_KEYS.COMPACT_MODE, settings.compactMode.toString());
    }

    if (settings.autoSave !== undefined) {
      safeSet(STORAGE_KEYS.AUTO_SAVE, settings.autoSave.toString());
    }

    if (
      settings.autoSaveInterval !== undefined &&
      Number.isFinite(settings.autoSaveInterval) &&
      settings.autoSaveInterval >= 1000 &&
      settings.autoSaveInterval <= 3600000
    ) {
      safeSet(STORAGE_KEYS.AUTO_SAVE_INTERVAL, settings.autoSaveInterval.toString());
    }

    // Notificar app que settings foram atualizadas
    window.dispatchEvent(
      new CustomEvent("settingsUpdated", {
        detail: {
          theme: settings.theme,
          language: settings.language,
        },
      }),
    );
  }

  /**
   * Imports secure AI provider settings (migrates localStorage to SecureStorage)
   */
  public async importSecureProviderSettings(
    settings: Pick<
      AppSettings,
      "ollamaUrl" | "ollamaModel" | "customAiBaseUrl" | "selectedProvider"
    >,
  ): Promise<void> {
    // Validate URL format and reject embedded credentials before storing it.
    // Query strings are allowed for local gateways, but userinfo is never
    // legitimate here and would leak a credential through diagnostics/logs.
    const isValidUrl = (s: string): boolean => this.isValidUrl(s);

    if (typeof settings !== "object" || settings === null) {
      logger.warn("[SettingsService] Ignoring invalid secure provider settings");
      window.dispatchEvent(new CustomEvent("secureProviderSettingsUpdated"));
      return;
    }

    // Save to SecureStorage (not localStorage)
    if (
      typeof settings.ollamaUrl === "string" &&
      settings.ollamaUrl &&
      isValidUrl(settings.ollamaUrl)
    ) {
      await secureStorage
        .setSecret("ollama_url", settings.ollamaUrl)
        .catch((err) =>
          logger.warn("[SettingsService] Failed to persist setting", {
            error: err,
          }),
        );
    }

    if (
      typeof settings.ollamaModel === "string" &&
      settings.ollamaModel.length > 0 &&
      settings.ollamaModel.length <= 256
    ) {
      await secureStorage
        .setSecret("ollama_model", settings.ollamaModel)
        .catch((err) =>
          logger.warn("[SettingsService] Failed to persist setting", {
            error: err,
          }),
        );
    }

    if (
      typeof settings.customAiBaseUrl === "string" &&
      settings.customAiBaseUrl &&
      isValidUrl(settings.customAiBaseUrl)
    ) {
      await secureStorage
        .setSecret("custom_ai_base_url", settings.customAiBaseUrl)
        .catch((err) =>
          logger.warn("[SettingsService] Failed to persist setting", {
            error: err,
          }),
        );
    }

    if (
      typeof settings.selectedProvider === "string" &&
      ["ollama", "webllm", "gemini", "openai", "anthropic", "groq", "custom"].includes(
        settings.selectedProvider,
      ) &&
      settings.selectedProvider.length <= 64
    ) {
      await secureStorage
        .setSecret("selected_provider", settings.selectedProvider)
        .catch((err) =>
          logger.warn("[SettingsService] Failed to persist setting", {
            error: err,
          }),
        );
    }

    window.dispatchEvent(new CustomEvent("secureProviderSettingsUpdated"));
  }

  /**
   * Export settings as downloadable JSON file
   */
  public downloadSettings(): void {
    const settings = this.exportSettings();
    const dataStr = JSON.stringify(settings, null, 2);
    const dataBlob = new Blob([dataStr], { type: "application/json" });
    downloadBlob(
      dataBlob,
      `bookmarkforge-settings-${new Date().toISOString().split("T")[0]}.json`,
    );
  }

  /**
   * Import settings from uploaded JSON file
   */
  public async uploadSettings(file: File): Promise<AppSettings> {
    const MAX_SETTINGS_FILE_BYTES = 1 * 1024 * 1024;
    if (file.size > MAX_SETTINGS_FILE_BYTES) {
      throw new Error("Settings file exceeds the 1 MB size limit");
    }

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      let settled = false;
      const cleanup = () => {
        reader.onload = null;
        reader.onerror = null;
        reader.onabort = null;
      };
      const fail = (error: Error) => {
        if (settled) {return;}
        settled = true;
        cleanup();
        reject(error);
      };

      reader.onload = (e) => {
        if (settled) {return;}
        try {
          const settings = JSON.parse(
            e.target?.result as string,
          ) as AppSettings;
          this.validateSettings(settings);
          settled = true;
          cleanup();
          resolve(settings);
        } catch (_err) {
          fail(new Error("Invalid settings file format"));
        }
      };

      reader.onerror = () => fail(new Error("Failed to read settings file"));
      reader.onabort = () =>
        fail(new DOMException("Settings read aborted", "AbortError"));
      try {
        reader.readAsText(file);
      } catch (error) {
        fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  /**
   * Validate imported settings (allowlist + type checks).
   */
  private validateSettings(settings: AppSettings): void {
    if (typeof settings !== "object" || settings === null) {
      throw new Error("Invalid settings object");
    }
    if (
      settings.theme !== undefined &&
      !["light", "dark", "system"].includes(settings.theme)
    ) {
      throw new Error("Invalid theme value");
    }
    if (settings.ollamaUrl !== undefined) {
      if (
        typeof settings.ollamaUrl !== "string" ||
        settings.ollamaUrl.length > 2048
      ) {
        throw new Error("Invalid Ollama URL");
      }
      if (!this.isValidUrl(settings.ollamaUrl)) {
        throw new Error("Invalid Ollama URL");
      }
    }
    if (
      settings.ollamaModel !== undefined &&
      (typeof settings.ollamaModel !== "string" ||
        settings.ollamaModel.length === 0 ||
        settings.ollamaModel.length > 128)
    ) {
      throw new Error("Invalid Ollama model");
    }
    if (settings.customAiBaseUrl !== undefined) {
      if (
        typeof settings.customAiBaseUrl !== "string" ||
        !this.isValidUrl(settings.customAiBaseUrl)
      ) {
        throw new Error("Invalid custom AI base URL");
      }
    }
    if (settings.selectedProvider !== undefined) {
      if (
        !["ollama", "webllm", "gemini", "openai", "anthropic", "groq", "custom"].includes(
          settings.selectedProvider,
        )
      ) {
        throw new Error("Invalid selected provider");
      }
    }
    if (
      settings.language !== undefined &&
      (typeof settings.language !== "string" ||
        !/^[a-z]{2}(-[A-Z]{2})?$/.test(settings.language))
    ) {
      throw new Error("Invalid language");
    }
    if (
      settings.fontSize !== undefined &&
      (typeof settings.fontSize !== "number" ||
        !Number.isFinite(settings.fontSize) ||
        settings.fontSize < 8 ||
        settings.fontSize > 72)
    ) {
      throw new Error("Invalid font size");
    }
    if (
      settings.autoSaveInterval !== undefined &&
      (typeof settings.autoSaveInterval !== "number" ||
        !Number.isFinite(settings.autoSaveInterval) ||
        settings.autoSaveInterval < 1000 ||
        settings.autoSaveInterval > 3600000)
    ) {
      throw new Error("Invalid auto-save interval");
    }
    for (const boolKey of [
      "sidebarCollapsed",
      "compactMode",
      "autoSave",
    ] as const) {
      const v = settings[boolKey];
      if (v !== undefined && typeof v !== "boolean") {
        throw new Error(`Invalid ${boolKey} value`);
      }
    }
  }

  /**
   * Check if string is a valid URL
   */
  private isValidUrl(string: string): boolean {
    try {
      if (string.length === 0 || string.length > 2048) {return false;}
      const url = new URL(string);
      if (url.protocol !== "http:" && url.protocol !== "https:") {return false;}
      if (url.username || url.password) {return false;}
      return Boolean(url.hostname);
    } catch (_err) {
      return false;
    }
  }

  /**
   * Get number setting from localStorage
   */
  private getNumberSetting(key: string): number | undefined {
    const value = safeGet(key);
    if (value === null) {
      return undefined;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    const num = Number(trimmed);
    return Number.isFinite(num) ? num : undefined;
  }

  /**
   * Get boolean setting from localStorage
   */
  private getBooleanSetting(key: string): boolean | undefined {
    const value = safeGet(key);
    if (value === null) {
      return undefined;
    }
    if (value === "true") {
      return true;
    }
    if (value === "false") {
      return false;
    }
    return undefined;
  }

  /**
   * Reset all settings to defaults
   */
  public async resetSettings(): Promise<void> {
    const keysToRemove: string[] = [
      STORAGE_KEYS.THEME,
      STORAGE_KEYS.OLLAMA_URL,
      STORAGE_KEYS.OLLAMA_MODEL,
      STORAGE_KEYS.WEBLLM_MODEL,
      STORAGE_KEYS.CUSTOM_AI_BASE_URL,
      STORAGE_KEYS.SELECTED_PROVIDER,
      STORAGE_KEYS.I18N_LANGUAGE,
      STORAGE_KEYS.GLOBAL_FONT_SIZE,
      STORAGE_KEYS.SIDEBAR_COLLAPSED,
      STORAGE_KEYS.COMPACT_MODE,
      STORAGE_KEYS.AUTO_SAVE,
      STORAGE_KEYS.AUTO_SAVE_INTERVAL,
      "selected_ai_provider",
    ];

    keysToRemove.forEach((key) => {
      safeRemove(key);
    });

    // ProviderConfiguration stores its settings in SecureStorage. Removing
    // only localStorage copies left stale provider URLs/models active after a
    // reset, especially after the next vault unlock. Delete only this scoped
    // namespace; never clear the vault wholesale (API keys and DB secrets are
    // intentionally owned by SecurityVault/NuclearForgetService).
    for (const key of SettingsService.SECURE_PROVIDER_KEYS) {
      try {
        await secureStorage.deleteSecret(key);
      } catch (error) {
        // A reset should still restore the local UI defaults if an individual
        // secure record cannot be removed; make the failure observable and
        // continue with the remaining provider records.
        logger.warn("[SettingsService] Failed to remove secure provider setting", {
          key,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Reload to apply defaults
    window.location.reload();
  }
}

export const settingsService = SettingsService.getInstance();
