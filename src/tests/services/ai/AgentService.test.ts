import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGenerateText = vi.fn();
const mockStreamGenerateText = vi.fn();
vi.mock("../../../services/ai/ProviderManager", () => ({
  aiManager: {
    generateText: mockGenerateText,
    streamGenerateText: mockStreamGenerateText,
  },
}));

const mockLogger = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock("../../../utils/logger", () => ({ logger: mockLogger }));

const mockMemoryEngine = {
  isInitialized: vi.fn(),
  initialize: vi.fn(),
  getOrCreateSession: vi.fn(),
  getContextForQuery: vi.fn(),
  addMessage: vi.fn(),
  getStats: vi.fn(),
  clearAllMemory: vi.fn(),
  getActiveSession: vi.fn(),
  closeSession: vi.fn(),
};
vi.mock("../../../memory/MemoryEngine", () => ({
  memoryEngine: mockMemoryEngine,
}));

const mockGlobalRAGService = {
  searchContext: vi.fn(),
  formatContext: vi.fn(),
};

// GlobalRAGService is Pro: the double is installed at the pro-access loader
// instead of at the Pro module (AgentService resolves it through the gate).
vi.mock("../../../services/pro-access", () => ({
  loadGlobalRAGService: () => Promise.resolve(mockGlobalRAGService),
  ProUnavailableError: class ProUnavailableError extends Error {},
}));

const { agentService } = await import("../../../services/ai/AgentService");

describe("AgentService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agentService.clearCache();
  });

  describe("input validation", () => {
    it.each([
      ["classifyDocument", (s: string) => agentService.classifyDocument(s)],
      ["rewrite", (s: string) => agentService.rewrite(s)],
      ["continueWriting", (s: string) => agentService.continueWriting(s)],
      ["fixGrammar", (s: string) => agentService.fixGrammar(s)],
      ["translate", (s: string) => agentService.translate(s)],
      ["extractKeyPoints", (s: string) => agentService.extractKeyPoints(s)],
    ])("%s lanza error para texto vacío", async (_, fn) => {
      await expect(fn("")).rejects.toThrow("[AgentService] Invalid input");
    });
  });

  describe("classifyDocument", () => {
    it("returns tags and category from JSON response", async () => {
      mockGenerateText.mockResolvedValue({
        text: '{"tags":["tech","ai"],"category":"technology"}',
      });
      const result = await agentService.classifyDocument("some text");
      expect(result.tags).toEqual(["tech", "ai"]);
      expect(result.category).toBe("technology");
    });

    it("uses cache on the second call", async () => {
      mockGenerateText.mockResolvedValue({
        text: '{"tags":["cached"],"category":"test"}',
      });
      const first = await agentService.classifyDocument("unique text", undefined, false);
      const second = await agentService.classifyDocument("unique text", undefined, false);
      expect(first).toEqual(second);
      expect(mockGenerateText).toHaveBeenCalledTimes(1);
    });

    it("returns default values if JSON is invalid", async () => {
      mockGenerateText.mockResolvedValue({ text: "not json" });
      const result = await agentService.classifyDocument("text");
      expect(result.tags).toEqual([]);
      expect(result.category).toBe("general");
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it("normaliza tags no array y category no string", async () => {
      mockGenerateText.mockResolvedValue({
        text: '{"tags":"not-array","category":123}',
      });
      const result = await agentService.classifyDocument("text");
      expect(result.tags).toEqual([]);
      expect(result.category).toBe("general");
    });

    it("limita a 8 tags", async () => {
      const manyTags = Array.from({ length: 20 }, (_, i) => `tag${i}`);
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify({ tags: manyTags, category: "test" }),
      });
      const result = await agentService.classifyDocument("text");
      expect(result.tags).toHaveLength(8);
    });

    it("pasa isPrivate a aiManager", async () => {
      mockGenerateText.mockResolvedValue({
        text: '{"tags":[],"category":"x"}',
      });
      await agentService.classifyDocument("text", "en", true);
      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ isPrivate: true }),
      );
    });
  });

  describe("rewrite", () => {
    it("returns rewritten text", async () => {
      mockGenerateText.mockResolvedValue({ text: "rewritten text" });
      const result = await agentService.rewrite("original text");
      expect(result).toBe("rewritten text");
    });

    it("uses cache on the second call", async () => {
      mockGenerateText.mockResolvedValue({ text: "cached rewrite" });
      await agentService.rewrite("test", undefined, undefined, false);
      await agentService.rewrite("test", undefined, undefined, false);
      expect(mockGenerateText).toHaveBeenCalledTimes(1);
    });

    it("uses the provided tone", async () => {
      mockGenerateText.mockResolvedValue({ text: "casual text" });
      await agentService.rewrite("text", "casual");
      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining("casual"),
        expect.any(Object),
      );
    });
  });

  describe("continueWriting", () => {
    it("returns text continuation", async () => {
      mockGenerateText.mockResolvedValue({ text: " continuation" });
      const result = await agentService.continueWriting("start");
      expect(result).toBe("continuation");
    });

    it("includes instructions in system prompt", async () => {
      mockGenerateText.mockResolvedValue({ text: "result" });
      await agentService.continueWriting("text", "en", "make it longer");
      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining("make it longer"),
        expect.any(Object),
      );
    });
  });

  describe("fixGrammar", () => {
    it("returns corrected text", async () => {
      mockGenerateText.mockResolvedValue({ text: "corrected text" });
      const result = await agentService.fixGrammar("incorrect text");
      expect(result).toBe("corrected text");
    });

    it("uses cache", async () => {
      mockGenerateText.mockResolvedValue({ text: "fixed" });
      await agentService.fixGrammar("text", undefined, false);
      await agentService.fixGrammar("text", undefined, false);
      expect(mockGenerateText).toHaveBeenCalledTimes(1);
    });
  });

  describe("translate", () => {
    it("returns translated text", async () => {
      mockGenerateText.mockResolvedValue({ text: "texto traducido" });
      const result = await agentService.translate("translated text", "Spanish");
      expect(result).toBe("texto traducido");
    });

    it("uses cache", async () => {
      mockGenerateText.mockResolvedValue({ text: "hola" });
      await agentService.translate("hello", "Spanish", false);
      await agentService.translate("hello", "Spanish", false);
      expect(mockGenerateText).toHaveBeenCalledTimes(1);
    });

    it("targetLang defaults to Spanish", async () => {
      mockGenerateText.mockResolvedValue({ text: "x" });
      await agentService.translate("text");
      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringContaining("Spanish"),
        expect.any(Object),
      );
    });
  });

  describe("answerQuestion", () => {
    it("returns context-based response", async () => {
      mockGenerateText.mockResolvedValue({ text: "The answer is 42." });
      const result = await agentService.answerQuestion(
        "What is the answer?",
        "Context about everything",
      );
      expect(result).toBe("The answer is 42.");
    });
  });

  describe("globalChat", () => {
    beforeEach(() => {
      mockMemoryEngine.isInitialized.mockReturnValue(false);
      mockMemoryEngine.getOrCreateSession.mockResolvedValue("session-1");
      mockMemoryEngine.getContextForQuery.mockResolvedValue("memory context");
      mockMemoryEngine.addMessage.mockResolvedValue(undefined);
      mockGlobalRAGService.searchContext.mockResolvedValue([
        {
          id: "1",
          title: "Src",
          type: "bookmark",
          score: 0.9,
          content: "content",
        },
      ]);
      mockGlobalRAGService.formatContext.mockReturnValue("formatted context");
      mockGenerateText.mockResolvedValue({ text: "rag answer" });
    });

    it("returns result with text, sources and grounding", async () => {
      const result = await agentService.globalChat("my question", "en", false);
      expect(result.text).toBe("rag answer");
      expect(result.sources).toHaveLength(1);
      expect(result).toHaveProperty("groundingMetadata");
    });

    it("initializes memoryEngine if not ready", async () => {
      await agentService.globalChat("q");
      expect(mockMemoryEngine.initialize).toHaveBeenCalled();
    });

    it("does not initialize memoryEngine if already ready", async () => {
      mockMemoryEngine.isInitialized.mockReturnValue(true);
      await agentService.globalChat("q");
      expect(mockMemoryEngine.initialize).not.toHaveBeenCalled();
    });

    it("uses the existing sessionId if provided", async () => {
      await agentService.globalChat("q", "en", false, "existing-session");
      expect(mockMemoryEngine.getOrCreateSession).not.toHaveBeenCalled();
    });

    it("saves messages to memory", async () => {
      await agentService.globalChat("my question", "en", false);
      expect(mockMemoryEngine.addMessage).toHaveBeenCalledTimes(2);
    });

    it("does not wait for memory writes before returning the AI response", async () => {
      mockMemoryEngine.addMessage.mockImplementation(
        () => new Promise(() => {}),
      );

      await expect(
        agentService.globalChat("my question", "en", false),
      ).resolves.toMatchObject({ text: "rag answer" });
      expect(mockMemoryEngine.addMessage).toHaveBeenCalledTimes(2);
    });

    it("handles memory recall error without throwing", async () => {
      mockMemoryEngine.getContextForQuery.mockRejectedValue(
        new Error("memory error"),
      );
      await expect(agentService.globalChat("q")).resolves.toBeDefined();
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it("does not inject an unlabeled document context into a public chat (privacy)", async () => {
      mockGenerateText.mockResolvedValue({
        text: "ok",
        sources: [],
      });
      mockGlobalRAGService.searchContext.mockReset();
      mockGlobalRAGService.searchContext.mockResolvedValue([]);
      await agentService.globalChat(
        "my question",
        "en",
        false,
        "session-1",
        undefined,
        { id: "doc-9", text: "Contenido completo del documento abierto." },
      );
      // PRIVACY (audit): a public chat with an UNLABELED document context
      // must NOT inject the document text — the caller cannot prove the
      // document is public, so a private document's content would otherwise
      // ship to a cloud provider. Because nothing is injected, the doc id
      // must also NOT be excluded from the RAG search. (Assert on the first
      // call because a memory recall may precede the answer generation.)
      expect(mockGenerateText.mock.calls.length).toBeGreaterThan(0);
      expect(mockGenerateText.mock.calls[0]![0]).not.toContain(
        "Contenido completo del documento abierto.",
      );
      expect(mockGenerateText.mock.calls[0]![0]).not.toContain(
        "CURRENT DOCUMENT CONTEXT",
      );
      expect(mockGlobalRAGService.searchContext).toHaveBeenCalledWith(
        "my question",
        5,
        undefined,
        undefined,
        false,
      );
    });

    it("injects an explicitly-public document context into a public chat", async () => {
      mockGenerateText.mockResolvedValue({
        text: "ok",
        sources: [],
      });
      await agentService.globalChat(
        "my question",
        "en",
        false,
        "session-1",
        undefined,
        { id: "doc-9", text: "Contenido completo del documento abierto.", isPublic: true },
      );
      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.stringContaining("Contenido completo del documento abierto."),
        expect.stringContaining("CURRENT DOCUMENT CONTEXT"),
        expect.any(Object),
      );
    });

    it("bounds the document text to 12000 characters", async () => {
      await agentService.globalChat(
        "q",
        undefined,
        false,
        "s",
        undefined,
        { id: "d", text: "x".repeat(20000), isPublic: true },
      );
      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.not.stringContaining("x".repeat(12001)),
        expect.any(String),
        expect.any(Object),
      );
    });

    it("without current document: no injection and no exclusion in RAG", async () => {
      await agentService.globalChat("my question", undefined, false);
      expect(mockGlobalRAGService.searchContext).toHaveBeenCalledWith(
        "my question",
        5,
        undefined,
        undefined,
        false,
      );
      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.not.stringContaining("CURRENT DOCUMENT CONTEXT"),
        expect.any(String),
        expect.any(Object),
      );
    });

    it("forwards onChunk and onProvider to streamGenerateText when streaming", async () => {
      mockStreamGenerateText.mockResolvedValue({
        text: "streamed answer",
        provider: "ollama",
      });
      const onChunk = vi.fn();
      const onProvider = vi.fn();
      await agentService.globalChat(
        "q",
        "en",
        false,
        "session-1",
        onChunk,
        undefined,
        onProvider,
      );
      expect(mockStreamGenerateText).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ complexity: "complex" }),
        onChunk,
        onProvider,
        undefined,
      );
    });

    it("{ id } without text: would exclude the doc from RAG without injecting anything — does not exclude", async () => {
      // Footgun guard: a documentContext with only `id` (no text) must NEVER
      // exclude the document from RAG, because its content is not injected
      // into the prompt and the model would lose all access to it.
      await agentService.globalChat(
        "my question",
        "en",
        false,
        "session-1",
        undefined,
        { id: "doc-9" },
      );
      expect(mockGlobalRAGService.searchContext).toHaveBeenCalledWith(
        "my question",
        5,
        undefined,
        undefined,
        false,
      );
      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.not.stringContaining("CURRENT DOCUMENT CONTEXT"),
        expect.any(String),
        expect.any(Object),
      );
    });
  });

  describe("extractKeyPoints", () => {
    it("returns array of key points from JSON", async () => {
      mockGenerateText.mockResolvedValue({
        text: '["point 1","point 2","point 3"]',
      });
      const result = await agentService.extractKeyPoints("text");
      expect(result).toEqual(["point 1", "point 2", "point 3"]);
    });

    it("returns empty array if JSON is invalid", async () => {
      mockGenerateText.mockResolvedValue({ text: "not json" });
      const result = await agentService.extractKeyPoints("text");
      expect(result).toEqual([]);
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it("returns empty array if response is not an array", async () => {
      mockGenerateText.mockResolvedValue({ text: '{"key":"value"}' });
      const result = await agentService.extractKeyPoints("text");
      expect(result).toEqual([]);
    });

    it("respects maxPoints", async () => {
      mockGenerateText.mockResolvedValue({ text: '["a","b","c","d","e"]' });
      const result = await agentService.extractKeyPoints("text", "en", 3);
      expect(result).toHaveLength(3);
    });

    it("filters out non-string elements", async () => {
      mockGenerateText.mockResolvedValue({
        text: '["valid", 123, null, "also valid"]',
      });
      const result = await agentService.extractKeyPoints("text");
      expect(result).toEqual(["valid", "also valid"]);
    });
  });

  describe("generateResponse", () => {
    it("returns generated text", async () => {
      mockGenerateText.mockResolvedValue({ text: "generated response" });
      const result = await agentService.generateResponse(
        "prompt",
        "system prompt",
      );
      expect(result).toBe("generated response");
    });

    it("pasa isPrivate a aiManager", async () => {
      mockGenerateText.mockResolvedValue({ text: "x" });
      await agentService.generateResponse("prompt", "system", true);
      expect(mockGenerateText).toHaveBeenCalledWith(
        "prompt",
        "system",
        expect.objectContaining({ isPrivate: true }),
      );
    });
  });

  describe("webSearch", () => {
    it("returns text and groundingMetadata", async () => {
      mockGenerateText.mockResolvedValue({
        text: "search result",
        groundingMetadata: { webSearchQueries: ["test"] },
      });
      const result = await agentService.webSearch("test query", undefined, false);
      expect(result.text).toBe("search result");
      expect(result.groundingMetadata).toBeDefined();
    });
  });

  describe("supportChat", () => {
    it("returns assistant response", async () => {
      mockGenerateText.mockResolvedValue({ text: "support answer" });
      const result = await agentService.supportChat("How to export?");
      expect(result).toBe("support answer");
    });

    it("includes knowledge base in system prompt", async () => {
      mockGenerateText.mockResolvedValue({ text: "x" });
      await agentService.supportChat("question");
      expect(mockGenerateText).toHaveBeenCalledWith(
        "question",
        expect.stringContaining("BookmarkForge"),
        expect.any(Object),
      );
    });
  });

  describe("privacy: isPrivate never touches agentCache", () => {
    // The 4 methods that use agentCache (read AND write).
    const cachedOps: Array<
      [string, (text: string, isPrivate: boolean) => Promise<unknown>]
    > = [
      ["classifyDocument", (t, p) => agentService.classifyDocument(t, "en", p)],
      ["rewrite", (t, p) => agentService.rewrite(t, "professional", "en", p)],
      ["fixGrammar", (t, p) => agentService.fixGrammar(t, "en", p)],
      ["translate", (t, p) => agentService.translate(t, "Spanish", p)],
    ];

    it.each(cachedOps)("%s: NO almacena resultados de peticiones privadas", async (_, fn) => {
      mockGenerateText.mockResolvedValue({ text: '{"tags":[],"category":"x"}' });
      // Private request → must not write to agentCache.
      await fn("confidential text 101010", true);
      // Non-private request with the same text → does not find the result
      // private in the cache and calls AI again.
      await fn("confidential text 101010", false);
      expect(mockGenerateText).toHaveBeenCalledTimes(2);
    });

    it.each(cachedOps)("%s: NO lee del cache en peticiones privadas", async (_, fn) => {
      mockGenerateText.mockResolvedValue({ text: '{"tags":[],"category":"x"}' });
      // Non-private request → writes to agentCache.
      await fn("shared text 202020", false);
      // Private request with the same text → must not be served from the cache.
      await fn("shared text 202020", true);
      expect(mockGenerateText).toHaveBeenCalledTimes(2);
    });

    it.each(cachedOps)("%s: cache normal sigue funcionando sin isPrivate (control)", async (_, fn) => {
      mockGenerateText.mockResolvedValue({ text: '{"tags":[],"category":"x"}' });
      await fn("normal text 303030", false);
      await fn("normal text 303030", false);
      expect(mockGenerateText).toHaveBeenCalledTimes(1);
    });
  });

  describe("clearCache", () => {
    it("clears cache without errors", () => {
      expect(() => agentService.clearCache()).not.toThrow();
    });
  });

  describe("getMemoryStats", () => {
    it("returns memoryEngine stats", async () => {
      mockMemoryEngine.getStats.mockResolvedValue({
        atoms: 5,
        scenarios: 2,
        hasPersona: true,
        sessions: 1,
      });
      const stats = await agentService.getMemoryStats();
      expect(stats).toEqual({
        atoms: 5,
        scenarios: 2,
        hasPersona: true,
        sessions: 1,
      });
    });

    it("returns defaults if memoryEngine fails", async () => {
      mockMemoryEngine.getStats.mockRejectedValue(new Error("fail"));
      const stats = await agentService.getMemoryStats();
      expect(stats).toEqual({
        atoms: 0,
        scenarios: 0,
        hasPersona: false,
        sessions: 0,
      });
    });
  });

  describe("clearMemory", () => {
    it("llama a memoryEngine.clearAllMemory", async () => {
      mockMemoryEngine.clearAllMemory.mockResolvedValue(undefined);
      await agentService.clearMemory();
      expect(mockMemoryEngine.clearAllMemory).toHaveBeenCalled();
    });

    it("logs error if it fails", async () => {
      mockMemoryEngine.clearAllMemory.mockRejectedValue(
        new Error("clear fail"),
      );
      await agentService.clearMemory();
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe("getActiveSessionId", () => {
    it("returns session id", async () => {
      mockMemoryEngine.getActiveSession.mockResolvedValue("session-1");
      expect(await agentService.getActiveSessionId()).toBe("session-1");
    });

    it("returns null if it fails", async () => {
      mockMemoryEngine.getActiveSession.mockRejectedValue(new Error("fail"));
      expect(await agentService.getActiveSessionId()).toBeNull();
    });
  });

  describe("closeSession", () => {
    it("llama a memoryEngine.closeSession", async () => {
      mockMemoryEngine.closeSession.mockResolvedValue(undefined);
      await agentService.closeSession("session-1");
      expect(mockMemoryEngine.closeSession).toHaveBeenCalledWith("session-1");
    });

    it("logs warning if it fails", async () => {
      mockMemoryEngine.closeSession.mockRejectedValue(new Error("close fail"));
      await agentService.closeSession("session-1");
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });

  describe("ensureMemoryInitialized / getOrCreateSession (I1 wrappers)", () => {
    it("ensureMemoryInitialized initializes if not ready", async () => {
      mockMemoryEngine.isInitialized.mockReturnValue(false);
      await agentService.ensureMemoryInitialized();
      expect(mockMemoryEngine.initialize).toHaveBeenCalled();
    });

    it("ensureMemoryInitialized does not initialize if already ready", async () => {
      mockMemoryEngine.isInitialized.mockReturnValue(true);
      await agentService.ensureMemoryInitialized();
      expect(mockMemoryEngine.initialize).not.toHaveBeenCalled();
    });

    it("ensureMemoryInitialized does not throw if initialization fails", async () => {
      mockMemoryEngine.isInitialized.mockReturnValue(false);
      mockMemoryEngine.initialize.mockRejectedValue(new Error("init fail"));
      await expect(agentService.ensureMemoryInitialized()).resolves.toBeUndefined();
      expect(mockLogger.warn).toHaveBeenCalled();
    });

    it("getOrCreateSession delega en memoryEngine", async () => {
      mockMemoryEngine.isInitialized.mockReturnValue(true);
      mockMemoryEngine.getOrCreateSession.mockResolvedValue("session-1");
      await expect(agentService.getOrCreateSession("Título")).resolves.toBe(
        "session-1",
      );
      expect(mockMemoryEngine.getOrCreateSession).toHaveBeenCalledWith("Título");
    });

    it("getOrCreateSession initializes memory before creating", async () => {
      mockMemoryEngine.isInitialized.mockReturnValue(false);
      mockMemoryEngine.getOrCreateSession.mockResolvedValue("session-1");
      await agentService.getOrCreateSession("Título");
      expect(mockMemoryEngine.initialize).toHaveBeenCalled();
    });

    it("getOrCreateSession returns null if it fails", async () => {
      mockMemoryEngine.isInitialized.mockReturnValue(true);
      mockMemoryEngine.getOrCreateSession.mockRejectedValue(new Error("fail"));
      await expect(agentService.getOrCreateSession("Título")).resolves.toBeNull();
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });

  describe("log projection (safeErrorForLog)", () => {
    it("projects memory stats failures through the bounded shape", async () => {
      mockMemoryEngine.getStats.mockRejectedValue(
        new Error(`backend lost dataset: ${"x".repeat(300)} payload`),
      );
      await agentService.getMemoryStats();
      const calls = mockLogger.warn.mock.calls as unknown[][];
      const failureEntry = calls.find(
        ([label]: unknown[]) =>
          typeof label === "string" &&
          (label as string).includes("Failed to get memory stats"),
      );
      expect(failureEntry).toBeDefined();
      const meta = failureEntry![1] as {
        error?: { name?: unknown; message?: unknown };
      };
      expect(typeof meta.error?.name).toBe("string");
      expect((meta.error?.message as string).length).toBeLessThanOrEqual(220);
      expect(meta.error?.message as string).toMatch(/\u2026\[\+\d+\]/);
      expect(meta.error).not.toHaveProperty("stack");
    });

    it("projects session close failures through the bounded shape", async () => {
      mockMemoryEngine.closeSession.mockRejectedValue(
        new Error(`session layer: ${"y".repeat(280)}`),
      );
      await agentService.closeSession("session-x");
      const calls = mockLogger.warn.mock.calls as unknown[][];
      const failureEntry = calls.find(
        ([label]: unknown[]) =>
          typeof label === "string" &&
          (label as string).includes("Failed to close session"),
      );
      expect(failureEntry).toBeDefined();
      const meta = failureEntry![1] as {
        error?: { name?: unknown; message?: unknown };
      };
      expect((meta.error?.message as string).length).toBeLessThanOrEqual(220);
      expect(meta.error).not.toHaveProperty("stack");
    });
  });
});
