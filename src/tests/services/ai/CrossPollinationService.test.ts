import { describe, it, expect, beforeEach, vi } from "vitest";

const mockGenerateText = vi.fn();

const mockVaultCallbacks = vi.hoisted(() => ({
  lock: [] as Array<() => void>,
  unlock: [] as Array<() => void>,
}));

vi.mock("../../../services/SecurityVault", () => ({
  securityVault: {
    onLock: (listener: () => void) => {
      mockVaultCallbacks.lock.push(listener);
      return () => {};
    },
    onUnlock: (listener: () => void) => {
      mockVaultCallbacks.unlock.push(listener);
      return () => {};
    },
  },
}));

vi.mock("../../../services/ai/ProviderManager", () => ({
  aiManager: {
    get generateText() {
      return mockGenerateText;
    },
  },
}));

vi.mock("../../../services/ai/RAGEngine", () => ({
  ragEngine: {
    searchSimilar: vi.fn(),
  },
}));

vi.mock("../../../db/database", () => ({
  initDB: vi.fn(),
}));

vi.mock("../../../utils/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const mockSafeGet = vi.hoisted(() => vi.fn());
const mockSafeSet = vi.hoisted(() => vi.fn());

vi.mock("../../../store/safeStorage", () => ({
  safeGet: mockSafeGet,
  safeSet: mockSafeSet,
}));

const { initDB } = await import("../../../db/database");
const { ragEngine } = await import("../../../services/ai/RAGEngine");
const { crossPollinationService } =
  await import("../../../services/ai/CrossPollinationService");

describe("CrossPollinationService", () => {
  let mockDb: any;

  const mockDocs = [
    {
      id: "doc-1",
      title: "AI Research",
      content: "Deep learning and neural networks content.",
    },
    {
      id: "doc-2",
      title: "Quantum Computing",
      content: "Quantum mechanics and computing.",
    },
  ];

  const mockBookmarks = [
    {
      id: "bm-1",
      title: "Python Tutorial",
      description: "Learn Python programming.",
    },
    { id: "bm-2", title: "React Guide", description: "React framework guide." },
  ];

  function createMockFind(result: unknown[]) {
    return vi.fn().mockReturnValue({
      exec: vi.fn().mockResolvedValue(result),
    } as any);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateText.mockReset();
    mockSafeGet.mockReset();
    mockSafeSet.mockReset();
    crossPollinationService.__resetInsightsForTests();
    vi.spyOn(Math, "random").mockReturnValue(0);
    mockDb = {
      documents: { find: createMockFind(mockDocs) },
      bookmarks: { find: createMockFind(mockBookmarks) },
      insights: {
        find: vi.fn(),
        findOne: vi.fn().mockReturnValue({
          exec: vi.fn().mockResolvedValue(null),
        }),
        upsert: vi.fn().mockResolvedValue(undefined),
      },
    };
    (initDB as ReturnType<typeof vi.fn>).mockResolvedValue(mockDb);
  });

  describe("generateInsights", () => {
    it("returns empty array if there are fewer than 2 items", async () => {
      (mockDb.documents.find() as any).exec.mockResolvedValue([]);
      (mockDb.bookmarks.find() as any).exec.mockResolvedValue([]);
      const insights = await crossPollinationService.generateInsights();
      expect(insights).toEqual([]);
    });

    it("returns empty array if there are no neighbors with similarity > 0.75", async () => {
      (ragEngine.searchSimilar as any).mockResolvedValue([
        { id: "doc-1", similarity: 0.5 },
      ]);
      const insights = await crossPollinationService.generateInsights();
      expect(insights).toEqual([]);
    });

    it("propagates the signal to semantic search and the model", async () => {
      const controller = new AbortController();
      (ragEngine.searchSimilar as any).mockResolvedValue([
        { id: "doc-2", similarity: 0.85 },
      ]);
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify({ title: "T", insight: "C" }),
        provider: "gemini",
      });

      await crossPollinationService.generateInsights("en", controller.signal);

      expect(ragEngine.searchSimilar).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        5,
        expect.any(AbortSignal),
      );
      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it("deduplicates simultaneous generations of the same language", async () => {
      let resolveGeneration!: (response: { text: string; provider: string }) => void;
      (ragEngine.searchSimilar as any).mockResolvedValue([
        { id: "doc-2", similarity: 0.85 },
      ]);
      mockGenerateText.mockReturnValue(
        new Promise((resolve) => {
          resolveGeneration = resolve;
        }),
      );

      const first = crossPollinationService.generateInsights("en");
      const second = crossPollinationService.generateInsights("en");
      await vi.waitFor(() => expect(mockGenerateText).toHaveBeenCalledTimes(1));

      resolveGeneration({
        text: JSON.stringify({ title: "shared", insight: "shared" }),
        provider: "gemini",
      });
      await expect(Promise.all([first, second])).resolves.toHaveLength(2);
      expect(ragEngine.searchSimilar).toHaveBeenCalledTimes(1);
      expect(mockDb.insights.upsert).toHaveBeenCalledTimes(1);
    });

    it("aborts generations and clears results when the vault changes", async () => {
      let resolveGeneration!: (response: { text: string; provider: string }) => void;
      (ragEngine.searchSimilar as any).mockResolvedValue([
        { id: "doc-2", similarity: 0.85 },
      ]);
      mockGenerateText.mockReturnValue(
        new Promise((resolve) => {
          resolveGeneration = resolve;
        }),
      );

      const request = crossPollinationService.generateInsights("en");
      await vi.waitFor(() => expect(mockGenerateText).toHaveBeenCalledTimes(1));
      mockVaultCallbacks.lock.forEach((listener) => listener());
      resolveGeneration({
        text: JSON.stringify({ title: "stale", insight: "stale" }),
        provider: "gemini",
      });

      await expect(request).rejects.toMatchObject({ name: "AbortError" });
      expect((crossPollinationService as any).insights).toEqual([]);
    });

    it("keeps the shared generation if only one subscriber aborts", async () => {
      const controller = new AbortController();
      let resolveGeneration!: (response: { text: string; provider: string }) => void;
      (ragEngine.searchSimilar as any).mockResolvedValue([
        { id: "doc-2", similarity: 0.85 },
      ]);
      mockGenerateText.mockReturnValue(
        new Promise((resolve) => {
          resolveGeneration = resolve;
        }),
      );

      const aborted = crossPollinationService.generateInsights(
        "en",
        controller.signal,
      );
      const surviving = crossPollinationService.generateInsights("en");
      await vi.waitFor(() => expect(mockGenerateText).toHaveBeenCalledTimes(1));
      controller.abort();
      resolveGeneration({
        text: JSON.stringify({ title: "shared", insight: "shared" }),
        provider: "gemini",
      });

      await expect(aborted).rejects.toMatchObject({ name: "AbortError" });
      await expect(surviving).resolves.toHaveLength(1);
      expect(mockDb.insights.upsert).toHaveBeenCalledTimes(1);
    });

    it("does not persist an insight if the signal aborts during generation", async () => {
      const controller = new AbortController();
      let resolveGeneration!: (response: { text: string; provider: string }) => void;
      (ragEngine.searchSimilar as any).mockResolvedValue([
        { id: "doc-2", similarity: 0.85 },
      ]);
      mockGenerateText.mockReturnValue(
        new Promise((resolve) => {
          resolveGeneration = resolve;
        }),
      );

      const request = crossPollinationService.generateInsights(
        "en",
        controller.signal,
      );
      await vi.waitFor(() => expect(mockGenerateText).toHaveBeenCalled());
      controller.abort();
      resolveGeneration({
        text: JSON.stringify({ title: "stale", insight: "stale" }),
        provider: "gemini",
      });

      await expect(request).rejects.toMatchObject({ name: "AbortError" });
      expect(mockDb.insights.upsert).not.toHaveBeenCalled();
    });

    it("generates insight when there is a semantic connection", async () => {
      (ragEngine.searchSimilar as any).mockResolvedValue([
        { id: "doc-2", similarity: 0.85 },
      ]);

      mockGenerateText.mockResolvedValue({
        text: JSON.stringify({
          title: "AI + Quantum Synergy",
          insight: "Both fields converge on computational paradigms.",
        }),
        provider: "gemini",
      });

      const insights = await crossPollinationService.generateInsights();
      expect(insights).toHaveLength(1);
      expect(insights[0]!.type).toBe("connection");
      expect(insights[0]!.title).toBe("AI + Quantum Synergy");
      expect(insights[0]!.content).toBe(
        "Both fields converge on computational paradigms.",
      );
      expect(insights[0]!.relatedIds).toContain("doc-2");
      expect(insights[0]!.isRead).toBe(false);
    });

    it("routes insights to a local provider only (isPrivate: true)", async () => {
      (ragEngine.searchSimilar as any).mockResolvedValue([
        { id: "doc-2", similarity: 0.85 },
      ]);
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify({
          title: "Local Insight",
          insight: "Local-only synthesis.",
        }),
        provider: "webllm",
      });

      await crossPollinationService.generateInsights();

      expect(mockGenerateText).toHaveBeenCalledTimes(1);
      const opts = mockGenerateText.mock.calls[0]![2] as Record<string, unknown>;
      // The synthesis prompt carries user content; it must be routed to the
      // local provider and never to cloud without an explicit opt-in.
      expect(opts.isPrivate).toBe(true);
    });

    it("returns empty array if AI fails", async () => {
      (ragEngine.searchSimilar as any).mockResolvedValue([
        { id: "doc-2", similarity: 0.85 },
      ]);
      mockGenerateText.mockRejectedValue(new Error("API error"));

      const insights = await crossPollinationService.generateInsights();
      expect(insights).toEqual([]);
    });

    // The insight prompt is English-only since the prompt-language
    // migration — passing lang=es must NOT switch it back to Spanish.
    it("keeps the English prompt even when lang=es", async () => {
      (ragEngine.searchSimilar as any).mockResolvedValue([
        { id: "doc-2", similarity: 0.85 },
      ]);
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify({ title: "Título", insight: "Contenido" }),
        provider: "gemini",
      });

      await crossPollinationService.generateInsights("es");
      expect(mockGenerateText).toHaveBeenCalled();
      const callPrompt = mockGenerateText.mock.calls[0]![0];
      const callSystem = mockGenerateText.mock.calls[0]![1];
      expect(callPrompt).toContain("ITEM A");
      expect(callSystem).toContain("Quantum Knowledge Architect");
    });
  });

  describe("generateWeeklyCuration", () => {
    beforeEach(() => {
      mockDb.documents.find = vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue(mockDocs),
      } as any);
      mockDb.bookmarks.find = vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue(mockBookmarks),
      } as any);
    });

    it("returns null if there are fewer than 3 recent items", async () => {
      (mockDb.documents.find() as any).exec.mockResolvedValue([]);
      (mockDb.bookmarks.find() as any).exec.mockResolvedValue([]);
      const curation = await crossPollinationService.generateWeeklyCuration();
      expect(curation).toBeNull();
    });

    it("generates weekly curation with recent items", async () => {
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify({
          title: "Your Week in Review",
          content: "Analysis of your weekly topics.",
        }),
        provider: "gemini",
      });

      const curation = await crossPollinationService.generateWeeklyCuration();
      expect(curation).not.toBeNull();
      expect(curation!.type).toBe("suggestion");
      expect(curation!.title).toBe("Your Week in Review");
      expect(curation!.relatedIds).toEqual([]);
      expect(curation!.isRead).toBe(false);
    });

    it("returns null if AI fails", async () => {
      mockGenerateText.mockRejectedValue(new Error("API error"));
      const curation = await crossPollinationService.generateWeeklyCuration();
      expect(curation).toBeNull();
    });

    it("routes weekly curation to a local provider only (isPrivate: true)", async () => {
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify({
          title: "Your Week in Review",
          content: "Local themes.",
        }),
        provider: "webllm",
      });

      await crossPollinationService.generateWeeklyCuration();

      expect(mockGenerateText).toHaveBeenCalledTimes(1);
      const opts = mockGenerateText.mock.calls[0]![2] as Record<string, unknown>;
      // Titles of the user's saved items go to the LLM; only local providers
      // may see them without an explicit per-prompt cloud opt-in.
      expect(opts.isPrivate).toBe(true);
    });

    it("deduplicates simultaneous weekly curations", async () => {
      let resolveGeneration!: (response: { text: string; provider: string }) => void;
      mockGenerateText.mockReturnValue(
        new Promise((resolve) => {
          resolveGeneration = resolve;
        }),
      );

      const first = crossPollinationService.generateWeeklyCuration("en");
      const second = crossPollinationService.generateWeeklyCuration("en");
      await vi.waitFor(() => expect(mockGenerateText).toHaveBeenCalledTimes(1));
      resolveGeneration({
        text: JSON.stringify({ title: "shared", content: "shared" }),
        provider: "gemini",
      });

      await expect(Promise.all([first, second])).resolves.toHaveLength(2);
      expect(mockGenerateText).toHaveBeenCalledTimes(1);
      expect(mockDb.insights.upsert).toHaveBeenCalledTimes(1);
    });

    it("propagates the signal to the model during curation", async () => {
      const controller = new AbortController();
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify({ title: "T", content: "C" }),
        provider: "gemini",
      });

      await crossPollinationService.generateWeeklyCuration(
        "en",
        controller.signal,
      );

      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    });

    it("rejects an aborted curation before querying the DB", async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(
        crossPollinationService.generateWeeklyCuration("en", controller.signal),
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(initDB).not.toHaveBeenCalled();
    });

    it("filters by selector createdAt >= 7 days ago", async () => {
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify({ title: "T", content: "C" }),
        provider: "gemini",
      });

      await crossPollinationService.generateWeeklyCuration();
      expect(mockDb.documents.find).toHaveBeenCalledWith(
        expect.objectContaining({
          selector: expect.objectContaining({
            createdAt: expect.objectContaining({ $gte: expect.any(String) }),
          }),
        }),
      );
    });

    it("returns null if the AI response is not valid JSON", async () => {
      mockGenerateText.mockResolvedValue({
        text: "not-json-at-all",
        provider: "gemini",
      });
      const curation = await crossPollinationService.generateWeeklyCuration();
      expect(curation).toBeNull();
    });

    it("uses the default title if the JSON has no title", async () => {
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify({ content: "Solo contenido" }),
        provider: "gemini",
      });
      const curation = await crossPollinationService.generateWeeklyCuration();
      expect(curation!.title).toBe("Your Week in Review");
    });

    it("uses empty content if insight is not a valid string", async () => {
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify({ title: "T" }),
        provider: "gemini",
      });
      const curation = await crossPollinationService.generateWeeklyCuration();
      expect(curation!.content).toBe("");
    });

    // English-only prompt contract, same as generateInsights above.
    it("keeps the English prompt even when lang=es", async () => {
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify({ title: "T", content: "C" }),
        provider: "gemini",
      });
      await crossPollinationService.generateWeeklyCuration("es");
      expect(mockGenerateText.mock.calls[0]![1]).toContain(
        "Expert Knowledge Curator",
      );
    });

    it("falls back to the in-memory array if the upsert fails", async () => {
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify({ title: "T", content: "C" }),
        provider: "gemini",
      });
      mockDb.insights.upsert = vi.fn().mockRejectedValue(
        new Error("write denied"),
      );
      const curation = await crossPollinationService.generateWeeklyCuration();
      expect(curation).not.toBeNull();
      // In-memory fallback is observable through getPersistedInsights once
      // the DB read also fails
      (initDB as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("read denied"),
      );
      const persisted = await crossPollinationService.getPersistedInsights();
      expect(persisted).toHaveLength(1);
    });
  });

  describe("getPersistedInsights", () => {
    it("reads sorted and limited insights from the DB", async () => {
      const insightDocs = [
        {
          id: "i1",
          toJSON: () => ({
            id: "i1",
            type: "connection",
            title: "T",
            content: "C",
            relatedIds: [],
            createdAt: "2026-01-01",
            isRead: false,
          }),
        },
      ];
      const sort = vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          exec: vi.fn().mockResolvedValue(insightDocs),
        }),
      });
      mockDb.insights.find = vi.fn().mockReturnValue({ sort });
      const insights = await crossPollinationService.getPersistedInsights();
      expect(insights).toHaveLength(1);
      expect(insights[0]).toMatchObject({ id: "i1", title: "T" });
      expect(mockDb.insights.find).toHaveBeenCalled();
      expect(sort).toHaveBeenCalledWith({ createdAt: "desc" });
    });

    it("falls back to local memory if the DB fails", async () => {
      (initDB as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("db down"),
      );
      const insights = await crossPollinationService.getPersistedInsights();
      expect(insights).toEqual([]);
    });
  });

  describe("markInsightAsRead", () => {
    it("marks the doc as read in the DB", async () => {
      const doc = { incrementalPatch: vi.fn().mockResolvedValue(undefined) };
      mockDb.insights.findOne = vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue(doc),
      });
      await crossPollinationService.markInsightAsRead("i1");
      expect(doc.incrementalPatch).toHaveBeenCalledWith({ isRead: true });
    });

    it("rejects before starting the write if the signal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(
        crossPollinationService.markInsightAsRead("i1", controller.signal),
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(initDB).not.toHaveBeenCalled();
    });

    it("does not update the local fallback if aborted during the patch", async () => {
      const controller = new AbortController();
      const localInsight = {
        id: "i1",
        type: "suggestion" as const,
        title: "T",
        content: "C",
        relatedIds: [],
        createdAt: "2026-01-01",
        isRead: false,
      };
      (crossPollinationService as any).insights = [localInsight];
      let resolvePatch!: () => void;
      const doc = {
        incrementalPatch: vi.fn().mockReturnValue(
          new Promise<void>((resolve) => {
            resolvePatch = resolve;
          }),
        ),
      };
      mockDb.insights.findOne = vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue(doc),
      });

      const request = crossPollinationService.markInsightAsRead(
        "i1",
        controller.signal,
      );
      await vi.waitFor(() => expect(doc.incrementalPatch).toHaveBeenCalled());
      controller.abort();
      resolvePatch();

      await expect(request).rejects.toMatchObject({ name: "AbortError" });
      expect(localInsight.isRead).toBe(false);
    });

    it("no lanza si el doc no existe", async () => {
      mockDb.insights.findOne = vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue(null),
      });
      await expect(
        crossPollinationService.markInsightAsRead("missing"),
      ).resolves.toBeUndefined();
    });

    it("does not throw if the DB fails", async () => {
      (initDB as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("db down"),
      );
      await expect(
        crossPollinationService.markInsightAsRead("i1"),
      ).resolves.toBeUndefined();
    });
  });

  describe("hasDigestDue / tryRunDigest", () => {
    it("hasDigestDue is true if never generated", async () => {
      mockSafeGet.mockReturnValue(null);
      expect(await crossPollinationService.hasDigestDue()).toBe(true);
    });

    it("hasDigestDue is true if the timestamp is not numeric", async () => {
      mockSafeGet.mockReturnValue("not-a-number");
      expect(await crossPollinationService.hasDigestDue()).toBe(true);
    });

    it("hasDigestDue is false if the digest is recent", async () => {
      mockSafeGet.mockReturnValue(String(Date.now()));
      expect(await crossPollinationService.hasDigestDue()).toBe(false);
    });

    it("tryRunDigest does not generate when not due", async () => {
      mockSafeGet.mockReturnValue(String(Date.now()));
      const result = await crossPollinationService.tryRunDigest();
      expect(result).toBeNull();
      expect(mockSafeSet).not.toHaveBeenCalled();
    });

    it("tryRunDigest generates and persists the timestamp", async () => {
      mockSafeGet.mockReturnValue("0");
      mockDb.documents.find = vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue(mockDocs),
      } as any);
      mockDb.bookmarks.find = vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue(mockBookmarks),
      } as any);
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify({ title: "T", content: "C" }),
        provider: "gemini",
      });
      const result = await crossPollinationService.tryRunDigest();
      expect(result).not.toBeNull();
      expect(mockSafeSet).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
      );
    });
  });
});
