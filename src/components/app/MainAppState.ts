import { useState, useCallback, useEffect } from "react";
import { useLocation } from "react-router";
import { useTabManager, type TabType } from "../../hooks/useTabManager";
import { useTheme, type Theme } from "../../contexts/ThemeContext";
import { useAIStatus } from "../../hooks/useAIStatus";
import { safeGet, safeSet } from "../../store/safeStorage";
import { getStoredConsent, hasConsentDecision } from "../ConsentBanner";
import { analyticsService } from "../../services/AnalyticsService";
import { clearPendingClientEvents } from "../../services/clientEventReporter";
import { initRemoteErrorReporting } from "../../telemetry/remoteErrorReporter";

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

  // Start analytics and reporting based on stored consent on mount.
  useEffect(() => {
    const consent = getStoredConsent();
    if (consent) {
      if (consent.analytics) {
        analyticsService.start();
      }
      // Error reporting and client events are independently gated by their
      // own forge_consent_* keys. No shared legacy key is used for remote
      // purposes, so no additional startup authorization is needed here.
    }
  }, []);

  const handleConsentDecided = useCallback((consent: { analytics: boolean; errorReporting: boolean; clientEvents: boolean }) => {
    setShowConsentBanner(false);
    if (consent.analytics) {
      analyticsService.start();
    } else {
      analyticsService.stop();
    }
    if (consent.errorReporting) {
      void initRemoteErrorReporting();
    }
    if (!consent.clientEvents) {
      clearPendingClientEvents();
    }
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
    exitFocusMode,
    handleConsentDecided,
  };
}