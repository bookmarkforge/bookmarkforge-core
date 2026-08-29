import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { render, fireEvent, screen, cleanup, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import type { HighlightData } from "../../services/HighlightService";

// Force RAF synchronous so keyboard-nav tests can verify theme changes
// without e.currentTarget becoming null (React nullifies it after handler).
const _origRAF = globalThis.requestAnimationFrame;
beforeAll(() => {
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    cb(performance.now());
    return 0;
  }) as any;
});
afterAll(() => {
  globalThis.requestAnimationFrame = _origRAF;
});

vi.mock(import("react-i18next"), (() => ({
  useTranslation: () => ({ t: (s: string) => s }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
})) as any);
vi.mock("motion/react", async () => {
  const { createMotionMock } = await import("../mocks/motion");
  return createMotionMock();
});
vi.mock(import("react-markdown"), (() => ({
  default: ({ children }: any) => <div data-testid="markdown">{children}</div>,
})) as any);
// Icons as SVG components with data-testid (previously lowercase strings that
// React renderizaba como tags HTML desconocidos, generando warnings).
vi.mock(import("lucide-react"), (() => {
  const icon = (name: string) => {
    const Icon = (props: any) => (
      <svg data-testid={`icon-${name}`} {...props} />
    );
    Icon.displayName = name;
    return Icon;
  };
  return {
    X: icon("x"),
    Download: icon("download"),
    Sparkles: icon("sparkles"),
    Calendar: icon("calendar"),
    Loader2: icon("loader2"),
    Type: icon("type"),
    Maximize2: icon("maximize2"),
    Minimize2: icon("minimize2"),
    Moon: icon("moon"),
    Sun: icon("sun"),
    Coffee: icon("coffee"),
    AlignLeft: icon("alignleft"),
    AlignJustify: icon("alignjustify"),
    Timer: icon("timer"),
    Trash2: icon("trash2"),
    MessageSquare: icon("messagesquare"),
    // Icons used by the AI Reader trio (module-scope elements must exist).
    Zap: icon("zap"),
    Clock: icon("clock"),
    Link: icon("link"),
    AlertTriangle: icon("alerttriangle"),
    Lightbulb: icon("lightbulb"),
    Check: icon("check"),
    MessageCircle: icon("messagecircle"),
  };
}) as any);

const mockGetHighlights = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const mockAddHighlight = vi.hoisted(() => vi.fn().mockResolvedValue({}));
const mockRemoveHighlight = vi.hoisted(() => vi.fn().mockResolvedValue([]));
vi.mock(import("../../services/HighlightService"), (() => ({
  highlightService: {
    getHighlights: mockGetHighlights,
    addHighlight: mockAddHighlight,
    removeHighlight: mockRemoveHighlight,
  },
})) as any);

const mockBookmarksFindOneExec = vi.hoisted(() => vi.fn());
vi.mock(import("../../db/database"), (() => ({
  initDB: vi.fn().mockResolvedValue({
    bookmarks: { findOne: vi.fn(() => ({ exec: mockBookmarksFindOneExec })) },
  }),
})) as any);

const mockGenerateText = vi.hoisted(() => vi.fn());
const mockGlobalChat = vi.hoisted(() => vi.fn());
vi.mock(import("../../services/ai/ProviderManager"), (() => ({
  aiManager: { generateText: mockGenerateText },
})) as any);
vi.mock(import("../../services/ai/AgentService"), (() => ({
  agentService: { globalChat: mockGlobalChat },
})) as any);

const { BookmarkReaderModal } =
  await import("../../components/bookmarks/BookmarkReaderModal");

const mockBookmark: any = {
  id: "1",
  title: "Test Article",
  url: "https://example.com",
  content: "# Hello\nWorld",
  summary: "A test summary",
  createdAt: new Date("2024-01-01"),
  tags: ["test"],
};

const mockEmptyBookmark: any = {
  id: "2",
  title: "No Content",
  url: "https://example.com/empty",
  content: "",
  summary: "",
  createdAt: new Date("2024-01-01"),
  tags: [],
};

describe("BookmarkReaderModal", () => {
  const defaultProps = {
    viewingContent: mockBookmark,
    setViewingContent: vi.fn(),
    handleExportPDF: vi.fn(),
    handleExportMarkdown: vi.fn(),
    handleCleanContent: vi.fn(),
    handleFetchContent: vi.fn(),
    isCleaningContent: null,
    isFetchingContent: null,
    t: ((s: string) => s) as any,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await act(async () => {
      cleanup();
    });
  });

  it("renders the bookmark title", () => {
    const { getAllByText } = render(<BookmarkReaderModal {...defaultProps} />);
    expect(getAllByText("Test Article").length).toBeGreaterThan(0);
  });

  it("renders the summary when present", () => {
    const { getByText } = render(<BookmarkReaderModal {...defaultProps} />);
    expect(getByText("A test summary")).toBeTruthy();
  });

  it("calls setViewingContent when close button clicked", async () => {
    const setViewingContent = vi.fn();
    const { getByLabelText } = render(
      <BookmarkReaderModal
        {...defaultProps}
        setViewingContent={setViewingContent}
      />,
    );
    await userEvent.click(getByLabelText("app_closeReader"));
    expect(setViewingContent).toHaveBeenCalledWith(null);
  });

  it("renders with cleaning spinner when isCleaningContent matches", () => {
    const { getByTestId } = render(
      <BookmarkReaderModal {...defaultProps} isCleaningContent="1" />,
    );
    expect(getByTestId("markdown")).toBeTruthy();
  });

  it("renders reading time", () => {
    const { container } = render(<BookmarkReaderModal {...defaultProps} />);
    expect(container.textContent).toContain("min");
  });

  it("toggles theme to sepia when Coffee icon clicked", async () => {
    const { container } = render(<BookmarkReaderModal {...defaultProps} />);
    const typeBtn = container.querySelector('[data-testid="icon-type"]');
    await userEvent.click(typeBtn!);
    const coffeeBtn = container.querySelector('[data-testid="icon-coffee"]');
    expect(coffeeBtn).toBeTruthy();
    await userEvent.click(coffeeBtn!);
  });

  it("increases font size with + button", async () => {
    const { container } = render(<BookmarkReaderModal {...defaultProps} />);
    const typeBtn = container.querySelector('[data-testid="icon-type"]');
    await userEvent.click(typeBtn!);
    const allButtons = container.querySelectorAll("button");
    const sizeUp = Array.from(allButtons).find((b) => b.textContent === "+");
    expect(sizeUp).toBeTruthy();
    await userEvent.click(sizeUp!);
    expect(container.textContent).toContain("20");
  });

  it("decreases font size with - button", async () => {
    const { container } = render(<BookmarkReaderModal {...defaultProps} />);
    const typeBtn = container.querySelector('[data-testid="icon-type"]');
    await userEvent.click(typeBtn!);
    const allButtons = container.querySelectorAll("button");
    const sizeDown = Array.from(allButtons).find((b) => b.textContent === "-");
    expect(sizeDown).toBeTruthy();
    await userEvent.click(sizeDown!);
    expect(container.textContent).toContain("16");
  });

  it("toggles focus mode", async () => {
    const { container } = render(<BookmarkReaderModal {...defaultProps} />);
    const maximizeBtn = container.querySelector('[data-testid="icon-maximize2"]');
    expect(maximizeBtn).toBeTruthy();
    await userEvent.click(maximizeBtn!);
    const minimizeBtn = container.querySelector('[data-testid="icon-minimize2"]');
    expect(minimizeBtn).toBeTruthy();
  });

  it("shows settings panel when Type icon clicked", async () => {
    const { container } = render(<BookmarkReaderModal {...defaultProps} />);
    const typeBtn = container.querySelector('[data-testid="icon-type"]');
    expect(typeBtn).toBeTruthy();
    await userEvent.click(typeBtn!);
    expect(container.textContent).toContain("app_theme");
    expect(container.textContent).toContain("app_size");
    expect(container.textContent).toContain("app_line");
  });

  it("calls handleCleanContent when AI Clean button clicked", async () => {
    const handleCleanContent = vi.fn();
    const { container } = render(
      <BookmarkReaderModal
        {...defaultProps}
        handleCleanContent={handleCleanContent}
      />,
    );
    const sparklesBtn = container.querySelector('[data-testid="icon-sparkles"]');
    expect(sparklesBtn).toBeTruthy();
    const cleanBtn =
      sparklesBtn!.closest("button") || sparklesBtn!.parentElement;
    await userEvent.click(cleanBtn!);
    expect(handleCleanContent).toHaveBeenCalledWith(mockBookmark);
  });

  it("calls handleExportPDF when download button clicked", async () => {
    const handleExportPDF = vi.fn();
    const { getByLabelText } = render(
      <BookmarkReaderModal
        {...defaultProps}
        handleExportPDF={handleExportPDF}
      />,
    );
    await userEvent.click(getByLabelText("app_exportPdf"));
    expect(handleExportPDF).toHaveBeenCalled();
  });

  it("calls handleExportMarkdown when MD button clicked", async () => {
    const handleExportMarkdown = vi.fn();
    const { getByText } = render(
      <BookmarkReaderModal
        {...defaultProps}
        handleExportMarkdown={handleExportMarkdown}
      />,
    );
    await userEvent.click(getByText("app_md"));
    expect(handleExportMarkdown).toHaveBeenCalled();
  });

  it("calls handleFetchContent when Extract Article button clicked", async () => {
    const handleFetchContent = vi.fn();
    const { getByTitle } = render(
      <BookmarkReaderModal
        {...defaultProps}
        handleFetchContent={handleFetchContent}
      />,
    );
    await userEvent.click(getByTitle("app_extractArticle"));
    expect(handleFetchContent).toHaveBeenCalledWith(mockBookmark);
  });

  it("shows spinner on Extract Article button when isFetchingContent matches", () => {
    const { container } = render(
      <BookmarkReaderModal {...defaultProps} isFetchingContent="1" />,
    );
    const loader = container.querySelector('[data-testid="icon-loader2"]');
    expect(loader).toBeTruthy();
    const extractBtn = loader!.closest("button");
    expect(extractBtn).toBeTruthy();
    expect(extractBtn).toBeDisabled();
  });

  it("shows empty state when bookmark has no content", () => {
    const { getByText } = render(
      <BookmarkReaderModal
        {...defaultProps}
        viewingContent={mockEmptyBookmark}
      />,
    );
    expect(getByText("app_noContent")).toBeTruthy();
    expect(getByText("app_noContentDesc")).toBeTruthy();
  });

  // ══ Theme switching ──

  it("switches theme to light when Sun icon clicked", async () => {
    const { container } = render(<BookmarkReaderModal {...defaultProps} />);
    const sunBtn = container.querySelector('[data-testid="icon-sun"]');
    expect(sunBtn).toBeTruthy();
    await userEvent.click(sunBtn!.closest("button")!);
    const lightRadio = container.querySelector('[aria-label="app_lightTheme"]');
    expect(lightRadio?.getAttribute("aria-checked")).toBe("true");
  });

  it("switches theme to dark when Moon icon clicked", async () => {
    const { container } = render(<BookmarkReaderModal {...defaultProps} />);
    const moonBtn = container.querySelector('[data-testid="icon-moon"]');
    expect(moonBtn).toBeTruthy();
    await userEvent.click(moonBtn!.closest("button")!);
    const darkRadio = container.querySelector('[aria-label="app_darkTheme"]');
    expect(darkRadio?.getAttribute("aria-checked")).toBe("true");
  });

  // ══ Settings panel: line height ──

  it("increases line height with + button in settings", async () => {
    const { container } = render(<BookmarkReaderModal {...defaultProps} />);
    const typeBtn = container.querySelector('[data-testid="icon-type"]');
    await userEvent.click(typeBtn!.closest("button")!);
    // Find the line-height group by its aria-labelledby or find the + button next to the 1.7 value
    const lineGroup = container.querySelector('[aria-labelledby="line-label"]');
    const linePlus = lineGroup?.querySelectorAll("button")[1];
    await userEvent.click(linePlus!);
    expect(lineGroup?.textContent).toContain("1.8");
  });

  it("decreases line height with - button in settings", async () => {
    const { container } = render(<BookmarkReaderModal {...defaultProps} />);
    const typeBtn = container.querySelector('[data-testid="icon-type"]');
    await userEvent.click(typeBtn!.closest("button")!);
    const lineGroup = container.querySelector('[aria-labelledby="line-label"]');
    const lineMinus = lineGroup?.querySelectorAll("button")[0];
    await userEvent.click(lineMinus!);
    expect(lineGroup?.textContent).toContain("1.6");
  });

  // ══ Settings panel: content width ──

  it("decreases content width via Width controls", async () => {
    const { container } = render(<BookmarkReaderModal {...defaultProps} />);
    const typeBtn = container.querySelector('[data-testid="icon-type"]');
    await userEvent.click(typeBtn!.closest("button")!);
    const alignLeft = container.querySelector('[data-testid="icon-alignleft"]');
    await userEvent.click(alignLeft!.closest("button")!);
    expect(container.textContent).toContain("90%");
  });

  it("increases content width via Width controls", async () => {
    const { container } = render(<BookmarkReaderModal {...defaultProps} />);
    const typeBtn = container.querySelector('[data-testid="icon-type"]');
    await userEvent.click(typeBtn!.closest("button")!);
    // Decrease width first to 90%
    const alignLeft = container.querySelector('[data-testid="icon-alignleft"]');
    await userEvent.click(alignLeft!.closest("button")!);
    expect(container.textContent).toContain("90%");
    // Increase back to 100%
    const alignJustify = container.querySelector('[data-testid="icon-alignjustify"]');
    await userEvent.click(alignJustify!.closest("button")!);
    expect(container.textContent).toContain("100%");
  });

  // ══ Focus mode exit ──

  it("exits focus mode when minimize button clicked", async () => {
    const { container } = render(<BookmarkReaderModal {...defaultProps} />);
    const maxBtn = container.querySelector('[data-testid="icon-maximize2"]');
    await userEvent.click(maxBtn!.closest("button")!);
    const minBtn = container.querySelector('[data-testid="icon-minimize2"]');
    expect(minBtn).toBeTruthy();
    await userEvent.click(minBtn!.closest("button")!);
    // After exiting focus mode, the header should be visible with close button
    expect(container.querySelector('[aria-label="app_closeReader"]')).toBeTruthy();
  });

  // ══ AI Copilot toggle ──

  it("toggles AI Copilot panel", async () => {
    const { container, getByText } = render(<BookmarkReaderModal {...defaultProps} />);
    const copilotBtn = container.querySelector('[title="app_aiCopilot"]');
    expect(copilotBtn).toBeTruthy();
    await userEvent.click(copilotBtn!);
    // Copilot panel should appear
    expect(getByText("app_keyPoints")).toBeTruthy();
    expect(getByText("app_related")).toBeTruthy();
  });

  // ══ No summary path ──

  it("does not render summary section when bookmark has no summary", () => {
    const { container } = render(
      <BookmarkReaderModal
        {...defaultProps}
        viewingContent={{ ...mockBookmark, summary: "" } as any}
      />,
    );
    expect(container.textContent).not.toContain("app_summary");
  });

  // ══ Settings close on re-click ──

  it("closes settings panel when Type button clicked again", async () => {
    const { container } = render(<BookmarkReaderModal {...defaultProps} />);
    const typeBtn = container.querySelector('[data-testid="icon-type"]');
    // Open settings
    await userEvent.click(typeBtn!.closest("button")!);
    expect(container.textContent).toContain("app_size");
    // Close settings
    await userEvent.click(typeBtn!.closest("button")!);
    // Settings panel should be hidden
    expect(container.textContent).not.toContain("app_size");
  });

  // ── Branch coverage: Escape, keyboard nav, boundaries ──

  it("closes the modal with Escape key", () => {
    const setViewingContent = vi.fn();
    render(
      <BookmarkReaderModal
        {...defaultProps}
        setViewingContent={setViewingContent}
      />,
    );
    const dialog = document.querySelector('[role="dialog"]')!;
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(setViewingContent).toHaveBeenCalledWith(null);
  });

  it("navigates between topics with ArrowRight in the radiogroup", () => {
    const { container } = render(<BookmarkReaderModal {...defaultProps} />);
    const radiogroup = container.querySelector('[role="radiogroup"]')!;
    // Default theme is dark (index 1 in [light, dark, sepia])
    fireEvent.keyDown(radiogroup, { key: "ArrowRight" });
    // Should move to sepia (index 2) — RAF runs synchronously
    const sepiaRadio = container.querySelector('[aria-label="app_sepiaTheme"]');
    expect(sepiaRadio?.getAttribute("aria-checked")).toBe("true");
  });

  it("navigates to the first topic with Home in the radiogroup", () => {
    const { container } = render(<BookmarkReaderModal {...defaultProps} />);
    const radiogroup = container.querySelector('[role="radiogroup"]')!;
    fireEvent.keyDown(radiogroup, { key: "Home" });
    const lightRadio = container.querySelector('[aria-label="app_lightTheme"]');
    expect(lightRadio?.getAttribute("aria-checked")).toBe("true");
  });

  it("navigates to the last theme with End in the radiogroup", () => {
    const { container } = render(<BookmarkReaderModal {...defaultProps} />);
    const radiogroup = container.querySelector('[role="radiogroup"]')!;
    fireEvent.keyDown(radiogroup, { key: "End" });
    const sepiaRadio = container.querySelector('[aria-label="app_sepiaTheme"]');
    expect(sepiaRadio?.getAttribute("aria-checked")).toBe("true");
  });

  it("ignores non-navigation keys in the radiogroup (does not change theme)", () => {
    const { container } = render(<BookmarkReaderModal {...defaultProps} />);
    const radiogroup = container.querySelector('[role="radiogroup"]')!;
    fireEvent.keyDown(radiogroup, { key: "Enter" });
    // Theme should still be dark (default)
    const darkRadio = container.querySelector('[aria-label="app_darkTheme"]');
    expect(darkRadio?.getAttribute("aria-checked")).toBe("true");
  });

  it("does not reduce font size below 14 (boundary floor)", async () => {
    const { container } = render(<BookmarkReaderModal {...defaultProps} />);
    const typeBtn = container.querySelector('[data-testid="icon-type"]');
    await userEvent.click(typeBtn!.closest("button")!);
    const allButtons = container.querySelectorAll("button");
    const sizeDown = Array.from(allButtons).find((b) => b.textContent === "-")!;
    // 18 → 16 → 14 → 14 (floor)
    await userEvent.click(sizeDown);
    await userEvent.click(sizeDown);
    await userEvent.click(sizeDown);
    expect(container.textContent).toContain("14");
  });

  it("does not reduce line height below 1.3 (boundary floor)", async () => {
    const { container } = render(<BookmarkReaderModal {...defaultProps} />);
    const typeBtn = container.querySelector('[data-testid="icon-type"]');
    await userEvent.click(typeBtn!.closest("button")!);
    const lineGroup = container.querySelector('[aria-labelledby="line-label"]')!;
    const lineMinus = lineGroup.querySelectorAll("button")[0];
    // 1.7 → 1.6 → 1.5 → 1.4 → 1.3 → 1.3 (floor)
    await userEvent.click(lineMinus!);
    await userEvent.click(lineMinus!);
    await userEvent.click(lineMinus!);
    await userEvent.click(lineMinus!);
    await userEvent.click(lineMinus!);
    expect(lineGroup.textContent).toContain("1.3");
  });

  it("does not reduce content width below 60% (boundary floor)", async () => {
    const { container } = render(<BookmarkReaderModal {...defaultProps} />);
    const typeBtn = container.querySelector('[data-testid="icon-type"]');
    await userEvent.click(typeBtn!.closest("button")!);
    const alignLeft = container.querySelector('[data-testid="icon-alignleft"]')!;
    const alignLeftBtn = alignLeft.closest("button")!;
    // 100 → 90 → 80 → 70 → 60 → 60 (floor)
    await userEvent.click(alignLeftBtn);
    await userEvent.click(alignLeftBtn);
    await userEvent.click(alignLeftBtn);
    await userEvent.click(alignLeftBtn);
    await userEvent.click(alignLeftBtn);
    expect(container.textContent).toContain("60%");
  });

  // ══ trackVisit (visitCount increment) ══

  it("increments visitCount and updates lastVisitedAt when opening", async () => {
    const patch = vi.fn().mockResolvedValue({});
    const doc = {
      get: vi.fn((k: string) => (k === "visitCount" ? 3 : undefined)),
      incrementalPatch: patch,
    };
    mockBookmarksFindOneExec.mockResolvedValue(doc);
    render(<BookmarkReaderModal {...defaultProps} />);
    await waitFor(() => {
      expect(patch).toHaveBeenCalledWith(
        expect.objectContaining({ visitCount: 4 }),
      );
    });
    expect(patch.mock.calls[0]![0]).toHaveProperty("lastVisitedAt");
  });

  it("does not throw if trackVisit fails (best-effort)", async () => {
    mockBookmarksFindOneExec.mockRejectedValue(new Error("db fail"));
    expect(() => render(<BookmarkReaderModal {...defaultProps} />)).not.toThrow();
  });

  // ══ Highlights ══

  it("renders existing highlights", async () => {
    mockGetHighlights.mockResolvedValue([
      { id: "h1", text: "Highlighted text", color: "#fef08a" },
    ]);
    const { container } = render(<BookmarkReaderModal {...defaultProps} />);
    await waitFor(() => {
      expect(container.textContent).toContain("Highlighted text");
    });
    expect(container.textContent).toContain("app_highlights");
  });

  it("deletes a highlight when clicking trash", async () => {
    mockGetHighlights.mockResolvedValue([
      { id: "h1", text: "Highlighted text", color: "#fef08a" },
    ]);
    mockRemoveHighlight.mockResolvedValue([]);
    const { container } = render(<BookmarkReaderModal {...defaultProps} />);
    await waitFor(() => {
      expect(container.textContent).toContain("Highlighted text");
    });
    const trashBtn = container.querySelector('[data-testid="icon-trash2"]');
    await userEvent.click(trashBtn!.closest("button")!);
    await waitFor(() => {
      expect(mockRemoveHighlight).toHaveBeenCalledWith("h1");
    });
  });

  it("adds highlight from the selection toolbar", async () => {
    mockGetHighlights.mockResolvedValue([]);
    const range = {
      getBoundingClientRect: () => ({ left: 100, width: 50, top: 100 }),
    };
    const selection = {
      toString: () => "Selected text",
      getRangeAt: () => range,
      removeAllRanges: vi.fn(),
    };
    vi.spyOn(window, "getSelection").mockReturnValue(selection as any);
    const { container } = render(<BookmarkReaderModal {...defaultProps} />);
    await waitFor(() => {
      expect(mockGetHighlights).toHaveBeenCalled();
    });
    const content = container.querySelector("[aria-label='Reading content']")!;
    fireEvent.mouseUp(content);
    const toolbar = container.querySelector('[role="toolbar"]');
    expect(toolbar).toBeTruthy();
    const colorBtn = toolbar!.querySelector("button")!;
    mockAddHighlight.mockResolvedValue({});
    await userEvent.click(colorBtn);
    await waitFor(() => {
      expect(mockAddHighlight).toHaveBeenCalledWith(
        "1",
        "Selected text",
        expect.any(String),
      );
    });
  });

  it("does not show toolbar when there is no selected text", () => {
    mockGetHighlights.mockResolvedValue([]);
    vi.spyOn(window, "getSelection").mockReturnValue({
      toString: () => "",
    } as any);
    const { container } = render(<BookmarkReaderModal {...defaultProps} />);
    const content = container.querySelector("[aria-label='Reading content']")!;
    fireEvent.mouseUp(content);
    expect(container.querySelector('[role="toolbar"]')).toBeNull();
  });

  // ══ AI Copilot ══

  it("generates key points with aiManager when clicking", async () => {
    mockGenerateText.mockResolvedValue({ text: "Bullet one\nBullet two" });
    render(<BookmarkReaderModal {...defaultProps} />);
    const copilotBtn = screen
      .getByTitle("app_aiCopilot")
      .closest("button")!;
    await userEvent.click(copilotBtn);
    const keyPointsBtn = screen.getByText("app_keyPoints");
    await userEvent.click(keyPointsBtn);
    await screen.findByText("Bullet one");
    expect(screen.getByText("Bullet two")).toBeTruthy();
  });

  it("discards stale key points when changing documents", async () => {
    let resolveKeyPoints!: (result: { text: string }) => void;
    mockGenerateText.mockReturnValue(
      new Promise((resolve) => {
        resolveKeyPoints = resolve;
      }),
    );
    const { rerender } = render(<BookmarkReaderModal {...defaultProps} />);
    await userEvent.click(screen.getByTitle("app_aiCopilot"));
    await userEvent.click(screen.getByText("app_keyPoints"));
    await waitFor(() => expect(mockGenerateText).toHaveBeenCalled());
    const signal = mockGenerateText.mock.calls[0]?.[2]?.signal;
    expect(signal).toBeInstanceOf(AbortSignal);

    rerender(
      <BookmarkReaderModal
        {...defaultProps}
        viewingContent={mockEmptyBookmark}
      />,
    );
    expect(signal?.aborted).toBe(true);
    resolveKeyPoints({ text: "Stale key points" });
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText("Stale key points")).toBeNull();
  });

  it("ignores highlights that resolve after unmount", async () => {
    let resolveHighlights!: (loaded: HighlightData[]) => void;
    mockGetHighlights.mockReturnValue(
      new Promise((resolve) => {
        resolveHighlights = resolve;
      }),
    );
    const { unmount } = render(<BookmarkReaderModal {...defaultProps} />);
    await waitFor(() => expect(mockGetHighlights).toHaveBeenCalled());
    unmount();
    resolveHighlights([
      {
        id: "late",
        bookmarkId: "1",
        text: "Late highlight",
        color: "#fef08a",
        note: "",
        createdAt: new Date().toISOString(),
      },
    ]);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByText("Late highlight")).toBeNull();
  });

  it("generates related with agentService when clicking", async () => {
    mockGlobalChat.mockResolvedValue({ text: "Related article" });
    render(<BookmarkReaderModal {...defaultProps} />);
    const copilotBtn = screen
      .getByTitle("app_aiCopilot")
      .closest("button")!;
    await userEvent.click(copilotBtn);
    await userEvent.click(screen.getByText("app_related"));
    await screen.findByText("Related article");
  });

  it("shows error if copilot fails", async () => {
    mockGenerateText.mockRejectedValue(new Error("ai down"));
    render(<BookmarkReaderModal {...defaultProps} />);
    const copilotBtn = screen
      .getByTitle("app_aiCopilot")
      .closest("button")!;
    await userEvent.click(copilotBtn);
    await userEvent.click(screen.getByText("app_keyPoints"));
    await screen.findByText("Failed to generate key points.");
  });

  // ══ Theme radiogroup: ArrowLeft / ArrowUp ══

  it("navigates to the previous topic with ArrowLeft in the radiogroup", () => {
    const { container } = render(<BookmarkReaderModal {...defaultProps} />);
    const radiogroup = container.querySelector('[role="radiogroup"]')!;
    fireEvent.keyDown(radiogroup, { key: "ArrowLeft" });
    const lightRadio = container.querySelector(
      '[aria-label="app_lightTheme"]',
    );
    expect(lightRadio?.getAttribute("aria-checked")).toBe("true");
  });

  it("navigates to the previous topic with ArrowUp in the radiogroup", () => {
    const { container } = render(<BookmarkReaderModal {...defaultProps} />);
    const radiogroup = container.querySelector('[role="radiogroup"]')!;
    fireEvent.keyDown(radiogroup, { key: "ArrowUp" });
    const lightRadio = container.querySelector(
      '[aria-label="app_lightTheme"]',
    );
    expect(lightRadio?.getAttribute("aria-checked")).toBe("true");
  });

  it("navigates to the next topic with ArrowDown in the radiogroup", () => {
    const { container } = render(<BookmarkReaderModal {...defaultProps} />);
    const radiogroup = container.querySelector('[role="radiogroup"]')!;
    fireEvent.keyDown(radiogroup, { key: "ArrowDown" });
    const sepiaRadio = container.querySelector(
      '[aria-label="app_sepiaTheme"]',
    );
    expect(sepiaRadio?.getAttribute("aria-checked")).toBe("true");
  });

  it("ignores non-navigation keys in handleThemeKeyDown", () => {
    const { container } = render(<BookmarkReaderModal {...defaultProps} />);
    const radiogroup = container.querySelector('[role="radiogroup"]')!;
    fireEvent.keyDown(radiogroup, { key: "Tab" });
    // Theme should remain dark (default)
    const darkRadio = container.querySelector('[aria-label="app_darkTheme"]');
    expect(darkRadio?.getAttribute("aria-checked")).toBe("true");
  });

  // ══ Scroll progress handler ══

  it("computes scroll progress when scrolling", () => {
    const { container } = render(<BookmarkReaderModal {...defaultProps} />);
    const scrollEl = container.querySelector(
      "[aria-label='Reading content']",
    )!;
    Object.defineProperty(scrollEl, "scrollTop", {
      value: 50,
      configurable: true,
    });
    Object.defineProperty(scrollEl, "scrollHeight", {
      value: 1000,
      configurable: true,
    });
    Object.defineProperty(scrollEl, "clientHeight", {
      value: 500,
      configurable: true,
    });
    fireEvent.scroll(scrollEl);
    expect(container.textContent).toContain("10%");
  });

  // ══ AI Reader modes (trio: Mood / Partner / Devil's Advocate) ══

  it("does not render any reader mode by default", () => {
    const { container } = render(<BookmarkReaderModal {...defaultProps} />);
    expect(container.textContent).not.toContain("px/s");
    expect(container.querySelector('[aria-label="Enable Devil\'s Advocate"]')).toBeNull();
  });

  it("activates MoodAdaptiveReader when selecting the Mood mode", async () => {
    // MoodAdaptiveReader drives a continuous RAF loop; under the file's
    // synchronous RAF mock that loop recurses infinitely, so restore the
    // real scheduler for this test only.
    globalThis.requestAnimationFrame = _origRAF;
    try {
      const { container } = render(<BookmarkReaderModal {...defaultProps} />);
      const typeBtn = container.querySelector('[data-testid="icon-type"]');
      await userEvent.click(typeBtn!.closest("button")!);
      const moodRadio = container.querySelector(
        '[aria-label="app_readerModeMood"]',
      );
      expect(moodRadio).toBeTruthy();
      await userEvent.click(moodRadio!);
      // Mood pill always shows the scroll-speed readout.
      expect(container.textContent).toContain("px/s");
    } finally {
      globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
        cb(performance.now());
        return 0;
      }) as any;
    }
  });

  it("activates AIReadingPartner when selecting the Partner mode", async () => {
    const { container } = render(<BookmarkReaderModal {...defaultProps} />);
    const typeBtn = container.querySelector('[data-testid="icon-type"]');
    await userEvent.click(typeBtn!.closest("button")!);
    const partnerRadio = container.querySelector(
      '[aria-label="app_readerModePartner"]',
    );
    await userEvent.click(partnerRadio!);
    // Vertical "AI" trigger button of the right-side drawer.
    expect(screen.getByText("AI")).toBeTruthy();
  });

  it("activates DevilAdvocateReader when selecting the Devil mode", async () => {
    const { container } = render(<BookmarkReaderModal {...defaultProps} />);
    const typeBtn = container.querySelector('[data-testid="icon-type"]');
    await userEvent.click(typeBtn!.closest("button")!);
    const devilRadio = container.querySelector('[aria-label="app_readerModeDevil"]');
    await userEvent.click(devilRadio!);
    expect(
      container.querySelector('[aria-label="Enable Devil\'s Advocate"]'),
    ).toBeTruthy();
  });

  it("reader modes do not render without content", async () => {
    const { container } = render(
      <BookmarkReaderModal
        {...defaultProps}
        viewingContent={mockEmptyBookmark}
      />,
    );
    const typeBtn = container.querySelector('[data-testid="icon-type"]');
    await userEvent.click(typeBtn!.closest("button")!);
    const moodRadio = container.querySelector('[aria-label="app_readerModeMood"]');
    await userEvent.click(moodRadio!);
    // No content → no overlays render even with the mode active.
    expect(container.textContent).not.toContain("px/s");
    expect(container.querySelector('[aria-label="Enable Devil\'s Advocate"]')).toBeNull();
  });
});
