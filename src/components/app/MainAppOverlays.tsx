import { Suspense } from "react";
import { Dashboard, Settings, FlashcardReview, Omnibar } from "./lazyComponents";
import { RouteErrorBoundary } from "../errors/RouteErrorBoundary";
import { ConsentBanner } from "../ConsentBanner";
import { AIModelHydration, SyncStatus, BackgroundProgress, ReloadPrompt } from "./lazyComponents";
import type { MainAppState } from "./MainAppState";
import type { MainAppEventHandlers } from "./MainAppEventHandlers";

interface MainAppOverlaysProps {
  state: MainAppState;
  handlers: MainAppEventHandlers;
}

export function MainAppOverlays({ state, handlers }: MainAppOverlaysProps) {
  const {
    showAnalysis,
    showOmnibar,
    showFlashcards,
    showSettings,
    showConsentBanner,
    setShowAnalysis,
    setShowOmnibar,
    setShowFlashcards,
    setShowSettings,
    handleConsentDecided,
  } = state;

  const {
    handleOmnibarNavigate,
    handleOmnibarAction,
    handleSelectDocumentFromOmnibar,
    handleSelectBookmarkFromOmnibar,
  } = handlers;

  const isOverlayVisible = showSettings || showAnalysis;

  return (
    <>
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

      {/* Background components — fire-and-forget. Each gets its own
          RouteErrorBoundary so a broken SyncStatus doesn't blank
          AIModelHydration, BackgroundProgress, or ReloadPrompt. */}
      <RouteErrorBoundary fallback={null}>
        <div
          aria-hidden={isOverlayVisible}
          style={isOverlayVisible ? { visibility: "hidden" } : undefined}
        >
          <Suspense fallback={null}>
            <AIModelHydration />
          </Suspense>
        </div>
      </RouteErrorBoundary>
      
      <RouteErrorBoundary fallback={null}>
        <div
          aria-hidden={isOverlayVisible}
          style={isOverlayVisible ? { visibility: "hidden" } : undefined}
        >
          <Suspense fallback={null}>
            <SyncStatus />
          </Suspense>
        </div>
      </RouteErrorBoundary>
      
      <RouteErrorBoundary fallback={null}>
        <div
          aria-hidden={isOverlayVisible}
          style={isOverlayVisible ? { visibility: "hidden" } : undefined}
        >
          <Suspense fallback={null}>
            <BackgroundProgress />
          </Suspense>
        </div>
      </RouteErrorBoundary>
      
      <RouteErrorBoundary fallback={null}>
        <div
          aria-hidden={isOverlayVisible}
          style={isOverlayVisible ? { visibility: "hidden" } : undefined}
        >
          <Suspense fallback={null}>
            <ReloadPrompt />
          </Suspense>
        </div>
      </RouteErrorBoundary>

      {showConsentBanner && (
        <ConsentBanner onConsentDecided={handleConsentDecided} />
      )}
    </>
  );
}