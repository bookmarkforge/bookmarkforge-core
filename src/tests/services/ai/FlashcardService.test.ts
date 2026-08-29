import { describe, it, expect, beforeEach, vi } from "vitest";

const mockGenerateText = vi.fn();

vi.mock("../../\.\./services/ai/ProviderManager", () => ({
  aiManager: {
    get generateText() {
      return mockGenerateText;
    },
  },
}));

vi.mock("../../../db/database", () => ({
  initDB: vi.fn(),
}));

vi.mock("../../../utils/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { initDB } = await import("../../../db/database");
const { FlashcardService } =
  await import("../../\.\./services/ai/FlashcardService");

function freshService(): InstanceType<typeof FlashcardService> {
  return new FlashcardService();
}

describe("FlashcardService", () => {
  let mockDb: { flashcards: { insert: ReturnType<typeof vi.fn> } };

  const mockCards = [
    { question: "¿Qué es IA?", answer: "Inteligencia Artificial" },
    { question: "¿Qué es ML?", answer: "Machine Learning" },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateText.mockReset();
    mockDb = {
      flashcards: {
        insert: vi.fn().mockResolvedValue({}),
      },
    };
    (initDB as ReturnType<typeof vi.fn>).mockResolvedValue(mockDb);
  });

  describe("generateFlashcards", () => {
    let service: InstanceType<typeof FlashcardService>;

    beforeEach(() => {
      service = freshService();
    });

    it("returns 0 if text is < 100 chars", async () => {
      const count = await service.generateFlashcards("doc-1", "short");
      expect(count).toBe(0);
    });

    it("returns 0 when the text is empty", async () => {
      const count = await service.generateFlashcards("doc-1", "");
      expect(count).toBe(0);
    });

    it("generates flashcards from AI and saves them to DB", async () => {
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify(mockCards),
        provider: "gemini",
      });
      const count = await service.generateFlashcards(
        "doc-1",
        "Texto largo sobre inteligencia artificial ".repeat(10),
      );
      expect(count).toBe(2);
      expect(mockDb.flashcards.insert).toHaveBeenCalledTimes(2);
    });

    it("returns 0 if AI fails", async () => {
      mockGenerateText.mockRejectedValue(new Error("API error"));
      const count = await service.generateFlashcards(
        "doc-1",
        "Texto largo AI falla ".repeat(15),
      );
      expect(count).toBe(0);
    });

    it("returns 0 if DB insert fails", async () => {
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify(mockCards),
        provider: "gemini",
      });
      mockDb.flashcards.insert.mockRejectedValue(new Error("DB error"));
      const count = await service.generateFlashcards(
        "doc-1",
        "Texto largo DB error ".repeat(15),
      );
      expect(count).toBe(0);
    });

    it("returns 0 if AI response is not an array", async () => {
      mockGenerateText.mockResolvedValue({
        text: '{"not":"array"}',
        provider: "gemini",
      });
      const count = await service.generateFlashcards(
        "doc-1",
        "Texto largo not array ".repeat(15),
      );
      expect(count).toBe(0);
    });

    it("handles responses wrapped in markdown fences (audit #4)", async () => {
      mockGenerateText.mockResolvedValue({
        text: "```json\n" + JSON.stringify(mockCards) + "\n```",
        provider: "gemini",
      });
      const count = await service.generateFlashcards(
        "doc-1",
        "Texto largo fences ".repeat(10),
      );
      expect(count).toBe(2);
      expect(mockDb.flashcards.insert).toHaveBeenCalledTimes(2);
    });

    it("uses the Spanish prompt when lang=es", async () => {
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify([{ question: "Q", answer: "A" }]),
        provider: "gemini",
      });
      await service.generateFlashcards(
        "doc-1",
        "Texto largo español ".repeat(10),
        "es",
      );
      expect(mockGenerateText).toHaveBeenCalled();
      const callPrompt = mockGenerateText.mock.calls[0]![0];
      const callSystem = mockGenerateText.mock.calls[0]![1];
      expect(callPrompt).toContain("Text:");
      expect(callSystem).toContain("tarjetas de estudio");
    });

    it("uses the English prompt by default", async () => {
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify([{ question: "Q", answer: "A" }]),
        provider: "gemini",
      });
      await service.generateFlashcards(
        "doc-1",
        "Texto largo ingles ".repeat(10),
      );
      expect(mockGenerateText).toHaveBeenCalled();
      const callPrompt = mockGenerateText.mock.calls[0]![0];
      const callSystem = mockGenerateText.mock.calls[0]![1];
      expect(callPrompt).toContain("Text:");
      expect(callSystem).toContain("study flashcards");
    });

    it("uses cache: the same call does not call AI twice", async () => {
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify([{ question: "Q", answer: "A" }]),
        provider: "gemini",
      });
      const text = "Texto largo cache test ".repeat(10);
      const s1 = freshService();
      await s1.generateFlashcards("doc-1", text, "en", false);
      // Same text, different service instance — shared cache should hit
      const s2 = freshService();
      await s2.generateFlashcards("doc-2", text, "en", false);
      expect(mockGenerateText).toHaveBeenCalledTimes(1);
    });

    it("filters malformed cards (empty question, empty answer, null)", async () => {
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify([
          { question: "Q1", answer: "A1" },
          { question: "", answer: "A2" },
          { question: "Q3", answer: "" },
          null,
          { notQuestion: "x", notAnswer: "y" },
          { question: "  ", answer: "A6" },
          { question: "Q7", answer: "  " },
        ]),
        provider: "gemini",
      });
      const count = await service.generateFlashcards(
        "doc-1",
        "Texto largo malformed ".repeat(10),
      );
      expect(count).toBe(1); // only Q1/A1
      expect(mockDb.flashcards.insert).toHaveBeenCalledTimes(1);
    });

    it("returns 0 when all cards are malformed", async () => {
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify([
          { question: "", answer: "" },
          { question: "", answer: "" },
        ]),
        provider: "gemini",
      });
      const count = await service.generateFlashcards(
        "doc-1",
        "Texto largo all bad ".repeat(10),
      );
      expect(count).toBe(0);
    });

    it("pasa isPrivate=true a aiManager", async () => {
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify(mockCards),
        provider: "gemini",
      });
      await service.generateFlashcards(
        "doc-1",
        "Texto largo privado ".repeat(10),
        "en",
        true,
      );
      expect(mockGenerateText).toHaveBeenCalled();
      const callOpts = mockGenerateText.mock.calls[0]![2];
      expect(callOpts.isPrivate).toBe(true);
    });

    it("pasa isPrivate=true por defecto", async () => {
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify(mockCards),
        provider: "gemini",
      });
      await service.generateFlashcards(
        "doc-1",
        "Texto largo no privado ".repeat(10),
      );
      expect(mockGenerateText).toHaveBeenCalled();
      const callOpts = mockGenerateText.mock.calls[0]![2];
      expect(callOpts.isPrivate).toBe(true);
    });
  });

  describe("privacy: isPrivate never touches flashcardCache", () => {
    // NOTE: flashcardCache is module-level and is NOT cleared in beforeEach.
    // The test texts in this describe must be unique across the whole
    // file to avoid cache pollution between tests.
    let service: InstanceType<typeof FlashcardService>;

    beforeEach(() => {
      service = freshService();
    });

    it("generateFlashcards: NO almacena resultados de peticiones privadas", async () => {
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify([{ question: "Q", answer: "A" }]),
        provider: "gemini",
      });
      const text = "Texto largo confidencial 555 ".repeat(10);
      // Private request → must not write to flashcardCache.
      await service.generateFlashcards("doc-1", text, "en", true);
      // Same text, NON-private request → does not find the cached result
      // private in the cache and calls AI again.
      await service.generateFlashcards("doc-2", text, "en", false);
      expect(mockGenerateText).toHaveBeenCalledTimes(2);
    });

    it("generateFlashcards: does NOT read from cache on private requests", async () => {
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify([{ question: "Q", answer: "A" }]),
        provider: "gemini",
      });
      const text = "Texto largo compartido 666 ".repeat(10);
      // NON-private request → writes to flashcardCache.
      await service.generateFlashcards("doc-1", text, "en", false);
      // Private request with the same text → must not be served from cache.
      await service.generateFlashcards("doc-2", text, "en", true);
      expect(mockGenerateText).toHaveBeenCalledTimes(2);
    });

    it("generateFromBookmark: NO almacena resultados de peticiones privadas", async () => {
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify([{ question: "Q", answer: "A" }]),
        provider: "gemini",
      });
      const content = "Contenido confidencial 777 ".repeat(10);
      await service.generateFromBookmark("bm-1", "Título", content, "en", true);
      await service.generateFromBookmark("bm-2", "Título", content, "en", false);
      expect(mockGenerateText).toHaveBeenCalledTimes(2);
    });

    it("generateFromBookmark: does NOT read from cache on private requests", async () => {
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify([{ question: "Q", answer: "A" }]),
        provider: "gemini",
      });
      const content = "Contenido compartido 888 ".repeat(10);
      await service.generateFromBookmark("bm-1", "Título", content, "en", false);
      await service.generateFromBookmark("bm-2", "Título", content, "en", true);
      expect(mockGenerateText).toHaveBeenCalledTimes(2);
    });
  });

  describe("calculateNextReview (SM-2 Algorithm)", () => {
    const service = freshService();

    it("returns interval=1 for the first repetition with quality >= 3", () => {
      const result = service.calculateNextReview(3, 0, 2.5, 0);
      expect(result.interval).toBe(1);
      expect(result.repetition).toBe(1);
    });

    it("returns interval=6 for the second repetition with quality >= 3", () => {
      const result = service.calculateNextReview(4, 1, 2.5, 1);
      expect(result.interval).toBe(6);
      expect(result.repetition).toBe(2);
    });

    it("multiplica interval por easeFactor para repeticiones >= 3", () => {
      const result = service.calculateNextReview(4, 10, 2.5, 2);
      expect(result.interval).toBe(25);
      expect(result.repetition).toBe(3);
    });

    it("resets to interval=1 if quality < 3", () => {
      const result = service.calculateNextReview(2, 10, 2.5, 3);
      expect(result.interval).toBe(1);
      expect(result.repetition).toBe(0);
    });

    it("the minimum easeFactor is 1.3", () => {
      const result = service.calculateNextReview(0, 1, 1.3, 0);
      expect(result.easeFactor).toBe(1.3);
    });

    it("easeFactor updates correctly for quality=5", () => {
      const result = service.calculateNextReview(5, 1, 2.5, 0);
      expect(result.easeFactor).toBeGreaterThan(2.5);
    });

    it("easeFactor decreases for low quality but >= 3", () => {
      const result = service.calculateNextReview(3, 1, 2.5, 0);
      expect(result.easeFactor).toBeLessThan(2.5);
    });

    it("nextReview is a valid future ISO date", () => {
      const result = service.calculateNextReview(4, 1, 2.5, 0);
      expect(() => new Date(result.nextReview)).not.toThrow();
      expect(new Date(result.nextReview) > new Date("2020-01-01")).toBe(true);
    });
  });

  describe("generateFromBookmark", () => {
    let service: InstanceType<typeof FlashcardService>;

    beforeEach(() => {
      service = freshService();
    });

    it("returns 0 if content and title are < 100 chars", async () => {
      const count = await service.generateFromBookmark(
        "bm-1",
        "Short title",
        "short",
      );
      expect(count).toBe(0);
    });

    it("uses the title when content is empty", async () => {
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify([{ question: "Q", answer: "A" }]),
        provider: "gemini",
      });
      const count = await service.generateFromBookmark(
        "bm-1",
        "Título largo ".repeat(15),
        "",
      );
      expect(count).toBe(1);
      expect(mockGenerateText).toHaveBeenCalled();
      const callPrompt = mockGenerateText.mock.calls[0]![0];
      // generateFromBookmark constructs: Title: "$title".\nContent: "$text"
      expect(callPrompt).toContain('Title: "');
      expect(callPrompt).toContain('Título largo');
    });

    it("generates flashcards from AI and saves to DB with sourceType=bookmark", async () => {
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify(mockCards),
        provider: "gemini",
      });
      const count = await service.generateFromBookmark(
        "bm-1",
        "Título",
        "Contenido largo ".repeat(15),
      );
      expect(count).toBe(2);
      expect(mockDb.flashcards.insert).toHaveBeenCalledTimes(2);
      expect(mockDb.flashcards.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          documentId: "bm-1",
          sourceType: "bookmark",
        }),
      );
    });

    it("rolls back a partial bulk insert so no orphan cards remain", async () => {
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify(mockCards),
        provider: "gemini",
      });
      const remove = vi.fn().mockResolvedValue(undefined);
      const bulkInsert = vi.fn().mockImplementation(
        async (documents: Array<{ id: string }>) => ({
          success: [{ id: documents[0]!.id }],
          error: [new Error("one card failed")],
        }),
      );
      let lookupCount = 0;
      const findOne = vi.fn().mockImplementation(() => ({
        exec: vi.fn().mockImplementation(async () => {
          lookupCount += 1;
          return lookupCount <= 2 ? null : { remove };
        }),
      }));
      Object.assign(mockDb.flashcards, { bulkInsert, findOne });

      const count = await service.generateFromBookmark(
        "bm-rollback",
        "Título",
        "Contenido largo rollback ".repeat(10),
      );

      expect(count).toBe(0);
      expect(bulkInsert).toHaveBeenCalledTimes(1);
      expect(remove).toHaveBeenCalledTimes(1);
    });

    it("does not duplicate an already-persisted set for the same content", async () => {
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify(mockCards),
        provider: "gemini",
      });
      const bulkInsert = vi.fn();
      const findOne = vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue({ id: "already-generated" }),
      });
      Object.assign(mockDb.flashcards, { bulkInsert, findOne });

      const count = await service.generateFromBookmark(
        "bm-idempotent",
        "Título",
        "Contenido largo idempotente ".repeat(10),
      );

      expect(count).toBe(0);
      expect(bulkInsert).not.toHaveBeenCalled();
    });

    it("serializes concurrent inserts of the same deterministic batch", async () => {
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify(mockCards),
        provider: "gemini",
      });
      let resolveBulk!: (value: unknown) => void;
      const bulkInsert = vi.fn().mockReturnValue(
        new Promise((resolve) => { resolveBulk = resolve; }),
      );
      Object.assign(mockDb.flashcards, { bulkInsert });
      const content = "Contenido largo concurrencia persistente ".repeat(10);

      const firstRequest = service.generateFromBookmark(
        "bm-concurrent-batch",
        "Título",
        content,
      );
      const secondRequest = service.generateFromBookmark(
        "bm-concurrent-batch",
        "Título",
        content,
      );

      await vi.waitFor(() => expect(bulkInsert).toHaveBeenCalledTimes(1));
      resolveBulk!(undefined);
      await expect(Promise.all([firstRequest, secondRequest])).resolves.toEqual([
        2,
        2,
      ]);
      expect(bulkInsert).toHaveBeenCalledTimes(1);
    });

    it("a cancelled request does not inherit the shared batch result", async () => {
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify(mockCards),
        provider: "gemini",
      });
      let resolveBulk!: (value: unknown) => void;
      const bulkInsert = vi.fn().mockReturnValue(
        new Promise((resolve) => { resolveBulk = resolve; }),
      );
      Object.assign(mockDb.flashcards, { bulkInsert });
      const controller = new AbortController();
      const content = "Contenido largo lote cancelado ".repeat(10);

      const firstRequest = service.generateFromBookmark(
        "bm-cancel-shared",
        "Título",
        content,
      );
      const cancelledRequest = service.generateFromBookmark(
        "bm-cancel-shared",
        "Título",
        content,
        "en",
        false,
        controller.signal,
      );

      await vi.waitFor(() => expect(bulkInsert).toHaveBeenCalledTimes(1));
      controller.abort();
      resolveBulk!(undefined);

      await expect(firstRequest).resolves.toBe(2);
      await expect(cancelledRequest).resolves.toBe(0);
      expect(bulkInsert).toHaveBeenCalledTimes(1);
    });

    it("cancels the inference and avoids inserting stale cards", async () => {
      let resolveAI!: (value: { text: string }) => void;
      mockGenerateText.mockReturnValue(
        new Promise((resolve) => { resolveAI = resolve; }),
      );
      const controller = new AbortController();
      const request = service.generateFromBookmark(
        "bm-cancel",
        "Título",
        "Contenido largo cancelable ".repeat(10),
        "en",
        false,
        controller.signal,
      );

      await vi.waitFor(() => expect(mockGenerateText).toHaveBeenCalled());
      expect(mockGenerateText.mock.calls[0]![2].signal).toBe(controller.signal);
      controller.abort();
      resolveAI({ text: JSON.stringify(mockCards) });

      await expect(request).resolves.toBe(0);
      expect(mockDb.flashcards.insert).not.toHaveBeenCalled();
    });

    it("returns 0 if AI fails", async () => {
      mockGenerateText.mockRejectedValue(new Error("API error"));
      const count = await service.generateFromBookmark(
        "bm-1",
        "Título",
        "Contenido largo AI falla ".repeat(10),
      );
      expect(count).toBe(0);
    });

    it("returns 0 if AI response is not an array", async () => {
      mockGenerateText.mockResolvedValue({
        text: '{"not":"array"}',
        provider: "gemini",
      });
      const count = await service.generateFromBookmark(
        "bm-1",
        "Título",
        "Contenido largo not array ".repeat(10),
      );
      expect(count).toBe(0);
    });

    it("returns 0 if DB insert fails", async () => {
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify(mockCards),
        provider: "gemini",
      });
      mockDb.flashcards.insert.mockRejectedValue(new Error("DB error"));
      const count = await service.generateFromBookmark(
        "bm-1",
        "Título",
        "Contenido largo db fail ".repeat(10),
      );
      expect(count).toBe(0);
    });

    it("uses the Spanish prompt when lang=es", async () => {
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify([{ question: "Q", answer: "A" }]),
        provider: "gemini",
      });
      await service.generateFromBookmark(
        "bm-1",
        "Título",
        "Contenido largo ".repeat(10),
        "es",
      );
      const callSystem = mockGenerateText.mock.calls[0]![1];
      expect(callSystem).toContain("flashcards");
    });

    it("uses cache: the same text does not call AI twice", async () => {
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify([{ question: "Q", answer: "A" }]),
        provider: "gemini",
      });
      const content = "Contenido largo cache ".repeat(10);
      const s1 = freshService();
      await s1.generateFromBookmark("bm-1", "T", content, "en", false);
      const s2 = freshService();
      await s2.generateFromBookmark("bm-2", "T", content, "en", false);
      expect(mockGenerateText).toHaveBeenCalledTimes(1);
    });

    it("shares concurrent non-private inference before filling the cache", async () => {
      let resolveAI!: (value: { text: string }) => void;
      mockGenerateText.mockReturnValue(
        new Promise((resolve) => { resolveAI = resolve; }),
      );
      const content = "Contenido largo inferencia concurrente ".repeat(10);
      const firstRequest = service.generateFromBookmark(
        "bm-inference-1",
        "Título compartido",
        content,
        "en",
        false,
      );
      const secondRequest = service.generateFromBookmark(
        "bm-inference-2",
        "Título compartido",
        content,
        "en",
        false,
      );

      await vi.waitFor(() => expect(mockGenerateText).toHaveBeenCalledTimes(1));
      resolveAI({
        text: JSON.stringify([{ question: "Q", answer: "A" }]),
      });

      await expect(Promise.all([firstRequest, secondRequest])).resolves.toEqual([
        1,
        1,
      ]);
      expect(mockGenerateText).toHaveBeenCalledTimes(1);
    });

    it("libera inferencias compartidas que quedan pendientes", async () => {
      vi.useFakeTimers();
      try {
        mockGenerateText.mockReturnValue(new Promise(() => {}));
        const content = "Contenido largo inferencia atascada ".repeat(10);
        const request = service.generateFromBookmark(
          "bm-inference-timeout",
          "Título",
          content,
          "en",
          false,
        );
        await Promise.resolve();
        await Promise.resolve();
        expect(mockGenerateText).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(60_000);
        await expect(request).resolves.toBe(0);
        expect(mockGenerateText.mock.calls[0]![2].signal.aborted).toBe(true);

        mockGenerateText.mockResolvedValue({
          text: JSON.stringify([{ question: "Q", answer: "A" }]),
          provider: "gemini",
        });
        await expect(
          service.generateFromBookmark("bm-inference-timeout", "Título", content, "en", false),
        ).resolves.toBe(1);
        expect(mockGenerateText).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("deduplicateHistoricalCards", () => {
    let service: InstanceType<typeof FlashcardService>;

    beforeEach(() => {
      service = freshService();
    });

    it("keeps the most advanced progress and removes only exact duplicates", async () => {
      const removeOlder = vi.fn().mockResolvedValue(undefined);
      const removeNewer = vi.fn().mockResolvedValue(undefined);
      const progressed = {
        id: "fc-progressed",
        documentId: "doc-dedup",
        sourceType: "document" as const,
        question: " What is AI? ",
        answer: "Artificial intelligence",
        repetition: 4,
        interval: 10,
        easeFactor: 2.4,
        nextReview: "2030-01-01T00:00:00.000Z",
        createdAt: "2025-01-01T00:00:00.000Z",
        remove: removeNewer,
      };
      const historical = {
        ...progressed,
        id: "fc-historical",
        question: "what is ai?",
        answer: "Artificial  intelligence",
        repetition: 1,
        interval: 1,
        remove: removeOlder,
      };
      const unrelated = {
        ...progressed,
        id: "fc-unrelated",
        question: "What is ML?",
        remove: vi.fn(),
      };
      const find = vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue([progressed, historical, unrelated]),
      });
      Object.assign(mockDb.flashcards, { find });

      const report = await service.deduplicateHistoricalCards();

      expect(report).toEqual({
        scanned: 3,
        duplicateGroups: 1,
        preserved: 1,
        plannedRemovals: 1,
        removed: 1,
        failed: 0,
      });
      expect(removeOlder).toHaveBeenCalledTimes(1);
      expect(removeNewer).not.toHaveBeenCalled();
      expect(unrelated.remove).not.toHaveBeenCalled();
    });

    it("does not group cards from different sources and reports deletion failures", async () => {
      const remove = vi.fn().mockRejectedValue(new Error("remove failed"));
      const first = {
        id: "fc-a",
        documentId: "same-id",
        sourceType: "bookmark" as const,
        question: "Question",
        answer: "Answer",
        repetition: 1,
        interval: 1,
        createdAt: "2025-01-01T00:00:00.000Z",
        remove: vi.fn().mockResolvedValue(undefined),
      };
      const duplicate = {
        ...first,
        id: "fc-b",
        repetition: 0,
        remove,
      };
      const differentOrigin = {
        ...first,
        id: "fc-c",
        sourceType: "document" as const,
      };
      const find = vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue([first, duplicate, differentOrigin]),
      });
      Object.assign(mockDb.flashcards, { find });

      const report = await service.deduplicateHistoricalCards();

      expect(report).toEqual({
        scanned: 3,
        duplicateGroups: 1,
        preserved: 1,
        plannedRemovals: 1,
        removed: 0,
        failed: 1,
      });
      expect(remove).toHaveBeenCalledTimes(1);
    });

    it("preview no borra y reporta las eliminaciones planificadas", async () => {
      const remove = vi.fn().mockResolvedValue(undefined);
      const first = {
        id: "fc-preview-a",
        documentId: "preview-doc",
        sourceType: "document" as const,
        question: "Question",
        answer: "Answer",
        repetition: 2,
        interval: 3,
        remove,
      };
      const second = { ...first, id: "fc-preview-b", repetition: 0 };
      const find = vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue([first, second]),
      });
      Object.assign(mockDb.flashcards, { find });

      const report = await service.deduplicateHistoricalCards({ dryRun: true });

      expect(report).toEqual({
        scanned: 2,
        duplicateGroups: 1,
        preserved: 1,
        plannedRemovals: 1,
        removed: 0,
        failed: 0,
      });
      expect(remove).not.toHaveBeenCalled();
    });

    it("shares a single cleanup when invoked concurrently", async () => {
      let resolveFind!: (cards: unknown[]) => void;
      const find = vi.fn().mockReturnValue({
        exec: () => new Promise((resolve) => { resolveFind = resolve; }),
      });
      Object.assign(mockDb.flashcards, { find });

      const firstRequest = service.deduplicateHistoricalCards();
      const secondRequest = freshService().deduplicateHistoricalCards();
      await vi.waitFor(() => expect(find).toHaveBeenCalledTimes(1));
      resolveFind!([]);

      const [firstReport, secondReport] = await Promise.all([
        firstRequest,
        secondRequest,
      ]);
      expect(firstReport).toEqual(secondReport);
      expect(find).toHaveBeenCalledTimes(1);
    });
  });

  describe("getStats", () => {
    let mockFind: ReturnType<typeof vi.fn>;
    let service: InstanceType<typeof FlashcardService>;

    beforeEach(() => {
      service = freshService();
      mockFind = vi.fn().mockResolvedValue([]);
      (initDB as ReturnType<typeof vi.fn>).mockResolvedValue({
        flashcards: { find: mockFind, insert: vi.fn() },
      });
    });

    it("returns correct counts with mixed cards", async () => {
      const now = new Date();
      const pastDate = new Date(now.getTime() - 86400000).toISOString();
      const futureDate = new Date(now.getTime() + 86400000).toISOString();

      mockFind.mockReturnValue({
        exec: vi.fn().mockResolvedValue([
          { sourceType: "document", nextReview: pastDate },
          { sourceType: "document", nextReview: futureDate },
          { sourceType: "bookmark", nextReview: pastDate },
        ]),
      });

      const stats = await service.getStats();
      expect(stats.total).toBe(3);
      expect(stats.due).toBe(2);
      expect(stats.bySource).toEqual({ documents: 2, bookmarks: 1 });
    });

    it("returns zeros if DB fails", async () => {
      mockFind.mockReturnValue({
        exec: vi.fn().mockRejectedValue(new Error("DB down")),
      });

      const stats = await service.getStats();
      expect(stats).toEqual({
        total: 0,
        due: 0,
        bySource: { documents: 0, bookmarks: 0 },
      });
    });
  });
});
