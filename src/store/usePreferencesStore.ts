/**
 * Centralized Zustand store for user UI preferences.
 *
 * Replaces scattered localStorage.getItem/setItem calls across 30+ files
 * with a single reactive store. Uses a legacy storage adapter that maps
 * Zustand state keys to existing individual localStorage keys, so:
 *
 * 1. Existing users keep their preferences (backward compatible)
 * 2. Tests that mock localStorage still work
 * 3. All preference reads are reactive (no manual useEffect/CustomEvent)
 *
 * @example
 * ```ts
 * const theme = usePreferencesStore((s) => s.theme);
 * usePreferencesStore.getState().setTheme('dark');
 * ```
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { createStorageAdapter } from "./safeStorage";
// Theme type defined inline to avoid JSX import in .ts file
type Theme = "light" | "dark" | "system";

// ─── State shape ───────────────────────────────────────────────────

interface PreferencesState {
  // Appearance
  theme: Theme;
  globalFont: string;
  globalFontSize: number;
  compactMode: boolean;
  distractionFreeMode: boolean;
  sidebarCollapsed: boolean;

  // Language & i18n
  language: string;

  // Editor
  autoSave: boolean;
  autoSaveInterval: number;

  // Security
  autoLockVault: boolean;

  // Custom AI prompts
  customPromptsSummarize: string;
  customPromptsTagging: string;
  customPromptsChat: string;
  customPromptsUnified: string;

  // Actions
  setTheme: (theme: Theme) => void;
  setGlobalFont: (font: string) => void;
  setGlobalFontSize: (size: number) => void;
  setCompactMode: (compact: boolean) => void;
  setDistractionFreeMode: (enabled: boolean) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setLanguage: (lang: string) => void;
  setAutoSave: (autoSave: boolean) => void;
  setAutoSaveInterval: (interval: number) => void;
  setAutoLockVault: (enabled: boolean) => void;
  setCustomPromptsSummarize: (prompt: string) => void;
  setCustomPromptsTagging: (prompt: string) => void;
  setCustomPromptsChat: (prompt: string) => void;
  setCustomPromptsUnified: (json: string) => void;
}

type PreferencesData = Omit<
  PreferencesState,
  | "setTheme"
  | "setGlobalFont"
  | "setGlobalFontSize"
  | "setCompactMode"
  | "setDistractionFreeMode"
  | "setSidebarCollapsed"
  | "setLanguage"
  | "setAutoSave"
  | "setAutoSaveInterval"
  | "setAutoLockVault"
  | "setCustomPromptsSummarize"
  | "setCustomPromptsTagging"
  | "setCustomPromptsChat"
  | "setCustomPromptsUnified"
>;

const LEGACY_KEYS: Record<keyof PreferencesData, string> = {
  theme: "bookmarkforge-theme",
  language: "i18nextLng",
  globalFont: "global_font",
  globalFontSize: "global_font_size",
  distractionFreeMode: "distraction_free_mode",
  autoLockVault: "auto_lock_vault",
  compactMode: "compact-mode",
  autoSave: "auto-save",
  autoSaveInterval: "auto-save-interval",
  sidebarCollapsed: "bookmarkforge_sidebar_collapsed",
  customPromptsSummarize: "custom_prompts_summarize",
  customPromptsTagging: "custom_prompts_tagging",
  customPromptsChat: "custom_prompts_chat",
  customPromptsUnified: "custom_prompts",
};

const PREFERENCES_DEFAULTS: PreferencesData = {
  theme: "system",
  language: "en",
  globalFont: "Inter",
  globalFontSize: 14,
  compactMode: false,
  distractionFreeMode: false,
  sidebarCollapsed: false,
  autoSave: true,
  autoSaveInterval: 30000,
  autoLockVault: true,
  customPromptsSummarize: "",
  customPromptsTagging: "",
  customPromptsChat: "",
  customPromptsUnified: "",
};

const legacyPreferencesStorage = createStorageAdapter<PreferencesData>(
  LEGACY_KEYS,
  PREFERENCES_DEFAULTS,
  {
    read: {
      theme: (raw) => (raw as Theme) || PREFERENCES_DEFAULTS.theme,
      globalFont: (raw) => raw || PREFERENCES_DEFAULTS.globalFont,
      globalFontSize: (raw) => {
        const n = parseInt(raw || "", 10);
        return isNaN(n) ? PREFERENCES_DEFAULTS.globalFontSize : n;
      },
      // L-04: strict parsing — only the literal "true"/"false" is honored;
      // a corrupt value ("0", "undefined", …) must not decide the flag either
      // way, so it falls back to the store default (autoLockVault/autoSave
      // default to true). Missing key → store default too.
      autoLockVault: (raw) => {
        if (raw === null) {return PREFERENCES_DEFAULTS.autoLockVault;}
        if (raw !== "true" && raw !== "false") {
          return PREFERENCES_DEFAULTS.autoLockVault;
        }
        return raw === "true";
      },
      autoSave: (raw) => {
        if (raw === null) {return PREFERENCES_DEFAULTS.autoSave;}
        if (raw !== "true" && raw !== "false") {
          return PREFERENCES_DEFAULTS.autoSave;
        }
        return raw === "true";
      },
      autoSaveInterval: (raw) => {
        const n = parseInt(raw || "", 10);
        return isNaN(n) ? PREFERENCES_DEFAULTS.autoSaveInterval : n;
      },
      language: (raw) => raw || PREFERENCES_DEFAULTS.language,
      customPromptsSummarize: (raw) => raw || "",
      customPromptsTagging: (raw) => raw || "",
      customPromptsChat: (raw) => raw || "",
      customPromptsUnified: (raw) => raw || "",
    },
  },
);

// ─── Store ─────────────────────────────────────────────────────────

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      ...PREFERENCES_DEFAULTS,

      // Appearance
      setTheme: (theme) => set({ theme }),
      setGlobalFont: (globalFont) => set({ globalFont }),
      setGlobalFontSize: (globalFontSize) => set({ globalFontSize }),
      setCompactMode: (compactMode) => set({ compactMode }),
      setDistractionFreeMode: (distractionFreeMode) =>
        set({ distractionFreeMode }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),

      // Language
      setLanguage: (language) => set({ language }),

      // Editor
      setAutoSave: (autoSave) => set({ autoSave }),
      setAutoSaveInterval: (autoSaveInterval) => set({ autoSaveInterval }),

      // Security
      setAutoLockVault: (autoLockVault) => set({ autoLockVault }),

      // Custom prompts
      setCustomPromptsSummarize: (customPromptsSummarize) =>
        set({ customPromptsSummarize }),
      setCustomPromptsTagging: (customPromptsTagging) =>
        set({ customPromptsTagging }),
      setCustomPromptsChat: (customPromptsChat) => set({ customPromptsChat }),
      setCustomPromptsUnified: (customPromptsUnified) =>
        set({ customPromptsUnified }),
    }),
    {
      name: "bookmarkforge-preferences",
      storage: createJSONStorage(() => legacyPreferencesStorage),
      // Only persist data fields, not action functions
      partialize: (state) => ({
        theme: state.theme,
        language: state.language,
        globalFont: state.globalFont,
        globalFontSize: state.globalFontSize,
        compactMode: state.compactMode,
        distractionFreeMode: state.distractionFreeMode,
        sidebarCollapsed: state.sidebarCollapsed,
        autoSave: state.autoSave,
        autoSaveInterval: state.autoSaveInterval,
        autoLockVault: state.autoLockVault,
        customPromptsSummarize: state.customPromptsSummarize,
        customPromptsTagging: state.customPromptsTagging,
        customPromptsChat: state.customPromptsChat,
        customPromptsUnified: state.customPromptsUnified,
      }),
    },
  ),
);

// Convenience getter for non-reactive contexts.
// Not exported — use usePreferencesStore directly.
