import { lazy } from "react";

// ─── Lazy-loaded heavy components ────────────────────────────────────
export const GraphView = lazy(() => import("../GraphView"));
export const CanvasView = lazy(() =>
  import("../CanvasView").then((m) => ({ default: m.CanvasView })),
);
export const SharedDocumentView = lazy(() =>
  import("../SharedDocumentView").then((m) => ({
    default: m.SharedDocumentView,
  })),
);
export const FlashcardReview = lazy(() => import("../FlashcardReview"));
export const Omnibar = lazy(() => import("../Omnibar"));
export const DocumentManager = lazy(() => import("../DocumentManager"));
export const KnowledgeDashboard = lazy(() => import("../KnowledgeDashboard"));
export const SecurityDashboard = lazy(
  () => import("../SecurityDashboard").then((m) => ({ default: m.SecurityDashboard })),
);
export const SupportChat = lazy(() => import("../SupportChat"));
export const BlockEditor = lazy(() => import("../block-editor/BlockEditor"));
export const Chat = lazy(() => import("../Chat"));
export const BookmarksTable = lazy(() => import("../bookmarks/BookmarksTable"));

// ─── Premium components (always available, no license required) ────

export const AICopilotPanel = lazy(
  () => import("../BlockEditorParts/AICopilotPanel"),
);

export const ExpertAgentsPanel = lazy(
  () => import("../ai/ExpertAgentsPanel"),
);

export const VoiceCommandCenterWrapper = lazy(
  () => import("../VoiceCommandCenterWrapper").then((m) => ({ default: m.VoiceCommandCenterWrapper })),
);

export const AIModelHydration = lazy(
  () => import("../ai/AIModelHydration").then((m) => ({ default: m.AIModelHydration })),
);

export const BackgroundProgress = lazy(
  () => import("../ai/BackgroundProgress").then((m) => ({ default: m.BackgroundProgress })),
);

export const SyncStatus = lazy(
  () => import("../sync/SyncStatus").then((m) => ({ default: m.SyncStatus })),
);

export const InsightCards = lazy(() => import("../ai/InsightCards"));
export const Settings = lazy(() =>
  import("../Settings").then((m) => ({ default: m.Settings })),
);
export const Dashboard = lazy(() =>
  import("../Dashboard").then((m) => ({ default: m.Dashboard })),
);
export const HomeDashboard = lazy(() =>
  import("../HomeDashboard").then((m) => ({ default: m.HomeDashboard })),
);
export const ReloadPrompt = lazy(() =>
  import("../pwa/ReloadPrompt").then((m) => ({ default: m.ReloadPrompt })),
);
export const Collaboration = lazy(() =>
  import("../Collaboration").then((m) => ({ default: m.Collaboration })),
);

// New Notion-like views (Phase 1)
export const DatabaseView = lazy(() => import("../database/DatabaseView"));
export const KanbanView = lazy(() => import("../kanban/KanbanView"));
export const CalendarView = lazy(() => import("../calendar/CalendarView"));

// New Notion-like views (Phase 2)
export const ListView = lazy(() => import("../list/ListView"));
export const GalleryView = lazy(() => import("../gallery/GalleryView"));
export const TimelineView = lazy(() => import("../timeline/TimelineView"));

// Legal pages
export const PrivacyPage = lazy(() =>
  import("../PrivacyPage").then((m) => ({ default: m.PrivacyPage })),
);
