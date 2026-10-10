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

vi.mock("@blocknote/core", () => ({
  insertOrUpdateBlockForSlashMenu: vi.fn(),
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

// The real hook persists through initDB — mock it with controllable docs.
const dbMocks = vi.hoisted(() => ({
  findOne: vi.fn(),
  upsert: vi.fn().mockResolvedValue(undefined),
  versionUpsert: vi.fn().mockResolvedValue(undefined),
  incrementalPatch: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../db/database", () => ({
  initDB: vi.fn().mockResolvedValue({
    documents: { findOne: dbMocks.findOne, upsert: dbMocks.upsert },
    versions: { upsert: dbMocks.versionUpsert },
  }),
}));

import type { PartialBlock } from "@blocknote/core";
import {
  useBlockEditorLogic,
} from "../../components/block-editor/useBlockEditorLogic";

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

describe("useBlockEditorLogic — persistence (load + autosave)", () => {
  let state: ReturnType<typeof makeState>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    state = makeState();
    dbMocks.findOne.mockReturnValue({ exec: vi.fn().mockResolvedValue(null) });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads an existing document: title, text, blocks and privacy", async () => {
    const blocks: PartialBlock[] = [{ type: "heading", content: "Title" }];
    dbMocks.findOne.mockReturnValue({
      exec: vi.fn().mockResolvedValue({
        title: "My Doc",
        textContent: "Hello world",
        blocks,
        isPrivate: true,
        lastVersionSavedAt: 123,
        incrementalPatch: dbMocks.incrementalPatch,
      }),
    });

    renderHook(() =>
      useBlockEditorLogic({ documentId: "doc-1", state }),
    );
    await act(async () => {
      await Promise.resolve();
    });

    expect(state.setInitialContent).toHaveBeenCalledWith("loading");
    expect(state.setDocTitle).toHaveBeenCalledWith("My Doc");
    expect(state.setEditorText).toHaveBeenCalledWith("Hello world");
    expect(state.setIsPrivate).toHaveBeenCalledWith(true);
    expect(state.setLastVersionSavedAt).toHaveBeenCalledWith(123);
    expect(state.setInitialContent).toHaveBeenCalledWith(blocks);
    expect(dbMocks.upsert).not.toHaveBeenCalled();
  });

  it("missing document: creates defaults and marks the editor empty", async () => {
    dbMocks.findOne.mockReturnValue({ exec: vi.fn().mockResolvedValue(null) });

    renderHook(() =>
      useBlockEditorLogic({ documentId: "doc-new", state }),
    );
    await act(async () => {
      await Promise.resolve();
    });

    expect(dbMocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "doc-new",
        folderId: "root",
        title: "app_untitledDocument",
        blocks: [],
        processed: false,
        isDeleted: false,
        isPrivate: false,
      }),
    );
    expect(state.setInitialContent).toHaveBeenCalledWith("empty");
  });

  it("autosave after 2s of inactivity: persists title, blocks and text, and creates a version", async () => {
    const blocks: PartialBlock[] = [{ type: "paragraph", content: "hola" }];
    dbMocks.findOne.mockReturnValue({
      exec: vi.fn().mockResolvedValue({
        title: "Doc",
        textContent: "",
        blocks: [],
        isPrivate: false,
        lastVersionSavedAt: null,
        incrementalPatch: dbMocks.incrementalPatch,
      }),
    });
    state = makeState({
      docTitle: "Edited title",
      editorText: "Edited content",
      isPrivate: false,
      lastVersionSavedAt: null,
    });

    renderHook(() =>
      useBlockEditorLogic({
        documentId: "doc-1",
        state,
        getBlocks: () => blocks,
      }),
    );
    // Flush the async load effect.
    await act(async () => {
      await Promise.resolve();
    });
    // 2s debounce elapses → autosave runs.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(dbMocks.incrementalPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Edited title",
        blocks,
        textContent: "Edited content",
        processed: false,
        isPrivate: false,
        updatedAt: expect.any(String),
      }),
    );
    expect(dbMocks.versionUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: "doc-1",
        blocks,
        createdAt: expect.any(String),
      }),
    );
    expect(state.setLastVersionSavedAt).toHaveBeenCalledWith(expect.any(Number));
    expect(state.setSaveStatus).toHaveBeenCalledWith("saving");
    expect(state.setSaveStatus).toHaveBeenCalledWith("saved");
  });

  it("private documents: the autosave patch preserves isPrivate=true (no privacy-flag loss)", async () => {
    // Component-level tests once asserted this against a fabricated hook;
    // here it is pinned against the REAL autosave: a document loaded as
    // private must be persisted as private — the flag must never be dropped
    // from the incrementalPatch payload.
    dbMocks.findOne.mockReturnValue({
      exec: vi.fn().mockResolvedValue({
        title: "Privado",
        textContent: "",
        blocks: [],
        isPrivate: true,
        lastVersionSavedAt: null,
        incrementalPatch: dbMocks.incrementalPatch,
      }),
    });
    state = makeState({
      docTitle: "Privado",
      editorText: "contenido privado",
      isPrivate: true,
      lastVersionSavedAt: null,
    });

    renderHook(() =>
      useBlockEditorLogic({
        documentId: "doc-priv",
        state,
        getBlocks: () => [],
      }),
    );
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(dbMocks.incrementalPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Privado",
        isPrivate: true,
      }),
    );
  });

  it("does not create a version if the last one is recent (< 5 min)", async () => {
    const recent = Date.now() - 60_000;
    dbMocks.findOne.mockReturnValue({
      exec: vi.fn().mockResolvedValue({
        title: "Doc",
        textContent: "",
        blocks: [],
        isPrivate: false,
        lastVersionSavedAt: recent,
        incrementalPatch: dbMocks.incrementalPatch,
      }),
    });
    state = makeState({
      docTitle: "Doc",
      editorText: "algo",
      lastVersionSavedAt: recent,
    });

    renderHook(() =>
      useBlockEditorLogic({ documentId: "doc-1", state }),
    );
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(dbMocks.incrementalPatch).toHaveBeenCalled();
    expect(dbMocks.versionUpsert).not.toHaveBeenCalled();
  });
});
