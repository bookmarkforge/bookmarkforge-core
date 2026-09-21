import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import React from "react";

vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as Record<string, unknown>),
    useTranslation: () => ({
      t: (s: string, options?: any) =>
        typeof options === "object" && options?.defaultValue
          ? options.defaultValue
          : s,
    }),
    initReactI18next: { type: "3rdParty", init: () => {} },
  };
});
vi.mock("react-router", () => ({
  Routes: ({ children }: any) => <div data-testid="routes">{children}</div>,
  Route: () => null,
  Navigate: () => null,
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: "/", search: "", hash: "" }),
}));
vi.mock("../../components/errors/RouteErrorBoundary", () => ({
  RouteErrorBoundary: ({ children }: any) => (
    <div data-testid="route-error-boundary">{children}</div>
  ),
}));
vi.mock("../../components/SuspenseFallback", () => ({
  SuspenseFallback: () => <div data-testid="suspense-fallback" />,
}));

vi.mock("../../components/app/lazyComponents", () => ({
  HomeDashboard: () => <div data-testid="home-dashboard" />,
  BlockEditor: () => <div data-testid="block-editor" />,
  DocumentManager: () => <div data-testid="document-manager" />,
  BookmarksTable: () => <div data-testid="bookmarks-table" />,
  SupportChat: () => <div data-testid="support-chat" />,
  Chat: () => <div data-testid="chat" />,
  GraphView: () => <div data-testid="graph-view" />,
  CanvasView: () => <div data-testid="canvas-view" />,
  SharedDocumentView: () => <div data-testid="shared-document-view" />,
  KnowledgeDashboard: () => <div data-testid="knowledge-dashboard" />,
  SecurityDashboard: () => <div data-testid="security-dashboard" />,
  Collaboration: () => <div data-testid="collaboration" />,
  VoiceCommandCenterWrapper: () => <div data-testid="voice-command-center" />,
  Settings: () => <div data-testid="settings" />,
  DatabaseView: () => <div data-testid="database-view" />,
  KanbanView: () => <div data-testid="kanban-view" />,
  CalendarView: () => <div data-testid="calendar-view" />,
  ListView: () => <div data-testid="list-view" />,
  GalleryView: () => <div data-testid="gallery-view" />,
  TimelineView: () => <div data-testid="timeline-view" />,
  PrivacyPage: () => <div data-testid="privacy-page" />,
}));

const { AppRoutes } = await import("../../components/app/AppRoutes");

describe("AppRoutes", () => {
  const defaultProps = {
    currentDocId: "doc-1",
    onNavigate: vi.fn(),
    onSelectDocument: vi.fn(),
    onChatSelectSource: vi.fn(),
    onVoiceSearch: vi.fn(),
    onVoiceNavigate: vi.fn(),
    onVoiceAction: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders without crashing", () => {
    const { container } = render(<AppRoutes {...defaultProps} />);
    expect(container).toBeTruthy();
  });

  it("renders Routes", () => {
    const { getByTestId } = render(<AppRoutes {...defaultProps} />);
    expect(getByTestId("routes")).toBeTruthy();
  });
});
