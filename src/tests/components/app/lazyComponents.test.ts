import { describe, it, expect, vi } from "vitest";
import * as lazyComponents from "../../../components/app/lazyComponents";

const REACT_LAZY_TYPE = Symbol.for("react.lazy");

// Mock every lazy() target so resolving the lazy factories does not import
// the real (heavy) components and cannot hit the network/DOM. Every stub
// must be a RENDERABLE component (React lazy defaults must resolve to a
// class/function), so all mocks return `() => null` functions regardless of
// whether the lazy normalizes a named export to default.
const stubComponent = () => null;
vi.mock("../../../components/GraphView", () => ({ default: stubComponent }));
vi.mock("../../../components/CanvasView", () => ({ CanvasView: stubComponent }));
vi.mock("../../../components/SharedDocumentView", () => ({
  SharedDocumentView: stubComponent,
}));
vi.mock("../../../components/FlashcardReview", () => ({ default: stubComponent }));
vi.mock("../../../components/Omnibar", () => ({ default: stubComponent }));
vi.mock("../../../components/DocumentManager", () => ({ default: stubComponent }));
vi.mock("../../../components/KnowledgeDashboard", () => ({ default: stubComponent }));
vi.mock("../../../components/SecurityDashboard", () => ({ SecurityDashboard: stubComponent }));
vi.mock("../../../components/SupportChat", () => ({ default: stubComponent }));
vi.mock("../../../components/BlockEditor", () => ({ BlockEditor: stubComponent }));
vi.mock("../../../components/Chat", () => ({ default: stubComponent }));
vi.mock("../../../components/bookmarks/BookmarksTable", () => ({
  default: stubComponent,
}));
vi.mock("../../../components/BlockEditorParts/AICopilotPanel", () => ({
  default: stubComponent,
}));
vi.mock("../../../components/ai/ExpertAgentsPanel", () => ({ default: stubComponent }));
vi.mock("../../../components/VoiceCommandCenterWrapper", () => ({
  VoiceCommandCenterWrapper: stubComponent,
}));
vi.mock("../../../components/ai/AIModelHydration", () => ({
  AIModelHydration: stubComponent,
}));
vi.mock("../../../components/ai/BackgroundProgress", () => ({
  BackgroundProgress: stubComponent,
}));
vi.mock("../../../components/sync/SyncStatus", () => ({
  SyncStatus: stubComponent,
}));
vi.mock("../../../components/ai/InsightCards", () => ({ default: stubComponent }));
vi.mock("../../../components/Settings", () => ({ Settings: stubComponent }));
vi.mock("../../../components/Dashboard", () => ({ Dashboard: stubComponent }));
vi.mock("../../../components/HomeDashboard", () => ({
  HomeDashboard: stubComponent,
}));
vi.mock("../../../components/Collaboration", () => ({
  Collaboration: stubComponent,
  default: stubComponent,
}));
vi.mock("../../../components/database/DatabaseView", () => ({ default: stubComponent }));
vi.mock("../../../components/kanban/KanbanView", () => ({ default: stubComponent }));
vi.mock("../../../components/calendar/CalendarView", () => ({ default: stubComponent }));
vi.mock("../../../components/list/ListView", () => ({ default: stubComponent }));
vi.mock("../../../components/gallery/GalleryView", () => ({ default: stubComponent }));
vi.mock("../../../components/timeline/TimelineView", () => ({ default: stubComponent }));
vi.mock("../../../components/PrivacyPage", () => ({
  PrivacyPage: stubComponent,
}));

// The barrel is the single source of truth for the lazy surface. Deriving the
// names from it keeps this test correct when an export is added or removed,
// instead of a second hardcoded list that silently drifts from the barrel.
const LAZY_EXPORT_NAMES = Object.keys(lazyComponents).sort();

describe("lazyComponents barrel", () => {
  it("exports only lazy components (no eager import leak)", () => {
    expect(LAZY_EXPORT_NAMES.length).toBeGreaterThan(0);
    for (const name of LAZY_EXPORT_NAMES) {
      const component = (lazyComponents as Record<string, unknown>)[name];
      expect(component, `${name} should be exported`).toBeDefined();
      expect(
        (component as { $$typeof: symbol }).$$typeof,
        `${name} should be a lazy component (no eager import leak)`,
      ).toBe(REACT_LAZY_TYPE);
    }
  });

  it("every lazy() resolves through its dynamic import to a module (wiring + normalization)", async () => {
    // Render each lazy inside a Suspense boundary and await the resolution.
    // This exercises the `() => import(...)` factory AND the
    // `{ default: ... }` normalization — a typo in a target path or in a
    // `.then(m => ({ default: m.X }))` mapping would reject the promise and
    // fail this test (the earlier _payload-only smoke test could not catch
    // normalization typos because it never awaited).
    const { render, act } = await import("@testing-library/react");
    const React = await import("react");
    const { Suspense } = React;
    for (const name of LAZY_EXPORT_NAMES) {
      const Component = (lazyComponents as Record<string, unknown>)[name] as React.ComponentType;
      // Mount the lazy component inside a Suspense boundary and flush via
      // act() so its dynamic import resolves; a broken target path or a
      // normalization typo rejects the promise and fails this test.
      await act(async () => {
        render(
          React.createElement(
            Suspense,
            { fallback: null },
            React.createElement(Component),
          ),
        );
      });
    }
  });
});
