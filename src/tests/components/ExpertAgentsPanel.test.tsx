import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React, { act } from "react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (s: string, opts?: any) => opts?.defaultValue || s,
    i18n: { language: "en" },
  }),
}));

vi.mock("lucide-react", () => {
  const mock = (name: string) => {
    const Icon = (props: any) => (
      <svg data-testid={`icon-${name}`} {...props} />
    );
    Icon.displayName = name;
    return Icon;
  };
  return {
    Sparkles: mock("Sparkles"),
    X: mock("X"),
    Loader2: mock("Loader2"),
    ChevronRight: mock("ChevronRight"),
    BrainCircuit: mock("BrainCircuit"),
    SearchIcon: mock("SearchIcon"),
    Search: mock("Search"),
    // ProRequiredState icons (rendered inside the panel's results area)
    ShieldCheck: mock("ShieldCheck"),
    ArrowRight: mock("ArrowRight"),
  };
});

// No esparcir props de motion (whileHover/whileTap/layout/animate/...) al DOM:
// are not valid attributes and React emits warnings that mask the real ones.
const MOTION_PROPS = new Set([
  "layout",
  "initial",
  "animate",
  "exit",
  "whileHover",
  "whileTap",
  "variants",
  "transition",
  "custom",
]);
vi.mock("motion/react", async () => {
  const { createMotionMock } = await import("../mocks/motion");
  return createMotionMock();
});

vi.mock("react-markdown", () => ({
  default: ({ children }: any) => <div data-testid="markdown">{children}</div>,
}));

const mockAgent1Action = vi.fn().mockResolvedValue("Analysis result");
const mockAgent2Action = vi.fn().mockResolvedValue("Writing result");
const mockResolveAgentAction = vi.fn((agent: { id: string }) => {
  const byId: Record<string, unknown> = {
    agent1: mockAgent1Action,
    agent2: mockAgent2Action,
  };
  return Promise.resolve(byId[agent.id]);
});

class MockProUnavailableError extends Error {}

const mockAgentsConfig = [
  {
    id: "agent1",
    nameKey: "app_agent1",
    descKey: "app_agent1Desc",
    category: "analysis",
    icon: () => <svg data-testid="agent-icon" />,
    color: "bg-violet-500",
    actionId: "realityCheck",
  },
  {
    id: "agent2",
    nameKey: "app_agent2",
    descKey: "app_agent2Desc",
    category: "writing",
    icon: () => <svg data-testid="agent-icon" />,
    color: "bg-blue-500",
    actionId: "copywriting",
  },
];
const mockCategories = [
  { id: "all", labelKey: "app_all", icon: () => <svg /> },
  { id: "analysis", labelKey: "app_analysis", icon: () => <svg /> },
  { id: "writing", labelKey: "app_writing", icon: () => <svg /> },
];
vi.mock("../../components/ai/agentsConfig", () => ({
  agentsConfig: mockAgentsConfig,
  categories: mockCategories,
  resolveAgentAction: mockResolveAgentAction,
  ProUnavailableError: MockProUnavailableError,
}));

describe("ExpertAgentsPanel", () => {
  let ExpertAgentsPanel: React.FC<{ content: string; isPrivate?: boolean }>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../../components/ai/ExpertAgentsPanel");
    ExpertAgentsPanel = mod.default;
  });

  it("renders title", () => {
    render(<ExpertAgentsPanel content="test content" />);
    expect(screen.getByText("app_expertAgents")).toBeTruthy();
  });

  it("shows search input", () => {
    render(<ExpertAgentsPanel content="test content" />);
    expect(screen.getByLabelText("app_searchAgents")).toBeTruthy();
  });

  it("shows categories", () => {
    render(<ExpertAgentsPanel content="test content" />);
    expect(screen.getByText("app_all")).toBeTruthy();
  });

  it("filters agents by search", async () => {
    render(<ExpertAgentsPanel content="test content" />);
    const input = screen.getByLabelText("app_searchAgents");
    await userEvent.type(input, "NONEXISTENT");
    expect(screen.getByText("app_noAgentsFound")).toBeTruthy();
  });

  it("resolves the Pro action and renders the result when clicked", async () => {
    mockAgent1Action.mockResolvedValue("Analysis result");
    render(<ExpertAgentsPanel content="analyze this" />);
    const agents = screen.getAllByText("app_agent1");
    await userEvent.click(agents[0]!);
    await screen.findByTestId("markdown");
    expect(screen.getByText("Analysis result")).toBeTruthy();
  });

  it("shows the generic error if the resolved action fails", async () => {
    mockAgent1Action.mockRejectedValue(new Error("fail"));
    render(<ExpertAgentsPanel content="test" />);
    await userEvent.click(screen.getByText("app_agent1"));
    expect(await screen.findByText("app_somethingWentWrong")).toBeTruthy();
  });

  it("shows the reusable Pro-required state when the gate rejects", async () => {
    mockResolveAgentAction.mockImplementationOnce(() =>
      Promise.reject(new MockProUnavailableError("no-license")),
    );
    render(<ExpertAgentsPanel content="test" />);
    await userEvent.click(screen.getByText("app_agent1"));
    const state = await screen.findByTestId("pro-required-state");
    expect(state).toBeTruthy();
    // The copy names the feature; the generic failure text must not appear.
    expect(screen.queryByText("app_somethingWentWrong")).toBeNull();
  });

  it("propagates signal and discards analysis when the content changes", async () => {
    let resolveAnalysis!: (result: string) => void;
    mockAgent1Action.mockReturnValue(
      new Promise((resolve) => {
        resolveAnalysis = resolve;
      }),
    );
    const { rerender } = render(
      <ExpertAgentsPanel content="old content" />,
    );

    await userEvent.click(screen.getByText("app_agent1"));
    await waitFor(() => {
      expect(mockAgent1Action).toHaveBeenCalled();
    });
    const signal = mockAgent1Action.mock.calls[0]?.[3];
    expect(signal).toBeInstanceOf(AbortSignal);

    rerender(<ExpertAgentsPanel content="new content" />);
    expect(signal?.aborted).toBe(true);
    resolveAnalysis("stale analysis");
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByText("stale analysis")).toBeNull();
  });

  it("does not allow click without content", async () => {
    render(<ExpertAgentsPanel content="" />);
    const agents = screen.getAllByText("app_agent1");
    await userEvent.click(agents[0]!);
    expect(mockAgent1Action).not.toHaveBeenCalled();
    expect(mockResolveAgentAction).not.toHaveBeenCalled();
  });
});
