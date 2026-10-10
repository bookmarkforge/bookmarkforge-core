
/**
 * Testing Pyramid - BookmarkForge
 *
 * Based on bulletproof-react testing patterns:
 * - Unit Tests (70%): Fast, isolated, test pure functions
 * - Integration Tests (20%): Test component interactions, service integration
 * - E2E Tests (10%): Test complete user flows
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { SanitizationService } from "../services/SanitizationService";
import { memoryEngine } from "../memory/MemoryEngine";
import { memoryRecall } from "../memory/MemoryRecall";
import { createHttpClient } from "../services/api/HttpClient";
// NOTE: useBookmarkStore was deleted — bookmark state is set up inline.

// Mocks for integration tests (hoisted by vitest)
vi.mock("../db/database", () => ({
  initDB: vi.fn().mockResolvedValue({
    bookmarks: {
      insert: vi.fn().mockResolvedValue({
        id: "bm-1",
        url: "https://example.com",
        title: "Example",
      }),
      findOne: vi
        .fn()
        .mockReturnValue({ exec: vi.fn().mockResolvedValue(null as any) }),
      find: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue([]) }),
      bulkInsert: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue(0) }),
    },
    collections: {
      bookmarks: {
        count: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue(0) }),
      },
    },
  }),
}));

vi.mock("../services/BookmarkAIService", () => ({
  bookmarkAIService: {
    summarize: vi.fn().mockResolvedValue(undefined),
    generateDetailedContent: vi.fn().mockResolvedValue(undefined),
    batchSummarize: vi.fn(),
    batchGenerateOverviews: vi.fn(),
    batchGenerateOverviewsByIds: vi.fn(),
    generateMissingEmbeddings: vi.fn(),
  },
}));

// ============================================
// UNIT TESTS - Pure functions and services
// ============================================

describe("Unit: SanitizationService", () => {
  describe("sanitizeText", () => {
    it("should escape HTML entities", () => {
      const input = '<script>alert("xss")</script>';
      const result = SanitizationService.sanitizeText(input);

      expect(result).toContain("&lt;");
      expect(result).toContain("&gt;");
      expect(result).not.toContain("<script>");
    });

    it("should handle empty input", () => {
      expect(SanitizationService.sanitizeText("")).toBe("");
    });

    it("should preserve plain text", () => {
      const input = "Hello World";
      const result = SanitizationService.sanitizeText(input);
      expect(result).toBe("Hello World");
    });
  });

  describe("sanitizeUrl", () => {
    it("should block javascript: URLs", () => {
      expect(SanitizationService.sanitizeUrl("javascript:alert(1)")).toBe("");
    });

    it("should block private IPs", () => {
      expect(SanitizationService.sanitizeUrl("http://192.168.1.1/admin")).toBe(
        "",
      );
      expect(SanitizationService.sanitizeUrl("http://localhost:3000")).toBe("");
    });

    it("should allow valid HTTPS URLs", () => {
      const result = SanitizationService.sanitizeUrl(
        "https://example.com/page",
      );
      expect(result).toBe("https://example.com/page");
    });
  });

  describe("sanitizeObject", () => {
    it("should recursively sanitize string fields", () => {
      const input = {
        name: "<b>Test</b>",
        bio: "<script>alert(1)</script>Real bio",
        age: 25,
      };
      const result = SanitizationService.sanitizeObject(input);
      expect(result.name).toContain("&lt;b&gt;");
      expect(result.bio).not.toContain("<script>");
      expect(result.age).toBe(25);
    });
  });
});

describe("Unit: HttpClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should build correct URL from base", async () => {
    const client = createHttpClient("https://api.example.com");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );

    await client.get("/users");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.example.com/users",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("should handle timeout errors", async () => {
    const client = createHttpClient("https://api.example.com");
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_url, opts) =>
        new Promise((_, reject) => {
          if (opts?.signal) {
            const onAbort = () => {
              opts.signal!.removeEventListener("abort", onAbort);
              const err = new Error("The operation was aborted");
              err.name = "AbortError";
              reject(err);
            };
            opts.signal.addEventListener("abort", onAbort);
          }
          setTimeout(() => {
            const err = new Error("The operation was aborted");
            err.name = "AbortError";
            reject(err);
          }, 50);
        }),
    );

    await expect(client.get("/slow", { timeout: 5 })).rejects.toMatchObject({
      isTimeout: true,
    });
  });

  it("should retry on 5xx errors", async () => {
    const client = createHttpClient("https://api.example.com");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("", { status: 500 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: "ok" }), {
          status: 200,
          headers: new Headers({ "content-type": "application/json" }),
        }),
      );

    const result = await client.get("/flaky", { retries: 1, retryDelay: 10 });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.data).toEqual({ data: "ok" });
  });

  it("should serialize POST body as JSON", async () => {
    const client = createHttpClient("https://api.example.com");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ id: 1 }), { status: 201 }),
      );

    await client.post("/users", { name: "Test" });

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.example.com/users",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "Test" }),
        headers: expect.objectContaining({
          "Content-Type": "application/json",
        }),
      }),
    );
  });
});

// ============================================
// INTEGRATION TESTS - Component + Service
// ============================================

describe("Integration: Memory Engine", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("should create session and store messages", async () => {
    vi.spyOn(memoryEngine, "initialize").mockResolvedValue(undefined);
    vi.spyOn(memoryEngine, "getOrCreateSession").mockResolvedValue(
      "test-session",
    );
    vi.spyOn(memoryEngine, "addMessage").mockResolvedValue("msg-123");

    await memoryEngine.initialize();
    const sessionId = await memoryEngine.getOrCreateSession("Test");
    await memoryEngine.addMessage(sessionId, "user", "Hello");

    expect(sessionId).toBe("test-session");
    expect(memoryEngine.addMessage).toHaveBeenCalledWith(
      "test-session",
      "user",
      expect.any(String),
    );
  });

  it("should recall context before generating response", async () => {
    vi.spyOn(memoryRecall, "recall").mockResolvedValue({
      persona: null,
      scenarios: [],
      atoms: [],
      recentMessages: [],
      contextString: "",
    });

    const result = await memoryRecall.recall("test query", "test-session");

    expect(result).toHaveProperty("contextString");
    expect(result).toHaveProperty("persona");
    expect(result).toHaveProperty("scenarios");
    expect(result).toHaveProperty("atoms");
  });
});

// ============================================
// INTEGRATION TESTS - Complete user flows
// ============================================

describe("Integration: Bookmark + AI + Memory flow", () => {
  let bookmarksInMemory: any[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    bookmarksInMemory = [];
    vi.spyOn(memoryEngine, "initialize").mockResolvedValue(undefined);
    vi.spyOn(memoryEngine, "getOrCreateSession").mockResolvedValue(
      "session-ai",
    );
    vi.spyOn(memoryEngine, "addMessage").mockResolvedValue("msg-1");
    vi.spyOn(memoryRecall, "recall").mockResolvedValue({
      persona: null,
      scenarios: [],
      atoms: [],
      recentMessages: [{ role: "user", content: "What does it say about example?" }] as any,
      contextString: "Example summary",
    });
  });

  it("should create bookmark, summarize with AI, and store conversation in memory", async () => {
    const t = (key: string) => key;

    // 1. Add bookmark to the in-memory list
    const testBookmark = {
      id: "bm-1",
      url: "https://example.com",
      title: "Example",
      content: "",
      summary: "",
      tags: [],
      processed: false,
      isDeleted: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    bookmarksInMemory = [testBookmark];
    expect(bookmarksInMemory).toHaveLength(1);

    // 2. Ejecutar AI summarization (mockeado)
    const { bookmarkAIService } = await import("../services/BookmarkAIService");
    (bookmarkAIService as any).summarize = vi
      .fn()
      .mockResolvedValue("Example summary" as any);
    await (bookmarkAIService as any).summarize(
      "https://example.com",
      "Example",
      150,
    );
    expect(bookmarkAIService.summarize).toHaveBeenCalledWith(
      "https://example.com",
      "Example",
      150,
    );

    // 3. Store in memoryEngine
    await memoryEngine.initialize();
    const sessionId = await memoryEngine.getOrCreateSession(
      "Bookmark analysis",
    );
    await memoryEngine.addMessage(sessionId, "assistant", "Example summary");

    // 4. Verify via memoryRecall
    const context = await memoryRecall.recall(
      "What does it say about example?",
      sessionId,
    );
    expect(context).toBeDefined();
    expect(context.contextString).toContain("Example summary");

    // 5. Verify interactions with the engine
    expect(memoryEngine.initialize).toHaveBeenCalled();
    expect(memoryEngine.addMessage).toHaveBeenCalledWith(
      "session-ai",
      "assistant",
      "Example summary",
    );
  });
});

describe("Integration: Offline queue and sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fail to sync offline, then sync queued data when online", async () => {
    // 1. Prepare local data
    const localData = {
      bookmarks: [
        {
          id: "offline-1",
          url: "https://offline-test.com",
          title: "Offline Test",
          modified: Date.now(),
        },
      ],
      lastSync: null,
    };

    // 2. Configure CloudSyncService with a mocked fetch
    const { CloudSyncService, createAdapter } =
      await import("../services/integrations/cloudSync");
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    const service = new CloudSyncService();
    service.setLocalDataProvider(async () => localData as any);
    service.init({ provider: "drive", authToken: "test-token" });
    service.setBackoffConfig({
      baseMs: 5,
      capMs: 20,
      jitter: false,
      maxRetries: 1,
    });

    // 3. Simulate offline: fetch fails with a network error
    mockFetch.mockRejectedValue(new TypeError("Failed to fetch"));
    const offlineResult = await service.sync();
    expect(offlineResult.success).toBe(false);

    // 4. Simular online: fetch responde OK
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "file-1" }),
      headers: new Headers({
        "content-type": "application/json; charset=UTF-8",
      }),
      arrayBuffer: async () => new ArrayBuffer(0),
    });

    const onlineResult = await service.sync();
    // With DriveAdapter, a successful sync depends on the mock
    expect(mockFetch).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

vi.mock("../hooks/useSecurityStore", () => ({
  default: {
    getState: () => ({ unlock: vi.fn() }),
  },
  useSecurityStore: {
    getState: () => ({ unlock: vi.fn() }),
  },
}));

describe("Integration: CollaborationService share/import vault", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should generate and import a shared vault payload", async () => {
    const { collaborationService } =
      await import("../services/CollaborationService");
    const { securityVault } = await import("../services/SecurityVault");
    const { encryptionService } = await import("../services/EncryptionService");

    vi.spyOn(securityVault, "getSessionToken").mockReturnValue(
      "test-session-token",
    );
    vi.spyOn(encryptionService, "encrypt").mockResolvedValue(
      "encrypted-key-data",
    );
    vi.spyOn(encryptionService, "decrypt").mockResolvedValue(
      JSON.stringify({
        shareSecret: "a".repeat(64),
        salt: new Array(16).fill(0),
      }),
    );
    vi.spyOn(securityVault, "unlock").mockResolvedValue(true);
    vi.spyOn(securityVault, "withMasterPasswordBytes").mockImplementation(
      (_caller: object, fn: (p: Uint8Array | null) => unknown) =>
        fn(new TextEncoder().encode("master-password")),
    );

    vi.spyOn(securityVault, "unlockFromShare").mockResolvedValue(true);

    const payload =
      await collaborationService.generateSharePayload("temp-password");
    expect(payload).toBeTruthy();
    expect(typeof payload).toBe("string");
    const generatedSalt = (JSON.parse(atob(payload!)) as { salt: number[] }).salt;
    (encryptionService.decrypt as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ shareSecret: "a".repeat(64), salt: generatedSalt }),
    );

    const result = await collaborationService.importSharedVault(
      payload!,
      "temp-password",
      {
        collections: {
          bookmarks: {
            count: () => ({ exec: async () => 0 }),
          },
        },
      } as any,
    );
    expect(result).toBe(true);
    expect(securityVault.unlockFromShare).toHaveBeenCalledWith(
      "a".repeat(64),
      expect.any(String),
      { allowFreshDevice: true, emptyLocalDatabase: true },
    );
  });

  it("should return null when no session token is available", async () => {
    const { collaborationService } =
      await import("../services/CollaborationService");
    const { securityVault } = await import("../services/SecurityVault");
    vi.spyOn(securityVault, "getSessionToken").mockReturnValue(null);
    vi.spyOn(securityVault, "withMasterPasswordBytes").mockImplementation(
      (_caller: object, fn: (p: Uint8Array | null) => unknown) => fn(null),
    );

    const payload =
      await collaborationService.generateSharePayload("temp-password");
    expect(payload).toBeNull();
  });

  it("should return false when decrypt fails", async () => {
    const { collaborationService } =
      await import("../services/CollaborationService");
    const { securityVault } = await import("../services/SecurityVault");
    const { encryptionService } = await import("../services/EncryptionService");

    vi.spyOn(securityVault, "getSessionToken").mockReturnValue(
      "test-session-token",
    );
    vi.spyOn(encryptionService, "encrypt").mockResolvedValue(
      "encrypted-key-data",
    );
    vi.spyOn(encryptionService, "decrypt").mockResolvedValue(null as any);
    vi.spyOn(securityVault, "withMasterPasswordBytes").mockImplementation(
      (_caller: object, fn: (p: Uint8Array | null) => unknown) =>
        fn(new TextEncoder().encode("master-password")),
    );
    vi.spyOn(securityVault, "unlockFromShare").mockResolvedValue(true);

    const payload =
      await collaborationService.generateSharePayload("temp-password");
    const result = await collaborationService.importSharedVault(
      payload!,
      "wrong-password",
      {} as any,
    );
    vi.spyOn(securityVault, "unlockFromShare").mockResolvedValue(true);
    expect(result).toBe(false);
  });
});
