import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import React from "react";

const mockT = vi.fn((key: string) => key);
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: mockT, i18n: { language: "en" } }),
  // The real hook's import chain (editorFocusWarmup → ProviderManager →
  // i18n-backed services) reaches src/i18n.ts, which calls
  // i18n.use(initReactI18next) at module scope. i18next.use() validates the
  // module shape, so the stub must carry the 3rdParty type marker.
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const mockInsertOrUpdate = vi.fn();
vi.mock("@blocknote/core", () => ({
  insertOrUpdateBlockForSlashMenu: (...args: unknown[]) =>
    mockInsertOrUpdate(...args),
}));

// The real hook now loads/persists the document through initDB.
const dbMocks = vi.hoisted(() => ({
  findOne: vi.fn(),
  find: vi.fn(),
  upsert: vi.fn().mockResolvedValue(undefined),
  versionUpsert: vi.fn().mockResolvedValue(undefined),
  incrementalPatch: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../db/database", () => ({
  initDB: vi.fn().mockResolvedValue({
    documents: { findOne: dbMocks.findOne, find: dbMocks.find, upsert: dbMocks.upsert },
    versions: { upsert: dbMocks.versionUpsert },
  }),
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

import {
  useBlockEditorLogic,
  _internal,
} from "../../components/block-editor/useBlockEditorLogic";

// Shared BroadcastChannel mock with a static registry of instances,
// reused by presence tests (avoids duplicating the class per test).
class MockBroadcastChannel {
  static instances: MockBroadcastChannel[] = [];
  listeners = new Set<(e: { data: unknown }) => void>();
  constructor(public name: string) {
    MockBroadcastChannel.instances.push(this);
  }
  addEventListener(_t: string, cb: (e: { data: unknown }) => void) {
    this.listeners.add(cb);
  }
  removeEventListener(_t: string, cb: (e: { data: unknown }) => void) {
    this.listeners.delete(cb);
  }
  close() {}
  emit(data: unknown) {
    this.listeners.forEach((l) => l({ data }));
  }
}

function makeState(overrides: Record<string, unknown> = {}) {
  const state: Record<string, unknown> = {
    editorText: "",
    setEditorText: vi.fn(),
    setError: vi.fn(),
    initialContent: "empty",
    setInitialContent: vi.fn(),
    docTitle: "",
    setDocTitle: vi.fn(),
    saveStatus: "saved",
    setSaveStatus: vi.fn(),
    theme: "light",
    setTheme: vi.fn(),
    showChat: false,
    setShowChat: vi.fn(),
    showHistory: false,
    setShowHistory: vi.fn(),
    showPreview: false,
    setShowPreview: vi.fn(),
    showSuggestions: false,
    setShowSuggestions: vi.fn(),
    showCopilot: false,
    setShowCopilot: vi.fn(),
    showExpertAgents: false,
    setShowExpertAgents: vi.fn(),
    suggestions: [],
    setSuggestions: vi.fn(),
    lastEmbeddingSavedAt: null,
    setLastEmbeddingSavedAt: vi.fn(),
    lastVersionSavedAt: null,
    setLastVersionSavedAt: vi.fn(),
    isZenMode: false,
    setIsZenMode: vi.fn(),
    isPrivate: false,
    setIsPrivate: vi.fn(),
    error: null,
    editorRef: { current: null },
    isRemoteUpdateRef: { current: false },
    isWarmedUpRef: { current: false },
    handleSuggestionClickRef: { current: null },
    ...overrides,
  };
  return state as unknown as Parameters<typeof useBlockEditorLogic>[0]["state"];
}

describe("useBlockEditorLogic — hook body", () => {
  let state: ReturnType<typeof makeState>;

  beforeEach(() => {
    vi.clearAllMocks();
    MockBroadcastChannel.instances.length = 0;
    state = makeState();
    // Default: document not found → the hook creates it with defaults.
    dbMocks.findOne.mockReturnValue({ exec: vi.fn().mockResolvedValue(null) });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete (window as { speechSynthesis?: unknown }).speechSynthesis;
  });

  it("exposes the initial flags and the language", () => {
    const { result } = renderHook(() =>
      useBlockEditorLogic({ documentId: "d1", state }),
    );
    expect(result.current.lang).toBe("en");
    expect(result.current.isConnected).toBe(false);
    expect(result.current.activeUsers).toEqual([]);
    expect(result.current.isTagging).toBe(false);
    expect(result.current.aiError).toBeNull();
  });

  it("autoTag extracts tags from the text and resets aiError", async () => {
    state.editorText =
      "JavaScript is great. JavaScript runs everywhere. TypeScript adds types.";
    const { result } = renderHook(() =>
      useBlockEditorLogic({ documentId: "d1", state }),
    );
    await act(async () => {
      const tags = await result.current.autoTag();
      expect(tags[0]).toBe("javascript");
    });
    expect(result.current.isTagging).toBe(false);
  });

  it("autoTag with empty text calls setError and returns []", async () => {
    state.editorText = "   ";
    const { result } = renderHook(() =>
      useBlockEditorLogic({ documentId: "d1", state }),
    );
    await act(async () => {
      const tags = await result.current.autoTag();
      expect(tags).toEqual([]);
    });
    expect(state.setError).toHaveBeenCalled();
    expect(result.current.aiError).toBeTruthy();
  });

  it("generateFlashcards detects X is Y definitions", async () => {
    state.editorText =
      "Photosynthesis is the process by which plants convert light into energy.";
    const { result } = renderHook(() =>
      useBlockEditorLogic({ documentId: "d1", state }),
    );
    await act(async () => {
      const cards = await result.current.generateFlashcards();
      expect(cards.length).toBeGreaterThan(0);
      expect(cards[0]!.front).toMatch(/photosynthesis/i);
    });
  });

  it("generateFlashcards with empty text calls setError", async () => {
    state.editorText = "";
    const { result } = renderHook(() =>
      useBlockEditorLogic({ documentId: "d1", state }),
    );
    await act(async () => {
      const cards = await result.current.generateFlashcards();
      expect(cards).toEqual([]);
    });
    expect(state.setError).toHaveBeenCalled();
  });

  it("audioSummary sin speechSynthesis llama setError", async () => {
    state.editorText = "Some text";
    const { result } = renderHook(() =>
      useBlockEditorLogic({ documentId: "d1", state }),
    );
    await act(async () => {
      await result.current.audioSummary();
    });
    expect(state.setError).toHaveBeenCalled();
  });

  it("audioSummary with speechSynthesis speaks the text", async () => {
    const speak = vi.fn();
    class MockUtterance {
      lang = "";
      text: string;
      constructor(text: string) {
        this.text = text;
      }
    }
    vi.stubGlobal("SpeechSynthesisUtterance", MockUtterance);
    Object.defineProperty(window, "speechSynthesis", {
      value: { speak },
      configurable: true,
    });
    state.editorText = "Hello from the editor";
    const { result } = renderHook(() =>
      useBlockEditorLogic({ documentId: "d1", state }),
    );
    await act(async () => {
      await result.current.audioSummary();
    });
    expect(speak).toHaveBeenCalled();
    const u = speak.mock.calls[0]![0] as MockUtterance;
    expect(u.lang).toBe("en");
    expect(u.text).toBe("Hello from the editor");
    expect(result.current.isSpeaking).toBe(false);
  });

  it("audioSummary with empty text calls setError", async () => {
    vi.stubGlobal("SpeechSynthesisUtterance", class {});
    Object.defineProperty(window, "speechSynthesis", {
      value: { speak: vi.fn() },
      configurable: true,
    });
    state.editorText = " ";
    const { result } = renderHook(() =>
      useBlockEditorLogic({ documentId: "d1", state }),
    );
    await act(async () => {
      await result.current.audioSummary();
    });
    expect(state.setError).toHaveBeenCalled();
  });

  it("suggestFolder suggests a folder from the text", async () => {
    state.editorText =
      "This tutorial covers JavaScript and React development with TypeScript APIs.";
    const { result } = renderHook(() =>
      useBlockEditorLogic({ documentId: "d1", state }),
    );
    await act(async () => {
      const folder = await result.current.suggestFolder();
      expect(folder).toBe("tech");
    });
  });

  it("suggestFolder with empty text returns general and calls setError", async () => {
    state.editorText = "";
    const { result } = renderHook(() =>
      useBlockEditorLogic({ documentId: "d1", state }),
    );
    await act(async () => {
      const folder = await result.current.suggestFolder();
      expect(folder).toBe("general");
    });
    expect(state.setError).toHaveBeenCalled();
  });

  it("copilotAction 'tag' delega en autoTag", async () => {
    state.editorText = "JavaScript and JavaScript again.";
    const { result } = renderHook(() =>
      useBlockEditorLogic({ documentId: "d1", state }),
    );
    await act(async () => {
      const out = await result.current.copilotAction("tag");
      expect(Array.isArray(out)).toBe(true);
    });
  });

  it("copilotAction 'flashcards' delega en generateFlashcards", async () => {
    state.editorText =
      "API: Application Programming Interface used for communication.";
    const { result } = renderHook(() =>
      useBlockEditorLogic({ documentId: "d1", state }),
    );
    await act(async () => {
      const out = await result.current.copilotAction("flashcards");
      expect(Array.isArray(out)).toBe(true);
    });
  });

  it("copilotAction 'audio' returns { ok: true }", async () => {
    const speak = vi.fn();
    vi.stubGlobal("SpeechSynthesisUtterance", class {});
    Object.defineProperty(window, "speechSynthesis", {
      value: { speak },
      configurable: true,
    });
    state.editorText = "Text to speak";
    const { result } = renderHook(() =>
      useBlockEditorLogic({ documentId: "d1", state }),
    );
    await act(async () => {
      const out = await result.current.copilotAction("audio");
      expect(out).toEqual({ ok: true });
    });
  });

  it("copilotAction 'folder' delega en suggestFolder", async () => {
    state.editorText = "A recipe with ingredients from the kitchen.";
    const { result } = renderHook(() =>
      useBlockEditorLogic({ documentId: "d1", state }),
    );
    await act(async () => {
      const out = await result.current.copilotAction("folder");
      expect(out).toBe("recipes");
    });
  });

  it("copilotAction 'improve' returns the local-only annotation", async () => {
    state.editorText = "short text";
    const { result } = renderHook(() =>
      useBlockEditorLogic({ documentId: "d1", state }),
    );
    await act(async () => {
      const out = (await result.current.copilotAction("improve")) as {
        action: string;
        documentId: string;
        length: number;
      };
      expect(out.action).toBe("improve");
      expect(out.documentId).toBe("d1");
      expect(out.length).toBe(10);
    });
  });

  it("copilotAction 'expand' and 'shorten' return the local-only annotation", async () => {
    state.editorText = "some content";
    const { result } = renderHook(() =>
      useBlockEditorLogic({ documentId: "d1", state }),
    );
    for (const action of ["expand", "shorten"]) {
      await act(async () => {
        const out = (await result.current.copilotAction(action)) as {
          action: string;
          length: number;
        };
        expect(out.action).toBe(action);
        expect(out.length).toBe(12);
      });
    }
  });

  it("copilotAction 'export' returns params", async () => {
    const { result } = renderHook(() =>
      useBlockEditorLogic({ documentId: "d1", state }),
    );
    await act(async () => {
      const out = await result.current.copilotAction("export", { fmt: "md" });
      expect(out).toEqual({ ok: true, params: { fmt: "md" } });
    });
  });

  it("copilotAction with unknown action returns { ok: false }", async () => {
    const { result } = renderHook(() =>
      useBlockEditorLogic({ documentId: "d1", state }),
    );
    await act(async () => {
      const out = (await result.current.copilotAction("bogus")) as {
        ok: boolean;
        error: string;
      };
      expect(out.ok).toBe(false);
      expect(out.error).toContain("bogus");
    });
    expect(state.setError).toHaveBeenCalled();
  });

  it("handleVoiceTranscript concatenates with the current text", async () => {
    state.editorText = "primera";
    const { result } = renderHook(() =>
      useBlockEditorLogic({ documentId: "d1", state }),
    );
    await act(async () => {
      await result.current.handleVoiceTranscript("segunda");
    });
    expect(state.setEditorText).toHaveBeenCalledWith("primera segunda");
  });

  it("handlePdfText replaces the editor text", async () => {
    const { result } = renderHook(() =>
      useBlockEditorLogic({ documentId: "d1", state }),
    );
    await act(async () => {
      await result.current.handlePdfText("pdf content");
    });
    expect(state.setEditorText).toHaveBeenCalledWith("pdf content");
  });

  it("handleEditorFocus clears aiError", async () => {
    // Blank text → autoTag throws the empty-content error
    state.editorText = "   ";
    const { result } = renderHook(() =>
      useBlockEditorLogic({ documentId: "d1", state }),
    );
    await act(async () => {
      await result.current.autoTag();
    });
    expect(result.current.aiError).toBeTruthy();
    act(() => {
      result.current.handleEditorFocus();
    });
    expect(result.current.aiError).toBeNull();
  });

  it("filterSlashMenuItems filters by title, description and keywords", async () => {
    const { result } = renderHook(() =>
      useBlockEditorLogic({ documentId: "d1", state }),
    );
    const items = result.current.slashMenuItems;
    await act(async () => {
      const byTitle = await result.current.filterSlashMenuItems(
        "heading",
        items as unknown[],
      );
      expect(byTitle.map((i) => i.id)).toEqual([
        "heading-1",
        "heading-2",
        "heading-3",
      ]);
    });
    await act(async () => {
      // keyword "h1" lives only in heading-1 ("titulo" also matches [i18n-allow]
      // heading-2 via its keyword "subtitulo", which contains it)
      const byKeyword = await result.current.filterSlashMenuItems(
        "h1",
        items as unknown[],
      );
      expect(byKeyword.map((i) => i.id)).toEqual(["heading-1"]);
    });
  });

  it("filterSlashMenuItems with empty query returns everything", async () => {
    const { result } = renderHook(() =>
      useBlockEditorLogic({ documentId: "d1", state }),
    );
    const items = result.current.slashMenuItems;
    await act(async () => {
      const all = await result.current.filterSlashMenuItems(
        "",
        items as unknown[],
      );
      expect(all.length).toBe(items.length);
    });
  });

  it("slashMenuItems heading-1 llama insertOrUpdateBlockForSlashMenu", () => {
    const { result } = renderHook(() =>
      useBlockEditorLogic({ documentId: "d1", state }),
    );
    const item = result.current.slashMenuItems.find(
      (i) => i.id === "heading-1",
    )!;
    act(() => {
      item.onItemClick({} as never);
    });
    expect(mockInsertOrUpdate).toHaveBeenCalled();
    const [editor, update] = mockInsertOrUpdate.mock.calls[0] as unknown[];
    expect(editor).toEqual({});
    expect(update).toMatchObject({ type: "heading", props: { level: 1 } });
  });

  it("slashMenuItems columns-2 updates the block to columnLayout", () => {
    const { result } = renderHook(() =>
      useBlockEditorLogic({ documentId: "d1", state }),
    );
    const updateBlock = vi.fn();
    const editor = {
      getTextCursorPosition: () => ({ block: { id: "b1" } }),
      updateBlock,
    };
    const item = result.current.slashMenuItems.find(
      (i) => i.id === "columns-2",
    )!;
    act(() => {
      item.onItemClick(editor as never);
    });
    expect(updateBlock).toHaveBeenCalledWith(
      { id: "b1" },
      expect.objectContaining({
        type: "columnLayout",
        props: { count: 2 },
      }),
    );
    const [, update] = updateBlock.mock.calls[0] as unknown[];
    expect((update as { children: unknown[] }).children).toHaveLength(2);
  });

  it("slashMenuItems columns-3 creates 3 columns", () => {
    const { result } = renderHook(() =>
      useBlockEditorLogic({ documentId: "d1", state }),
    );
    const updateBlock = vi.fn();
    const editor = {
      getTextCursorPosition: () => ({ block: { id: "b1" } }),
      updateBlock,
    };
    const item = result.current.slashMenuItems.find(
      (i) => i.id === "columns-3",
    )!;
    act(() => {
      item.onItemClick(editor as never);
    });
    const [, update] = updateBlock.mock.calls[0] as unknown[];
    expect((update as { children: unknown[] }).children).toHaveLength(3);
  });

  it("getSuggestionIcon y getSuggestionColor con fallback default", () => {
    const { result } = renderHook(() =>
      useBlockEditorLogic({ documentId: "d1", state }),
    );
    expect(result.current.getSuggestionColor("improve")).toBe("cyan");
    expect(result.current.getSuggestionColor("unknown-key")).toBe("cyan");
    expect(result.current.getSuggestionIcon("unknown-key")).toBeTruthy();
  });

  it("receives presence via BroadcastChannel and filters non-strings", () => {
    vi.stubGlobal("BroadcastChannel", MockBroadcastChannel);
    const { result } = renderHook(() =>
      useBlockEditorLogic({ documentId: "d1", state }),
    );
    act(() => {
      MockBroadcastChannel.instances.at(-1)!.emit({
        type: "presence",
        users: ["Alice", "Bob", 42],
      });
    });
    expect(result.current.activeUsers).toEqual(["Alice", "Bob"]);
  });

  it("ignores presence messages without a users array", () => {
    vi.stubGlobal("BroadcastChannel", MockBroadcastChannel);
    const { result } = renderHook(() =>
      useBlockEditorLogic({ documentId: "d1", state }),
    );
    // Presence message without a users array: the handler ignores it
    act(() => {
      MockBroadcastChannel.instances.at(-1)!.emit({ type: "presence" });
    });
    expect(result.current.activeUsers).toEqual([]);
  });

  it("handleVoiceTranscript with empty current text uses the direct text", async () => {
    state.editorText = "";
    const { result } = renderHook(() =>
      useBlockEditorLogic({ documentId: "d1", state }),
    );
    await act(async () => {
      await result.current.handleVoiceTranscript("solo");
    });
    expect(state.setEditorText).toHaveBeenCalledWith("solo");
  });

  it("audioSummary trunca el texto a 5000 caracteres", async () => {
    const speak = vi.fn();
    class MockUtterance {
      lang = "";
      text: string;
      constructor(text: string) {
        this.text = text;
      }
    }
    vi.stubGlobal("SpeechSynthesisUtterance", MockUtterance);
    Object.defineProperty(window, "speechSynthesis", {
      value: { speak },
      configurable: true,
    });
    state.editorText = "x".repeat(6000);
    const { result } = renderHook(() =>
      useBlockEditorLogic({ documentId: "d1", state }),
    );
    await act(async () => {
      await result.current.audioSummary();
    });
    const u = speak.mock.calls[0]![0] as MockUtterance;
    expect(u.text).toHaveLength(5000);
  });

  it("audioSummary handles an error that is not an Error instance", async () => {
    const speak = vi.fn(() => {
      throw "speak exploded";
    });
    vi.stubGlobal("SpeechSynthesisUtterance", class {});
    Object.defineProperty(window, "speechSynthesis", {
      value: { speak },
      configurable: true,
    });
    state.editorText = "Some text";
    const { result } = renderHook(() =>
      useBlockEditorLogic({ documentId: "d1", state }),
    );
    await act(async () => {
      await result.current.audioSummary();
    });
    // The catch uses String(e) when the error is not an Error
    expect(state.setError).toHaveBeenCalledWith("speak exploded");
    expect(result.current.aiError).toBe("speak exploded");
  });

  it("BroadcastChannel undefined: does not create a channel or throw", () => {
    delete (globalThis as { BroadcastChannel?: unknown }).BroadcastChannel;
    expect(() =>
      renderHook(() => useBlockEditorLogic({ documentId: "d1", state })),
    ).not.toThrow();
  });

  it("opens suggestions: scores other documents by keyword overlap and excludes the current one", async () => {
    state.showSuggestions = true;
    state.editorText =
      "TypeScript APIs for React development and JavaScript tooling.";
    dbMocks.find.mockReturnValue({
      exec: vi.fn().mockResolvedValue([
        { id: "d1", title: "Current", textContent: "" },
        {
          id: "d2",
          title: "React Guide",
          textContent: "TypeScript and React patterns for APIs",
        },
        {
          id: "d3",
          title: "Cooking",
          textContent: "recipes for pasta and sauce",
        },
        {
          id: "d4",
          title: "JS Tools",
          textContent: "JavaScript tooling for developers",
        },
      ]),
    });

    renderHook(() => useBlockEditorLogic({ documentId: "d1", state }));
    await act(async () => {
      await vi.waitFor(() =>
        expect(state.setSuggestions).toHaveBeenCalled(),
      );
    });

    const setSuggestionsMock = state.setSuggestions as unknown as ReturnType<
      typeof vi.fn
    >;
    const suggestions = setSuggestionsMock.mock.calls.at(-1)![0] as string[];
    expect(suggestions).toContain("React Guide");
    expect(suggestions).toContain("JS Tools");
    expect(suggestions).not.toContain("Cooking");
    expect(suggestions).not.toContain("Current");
  });

  it("opens suggestions without keywords: setSuggestions([]) without querying DB", async () => {
    state.showSuggestions = true;
    state.editorText = "   ";

    renderHook(() => useBlockEditorLogic({ documentId: "d1", state }));
    await act(async () => {
      await vi.waitFor(() =>
        expect(state.setSuggestions).toHaveBeenCalledWith([]),
      );
    });
    expect(dbMocks.find).not.toHaveBeenCalled();
  });
});

describe("useBlockEditorLogic — helpers internos", () => {
  let state: ReturnType<typeof makeState>;

  beforeEach(() => {
    vi.clearAllMocks();
    MockBroadcastChannel.instances.length = 0;
    state = makeState();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("tokenize filters stop words and short words", () => {
    const tokens = _internal.tokenize("the cat and JavaScript are great tools");
    // the/and/are are stop words; cat has 3 letters and passes
    expect(tokens).toContain("javascript");
    expect(tokens).toContain("great");
    expect(tokens).toContain("tools");
    expect(tokens).toContain("cat");
    expect(tokens).not.toContain("the");
    expect(tokens).not.toContain("and");
    expect(tokens).not.toContain("are");
  });

  it("tokenize cleans non-alphanumeric characters and keeps accents", () => {
    const tokens = _internal.tokenize("¡Hola! máquina-nube, café.");
    expect(tokens).toContain("hola");
    // The hyphen is kept (character allowed by the regex), so
    // "máquina-nube" stays as a single token [i18n-allow: Spanish keyword data]
    expect(tokens).toContain("máquina-nube");
    expect(tokens).toContain("café");
  });

  it("extractTagsFromText respects the max limit and sorts by frequency", () => {
    const tags = _internal.extractTagsFromText(
      "alpha beta gamma delta epsilon zeta eta theta iota kappa",
      3,
    );
    expect(tags).toHaveLength(3);
  });

  it("splitSentences filters very short or very long sentences", () => {
    const long = Array.from({ length: 30 }, () => "really").join(" ");
    const sentences = _internal.splitSentences(
      `Hi. This is a normal sentence that is long enough. ${long} extra padding words to guarantee the cap is exceeded for sure.`,
    );
    // Only the valid-length phrase survives
    expect(sentences).toHaveLength(1);
    expect(sentences[0]).toContain("normal sentence");
  });

  it("extractFlashcards uses the colon heuristic (X: Y)", () => {
    const cards = _internal.extractFlashcards(
      "Photosynthesis: the process by which plants convert light into energy.",
    );
    expect(cards.length).toBeGreaterThan(0);
    expect(cards[0]!.front).toContain("Photosynthesis");
    expect(cards[0]!.back).toContain("process by which");
  });

  it("extractFlashcards uses the cloze heuristic (half/half)", () => {
    const cards = _internal.extractFlashcards(
      "The industrial revolution transformed every aspect of modern society.",
    );
    expect(cards.length).toBeGreaterThan(0);
    expect(cards[0]!.front).toContain("…");
    expect(cards[0]!.back).toBe(
      "The industrial revolution transformed every aspect of modern society.",
    );
  });

  it("extractFlashcards respects the max limit", () => {
    const text = Array.from(
      { length: 12 },
      (_, i) => `Concept number ${i} is a definition here.`,
    ).join(" ");
    const cards = _internal.extractFlashcards(text, 4);
    expect(cards).toHaveLength(4);
  });

  it("suggestFolder detects work folder by keywords", () => {
    expect(
      _internal.suggestFolder(
        "Sprint meeting with the client project report and deadline",
      ),
    ).toBe("work");
  });

  it("suggestFolder returns general when there are no matches", () => {
    expect(_internal.suggestFolder("xyzzy plugh frobnicate")).toBe("general");
  });

  it("suggestFolder detects learning folder by keywords", () => {
    expect(
      _internal.suggestFolder("A course tutorial to learn from a guide book"),
    ).toBe("learning");
  });

  it("suggestFolder detects finance folder by keywords", () => {
    expect(
      _internal.suggestFolder(
        "How to invest money in the stock market with a bank budget",
      ),
    ).toBe("finance");
  });

  it("suggestFolder detects health folder by keywords", () => {
    expect(
      _internal.suggestFolder(
        "Medical workout routine for fitness with a healthy diet",
      ),
    ).toBe("health");
  });

  it("suggestFolder detects travel folder by keywords", () => {
    expect(
      _internal.suggestFolder(
        "Plan a trip vacation with flights to the best destination",
      ),
    ).toBe("travel");
  });

  it("suggestFolder detects news folder by keywords", () => {
    expect(
      _internal.suggestFolder("Breaking news article about today's update"),
    ).toBe("news");
  });
});
