import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { Sidebar } from "../../components/Sidebar";

vi.mock("../../hooks/useRxDB", () => ({
  useRxDB: vi.fn(() => ({})),
}));

vi.mock("react-i18next", () => {
  const map: Record<string, string> = {
    app_dashboard: "Dashboard",
    app_documents: "Documents",
    app_bookmarksTitle: "Bookmarks",
    app_graph: "Graph",
    app_chatLocal: "Chat",
    app_voiceLocal: "Voice",
    app_collaborationTitle: "Collaboration",
    app_analytics: "Analytics",
    app_bookmarkForge: "BookmarkForge",
    app_collapseSidebar: "Collapse sidebar",
    app_expandSidebar: "Expand sidebar",
    app_database: "Database",
    app_kanban: "Kanban",
    app_calendar: "Calendar",
    app_securityDashboard: "Security",
  };
  return {
    useTranslation: () => ({
      t: (key: string, fallback?: any) =>
        map[key] ||
        (typeof fallback === "object" ? fallback?.defaultValue : fallback) ||
        key,
    }),
    initReactI18next: { type: "3rdParty", init: () => {} },
  };
});

vi.mock("motion/react", async () => {
  const { createMotionMock } = await import("../mocks/motion");
  return createMotionMock();
});

vi.mock("lucide-react", () => ({
  LayoutDashboard: () => <svg data-testid="icon-dashboard" />,
  FileText: () => <svg data-testid="icon-documents" />,
  Bookmark: () => <svg data-testid="icon-bookmarks" />,
  Share2: () => <svg data-testid="icon-graph" />,
  MessageSquare: () => <svg data-testid="icon-chat" />,
  Mic: () => <svg data-testid="icon-voice" />,
  Users: () => <svg data-testid="icon-collab" />,
  Activity: () => <svg data-testid="icon-analytics" />,
  HelpCircle: () => <svg data-testid="icon-support" />,
  PanelLeftClose: () => <svg data-testid="icon-collapse" />,
  Table: () => <svg data-testid="icon-database" />,
  Columns: () => <svg data-testid="icon-kanban" />,
  CalendarDays: () => <svg data-testid="icon-calendar" />,
  List: () => <svg data-testid="icon-list" />,
  Grid3X3: () => <svg data-testid="icon-gallery" />,
  History: () => <svg data-testid="icon-timeline" />,
  Copy: () => <svg data-testid="icon-copy" />,
  ShieldCheck: () => <svg data-testid="icon-security" />,
}));

const mockCollaborationStart = vi.fn().mockResolvedValue(undefined);
vi.mock("../../services/CollaborationService", () => ({
  collaborationService: { start: mockCollaborationStart },
}));

vi.mock("react-qr-code", () => ({
  default: () => <svg data-testid="qr" />,
}));

const defaultProps = {
  activeTab: "dashboard",
  setActiveTab: vi.fn(),
};

beforeEach(() => {
  localStorage.clear();
  mockCollaborationStart.mockClear();
});

describe("Sidebar", () => {
  it("renders navigation items", () => {
    render(<Sidebar {...defaultProps} />);
    expect(screen.getByText("Dashboard")).toBeDefined();
    expect(screen.getByText("Bookmarks")).toBeDefined();
    expect(screen.getByText("Documents")).toBeDefined();
  });

  it("highlights active tab", () => {
    render(<Sidebar {...defaultProps} activeTab="bookmarks" />);
    const buttons = screen.getAllByRole("button");
    const bookmarksBtn = buttons.find((b) =>
      b.textContent?.includes("Bookmarks"),
    );
    expect(bookmarksBtn!.className).toContain("active");
  });

  it("calls setActiveTab on click", async () => {
    const setActiveTab = vi.fn();
    render(<Sidebar {...defaultProps} setActiveTab={setActiveTab} />);
    await userEvent.click(screen.getByText("Bookmarks"));
    expect(setActiveTab).toHaveBeenCalledWith("bookmarks");
  });

  it("toggles collapsed state", async () => {
    render(<Sidebar {...defaultProps} />);
    const collapseBtn = screen.getByLabelText("Collapse sidebar");
    await userEvent.click(collapseBtn);
    expect(localStorage.getItem("bookmarkforge_sidebar_collapsed")).toBe(
      "true",
    );
  });

  it("persists collapsed state from localStorage", () => {
    localStorage.setItem("bookmarkforge_sidebar_collapsed", "true");
    render(<Sidebar {...defaultProps} />);
    expect(screen.getByLabelText("Expand sidebar")).toBeDefined();
  });

  it("renders logo image", () => {
    render(<Sidebar {...defaultProps} />);
    const logo = document.querySelector('img[alt="BookmarkForge"]');
    expect(logo).not.toBeNull();
    expect(logo!.getAttribute("src")).toBe("/logo-64.png");
  });

  it("renders all navigation sections", () => {
    render(<Sidebar {...defaultProps} />);
    const sections = [
      "Dashboard",
      "Documents",
      "Bookmarks",
      "Graph",
      "Canvas",
      "Chat",
      "Voice",
      "Collaboration",
      "Analytics",
      "Support",
    ];
    for (const s of sections) {
      expect(screen.getByText(s)).toBeDefined();
    }
  });

  it("opens the share modal and generates a share link", async () => {
    mockCollaborationStart.mockResolvedValue(undefined);
    render(<Sidebar {...defaultProps} />);
    await userEvent.click(screen.getByText("Share Collection"));
    const input = await screen.findByLabelText("Collection / Folder name");
    await userEvent.type(input, "Research Papers");
    await userEvent.click(screen.getByText("Generate Share Link"));
    expect(mockCollaborationStart).toHaveBeenCalled();
    expect(screen.getByText(/collaboration\?room=/)).toBeDefined();
  });

  it("copies the generated share link", async () => {
    mockCollaborationStart.mockResolvedValue(undefined);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<Sidebar {...defaultProps} />);
    await userEvent.click(screen.getByText("Share Collection"));
    const input = await screen.findByLabelText("Collection / Folder name");
    await userEvent.type(input, "Papers");
    await userEvent.click(screen.getByText("Generate Share Link"));
    expect(mockCollaborationStart).toHaveBeenCalled();
    await userEvent.click(screen.getByText("Copy Link"));
    expect(writeText).toHaveBeenCalled();
  });

  it("ignores a collaboration start that resolves after unmount", async () => {
    let resolveStart: (v: unknown) => void = () => {};
    mockCollaborationStart.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStart = resolve;
        }),
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = render(<Sidebar {...defaultProps} />);
    await userEvent.click(screen.getByText("Share Collection"));
    const input = await screen.findByLabelText("Collection / Folder name");
    await userEvent.type(input, "Papers");
    await userEvent.click(screen.getByText("Generate Share Link"));
    expect(mockCollaborationStart).toHaveBeenCalled();
    unmount();
    resolveStart("secret");
    // Flush microtasks: if the late continuation existed, it would have run by now.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("ignores a copy that resolves after unmount (no later timer)", async () => {
    mockCollaborationStart.mockResolvedValue(undefined);
    let resolveWrite: (v: unknown) => void = () => {};
    const writeText = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveWrite = resolve;
        }),
    );
    Object.assign(navigator, { clipboard: { writeText } });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = render(<Sidebar {...defaultProps} />);
    await userEvent.click(screen.getByText("Share Collection"));
    const input = await screen.findByLabelText("Collection / Folder name");
    await userEvent.type(input, "Papers");
    await userEvent.click(screen.getByText("Generate Share Link"));
    expect(mockCollaborationStart).toHaveBeenCalled();
    await userEvent.click(screen.getByText("Copy Link"));
    expect(writeText).toHaveBeenCalled();
    unmount();
    resolveWrite(undefined);
    // Flush microtasks + macrotareas: si el timer de "copied" se hubiera
    // scheduled after the unmount, its setState would have already fired.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
