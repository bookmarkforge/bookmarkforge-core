import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("react-i18next", () => {
  const t = (key: string, fb?: string) => fb || key;
  return {
    useTranslation: () => ({ t, i18n: { language: "en" } }),
    initReactI18next: { type: "3rdParty", init: vi.fn() },
  };
});

vi.mock("../../components/streaming-hydration/useProgressiveHydration", () => ({
  useProgressiveHydration: vi.fn(() => true),
}));

import React from "react";

vi.mock("../../components/KnowledgeDashboard", () => ({
  default: () => <div data-testid="knowledge-dashboard">KD</div>,
}));

vi.mock("../../components/ExportDialog", () => ({
  default: ({ isOpen }: any) =>
    isOpen ? <div data-testid="export-dialog" /> : null,
}));

vi.mock("../../components/ImportDialog", () => ({
  default: ({ isOpen }: any) =>
    isOpen ? <div data-testid="import-dialog" /> : null,
}));

const mockP2PSyncModal = vi.fn(() => null);
vi.mock("../../components/sync/P2PSyncModal", () => ({
  P2PSyncModal: (...args: any[]) => {
    (mockP2PSyncModal as any)(...args);
    const [{ isOpen }] = args;
    return isOpen ? <div data-testid="p2p-modal" /> : null;
  },
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as any),
    Suspense: ({ children }: any) => (
      <div data-testid="suspense">{children}</div>
    ),
    lazy: () => () => <div data-testid="graph-view" />,
  };
});

vi.mock("lucide-react", () => {
  const mock = (name: string) => {
    const Icon = (props: any) => (
      <svg data-testid={`icon-${name}`} {...props} />
    );
    Icon.displayName = name;
    return Icon;
  };
  return {
    Network: mock("Network"),
    BarChart3: mock("BarChart3"),
    X: mock("X"),
    Sparkles: mock("Sparkles"),
    Scissors: mock("Scissors"),
    Info: mock("Info"),
    Database: mock("Database"),
    Upload: mock("Upload"),
    Download: mock("Download"),
  };
});

vi.mock("motion/react", async () => {
  const { createMotionMock } = await import("../mocks/motion");
  return createMotionMock();
});

describe("Dashboard", () => {
  let Dashboard: React.FC<any>;
  const onClose = vi.fn();

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../../components/Dashboard");
    Dashboard = mod.Dashboard;
  });

  it("renders without errors", () => {
    const { container } = render(<Dashboard onClose={onClose} />);
    expect(container).toBeTruthy();
  });

  it("renders KnowledgeDashboard by default in stats tab", () => {
    render(<Dashboard onClose={onClose} />);
    expect(screen.getByTestId("knowledge-dashboard")).toBeTruthy();
  });

  it("switches to graph tab and shows GraphView", async () => {
    render(<Dashboard onClose={onClose} />);
    await userEvent.click(screen.getAllByText("knowledgeGraph")[0]!);
    expect(screen.getByTestId("graph-view")).toBeTruthy();
  });

  it("switches to clipper tab and shows web clipper content", async () => {
    render(<Dashboard onClose={onClose} />);
    await userEvent.click(screen.getAllByText("webClipper")[0]!);
    expect(screen.getByText(/saveToForge/i)).toBeTruthy();
  });

  it("H-02: the clipper bookmarklet points to /capture#url= (fragment), not a query string or /api/clipper", async () => {
    // Regression for high-severity finding H-02: the old bookmarklet made
    // POST to a non-existent /api/clipper (dead feature). It must now open
    // the capture flow itself with the payload in the FRAGMENT
    // (/capture#url=…&title=…&text=…) so the URL is not leaked in the query
    // string (logs/CDN/Referer).
    render(<Dashboard onClose={onClose} />);
    await userEvent.click(screen.getAllByText("webClipper")[0]!);
    const link = screen.getByText(/saveToForge/i).closest("a");
    expect(link).toBeTruthy();
    const href = (link as HTMLAnchorElement).getAttribute("href") || "";
    expect(href.startsWith("javascript:")).toBe(true);
    expect(href).toContain("/capture#url=");
    expect(href).toContain("&title=");
    expect(href).toContain("&text=");
    expect(href).not.toContain("/capture?");
    expect(href).not.toContain("/api/clipper");
    expect(href).not.toContain("fetch(");
  });

  it("switches to data tab and shows data sovereignty management", async () => {
    render(<Dashboard onClose={onClose} />);
    await userEvent.click(screen.getAllByText("Data")[0]!);
    expect(screen.getByText("Open Importer")).toBeTruthy();
  });

  it("calls onClose when clicking the close button", async () => {
    render(<Dashboard onClose={onClose} />);
    const xIcon = screen.getByTestId("icon-X");
    const btn = xIcon.closest("button");
    if (btn) await userEvent.click(btn);
    expect(onClose).toHaveBeenCalled();
  });

  it("opens ImportDialog when clicking Open Importer", async () => {
    render(<Dashboard onClose={onClose} />);
    await userEvent.click(screen.getAllByText("Data")[0]!);
    await userEvent.click(screen.getByText("Open Importer"));
    expect(screen.getByTestId("import-dialog")).toBeTruthy();
  });

  it("opens ExportDialog when clicking Open Exporter", async () => {
    render(<Dashboard onClose={onClose} />);
    await userEvent.click(screen.getAllByText("Data")[0]!);
    await userEvent.click(screen.getByText("Open Exporter"));
    expect(screen.getByTestId("export-dialog")).toBeTruthy();
  });

  it("opens P2PSyncModal when clicking Start Local Connection", async () => {
    render(<Dashboard onClose={onClose} />);
    await userEvent.click(screen.getAllByText("Data")[0]!);
    await userEvent.click(
      screen.getByRole("button", { name: /app_startP2P|Start Local/i }),
    );
    expect(screen.getByTestId("p2p-modal")).toBeTruthy();
  });
});
