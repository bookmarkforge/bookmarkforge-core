import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExecute = vi.fn();
const mockGetStats = vi.fn(() => ({ activeTasks: 0 }));

vi.mock("../../../utils/WorkerPool", () => ({
  getWorkerPool: vi.fn(() => ({
    execute: mockExecute,
    getStats: mockGetStats,
    terminate: vi.fn(),
  })),
}));

const mockSwitchToRAG = vi.fn();
vi.mock("../../\.\./services/ai/ResourceManager", () => ({
  resourceManager: { switchToRAG: mockSwitchToRAG },
}));

const mockLogger = { warn: vi.fn(), error: vi.fn() };
vi.mock("../../../utils/logger", () => ({ logger: mockLogger }));

const { ragEngine, onEmbeddingProgress } = await import(
  "../../\.\./services/ai/RAGEngine",
);

describe("RAGEngine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (ragEngine as any).embeddingCache.clear();
    (ragEngine as any).inFlightEmbeddings.clear();
  });

  describe("cosineSimilarity", () => {
    it("returns 1 for identical vectors", () => {
      const vec = [1, 2, 3];
      expect(ragEngine.cosineSimilarity(vec, vec)).toBeCloseTo(1, 10);
    });

    it("returns 0 for orthogonal vectors", () => {
      expect(ragEngine.cosineSimilarity([1, 0, 0], [0, 1, 0])).toBe(0);
    });

    it("returns 0 for vectors of different lengths", () => {
      expect(ragEngine.cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
    });

    it("returns 0 when a magnitude is 0", () => {
      expect(ragEngine.cosineSimilarity([0, 0], [1, 1])).toBe(0);
    });

    it("computes the correct similarity", () => {
      const a = [1, 2, 3];
      const b = [4, 5, 6];
      const sim = ragEngine.cosineSimilarity(a, b);
      expect(sim).toBeGreaterThan(0.97);
      expect(sim).toBeLessThan(0.99);
    });
  });

  describe("clusterItems", () => {
    it("asigna cluster 0 a items sin embedding", () => {
      const items = [
        { id: "a" },
        { id: "b", embedding: [] as number[] },
        { id: "c", embedding: [1, 2, 3] },
      ];
      const result = ragEngine.clusterItems(items, 0.8);
      expect(result.get("a")).toBe(0);
      expect(result.get("b")).toBe(0);
      expect(result.get("c")).not.toBe(0);
    });

    it("groups similar items into the same cluster", () => {
      const items = [
        { id: "a", embedding: [1, 0, 0] },
        { id: "b", embedding: [1, 0, 0] },
      ];
      const result = ragEngine.clusterItems(items, 0.8);
      const ids = [...result.values()].filter((v) => v !== 0);
      expect(new Set(ids).size).toBe(1);
    });

    it("assigns different clusters to dissimilar items", () => {
      const items = [
        { id: "a", embedding: [1, 0, 0] },
        { id: "b", embedding: [0, 1, 0] },
      ];
      const result = ragEngine.clusterItems(items, 0.8);
      expect(result.get("a")).not.toBe(0);
      expect(result.get("a")).not.toBe(result.get("b"));
    });

    it("returns empty Map for empty array", () => {
      expect(ragEngine.clusterItems([], 0.8).size).toBe(0);
    });

    it("respects the similarity threshold", () => {
      const items = [
        { id: "a", embedding: [1, 0, 0] },
        { id: "b", embedding: [0.5, 0.5, 0] },
      ];
      const low = ragEngine.clusterItems(items, 0.5);
      expect(low.get("a")).toBe(low.get("b"));
      const high = ragEngine.clusterItems(items, 0.9);
      expect(high.get("a")).not.toBe(high.get("b"));
    });
  });

  describe("generateEmbedding", () => {
    it("returns zero array for empty string", async () => {
      const result = await ragEngine.generateEmbedding("");
      expect(result).toHaveLength(384);
      expect(result.every((v) => v === 0)).toBe(true);
    });

    it("returns zero array for non-string input", async () => {
      const result = await ragEngine.generateEmbedding(null as any);
      expect(result).toHaveLength(384);
      expect(result.every((v) => v === 0)).toBe(true);
    });

    it("uses the worker pool to generate the embedding", async () => {
      mockExecute.mockResolvedValue([0.1, 0.2, 0.3]);
      const result = await ragEngine.generateEmbedding("test");
      expect(result).toEqual([0.1, 0.2, 0.3]);
      expect(mockExecute).toHaveBeenCalledWith(
        "embed",
        "test",
        undefined,
        expect.any(Function),
        undefined,
      );
    });

    it("deduplicates simultaneous non-abortable requests for the same text", async () => {
      let resolveEmbedding!: (embedding: number[]) => void;
      mockExecute.mockReturnValue(
        new Promise<number[]>((resolve) => {
          resolveEmbedding = resolve;
        }),
      );

      const first = ragEngine.generateEmbedding("same-text");
      const second = ragEngine.generateEmbedding("same-text");

      expect(mockExecute).toHaveBeenCalledTimes(1);
      resolveEmbedding([0.4, 0.5]);

      const [firstResult, secondResult] = await Promise.all([first, second]);
      expect(firstResult).toEqual([0.4, 0.5]);
      expect(secondResult).toEqual([0.4, 0.5]);
      expect(secondResult).not.toBe(firstResult);
    });

    it("keeps abortable requests independent", async () => {
      mockExecute.mockResolvedValue([0.6, 0.7]);
      const firstController = new AbortController();
      const secondController = new AbortController();

      await Promise.all([
        ragEngine.generateEmbedding("same-abortable-text", firstController.signal),
        ragEngine.generateEmbedding("same-abortable-text", secondController.signal),
      ]);

      expect(mockExecute).toHaveBeenCalledTimes(2);
    });

    it("invalidates pending results when the context changes", async () => {
      let resolveFirst!: (embedding: number[]) => void;
      let resolveSecond!: (embedding: number[]) => void;
      mockExecute
        .mockReturnValueOnce(
          new Promise<number[]>((resolve) => {
            resolveFirst = resolve;
          }),
        )
        .mockReturnValueOnce(
          new Promise<number[]>((resolve) => {
            resolveSecond = resolve;
          }),
        );

      const firstRequest = ragEngine.generateEmbedding("contextual-text");
      ragEngine.clearCache();
      const secondRequest = ragEngine.generateEmbedding("contextual-text");

      expect(mockExecute).toHaveBeenCalledTimes(2);
      resolveFirst([0.1, 0.2]);
      await expect(firstRequest).rejects.toThrow(
        "Embedding request invalidated by vault transition",
      );

      resolveSecond([0.8, 0.9]);
      await expect(secondRequest).resolves.toEqual([0.8, 0.9]);
    });

    it("returns isolated copies to avoid exposing the cached embedding", async () => {
      mockExecute.mockResolvedValue([0.5, 0.6]);
      const firstResult = await ragEngine.generateEmbedding("repeat");
      firstResult[0] = 99;
      mockExecute.mockClear();

      const cachedResult = await ragEngine.generateEmbedding("repeat");

      expect(cachedResult).toEqual([0.5, 0.6]);
      expect(cachedResult).not.toBe(firstResult);
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it("ignores progress listener errors without activating fallback", async () => {
      mockExecute.mockResolvedValue([0.7, 0.8]);
      const listener = vi.fn(() => {
        throw new Error("listener failed");
      });
      const unsubscribe = onEmbeddingProgress(listener);

      try {
        await expect(ragEngine.generateEmbedding("progress-safe")).resolves.toEqual([
          0.7,
          0.8,
        ]);
        expect(mockExecute).toHaveBeenCalledTimes(1);
        expect(mockLogger.warn).toHaveBeenCalledWith(
          "[RAGEngine] Embedding progress listener failed",
          { error: "listener failed" },
        );
      } finally {
        unsubscribe();
      }
    });

    it("falls back to the main thread if the worker fails", async () => {
      mockExecute.mockRejectedValue(new Error("worker crash"));
      const result = await ragEngine.generateEmbedding("fallback");
      expect(result).toHaveLength(384);
      expect(result.every((v) => v === 0)).toBe(true);
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });

  describe("searchSimilar", () => {
    it("rejects a search aborted before generating embeddings", async () => {
      const controller = new AbortController();
      controller.abort();
      await expect(
        ragEngine.searchSimilar("test", [], 10, controller.signal),
      ).rejects.toMatchObject({ name: "AbortError" });
    });

    it("returns bookmarks without filter for empty query respecting the limit", async () => {
      const bookmarks = [
        { id: "1", title: "A" },
        { id: "2", title: "B" },
        { id: "3", title: "C" },
      ] as Array<{ id: string; title: string; embedding?: number[] }>;
      const result = await ragEngine.searchSimilar("", bookmarks, 2);
      expect(result).toHaveLength(2);
      expect(result.map((bookmark) => bookmark.id)).toEqual(["1", "2"]);
    });

    it("does not generate embedding when the normalized limit is zero", async () => {
      mockExecute.mockResolvedValue([1, 0, 0]);
      const result = await ragEngine.searchSimilar(
        "test",
        [{ id: "1" }] as Array<{ id: string; embedding?: number[] }>,
        -1,
      );
      expect(result).toEqual([]);
      expect(mockExecute).not.toHaveBeenCalled();
    });

    it("sorts by descending similarity", async () => {
      mockExecute.mockResolvedValue([1, 0, 0]);
      const bookmarks = [
        { id: "low", embedding: [0, 1, 0] },
        { id: "high", embedding: [1, 0, 0] },
      ];
      const result = await ragEngine.searchSimilar("test", bookmarks, 10);
      expect(result[0]!.id).toBe("high");
      expect(result[1]!.id).toBe("low");
    });

    it("respects result limit", async () => {
      mockExecute.mockResolvedValue([1, 0, 0]);
      const bookmarks = [
        { id: "a", embedding: [1, 0, 0] },
        { id: "b", embedding: [0.9, 0.1, 0] },
        { id: "c", embedding: [0.8, 0.2, 0] },
      ];
      expect(await ragEngine.searchSimilar("test", bookmarks, 2)).toHaveLength(
        2,
      );
    });

    it("asigna similitud 0 a bookmarks sin embedding", async () => {
      mockExecute.mockResolvedValue([1, 0, 0]);
      const bookmarks = [{ id: "a", embedding: [1, 0, 0] }, { id: "b" }];
      const result = await ragEngine.searchSimilar("test", bookmarks, 10);
      expect(result.find((b) => b.id === "b")?.similarity).toBe(0);
    });
  });

  describe("init / unload / getStats", () => {
    it("init llama a resourceManager.switchToRAG", async () => {
      mockSwitchToRAG.mockResolvedValue(undefined);
      await ragEngine.init();
      expect(mockSwitchToRAG).toHaveBeenCalled();
    });

    it("shares the initialization promise between concurrent calls", async () => {
      let resolveSwitch!: () => void;
      mockSwitchToRAG.mockReturnValue(
        new Promise<void>((resolve) => {
          resolveSwitch = resolve;
        }),
      );

      const p1 = ragEngine.init();
      const p2 = ragEngine.init();
      let secondSettled = false;
      void p2.then(() => {
        secondSettled = true;
      });
      await Promise.resolve();

      expect(mockSwitchToRAG).toHaveBeenCalledTimes(1);
      expect(secondSettled).toBe(false);
      resolveSwitch();
      await Promise.all([p1, p2]);
      expect(secondSettled).toBe(true);
    });

    it("allows reinitializing after unload during init", async () => {
      let resolveFirstSwitch!: () => void;
      mockSwitchToRAG.mockReturnValueOnce(
        new Promise<void>((resolve) => {
          resolveFirstSwitch = resolve;
        }),
      );

      const firstInit = ragEngine.init();
      await Promise.resolve();
      await ragEngine.unload();

      mockSwitchToRAG.mockResolvedValue(undefined);
      const secondInit = ragEngine.init();
      expect(mockSwitchToRAG).toHaveBeenCalledTimes(2);

      resolveFirstSwitch();
      await Promise.all([firstInit, secondInit]);
    });

    it("unload clears the cache", async () => {
      mockExecute.mockResolvedValue([1, 2, 3]);
      await ragEngine.generateEmbedding("test");
      expect(ragEngine.getStats().cacheSize).toBe(1);
      await ragEngine.unload();
      expect(ragEngine.getStats().cacheSize).toBe(0);
    });

    it("getStats returns cacheSize and workerStats", () => {
      const stats = ragEngine.getStats();
      expect(stats).toHaveProperty("cacheSize");
      expect(stats).toHaveProperty("workerStats");
    });
  });
});
