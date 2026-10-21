export { AppContent } from "./AppContent";
// `AppRoutes` is intentionally NOT re-exported here: it statically imports
// `motion/react` (ui-runtime vendor chunk) and is only consumed by the
// lazy `MainApp`. Re-exporting it through this eager barrel (which
// App.tsx imports for `AppContent`) drags ui-runtime onto the entry
// critical path. Import it from `./AppRoutes` directly.
// `MainApp` is intentionally NOT re-exported here: `AppContent` mounts it
// via `lazy(() => import("./MainApp"))`. Re-exporting it through this
// eager barrel would pull the full authenticated shell into the entry.
// Import it from `./MainApp` directly when a static import is required.
//
// `CaptureApp` is intentionally NOT re-exported here: `App.tsx` mounts it
// via `lazy(() => import("./components/app/CaptureApp"))`. Re-exporting it
// through this barrel (which the eager shell imports for `AppContent`)
// would drag the full CaptureApp chunk into the entry critical path,
// defeating the code splitting. Import it from `./CaptureApp` directly.
// Individual lazy components imported directly via lazyComponents.ts — not
// re-exported here to avoid pulling all lazy chunks into the eager bundle.
