import React, { lazy, Suspense, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useMemoryPressure } from "../../hooks/useMemoryPressure";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";
import { useClipperSync } from "../../hooks/useClipperSync";
import { useAppLifecycle } from "../../hooks/useAppLifecycle";
import { useRoutePrefetch } from "../../hooks/useRoutePrefetch";
import { useRouteTransitionTiming } from "../../hooks/useRouteTransitionTiming";
import { markFirstRunSearchTried } from "../../hooks/useFirstRunChecklist";
import { AutoLockManager } from "../../hooks/AutoLockManager";
import { isRTLanguage } from "../../utils/localization";
import { KeyboardShortcuts } from "../KeyboardShortcuts";
import { Toaster } from "sonner";
import { ProRequiredBoundary } from "../ProRequiredBoundary";
import { RouteErrorBoundary } from "../errors/RouteErrorBoundary";
import { useMainAppState } from "./MainAppState";
import { useMainAppEventHandlers, useMainAppEventListeners } from "./MainAppEventHandlers";
import { MainAppLayout } from "./MainAppLayout";
import { MainAppOverlays } from "./MainAppOverlays";

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
  const [isIdle, setIsIdle] = React.useState(false);
  const [loadAttempt, setLoadAttempt] = React.useState(0);
  const importFailedRef = useRef(false);

  React.useEffect(() => {
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
  React.useEffect(() => {
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
  // Custom hooks for state and event handling
  const state = useMainAppState();
  const handlers = useMainAppEventHandlers(
    state.setActiveTab,
    state.setCurrentDocId,
    state.setShowOmnibar,
    state.setShowSettings,
    state.setShowAnalysis,
    state.setShowFlashcards,
    state.toggleTheme,
  );

  // Lifecycle hooks
  const { t, i18n } = useTranslation();
  const isUnderPressure = useMemoryPressure();
  const isRTL = isRTLanguage(i18n.language);
  useRouteTransitionTiming();

  // Opening search means the user has tried to retrieve something — the last
  // first-run checklist step — recorded at the single place search opens (the
  // shell owns the Omnibar's open state, per MainAppEventHandlers' contract).
  React.useEffect(() => {
    if (state.showOmnibar) markFirstRunSearchTried();
  }, [state.showOmnibar]);

  // <html dir>/<html lang> are managed centrally by the i18n languageChanged
  // listener + boot-time applyLanguageDirection() in src/i18n.ts, so the
  // unlock/onboarding screens (rendered outside MainApp) get the correct
  // direction too. The root div below still carries dir for CSS scoping.
  useAppLifecycle(isUnderPressure, t);

  // Event listeners
  useMainAppEventListeners(
    state.setActiveTab,
    state.setShowOmnibar,
    state.setShowSettings,
  );

  // Other hooks
  useClipperSync(null, t, state.setCurrentDocId, state.setActiveTab);
  useKeyboardShortcuts(
    () => state.setShowOmnibar(true),
    state.toggleTheme,
    () => state.setShowSettings(true),
    state.setActiveTab,
  );

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

  return (
    <>
      <MainAppLayout 
        state={state} 
        handlers={handlers} 
        containerRef={containerRef as React.RefObject<HTMLDivElement>}
        isRTL={isRTL}
      />
      
      <MainAppOverlays state={state} handlers={handlers} />
      
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
      
      <Toaster position="bottom-right" theme={state.isDark ? "dark" : "light"} />
    </>
  );
}
