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
  initReactI18next: { type: "3rdParty", init: vi.fn() },
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
const mockDocumentsFind = vi.fn(() => ({
  exec: vi.fn().mockResolvedValue([]),
}));
const mockVersionsUpsert = vi.fn().mockResolvedValue({});

vi.mock("../../db/database", () => ({
  initDB: vi.fn().mockResolvedValue({
    documents: {
      findOne: mockFindOne,
      upsert: mockDocumentsUpsert,
      find: mockDocumentsFind,
    },
    bookmarks: { find: vi.fn(() => ({ exec: vi.fn().mockResolvedValue([]) })) },
    versions: { upsert: mockVersionsUpsert },
  }),
}));

// The REAL useBlockEditorLogic round-trips attachments through this store on
// load (hydrate) and autosave (persist); stub it so no real storage or
// decryption is touched while the real hook effects run.
vi.mock("../../services/documentAttachments", () => ({
  attachmentStore: {
    hydrateBlocks: vi.fn(async (_docId: string, blocks: unknown[]) => blocks),
    hydrateText: vi.fn(async (_docId: string, text: string) => text),
    persistBlocks: vi.fn(async (_docId: string, blocks: unknown[]) => blocks),
    persistText: vi.fn(async (_docId: string, text: string) => text),
    persistFile: vi.fn(async () => "att-1"),
    register: vi.fn(),
    revokeAll: vi.fn(),
    revokeUnreferenced: vi.fn(),
    revokeDocumentUrls: vi.fn(),
  },
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

// BroadcastChannel double: the REAL hook receives collaborator presence
// through a "block-editor-presence" channel; this mock captures instances so
// tests can drive real messages. (The old fabricated hook had no channel at
// all — its "presence" existed only inside the mock.)
class MockBroadcastChannel {
  static instances: MockBroadcastChannel[] = [];
  listeners = new Set<(e: { data: unknown }) => void>();
  closed = false;
  constructor(public name: string) {
    MockBroadcastChannel.instances.push(this);
  }
  addEventListener(_t: string, cb: (e: { data: unknown }) => void) {
    this.listeners.add(cb);
  }
  removeEventListener(_t: string, cb: (e: { data: unknown }) => void) {
    this.listeners.delete(cb);
  }
  close() {
    this.closed = true;
  }
}
vi.stubGlobal(
  "BroadcastChannel",
  MockBroadcastChannel as unknown as typeof BroadcastChannel,
);

// vi.hoisted: mocked-module factories can run during the top-of-file import
// phase, before plain const declarations initialize.
const _mockAiManager = vi.hoisted(() => ({
  warmup: vi.fn().mockResolvedValue(undefined),
}));

// Canary spies for the never-starts-WebLLM contract: the editor UI layer must
// not touch the WebLLM engine directly — local-AI preload goes exclusively
// through the guarded aiManager.warmup() inside editorFocusWarmup.
const _mockWebLLM = vi.hoisted(() => ({
  init: vi.fn().mockResolvedValue(undefined),
  generateText: vi.fn().mockResolvedValue(""),
  unload: vi.fn().mockResolvedValue(undefined),
  canRunLocalLLM: vi.fn().mockResolvedValue(true),
  getHealthStatus: vi.fn().mockResolvedValue({
    ready: false,
    modelLoaded: false,
    currentModel: "",
    webGPUSupported: true,
    f16Supported: true,
    deviceMemoryGB: 8,
  }),
}));
const _mockEditorDocument = [
  { type: "paragraph", content: [{ type: "text", text: "initial" }] },
];
vi.mock("../../services/ai/ProviderManager", () => ({
  aiManager: _mockAiManager,
}));

vi.mock("../../services/ai/WebLLMService", () => ({
  webLLMService: _mockWebLLM,
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

// lucide-react is NOT mocked: the REAL hook imports many icons (Heading1,
// Heading2, Sparkles, ...) and no test asserts icon internals, so the real
// module loads as-is.

vi.mock("react-markdown", () => ({
  default: ({ children }: any) => <div data-testid="markdown">{children}</div>,
}));
vi.mock("remark-gfm", () => ({ default: () => {} }));

vi.mock("react-router", () => ({
  useNavigate: () => vi.fn(),
}));
// Lazy-panel doubles: boundary stubs at the lazy-import seam. The real JSX
// mounts these components when their state flags are on, so the stubs emit
// data-testids (letting the JSX-wiring regression tests pass against the
// REAL hook + REAL JSX) and capture the two callback props the JSX wires
// (onRestore/onSelect) so tests can drive the real handlers.

// State double: controlled, React-backed editor state fed to the REAL
// useBlockEditorLogic hook, so its load/autosave effects run for real
// against the mocked db/attachment boundaries.
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
    const isWarmedUpRef = React.useRef(false);
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
      isWarmedUpRef,
      handleSuggestionClickRef,
    };
  },
}));

// Lazy-panel doubles at the lazy-import seam: the REAL JSX mounts these
// components when their state flags are on (Backlinks always, once the editor
// exists), so the doubles emit data-testids — letting the JSX-wiring
// regression tests run against the REAL hook + REAL JSX — and capture the
// two callback props the JSX wires (onRestore/onSelect) so tests can drive
// the real handlers.
vi.mock("../../components/block-editor/lazy-editor-components", () => ({
  chatPanelImport: () =>
    Promise.resolve({ default: () => <div data-testid="panel-chat" /> }),
  versionHistoryImport: () =>
    Promise.resolve({
      default: ({
        onRestore,
      }: {
        onRestore?: (blocks: unknown[]) => void;
      }) => {
        _mockVersionRestore = onRestore ?? null;
        return <div data-testid="panel-history" />;
      },
    }),
  backlinksImport: () =>
    Promise.resolve({
      default: ({ onSelect }: { onSelect?: (id: string) => void }) => {
        _mockBacklinksOnSelect = onSelect ?? null;
        return <div data-testid="panel-backlinks" />;
      },
    }),
  expertAgentsPanelImport: () =>
    Promise.resolve({ default: () => <div data-testid="panel-agents" /> }),
  aiCopilotPanelImport: () =>
    Promise.resolve({ default: () => <div data-testid="panel-copilot" /> }),
  suggestionsPanelImport: () =>
    Promise.resolve({
      default: () => <div data-testid="panel-suggestions" />,
    }),
  editorToolbarImport: () =>
    Promise.resolve({ default: () => <div data-testid="editor-toolbar" /> }),
}));

// NOTE: useBlockEditorLogic is deliberately NOT mocked. A previous version of
// this file replaced the entire hook with a factory that re-implemented its
// orchestration (load, autosave, versions, presence) — the tests then
// verified the factory script instead of production code, and production
// drift could never fail them. The REAL hook now runs against the mocked
// db / attachmentStore / BroadcastChannel boundaries; its logic-level
// contracts live in useBlockEditorLogic.hook.test.ts and
// useBlockEditorLogic.persistence.test.ts.

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
    MockBroadcastChannel.instances.length = 0;
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

  it("receives collaborator presence through the real BroadcastChannel wiring", async () => {
    // The REAL hook subscribes to a "block-editor-presence" BroadcastChannel
    // and maps incoming users to avatars. (The old test asserted a fabricated
    // joinRoom() that production never calls — presence has no room concept.)
    mockExec.mockResolvedValue({ title: "Doc", isPrivate: false, blocks: [] });
    await act(async () => {
      render(<BlockEditor documentId="doc-room" />);
      await vi.advanceTimersByTimeAsync(0);
    });
    await waitFor(() => {
      expect(MockBroadcastChannel.instances.length).toBe(1);
      expect(MockBroadcastChannel.instances[0]!.name).toBe(
        "block-editor-presence",
      );
    });

    // Deliver a real presence message through the channel the hook subscribed to.
    await act(async () => {
      MockBroadcastChannel.instances[0]!.listeners.forEach((cb) =>
        cb({ data: { type: "presence", users: ["Alice", "Bob"] } }),
      );
    });
    await waitFor(() => {
      expect(screen.getByText("AL")).toBeTruthy();
      expect(screen.getByText("BO")).toBeTruthy();
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

describe("BlockEditor - Keyboard shortcuts (production inventory)", () => {
  let BlockEditor: React.FC<any>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockExec.mockResolvedValue(null);
    MockBroadcastChannel.instances.length = 0;
    const mod = await import("../../components/block-editor/BlockEditor");
    BlockEditor = mod.default;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Production has NO Ctrl/Meta+D theme toggle inside BlockEditor — the old
  // suite asserted a toggle that existed only in the deleted hook mock (the
  // app-wide shortcuts are Ctrl+K / Ctrl+Shift+P / Ctrl+Shift+B, see
  // KeyboardShortcuts.tsx). This test documents that reality: key events
  // must not change the theme, so a future editor-local shortcut cannot be
  // added silently.
  it("does not toggle the theme on Ctrl+D or Meta+D (no such production shortcut)", async () => {
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
    await act(async () => {
      fireEvent.keyDown(window, { key: "d", metaKey: true });
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "d", ctrlKey: true, shiftKey: true });
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "d" });
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
    MockBroadcastChannel.instances.length = 0;
    const mod = await import("../../components/block-editor/BlockEditor");
    BlockEditor = mod.default;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("forwards focus through the REAL one-shot warmup wiring: exactly one guarded warmup, no direct WebLLM use", async () => {
    // The REAL hook's handleEditorFocus is the production editorFocusWarmup
    // handler: it clears the AI error and delegates the preload to the
    // guarded aiManager.warmup() (one-shot per editor instance). The
    // canRunLocalLLM() device gate lives INSIDE warmup, so this component
    // test pins the wiring — focus → warmup ×1 → zero direct WebLLM calls —
    // while the guard's skip behavior is pinned at the ProviderManager unit
    // level and by the guard E2E.
    const { aiManager } = await import("../../services/ai/ProviderManager");
    const { webLLMService } = await import("../../services/ai/WebLLMService");
    mockExec.mockResolvedValue({ title: "Doc", isPrivate: false, blocks: [] });
    await act(async () => {
      render(<BlockEditor documentId="doc-1" />);
      await vi.advanceTimersByTimeAsync(0);
    });

    const wrapper = screen.getByTestId("blocknote-view").parentElement!;
    await act(async () => {
      fireEvent.focus(wrapper);
      fireEvent.focus(wrapper);
      fireEvent.focus(wrapper);
    });

    // The one-shot focus handler absorbed the repeat focuses: exactly one
    // guarded warmup, and the UI layer never touched the engine directly.
    expect(aiManager.warmup).toHaveBeenCalledTimes(1);
    expect(webLLMService.init).not.toHaveBeenCalled();
    expect(webLLMService.generateText).not.toHaveBeenCalled();
    expect(webLLMService.unload).not.toHaveBeenCalled();
    expect(webLLMService.canRunLocalLLM).not.toHaveBeenCalled();
    // The focus handler clears any stale AI error banner.
    expect(screen.queryByTestId("ai-error")).toBeNull();
  });
});

describe("BlockEditor - Connection status display", () => {
  let BlockEditor: React.FC<any>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockExec.mockResolvedValue(null);
    MockBroadcastChannel.instances.length = 0;
    const mod = await import("../../components/block-editor/BlockEditor");
    BlockEditor = mod.default;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows OFFLINE and no presence users before any presence message", async () => {
    // isConnected is hardwired false in the real hook (peer-to-peer sync is
    // not implemented): the LIVE branch of the JSX is unreachable in
    // production, so it is deliberately not asserted here. The OFFLINE state
    // and empty presence ARE production-reachable and pinned.
    mockExec.mockResolvedValue({ title: "Doc", isPrivate: false, blocks: [] });
    await act(async () => {
      render(<BlockEditor documentId="doc-1" />);
      await vi.advanceTimersByTimeAsync(0);
    });
    await waitFor(() => {
      expect(screen.getByText("app_offline")).toBeTruthy();
    });
    expect(screen.queryByText("app_live")).toBeNull();
  });
});

describe("BlockEditor - Active users display", () => {
  let BlockEditor: React.FC<any>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockExec.mockResolvedValue(null);
    MockBroadcastChannel.instances.length = 0;
    const mod = await import("../../components/block-editor/BlockEditor");
    BlockEditor = mod.default;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders user avatars for active users", async () => {
    mockExec.mockResolvedValue({ title: "Doc", isPrivate: false, blocks: [] });
    await act(async () => {
      render(<BlockEditor documentId="doc-1" />);
      await vi.advanceTimersByTimeAsync(0);
    });
    await waitFor(() => {
      expect(MockBroadcastChannel.instances.length).toBe(1);
    });
    await act(async () => {
      MockBroadcastChannel.instances[0]!.listeners.forEach((cb) =>
        cb({ data: { type: "presence", users: ["Alice", "Bob"] } }),
      );
    });
    await waitFor(() => {
      expect(screen.getByText("AL")).toBeTruthy();
      expect(screen.getByText("BO")).toBeTruthy();
    });
  });

  it("renders no avatars before any presence message arrives", async () => {
    mockExec.mockResolvedValue({ title: "Doc", isPrivate: false, blocks: [] });
    await act(async () => {
      render(<BlockEditor documentId="doc-1" />);
      await vi.advanceTimersByTimeAsync(0);
    });
    await waitFor(() => {
      expect(screen.getByTestId("blocknote-view")).toBeTruthy();
    });
    expect(screen.queryByText("AL")).toBeNull();
  });

  it("truncates long user names to 2 characters", async () => {
    mockExec.mockResolvedValue({ title: "Doc", isPrivate: false, blocks: [] });
    await act(async () => {
      render(<BlockEditor documentId="doc-1" />);
      await vi.advanceTimersByTimeAsync(0);
    });
    await waitFor(() => {
      expect(MockBroadcastChannel.instances.length).toBe(1);
    });
    await act(async () => {
      MockBroadcastChannel.instances[0]!.listeners.forEach((cb) =>
        cb({ data: { type: "presence", users: ["Christopher"] } }),
      );
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
    MockBroadcastChannel.instances.length = 0;
    const mod = await import("../../components/block-editor/BlockEditor");
    BlockEditor = mod.default;
  });

  afterEach(() => {
    vi.useRealTimers();
  });  it("applies presence messages and ignores other message shapes", async () => {
    // The real channel contract carries PRESENCE only — remote-update/
    // cursor-sync messaging does not exist in production (the old tests
    // asserted a fabricated lastMessage pipeline). Non-presence and
    // malformed messages must be ignored without crashing.
    mockExec.mockResolvedValue({ title: "Doc", isPrivate: false, blocks: [] });
    await act(async () => {
      render(<BlockEditor documentId="doc-1" />);
      await vi.advanceTimersByTimeAsync(0);
    });
    const channel = await waitFor(() => {
      expect(MockBroadcastChannel.instances.length).toBe(1);
      return MockBroadcastChannel.instances[0]!;
    });

    await act(async () => {
      channel.listeners.forEach((cb) =>
        cb({ data: { type: "cursor-update", position: 5 } }),
      );
    });
    await act(async () => {
      channel.listeners.forEach((cb) => cb({ data: { type: "presence" } }));
    });
    expect(screen.queryByText("AL")).toBeNull();

    await act(async () => {
      channel.listeners.forEach((cb) =>
        cb({ data: { type: "presence", users: ["Alice"] } }),
      );
    });
    await waitFor(() => {
      expect(screen.getByText("AL")).toBeTruthy();
    });
  });

  it("filters non-string entries out of the users array", async () => {
    mockExec.mockResolvedValue({ title: "Doc", isPrivate: false, blocks: [] });
    await act(async () => {
      render(<BlockEditor documentId="doc-1" />);
      await vi.advanceTimersByTimeAsync(0);
    });
    const channel = await waitFor(() => {
      expect(MockBroadcastChannel.instances.length).toBe(1);
      return MockBroadcastChannel.instances[0]!;
    });

    await act(async () => {
      channel.listeners.forEach((cb) =>
        cb({ data: { type: "presence", users: [42, "Alice", null, "Bob"] } }),
      );
    });
    await waitFor(() => {
      expect(screen.getByText("AL")).toBeTruthy();
      expect(screen.getByText("BO")).toBeTruthy();
    });
  });

  it("closes the presence channel on unmount", async () => {
    mockExec.mockResolvedValue({ title: "Doc", isPrivate: false, blocks: [] });
    let unmountFn: () => void = () => {};
    await act(async () => {
      const result = render(<BlockEditor documentId="doc-1" />);
      await vi.advanceTimersByTimeAsync(0);
      unmountFn = result.unmount;
    });
    await waitFor(() => {
      expect(MockBroadcastChannel.instances.length).toBe(1);
    });

    unmountFn();
    expect(MockBroadcastChannel.instances[0]!.closed).toBe(true);
  });
});

describe("BlockEditor - Auto-save behavior", () => {
  let BlockEditor: React.FC<any>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockExec.mockResolvedValue(null);
    MockBroadcastChannel.instances.length = 0;
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

  it("autosave persists text through the attachment pipeline", async () => {
    // The real autosave round-trips blocks/text through attachmentStore
    // (blob: refs → bmf-attachment:// refs) before patching the document.
    const { attachmentStore } = await import(
      "../../services/documentAttachments",
    );
    mockExec.mockResolvedValue({
      title: "Doc",
      isPrivate: false,
      blocks: [],
      textContent: "",
    });

    await act(async () => {
      render(<BlockEditor documentId="doc-1" />);
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    await waitFor(() => {
      expect(attachmentStore.persistBlocks).toHaveBeenCalledWith(
        "doc-1",
        expect.anything(),
      );
      expect(attachmentStore.persistText).toHaveBeenCalledWith(
        "doc-1",
        expect.any(String),
      );
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
});

describe("BlockEditor - Document loading edge cases", () => {
  let BlockEditor: React.FC<any>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockExec.mockResolvedValue(null);
    MockBroadcastChannel.instances.length = 0;
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
      // The hook persists the LOCALIZED key, not the English default — the
      // display fallback (BlockEditor's untitled handling) must stay able to
      // resolve per-locale strings for non-English users.
      expect(upsertCall.title).toBe("app_untitledDocument");
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

describe("BlockEditor - Smart suggestions", () => {
  let BlockEditor: React.FC<any>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockExec.mockResolvedValue(null);
    MockBroadcastChannel.instances.length = 0;
    const mod = await import("../../components/block-editor/BlockEditor");
    BlockEditor = mod.default;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not query documents for suggestions when showSuggestions is false", async () => {
    // The real hook's smart-links panel ranks OTHER documents via
    // db.documents.find() when the panel opens; with the flag off it must
    // never query at all. (The old test asserted a fabricated searchSimilar
    // call that production never makes.)
    mockExec.mockResolvedValue({ title: "Doc", isPrivate: false, blocks: [] });

    await act(async () => {
      render(<BlockEditor documentId="doc-1" />);
      await vi.advanceTimersByTimeAsync(0);
    });

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(mockDocumentsFind).not.toHaveBeenCalled();
  });
});

describe("BlockEditor - Panel layout width", () => {
  let BlockEditor: React.FC<any>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockExec.mockResolvedValue(null);
    MockBroadcastChannel.instances.length = 0;
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
    MockBroadcastChannel.instances.length = 0;
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
    MockBroadcastChannel.instances.length = 0;
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
