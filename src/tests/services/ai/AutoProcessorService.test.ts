import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { Subject, take } from "rxjs";

vi.mock("../../../db/database", () => ({
  initDB: vi.fn(),
}));

vi.mock("../../\.\./services/ai/TaggingService", () => ({
  taggingService: {
    generateSummary: vi.fn(),
    suggestTags: vi.fn(),
    suggestFolder: vi.fn(),
  },
}));

vi.mock("../../\.\./services/ai/RAGEngine", () => ({
  ragEngine: {
    generateEmbedding: vi.fn(),
  },
}));

vi.mock("../../\.\./services/ai/VectorIndexService", () => ({
  vectorIndexService: {
    search: vi.fn(),
    batchAdd: vi.fn(),
    replace: vi.fn(),
    rebuild: vi.fn(),
  },
}));

vi.mock("../../\.\./services/ai/ChunkingService", () => ({
  ChunkingService: {
    splitText: vi.fn(),
  },
}));

vi.mock("../../\.\./services/ai/ProviderManager", () => ({
  aiManager: {
    getApiKey: vi.fn().mockReturnValue("sk-test-key"),
    getProviderInfo: vi.fn().mockReturnValue({
      provider: "openai",
      model: "gpt-4o-mini",
      fullSupport: true,
      name: "OpenAI",
      isConfigured: true,
    }),
  },
}));

vi.mock("../../../utils/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../../constants/config", () => ({
  AUTOPROCESSOR_CONFIG: {
    DEBOUNCE_MS: 50,
    CONCURRENCY_LIMIT: 2,
    CHUNK_SIZE: 1000,
    CHUNK_OVERLAP: 200,
    BATTERY_CRITICAL_THRESHOLD: 0.15,
    CHUNK_CONCURRENCY_LIMIT: 2,
  },
}));

const mockLocalStorage = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
})();
Object.defineProperty(globalThis, "localStorage", { value: mockLocalStorage });

const { initDB } = await import("../../../db/database");
const { taggingService } =
  await import("../../\.\./services/ai/TaggingService");
const { ragEngine } = await import("../../\.\./services/ai/RAGEngine");
const { ChunkingService } =
  await import("../../\.\./services/ai/ChunkingService");
const { vectorIndexService } =
  await import("../../\.\./services/ai/VectorIndexService");
const { aiManager } = await import("../../\.\./services/ai/ProviderManager");
const { autoProcessorService } =
  await import("../../\.\./services/ai/AutoProcessorService");
const { logger } = await import("../../../utils/logger");

type MockDb = {
  bookmarks: {
    find: ReturnType<typeof vi.fn>;
    bulkRemove: ReturnType<typeof vi.fn>;
  };
  documents: {
    find: ReturnType<typeof vi.fn>;
    bulkRemove: ReturnType<typeof vi.fn>;
  };
  folders: {
    find: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
  };
  chunks: {
    find: ReturnType<typeof vi.fn>;
    bulkRemove: ReturnType<typeof vi.fn>;
    bulkInsert: ReturnType<typeof vi.fn>;
  };
};

function createRxDoc(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: overrides.title || "Test Doc",
    content: overrides.content || "Test content",
    textContent: overrides.textContent || "Test text content",
    embedding: overrides.embedding ?? null,
    tags: overrides.tags || [],
    folderId: overrides.folderId || "root",
    processed: overrides.processed ?? false,
    isPrivate: overrides.isPrivate ?? false,
    updatedAt: overrides.updatedAt || new Date().toISOString(),
    incrementalPatch: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("AutoProcessorService", () => {
  let mockDb: MockDb;
  let bookmarkSubject: Subject<unknown>;
  let documentSubject: Subject<unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLocalStorage.clear();
    autoProcessorService.stop();
    bookmarkSubject = new Subject();
    documentSubject = new Subject();

    mockDb = {
      bookmarks: {
        find: vi.fn().mockReturnValue({
          $: bookmarkSubject,
          exec: vi.fn().mockResolvedValue([]),
        }),
        bulkRemove: vi.fn().mockResolvedValue(undefined),
      },
      documents: {
        find: vi.fn().mockReturnValue({
          $: documentSubject,
          exec: vi.fn().mockResolvedValue([]),
        }),
        bulkRemove: vi.fn().mockResolvedValue(undefined),
      },
      folders: {
        find: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue([]) }),
        insert: vi
          .fn()
          .mockResolvedValue({ id: "new-folder-id", title: "New Folder" }),
      },
      chunks: {
        find: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue([]) }),
        bulkRemove: vi.fn().mockResolvedValue(undefined),
        bulkInsert: vi.fn().mockResolvedValue(undefined),
      },
    };
    (initDB as ReturnType<typeof vi.fn>).mockResolvedValue(mockDb);
    (ragEngine.generateEmbedding as ReturnType<typeof vi.fn>).mockResolvedValue(
      [0.1, 0.2],
    );
    (
      taggingService.generateSummary as ReturnType<typeof vi.fn>
    ).mockResolvedValue("summary");
    (taggingService.suggestTags as ReturnType<typeof vi.fn>).mockResolvedValue([
      "tag1",
    ]);
    (
      taggingService.suggestFolder as ReturnType<typeof vi.fn>
    ).mockResolvedValue("General");
    (ChunkingService.splitText as ReturnType<typeof vi.fn>).mockReturnValue([
      "chunk1",
    ]);
    (vectorIndexService.search as ReturnType<typeof vi.fn>).mockResolvedValue({
      neighbors: [],
    });
    (vectorIndexService.batchAdd as ReturnType<typeof vi.fn>).mockResolvedValue(
      undefined,
    );
    (vectorIndexService.replace as ReturnType<typeof vi.fn>).mockResolvedValue(
      undefined,
    );
    (aiManager.getApiKey as ReturnType<typeof vi.fn>).mockReturnValue(
      "sk-test-key",
    );
    (aiManager.getProviderInfo as ReturnType<typeof vi.fn>).mockReturnValue({
      provider: "openai",
      model: "gpt-4o-mini",
      fullSupport: true,
      name: "OpenAI",
      isConfigured: true,
    });
  });

  afterEach(() => {
    autoProcessorService.stop();
  });

  describe("status$", () => {
    it("emits initial state with isProcessing=false", () =>
      new Promise<void>((resolve) => {
        autoProcessorService.status$.pipe(take(1)).subscribe((status) => {
          expect(status.isProcessing).toBe(false);
          expect(status.totalItems).toBe(0);
          expect(status.processedItems).toBe(0);
          resolve();
        });
      }));
  });

  describe("start()", () => {
    it("starts subscription and calls initDB", async () => {
      await autoProcessorService.start();
      expect(initDB).toHaveBeenCalledTimes(1);
    });

    it("does not start subscription twice (early return if this.subscription exists)", async () => {
      await autoProcessorService.start();
      await autoProcessorService.start();
      expect(initDB).toHaveBeenCalledTimes(1);
    });

    it("shares one pending start across concurrent consumers", async () => {
      await Promise.all([
        autoProcessorService.start(),
        autoProcessorService.start(),
      ]);

      expect(initDB).toHaveBeenCalledTimes(1);
      expect(mockDb.bookmarks.find).toHaveBeenCalledTimes(1);
      expect(mockDb.documents.find).toHaveBeenCalledTimes(1);
    });

    it("does not create a subscription after stop invalidates a pending start", async () => {
      let resolveInit!: (db: MockDb) => void;
      (initDB as ReturnType<typeof vi.fn>).mockReturnValueOnce(
        new Promise((resolve) => { resolveInit = resolve; }),
      );
      const pendingStart = autoProcessorService.start();
      await vi.waitFor(() => expect(initDB).toHaveBeenCalledTimes(1));

      autoProcessorService.stop();
      resolveInit!(mockDb);
      await pendingStart;

      expect(mockDb.bookmarks.find).not.toHaveBeenCalled();
      expect(mockDb.documents.find).not.toHaveBeenCalled();
    });

    it("restarts against the current lifecycle after stop/start during init", async () => {
      let resolveInit!: (db: MockDb) => void;
      (initDB as ReturnType<typeof vi.fn>).mockReturnValueOnce(
        new Promise((resolve) => { resolveInit = resolve; }),
      );
      (initDB as ReturnType<typeof vi.fn>).mockResolvedValue(mockDb);
      const firstStart = autoProcessorService.start();
      await vi.waitFor(() => expect(initDB).toHaveBeenCalledTimes(1));

      autoProcessorService.stop();
      const secondStart = autoProcessorService.start();
      resolveInit!(mockDb);
      await Promise.all([firstStart, secondStart]);

      expect(initDB).toHaveBeenCalledTimes(2);
      expect(mockDb.bookmarks.find).toHaveBeenCalledTimes(1);
      expect(mockDb.documents.find).toHaveBeenCalledTimes(1);
    });

    it("subscribes to bookmark and document collections", async () => {
      await autoProcessorService.start();
      expect(mockDb.bookmarks.find).toHaveBeenCalledWith({
        selector: { processed: { $ne: true } },
      });
      expect(mockDb.documents.find).toHaveBeenCalledWith({
        selector: { processed: { $ne: true } },
      });
    });

    it("logs items when bookmarks arrive", async () => {
      await autoProcessorService.start();
      bookmarkSubject.next([createRxDoc("bm-1", { title: "First Bookmark" })]);
      documentSubject.next([]);

      await vi.waitFor(() => {
        expect(logger.info).toHaveBeenCalledWith(
          "[AutoProcessor] Detected unprocessed items",
          expect.objectContaining({ bookmarks: 1, documents: 0 }),
        );
      });
    });

    it("logs first bookmark details when bookmarks exist", async () => {
      await autoProcessorService.start();
      const bm = createRxDoc("bm-1", {
        title: "First BM",
        processed: false,
        updatedAt: "2025-01-01",
      });
      bookmarkSubject.next([bm]);
      documentSubject.next([]);

      await vi.waitFor(() => {
        expect(logger.debug).toHaveBeenCalledWith(
          "[AutoProcessor] First bookmark",
          expect.objectContaining({ id: "bm-1", processed: false }),
        );
      });
    });

    it("logs first document details when documents exist", async () => {
      await autoProcessorService.start();
      const doc = createRxDoc("doc-1", {
        title: "First Doc",
        processed: false,
        updatedAt: "2025-01-01",
      });
      bookmarkSubject.next([]);
      documentSubject.next([doc]);

      await vi.waitFor(() => {
        expect(logger.debug).toHaveBeenCalledWith(
          "[AutoProcessor] First document",
          expect.objectContaining({ id: "doc-1", processed: false }),
        );
      });
    });

    it("does NOT log bookmark details when bookmarks is empty", async () => {
      await autoProcessorService.start();
      bookmarkSubject.next([]);
      documentSubject.next([]);

      await vi.waitFor(() => {
        expect(logger.info).toHaveBeenCalledWith(
          "[AutoProcessor] No new items to process",
        );
      });
      expect(logger.debug).not.toHaveBeenCalledWith(
        "[AutoProcessor] First bookmark",
        expect.anything(),
      );
    });

    it("does NOT log document details when documents is empty", async () => {
      await autoProcessorService.start();
      bookmarkSubject.next([]);
      documentSubject.next([]);

      await vi.waitFor(() => {
        expect(logger.info).toHaveBeenCalled();
      });
      expect(logger.debug).not.toHaveBeenCalledWith(
        "[AutoProcessor] First document",
        expect.anything(),
      );
    });

    it("skips processing if isProcessing is already true", async () => {
      await autoProcessorService.start();

      const slowBookmark = createRxDoc("bm-1", { title: "Slow" });
      (
        taggingService.generateSummary as ReturnType<typeof vi.fn>
      ).mockImplementation(
        () =>
          new Promise<string>((resolve) =>
            setTimeout(() => resolve("slow summary"), 200),
          ),
      );

      bookmarkSubject.next([slowBookmark]);
      documentSubject.next([]);

      await vi.waitFor(() => {
        expect(taggingService.generateSummary).toHaveBeenCalled();
      });

      bookmarkSubject.next([createRxDoc("bm-2", { title: "Second" })]);
      documentSubject.next([]);

      await new Promise((r) => setTimeout(r, 300));

      expect(taggingService.generateSummary).toHaveBeenCalledTimes(1);
    });

    it("skips processing when battery critically low and not charging", async () => {
      const mockGetBattery = vi
        .fn()
        .mockResolvedValue({ charging: false, level: 0.1 });
      Object.defineProperty(navigator, "getBattery", {
        value: mockGetBattery,
        configurable: true,
      });

      await autoProcessorService.start();
      bookmarkSubject.next([createRxDoc("bm-1")]);
      documentSubject.next([]);

      await vi.waitFor(() => {
        expect(logger.warn).toHaveBeenCalledWith(
          "[AutoProcessor] Battery critically low (<15%). Pausing background processing to save power.",
        );
      });
    });

    it("processes when battery is charging even if level is low", async () => {
      const mockGetBattery = vi
        .fn()
        .mockResolvedValue({ charging: true, level: 0.1 });
      Object.defineProperty(navigator, "getBattery", {
        value: mockGetBattery,
        configurable: true,
      });

      await autoProcessorService.start();
      bookmarkSubject.next([createRxDoc("bm-1")]);
      documentSubject.next([]);

      await vi.waitFor(() => {
        expect(taggingService.generateSummary).toHaveBeenCalled();
      });
    });

    it("processes when battery level is above threshold", async () => {
      const mockGetBattery = vi
        .fn()
        .mockResolvedValue({ charging: false, level: 0.5 });
      Object.defineProperty(navigator, "getBattery", {
        value: mockGetBattery,
        configurable: true,
      });

      await autoProcessorService.start();
      bookmarkSubject.next([createRxDoc("bm-1")]);
      documentSubject.next([]);

      await vi.waitFor(() => {
        expect(taggingService.generateSummary).toHaveBeenCalled();
      });
    });

    it("handles battery API failure gracefully", async () => {
      const mockGetBattery = vi
        .fn()
        .mockRejectedValue(new Error("Battery API error"));
      Object.defineProperty(navigator, "getBattery", {
        value: mockGetBattery,
        configurable: true,
      });

      await autoProcessorService.start();
      bookmarkSubject.next([createRxDoc("bm-1")]);
      documentSubject.next([]);

      await vi.waitFor(() => {
        expect(logger.warn).toHaveBeenCalledWith(
          "[AutoProcessor] Battery API failed",
          expect.objectContaining({
            error: expect.objectContaining({
              name: expect.any(String),
              message: expect.any(String),
            }),
          }),
        );
        expect(taggingService.generateSummary).toHaveBeenCalled();
      });
    });

    it("skips battery check when getBattery is not in navigator", async () => {
      const desc = Object.getOwnPropertyDescriptor(navigator, "getBattery");
      try {
        delete (navigator as unknown as Record<string, unknown>).getBattery;
        await autoProcessorService.start();
        bookmarkSubject.next([createRxDoc("bm-1")]);
        documentSubject.next([]);

        await vi.waitFor(() => {
          expect(taggingService.generateSummary).toHaveBeenCalled();
        });
      } finally {
        if (desc) Object.defineProperty(navigator, "getBattery", desc);
      }
    });

    it("skips when no items to process (allItems.length === 0)", async () => {
      await autoProcessorService.start();
      bookmarkSubject.next([]);
      documentSubject.next([]);

      await vi.waitFor(() => {
        expect(logger.info).toHaveBeenCalledWith(
          "[AutoProcessor] No new items to process",
        );
      });
      expect(taggingService.generateSummary).not.toHaveBeenCalled();
    });

    it("skips when items are null", async () => {
      await autoProcessorService.start();
      bookmarkSubject.next(null);
      documentSubject.next(null);

      await vi.waitFor(() => {
        expect(logger.info).toHaveBeenCalledWith(
          "[AutoProcessor] No new items to process",
        );
      });
    });

    it("skips processing when no API key and provider is not ollama or webllm", async () => {
      (aiManager.getApiKey as ReturnType<typeof vi.fn>).mockReturnValue(null);
      (aiManager.getProviderInfo as ReturnType<typeof vi.fn>).mockReturnValue({
        provider: "openai",
        model: "gpt-4",
        fullSupport: true,
        name: "OpenAI",
        isConfigured: false,
      });

      await autoProcessorService.start();
      bookmarkSubject.next([createRxDoc("bm-1")]);
      documentSubject.next([]);

      await vi.waitFor(() => {
        expect(logger.warn).toHaveBeenCalledWith(
          "[AutoProcessor] No API key configured. Skipping automatic processing.",
        );
      });
      expect(taggingService.generateSummary).not.toHaveBeenCalled();
    });

    it("processes when provider is ollama even without API key", async () => {
      (aiManager.getApiKey as ReturnType<typeof vi.fn>).mockReturnValue(null);
      (aiManager.getProviderInfo as ReturnType<typeof vi.fn>).mockReturnValue({
        provider: "ollama",
        model: "llama3",
        fullSupport: true,
        name: "Ollama",
        isConfigured: true,
      });

      await autoProcessorService.start();
      bookmarkSubject.next([createRxDoc("bm-1")]);
      documentSubject.next([]);

      await vi.waitFor(() => {
        expect(taggingService.generateSummary).toHaveBeenCalled();
      });
    });

    it("processes when provider is webllm even without API key", async () => {
      (aiManager.getApiKey as ReturnType<typeof vi.fn>).mockReturnValue(null);
      (aiManager.getProviderInfo as ReturnType<typeof vi.fn>).mockReturnValue({
        provider: "webllm",
        model: "phi3",
        fullSupport: true,
        name: "WebLLM",
        isConfigured: true,
      });

      await autoProcessorService.start();
      bookmarkSubject.next([createRxDoc("bm-1")]);
      documentSubject.next([]);

      await vi.waitFor(() => {
        expect(taggingService.generateSummary).toHaveBeenCalled();
      });
    });

    it("processes bookmark successfully (type=bookmark branch)", async () => {
      const bm = createRxDoc("bm-1", {
        title: "My Bookmark",
        content: "some content",
      });

      await autoProcessorService.start();
      bookmarkSubject.next([bm]);
      documentSubject.next([]);

      await vi.waitFor(() => {
        expect(taggingService.generateSummary).toHaveBeenCalledWith(
          "some content",
          "My Bookmark",
          "en",
          false,
          expect.any(AbortSignal),
        );
        expect(taggingService.suggestTags).toHaveBeenCalledWith(
          "some content",
          "en",
          "My Bookmark",
          [],
          false,
          expect.any(AbortSignal),
        );
      });

      expect(bm.incrementalPatch).toHaveBeenCalledWith(
        expect.objectContaining({ processed: true }),
      );
    });

    it("processes document successfully (type=document branch)", async () => {
      const doc = createRxDoc("doc-1", {
        title: "My Doc",
        textContent: "doc text",
        folderId: "some-folder",
      });

      await autoProcessorService.start();
      bookmarkSubject.next([]);
      documentSubject.next([doc]);

      await vi.waitFor(() => {
        expect(taggingService.generateSummary).toHaveBeenCalledWith(
          "doc text",
          "My Doc",
          "en",
          false,
          expect.any(AbortSignal),
        );
      });

      expect(doc.incrementalPatch).toHaveBeenCalledWith(
        expect.objectContaining({ processed: true }),
      );
    });

    it("processes both bookmarks and documents in parallel", async () => {
      const bm = createRxDoc("bm-1", { title: "BM" });
      const doc = createRxDoc("doc-1", {
        title: "DOC",
        folderId: "some-folder",
      });

      await autoProcessorService.start();
      bookmarkSubject.next([bm]);
      documentSubject.next([doc]);

      await vi.waitFor(() => {
        expect(taggingService.generateSummary).toHaveBeenCalledTimes(2);
      });
    });

    it("handles bookmark processing error gracefully (catch in task)", async () => {
      const bm = createRxDoc("bm-1");
      (
        taggingService.generateSummary as ReturnType<typeof vi.fn>
      ).mockRejectedValueOnce(new Error("AI error"));

      await autoProcessorService.start();
      bookmarkSubject.next([bm]);
      documentSubject.next([]);

      await vi.waitFor(() => {
        expect(logger.error).toHaveBeenCalledWith(
          "[AutoProcessor] Error processing bookmark",
          expect.objectContaining({
            title: expect.any(String),
            error: expect.any(Object),
          }),
        );
      });
    });

    it("applies backoff after a failure: does not retry in a hot loop (audit #6)", async () => {
      await autoProcessorService.start();
      const bm = createRxDoc("bm-1");
      (
        taggingService.generateSummary as ReturnType<typeof vi.fn>
      ).mockRejectedValue(new Error("AI error"));

      // First attempt → fails and enters backoff
      bookmarkSubject.next([bm]);
      documentSubject.next([]);
      await vi.waitFor(() => {
        expect(logger.error).toHaveBeenCalledWith(
          "[AutoProcessor] Error processing bookmark",
          expect.objectContaining({ error: expect.any(Object) }),
        );
      });
      // Let the batch finish (isProcessing=false) before re-emitting
      await new Promise((r) => setTimeout(r, 100));

      // Re-emission of the SAME item within the backoff window → skipped
      (taggingService.generateSummary as ReturnType<typeof vi.fn>).mockClear();
      bookmarkSubject.next([bm]);
      documentSubject.next([]);
      await new Promise((r) => setTimeout(r, 300));

      expect(taggingService.generateSummary).not.toHaveBeenCalled();
    });

    it("handles document processing error gracefully (catch in task)", async () => {
      const doc = createRxDoc("doc-1", { folderId: "some-folder" });
      (
        taggingService.generateSummary as ReturnType<typeof vi.fn>
      ).mockRejectedValueOnce(new Error("AI error"));

      await autoProcessorService.start();
      bookmarkSubject.next([]);
      documentSubject.next([doc]);

      await vi.waitFor(() => {
        expect(logger.error).toHaveBeenCalledWith(
          "[AutoProcessor] Error processing document",
          expect.objectContaining({
            title: expect.any(String),
            error: expect.any(Object),
          }),
        );
      });
    });

    it("resets isProcessing flag in finally block", async () => {
      const bm = createRxDoc("bm-1");
      await autoProcessorService.start();
      bookmarkSubject.next([bm]);
      documentSubject.next([]);

      await vi.waitFor(() => {
        expect(taggingService.generateSummary).toHaveBeenCalled();
      });

      expect(
        (autoProcessorService as unknown as { isProcessing: boolean })
          .isProcessing,
      ).toBe(false);
    });

    it("resets status in finally block", async () => {
      const statuses: Array<{ isProcessing: boolean; totalItems: number }> = [];
      const sub = autoProcessorService.status$.subscribe((s) =>
        statuses.push({ ...s }),
      );

      const bm = createRxDoc("bm-1");
      await autoProcessorService.start();
      bookmarkSubject.next([bm]);
      documentSubject.next([]);

      await vi.waitFor(() => {
        expect(taggingService.generateSummary).toHaveBeenCalled();
      });

      const lastStatus = statuses[statuses.length - 1];
      expect(lastStatus!.isProcessing).toBe(false);
      expect(lastStatus!.totalItems).toBe(0);
      expect((lastStatus as any).processedItems).toBe(0);
      sub.unsubscribe();
    });

    it("reports processing errors in the outer catch (initDB rejects)", async () => {
      (initDB as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("DB init failed"),
      );
      await expect(autoProcessorService.start()).rejects.toThrow(
        "DB init failed",
      );
    });
  });

  describe("processDocument()", () => {
    it("uses existing embedding when doc.embedding exists and is non-empty", async () => {
      const doc = createRxDoc("doc-1", {
        embedding: [0.9, 0.8],
        folderId: "some-folder",
      });

      await autoProcessorService.start();
      bookmarkSubject.next([]);
      documentSubject.next([doc]);

      await vi.waitFor(() => {
        expect(doc.incrementalPatch).toHaveBeenCalledWith(
          expect.objectContaining({ embedding: [0.9, 0.8] }),
        );
      });
      expect(doc.incrementalPatch).toHaveBeenCalledWith(
        expect.objectContaining({ embedding: [0.9, 0.8] }),
      );
    });

    it("generates embedding when doc.embedding is empty array", async () => {
      const doc = createRxDoc("doc-1", {
        embedding: [],
        folderId: "some-folder",
      });

      await autoProcessorService.start();
      bookmarkSubject.next([]);
      documentSubject.next([doc]);

      await vi.waitFor(() => {
        expect(ragEngine.generateEmbedding).toHaveBeenCalled();
      });
    });

    it("generates embedding when doc.embedding is null", async () => {
      const doc = createRxDoc("doc-1", {
        embedding: null,
        folderId: "some-folder",
      });

      await autoProcessorService.start();
      bookmarkSubject.next([]);
      documentSubject.next([doc]);

      await vi.waitFor(() => {
        expect(ragEngine.generateEmbedding).toHaveBeenCalled();
      });
    });

    it("uses es language when localStorage i18nextLng starts with es", async () => {
      mockLocalStorage.setItem("i18nextLng", "es-AR");
      const doc = createRxDoc("doc-1", { folderId: "some-folder" });

      await autoProcessorService.start();
      bookmarkSubject.next([]);
      documentSubject.next([doc]);

      await vi.waitFor(() => {
        expect(taggingService.generateSummary).toHaveBeenCalledWith(
          expect.any(String),
          expect.any(String),
          "es",
          expect.any(Boolean),
          expect.any(AbortSignal),
        );
      });
    });

    it("uses en language when localStorage i18nextLng does not start with es", async () => {
      const doc = createRxDoc("doc-1", { folderId: "some-folder" });

      await autoProcessorService.start();
      bookmarkSubject.next([]);
      documentSubject.next([doc]);

      await vi.waitFor(() => {
        expect(taggingService.generateSummary).toHaveBeenCalledWith(
          expect.any(String),
          expect.any(String),
          "en",
          expect.any(Boolean),
          expect.any(AbortSignal),
        );
      });
    });

    it("uses en language when localStorage has no i18nextLng", async () => {
      mockLocalStorage.removeItem("i18nextLng");
      const doc = createRxDoc("doc-1", { folderId: "some-folder" });

      await autoProcessorService.start();
      bookmarkSubject.next([]);
      documentSubject.next([doc]);

      await vi.waitFor(() => {
        expect(taggingService.generateSummary).toHaveBeenCalledWith(
          expect.any(String),
          expect.any(String),
          "en",
          expect.any(Boolean),
          expect.any(AbortSignal),
        );
      });
    });

    it("passes isPrivate=true from document", async () => {
      const doc = createRxDoc("doc-1", {
        isPrivate: true,
        folderId: "some-folder",
      });

      await autoProcessorService.start();
      bookmarkSubject.next([]);
      documentSubject.next([doc]);

      await vi.waitFor(() => {
        expect(taggingService.generateSummary).toHaveBeenCalledWith(
          expect.any(String),
          expect.any(String),
          expect.any(String),
          true,
          expect.any(AbortSignal),
        );
      });
    });

    it("passes isPrivate=false by default", async () => {
      const doc = createRxDoc("doc-1", {
        isPrivate: false,
        folderId: "some-folder",
      });

      await autoProcessorService.start();
      bookmarkSubject.next([]);
      documentSubject.next([doc]);

      await vi.waitFor(() => {
        expect(taggingService.generateSummary).toHaveBeenCalledWith(
          expect.any(String),
          expect.any(String),
          expect.any(String),
          false,
          expect.any(AbortSignal),
        );
      });
    });

    it("falls back to title when textContent is empty", async () => {
      const doc = createRxDoc("doc-1", {
        textContent: "",
        title: "Fallback Title",
        folderId: "some-folder",
      });

      await autoProcessorService.start();
      bookmarkSubject.next([]);
      documentSubject.next([doc]);

      await vi.waitFor(() => {          expect(ragEngine.generateEmbedding).toHaveBeenCalledWith(
          "Fallback Title",
          expect.any(AbortSignal),
        );

      });
    });

    it("falls back to title when textContent is undefined", async () => {
      const doc = createRxDoc("doc-1", {
        textContent: undefined,
        title: "Fallback",
        folderId: "some-folder",
      });

      await autoProcessorService.start();
      bookmarkSubject.next([]);
      documentSubject.next([doc]);

      await vi.waitFor(() => {
        expect(ragEngine.generateEmbedding).toHaveBeenCalledWith(
          "Fallback",
          expect.any(AbortSignal),
        );
      });
    });

    it("suggests folder when folderId is root", async () => {
      const doc = createRxDoc("doc-1", { folderId: "root" });

      await autoProcessorService.start();
      bookmarkSubject.next([]);
      documentSubject.next([doc]);

      await vi.waitFor(() => {
        expect(taggingService.suggestFolder).toHaveBeenCalled();
      });
    });

    it("does NOT suggest folder when folderId is not root", async () => {
      const doc = createRxDoc("doc-1", { folderId: "my-folder" });

      await autoProcessorService.start();
      bookmarkSubject.next([]);
      documentSubject.next([doc]);

      await vi.waitFor(() => {
        expect(taggingService.generateSummary).toHaveBeenCalled();
      });
      expect(taggingService.suggestFolder).not.toHaveBeenCalled();
    });

    it("uses existing folder when suggested name matches (case-insensitive)", async () => {
      const existingFolders = [{ id: "folder-1", title: "Research" }];
      mockDb.folders.find.mockReturnValue({
        exec: vi.fn().mockResolvedValue(existingFolders),
      });
      (
        taggingService.suggestFolder as ReturnType<typeof vi.fn>
      ).mockResolvedValue("Research");

      const doc = createRxDoc("doc-1", { folderId: "root" });

      await autoProcessorService.start();
      bookmarkSubject.next([]);
      documentSubject.next([doc]);

      await vi.waitFor(() => {
        expect(doc.incrementalPatch).toHaveBeenCalledWith(
          expect.objectContaining({ folderId: "folder-1" }),
        );
      });
      expect(mockDb.folders.insert).not.toHaveBeenCalled();
    });

    it("creates new folder when suggested name does not match existing (and is not root/general)", async () => {
      mockDb.folders.find.mockReturnValue({
        exec: vi.fn().mockResolvedValue([]),
      });
      (
        taggingService.suggestFolder as ReturnType<typeof vi.fn>
      ).mockResolvedValue("New Topic");

      const doc = createRxDoc("doc-1", { folderId: "root" });

      await autoProcessorService.start();
      bookmarkSubject.next([]);
      documentSubject.next([doc]);

      await vi.waitFor(() => {
        expect(mockDb.folders.insert).toHaveBeenCalledWith(
          expect.objectContaining({ title: "New Topic" }),
        );
        expect(logger.info).toHaveBeenCalledWith(
          "[AutoProcessor] Created new folder",
          { name: "New Topic" },
        );
      });
    });

    it('does NOT create folder when suggested name is "root"', async () => {
      mockDb.folders.find.mockReturnValue({
        exec: vi.fn().mockResolvedValue([]),
      });
      (
        taggingService.suggestFolder as ReturnType<typeof vi.fn>
      ).mockResolvedValue("root");

      const doc = createRxDoc("doc-1", { folderId: "root" });

      await autoProcessorService.start();
      bookmarkSubject.next([]);
      documentSubject.next([doc]);

      await vi.waitFor(() => {
        expect(mockDb.folders.insert).not.toHaveBeenCalled();
      });
    });

    it('does NOT create folder when suggested name is "general"', async () => {
      mockDb.folders.find.mockReturnValue({
        exec: vi.fn().mockResolvedValue([]),
      });
      (
        taggingService.suggestFolder as ReturnType<typeof vi.fn>
      ).mockResolvedValue("general");

      const doc = createRxDoc("doc-1", { folderId: "root" });

      await autoProcessorService.start();
      bookmarkSubject.next([]);
      documentSubject.next([doc]);

      await vi.waitFor(() => {
        expect(mockDb.folders.insert).not.toHaveBeenCalled();
      });
    });

    it('does NOT create folder when suggested name is "ROOT" (case-insensitive)', async () => {
      mockDb.folders.find.mockReturnValue({
        exec: vi.fn().mockResolvedValue([]),
      });
      (
        taggingService.suggestFolder as ReturnType<typeof vi.fn>
      ).mockResolvedValue("ROOT");

      const doc = createRxDoc("doc-1", { folderId: "root" });

      await autoProcessorService.start();
      bookmarkSubject.next([]);
      documentSubject.next([doc]);

      await vi.waitFor(() => {
        expect(mockDb.folders.insert).not.toHaveBeenCalled();
      });
    });

    it('does NOT create folder when suggested name is "GENERAL" (case-insensitive)', async () => {
      mockDb.folders.find.mockReturnValue({
        exec: vi.fn().mockResolvedValue([]),
      });
      (
        taggingService.suggestFolder as ReturnType<typeof vi.fn>
      ).mockResolvedValue("GENERAL");

      const doc = createRxDoc("doc-1", { folderId: "root" });

      await autoProcessorService.start();
      bookmarkSubject.next([]);
      documentSubject.next([doc]);

      await vi.waitFor(() => {
        expect(mockDb.folders.insert).not.toHaveBeenCalled();
      });
    });

    it("sets folderId from created folder when targetFolder is null initially", async () => {
      mockDb.folders.find.mockReturnValue({
        exec: vi.fn().mockResolvedValue([]),
      });
      (
        taggingService.suggestFolder as ReturnType<typeof vi.fn>
      ).mockResolvedValue("New Topic");
      mockDb.folders.insert.mockResolvedValue({
        id: "created-id",
        title: "New Topic",
      });

      const doc = createRxDoc("doc-1", { folderId: "root" });

      await autoProcessorService.start();
      bookmarkSubject.next([]);
      documentSubject.next([doc]);

      await vi.waitFor(() => {
        expect(doc.incrementalPatch).toHaveBeenCalledWith(
          expect.objectContaining({ folderId: "created-id" }),
        );
      });
    });

    it("uses existing folder when match is case-insensitive", async () => {
      mockDb.folders.find.mockReturnValue({
        exec: vi.fn().mockResolvedValue([{ id: "f-1", title: "MY FOLDER" }]),
      });
      (
        taggingService.suggestFolder as ReturnType<typeof vi.fn>
      ).mockResolvedValue("my folder");

      const doc = createRxDoc("doc-1", { folderId: "root" });

      await autoProcessorService.start();
      bookmarkSubject.next([]);
      documentSubject.next([doc]);

      await vi.waitFor(() => {
        expect(doc.incrementalPatch).toHaveBeenCalledWith(
          expect.objectContaining({ folderId: "f-1" }),
        );
      });
    });

    it("passes existing tags to suggestTags", async () => {
      const doc = createRxDoc("doc-1", {
        title: "My Doc",
        tags: ["existing", "tags"],
        folderId: "some-folder",
      });

      await autoProcessorService.start();
      bookmarkSubject.next([]);
      documentSubject.next([doc]);

      await vi.waitFor(() => {
        expect(taggingService.suggestTags).toHaveBeenCalledWith(
          "Test text content",
          "en",
          "My Doc",
          ["existing", "tags"],
          false,
          expect.any(AbortSignal),
        );
      });
    });

    it("calls processChunks after patching document", async () => {
      const doc = createRxDoc("doc-1", {
        textContent: "Some text",
        folderId: "some-folder",
      });

      await autoProcessorService.start();
      bookmarkSubject.next([]);
      documentSubject.next([doc]);

      await vi.waitFor(() => {
        expect(ChunkingService.splitText).toHaveBeenCalledWith(
          "Some text",
          1000,
          200,
        );
        expect(mockDb.chunks.bulkInsert).toHaveBeenCalled();
      });
    });

    it("handles document processing error (catch block)", async () => {
      const doc = createRxDoc("doc-1", { folderId: "some-folder" });
      (
        taggingService.generateSummary as ReturnType<typeof vi.fn>
      ).mockRejectedValue(new Error("fail"));

      await autoProcessorService.start();
      bookmarkSubject.next([]);
      documentSubject.next([doc]);

      await vi.waitFor(() => {
        expect(logger.error).toHaveBeenCalledWith(
          "[AutoProcessor] Error processing document",
          expect.objectContaining({ error: expect.any(Object) }),
        );
      });
    });

    it("logs finished processing document", async () => {
      const doc = createRxDoc("doc-1", {
        title: "Finished Doc",
        folderId: "some-folder",
      });

      await autoProcessorService.start();
      bookmarkSubject.next([]);
      documentSubject.next([doc]);

      await vi.waitFor(() => {
        expect(logger.info).toHaveBeenCalledWith(
          "[AutoProcessor] Finished processing document",
          { title: "Finished Doc" },
        );
      });
    });
  });

  describe("processBookmark()", () => {
    it("uses existing embedding when bookmark.embedding exists and is non-empty", async () => {
      const bm = createRxDoc("bm-1", { embedding: [0.5, 0.6] });

      await autoProcessorService.start();
      bookmarkSubject.next([bm]);
      documentSubject.next([]);

      await vi.waitFor(() => {
        expect(bm.incrementalPatch).toHaveBeenCalledWith(
          expect.objectContaining({ embedding: [0.5, 0.6] }),
        );
      });
    });

    it("generates embedding when bookmark.embedding is empty array", async () => {
      const bm = createRxDoc("bm-1", { embedding: [] });

      await autoProcessorService.start();
      bookmarkSubject.next([bm]);
      documentSubject.next([]);

      await vi.waitFor(() => {
        expect(ragEngine.generateEmbedding).toHaveBeenCalled();
      });
    });

    it("generates embedding when bookmark.embedding is null", async () => {
      const bm = createRxDoc("bm-1", { embedding: null });

      await autoProcessorService.start();
      bookmarkSubject.next([bm]);
      documentSubject.next([]);

      await vi.waitFor(() => {
        expect(ragEngine.generateEmbedding).toHaveBeenCalled();
      });
    });

    it("uses es language when localStorage i18nextLng starts with es", async () => {
      mockLocalStorage.setItem("i18nextLng", "es");
      const bm = createRxDoc("bm-1");

      await autoProcessorService.start();
      bookmarkSubject.next([bm]);
      documentSubject.next([]);

      await vi.waitFor(() => {
        expect(taggingService.generateSummary).toHaveBeenCalledWith(
          expect.any(String),
          expect.any(String),
          "es",
          false,
          expect.any(AbortSignal),
        );
      });
    });

    it("uses en language when locale is en-US", async () => {
      mockLocalStorage.setItem("i18nextLng", "en-US");
      const bm = createRxDoc("bm-1");

      await autoProcessorService.start();
      bookmarkSubject.next([bm]);
      documentSubject.next([]);

      await vi.waitFor(() => {
        expect(taggingService.generateSummary).toHaveBeenCalledWith(
          expect.any(String),
          expect.any(String),
          "en",
          false,
          expect.any(AbortSignal),
        );
      });
    });

    it("uses en language by default when no locale is set", async () => {
      const bm = createRxDoc("bm-1");

      await autoProcessorService.start();
      bookmarkSubject.next([bm]);
      documentSubject.next([]);

      await vi.waitFor(() => {
        expect(taggingService.generateSummary).toHaveBeenCalledWith(
          expect.any(String),
          expect.any(String),
          "en",
          false,
          expect.any(AbortSignal),
        );
      });
    });

    it("falls back to title for embedding when content is empty", async () => {
      const bm = createRxDoc("bm-1", { content: "", title: "Fallback" });

      await autoProcessorService.start();
      bookmarkSubject.next([bm]);
      documentSubject.next([]);

      await vi.waitFor(() => {
        expect(ragEngine.generateEmbedding).toHaveBeenCalledWith(
          "Fallback",
          expect.any(AbortSignal),
        );
      });
    });

    it("falls back to title for embedding when content is undefined", async () => {
      const bm = createRxDoc("bm-1", {
        content: undefined,
        title: "FallbackTitle",
      });

      await autoProcessorService.start();
      bookmarkSubject.next([bm]);
      documentSubject.next([]);

      await vi.waitFor(() => {
        expect(ragEngine.generateEmbedding).toHaveBeenCalledWith(
          "FallbackTitle",
          expect.any(AbortSignal),
        );
      });
    });

    it("uses content for embedding when content is non-empty", async () => {
      const bm = createRxDoc("bm-1", { content: "Bookmark content" });

      await autoProcessorService.start();
      bookmarkSubject.next([bm]);
      documentSubject.next([]);

      await vi.waitFor(() => {
        expect(ragEngine.generateEmbedding).toHaveBeenCalledWith(
          "Bookmark content",
          expect.any(AbortSignal),
        );
      });
    });

    it("searches for similar bookmarks via vectorIndexService", async () => {
      const bm = createRxDoc("bm-1");
      (vectorIndexService.search as ReturnType<typeof vi.fn>).mockResolvedValue(
        {
          neighbors: [
            { id: "n1", similarity: 0.9, title: "other-bm", url: "bookmark" },
          ],
        },
      );

      await autoProcessorService.start();
      bookmarkSubject.next([bm]);
      documentSubject.next([]);

      await vi.waitFor(() => {
        expect(vectorIndexService.search).toHaveBeenCalled();
      });
    });

    it("filters related links by similarity > 0.75, url === bookmark, and not self", async () => {
      const bm = createRxDoc("bm-1");
      (vectorIndexService.search as ReturnType<typeof vi.fn>).mockResolvedValue(
        {
          neighbors: [
            { id: "n1", similarity: 0.9, title: "related-1", url: "bookmark" },
            { id: "n2", similarity: 0.5, title: "related-2", url: "bookmark" },
            { id: "n3", similarity: 0.9, title: "bm-1", url: "bookmark" },
            { id: "n4", similarity: 0.9, title: "related-4", url: "document" },
          ],
        },
      );

      await autoProcessorService.start();
      bookmarkSubject.next([bm]);
      documentSubject.next([]);

      await vi.waitFor(() => {
        expect(bm.incrementalPatch).toHaveBeenCalledWith(
          expect.objectContaining({ relatedLinks: ["related-1"] }),
        );
      });
    });

    it("deduplicates related links with Set", async () => {
      const bm = createRxDoc("bm-1");
      (vectorIndexService.search as ReturnType<typeof vi.fn>).mockResolvedValue(
        {
          neighbors: [
            { id: "n1", similarity: 0.9, title: "related-1", url: "bookmark" },
            { id: "n2", similarity: 0.95, title: "related-1", url: "bookmark" },
          ],
        },
      );

      await autoProcessorService.start();
      bookmarkSubject.next([bm]);
      documentSubject.next([]);

      await vi.waitFor(() => {
        expect(bm.incrementalPatch).toHaveBeenCalledWith(
          expect.objectContaining({ relatedLinks: ["related-1"] }),
        );
      });
    });

    it("sets relatedLinks to empty array when no similar neighbors", async () => {
      const bm = createRxDoc("bm-1");
      (vectorIndexService.search as ReturnType<typeof vi.fn>).mockResolvedValue(
        { neighbors: [] },
      );

      await autoProcessorService.start();
      bookmarkSubject.next([bm]);
      documentSubject.next([]);

      await vi.waitFor(() => {
        expect(bm.incrementalPatch).toHaveBeenCalledWith(
          expect.objectContaining({ relatedLinks: [] }),
        );
      });
    });

    it("passes existing tags to suggestTags", async () => {
      const bm = createRxDoc("bm-1", { tags: ["existing"] });

      await autoProcessorService.start();
      bookmarkSubject.next([bm]);
      documentSubject.next([]);

      await vi.waitFor(() => {
        expect(taggingService.suggestTags).toHaveBeenCalledWith(
          expect.any(String),
          "en",
          "Test Doc",
          ["existing"],
          false,
          expect.any(AbortSignal),
        );
      });
    });

    it("calls processChunks after patching bookmark", async () => {
      const bm = createRxDoc("bm-1", { content: "some text" });

      await autoProcessorService.start();
      bookmarkSubject.next([bm]);
      documentSubject.next([]);

      await vi.waitFor(() => {
        expect(ChunkingService.splitText).toHaveBeenCalledWith(
          "some text",
          1000,
          200,
        );
      });
    });

    it("handles bookmark processing error (catch block)", async () => {
      const bm = createRxDoc("bm-1");
      (
        taggingService.generateSummary as ReturnType<typeof vi.fn>
      ).mockRejectedValue(new Error("fail"));

      await autoProcessorService.start();
      bookmarkSubject.next([bm]);
      documentSubject.next([]);

      await vi.waitFor(() => {
        expect(logger.error).toHaveBeenCalledWith(
          "[AutoProcessor] Error processing bookmark",
          expect.objectContaining({ error: expect.any(Object) }),
        );
      });
    });

    it("logs finished processing bookmark", async () => {
      const bm = createRxDoc("bm-1", { title: "Done Bookmark" });

      await autoProcessorService.start();
      bookmarkSubject.next([bm]);
      documentSubject.next([]);

      await vi.waitFor(() => {
        expect(logger.info).toHaveBeenCalledWith(
          "[AutoProcessor] Finished processing bookmark",
          { title: "Done Bookmark" },
        );
      });
    });
  });

  describe("processChunks()", () => {
    it("clears old chunks before inserting new ones", async () => {
      const oldChunk = { id: "old-chunk-1" };
      mockDb.chunks.find.mockReturnValue({
        exec: vi.fn().mockResolvedValue([oldChunk]),
      });

      const bm = createRxDoc("bm-1", { content: "text" });

      await autoProcessorService.start();
      bookmarkSubject.next([bm]);
      documentSubject.next([]);

      await vi.waitFor(() => {
        expect(mockDb.chunks.bulkRemove).toHaveBeenCalledWith([oldChunk]);
      });
    });

    it("skips bulkRemove when no old chunks", async () => {
      mockDb.chunks.find.mockReturnValue({
        exec: vi.fn().mockResolvedValue([]),
      });

      const bm = createRxDoc("bm-1", { content: "text" });

      await autoProcessorService.start();
      bookmarkSubject.next([bm]);
      documentSubject.next([]);

      await vi.waitFor(() => {
        expect(mockDb.chunks.bulkInsert).toHaveBeenCalled();
      });
      expect(mockDb.chunks.bulkRemove).not.toHaveBeenCalled();
    });

    it("inserts chunks into db and vector index", async () => {
      const bm = createRxDoc("bm-1", { content: "text" });

      await autoProcessorService.start();
      bookmarkSubject.next([bm]);
      documentSubject.next([]);

      await vi.waitFor(() => {
        expect(mockDb.chunks.bulkInsert).toHaveBeenCalled();
        expect(vectorIndexService.replace).toHaveBeenCalledWith(
          [],
          [expect.objectContaining({ id: expect.stringMatching(/^chunk:/) })],
          expect.any(AbortSignal),
        );
      });
    });

    it("handles multiple chunks in batches", async () => {
      (ChunkingService.splitText as ReturnType<typeof vi.fn>).mockReturnValue([
        "c1",
        "c2",
        "c3",
        "c4",
      ]);
      const bm = createRxDoc("bm-1", { content: "long text" });

      await autoProcessorService.start();
      bookmarkSubject.next([bm]);
      documentSubject.next([]);

      await vi.waitFor(() => {
        expect(mockDb.chunks.bulkInsert).toHaveBeenCalled();
        const insertArg = (mockDb.chunks.bulkInsert as ReturnType<typeof vi.fn>)
          .mock.calls[0]![0];
        expect(insertArg).toHaveLength(4);
      });
    });

    it("skips db insert when no chunks generated", async () => {
      (ChunkingService.splitText as ReturnType<typeof vi.fn>).mockReturnValue(
        [],
      );
      const bm = createRxDoc("bm-1", { content: "text" });

      await autoProcessorService.start();
      bookmarkSubject.next([bm]);
      documentSubject.next([]);

      await vi.waitFor(() => {
        expect(taggingService.generateSummary).toHaveBeenCalled();
      });
      expect(mockDb.chunks.bulkInsert).not.toHaveBeenCalled();
      expect(vectorIndexService.replace).not.toHaveBeenCalled();
    });

    it("preserves old chunks when no replacement chunks are generated", async () => {
      (ChunkingService.splitText as ReturnType<typeof vi.fn>).mockReturnValue(
        [],
      );
      const oldChunk = { id: "old-chunk-1" };
      mockDb.chunks.find.mockReturnValue({
        exec: vi.fn().mockResolvedValue([oldChunk]),
      });
      const internals = autoProcessorService as unknown as {
        processChunks: (
          parentId: string,
          parentType: "document" | "bookmark",
          text: string,
        ) => Promise<void>;
      };

      await internals.processChunks("parent-1", "bookmark", "text");

      expect(mockDb.chunks.bulkInsert).not.toHaveBeenCalled();
      expect(mockDb.chunks.bulkRemove).not.toHaveBeenCalled();
    });

    it("generates embeddings for each chunk", async () => {
      (ChunkingService.splitText as ReturnType<typeof vi.fn>).mockReturnValue([
        "chunk-a",
        "chunk-b",
      ]);
      const bm = createRxDoc("bm-1");

      await autoProcessorService.start();
      bookmarkSubject.next([bm]);
      documentSubject.next([]);

      await vi.waitFor(() => {
        expect(ragEngine.generateEmbedding).toHaveBeenCalledWith(
          "chunk-a",
          expect.any(AbortSignal),
        );
        expect(ragEngine.generateEmbedding).toHaveBeenCalledWith(
          "chunk-b",
          expect.any(AbortSignal),
        );
      });
    });

    it("preserves old chunks when embedding generation is cancelled", async () => {
      const internals = autoProcessorService as unknown as {
        processChunks: (
          parentId: string,
          parentType: "document" | "bookmark",
          text: string,
          signal?: AbortSignal,
        ) => Promise<void>;
      };
      const oldChunk = { id: "old-chunk-1" };
      mockDb.chunks.find.mockReturnValue({
        exec: vi.fn().mockResolvedValue([oldChunk]),
      });
      let resolveEmbedding!: (value: number[]) => void;
      (ragEngine.generateEmbedding as ReturnType<typeof vi.fn>).mockReturnValue(
        new Promise((resolve) => { resolveEmbedding = resolve; }),
      );
      const controller = new AbortController();
      const operation = internals.processChunks(
        "parent-1",
        "bookmark",
        "text",
        controller.signal,
      );

      await vi.waitFor(() => {
        expect(ragEngine.generateEmbedding).toHaveBeenCalled();
      });
      controller.abort();
      resolveEmbedding!([0.1, 0.2]);
      await operation;

      expect(mockDb.chunks.bulkInsert).not.toHaveBeenCalled();
      expect(mockDb.chunks.bulkRemove).not.toHaveBeenCalled();
    });

    it("rolls back replacement chunks when insertion fails before removing old chunks", async () => {
      const internals = autoProcessorService as unknown as {
        processChunks: (
          parentId: string,
          parentType: "document" | "bookmark",
          text: string,
        ) => Promise<void>;
      };
      const oldChunk = { id: "old-chunk-1" };
      mockDb.chunks.find.mockReturnValue({
        exec: vi.fn().mockResolvedValue([oldChunk]),
      });
      (mockDb.chunks.bulkInsert as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("insert failed"),
      );

      await expect(
        internals.processChunks("parent-1", "bookmark", "text"),
      ).rejects.toThrow("insert failed");

      expect(mockDb.chunks.bulkRemove).toHaveBeenCalledTimes(1);
      expect(mockDb.chunks.bulkRemove.mock.calls[0]![0]).not.toEqual([oldChunk]);
    });

    it("restores the old generation when cancellation arrives during commit", async () => {
      const internals = autoProcessorService as unknown as {
        processChunks: (
          parentId: string,
          parentType: "document" | "bookmark",
          text: string,
          signal?: AbortSignal,
        ) => Promise<void>;
      };
      const oldChunk = {
        id: "old-chunk-1",
        parentId: "parent-1",
        parentType: "bookmark" as const,
        content: "old",
        embedding: [0.9],
        index: 0,
        createdAt: new Date().toISOString(),
      };
      let findCount = 0;
      mockDb.chunks.find.mockImplementation(() => ({
        exec: vi.fn().mockResolvedValue(++findCount === 1 ? [oldChunk] : []),
      }));
      let resolveVector!: () => void;
      (vectorIndexService.replace as ReturnType<typeof vi.fn>).mockReturnValue(
        new Promise<void>((resolve) => { resolveVector = resolve; }),
      );
      const controller = new AbortController();
      const operation = internals.processChunks(
        "parent-1",
        "bookmark",
        "text",
        controller.signal,
      );

      await vi.waitFor(() => {
        expect(mockDb.chunks.bulkRemove).toHaveBeenCalledWith([oldChunk]);
      });
      controller.abort();
      resolveVector!();

      await expect(operation).rejects.toMatchObject({ name: "AbortError" });
      expect(mockDb.chunks.bulkRemove).toHaveBeenCalledTimes(2);
      expect(mockDb.chunks.bulkInsert).toHaveBeenCalledTimes(2);
      expect(mockDb.chunks.bulkInsert.mock.calls[1]![0]).toEqual([oldChunk]);
    });
  });

  describe("forceReprocessAll()", () => {
    it("marks all bookmarks and documents as unprocessed", async () => {
      const doc1 = createRxDoc("doc-1", { processed: true });
      const bm1 = createRxDoc("bm-1", { processed: true });
      mockDb.documents.find.mockReturnValue({
        exec: vi.fn().mockResolvedValue([doc1]),
      });
      mockDb.bookmarks.find.mockReturnValue({
        exec: vi.fn().mockResolvedValue([bm1]),
      });

      await autoProcessorService.forceReprocessAll();
      expect(doc1.incrementalPatch).toHaveBeenCalledWith({ processed: false });
      expect(bm1.incrementalPatch).toHaveBeenCalledWith({ processed: false });
    });

    it("handles empty arrays without error", async () => {
      mockDb.documents.find.mockReturnValue({
        exec: vi.fn().mockResolvedValue([]),
      });
      mockDb.bookmarks.find.mockReturnValue({
        exec: vi.fn().mockResolvedValue([]),
      });

      await expect(
        autoProcessorService.forceReprocessAll(),
      ).resolves.not.toThrow();
    });

    it("logs count of items marked for re-processing", async () => {
      const doc1 = createRxDoc("d1");
      const doc2 = createRxDoc("d2");
      const bm1 = createRxDoc("b1");
      mockDb.documents.find.mockReturnValue({
        exec: vi.fn().mockResolvedValue([doc1, doc2]),
      });
      mockDb.bookmarks.find.mockReturnValue({
        exec: vi.fn().mockResolvedValue([bm1]),
      });

      await autoProcessorService.forceReprocessAll();

      expect(logger.info).toHaveBeenCalledWith(
        "[AutoProcessor] Marked items for re-processing",
        { count: 3 },
      );
    });

    it("calls initDB", async () => {
      await autoProcessorService.forceReprocessAll();
      expect(initDB).toHaveBeenCalled();
    });

    it("calls find on both collections", async () => {
      await autoProcessorService.forceReprocessAll();
      expect(mockDb.bookmarks.find).toHaveBeenCalled();
      expect(mockDb.documents.find).toHaveBeenCalled();
    });

    it("shares one sweep across concurrent callers", async () => {
      const firstRequest = autoProcessorService.forceReprocessAll();
      const secondRequest = autoProcessorService.forceReprocessAll();

      await expect(Promise.all([firstRequest, secondRequest])).resolves.toEqual([
        0,
        0,
      ]);
      expect(initDB).toHaveBeenCalledTimes(1);
      expect(mockDb.bookmarks.find).toHaveBeenCalledTimes(1);
      expect(mockDb.documents.find).toHaveBeenCalledTimes(1);
    });
  });

  describe("stop()", () => {
    it("unsubscribes and resets state", async () => {
      await autoProcessorService.start();
      autoProcessorService.stop();

      expect(
        (autoProcessorService as unknown as { subscription: null })
          .subscription,
      ).toBeNull();
    });

    it("can be called multiple times safely", async () => {
      await autoProcessorService.start();
      autoProcessorService.stop();
      autoProcessorService.stop();

      expect(
        (autoProcessorService as unknown as { subscription: null })
          .subscription,
      ).toBeNull();
    });

    it("resets isProcessing to false", async () => {
      await autoProcessorService.start();
      autoProcessorService.stop();

      expect(
        (autoProcessorService as unknown as { isProcessing: boolean })
          .isProcessing,
      ).toBe(false);
    });

    it("emits reset status after stop", async () => {
      const statuses: Array<{ isProcessing: boolean; totalItems: number }> = [];
      const sub = autoProcessorService.status$.subscribe((s) =>
        statuses.push({ ...s }),
      );

      await autoProcessorService.start();
      autoProcessorService.stop();

      const lastStatus = statuses[statuses.length - 1];
      expect(lastStatus!.isProcessing).toBe(false);
      expect(lastStatus!.totalItems).toBe(0);
      sub.unsubscribe();
    });

    it("does nothing when subscription is already null", () => {
      autoProcessorService.stop();
      autoProcessorService.stop();
      expect(
        (autoProcessorService as unknown as { subscription: null })
          .subscription,
      ).toBeNull();
    });
  });

  describe("concurrency", () => {
    it("processes multiple bookmarks in parallel", async () => {
      const bms = [
        createRxDoc("bm-1", { title: "BM1" }),
        createRxDoc("bm-2", { title: "BM2" }),
        createRxDoc("bm-3", { title: "BM3" }),
      ];

      await autoProcessorService.start();
      bookmarkSubject.next(bms);
      documentSubject.next([]);

      await vi.waitFor(() => {
        expect(taggingService.generateSummary).toHaveBeenCalledTimes(3);
      });
    });

    it("processes multiple documents in parallel", async () => {
      const docs = [
        createRxDoc("doc-1", { title: "D1", folderId: "f1" }),
        createRxDoc("doc-2", { title: "D2", folderId: "f2" }),
      ];

      await autoProcessorService.start();
      bookmarkSubject.next([]);
      documentSubject.next(docs);

      await vi.waitFor(() => {
        expect(taggingService.generateSummary).toHaveBeenCalledTimes(2);
      });
    });

    it("handles mix of bookmark and document errors", async () => {
      const bm = createRxDoc("bm-1");
      const doc = createRxDoc("doc-1", { folderId: "f1" });

      (taggingService.generateSummary as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error("bm error"))
        .mockRejectedValueOnce(new Error("doc error"));

      await autoProcessorService.start();
      bookmarkSubject.next([bm]);
      documentSubject.next([doc]);

      await vi.waitFor(() => {
        expect(logger.error).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe("edge cases", () => {
    it("handles bookmark with undefined content", async () => {
      const bm = createRxDoc("bm-1", { content: undefined });

      await autoProcessorService.start();
      bookmarkSubject.next([bm]);
      documentSubject.next([]);

      await vi.waitFor(() => {
        expect(ragEngine.generateEmbedding).toHaveBeenCalled();
      });
    });

    it("handles document with undefined textContent", async () => {
      const doc = createRxDoc("doc-1", {
        textContent: undefined,
        folderId: "f1",
      });

      await autoProcessorService.start();
      bookmarkSubject.next([]);
      documentSubject.next([doc]);

      await vi.waitFor(() => {
        expect(ragEngine.generateEmbedding).toHaveBeenCalled();
      });
    });

    it("handles empty bookmark array", async () => {
      await autoProcessorService.start();
      bookmarkSubject.next([]);
      documentSubject.next([]);

      await vi.waitFor(() => {
        expect(logger.info).toHaveBeenCalledWith(
          "[AutoProcessor] No new items to process",
        );
      });
    });

    it("handles document with folderId not root and not empty", async () => {
      const doc = createRxDoc("doc-1", { folderId: "custom-folder" });

      await autoProcessorService.start();
      bookmarkSubject.next([]);
      documentSubject.next([doc]);

      await vi.waitFor(() => {
        expect(doc.incrementalPatch).toHaveBeenCalled();
      });
      expect(taggingService.suggestFolder).not.toHaveBeenCalled();
    });

    it("vectorIndexService returns neighbors with similarity exactly 0.75 (excluded)", async () => {
      const bm = createRxDoc("bm-1");
      (vectorIndexService.search as ReturnType<typeof vi.fn>).mockResolvedValue(
        {
          neighbors: [
            { id: "n1", similarity: 0.75, title: "exact", url: "bookmark" },
          ],
        },
      );

      await autoProcessorService.start();
      bookmarkSubject.next([bm]);
      documentSubject.next([]);

      await vi.waitFor(() => {
        expect(bm.incrementalPatch).toHaveBeenCalledWith(
          expect.objectContaining({ relatedLinks: [] }),
        );
      });
    });

    it("vectorIndexService returns neighbors with similarity just above 0.75 (included)", async () => {
      const bm = createRxDoc("bm-1");
      (vectorIndexService.search as ReturnType<typeof vi.fn>).mockResolvedValue(
        {
          neighbors: [
            { id: "n1", similarity: 0.751, title: "close", url: "bookmark" },
          ],
        },
      );

      await autoProcessorService.start();
      bookmarkSubject.next([bm]);
      documentSubject.next([]);

      await vi.waitFor(() => {
        expect(bm.incrementalPatch).toHaveBeenCalledWith(
          expect.objectContaining({ relatedLinks: ["close"] }),
        );
      });
    });

    it("vectorIndexService returns null neighbors", async () => {
      const bm = createRxDoc("bm-1");
      (vectorIndexService.search as ReturnType<typeof vi.fn>).mockResolvedValue(
        null,
      );

      await autoProcessorService.start();
      bookmarkSubject.next([bm]);
      documentSubject.next([]);

      await vi.waitFor(() => {
        expect(taggingService.generateSummary).toHaveBeenCalled();
      });
    });

    it("multiple debounced events are combined", async () => {
      await autoProcessorService.start();
      bookmarkSubject.next([createRxDoc("bm-1")]);
      bookmarkSubject.next([createRxDoc("bm-2")]);
      documentSubject.next([]);

      await vi.waitFor(() => {
        expect(taggingService.generateSummary).toHaveBeenCalled();
      });
    });

    it("processChunks uses fallback title when textContent is empty for document", async () => {
      const doc = createRxDoc("doc-1", {
        textContent: "",
        title: "Doc Title",
        folderId: "f1",
      });

      await autoProcessorService.start();
      bookmarkSubject.next([]);
      documentSubject.next([doc]);

      await vi.waitFor(() => {
        expect(ChunkingService.splitText).toHaveBeenCalledWith(
          "Doc Title",
          1000,
          200,
        );
      });
    });
  });

  describe("batch lifecycle", () => {
    it("stops dequeuing items after the batch is invalidated", async () => {
      const internals = autoProcessorService as unknown as {
        useCount: number;
        processBatch: (results: unknown[]) => Promise<void>;
      };
      internals.useCount = 1;
      const summaryResolvers: Array<(value: string) => void> = [];
      (
        taggingService.generateSummary as ReturnType<typeof vi.fn>
      ).mockImplementation(
        () => new Promise((resolve) => { summaryResolvers.push(resolve); }),
      );
      const bookmarks = [
        createRxDoc("bm-1"),
        createRxDoc("bm-2"),
        createRxDoc("bm-3"),
      ];
      const batch = internals.processBatch([bookmarks, []]);
      await vi.waitFor(() => {
        expect(taggingService.generateSummary).toHaveBeenCalledTimes(2);
      });
      const batchSignal = (
        taggingService.generateSummary as ReturnType<typeof vi.fn>
      ).mock.calls[0]![4];
      expect(batchSignal).toBeInstanceOf(AbortSignal);

      autoProcessorService.stop();
      expect(batchSignal.aborted).toBe(true);
      for (const resolve of summaryResolvers) {resolve("summary");}
      await batch;

      expect(taggingService.generateSummary).toHaveBeenCalledTimes(2);
    });
  });

  describe("subscription lifecycle", () => {
    it("abandons a retry check that becomes stale after stop", async () => {
      const internals = autoProcessorService as unknown as {
        useCount: number;
        lifecycleGeneration: number;
        runRetryCheck: (generation: number) => Promise<void>;
      };
      internals.useCount = 1;
      let resolveInit!: (db: MockDb) => void;
      (initDB as ReturnType<typeof vi.fn>).mockReturnValueOnce(
        new Promise((resolve) => { resolveInit = resolve; }),
      );
      const retry = internals.runRetryCheck(internals.lifecycleGeneration);
      await vi.waitFor(() => expect(initDB).toHaveBeenCalledTimes(1));

      autoProcessorService.stop();
      resolveInit!(mockDb);
      await retry;

      expect(mockDb.bookmarks.find).not.toHaveBeenCalled();
      expect(mockDb.documents.find).not.toHaveBeenCalled();
    });

    it("start creates subscription observable", async () => {
      await autoProcessorService.start();
      expect(
        (autoProcessorService as unknown as { subscription: unknown })
          .subscription,
      ).toBeTruthy();
    });

    it("stop clears subscription", async () => {
      await autoProcessorService.start();
      autoProcessorService.stop();
      expect(
        (autoProcessorService as unknown as { subscription: null })
          .subscription,
      ).toBeNull();
    });

    it("start after stop creates new subscription", async () => {
      await autoProcessorService.start();
      autoProcessorService.stop();
      await autoProcessorService.start();
      expect(
        (autoProcessorService as unknown as { subscription: unknown })
          .subscription,
      ).toBeTruthy();
    });
  });
});
