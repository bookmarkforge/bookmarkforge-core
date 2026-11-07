import { useState, useCallback, useEffect } from "react";
import { useLocation } from "react-router";
import { useTabManager, type TabType } from "../../hooks/useTabManager";
import { useTheme, type Theme } from "../../contexts/ThemeContext";
import { useAIStatus } from "../../hooks/useAIStatus";
import { safeGet, safeSet } from "../../store/safeStorage";
import { hasConsentDecision } from "../ConsentBanner";

export interface MainAppState {
  // Navigation state
  activeTab: string;
  currentDocId: string;
  location: ReturnType<typeof useLocation>;
  setActiveTab: (tab: TabType) => void;
  setCurrentDocId: (id: string) => void;

  // UI state
  showAnalysis: boolean;
  showOmnibar: boolean;
  showFlashcards: boolean;
  showSettings: boolean;
  showConsentBanner: boolean;
  isDistractionFree: boolean;
  showP2PModal: boolean;

  // Theme state
  isDark: boolean;
  theme: Theme;
  toggleTheme: () => void;
  setThemeMode: (mode: Theme) => void;

  // AI status
  aiStatus: ReturnType<typeof useAIStatus>;

  // Actions
  setShowAnalysis: (show: boolean) => void;
  setShowOmnibar: (show: boolean) => void;
  setShowFlashcards: (show: boolean) => void;
  setShowSettings: (show: boolean) => void;
  setShowConsentBanner: (show: boolean) => void;
  setIsDistractionFree: (enabled: boolean) => void;
  setShowP2PModal: (show: boolean) => void;
  exitFocusMode: () => void;
  handleConsentDecided: (consent: { analytics: boolean; errorReporting: boolean; clientEvents: boolean }) => void;
}

export function useMainAppState(): MainAppState {
  const { activeTab, setActiveTab, currentDocId, setCurrentDocId } = useTabManager();
  const { isDark, theme, toggleTheme, setThemeMode } = useTheme();
  const location = useLocation();
  const aiStatus = useAIStatus();

  // UI state
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [showOmnibar, setShowOmnibar] = useState(false);
  const [showFlashcards, setShowFlashcards] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showConsentBanner, setShowConsentBanner] = useState(
    () => !hasConsentDecision()
  );
  const [isDistractionFree, setIsDistractionFree] = useState(() => {
    return safeGet("distraction_free_mode") === "true";
  });
  const [showP2PModal, setShowP2PModal] = useState(false);

  // Handle consent decision (telemetry removed - analytics, error reporting, and client events disabled)
  const handleConsentDecided = useCallback((_consent: { analytics: boolean; errorReporting: boolean; clientEvents: boolean }) => {
    setShowConsentBanner(false);
    // Telemetry services removed per user request - no action taken
  }, []);

  // Distraction free mode handling
  useEffect(() => {
    const handleDistractionFreeModeChange = (e: CustomEvent<boolean>) => {
      setIsDistractionFree(e.detail);
    };

    window.addEventListener(
      "distractionFreeModeChange",
      handleDistractionFreeModeChange as EventListener,
    );

    return () => {
      window.removeEventListener(
        "distractionFreeModeChange",
        handleDistractionFreeModeChange as EventListener,
      );
    };
  }, []);

  const exitFocusMode = () => {
    setIsDistractionFree(false);
    safeSet("distraction_free_mode", "false");
  };

  return {
    // Navigation state
    activeTab: activeTab || "",
    currentDocId,
    location,
    setActiveTab,
    setCurrentDocId,

    // UI state
    showAnalysis,
    showOmnibar,
    showFlashcards,
    showSettings,
    showConsentBanner,
    isDistractionFree,
    showP2PModal,

    // Theme state
    isDark,
    theme,
    toggleTheme,
    setThemeMode,

    // AI status
    aiStatus,

    // Actions
    setShowAnalysis,
    setShowOmnibar,
    setShowFlashcards,
    setShowSettings,
    setShowConsentBanner,
    setIsDistractionFree,
    setShowP2PModal,
    exitFocusMode,
    handleConsentDecided,
  };
}