"use no memo";
import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { aiManager, AIProvider } from "../services/ai/ProviderManager";
import { toast } from "sonner";
import { logger } from "../utils/logger";
import { safeGet, safeSet } from "../store/safeStorage";
import { STORAGE_KEYS } from "../constants/storage-keys";
import { securityVault } from "../services/SecurityVault";

interface CustomPrompts {
  summarize: string;
  tagging: string;
  chat: string;
}

interface WebLLMProgress {
  text: string;
  progress: number;
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
    let webLLM: { webLLMService: { progressCallback?: unknown } } | null = null;
    import("../services/ai/WebLLMService")
      .then((mod) => {
        webLLM = mod;
        mod.webLLMService.canRunLocalLLM().then(setCanRunWebLLM);
        mod.webLLMService.progressCallback = (progress: WebLLMProgress) => {
          setWebLlmProgress(progress);
        };
      })
      .catch(() => {
        logger.warn("[Settings] WebLLM not available");
      });
    return () => {
      if (webLLM) {
        webLLM.webLLMService.progressCallback = undefined;
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
