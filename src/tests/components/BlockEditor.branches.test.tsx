import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import React from "react";

const mockT = (key: string, options?: any) => options?.defaultValue || key;

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: mockT, i18n: { language: "en" } }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Mutable state controlled per test (the real hook stays mocked with
// React.useState so the setters work inside a render).
// ---------------------------------------------------------------------------
let _initialContent: any = [];
let _docTitle = "";
let _editorText = "";
let _error: string | null = null;
let _showPreview = false;
let _showSuggestions = false;
let _showCopilot = false;
let _showChat = false;
let _showExpertAgents = false;
let _theme: "light" | "dark" = "dark";
// The editor picks its BlockNote dictionary from the hook's `lang`. The mock
// must expose it: without `lang`, `lang.startsWith("es")` throws on undefined
// during render, and the dictionary branch is never observable.
let _lang = "en";

vi.mock("../../components/block-editor/useBlockEditorState", () => ({
  useBlockEditorState: () => {
    const [initialContent, setInitialContent] = React.useState(_initialContent);
    const [docTitle, setDocTitle] = React.useState(_docTitle);
    const [editorText, setEditorText] = React.useState(_editorText);
    const [theme, setTheme] = React.useState(_theme);
    const [showChat, setShowChat] = React.useState(_showChat);
    const [showHistory, setShowHistory] = React.useState(false);
    const [showPreview, setShowPreview] = React.useState(_showPreview);
    const [showSuggestions, setShowSuggestions] = React.useState(_showSuggestions);
    const [showCopilot, setShowCopilot] = React.useState(_showCopilot);
    const [showExpertAgents, setShowExpertAgents] =
      React.useState(_showExpertAgents);
    const [error, setError] = React.useState(_error);
    return {
      initialContent,
      setInitialContent,
      docTitle,
      setDocTitle,
      editorText,
      setEditorText,
      theme,
      setTheme,
      saveStatus: "saved" as const,
      setSaveStatus: vi.fn(),
      showChat,
      setShowChat,
      showHistory,
      setShowHistory,
      showPreview,
      setShowPreview,
      showSuggestions,
      setShowSuggestions,
      showCopilot,
      setShowCopilot,
      showExpertAgents,
      setShowExpertAgents,
      isZenMode: false,
      setIsZenMode: vi.fn(),
      isPrivate: false,
      setIsPrivate: vi.fn(),
      suggestions: [] as string[],
      setSuggestions: vi.fn(),
      error,
      setError,
    };
  },
}));

vi.mock("../../components/block-editor/useBlockEditorLogic", () => ({
  useBlockEditorLogic: () => ({
    t: mockT,
    isConnected: false,
    activeUsers: [] as string[],
    slashMenuItems: [],
    handleEditorFocus: vi.fn(),
    isTagging: false,
    isGeneratingCards: false,
    isSpeaking: false,
    lang: _lang,
    isSuggestingFolder: false,
    isCopilotThinking: false,
    EditorToolbar: () => null,
    VersionHistoryLazy: () => null,
    ChatPanelLazy: () => null,
    BacklinksLazy: () => null,
    ExpertAgentsPanelLazy: () => null,
    AICopilotPanel: () => null,
    SuggestionsPanel: () => null,
    handleVoiceTranscript: vi.fn(),
    handlePdfText: vi.fn(),
    handleGenerateFlashcards: vi.fn(),
    handleAudioSummary: vi.fn(),
    handleSuggestFolder: vi.fn(),
    handleCopilotAction: vi.fn(),
    autoTag: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Editor and mentions menu: SuggestionMenuController captures getItems
// so the real getMentionItems callback can be invoked from the test.
// ---------------------------------------------------------------------------
let _mentionGetItems: ((q: string) => Promise<any[]>) | null = null;
let _editorObj: any = {};

vi.mock("@blocknote/mantine", () => ({
  BlockNoteView: ({ children, ...props }: any) => (
    <div data-testid="blocknote-view" data-theme={props.theme}>
      {children}
    </div>
  ),
}));

vi.mock("@blocknote/react", () => ({
  useCreateBlockNote: vi.fn(() => _editorObj),
  SuggestionMenuController: ({ getItems }: any) => {
    _mentionGetItems = getItems;
    return <div data-testid="suggestion-menu" />;
  },
}));

vi.mock("@blocknote/core", () => ({
  createBlockConfig: vi.fn(() => () => ({
    type: "callout",
    propSchema: {},
    content: "inline",
  })),
  createBlockSpec: vi.fn(() => () => ({
    config: {},
    implementation: {},
    extensions: [],
  })),
  createExtension: vi.fn(() => ({ key: "mock" })),
  defaultBlockSpecs: {},
  defaultProps: {
    backgroundColor: { default: "default" },
    textColor: { default: "default" },
  },
  BlockNoteSchema: { create: vi.fn(() => ({})) },
  defaultInlineContentSchema: {},
  defaultStyleSchema: {},
  insertOrUpdateBlockForSlashMenu: vi.fn(),
  filterSuggestionItems: vi.fn((items: any[]) => items),
}));

// ---------------------------------------------------------------------------
// DB: findOne/find/upsert controlables por test
// ---------------------------------------------------------------------------
const mockInitDB = vi.fn().mockResolvedValue({
  documents: {
    findOne: vi.fn(() => ({ exec: vi.fn().mockResolvedValue(null) })),
    find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
    upsert: vi.fn().mockResolvedValue({}),
  },
  bookmarks: { find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })) },
  versions: { upsert: vi.fn().mockResolvedValue({}) },
});
vi.mock("../../db/database", () => ({ initDB: mockInitDB }));

vi.mock("../../services/SanitizationService", () => ({
  sanitizeText: (t: string) => t,
}));
vi.mock("react-markdown", () => ({
  default: ({ children }: any) => <div data-testid="markdown">{children}</div>,
}));
vi.mock("remark-gfm", () => ({ default: () => {} }));
vi.mock("lucide-react", () => {
  const mock = (name: string) => {
    const Icon = (props: any) => (
      <svg data-testid={`icon-${name}`} {...props} />
    );
    Icon.displayName = name;
    return Icon;
  };
  return {
    Undo: mock("Undo"),
    Sparkles: mock("Sparkles"),
    X: mock("X"),
    Link: mock("Link"),
  };
});
vi.mock("../../components/ShareButton", () => ({
  ShareButton: ({ documentId }: any) => (
    <div data-testid="share-button" data-docid={documentId} />
  ),
}));
vi.mock("../../components/ExportMenu", () => ({
  ExportMenu: ({ title }: any) => (
    <div data-testid="export-menu" data-title={title} />
  ),
}));

describe("BlockEditor - uncovered branches", () => {
  let BlockEditor: React.FC<any>;

  beforeEach(async () => {
    vi.clearAllMocks();
    _initialContent = [];
    _docTitle = "";
    _editorText = "";
    _error = null;
    _showPreview = false;
    _showSuggestions = false;
    _showCopilot = false;
    _showChat = false;
    _showExpertAgents = false;
    _theme = "dark";
    _lang = "en";
    _mentionGetItems = null;
    _editorObj = {
      document: [
        { type: "paragraph", content: [{ type: "text", text: "hi" }] },
      ],
      getSelection: vi.fn(() => null),
      insertInlineContent: vi.fn(),
      updateBlock: vi.fn(),
    };
    mockInitDB.mockResolvedValue({
      documents: {
        findOne: vi.fn(() => ({ exec: vi.fn().mockResolvedValue(null) })),
        find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
        upsert: vi.fn().mockResolvedValue({}),
      },
      bookmarks: {
        find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
      },
      versions: { upsert: vi.fn().mockResolvedValue({}) },
    });
    const mod = await import("../../components/block-editor/BlockEditor");
    BlockEditor = mod.default;
  });

  it("shows the error banner when an error exists", () => {
    _error = "AI service unavailable";
    render(<BlockEditor documentId="doc-1" />);
    expect(screen.getByText("AI service unavailable")).toBeTruthy();
  });

  it("discards the error with the Undo button", async () => {
    _error = "Temporary failure";
    render(<BlockEditor documentId="doc-1" />);
    const undoBtn = screen.getByTestId("icon-Undo").closest("button")!;
    fireEvent.click(undoBtn);
    await waitFor(() => {
      expect(screen.queryByText("Temporary failure")).toBeNull();
    });
  });

  it("does not show the banner when there is no error", () => {
    render(<BlockEditor documentId="doc-1" />);
    expect(screen.queryByTestId("icon-Undo")).toBeNull();
  });

  it("uses max-w-6xl when there are no open panels", async () => {
    const { container } = render(<BlockEditor documentId="doc-1" />);
    // El entorno inyecta <style> como primeros hijos del container;
    // the component root is the div with rounded-2xl (unique in the render)
    const root = container.querySelector(".rounded-2xl")!;
    expect(root.className).toContain("max-w-6xl");
  });

  it("uses max-w-7xl when showPreview is open", async () => {
    _showPreview = true;
    const { container } = render(<BlockEditor documentId="doc-1" />);
    const root = container.querySelector(".rounded-2xl")!;
    expect(root.className).toContain("max-w-7xl");
  });

  it("passes the English dictionary for a non-Spanish locale", async () => {
    _lang = "en";
    render(<BlockEditor documentId="doc-1" />);
    const { useCreateBlockNote } = await import("@blocknote/react");
    const { en } = await import("@blocknote/core/locales");
    const calls = (useCreateBlockNote as unknown as { mock: { calls: any[][] } })
      .mock.calls;
    expect(calls.at(-1)![0].dictionary).toBe(en);
  });

  it("passes the Spanish dictionary for any Spanish locale (es-MX), not only `es`", async () => {
    _lang = "es-MX";
    render(<BlockEditor documentId="doc-1" />);
    const { useCreateBlockNote } = await import("@blocknote/react");
    const { en, es } = await import("@blocknote/core/locales");
    const calls = (useCreateBlockNote as unknown as { mock: { calls: any[][] } })
      .mock.calls;
    // `startsWith` (not `===`) is what makes every es-* locale Spanish; an
    // equality check would silently fall back to English for es-MX, es-AR, …
    expect(calls.at(-1)![0].dictionary).toBe(es);
    expect(calls.at(-1)![0].dictionary).not.toBe(en);
  });

  it("suggests documents by @-mention excluding the current document", async () => {
    const docs = [
      { id: "doc-1", title: "Alpha Doc" },
      { id: "doc-2", title: "Alpha Beta" },
      { id: "doc-3", title: "Gamma" },
    ];
    mockInitDB.mockResolvedValue({
      documents: {
        findOne: vi.fn(() => ({ exec: vi.fn().mockResolvedValue(null) })),
        find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue(docs) })),
        upsert: vi.fn().mockResolvedValue({}),
      },
      bookmarks: {
        find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
      },
      versions: { upsert: vi.fn().mockResolvedValue({}) },
    });
    render(<BlockEditor documentId="doc-1" />);
    const getItems = _mentionGetItems!;
    expect(getItems).toBeTruthy();
    await act(async () => {
      const items = await getItems("alpha");
      // doc-1 excluido (es el actual), doc-3 no matchea
      expect(items.map((i: any) => i.key)).toEqual(["doc-2"]);
      expect(items[0].title).toBe("Alpha Beta");
      expect(items[0].group).toBe("documents");
      expect(items[0].aliases).toEqual(["Alpha Beta"]);
    });
  });

  it("inserts an internal link when clicking a mention", async () => {
    const docs = [{ id: "doc-2", title: "Alpha Beta" }];
    mockInitDB.mockResolvedValue({
      documents: {
        findOne: vi.fn(() => ({ exec: vi.fn().mockResolvedValue(null) })),
        find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue(docs) })),
        upsert: vi.fn().mockResolvedValue({}),
      },
      bookmarks: {
        find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
      },
      versions: { upsert: vi.fn().mockResolvedValue({}) },
    });
    _editorObj.getSelection = vi.fn(() => ({
      blocks: [{ type: "paragraph", props: {} }],
    }));
    render(<BlockEditor documentId="doc-1" />);
    await act(async () => {
      const items = await _mentionGetItems!("alpha");
      items[0].onItemClick();
    });
    expect(_editorObj.updateBlock).toHaveBeenCalled();
    expect(_editorObj.insertInlineContent).toHaveBeenCalled();
    const inserted = _editorObj.insertInlineContent.mock.calls[0][0];
    expect(inserted[0].href).toBe("bookmark://doc/doc-2");
  });

  it("returns empty list if the document search fails", async () => {
    mockInitDB.mockResolvedValue({
      documents: {
        findOne: vi.fn(() => ({ exec: vi.fn().mockResolvedValue(null) })),
        find: vi.fn(() => ({ exec: vi.fn().mockRejectedValue(new Error("db")) })),
        upsert: vi.fn().mockResolvedValue({}),
      },
      bookmarks: {
        find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })),
      },
      versions: { upsert: vi.fn().mockResolvedValue({}) },
    });
    render(<BlockEditor documentId="doc-1" />);
    await act(async () => {
      const items = await _mentionGetItems!("alpha");
      expect(items).toEqual([]);
    });
  });
});
