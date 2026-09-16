import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router";
import { X } from "lucide-react";
import { safeGet, safeSet } from "../../store/safeStorage";
import { useMemoryPressure } from "../../hooks/useMemoryPressure";
import { useTabManager, type TabType } from "../../hooks/useTabManager";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";
import { useAIStatus } from "../../hooks/useAIStatus";
import { useClipperSync } from "../../hooks/useClipperSync";
import { useAppLifecycle } from "../../hooks/useAppLifecycle";
import { useRoutePrefetch } from "../../hooks/useRoutePrefetch";
import { useRouteTransitionTiming } from "../../hooks/useRouteTransitionTiming";
import { AutoLockManager } from "../../hooks/AutoLockManager";
import { useTheme } from "../../contexts/ThemeContext";
import { isRTLanguage } from "../../utils/localization";
import { Header } from "../Header";
import { Sidebar } from "../Sidebar";
import { KeyboardShortcuts } from "../KeyboardShortcuts";
import { Toaster } from "sonner";
import { initDB } from "../../container/database";
import { generateId } from "../../utils/id";
import {
  Dashboard,
  Settings,
  FlashcardReview,
  Omnibar,
  AIModelHydration,
  SyncStatus,
  BackgroundProgress,
  ReloadPrompt,
} from "./lazyComponents";
import { ProRequiredBoundary } from "../ProRequiredBoundary";
import { AppRoutes } from "./AppRoutes";
import { BottomNav } from "../BottomNav";
import { RouteErrorBoundary } from "../errors/RouteErrorBoundary";
import { ConsentBanner, getStoredConsent, hasConsentDecision } from "../ConsentBanner";
import { analyticsService } from "../../services/AnalyticsService";
import { clearPendingClientEvents } from "../../services/clientEventReporter";
import { initRemoteErrorReporting } from "../../telemetry/remoteErrorReporter";

/**
 * Fresh lazy wrapper per attempt. React.lazy caches the loader promise, so a
 * rejected import (e.g. the deferred chunk fetch raced a network outage) stays
 * rejected for the lifetime of the lazy component — recreating it is the only
 * way to actually retry the dynamic import.
 */
function createQuickCaptureLazy(onFailure?: () => void) {
  return lazy(() =>
    import("../QuickCapture")
      .then((module) => ({ default: module.QuickCapture }))
      .catch((error) => {
        onFailure?.();
        throw error;
      }),
  );
}

/**
 * Quick capture is useful, but it is not part of the first-paint interaction
 * path. Defer requesting its chunk until the browser is idle (with a timeout
 * fallback so the FAB remains available on busy/unsupported browsers).
 */
function DeferredQuickCapture() {
  const [isIdle, setIsIdle] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const importFailedRef = useRef(false);

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let idleId: number | undefined;
    let disposed = false;
    let activated = false;

    const activate = () => {
      if (disposed || activated) {
        return;
      }
      activated = true;
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
      if (idleId !== undefined && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleId);
      }
      setIsIdle(true);
    };

    if (typeof window.requestIdleCallback === "function") {
      // requestIdleCallback's deadline is not a hard guarantee in every
      // browser/scheduler. Keep a real timer fallback so the capture control
      // cannot remain unavailable indefinitely on a busy main thread.
      timeoutId = setTimeout(activate, 2000);
      idleId = window.requestIdleCallback(activate, { timeout: 2000 });
    } else {
      timeoutId = setTimeout(activate, 0);
    }

    return () => {
      disposed = true;
      if (idleId !== undefined && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    };
  }, []);

  // If the deferred chunk fetch failed (network outage before the idle
  // activation), remount the lazy component when connectivity returns so the
  // FAB recovers without a reload. When the chunk loaded fine, leave the
  // component alone — remounting via a fresh React.lazy would suspend the
  // boundary (hiding the FAB) and reset the open-panel state on every
  // network blip.
  useEffect(() => {
    const handleOnline = () => {
      if (!importFailedRef.current) {
        return;
      }
      importFailedRef.current = false;
      setLoadAttempt((attempt) => attempt + 1);
    };
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, []);

  const LazyQuickCapture = useMemo(
    () =>
      createQuickCaptureLazy(() => {
        importFailedRef.current = true;
      }),
    [loadAttempt],
  );

  if (!isIdle) {
    return null;
  }

  return <LazyQuickCapture />;
}

export function MainApp() {
  const { activeTab, setActiveTab, currentDocId, setCurrentDocId } =
    useTabManager();
  const { isDark, theme, toggleTheme, setThemeMode } = useTheme();
  const location = useLocation();
  useRouteTransitionTiming();
  const aiStatus = useAIStatus();

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

  // Route chunks remain lazy and load on navigation. Avoid speculative
  // document-wide prefetching here: in dev it fans out into dozens of module
  // requests, and the routes object is recreated on every render, which also
  // resets the prefetch cache. Explicit intent prefetching can be reintroduced
  // at individual navigation controls when it has measurable value.
  const { containerRef } = useRoutePrefetch({
    enabled: false,
    routes: {
      // Editor excluded intentionally (vendor-blocknote 1.88 MB) — loaded on navigation
      "/bookmarks": () => import("../bookmarks/BookmarksTable"),
      "/chat": () => import("../Chat"),
      "/graph": () => import("../GraphView"),
      "/canvas": () => import("../CanvasView"),
      "/analytics": () => import("../KnowledgeDashboard"),
      "/collaboration": () => import("../Collaboration"),
      "/voiceLocal": () => import("../VoiceCommandCenterWrapper"),
      "/settings": () => import("../Settings"),
    },
  });

  const { t, i18n } = useTranslation();
  const isUnderPressure = useMemoryPressure();
  const isRTL = isRTLanguage(i18n.language);

  const typedActiveTab: string = activeTab || "";

  // <html dir>/<html lang> are managed centrally by the i18n languageChanged
  // listener + boot-time applyLanguageDirection() in src/i18n.ts, so the
  // unlock/onboarding screens (rendered outside MainApp) get the correct
  // direction too. The root div below still carries dir for CSS scoping.
  useAppLifecycle(isUnderPressure, t);

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

  // Navigation bridge for non-router code (e.g. the startup AI hint toast in
  // AppInitializer, which mounts outside the Router): a `bmf:navigate` custom
  // event carries a `tab` that maps through setActiveTab to a route.
  useEffect(() => {
    const handleBmfNavigate = (e: Event) => {
      const tab = (e as CustomEvent<{ tab?: string }>).detail?.tab;
      if (tab && typeof tab === "string") {
        setActiveTab(tab as TabType);
      }
    };
    window.addEventListener("bmf:navigate", handleBmfNavigate);
    return () => window.removeEventListener("bmf:navigate", handleBmfNavigate);
  }, [setActiveTab]);

  useEffect(() => {
    const handleOpenSettings = () => setShowSettings(true);
    window.addEventListener("forge:open-settings", handleOpenSettings);
    return () =>
      window.removeEventListener("forge:open-settings", handleOpenSettings);
  }, []);

  useClipperSync(null, t, setCurrentDocId, setActiveTab);
  useKeyboardShortcuts(
    () => setShowOmnibar(true),
    toggleTheme,
    () => setShowSettings(true),
    setActiveTab,
  );

  const openSettings = () => setShowSettings(true);
  const openSearch = () => setShowOmnibar(true);

  const exitFocusMode = () => {
    setIsDistractionFree(false);
    safeSet("distraction_free_mode", "false");
  };

  const handleNavigate = (tab: string) => {
    setActiveTab(tab as TabType);
  };

  const handleSelectDocument = (id: string) => {
    setCurrentDocId(id);
    setActiveTab("editor");
  };

  const handleChatSelectSource = (
    type: "document" | "bookmark",
    id: string,
  ) => {
    if (type === "document") {
      setCurrentDocId(id);
      setActiveTab("editor");
    } else if (type === "bookmark") {
      setActiveTab("bookmarks");
    }
  };

  const handleVoiceSearch = () => setActiveTab("bookmarks");
  const handleVoiceNavigate = (p: string) => setActiveTab(p as TabType);
  const handleVoiceAction = async (action: string, params: Record<string, unknown>) => {
    const actionMap: Record<string, () => void> = {
      search: () => setShowOmnibar(true),
      bookmark: () => setActiveTab("bookmarks"),
      settings: () => setActiveTab("settings"),
      dashboard: () => setActiveTab("dashboard"),
      chat: () => setActiveTab("chat"),
    };
    const handler = actionMap[action];
    if (handler) {
      handler();
    } else if (params?.tab && typeof params.tab === "string") {
      setActiveTab(params.tab as TabType);
    }
  };

  const handleOmnibarNavigate = (tab: string) => {
    setActiveTab(tab as TabType);
    setShowOmnibar(false);
  };

  const handleOmnibarAction = async (action: string) => {
    if (action === "create_doc") {
      const db = await initDB();
      const id = generateId();
      await db.documents.insert({
        id,
        folderId: "root",
        title: t("app.untitledDocument"),
        blocks: [],
        textContent: "",
        tags: [],
        links: [],
        embedding: [],
        processed: false,
        isPrivate: false,
        isDeleted: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      setCurrentDocId(id);
      setActiveTab("editor");
    } else if (action === "toggle_theme") {
      toggleTheme();
    } else if (action === "show_analysis") {
      setShowAnalysis(true);
    } else if (action === "show_flashcards") {
      setShowFlashcards(true);
    }
    setShowOmnibar(false);
  };

  const handleSelectDocumentFromOmnibar = (id: string) => {
    setCurrentDocId(id);
    setActiveTab("editor");
    setShowOmnibar(false);
  };

  const handleSelectBookmarkFromOmnibar = () => {
    setActiveTab("bookmarks");
    setShowOmnibar(false);
  };

  return (
    <div
      ref={containerRef as React.RefObject<HTMLDivElement>}
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
          location.pathname === t("routeSettings", "/settings")
        }
        style={
          showSettings || showAnalysis ||
          location.pathname === t("routeSettings", "/settings")
            ? { visibility: "hidden" }
            : undefined
        }
        className="contents"
      >
        <Sidebar activeTab={typedActiveTab} setActiveTab={setActiveTab} />
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
            activeTab={typedActiveTab}
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

      {showAnalysis && (
        <RouteErrorBoundary showReset onReset={() => setShowAnalysis(false)}>
          <Dashboard onClose={() => setShowAnalysis(false)} />
        </RouteErrorBoundary>
      )}

      {showOmnibar && (
        <RouteErrorBoundary showReset onReset={() => setShowOmnibar(false)}>
          <Omnibar
            isOpen={showOmnibar}
            onClose={() => setShowOmnibar(false)}
            onNavigate={handleOmnibarNavigate}
            onAction={handleOmnibarAction}
            onSelectDocument={handleSelectDocumentFromOmnibar}
            onSelectBookmark={handleSelectBookmarkFromOmnibar}
          />
        </RouteErrorBoundary>
      )}

      {showFlashcards && (
        <RouteErrorBoundary showReset onReset={() => setShowFlashcards(false)}>
          <FlashcardReview onClose={() => setShowFlashcards(false)} />
        </RouteErrorBoundary>
      )}
      {showSettings && (
        <RouteErrorBoundary showReset onReset={() => setShowSettings(false)}>
          {/* The Settings chunk is lazy; without a local Suspense the whole
              shell unmounts to the App-level "Loading…" fallback while the
              chunk loads, blanking the UI and racing any screenshot taken
              right after opening. fallback={null} keeps the shell visible. */}
          <Suspense fallback={null}>
            <Settings onClose={() => setShowSettings(false)} />
          </Suspense>
        </RouteErrorBoundary>
      )}

      {/* "Available in Pro" overlay for Open Core builds: the placeholder
          helper signals when an inert Pro surface is reached and this
          boundary explains it instead of staying silent. */}
      <ProRequiredBoundary />

      <AutoLockManager />
      <KeyboardShortcuts />
      <RouteErrorBoundary fallback={null}>
        <Suspense fallback={null}>
          <DeferredQuickCapture />
        </Suspense>
      </RouteErrorBoundary>
      {/* Background components — fire-and-forget. Each gets its own
          RouteErrorBoundary so a broken SyncStatus doesn't blank
          AIModelHydration, BackgroundProgress, or ReloadPrompt. */}
      <RouteErrorBoundary fallback={null}>
        <div
          aria-hidden={showSettings || showAnalysis}
          style={
            showSettings || showAnalysis
              ? { visibility: "hidden" }
              : undefined
          }
        >
          <Suspense fallback={null}>
            <AIModelHydration />
          </Suspense>
        </div>
      </RouteErrorBoundary>
      <RouteErrorBoundary fallback={null}>
        <div
          aria-hidden={showSettings || showAnalysis}
          style={
            showSettings || showAnalysis
              ? { visibility: "hidden" }
              : undefined
          }
        >
          <Suspense fallback={null}>
            <SyncStatus />
          </Suspense>
        </div>
      </RouteErrorBoundary>
      <RouteErrorBoundary fallback={null}>
        <div
          aria-hidden={showSettings || showAnalysis}
          style={
            showSettings || showAnalysis
              ? { visibility: "hidden" }
              : undefined
          }
        >
          <Suspense fallback={null}>
            <BackgroundProgress />
          </Suspense>
        </div>
      </RouteErrorBoundary>
      <RouteErrorBoundary fallback={null}>
        <div
          aria-hidden={showSettings || showAnalysis}
          style={
            showSettings || showAnalysis
              ? { visibility: "hidden" }
              : undefined
          }
        >
          <Suspense fallback={null}>
            <ReloadPrompt />
          </Suspense>
        </div>
      </RouteErrorBoundary>
      <Toaster position="bottom-right" theme={isDark ? "dark" : "light"} />
      {showConsentBanner && (
        <ConsentBanner onConsentDecided={handleConsentDecided} />
      )}
      <div
        aria-hidden={showSettings || showAnalysis}
        style={
          showSettings || showAnalysis
            ? { visibility: "hidden" }
            : undefined
        }
      >
        <BottomNav
          activeTab={typedActiveTab}
          setActiveTab={setActiveTab}
          onOpenSettings={openSettings}
          onOpenSearch={openSearch}
        />
      </div>
    </div>
  );
}
