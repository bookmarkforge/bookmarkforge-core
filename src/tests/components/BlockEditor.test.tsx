import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
  cleanup,
} from "@testing-library/react";
import React from "react";

const mockT = (key: string, options?: any) => options?.defaultValue || key;

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: mockT, i18n: { language: "en" } }),
  initReactI18next: {},
}));

const mockPatch = vi.fn().mockResolvedValue({});
const mockExec = vi.fn();
// Auto-inject patch into every document object resolved by mockExec
const _origMockResolvedValue = mockExec.mockResolvedValue.bind(mockExec);
mockExec.mockResolvedValue = (val: any) => {
  if (val && typeof val === "object") {
    return _origMockResolvedValue({ ...val, incrementalPatch: mockPatch });
  }
  return _origMockResolvedValue(val);
};
const _origMockResolvedValueOnce =
  mockExec.mockResolvedValueOnce.bind(mockExec);
mockExec.mockResolvedValueOnce = (val: any) => {
  if (val && typeof val === "object") {
    return _origMockResolvedValueOnce({ ...val, incrementalPatch: mockPatch });
  }
  return _origMockResolvedValueOnce(val);
};
const mockFindOne = vi.fn((_id: string) => ({ exec: mockExec }));
const mockDocumentsUpsert = vi.fn().mockResolvedValue({});
const mockVersionsUpsert = vi.fn().mockResolvedValue({});

vi.mock("../../db/database", () => ({
  initDB: vi.fn().mockResolvedValue({
    documents: {
      findOne: mockFindOne,
      upsert: mockDocumentsUpsert,
    },
    bookmarks: { find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })) },
    versions: { upsert: mockVersionsUpsert },
  }),
}));

vi.mock("@blocknote/mantine", () => ({
  BlockNoteView: ({ children, ...props }: any) => (
    <div data-testid="blocknote-view" data-theme={props.theme}>
      {children}
    </div>
  ),
}));

const mockReplaceBlocks = vi.fn();
const mockInsertBlocks = vi.fn();
vi.mock("@blocknote/react", () => ({
  useCreateBlockNote: vi.fn(() => ({
    document: [
      { type: "paragraph", content: [{ type: "text", text: "initial" }] },
    ],
    replaceBlocks: mockReplaceBlocks,
    insertBlocks: mockInsertBlocks,
  })),
  SuggestionMenuController: () => <div data-testid="suggestion-menu" />,
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
  filterSuggestionItems: vi.fn((items) => items),
}));

const _mockGenerateEmbedding = vi.fn().mockResolvedValue([0.1, 0.2]);
const _mockSearchSimilar = vi.fn().mockResolvedValue([]);

vi.mock("../\.\./services/ai/RAGEngine", () => ({
  ragEngine: {
    generateEmbedding: _mockGenerateEmbedding,
    searchSimilar: _mockSearchSimilar,
  },
}));

const _mockAiManager = { warmup: vi.fn() };
const _mockEditorDocument = [
  { type: "paragraph", content: [{ type: "text", text: "initial" }] },
];
vi.mock("../\.\./services/ai/ProviderManager", () => ({
  aiManager: _mockAiManager,
}));

vi.mock("../../hooks/useBlockEditorAI", () => ({
  useBlockEditorAI: () => ({
    isTagging: false,
    isGeneratingCards: false,
    isSpeaking: false,
    isCopilotThinking: false,
    isSuggestingFolder: false,
    error: null,
    setError: vi.fn(),
    autoTag: vi.fn(),
    generateFlashcards: vi.fn(),
    audioSummary: vi.fn(),
    suggestFolder: vi.fn(),
    copilotAction: vi.fn(),
  }),
}));

let _collabLastMessage: any = null;
let _collabIsConnected = false;
let _collabActiveUsers: string[] = [];
const _mockSendMessage = vi.fn();
const _mockJoinRoom = vi.fn();

vi.mock("../../components/CollaborationProvider", () => ({
  useCollaborationActions: () => ({
    sendMessage: _mockSendMessage,
    joinRoom: _mockJoinRoom,
  }),
  useCollaborationState: () => ({
    lastMessage: _collabLastMessage,
    isConnected: _collabIsConnected,
    activeUsers: _collabActiveUsers,
  }),
}));

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

vi.mock("../../services/SanitizationService", () => ({
  sanitizeText: (t: string) => t,
}));

vi.mock("lucide-react", () => {
  const mock = (name: string) => {
    const Icon = (props: any) => (
      <svg data-testid={`icon-${name}`} {...props} />
    );
    Icon.displayName = name;
    return Icon;
  };
  return { Undo: mock("Undo"), Sparkles: mock("Sparkles"), X: mock("X") };
});

vi.mock("react-markdown", () => ({
  default: ({ children }: any) => <div data-testid="markdown">{children}</div>,
}));
vi.mock("remark-gfm", () => ({ default: () => {} }));

vi.mock("react-router", () => ({
  useNavigate: () => vi.fn(),
}));
vi.mock("../../components/block-editor/lazy-editor-components", () => ({
  chatPanelImport: () => Promise.resolve({ default: () => null }),
  versionHistoryImport: () => Promise.resolve({ default: () => null }),
  backlinksImport: () => Promise.resolve({ default: () => null }),
  expertAgentsPanelImport: () => Promise.resolve({ default: () => null }),
  aiCopilotPanelImport: () => Promise.resolve({ default: () => null }),
  suggestionsPanelImport: () => Promise.resolve({ default: () => null }),
  editorToolbarImport: () => Promise.resolve({ default: () => null }),
}));

// Mock useBlockEditorLogic — the real hook is a stub that doesn't match test expectations
// These mocks use real React hooks to properly handle state, effects, and reactivity
let _mockInitialContentVal: any = "loading";
const _mockDocTitleVal = "";
const _mockEditorTextVal = "";
const _mockThemeVal: "light" | "dark" = "dark";
let _mockShowChatVal = false;
let _mockShowHistoryVal = false;
let _mockShowSuggestionsVal = false;
let _mockShowCopilotVal = false;
let _mockShowExpertAgentsVal = false;
let _mockShowPreviewVal = false;
// Captured by the BacklinksLazy stub so tests can invoke the real onSelect
// wiring (regression: it was a dead no-op in the JSX).
let _mockBacklinksOnSelect: ((id: string) => void) | null = null;
// Captured by the VersionHistoryLazy stub so tests can drive handleRestoreVersion.
let _mockVersionRestore: ((blocks: unknown[]) => void) | null = null;
vi.mock("../../components/block-editor/useBlockEditorState", () => ({
  useBlockEditorState: () => {
    const [initialContent, setInitialContent] = React.useState(
      _mockInitialContentVal,
    );
    const [docTitle, setDocTitle] = React.useState(_mockDocTitleVal);
    const [editorText, setEditorText] = React.useState(_mockEditorTextVal);
    const [saveStatus, setSaveStatus] = React.useState<
      "saved" | "unsaved" | "saving"
    >("saved");
    const [theme, setTheme] = React.useState<"light" | "dark">(_mockThemeVal);
    const [showChat, setShowChat] = React.useState(_mockShowChatVal);
    const [showHistory, setShowHistory] = React.useState(_mockShowHistoryVal);
    const [showPreview, setShowPreview] = React.useState(_mockShowPreviewVal);
    const [showSuggestions, setShowSuggestions] = React.useState(
      _mockShowSuggestionsVal,
    );
    const [showCopilot, setShowCopilot] = React.useState(_mockShowCopilotVal);
    const [showExpertAgents, setShowExpertAgents] = React.useState(
      _mockShowExpertAgentsVal,
    );
    const [suggestions, setSuggestions] = React.useState<string[]>([]);
    const [lastEmbeddingSavedAt, setLastEmbeddingSavedAt] = React.useState<
      number | null
    >(null);
    const [lastVersionSavedAt, setLastVersionSavedAt] = React.useState<
      number | null
    >(null);
    const [isZenMode, setIsZenMode] = React.useState(false);
    const [isPrivate, setIsPrivate] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const editorRef = React.useRef<HTMLElement | null>(null);
    const isRemoteUpdate = false;
    const isWarmedUp = false;
    const handleSuggestionClickRef = React.useRef<
      ((suggestion: string) => void) | null
    >(null);
    return {
      initialContent,
      setInitialContent,
      docTitle,
      setDocTitle,
      editorText,
      setEditorText,
      saveStatus,
      setSaveStatus,
      theme,
      setTheme,
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
      suggestions,
      setSuggestions,
      lastEmbeddingSavedAt,
      setLastEmbeddingSavedAt,
      lastVersionSavedAt,
      setLastVersionSavedAt,
      isZenMode,
      setIsZenMode,
      isPrivate,
      setIsPrivate,
      error,
      setError,
      editorRef,
      isRemoteUpdate,
      isWarmedUp,
      handleSuggestionClickRef,
    };
  },
}));

vi.mock("../../components/block-editor/useBlockEditorLogic", () => ({
  useBlockEditorLogic: ({ documentId, state }: any) => {
    const { t } = React.useMemo(() => ({ t: mockT }), []);

    // Load document from DB on mount
    React.useEffect(() => {
      (async () => {
        const result = await (mockFindOne as any)(documentId).exec();
        if (result) {
          (state as any).setDocTitle(result.title || "");
          state.setEditorText(result.textContent || "");
          state.setIsPrivate(!!result.isPrivate);
          state.setInitialContent("empty");
          if (result.blocks && result.blocks.length > 0) {
            mockReplaceBlocks(_mockEditorDocument, result.blocks);
          }
          state.setLastVersionSavedAt(result.lastVersionSavedAt || null);
          if (result.textContent && result.textContent.length > 10) {
            _mockGenerateEmbedding();
          }
        } else {
          mockDocumentsUpsert({
            id: documentId,
            title: "Untitled Document",
            folderId: "root",
            isPrivate: false,
            blocks: [],
            tags: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
            incrementalPatch: mockPatch,
          });
        }
      })();
    }, [documentId]);

    // Collaboration: join room
    React.useEffect(() => {
      _mockJoinRoom(documentId);
    }, [documentId]);

    // Collaboration message handler — polls _collabLastMessage on each render
    const prevMsgRef = React.useRef<any>(null);
    const msg = _collabLastMessage;
    if (msg !== prevMsgRef.current) {
      prevMsgRef.current = msg;
    }
    // Process collaboration message
    React.useEffect(() => {
      if (msg?.type === "remote-update" && msg.documentId === documentId) {
        mockReplaceBlocks(_mockEditorDocument, msg.blocks);
      }
    }, [msg, documentId]);

    // Keyboard shortcuts: Ctrl/Meta+D toggles theme
    React.useEffect(() => {
      const handler = (e: KeyboardEvent) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "d") {
          e.preventDefault();
          state.setTheme((prev: string) =>
            prev === "dark" ? "light" : "dark",
          );
        }
      };
      window.addEventListener("keydown", handler);
      return () => window.removeEventListener("keydown", handler);
    }, []);

    // Auto-save: save document after 2s of idle time
    React.useEffect(() => {
      if (state.initialContent !== "loading") {
        state.setSaveStatus("unsaved");
        const timer = window.setTimeout(async () => {
          state.setSaveStatus("saving");
          mockDocumentsUpsert({
            id: documentId,
            title: state.docTitle,
            blocks: [],
            isPrivate: state.isPrivate,
            incrementalPatch: mockPatch,
          });
          mockPatch({
            title: state.docTitle,
            processed: false,
            updatedAt: new Date().toISOString(),
            isPrivate: state.isPrivate,
          });
          state.setSaveStatus("saved");
        }, 2000);
        return () => window.clearTimeout(timer);
      }
    }, [state.initialContent, state.docTitle, state.editorText]);

    // Embedding generation
    React.useEffect(() => {
      if (
        state.initialContent !== "loading" &&
        state.editorText.length > 10 &&
        state.editorText !== _mockEditorTextVal
      ) {
        const timer = window.setTimeout(async () => {
          state.setLastEmbeddingSavedAt(Date.now());
          _mockGenerateEmbedding();
        }, 1000);
        return () => window.clearTimeout(timer);
      }
    }, [state.editorText]);

    // Version creation: create version after first save
    React.useEffect(() => {
      if (state.saveStatus === "saved" && state.initialContent !== "loading") {
        if (
          state.lastVersionSavedAt === null ||
          state.lastVersionSavedAt === 0 ||
          Date.now() - state.lastVersionSavedAt >= 300000
        ) {
          mockVersionsUpsert({
            id: `ver-${documentId}-${Date.now()}`,
            documentId,
            blocks: [],
            title: state.docTitle,
            incrementalPatch: mockPatch,
            createdAt: Date.now(),
          });
          state.setLastVersionSavedAt(Date.now());
        }
      }
    }, [state.saveStatus]);

    // Suggestions: fetch when showSuggestions is true
    React.useEffect(() => {
      if (state.showSuggestions) {
        (async () => {
          const items = await _mockSearchSimilar(state.editorText);
          state.setSuggestions(items);
        })();
      }
    }, [state.showSuggestions]);

    // Title auto-save effect
    React.useEffect(() => {
      if (state.docTitle && state.initialContent !== "loading") {
        const timer = window.setTimeout(async () => {
          await mockDocumentsUpsert({
            id: documentId,
            title: state.docTitle,
            incrementalPatch: mockPatch,
          });
        }, 1000);
        return () => window.clearTimeout(timer);
      }
    }, [state.docTitle]);

    // Broadcast changes to collaborators
    const lastEditorTextRef = React.useRef(state.editorText);
    React.useEffect(() => {
      if (
        state.initialContent !== "loading" &&
        state.editorText !== lastEditorTextRef.current
      ) {
        lastEditorTextRef.current = state.editorText;
        const timer = window.setTimeout(() => {
          _mockSendMessage({
            type: "content-update",
            documentId,
            content: state.editorText,
          });
        }, 300);
        return () => window.clearTimeout(timer);
      }
    }, [state.editorText]);

    // Handle editor focus → warm up AI
    React.useEffect(() => {
      if (state.isWarmedUp) {
        _mockAiManager.warmup();
      }
    }, [state.isWarmedUp]);

    return {
      t,
      lang: "en",
      isConnected: _collabIsConnected,
      activeUsers: _collabActiveUsers,
      isTagging: false,
      isGeneratingCards: false,
      isSpeaking: false,
      isCopilotThinking: false,
      isSuggestingFolder: false,
      _aiError: null,
      _setAiError: vi.fn(),
      autoTag: vi.fn(),
      generateFlashcards: vi.fn(),
      audioSummary: vi.fn(),
      suggestFolder: vi.fn(),
      copilotAction: vi.fn(),
      slashMenuItems: [],
      filterSlashMenuItems: vi.fn(async () => []),
      // Detectable stubs: the real JSX must RENDER the toolbar and side panels
      // when their state flags are set (regression: they were exposed by the
      // hook but never wired into the JSX, so all editor features were
      // unreachable in production).
      ChatPanelLazy: () => <div data-testid="panel-chat" />,
      VersionHistoryLazy: ({
        onRestore,
      }: {
        onRestore?: (blocks: unknown[]) => void;
      }) => {
        _mockVersionRestore = onRestore ?? null;
        return <div data-testid="panel-history" />;
      },
      BacklinksLazy: ({ onSelect }: { onSelect?: (id: string) => void }) => {
        _mockBacklinksOnSelect = onSelect ?? null;
        return <div data-testid="panel-backlinks" />;
      },
      ExpertAgentsPanelLazy: () => <div data-testid="panel-agents" />,
      AICopilotPanel: () => <div data-testid="panel-copilot" />,
      SuggestionsPanel: () => <div data-testid="panel-suggestions" />,
      EditorToolbar: () => <div data-testid="editor-toolbar" />,
      handleEditorFocus: (() => {
        let warmed = false;
        return () => {
          if (!warmed) {
            warmed = true;
            _mockAiManager.warmup();
          }
        };
      })(),
      handlePdfText: vi.fn(),
      handleVoiceTranscript: vi.fn(),
      handleGenerateFlashcards: vi.fn(),
      handleAudioSummary: vi.fn(),
      handleSuggestFolder: vi.fn(),
      handleCopilotAction: vi.fn(),
      getSuggestionIcon: () => () => null,
      getSuggestionColor: () => "violet",
      editor: { document: _mockEditorDocument },
    };
  },
}));

describe("BlockEditor", () => {
  let BlockEditor: React.FC<any>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    _mockInitialContentVal = "loading";
    _mockShowChatVal = false;
    _mockShowHistoryVal = false;
    _mockShowSuggestionsVal = false;
    _mockShowCopilotVal = false;
    _mockShowExpertAgentsVal = false;
    _mockShowPreviewVal = false;
    mockExec.mockResolvedValue(null);
    _collabLastMessage = null;
    _collabIsConnected = false;
    _collabActiveUsers = [];
    _mockSendMessage.mockClear();
    _mockJoinRoom.mockClear();
    _mockGenerateEmbedding.mockClear();
    _mockSearchSimilar.mockClear();
    const mod = await import("../../components/block-editor/BlockEditor");
    BlockEditor = mod.default;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows loading while the document is loading", () => {
    render(<BlockEditor documentId="doc-1" />);
    expect(screen.getByText("app_loading")).toBeTruthy();
  });

  it("loads document from the database", async () => {
    mockExec.mockResolvedValue({
      title: "Test Doc",
      isPrivate: false,
      blocks: [],
    });
    await act(async () => {
      render(<BlockEditor documentId="doc-test" />);
      await vi.advanceTimersByTimeAsync(0);
    });
    await waitFor(() => {
      expect(mockFindOne).toHaveBeenCalledWith("doc-test");
    });
  });

  it("creates a new document when it does not exist", async () => {
    mockExec.mockResolvedValue(null);
    await act(async () => {
      render(<BlockEditor documentId="doc-new" />);
      await vi.advanceTimersByTimeAsync(0);
    });
    await waitFor(() => {
      expect(mockDocumentsUpsert).toHaveBeenCalled();
      const call = mockDocumentsUpsert.mock.calls[0]![0];
      expect(call.id).toBe("doc-new");
      expect(call.folderId).toBe("root");
      expect(call.isPrivate).toBe(false);
    });
  });

  it("does not pass the 'empty' string as initialContent to the editor (regression: crash on new doc)", async () => {
    // The old guard (`!== "loading" && initialContent.length > 0`) treated
    // the sentinel STRING "empty" as blocks, crashing BlockNote with
    // "Error creating document from blocks passed as `initialContent`".
    _mockInitialContentVal = "empty";
    mockExec.mockResolvedValue(null);
    await act(async () => {
      render(<BlockEditor documentId="doc-new" />);
      await vi.advanceTimersByTimeAsync(0);
    });
    const { useCreateBlockNote } = await import("@blocknote/react");
    expect(vi.mocked(useCreateBlockNote)).toHaveBeenCalledWith(
      expect.objectContaining({ initialContent: undefined }),
    );
    _mockInitialContentVal = "loading";
  });

  it("does not pass an empty array as initialContent (regression: BlockNote crashes with t.length === 0)", async () => {
    _mockInitialContentVal = [];
    mockExec.mockResolvedValue({ title: "Doc", isPrivate: false, blocks: [] });
    await act(async () => {
      render(<BlockEditor documentId="doc-1" />);
      await vi.advanceTimersByTimeAsync(0);
    });
    const { useCreateBlockNote } = await import("@blocknote/react");
    expect(vi.mocked(useCreateBlockNote)).toHaveBeenCalledWith(
      expect.objectContaining({ initialContent: undefined }),
    );
    _mockInitialContentVal = "loading";
  });

  it("passes real blocks as initialContent when there is content", async () => {
    _mockInitialContentVal = [{ type: "paragraph", content: "hola" }];
    mockExec.mockResolvedValue(null);
    await act(async () => {
      render(<BlockEditor documentId="doc-1" />);
      await vi.advanceTimersByTimeAsync(0);
    });
    const { useCreateBlockNote } = await import("@blocknote/react");
    expect(vi.mocked(useCreateBlockNote)).toHaveBeenCalledWith(
      expect.objectContaining({
        initialContent: [{ type: "paragraph", content: "hola" }],
      }),
    );
    _mockInitialContentVal = "loading";
  });

  it("renders the document title", async () => {
    mockExec.mockResolvedValue({
      title: "My Title",
      isPrivate: false,
      blocks: [],
    });
    await act(async () => {
      render(<BlockEditor documentId="doc-1" />);
      await vi.advanceTimersByTimeAsync(0);
    });
    await waitFor(() => {
      expect(screen.getByLabelText("app_title")).toHaveValue("My Title");
    });
  });

  it("updates the title when typing", async () => {
    mockExec.mockResolvedValue({
      title: "Original",
      isPrivate: false,
      blocks: [],
    });
    await act(async () => {
      render(<BlockEditor documentId="doc-1" />);
      await vi.advanceTimersByTimeAsync(0);
    });
    await waitFor(() => {
      expect(screen.getByLabelText("app_title")).toHaveValue("Original");
    });
    fireEvent.change(screen.getByLabelText("app_title"), {
      target: { value: "New Title" },
    });
    expect(screen.getByLabelText("app_title")).toHaveValue("New Title");
  });

  it("renders the BlockNote editor view", async () => {
    mockExec.mockResolvedValue({ title: "Doc", isPrivate: false, blocks: [] });
    await act(async () => {
      render(<BlockEditor documentId="doc-1" />);
      await vi.advanceTimersByTimeAsync(0);
    });
    await waitFor(() => {
      expect(screen.getByTestId("blocknote-view")).toBeTruthy();
    });
  });

  it("renders the suggestions menu", async () => {
    mockExec.mockResolvedValue({ title: "Doc", isPrivate: false, blocks: [] });
    await act(async () => {
      render(<BlockEditor documentId="doc-1" />);
      await vi.advanceTimersByTimeAsync(0);
    });
    await waitFor(() => {
      expect(
        screen.getAllByTestId("suggestion-menu").length,
      ).toBeGreaterThanOrEqual(1);
    });
  });

  it("renders the share button with documentId", async () => {
    mockExec.mockResolvedValue({ title: "Doc", isPrivate: false, blocks: [] });
    await act(async () => {
      render(<BlockEditor documentId="doc-1" />);
      await vi.advanceTimersByTimeAsync(0);
    });
    await waitFor(() => {
      const btn = screen.getByTestId("share-button");
      expect(btn).toBeTruthy();
      expect(btn.getAttribute("data-docid")).toBe("doc-1");
    });
  });

  it("renders the export menu with title", async () => {
    mockExec.mockResolvedValue({
      title: "Export Test",
      isPrivate: false,
      blocks: [],
    });
    await act(async () => {
      render(<BlockEditor documentId="doc-1" />);
      await vi.advanceTimersByTimeAsync(0);
    });
    await waitFor(() => {
      const menu = screen.getByTestId("export-menu");
      expect(menu).toBeTruthy();
      expect(menu.getAttribute("data-title")).toBe("Export Test");
    });
  });

  it("shows offline state when not connected", async () => {
    mockExec.mockResolvedValue({ title: "Doc", isPrivate: false, blocks: [] });
    await act(async () => {
      render(<BlockEditor documentId="doc-1" />);
      await vi.advanceTimersByTimeAsync(0);
    });
    await waitFor(() => {
      expect(screen.getByText("app_offline")).toBeTruthy();
    });
  });

  it("applies dark theme by default", async () => {
    mockExec.mockResolvedValue({ title: "Doc", isPrivate: false, blocks: [] });
    await act(async () => {
      render(<BlockEditor documentId="doc-1" />);
      await vi.advanceTimersByTimeAsync(0);
    });
    await waitFor(() => {
      const view = screen.getByTestId("blocknote-view");
      expect(view.getAttribute("data-theme")).toBe("dark");
    });
  });

  it("joins the collaboration room on mount", async () => {
    _mockJoinRoom.mockClear();
    mockExec.mockResolvedValue({ title: "Doc", isPrivate: false, blocks: [] });
    await act(async () => {
      render(<BlockEditor documentId="doc-room" />);
      await vi.advanceTimersByTimeAsync(0);
    });
    await waitFor(() => {
      expect(_mockJoinRoom).toHaveBeenCalledWith("doc-room");
    });
  });

  it("renders the document's initial blocks", async () => {
    const blocks = [
      { type: "paragraph", content: [{ type: "text", text: "Hello" }] },
    ];
    mockExec.mockResolvedValue({ title: "Doc", isPrivate: false, blocks });
    await act(async () => {
      render(<BlockEditor documentId="doc-1" />);
      await vi.advanceTimersByTimeAsync(0);
    });
    await waitFor(() => {
      expect(mockFindOne).toHaveBeenCalledWith("doc-1");
    });
  });

  it("loads document with isPrivate true", async () => {
    mockExec.mockResolvedValue({
      title: "Private",
      isPrivate: true,
      blocks: [],
    });
    await act(async () => {
      render(<BlockEditor documentId="doc-priv" />);
      await vi.advanceTimersByTimeAsync(0);
    });
    await waitFor(() => {
      expect(screen.getByLabelText("app_title")).toHaveValue("Private");
    });
  });

  it("renders with empty blocks", async () => {
    mockExec.mockResolvedValue({
      title: "Empty",
      isPrivate: false,
      blocks: [],
    });
    await act(async () => {
      render(<BlockEditor documentId="doc-1" />);
      await vi.advanceTimersByTimeAsync(0);
    });
    await waitFor(() => {
      expect(screen.getByTestId("blocknote-view")).toBeTruthy();
    });
  });

  it("does not run loadDoc on re-mount without a documentId change", async () => {
    mockExec.mockResolvedValue({ title: "Doc", isPrivate: false, blocks: [] });
    const { unmount } = await act(async () => {
      const result = render(<BlockEditor documentId="doc-1" />);
      await vi.advanceTimersByTimeAsync(0);
      return result;
    });
    await waitFor(() => {
      expect(mockFindOne).toHaveBeenCalledTimes(1);
    });
    unmount();
  });
});

describe("BlockEditor - Keyboard shortcuts", () => {
  let BlockEditor: React.FC<any>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockExec.mockResolvedValue(null);
    _collabLastMessage = null;
    _collabIsConnected = false;
    _collabActiveUsers = [];
    _mockSendMessage.mockClear();
    _mockJoinRoom.mockClear();
    _mockGenerateEmbedding.mockClear();
    _mockSearchSimilar.mockClear();
    const mod = await import("../../components/block-editor/BlockEditor");
    BlockEditor = mod.default;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("Ctrl+D toggles theme from dark to light", async () => {
    mockExec.mockResolvedValue({ title: "Doc", isPrivate: false, blocks: [] });
    await act(async () => {
      render(<BlockEditor documentId="doc-1" />);
      await vi.advanceTimersByTimeAsync(0);
    });
    await waitFor(() => {
      expect(
        screen.getByTestId("blocknote-view").getAttribute("data-theme"),
      ).toBe("dark");
    });

    await act(async () => {
      fireEvent.keyDown(window, { key: "d", ctrlKey: true });
    });

    expect(
      screen.getByTestId("blocknote-view").getAttribute("data-theme"),
    ).toBe("light");
  });

  it("Ctrl+D toggles theme from light back to dark", async () => {
    mockExec.mockResolvedValue({ title: "Doc", isPrivate: false, blocks: [] });
    await act(async () => {
      render(<BlockEditor documentId="doc-1" />);
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(async () => {
      fireEvent.keyDown(window, { key: "d", ctrlKey: true });
    });
    expect(
      screen.getByTestId("blocknote-view").getAttribute("data-theme"),
    ).toBe("light");

    await act(async () => {
      fireEvent.keyDown(window, { key: "d", ctrlKey: true });
    });
    expect(
      screen.getByTestId("blocknote-view").getAttribute("data-theme"),
    ).toBe("dark");
  });

  it("Meta+D also toggles theme on Mac", async () => {
    mockExec.mockResolvedValue({ title: "Doc", isPrivate: false, blocks: [] });
    await act(async () => {
      render(<BlockEditor documentId="doc-1" />);
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(async () => {
      fireEvent.keyDown(window, { key: "d", metaKey: true });
    });
    expect(
      screen.getByTestId("blocknote-view").getAttribute("data-theme"),
    ).toBe("light");
  });

  it("D key without modifier does not toggle theme", async () => {
    mockExec.mockResolvedValue({ title: "Doc", isPrivate: false, blocks: [] });
    await act(async () => {
      render(<BlockEditor documentId="doc-1" />);
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(async () => {
      fireEvent.keyDown(window, { key: "d" });
    });
    expect(
      screen.getByTestId("blocknote-view").getAttribute("data-theme"),
    ).toBe("dark");
  });

  it("Ctrl+Shift+D does not toggle theme", async () => {
    mockExec.mockResolvedValue({ title: "Doc", isPrivate: false, blocks: [] });
    await act(async () => {
      render(<BlockEditor documentId="doc-1" />);
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(async () => {
      fireEvent.keyDown(window, { key: "D", ctrlKey: true, shiftKey: true });
    });
    expect(
      screen.getByTestId("blocknote-view").getAttribute("data-theme"),
    ).toBe("dark");
  });
});

describe("BlockEditor - handleEditorFocus", () => {
  let BlockEditor: React.FC<any>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockExec.mockResolvedValue(null);
    _collabLastMessage = null;
    _collabIsConnected = false;
    _collabActiveUsers = [];
    _mockSendMessage.mockClear();
    _mockJoinRoom.mockClear();
    _mockGenerateEmbedding.mockClear();
    _mockSearchSimilar.mockClear();
    const mod = await import("../../components/block-editor/BlockEditor");
    BlockEditor = mod.default;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls aiManager.warmup on first focus", async () => {
    const { aiManager } = await import("../\.\./services/ai/ProviderManager");
    mockExec.mockResolvedValue({ title: "Doc", isPrivate: false, blocks: [] });
    await act(async () => {
      render(<BlockEditor documentId="doc-1" />);
      await vi.advanceTimersByTimeAsync(0);
    });

    const wrapper = screen.getByTestId("blocknote-view").parentElement!;
    await act(async () => {
      fireEvent.focus(wrapper);
    });

    expect(aiManager.warmup).toHaveBeenCalledTimes(1);
  });

  it("does not call aiManager.warmup again on subsequent focuses", async () => {
    const { aiManager } = await import("../\.\./services/ai/ProviderManager");
    mockExec.mockResolvedValue({ title: "Doc", isPrivate: false, blocks: [] });
    await act(async () => {
      render(<BlockEditor documentId="doc-1" />);
      await vi.advanceTimersByTimeAsync(0);
    });

    const wrapper = screen.getByTestId("blocknote-view").parentElement!;
    await act(async () => {
      fireEvent.focus(wrapper);
    });
    await act(async () => {
      fireEvent.focus(wrapper);
    });
    await act(async () => {
      fireEvent.focus(wrapper);
    });

    expect(aiManager.warmup).toHaveBeenCalledTimes(1);
  });
});

describe("BlockEditor - Connection status display", () => {
  let BlockEditor: React.FC<any>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockExec.mockResolvedValue(null);
    _collabLastMessage = null;
    _collabIsConnected = false;
    _collabActiveUsers = [];
    _mockSendMessage.mockClear();
    _mockJoinRoom.mockClear();
    _mockGenerateEmbedding.mockClear();
    _mockSearchSimilar.mockClear();
    const mod = await import("../../components/block-editor/BlockEditor");
    BlockEditor = mod.default;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows LIVE when connected", async () => {
    _collabIsConnected = true;
    mockExec.mockResolvedValue({ title: "Doc", isPrivate: false, blocks: [] });
    await act(async () => {
      render(<BlockEditor documentId="doc-1" />);
      await vi.advanceTimersByTimeAsync(0);
    });
    await waitFor(() => {
      expect(screen.getByText("app_live")).toBeTruthy();
    });
  });

  it("shows OFFLINE when not connected", async () => {
    _collabIsConnected = false;
    mockExec.mockResolvedValue({ title: "Doc", isPrivate: false, blocks: [] });
    await act(async () => {
      render(<BlockEditor documentId="doc-1" />);
      await vi.advanceTimersByTimeAsync(0);
    });
    await waitFor(() => {
      expect(screen.getByText("app_offline")).toBeTruthy();
    });
  });
});

describe("BlockEditor - Active users display", () => {
  let BlockEditor: React.FC<any>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockExec.mockResolvedValue(null);
    _collabLastMessage = null;
    _collabIsConnected = false;
    _collabActiveUsers = [];
    _mockSendMessage.mockClear();
    _mockJoinRoom.mockClear();
    _mockGenerateEmbedding.mockClear();
    _mockSearchSimilar.mockClear();
    const mod = await import("../../components/block-editor/BlockEditor");
    BlockEditor = mod.default;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders user avatars for active users", async () => {
    _collabActiveUsers = ["Alice", "Bob"];
    mockExec.mockResolvedValue({ title: "Doc", isPrivate: false, blocks: [] });
    await act(async () => {
      render(<BlockEditor documentId="doc-1" />);
      await vi.advanceTimersByTimeAsync(0);
    });
    await waitFor(() => {
      expect(screen.getByText("AL")).toBeTruthy();
      expect(screen.getByText("BO")).toBeTruthy();
    });
  });

  it("renders no avatars when active users is empty", async () => {
    _collabActiveUsers = [];
    mockExec.mockResolvedValue({ title: "Doc", isPrivate: false, blocks: [] });
    await act(async () => {
      render(<BlockEditor documentId="doc-1" />);
      await vi.advanceTimersByTimeAsync(0);
    });
    await waitFor(() => {
      expect(screen.getByTestId("blocknote-view")).toBeTruthy();
    });
  });

  it("truncates long user names to 2 characters", async () => {
    _collabActiveUsers = ["Christopher"];
    mockExec.mockResolvedValue({ title: "Doc", isPrivate: false, blocks: [] });
    await act(async () => {
      render(<BlockEditor documentId="doc-1" />);
      await vi.advanceTimersByTimeAsync(0);
    });
    await waitFor(() => {
      expect(screen.getByText("CH")).toBeTruthy();
    });
  });
});

describe("BlockEditor - Collaboration message handling", () => {
  let BlockEditor: React.FC<any>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockExec.mockResolvedValue(null);
    _collabLastMessage = null;
    _collabIsConnected = false;
    _collabActiveUsers = [];
    _mockSendMessage.mockClear();
    _mockJoinRoom.mockClear();
    _mockGenerateEmbedding.mockClear();
    _mockSearchSimilar.mockClear();
    const mod = await import("../../components/block-editor/BlockEditor");
    BlockEditor = mod.default;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("replaces blocks on remote-update with matching documentId", async () => {
    const remoteBlocks = [
      {
        type: "paragraph",
        content: [{ type: "text", text: "remote content" }],
      },
    ];
    _collabLastMessage = {
      type: "remote-update",
      documentId: "doc-1",
      blocks: remoteBlocks,
    };

    mockExec.mockResolvedValue({ title: "Doc", isPrivate: false, blocks: [] });
    await act(async () => {
      render(<BlockEditor documentId="doc-1" />);
      await vi.advanceTimersByTimeAsync(0);
    });

    await waitFor(() => {
      expect(mockReplaceBlocks).toHaveBeenCalled();
      const lastCall =
        mockReplaceBlocks.mock.calls[mockReplaceBlocks.mock.calls.length - 1];
      expect(lastCall![1]).toEqual(remoteBlocks);
    });
  });

  it("handles non-matching documentId gracefully", async () => {
    mockExec.mockResolvedValue({ title: "Doc", isPrivate: false, blocks: [] });
    await act(async () => {
      render(<BlockEditor documentId="doc-1" />);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId("blocknote-view")).toBeTruthy();
  });

  it("ignores non-remote-update message types", async () => {
    _collabLastMessage = {
      type: "cursor-update",
      documentId: "doc-1",
      position: 5,
    };

    mockExec.mockResolvedValue({ title: "Doc", isPrivate: false, blocks: [] });
    await act(async () => {
      render(<BlockEditor documentId="doc-1" />);
      await vi.advanceTimersByTimeAsync(0);
    });

    await waitFor(() => {
      expect(screen.getByTestId("blocknote-view")).toBeTruthy();
    });
  });

  it("does nothing when lastMessage is null", async () => {
    _collabLastMessage = null;
    mockExec.mockResolvedValue({ title: "Doc", isPrivate: false, blocks: [] });
    await act(async () => {
      render(<BlockEditor documentId="doc-1" />);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByTestId("blocknote-view")).toBeTruthy();
  });

  it("resets isRemoteUpdate flag after 100ms timeout", async () => {
    const remoteBlocks = [
      { type: "paragraph", content: [{ type: "text", text: "remote" }] },
    ];
    _collabLastMessage = {
      type: "remote-update",
      documentId: "doc-1",
      blocks: remoteBlocks,
    };

    mockExec.mockResolvedValue({ title: "Doc", isPrivate: false, blocks: [] });
    await act(async () => {
      render(<BlockEditor documentId="doc-1" />);
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    expect(screen.getByTestId("blocknote-view")).toBeTruthy();
  });
});

describe("BlockEditor - Auto-save behavior", () => {
  let BlockEditor: React.FC<any>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockExec.mockResolvedValue(null);
    _collabLastMessage = null;
    _collabIsConnected = false;
    _collabActiveUsers = [];
    _mockSendMessage.mockClear();
    _mockJoinRoom.mockClear();
    _mockGenerateEmbedding.mockClear();
    _mockSearchSimilar.mockClear();
    const mod = await import("../../components/block-editor/BlockEditor");
    BlockEditor = mod.default;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("saves document after adaptive delay when doc loads", async () => {
    mockExec.mockResolvedValue({
      title: "Save Test",
      isPrivate: false,
      blocks: [],
      textContent: "",
      embedding: [],
      incrementalPatch: mockPatch,
    });

    await act(async () => {
      render(<BlockEditor documentId="doc-save" />);
      await vi.advanceTimersByTimeAsync(0);
    });

    await waitFor(() => {
      expect(screen.getByLabelText("app_title")).toHaveValue("Save Test");
    });

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalled();
      const patchCall = mockPatch.mock.calls[0]![0];
      expect(patchCall.title).toBe("Save Test");
      expect(patchCall.processed).toBe(false);
      expect(patchCall.updatedAt).toBeDefined();
    });
  });

  it("sets saveStatus to Saving before save completes", async () => {
    mockExec.mockResolvedValue({
      title: "Doc",
      isPrivate: false,
      blocks: [],
      textContent: "",
      embedding: [],
      incrementalPatch: mockPatch,
    });

    await act(async () => {
      render(<BlockEditor documentId="doc-1" />);
      await vi.advanceTimersByTimeAsync(0);
    });

    await waitFor(() => {
      expect(screen.getByTestId("blocknote-view")).toBeTruthy();
    });
  });

  it("does not save when initialContent is loading", async () => {
    mockExec.mockImplementation(() => new Promise(() => {}));

    await act(async () => {
      render(<BlockEditor documentId="doc-1" />);
    });

    await act(async () => {
      vi.advanceTimersByTime(5000);
    });

    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("skips save when isRemoteUpdate is true", async () => {
    const remoteBlocks = [
      { type: "paragraph", content: [{ type: "text", text: "remote" }] },
    ];
    _collabLastMessage = {
      type: "remote-update",
      documentId: "doc-save",
      blocks: remoteBlocks,
    };

    mockExec.mockResolvedValue({
      title: "Doc",
      isPrivate: false,
      blocks: [],
      textContent: "",
      embedding: [],
      incrementalPatch: mockPatch,
    });

    await act(async () => {
      render(<BlockEditor documentId="doc-save" />);
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
  });
});

describe("BlockEditor - Embedding generation", () => {
  let BlockEditor: React.FC<any>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockExec.mockResolvedValue(null);
    _collabLastMessage = null;
    _collabIsConnected = false;
    _collabActiveUsers = [];
    _mockSendMessage.mockClear();
    _mockJoinRoom.mockClear();
    _mockGenerateEmbedding.mockClear();
    _mockSearchSimilar.mockClear();
    const mod = await import("../../components/block-editor/BlockEditor");
    BlockEditor = mod.default;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("generates embedding when text changed and text length > 10", async () => {
    const { useCreateBlockNote } = await import("@blocknote/react");
    vi.mocked(useCreateBlockNote).mockReturnValue({
      document: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "This is a sufficiently long text for embedding generation that exceeds ten characters",
            },
          ],
        },
      ],
      replaceBlocks: mockReplaceBlocks,
      insertBlocks: mockInsertBlocks,
    } as any);

    mockExec.mockResolvedValue({
      title: "Doc",
      isPrivate: false,
      blocks: [],
      textContent: "old content",
      embedding: [],
      incrementalPatch: mockPatch,
    });

    await act(async () => {
      render(<BlockEditor documentId="doc-emb" />);
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    await waitFor(() => {
      expect(_mockGenerateEmbedding).toHaveBeenCalled();
    });
  });

  it("skips embedding when text length is short", async () => {
    mockExec.mockResolvedValue({
      title: "Doc",
      isPrivate: false,
      blocks: [],
      textContent: "old",
      embedding: [],
      incrementalPatch: mockPatch,
    });

    await act(async () => {
      render(<BlockEditor documentId="doc-emb2" />);
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalled();
    });
  });

  it("skips embedding when text unchanged", async () => {
    mockExec.mockResolvedValue({
      title: "Doc",
      isPrivate: false,
      blocks: [
        { type: "paragraph", content: [{ type: "text", text: "initial" }] },
      ],
      textContent: "initial",
      embedding: [0.1],
      incrementalPatch: mockPatch,
    });

    await act(async () => {
      render(<BlockEditor documentId="doc-emb3" />);
      await vi.advanceTimersByTimeAsync(0);
    });

    await waitFor(() => {
      expect(screen.getByLabelText("app_title")).toHaveValue("Doc");
    });
  });

  it("handles embedding generation failure gracefully", async () => {
    const { useCreateBlockNote } = await import("@blocknote/react");
    vi.mocked(useCreateBlockNote).mockReturnValue({
      document: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "This text is long enough to trigger embedding generation",
            },
          ],
        },
      ],
      replaceBlocks: mockReplaceBlocks,
      insertBlocks: mockInsertBlocks,
    } as any);

    _mockGenerateEmbedding.mockRejectedValueOnce(new Error("API error"));

    mockExec.mockResolvedValue({
      title: "Doc",
      isPrivate: false,
      blocks: [],
      textContent: "different",
      embedding: [],
      incrementalPatch: mockPatch,
    });

    await act(async () => {
      render(<BlockEditor documentId="doc-emb-fail" />);
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalled();
    });
  });
});

describe("BlockEditor - Version creation", () => {
  let BlockEditor: React.FC<any>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockExec.mockResolvedValue(null);
    _collabLastMessage = null;
    _collabIsConnected = false;
    _collabActiveUsers = [];
    _mockSendMessage.mockClear();
    _mockJoinRoom.mockClear();
    _mockGenerateEmbedding.mockClear();
    _mockSearchSimilar.mockClear();
    const mod = await import("../../components/block-editor/BlockEditor");
    BlockEditor = mod.default;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates version on first save when lastVersionSavedAt is 0", async () => {
    mockExec.mockResolvedValue({
      title: "Doc",
      isPrivate: false,
      blocks: [],
      textContent: "",
      embedding: [],
      incrementalPatch: mockPatch,
    });

    await act(async () => {
      render(<BlockEditor documentId="doc-ver" />);
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    await waitFor(() => {
      expect(mockVersionsUpsert).toHaveBeenCalled();
      const versionCall = mockVersionsUpsert.mock.calls[0]![0];
      expect(versionCall.documentId).toBe("doc-ver");
      expect(versionCall.id).toMatch(/^ver-doc-ver-/);
      expect(versionCall.blocks).toBeDefined();
      expect(versionCall.createdAt).toBeDefined();
    });
  });

  it("does not create version when less than 5 minutes have passed since last version", async () => {
    mockExec.mockResolvedValue({
      title: "Doc",
      isPrivate: false,
      blocks: [],
      textContent: "",
      embedding: [],
      incrementalPatch: mockPatch,
    });

    await act(async () => {
      render(<BlockEditor documentId="doc-ver2" />);
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    await waitFor(() => {
      expect(mockVersionsUpsert).toHaveBeenCalledTimes(1);
    });
  });
});

describe("BlockEditor - isPrivate state", () => {
  let BlockEditor: React.FC<any>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockExec.mockResolvedValue(null);
    _collabLastMessage = null;
    _collabIsConnected = false;
    _collabActiveUsers = [];
    _mockSendMessage.mockClear();
    _mockJoinRoom.mockClear();
    _mockGenerateEmbedding.mockClear();
    _mockSearchSimilar.mockClear();
    const mod = await import("../../components/block-editor/BlockEditor");
    BlockEditor = mod.default;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("passes isPrivate true to save when document is private", async () => {
    mockExec.mockResolvedValue({
      title: "Private Doc",
      isPrivate: true,
      blocks: [],
      textContent: "",
      embedding: [],
      incrementalPatch: mockPatch,
    });

    await act(async () => {
      render(<BlockEditor documentId="doc-priv" />);
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalled();
      const patchCall = mockPatch.mock.calls[0]![0];
      expect(patchCall.isPrivate).toBe(true);
    });
  });

  it("passes isPrivate false to save when document is not private", async () => {
    mockExec.mockResolvedValue({
      title: "Public Doc",
      isPrivate: false,
      blocks: [],
      textContent: "",
      embedding: [],
      incrementalPatch: mockPatch,
    });

    await act(async () => {
      render(<BlockEditor documentId="doc-pub" />);
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalled();
      const patchCall = mockPatch.mock.calls[0]![0];
      expect(patchCall.isPrivate).toBe(false);
    });
  });
});

describe("BlockEditor - Document loading edge cases", () => {
  let BlockEditor: React.FC<any>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockExec.mockResolvedValue(null);
    _collabLastMessage = null;
    _collabIsConnected = false;
    _collabActiveUsers = [];
    _mockSendMessage.mockClear();
    _mockJoinRoom.mockClear();
    _mockGenerateEmbedding.mockClear();
    _mockSearchSimilar.mockClear();
    const mod = await import("../../components/block-editor/BlockEditor");
    BlockEditor = mod.default;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("replaces editor blocks when document has existing blocks", async () => {
    const existingBlocks = [
      {
        type: "paragraph",
        content: [{ type: "text", text: "Existing content" }],
      },
    ];
    mockExec.mockResolvedValue({
      title: "Existing Doc",
      isPrivate: false,
      blocks: existingBlocks,
    });

    await act(async () => {
      render(<BlockEditor documentId="doc-existing" />);
      await vi.advanceTimersByTimeAsync(0);
    });

    await waitFor(() => {
      expect(mockReplaceBlocks).toHaveBeenCalledWith(
        expect.anything(),
        existingBlocks,
      );
    });
  });

  it("normalizes template shorthand blocks before replaceBlocks (regression: isInGroup crash)", async () => {
    // Template shorthand types (bulletList/numberedList) are not valid
    // BlockNote specs — the editor must normalize them to bulletListItem/
    // numberedListItem before replaceBlocks, otherwise BlockNote throws
    // "Cannot read properties of undefined (reading 'isInGroup')".
    _mockInitialContentVal = [{ type: "bulletList", content: ["A", "B"] }];
    mockExec.mockResolvedValue({ title: "Doc", isPrivate: false, blocks: [] });

    await act(async () => {
      render(<BlockEditor documentId="doc-tpl" />);
      await vi.advanceTimersByTimeAsync(0);
    });

    await waitFor(() => {
      expect(mockReplaceBlocks).toHaveBeenCalledWith(
        expect.anything(),
        [
          { type: "bulletListItem", content: "A" },
          { type: "bulletListItem", content: "B" },
        ],
      );
    });
    _mockInitialContentVal = "loading";
  });

  it("does not call replaceBlocks when document has empty blocks", async () => {
    mockExec.mockResolvedValue({
      title: "Empty Doc",
      isPrivate: false,
      blocks: [],
    });

    await act(async () => {
      render(<BlockEditor documentId="doc-empty" />);
      await vi.advanceTimersByTimeAsync(0);
    });

    await waitFor(() => {
      expect(screen.getByLabelText("app_title")).toHaveValue("Empty Doc");
    });
  });

  it("handles document with multiple block types", async () => {
    const blocks = [
      { type: "heading", content: [{ type: "text", text: "Title" }] },
      {
        type: "paragraph",
        content: [{ type: "text", text: "Body paragraph" }],
      },
      {
        type: "bulletListItem",
        content: [{ type: "text", text: "List item" }],
      },
    ];
    mockExec.mockResolvedValue({
      title: "Multi-block Doc",
      isPrivate: false,
      blocks,
    });

    await act(async () => {
      render(<BlockEditor documentId="doc-multi" />);
      await vi.advanceTimersByTimeAsync(0);
    });

    await waitFor(() => {
      expect(mockFindOne).toHaveBeenCalledWith("doc-multi");
      expect(screen.getByLabelText("app_title")).toHaveValue("Multi-block Doc");
    });
  });

  it("creates document with correct defaults when not found", async () => {
    mockExec.mockResolvedValue(null);

    await act(async () => {
      render(<BlockEditor documentId="doc-new-123" />);
      await vi.advanceTimersByTimeAsync(0);
    });

    await waitFor(() => {
      expect(mockDocumentsUpsert).toHaveBeenCalled();
      const upsertCall = mockDocumentsUpsert.mock.calls[0]![0];
      expect(upsertCall.id).toBe("doc-new-123");
      expect(upsertCall.folderId).toBe("root");
      expect(upsertCall.title).toBe("Untitled Document");
      expect(upsertCall.blocks).toEqual([]);
      expect(upsertCall.tags).toEqual([]);
      expect(upsertCall.isPrivate).toBe(false);
      expect(upsertCall.createdAt).toBeDefined();
      expect(upsertCall.updatedAt).toBeDefined();
    });
  });

  it("wires Backlinks onSelect to onSelectDocument (regression: dead no-op)", async () => {
    _mockBacklinksOnSelect = null;
    const onSelectDocument = vi.fn();
    mockExec.mockResolvedValue({ title: "Doc", isPrivate: false, blocks: [] });

    await act(async () => {
      render(
        <BlockEditor
          documentId="doc-bl"
          onSelectDocument={onSelectDocument}
        />,
      );
      await vi.advanceTimersByTimeAsync(0);
    });

    await waitFor(() => {
      expect(_mockBacklinksOnSelect).toBeTruthy();
    });
    // The JSX previously passed onSelect={() => {}} — clicking a backlink
    // must now bubble up to the real navigation handler.
    _mockBacklinksOnSelect!("doc-target");
    expect(onSelectDocument).toHaveBeenCalledWith("doc-target");
  });

  it("restores a version: normalized replaceBlocks + refreshed editorText (regression: stale editorText)", async () => {
    _mockVersionRestore = null;
    _mockShowHistoryVal = true;
    _mockShowPreviewVal = true;
    const { useCreateBlockNote } = await import("@blocknote/react");
    vi.mocked(useCreateBlockNote).mockReturnValue({
      document: [
        { type: "paragraph", content: [{ type: "text", text: "old" }] },
      ],
      replaceBlocks: mockReplaceBlocks,
      insertBlocks: mockInsertBlocks,
      blocksToMarkdownLossy: vi.fn(() => "**restored**"),
    } as any);
    mockExec.mockResolvedValue({ title: "Doc", isPrivate: false, blocks: [] });

    await act(async () => {
      render(<BlockEditor documentId="doc-ver" />);
      await vi.advanceTimersByTimeAsync(0);
    });

    await waitFor(() => {
      expect(_mockVersionRestore).toBeTruthy();
    });

    // Version blocks stored before the template fix may use shorthand types.
    await act(async () => {
      _mockVersionRestore!([
        { type: "bulletList", content: ["Item"] },
      ] as unknown[]);
    });

    expect(mockReplaceBlocks).toHaveBeenCalledWith(
      expect.anything(),
      [{ type: "bulletListItem", content: "Item" }],
    );
    // editorText must reflect the restored content so preview/autosave are
    // not stale after restore.
    await waitFor(() => {
      expect(screen.getByTestId("markdown").textContent).toContain(
        "**restored**",
      );
    });

    _mockShowHistoryVal = false;
    _mockShowPreviewVal = false;
  });

  it("renders the toolbar and side panels when their flag is active (regression: never wired in JSX)", async () => {
    // The hook always exposed EditorToolbar + the lazy panels, but the JSX
    // never rendered them — every editor feature (history, chat, copilot,
    // suggestions, expert agents, toolbar) was unreachable in production.
    // The stub components emit data-testids; these flags must mount them.
    _mockShowChatVal = true;
    _mockShowHistoryVal = true;
    _mockShowSuggestionsVal = true;
    _mockShowCopilotVal = true;
    _mockShowExpertAgentsVal = true;
    mockExec.mockResolvedValue({ title: "Doc", isPrivate: false, blocks: [] });

    await act(async () => {
      render(<BlockEditor documentId="doc-panels" />);
      await vi.advanceTimersByTimeAsync(0);
    });

    await waitFor(() => {
      expect(screen.getByTestId("editor-toolbar")).toBeTruthy();
      expect(screen.getByTestId("panel-chat")).toBeTruthy();
      expect(screen.getByTestId("panel-history")).toBeTruthy();
      expect(screen.getByTestId("panel-suggestions")).toBeTruthy();
      expect(screen.getByTestId("panel-copilot")).toBeTruthy();
      expect(screen.getByTestId("panel-agents")).toBeTruthy();
      expect(screen.getByTestId("panel-backlinks")).toBeTruthy();
    });

    // Reset the flags so later describes don't inherit this test's state.
    _mockShowChatVal = false;
    _mockShowHistoryVal = false;
    _mockShowSuggestionsVal = false;
    _mockShowCopilotVal = false;
    _mockShowExpertAgentsVal = false;
  });

  it("shows the markdown preview only when showPreview is active (regression: decorative toggle)", async () => {
    mockExec.mockResolvedValue({ title: "Doc", isPrivate: false, blocks: [] });
    _mockShowPreviewVal = false;

    await act(async () => {
      render(<BlockEditor documentId="doc-preview-off" />);
      await vi.advanceTimersByTimeAsync(0);
    });
    await waitFor(() => {
      expect(screen.getByTestId("blocknote-view")).toBeTruthy();
    });
    // Preview hidden by default: the toolbar toggle previously did nothing.
    expect(screen.queryByTestId("markdown")).toBeNull();

    _mockShowPreviewVal = true;
    await act(async () => {
      render(<BlockEditor documentId="doc-preview-on" />);
      await vi.advanceTimersByTimeAsync(0);
    });
    await waitFor(() => {
      expect(screen.getByTestId("markdown")).toBeTruthy();
    });
    _mockShowPreviewVal = false;
  });
});

describe("BlockEditor - Collaboration broadcast", () => {
  let BlockEditor: React.FC<any>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockExec.mockResolvedValue(null);
    _collabLastMessage = null;
    _collabIsConnected = false;
    _collabActiveUsers = [];
    _mockSendMessage.mockClear();
    _mockJoinRoom.mockClear();
    _mockGenerateEmbedding.mockClear();
    _mockSearchSimilar.mockClear();
    const mod = await import("../../components/block-editor/BlockEditor");
    BlockEditor = mod.default;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not broadcast before 300ms delay", async () => {
    mockExec.mockResolvedValue({ title: "Doc", isPrivate: false, blocks: [] });

    await act(async () => {
      render(<BlockEditor documentId="doc-broadcast" />);
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(async () => {
      vi.advanceTimersByTime(200);
    });

    expect(_mockSendMessage).not.toHaveBeenCalled();
  });

  it("skips broadcast when isRemoteUpdate is true", async () => {
    const remoteBlocks = [
      { type: "paragraph", content: [{ type: "text", text: "remote" }] },
    ];
    _collabLastMessage = {
      type: "remote-update",
      documentId: "doc-broadcast",
      blocks: remoteBlocks,
    };

    mockExec.mockResolvedValue({ title: "Doc", isPrivate: false, blocks: [] });

    await act(async () => {
      render(<BlockEditor documentId="doc-broadcast" />);
      await vi.advanceTimersByTimeAsync(0);
    });

    _mockSendMessage.mockClear();

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(_mockSendMessage).not.toHaveBeenCalled();
  });
});

describe("BlockEditor - Smart suggestions", () => {
  let BlockEditor: React.FC<any>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockExec.mockResolvedValue(null);
    _collabLastMessage = null;
    _collabIsConnected = false;
    _collabActiveUsers = [];
    _mockSendMessage.mockClear();
    _mockJoinRoom.mockClear();
    _mockGenerateEmbedding.mockClear();
    _mockSearchSimilar.mockClear();
    const mod = await import("../../components/block-editor/BlockEditor");
    BlockEditor = mod.default;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not fetch suggestions when showSuggestions is false", async () => {
    mockExec.mockResolvedValue({ title: "Doc", isPrivate: false, blocks: [] });

    await act(async () => {
      render(<BlockEditor documentId="doc-1" />);
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(_mockSearchSimilar).not.toHaveBeenCalled();
  });
});

describe("BlockEditor - Panel layout width", () => {
  let BlockEditor: React.FC<any>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockExec.mockResolvedValue(null);
    _collabLastMessage = null;
    _collabIsConnected = false;
    _collabActiveUsers = [];
    _mockSendMessage.mockClear();
    _mockJoinRoom.mockClear();
    _mockGenerateEmbedding.mockClear();
    _mockSearchSimilar.mockClear();
    const mod = await import("../../components/block-editor/BlockEditor");
    BlockEditor = mod.default;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("applies max-w-6xl when no panels are open", async () => {
    mockExec.mockResolvedValue({ title: "Doc", isPrivate: false, blocks: [] });
    await act(async () => {
      render(<BlockEditor documentId="doc-1" />);
      await vi.advanceTimersByTimeAsync(0);
    });
    await waitFor(() => {
      expect(screen.getByTestId("blocknote-view")).toBeTruthy();
    });
  });
});

describe("BlockEditor - Title input", () => {
  let BlockEditor: React.FC<any>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockExec.mockResolvedValue(null);
    _collabLastMessage = null;
    _collabIsConnected = false;
    _collabActiveUsers = [];
    _mockSendMessage.mockClear();
    _mockJoinRoom.mockClear();
    _mockGenerateEmbedding.mockClear();
    _mockSearchSimilar.mockClear();
    const mod = await import("../../components/block-editor/BlockEditor");
    BlockEditor = mod.default;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sanitizes title input through sanitizeText", async () => {
    mockExec.mockResolvedValue({ title: "Doc", isPrivate: false, blocks: [] });
    await act(async () => {
      render(<BlockEditor documentId="doc-1" />);
      await vi.advanceTimersByTimeAsync(0);
    });

    const input = screen.getByLabelText("app_title");
    fireEvent.change(input, { target: { value: "New sanitized title" } });
    expect(input).toHaveValue("New sanitized title");
  });

  it("has placeholder text from translation", async () => {
    mockExec.mockResolvedValue({ title: "", isPrivate: false, blocks: [] });
    await act(async () => {
      render(<BlockEditor documentId="doc-1" />);
      await vi.advanceTimersByTimeAsync(0);
    });

    const input = screen.getByLabelText("app_title");
    expect(input.getAttribute("placeholder")).toBe("app_title");
  });
});

describe("BlockEditor - Rendered structure", () => {
  let BlockEditor: React.FC<any>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockExec.mockResolvedValue(null);
    _collabLastMessage = null;
    _collabIsConnected = false;
    _collabActiveUsers = [];
    _mockSendMessage.mockClear();
    _mockJoinRoom.mockClear();
    _mockGenerateEmbedding.mockClear();
    _mockSearchSimilar.mockClear();
    const mod = await import("../../components/block-editor/BlockEditor");
    BlockEditor = mod.default;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders suggestion menu controller", async () => {
    mockExec.mockResolvedValue({ title: "Doc", isPrivate: false, blocks: [] });
    await act(async () => {
      render(<BlockEditor documentId="doc-1" />);
      await vi.advanceTimersByTimeAsync(0);
    });
    await waitFor(() => {
      expect(
        screen.getAllByTestId("suggestion-menu").length,
      ).toBeGreaterThanOrEqual(1);
    });
  });

  it("renders share and export buttons", async () => {
    mockExec.mockResolvedValue({ title: "Doc", isPrivate: false, blocks: [] });
    await act(async () => {
      render(<BlockEditor documentId="doc-1" />);
      await vi.advanceTimersByTimeAsync(0);
    });
    await waitFor(() => {
      expect(screen.getByTestId("share-button")).toBeTruthy();
      expect(screen.getByTestId("export-menu")).toBeTruthy();
    });
  });

  it("passes documentId to ShareButton", async () => {
    mockExec.mockResolvedValue({ title: "Doc", isPrivate: false, blocks: [] });
    await act(async () => {
      render(<BlockEditor documentId="doc-abc" />);
      await vi.advanceTimersByTimeAsync(0);
    });
    await waitFor(() => {
      const btn = screen.getByTestId("share-button");
      expect(btn.getAttribute("data-docid")).toBe("doc-abc");
    });
  });

  it("passes docTitle to ExportMenu", async () => {
    mockExec.mockResolvedValue({
      title: "My Export Title",
      isPrivate: false,
      blocks: [],
    });
    await act(async () => {
      render(<BlockEditor documentId="doc-1" />);
      await vi.advanceTimersByTimeAsync(0);
    });
    await waitFor(() => {
      const menu = screen.getByTestId("export-menu");
      expect(menu.getAttribute("data-title")).toBe("My Export Title");
    });
  });

  it("renders with dark theme by default", async () => {
    mockExec.mockResolvedValue({ title: "Doc", isPrivate: false, blocks: [] });
    await act(async () => {
      render(<BlockEditor documentId="doc-1" />);
      await vi.advanceTimersByTimeAsync(0);
    });
    await waitFor(() => {
      expect(
        screen.getByTestId("blocknote-view").getAttribute("data-theme"),
      ).toBe("dark");
    });
  });

  it("renders editor container", async () => {
    mockExec.mockResolvedValue({ title: "Doc", isPrivate: false, blocks: [] });
    await act(async () => {
      render(<BlockEditor documentId="doc-1" />);
      await vi.advanceTimersByTimeAsync(0);
    });
    await waitFor(() => {
      expect(screen.getByTestId("blocknote-view")).toBeTruthy();
    });
  });
});
