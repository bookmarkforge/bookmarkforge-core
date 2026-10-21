"use no memo";
import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { aiManager, AIProvider } from "../services/ai/ProviderManager";
import { toast } from "sonner";
import { logger } from "../utils/logger";
import { safeGet, safeSet } from "../store/safeStorage";
import { STORAGE_KEYS } from "../constants/storage-keys";
import { securityVault } from "../services/SecurityVault";
import { loadWebLLMService, ProUnavailableError } from "../services/pro-access";
import {
  getNavigatorExtensions,
  getNavigatorGPU,
} from "../utils/browser-types";

interface CustomPrompts {
  summarize: string;
  tagging: string;
  chat: string;
}

interface WebLLMProgress {
  text: string;
  progress: number;
}

/**
 * Device-capability verdict for the Settings WebLLM option, usable without
 * the Pro chunk. Mirrors WebLLMService.canRunLocalLLM()'s three hard gates
 * (WebGPU surface + shader-f16 + 4 GB RAM floor), fail-closed: any probe
 * failure means "cannot run". Uses only navigator APIs — no Pro imports,
 * so it is safe for Free sessions and the Open Core export.
 */
async function probeDeviceCanRunLocalLLM(): Promise<boolean> {
  try {
    const gpu = getNavigatorGPU();
    if (!gpu) return false;
    const adapter =
      (await gpu.requestAdapter({ powerPreference: "high-performance" })) ||
      (await gpu.requestAdapter({ powerPreference: "low-power" }));
    if (!adapter) return false;
    const features = (
      adapter as unknown as { features?: { has: (name: string) => boolean } }
    ).features;
    if (!features?.has("shader-f16")) return false;
    const { deviceMemory } = getNavigatorExtensions();
    return (deviceMemory || 4) >= 4;
  } catch {
    return false;
  }
}

export function useSettings() {
  const { t, i18n } = useTranslation();

  // Appearance state
  // Theme state is now managed globally by ThemeContext
  // Removing local isDark to avoid conflicts
  const [globalFont, setGlobalFont] = useState<
    "sans-serif" | "serif" | "monospace"
  >(() => {
    const stored = safeGet(STORAGE_KEYS.GLOBAL_FONT) as
      "sans-serif" | "serif" | "monospace";
    return stored || "sans-serif";
  });
  const [globalFontSize, setGlobalFontSize] = useState(() => {
    const stored = safeGet(STORAGE_KEYS.GLOBAL_FONT_SIZE);
    return stored ? parseInt(stored) : 16;
  });

  // Language — sourced reactively from i18n. `useTranslation()` subscribes
  // to `languageChanged` internally, so this hook re-renders whenever
  // i18n.language changes, and `lang` picks up the new value. The matching
  // setLang delegates to `i18n.changeLanguage`, which fires `languageChanged`
  // — the listener in src/i18n.ts handles all side-effects (localStorage
  // write + Zustand mirror) in a single sync point. Eliminates the prior
  // local `useState` + manual `i18n.on('languageChanged', ...)` pattern.
  const lang = i18n.language || "en";
  const setLang = useCallback((code: string) => {
    void i18n.changeLanguage(code);
  }, [i18n]);

  // Security
  const [apiKey, setApiKey] = useState(() => aiManager.getApiKey() || "");
  const [vaultKey, setVaultKey] = useState("");
  const [masterPassword, setMasterPassword] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);

  // SECURITY (S9): apiKey (decrypted via aiManager.getApiKey()), vaultKey and
  // masterPassword are secrets held in React state — outside the vault/config
  // tree — and would survive a vault lock in memory. Purge them synchronously
  // when the vault locks.
  useEffect(() => {
    return securityVault.onLock(() => {
      setApiKey("");
      setVaultKey("");
      setMasterPassword("");
    });
  }, []);
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);

  // AI
  const [provider, setProvider] = useState(() => aiManager.getProviderInfo());
  const [availableModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [canRunWebLLM, setCanRunWebLLM] = useState(true);
  const [webLlmProgress, setWebLlmProgress] = useState<WebLLMProgress | null>(
    null,
  );

  // Feature flags
  const [isDistractionFree, setIsDistractionFree] = useState(() => {
    return safeGet(STORAGE_KEYS.DISTRACTION_FREE_MODE) === "true";
  });

  const [autoLockEnabled, setAutoLockEnabled] = useState(() => {
    return safeGet(STORAGE_KEYS.AUTO_LOCK_VAULT) !== "false";
  });

  const [autoLockTimeout, setAutoLockTimeout] = useState(() => {
    const stored = safeGet(STORAGE_KEYS.AUTO_LOCK_TIMEOUT);
    return stored ? parseInt(stored) : 300000; // 5 minutes default
  });

  // Custom prompts
  const [customPrompts, setCustomPrompts] = useState<CustomPrompts>({
    summarize: safeGet(STORAGE_KEYS.CUSTOM_PROMPTS_SUMMARIZE) || "",
    tagging: safeGet(STORAGE_KEYS.CUSTOM_PROMPTS_TAGGING) || "",
    chat: safeGet(STORAGE_KEYS.CUSTOM_PROMPTS_CHAT) || "",
  });

  // Effects
  useEffect(() => {
    safeSet(STORAGE_KEYS.DISTRACTION_FREE_MODE, isDistractionFree.toString());
    window.dispatchEvent(
      new CustomEvent("distractionFreeModeChange", {
        detail: isDistractionFree,
      }),
    );
  }, [isDistractionFree]);

  useEffect(() => {
    safeSet(STORAGE_KEYS.AUTO_LOCK_VAULT, autoLockEnabled.toString());
  }, [autoLockEnabled]);

  useEffect(() => {
    safeSet(STORAGE_KEYS.AUTO_LOCK_TIMEOUT, autoLockTimeout.toString());
  }, [autoLockTimeout]);

  useEffect(() => {
    // On mount, check localStorage for saved language. Defensive: this
    // also guards against the case where the initial localStorage value
    // is loaded after i18n.init() finishes (e.g., Zustand hydration lag).
    const savedLang = safeGet(STORAGE_KEYS.I18N_LANGUAGE);
    if (savedLang && savedLang !== i18n.language) {
      void i18n.changeLanguage(savedLang);
    }
  }, [i18n]);

  useEffect(() => {
    safeSet(STORAGE_KEYS.GLOBAL_FONT, globalFont);
    const fontFamily =
      globalFont === "serif"
        ? "Georgia, serif"
        : globalFont === "monospace"
          ? "monospace"
          : "system-ui, sans-serif";
    document.documentElement.style.setProperty(
      "--font-family-global",
      fontFamily,
    );
  }, [globalFont]);

  useEffect(() => {
    safeSet(STORAGE_KEYS.GLOBAL_FONT_SIZE, globalFontSize.toString());
    document.documentElement.style.setProperty(
      "--font-size-global",
      `${globalFontSize}px`,
    );
  }, [globalFontSize]);

  useEffect(() => {
    let disposed = false;
    let unsubscribed = false;
    let webLLM: { progressCallback?: unknown } | null = null;
    // Pro resolution through the loader: a Free session (or an Open Core
    // export) never downloads the WebLLM chunk — the capability <option>
    // simply stays disabled and the progress card stays hidden.
    loadWebLLMService()
      .then((service) => {
        if (disposed || unsubscribed) return;
        webLLM = service;
        // canRunWebLLM is the device-capability verdict ONLY
        // (canRunLocalLLM(): WebGPU surface + shader-f16 + >= 4 GB RAM).
        // It drives whether the Settings <option> is enabled — never an
        // engine/model state. See AIConfigSection's {canRunWebLLM && ...}
        // render and the E2E capability profiles.
        service.canRunLocalLLM().then((result) => {
          if (!disposed) setCanRunWebLLM(result);
        });
        service.progressCallback = (progress: WebLLMProgress) => {
          if (!disposed) setWebLlmProgress(progress);
        };
      })
      .catch((err: unknown) => {
        if (disposed) return;
        if (!(err instanceof ProUnavailableError)) {
          logger.warn("[Settings] WebLLM not available");
        }
        // The device verdict must stay honest even when the Pro chunk never
        // loads (Free session) or the loader fails: probe the device
        // directly so an incapable device shows "(Unsupported Device)"
        // instead of a misleading "— Pro" that a purchase could never fix.
        void probeDeviceCanRunLocalLLM().then((verdict) => {
          if (!disposed) setCanRunWebLLM(verdict);
        });
      });
    return () => {
      disposed = true;
      unsubscribed = true;
      if (webLLM) {
        webLLM.progressCallback = undefined;
      }
    };
  }, []);

  // Actions
  const handleUpdateVaultKey = useCallback(async () => {
    if (!vaultKey.trim()) {
      toast.error(t("app_passwordEmpty"));
      return;
    }
    setIsUpdatingPassword(true);
    try {
      await aiManager.updateMasterPassword(vaultKey);
      setMasterPassword(vaultKey);
      toast.success(t("app_passwordUpdated"));
      setVaultKey("");
    } catch (_err) {
      toast.error(t("app_passwordUpdateError"));
    } finally {
      setIsUpdatingPassword(false);
    }
  }, [vaultKey, t]);

  const handleSavePrompts = useCallback(() => {
    safeSet(STORAGE_KEYS.CUSTOM_PROMPTS_SUMMARIZE, customPrompts.summarize);
    safeSet(STORAGE_KEYS.CUSTOM_PROMPTS_TAGGING, customPrompts.tagging);
    safeSet(STORAGE_KEYS.CUSTOM_PROMPTS_CHAT, customPrompts.chat);

    const unified = {
      summary: customPrompts.summarize,
      tagging: customPrompts.tagging,
      chat: customPrompts.chat,
    };
    safeSet(STORAGE_KEYS.CUSTOM_PROMPTS, JSON.stringify(unified));

    toast.success(t("app_promptsSaved"));
  }, [customPrompts, t]);

  const handleProviderChange = useCallback(async (newProvider: AIProvider) => {
    await aiManager.setProvider(newProvider);
    setApiKey(aiManager.getApiKey() || "");
    setProvider(aiManager.getProviderInfo());
  }, []);

  const handleApiKeySave = useCallback(
    async (key: string) => {
      try {
        await aiManager.setApiKey(key);
        toast.success(t("app_apiKeySaved"));
        setProvider(aiManager.getProviderInfo());
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : t("app_apiKeyError"),
        );
      }
    },
    [t],
  );

  return {
    // Appearance
    globalFont,
    setGlobalFont,
    globalFontSize,
    setGlobalFontSize,

    // Language
    lang,
    setLang,

    // Security
    apiKey,
    setApiKey,
    vaultKey,
    setVaultKey,
    masterPassword,
    setMasterPassword,
    showApiKey,
    setShowApiKey,
    isUpdatingPassword,
    handleUpdateVaultKey,

    // AI
    provider,
    availableModels,
    selectedModel,
    setSelectedModel,
    canRunWebLLM,
    webLlmProgress,
    handleProviderChange,
    handleApiKeySave,

    // Features
    isDistractionFree,
    setIsDistractionFree,
    autoLockEnabled,
    setAutoLockEnabled,
    autoLockTimeout,
    setAutoLockTimeout,

    // Prompts
    customPrompts,
    setCustomPrompts,
    handleSavePrompts,

    // i18n
    t,
  };
}
