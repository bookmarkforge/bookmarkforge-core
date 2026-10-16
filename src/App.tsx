import React, { Suspense, lazy } from "react";
import { ErrorBoundaryWrapper } from "./components/ErrorBoundary";
import { AppInitializer } from "./components/AppInitializer";
import { computeShareRewrite } from "./utils/shareRewrite";

const MantineThemeProvider = lazy(
  () => import("./components/MantineThemeProvider"),
);
const MotionThemeProvider = lazy(
  () => import("./components/MotionThemeProvider"),
);
const AppContent = lazy(() =>
  import("./components/app").then((m) => ({ default: m.AppContent })),
);

const CaptureApp = lazy(() =>
  import("./components/app/CaptureApp").then((m) => ({
    default: m.CaptureApp,
  })),
);

const TokenCatalog =
  import.meta.env.DEV
    ? lazy(() =>
        import("./components/dev/TokenCatalog").then((m) => ({
          default: m.TokenCatalog,
        })),
      )
    : null;

/* The Skip-link lives in MainApp.tsx (single source of truth at the page
   body root, just inside <main id="main-content">). Earlier pass added a
   duplicate SkipLink here in App.tsx, but App.tsx renders above the React
   Router boundary — placing a skip-link there fails axe's `region` rule
   (the element is rendered outside any <main>/<nav>/<header> landmark)
   AND introduced a redundant focus target. Use the MainApp skip-link only. */

/**
 * Capture any share-target / extension / `web+bookmark:` parameters that
 * arrived in the URL search string (`?url=`, `?title=`, `?text=`, `?add=`)
 * and rewrite the document URL to fragment-only form via
 * `history.replaceState`. Runs ONCE per document lifecycle: the
 * `dataset.bmfCaptured` flag prevents the back-button from re-entering
 * this code path with the same body.
 *
 * Why fragment-hash and not GET params? The PWA `share_target` and the
 * `web+bookmark:` protocol handler both deliver the bookmark URL in
 * GET. GET shows up in browser history, the server-side access log
 * (if served via CDN), and the Referer header on the first resource
 * load afterwards. The fragment is NEVER sent to the server, so
 * capturing the URLs into `#url=…&title=…` BEFORE React mounts means
 * the network panel sees only a self-origin reload with zero
 * parameters — privacy stance aligned with the extension (which
 * adds URLs to `chrome.tabs.create` URLs via fragment hash).
 *
 * Why not `popstate`? `replaceState` does not natively emit popstate,
 * and synthetic popstate dispatched immediately is unreliable for
 * React Router 7. Calling `replaceState` synchronously before
 * `<AppContent>` mounts updates `window.location` BEFORE the router is
 * instantiated, so the router picks up the safe pathname directly.
 */
function captureShareParamsToHashOnce(): void {
  if (typeof window === "undefined") {
    return;
  }

  const { path, search, hash, rewrote } = computeShareRewrite(
    window.location.search,
    window.location.hash,
    window.location.pathname,
  );

  // Only stamp the one-shot guard when a rewrite actually happened.
  // Otherwise a user who first lands on `/capture#url=…` from the
  // browser extension (no GET params to migrate) would have the
  // dataset flag set permanently, blocking legitimate share_target
  // rewrites for the rest of the document lifetime.
  if (!rewrote) {
    return;
  }
  document.documentElement.dataset.bmfCaptured = "1";

  const newUrl =
    path + (search ? `?${search}` : "") + (hash ? `#${hash}` : "");
  try {
    window.history.replaceState(null, "", newUrl);
  } catch {
    /* INTENTIONAL SILENCE: an unwritable URL leaves Capture's first-render fallback intact. */
  }
}

// Run the share-param capture ONCE at module-load time, BEFORE any
// React render reads window.location. This is preferable to calling
// it inside the App() render body because:
//   * Module-load semantics guarantee a single execution (no React
//     StrictMode double-render race, no concurrent-rendering hazard).
//   * The synchronous rewrite updates window.location before React
//     Router (inside <AppContent>) is even instantiated.
//   * The dataset one-shot guard is no longer needed — module-load
//     runs exactly once per import, and HMR's module replacement
//     re-imports the function definition but does NOT duplicate the
//     application of the URL rewrite (caller's URL was already mutated).
//
// PRODUCTION-ONLY: tests that import App.tsx (component spec, integration
// smoke) would otherwise execute this at module load and silently
// rewrite jsdom's `window.location` + stamp `<html data-bmf-captured>`,
// polluting test isolation across the pool. Dev mode is excluded too:
// HMR re-evaluation in `vite dev` mutates the URL the developer is
// debugging, producing phantom history entries and breaking the
// URL inspector in DevTools.
if (import.meta.env.PROD && typeof window !== "undefined") {
  captureShareParamsToHashOnce();
}

function LoadingFallback() {
  // Intentionally NOT using useTranslation(): React Suspense fallbacks
  // cannot themselves suspend. The hardcoded fallback string keeps
  // the absolute-first visual feedback synchronous and avoids a
  // recursive SUSPENDED_WHILE_LOADING warning on every cold boot.
  return (
    <div className="min-h-screen bg-app-bg flex items-center justify-center text-text-primary">
      Loading…
    </div>
  );
}

function CatalogRoute(): React.ReactElement | null {
  if (!TokenCatalog) {return null;}
  return (
    <ErrorBoundaryWrapper>
      <Suspense fallback={<LoadingFallback />}>
        <TokenCatalog />
      </Suspense>
    </ErrorBoundaryWrapper>
  );
}

export default function App() {
  // Step 1: share-target / extension `?url=…&title=…` / `?add=…`
  // have already been migrated to `#url=…&title=…` at module top
  // level (see `captureShareParamsToHashOnce()` invocation right
  // after the function definition). Reading the path here reflects
  // the safe, fragment-only URL.

  // Step 2: Decide which branch to render based on the now-safe URL.
  // We read the path on every render — `replaceState` mutated
  // window.location synchronously, so this is up to date by the time
  // React reads it.
  const path =
    typeof window !== "undefined" ? window.location.pathname : "/";
  const sp =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search)
      : new URLSearchParams();

  const isResetting = sp.get("reset") === "true";
  const isCatalog =
    import.meta.env.DEV && sp.get("catalog") === "true";
  const isCapture = path === "/capture";

  if (isCatalog) {
    return <CatalogRoute />;
  }

  if (isResetting) {
    return (
      <ErrorBoundaryWrapper>
        <AppInitializer />
      </ErrorBoundaryWrapper>
    );
  }

  if (isCapture) {
    // Capture branch — synchronously mounts <CaptureApp> with
    // fragment-hash params that `Capture.tsx` already knows how to
    // read. No route event needed because the URL was rewritten
    // BEFORE React rendered, and the router (inside <AppContent>)
    // hasn't mounted yet for this branch.
    return (
      <ErrorBoundaryWrapper>
        <AppInitializer />
        <Suspense fallback={<LoadingFallback />}>
          <CaptureApp />
        </Suspense>
      </ErrorBoundaryWrapper>
    );
  }

  return (
    <ErrorBoundaryWrapper>
      <Suspense fallback={<LoadingFallback />}>
        <MotionThemeProvider>
          <AppInitializer />
          <MantineThemeProvider>
            <Suspense fallback={<LoadingFallback />}>
              <AppContent />
            </Suspense>
          </MantineThemeProvider>
        </MotionThemeProvider>
      </Suspense>
    </ErrorBoundaryWrapper>
  );
}
