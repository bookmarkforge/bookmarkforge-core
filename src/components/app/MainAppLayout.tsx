import React from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { Header } from "../Header";
import { Sidebar } from "../Sidebar";
import { BottomNav } from "../BottomNav";
import { AppRoutes } from "./AppRoutes";
import type { MainAppState } from "./MainAppState";
import type { MainAppEventHandlers } from "./MainAppEventHandlers";

interface MainAppLayoutProps {
  state: MainAppState;
  handlers: MainAppEventHandlers;
  containerRef: React.RefObject<HTMLDivElement>;
  isRTL: boolean;
}

export function MainAppLayout({ state, handlers, containerRef, isRTL }: MainAppLayoutProps) {
  const { t } = useTranslation();
  
  const {
    activeTab,
    currentDocId,
    showSettings,
    showAnalysis,
    isDistractionFree,
    isDark,
    theme,
    toggleTheme,
    setThemeMode,
    aiStatus,
    setActiveTab,
  } = state;

  const {
    openSettings,
    openSearch,
    handleNavigate,
    handleSelectDocument,
    handleChatSelectSource,
    handleVoiceSearch,
    handleVoiceNavigate,
    handleVoiceAction,
  } = handlers;

  const exitFocusMode = () => {
    state.setIsDistractionFree(false);
  };

  return (
    <div
      ref={containerRef}
      className="min-h-screen flex flex-col md:flex-row ds-bg-primary ds-text-primary"
      dir={isRTL ? "rtl" : "ltr"}
      data-theme={isDark ? "dark" : "light"}
    >
      {/* Skip-to-content for keyboard accessibility — WCAG 2.4.1 Bypass Blocks.
          All styling lives in index.css under `.skip-link`. Inline Tailwind
          utilities like `sr-only focus:not-sr-only` previously caused axe
          color-contrast serious violations (the link's rendered bg was
          `--accent-primary` = #00aeef cyan and the text utility was white =
          2.52:1). With `.skip-link` now providing the full appearance in
          CSS, the element renders at 1×1 clipped until :focus, then expands
          to a pill at the top-left using `--accent-primary` + `--text-on-accent`
          (5.75:1 WCAG AA — contrast-safe in both themes). */}
      <a href="#main-content" className="skip-link">
        {t("app_skipToContent", "Skip to content")}
      </a>
      
      {/* Sidebar - desktop only.
          `contents` (display:contents) avoids generating a 0-width flex box
          around the position:fixed <Sidebar/>, which otherwise makes the
          <nav> invisible to assistive tech / E2E visibility checks while
          the actual sidebar <aside> is correctly sized. */}
      <nav
        aria-label={t("app_mainNavigation", "Main navigation")}
        aria-hidden={
          showSettings || showAnalysis ||
          state.location.pathname === t("routeSettings", "/settings")
        }
        style={
          showSettings || showAnalysis ||
          state.location.pathname === t("routeSettings", "/settings")
            ? { visibility: "hidden" }
            : undefined
        }
        className="contents"
      >
        <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      </nav>

      {/* Main content area */}
      <div
        aria-hidden={showSettings || showAnalysis}
        style={
          showSettings || showAnalysis
            ? { visibility: "hidden" }
            : undefined
        }
        className="flex-1 flex flex-col min-h-screen md:ms-[220px] md:sidebar-collapsed:ms-[64px] transition-[margin-inline-start] duration-200 ease-[var(--ease-out)]"
      >
        {!isDistractionFree && (
          <Header
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            isDark={isDark}
            theme={theme}
            toggleTheme={toggleTheme}
            setThemeMode={setThemeMode}
            onOpenSettings={openSettings}
            onOpenSearch={openSearch}
            aiStatus={aiStatus}
          />
        )}

        {isDistractionFree && (
          <button
            onClick={exitFocusMode}
            className="truncate fixed top-4 right-4 z-50 px-4 py-2 shadow-lg transition-colors flex items-center gap-2 ds-radius-button ds-bg-card ds-text-primary ds-border"
          >
            <X className="size-4" /> {t("exitFocusMode", "Exit Focus Mode")}
          </button>
        )}

        <main
          id="main-content"
          className="flex-1 overflow-y-auto pb-20 md:pb-0"
          data-tour-id="tour-dashboard"
        >
          <AppRoutes
            currentDocId={currentDocId}
            onNavigate={handleNavigate}
            onSelectDocument={handleSelectDocument}
            onChatSelectSource={handleChatSelectSource}
            onVoiceSearch={handleVoiceSearch}
            onVoiceNavigate={handleVoiceNavigate}
            onVoiceAction={handleVoiceAction}
          />
        </main>
      </div>

      <div
        aria-hidden={showSettings || showAnalysis}
        style={
          showSettings || showAnalysis
            ? { visibility: "hidden" }
            : undefined
        }
      >
        <BottomNav
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          onOpenSettings={openSettings}
          onOpenSearch={openSearch}
        />
      </div>
    </div>
  );
}