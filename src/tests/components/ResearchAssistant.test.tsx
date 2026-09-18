import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { act } from "react";
import React from "react";

vi.mock("react-i18next", () => {
  const t = (key: string, options?: any) => options?.defaultValue || key;
  return { useTranslation: () => ({ t, i18n: { language: "en" } }) };
});

const mockWebSearchService = {
  search: vi.fn(),
  getStats: vi.fn(() => ({
    requestCount: 5,
    requestTokens: 1200,
    cacheSize: 3,
  })),
  clearCache: vi.fn(),
};
vi.mock("../../services/ai/WebSearchService", () => ({
  webSearchService: mockWebSearchService,
}));

vi.mock("motion/react", async () => {
  const { createMotionMock } = await import("../mocks/motion");
  return createMotionMock();
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
    Search: mock("Search"),
    Loader2: mock("Loader2"),
    ExternalLink: mock("ExternalLink"),
    Clock: mock("Clock"),
    Database: mock("Database"),
    Settings: mock("Settings"),
    X: mock("X"),
    Zap: mock("Zap"),
    Link: mock("Link"),
  };
});

describe("ResearchAssistant", () => {
  let ResearchAssistant: React.FC<{ isOpen: boolean; onClose: () => void }>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockWebSearchService.search.mockResolvedValue({
      text: "Research results text",
      results: [
        {
          title: "Result 1",
          url: "https://example.com/1",
          source: "example.com",
          snippet: "Snippet 1",
        },
        {
          title: "Result 2",
          url: "https://example.com/2",
          source: "example.com",
          snippet: "Snippet 2",
        },
      ],
      cached: false,
      tokens: 500,
    });
    const mod = await import("../../components/ResearchAssistant");
    ResearchAssistant = mod.ResearchAssistant;
  });

  it("does not render when isOpen is false", () => {
    const { container } = render(
      <ResearchAssistant isOpen={false} onClose={vi.fn()} />,
    );
    expect(
      Array.from(container.children).every((el) => el.tagName === "STYLE"),
    ).toBe(true);
  });

  it("renders search input when isOpen is true", () => {
    render(<ResearchAssistant isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByPlaceholderText("research_placeholder")).toBeTruthy();
  });

  it("calls onClose when pressing Escape", () => {
    const onClose = vi.fn();
    render(<ResearchAssistant isOpen={true} onClose={onClose} />);
    fireEvent.keyDown(screen.getByPlaceholderText("research_placeholder"), {
      key: "Escape",
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("calls webSearchService.search when pressing Enter", async () => {
    const { unmount } = render(
      <ResearchAssistant isOpen={true} onClose={vi.fn()} />,
    );
    const input = screen.getByPlaceholderText("research_placeholder");
    await act(async () => {
      fireEvent.change(input, { target: { value: "my query" } });
      fireEvent.keyDown(input, { key: "Enter" });
      await vi.waitFor(() => {
        expect(mockWebSearchService.search).toHaveBeenCalledWith("my query");
      });
      await Promise.resolve();
    });
    unmount();
  });

  it("shows search results", async () => {
    render(<ResearchAssistant isOpen={true} onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText("research_placeholder");
    fireEvent.change(input, { target: { value: "test" } });
    fireEvent.keyDown(input, { key: "Enter" });
    const result1 = await screen.findByText("Result 1");
    expect(result1).toBeTruthy();
    expect(screen.getByText("Result 2")).toBeTruthy();
  });

  it("shows hint when there is no query or response", () => {
    render(<ResearchAssistant isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText("research_hint")).toBeTruthy();
  });

  it("shows clear button when there is a query", () => {
    render(<ResearchAssistant isOpen={true} onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText("research_placeholder");
    fireEvent.change(input, { target: { value: "something" } });
    expect(screen.getByTestId("icon-X")).toBeTruthy();
  });

  it("toggles the settings panel when clicking Settings", async () => {
    render(<ResearchAssistant isOpen={true} onClose={vi.fn()} />);
    const input = screen.getByPlaceholderText("research_placeholder");
    fireEvent.change(input, { target: { value: "test" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await screen.findByText("Result 1");
    fireEvent.click(screen.getByTestId("icon-Settings"));
    expect(screen.getByText("research_requests")).toBeTruthy();
  });

  it("discards the resolved search after unmount", async () => {
    let resolveSearch: (value: unknown) => void;
    mockWebSearchService.search.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSearch = resolve;
      }),
    );
    const { unmount } = render(
      <ResearchAssistant isOpen={true} onClose={vi.fn()} />,
    );
    const input = screen.getByPlaceholderText("research_placeholder");
    fireEvent.change(input, { target: { value: "late query" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(mockWebSearchService.search).toHaveBeenCalledWith("late query");

    unmount();
    await act(async () => {
      resolveSearch!({ text: "late result", results: [], cached: false });
    });

    // The late result must not render anywhere after unmount.
    expect(screen.queryByText("late result")).toBeNull();
  });
});
