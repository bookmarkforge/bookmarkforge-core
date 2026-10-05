import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("react-i18next", async () => {
  const actual = await vi.importActual<typeof import("react-i18next")>(
    "react-i18next",
  );
  return {
    ...actual,
    useTranslation: () => ({
      t: (s: string, opts?: any) => opts?.defaultValue || s,
      i18n: { language: "en" },
    }),
  };
});

// The hook module now imports initDB; these tests only exercise the pure
// helpers, so keep the DB (and its i18n chain) out of the import graph.
vi.mock("../../db/database", () => ({
  initDB: vi.fn().mockResolvedValue({}),
}));

vi.mock("@blocknote/core", () => ({
  insertOrUpdateBlockForSlashMenu: vi.fn(),
}));

vi.mock("../../components/block-editor/lazy-editor-components", () => ({
  chatPanelImport: vi.fn(),
  versionHistoryImport: vi.fn(),
  backlinksImport: vi.fn(),
  expertAgentsPanelImport: vi.fn(),
  aiCopilotPanelImport: vi.fn(),
  suggestionsPanelImport: vi.fn(),
  editorToolbarImport: vi.fn(),
}));

const {
  _internal: {
    tokenize,
    extractTagsFromText,
    splitSentences,
    extractFlashcards,
    suggestFolder,
  },
} = await import("../../components/block-editor/useBlockEditorLogic");

describe("editorLogic — pure helper functions", () => {
  describe("tokenize", () => {
    it("returns lowercase words >= 3 chars, skipping stop words", () => {
      const result = tokenize("The quick brown fox jumps over the lazy dog");
      expect(result).toEqual([
        "quick",
        "brown",
        "fox",
        "jumps",
        "over",
        "lazy",
        "dog",
      ]);
    });

    it("strips punctuation and special characters", () => {
      const result = tokenize("hello, world! how's it going?");
      expect(result).not.toContain(",");
      expect(result).not.toContain("!");
    });

    it("filters out short words (< 3 chars)", () => {
      const result = tokenize("I am a big boy now");
      expect(result).not.toContain("i");
      expect(result).not.toContain("am");
      expect(result).not.toContain("a");
      expect(result).toContain("big");
      expect(result).toContain("boy");
      expect(result).toContain("now");
    });

    it("handles Spanish stop words", () => {
      const result = tokenize("el gato grande y la perra pequeña");
      expect(result).not.toContain("el");
      expect(result).not.toContain("y");
      expect(result).not.toContain("la");
      expect(result).toContain("gato");
      expect(result).toContain("grande");
      expect(result).toContain("perra");
    });

    it("returns empty array for empty string", () => {
      expect(tokenize("")).toEqual([]);
    });

    it("returns empty array when all words are stop words", () => {
      expect(tokenize("the and or but")).toEqual([]);
    });

    it("handles accented characters", () => {
      const result = tokenize("introducción programación desarrollo");
      expect(result).toContain("introducción");
      expect(result).toContain("programación");
      expect(result).toContain("desarrollo");
    });
  });

  describe("extractTagsFromText", () => {
    it("returns top N most frequent words (default 8)", () => {
      const text =
        "javascript typescript react javascript typescript react javascript typescript react";
      const tags = extractTagsFromText(text);
      expect(tags.length).toBeLessThanOrEqual(8);
      expect(tags[0]).toBe("javascript");
    });

    it("respects custom max parameter", () => {
      const text = "alpha beta gamma delta epsilon zeta eta theta iota kappa";
      const tags = extractTagsFromText(text, 3);
      expect(tags.length).toBeLessThanOrEqual(3);
    });

    it("returns empty array for empty text", () => {
      expect(extractTagsFromText("")).toEqual([]);
    });

    it("returns empty array for text with only stop words", () => {
      expect(extractTagsFromText("the and or but is was are")).toEqual([]);
    });

    it("deduplicates tokens by frequency", () => {
      const text = "react react react typescript typescript java";
      const tags = extractTagsFromText(text);
      expect(tags.indexOf("react")).toBeLessThan(tags.indexOf("typescript"));
      expect(tags.indexOf("typescript")).toBeLessThan(tags.indexOf("java"));
    });
  });

  describe("splitSentences", () => {
    it("splits on sentence-ending punctuation", () => {
      const result = splitSentences("Hello world. How are you? I am fine!");
      expect(result).toHaveLength(3);
    });

    it("filters out sentences < 10 chars", () => {
      const result = splitSentences(
        "Short. This is a much longer sentence that should be included.",
      );
      expect(result).toHaveLength(1);
      expect(result[0]).toContain("This is a much longer");
    });

    it("filters out sentences > 200 chars", () => {
      const long = "a".repeat(250);
      const result = splitSentences(long);
      expect(result).toHaveLength(0);
    });

    it("normalizes whitespace", () => {
      const result = splitSentences("Hello   world.   How   are   you?");
      expect(result[0]).toBe("Hello world.");
    });

    it("handles single sentence", () => {
      const result = splitSentences(
        "This is a single sentence that is long enough.",
      );
      expect(result).toHaveLength(1);
    });

    it("returns empty array for empty text", () => {
      expect(splitSentences("")).toEqual([]);
    });
  });

  describe("extractFlashcards", () => {
    it("extracts definition-style cards (X is Y)", () => {
      const text =
        "React is a JavaScript library for building user interfaces. TypeScript is a typed superset of JavaScript.";
      const cards = extractFlashcards(text);
      expect(cards.length).toBeGreaterThan(0);
      expect(cards[0]!.front).toContain("React");
      expect(cards[0]!.back).toContain("JavaScript library");
    });

    it("extracts colon-style cards (X: Y)", () => {
      const text =
        "Definition: A variable is a named storage location in memory for holding data.";
      const cards = extractFlashcards(text);
      expect(cards.length).toBeGreaterThan(0);
      expect(cards[0]!.front).toContain("Definition");
    });

    it("extracts cloze-style cards when no other heuristics match", () => {
      const text =
        "The quick brown fox jumps over the lazy dog and runs away quickly into the forest.";
      const cards = extractFlashcards(text);
      expect(cards.length).toBeGreaterThan(0);
      expect(cards[0]!.front).toContain("…");
    });

    it("respects max parameter", () => {
      const text =
        "React is good. TypeScript is typed. JavaScript is dynamic. HTML is markup. CSS is styling. SQL is queries. Python is versatile. Rust is safe. Go is fast.";
      const cards = extractFlashcards(text, 2);
      expect(cards.length).toBeLessThanOrEqual(2);
    });

    it("handles Spanish definition patterns", () => {
      const text = "React es una biblioteca de JavaScript para interfaces.";
      const cards = extractFlashcards(text);
      expect(cards.length).toBeGreaterThan(0);
    });

    it("returns empty array for empty text", () => {
      expect(extractFlashcards("")).toEqual([]);
    });

    it("returns empty array for text with no sentences", () => {
      expect(extractFlashcards("hi")).toEqual([]);
    });
  });

  describe("suggestFolder", () => {
    it("suggests 'tech' for programming content", () => {
      expect(
        suggestFolder("javascript typescript react code programming"),
      ).toBe("tech");
    });

    it("suggests 'work' for meeting content", () => {
      expect(
        suggestFolder("meeting project client deadline report sprint"),
      ).toBe("work");
    });

    it("suggests 'learning' for educational content", () => {
      expect(
        suggestFolder("tutorial course learn study book guide documentation"),
      ).toBe("learning");
    });

    it("suggests 'recipes' for cooking content", () => {
      expect(
        suggestFolder("recipe cook food meal ingredient kitchen bake"),
      ).toBe("recipes");
    });

    it("suggests 'news' for news content", () => {
      expect(
        suggestFolder("news article today update announcement press"),
      ).toBe("news");
    });

    it("suggests 'personal' for personal content", () => {
      expect(
        suggestFolder("family friend home life diary journal thoughts"),
      ).toBe("personal");
    });

    it("suggests 'shopping' for shopping content", () => {
      expect(suggestFolder("buy shop price review product amazon store")).toBe(
        "shopping",
      );
    });

    it("suggests 'health' for health content", () => {
      expect(
        suggestFolder("health fitness workout medical doctor exercise diet"),
      ).toBe("health");
    });

    it("suggests 'finance' for finance content", () => {
      expect(suggestFolder("money invest stock crypto bank budget tax")).toBe(
        "finance",
      );
    });

    it("suggests 'travel' for travel content", () => {
      expect(
        suggestFolder("travel trip flight hotel vacation tour destination"),
      ).toBe("travel");
    });

    it("suggests 'general' when no keywords match", () => {
      expect(suggestFolder("random unrelated content here")).toBe("general");
    });

    it("picks the folder with most keyword matches", () => {
      expect(
        suggestFolder(
          "javascript react typescript code programming developer api github",
        ),
      ).toBe("tech");
    });
  });
});

describe("editorLogic — hook state management", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("copilotAction dispatch", () => {
    it("dispatches 'tag' to autoTag", async () => {
      const { useBlockEditorLogic } =
        await import("../../components/block-editor/useBlockEditorLogic");
      const state = {
        documentId: "doc-1",
        state: {
          editorText: "test content",
          setError: vi.fn(),
        },
      };
      const { result } = await import("@testing-library/react").then((m) =>
        m.renderHook(() => useBlockEditorLogic(state as any)),
      );
      const copilotResult = await result.current.copilotAction("tag");
      expect(Array.isArray(copilotResult)).toBe(true);
    });

    it("dispatches 'flashcards' to generateFlashcards", async () => {
      const { useBlockEditorLogic } =
        await import("../../components/block-editor/useBlockEditorLogic");
      const state = {
        documentId: "doc-1",
        state: {
          editorText: "React is a library for UIs.",
          setError: vi.fn(),
        },
      };
      const { result } = await import("@testing-library/react").then((m) =>
        m.renderHook(() => useBlockEditorLogic(state as any)),
      );
      const copilotResult = await result.current.copilotAction("flashcards");
      expect(Array.isArray(copilotResult)).toBe(true);
    });

    it("dispatches 'audio' and returns ok", async () => {
      const { useBlockEditorLogic } =
        await import("../../components/block-editor/useBlockEditorLogic");
      const state = {
        documentId: "doc-1",
        state: {
          editorText: "Hello world",
          setError: vi.fn(),
        },
      };
      const { result } = await import("@testing-library/react").then((m) =>
        m.renderHook(() => useBlockEditorLogic(state as any)),
      );
      const copilotResult = await result.current.copilotAction("audio");
      expect(copilotResult).toEqual({ ok: true });
    });

    it("dispatches 'folder' to suggestFolder", async () => {
      const { useBlockEditorLogic } =
        await import("../../components/block-editor/useBlockEditorLogic");
      const state = {
        documentId: "doc-1",
        state: {
          editorText: "javascript typescript react code",
          setError: vi.fn(),
        },
      };
      const { result } = await import("@testing-library/react").then((m) =>
        m.renderHook(() => useBlockEditorLogic(state as any)),
      );
      const copilotResult = await result.current.copilotAction("folder");
      expect(copilotResult).toBe("tech");
    });

    it("dispatches 'improve' and returns local-only result", async () => {
      const { useBlockEditorLogic } =
        await import("../../components/block-editor/useBlockEditorLogic");
      const state = {
        documentId: "doc-1",
        state: {
          editorText: "some text",
          setError: vi.fn(),
        },
      };
      const { result } = await import("@testing-library/react").then((m) =>
        m.renderHook(() => useBlockEditorLogic(state as any)),
      );
      const copilotResult = await result.current.copilotAction("improve");
      expect(copilotResult).toHaveProperty("action", "improve");
      expect(copilotResult).toHaveProperty("documentId", "doc-1");
    });

    it("dispatches 'expand' and returns local-only result", async () => {
      const { useBlockEditorLogic } =
        await import("../../components/block-editor/useBlockEditorLogic");
      const state = {
        documentId: "doc-1",
        state: {
          editorText: "some text",
          setError: vi.fn(),
        },
      };
      const { result } = await import("@testing-library/react").then((m) =>
        m.renderHook(() => useBlockEditorLogic(state as any)),
      );
      const copilotResult = await result.current.copilotAction("expand");
      expect(copilotResult).toHaveProperty("action", "expand");
    });

    it("dispatches 'shorten' and returns local-only result", async () => {
      const { useBlockEditorLogic } =
        await import("../../components/block-editor/useBlockEditorLogic");
      const state = {
        documentId: "doc-1",
        state: {
          editorText: "some text",
          setError: vi.fn(),
        },
      };
      const { result } = await import("@testing-library/react").then((m) =>
        m.renderHook(() => useBlockEditorLogic(state as any)),
      );
      const copilotResult = await result.current.copilotAction("shorten");
      expect(copilotResult).toHaveProperty("action", "shorten");
    });

    it("dispatches 'export' and returns ok with params", async () => {
      const { useBlockEditorLogic } =
        await import("../../components/block-editor/useBlockEditorLogic");
      const state = {
        documentId: "doc-1",
        state: {
          editorText: "some text",
          setError: vi.fn(),
        },
      };
      const { result } = await import("@testing-library/react").then((m) =>
        m.renderHook(() => useBlockEditorLogic(state as any)),
      );
      const copilotResult = await result.current.copilotAction("export", {
        format: "pdf",
      });
      expect(copilotResult).toEqual({ ok: true, params: { format: "pdf" } });
    });

    it("throws on unknown copilot action", async () => {
      const { useBlockEditorLogic } =
        await import("../../components/block-editor/useBlockEditorLogic");
      const setError = vi.fn();
      const state = {
        documentId: "doc-1",
        state: {
          editorText: "some text",
          setError,
        },
      };
      const { result } = await import("@testing-library/react").then((m) =>
        m.renderHook(() => useBlockEditorLogic(state as any)),
      );
      const copilotResult =
        await result.current.copilotAction("unknown_action");
      expect(copilotResult).toHaveProperty("ok", false);
      expect(setError).toHaveBeenCalled();
    });
  });

  describe("autoTag edge cases", () => {
    it("returns empty and sets error on empty text", async () => {
      const { useBlockEditorLogic } =
        await import("../../components/block-editor/useBlockEditorLogic");
      const setError = vi.fn();
      const state = {
        documentId: "doc-1",
        state: {
          editorText: "",
          setError,
        },
      };
      const { result } = await import("@testing-library/react").then((m) =>
        m.renderHook(() => useBlockEditorLogic(state as any)),
      );
      const tags = await result.current.autoTag();
      expect(tags).toEqual([]);
      expect(setError).toHaveBeenCalled();
    });
  });

  describe("generateFlashcards edge cases", () => {
    it("returns empty and sets error on empty text", async () => {
      const { useBlockEditorLogic } =
        await import("../../components/block-editor/useBlockEditorLogic");
      const setError = vi.fn();
      const state = {
        documentId: "doc-1",
        state: {
          editorText: "",
          setError,
        },
      };
      const { result } = await import("@testing-library/react").then((m) =>
        m.renderHook(() => useBlockEditorLogic(state as any)),
      );
      const cards = await result.current.generateFlashcards();
      expect(cards).toEqual([]);
      expect(setError).toHaveBeenCalled();
    });
  });

  describe("audioSummary edge cases", () => {
    it("sets error when speechSynthesis is not available", async () => {
      const { useBlockEditorLogic } =
        await import("../../components/block-editor/useBlockEditorLogic");
      const setError = vi.fn();
      const state = {
        documentId: "doc-1",
        state: {
          editorText: "Hello world",
          setError,
        },
      };
      const { result } = await import("@testing-library/react").then((m) =>
        m.renderHook(() => useBlockEditorLogic(state as any)),
      );
      await result.current.audioSummary();
      expect(setError).toHaveBeenCalled();
    });

    it("sets error on empty text", async () => {
      const viSpeech = vi.fn();
      vi.stubGlobal("speechSynthesis", { speak: viSpeech });
      const { useBlockEditorLogic } =
        await import("../../components/block-editor/useBlockEditorLogic");
      const setError = vi.fn();
      const state = {
        documentId: "doc-1",
        state: {
          editorText: "",
          setError,
        },
      };
      const { result } = await import("@testing-library/react").then((m) =>
        m.renderHook(() => useBlockEditorLogic(state as any)),
      );
      await result.current.audioSummary();
      expect(setError).toHaveBeenCalled();
      vi.unstubAllGlobals();
    });
  });

  describe("suggestFolder edge cases", () => {
    it("returns 'general' and sets error on empty text", async () => {
      const { useBlockEditorLogic } =
        await import("../../components/block-editor/useBlockEditorLogic");
      const setError = vi.fn();
      const state = {
        documentId: "doc-1",
        state: {
          editorText: "",
          setError,
        },
      };
      const { result } = await import("@testing-library/react").then((m) =>
        m.renderHook(() => useBlockEditorLogic(state as any)),
      );
      const folder = await result.current.suggestFolder();
      expect(folder).toBe("general");
      expect(setError).toHaveBeenCalled();
    });
  });

  describe("handleEditorFocus", () => {
    it("clears aiError", async () => {
      const { useBlockEditorLogic } =
        await import("../../components/block-editor/useBlockEditorLogic");
      const state = {
        documentId: "doc-1",
        state: {
          editorText: "",
          setError: vi.fn(),
          isWarmedUpRef: { current: false },
        },
      };
      const { result } = await import("@testing-library/react").then((m) =>
        m.renderHook(() => useBlockEditorLogic(state as any)),
      );
      expect(result.current.aiError).toBeNull();
      result.current.handleEditorFocus();
      expect(result.current.aiError).toBeNull();
    });
  });

  describe("handlePdfText", () => {
    it("calls state.setEditorText", async () => {
      const { useBlockEditorLogic } =
        await import("../../components/block-editor/useBlockEditorLogic");
      const setEditorText = vi.fn();
      const state = {
        documentId: "doc-1",
        state: {
          editorText: "",
          setEditorText,
          setError: vi.fn(),
        },
      };
      const { result } = await import("@testing-library/react").then((m) =>
        m.renderHook(() => useBlockEditorLogic(state as any)),
      );
      await result.current.handlePdfText("pdf content");
      expect(setEditorText).toHaveBeenCalledWith("pdf content");
    });
  });

  describe("handleVoiceTranscript", () => {
    it("appends to existing text", async () => {
      const { useBlockEditorLogic } =
        await import("../../components/block-editor/useBlockEditorLogic");
      const setEditorText = vi.fn();
      const state = {
        documentId: "doc-1",
        state: {
          editorText: "existing ",
          setEditorText,
          setError: vi.fn(),
        },
      };
      const { result } = await import("@testing-library/react").then((m) =>
        m.renderHook(() => useBlockEditorLogic(state as any)),
      );
      await result.current.handleVoiceTranscript("new text");
      expect(setEditorText).toHaveBeenCalledWith("existing  new text");
    });

    it("sets text when no existing text", async () => {
      const { useBlockEditorLogic } =
        await import("../../components/block-editor/useBlockEditorLogic");
      const setEditorText = vi.fn();
      const state = {
        documentId: "doc-1",
        state: {
          editorText: "",
          setEditorText,
          setError: vi.fn(),
        },
      };
      const { result } = await import("@testing-library/react").then((m) =>
        m.renderHook(() => useBlockEditorLogic(state as any)),
      );
      await result.current.handleVoiceTranscript("new text");
      expect(setEditorText).toHaveBeenCalledWith("new text");
    });
  });

  describe("getSuggestionIcon / getSuggestionColor", () => {
    it("returns default icon for unknown suggestion", async () => {
      const { useBlockEditorLogic } =
        await import("../../components/block-editor/useBlockEditorLogic");
      const state = {
        documentId: "doc-1",
        state: {
          editorText: "",
          setError: vi.fn(),
        },
      };
      const { result } = await import("@testing-library/react").then((m) =>
        m.renderHook(() => useBlockEditorLogic(state as any)),
      );
      expect(result.current.getSuggestionIcon("unknown")).toBeDefined();
    });

    it("returns correct color for known suggestion", async () => {
      const { useBlockEditorLogic } =
        await import("../../components/block-editor/useBlockEditorLogic");
      const state = {
        documentId: "doc-1",
        state: {
          editorText: "",
          setError: vi.fn(),
        },
      };
      const { result } = await import("@testing-library/react").then((m) =>
        m.renderHook(() => useBlockEditorLogic(state as any)),
      );
      expect(result.current.getSuggestionColor("expand")).toBe("amber");
      expect(result.current.getSuggestionColor("shorten")).toBe("rose");
      expect(result.current.getSuggestionColor("tag")).toBe("blue");
    });

    it("returns default color for unknown suggestion", async () => {
      const { useBlockEditorLogic } =
        await import("../../components/block-editor/useBlockEditorLogic");
      const state = {
        documentId: "doc-1",
        state: {
          editorText: "",
          setError: vi.fn(),
        },
      };
      const { result } = await import("@testing-library/react").then((m) =>
        m.renderHook(() => useBlockEditorLogic(state as any)),
      );
      expect(result.current.getSuggestionColor("unknown")).toBe("cyan");
    });
  });

  describe("filterSlashMenuItems", () => {
    it("returns all items when query is empty", async () => {
      const { useBlockEditorLogic } =
        await import("../../components/block-editor/useBlockEditorLogic");
      const state = {
        documentId: "doc-1",
        state: {
          editorText: "",
          setError: vi.fn(),
        },
      };
      const { result } = await import("@testing-library/react").then((m) =>
        m.renderHook(() => useBlockEditorLogic(state as any)),
      );
      const mockItems = [
        {
          id: "1",
          title: "Heading 1",
          description: "Main title",
          keywords: ["heading"],
        },
        { id: "2", title: "List", description: "Bullet list", keywords: [] },
      ];
      const filtered = await result.current.filterSlashMenuItems("", mockItems);
      expect(filtered).toHaveLength(2);
    });

    it("filters by title", async () => {
      const { useBlockEditorLogic } =
        await import("../../components/block-editor/useBlockEditorLogic");
      const state = {
        documentId: "doc-1",
        state: {
          editorText: "",
          setError: vi.fn(),
        },
      };
      const { result } = await import("@testing-library/react").then((m) =>
        m.renderHook(() => useBlockEditorLogic(state as any)),
      );
      const mockItems = [
        {
          id: "1",
          title: "Heading 1",
          description: "Main title",
          keywords: ["heading"],
        },
        {
          id: "2",
          title: "Bullet List",
          description: "List with bullets",
          keywords: ["list"],
        },
      ];
      const filtered = await result.current.filterSlashMenuItems(
        "heading",
        mockItems,
      );
      expect(filtered).toHaveLength(1);
      expect(filtered[0]!.title).toBe("Heading 1");
    });

    it("filters by description", async () => {
      const { useBlockEditorLogic } =
        await import("../../components/block-editor/useBlockEditorLogic");
      const state = {
        documentId: "doc-1",
        state: {
          editorText: "",
          setError: vi.fn(),
        },
      };
      const { result } = await import("@testing-library/react").then((m) =>
        m.renderHook(() => useBlockEditorLogic(state as any)),
      );
      const mockItems = [
        {
          id: "1",
          title: "Image",
          description: "Insert an image",
          keywords: [],
        },
      ];
      const filtered = await result.current.filterSlashMenuItems(
        "insert",
        mockItems,
      );
      expect(filtered).toHaveLength(1);
    });

    it("filters by keywords", async () => {
      const { useBlockEditorLogic } =
        await import("../../components/block-editor/useBlockEditorLogic");
      const state = {
        documentId: "doc-1",
        state: {
          editorText: "",
          setError: vi.fn(),
        },
      };
      const { result } = await import("@testing-library/react").then((m) =>
        m.renderHook(() => useBlockEditorLogic(state as any)),
      );
      const mockItems = [
        {
          id: "1",
          title: "Todo",
          description: "Task list",
          keywords: ["check", "task"],
        },
      ];
      const filtered = await result.current.filterSlashMenuItems(
        "task",
        mockItems,
      );
      expect(filtered).toHaveLength(1);
    });

    it("returns empty when no items match", async () => {
      const { useBlockEditorLogic } =
        await import("../../components/block-editor/useBlockEditorLogic");
      const state = {
        documentId: "doc-1",
        state: {
          editorText: "",
          setError: vi.fn(),
        },
      };
      const { result } = await import("@testing-library/react").then((m) =>
        m.renderHook(() => useBlockEditorLogic(state as any)),
      );
      const mockItems = [
        {
          id: "1",
          title: "Image",
          description: "Insert",
          keywords: [],
        },
      ];
      const filtered = await result.current.filterSlashMenuItems(
        "heading",
        mockItems,
      );
      expect(filtered).toHaveLength(0);
    });
  });

  describe("slashMenuItems", () => {
    it("returns all expected menu items", async () => {
      const { useBlockEditorLogic } =
        await import("../../components/block-editor/useBlockEditorLogic");
      const state = {
        documentId: "doc-1",
        state: {
          editorText: "",
          setError: vi.fn(),
        },
      };
      const { result } = await import("@testing-library/react").then((m) =>
        m.renderHook(() => useBlockEditorLogic(state as any)),
      );
      const ids = result.current.slashMenuItems.map((i) => i.id);
      expect(ids).toContain("heading-1");
      expect(ids).toContain("heading-2");
      expect(ids).toContain("heading-3");
      expect(ids).toContain("bullet-list");
      expect(ids).toContain("numbered-list");
      expect(ids).toContain("todo");
      expect(ids).toContain("callout");
      expect(ids).toContain("columns-2");
      expect(ids).toContain("columns-3");
      expect(ids).toContain("code");
      expect(ids).toContain("quote");
      expect(ids).toContain("divider");
      expect(ids).toContain("image");
      expect(ids).toContain("toggle-list");
    });

    it("each item has valid group", async () => {
      const { useBlockEditorLogic } =
        await import("../../components/block-editor/useBlockEditorLogic");
      const state = {
        documentId: "doc-1",
        state: {
          editorText: "",
          setError: vi.fn(),
        },
      };
      const { result } = await import("@testing-library/react").then((m) =>
        m.renderHook(() => useBlockEditorLogic(state as any)),
      );
      const validGroups = ["basic", "lists", "media", "advanced"];
      for (const item of result.current.slashMenuItems) {
        expect(validGroups).toContain(item.group);
      }
    });
  });
});
