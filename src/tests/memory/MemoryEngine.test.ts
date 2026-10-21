import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type {
  MemorySession,
  MemoryChatMessage,
} from "../../memory/MemoryTypes";
import { DEFAULT_PIPELINE_CONFIG } from "../../memory/MemoryTypes";

const mockStoreState = {
  setPersona: vi.fn(),
  updateCounts: vi.fn(),
  setActiveSession: vi.fn(),
  get activeSessionId() {
    return this._activeSessionId ?? null;
  },
  set activeSessionId(v: string | null) {
    this._activeSessionId = v;
  },
  _activeSessionId: null as string | null,
  reset: vi.fn(),
};

vi.mock("../../db/database", () => ({ initDB: vi.fn() }));
vi.mock("../../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../../memory/MemoryPipeline", () => ({
  memoryPipeline: { onNewMessage: vi.fn(), getStats: vi.fn(), reset: vi.fn() },
}));
vi.mock("../../memory/MemoryRecall", () => ({
  memoryRecall: { recall: vi.fn() },
}));
vi.mock("../../store/useMemoryStore", () => ({
  useMemoryStore: { getState: () => mockStoreState },
}));
vi.mock("../../services/ai/ProviderManager", () => ({
  aiManager: { generateText: vi.fn() },
}));

import { initDB } from "../../db/database";
import { memoryPipeline } from "../../memory/MemoryPipeline";
import { memoryRecall } from "../../memory/MemoryRecall";
import { useMemoryStore } from "../../store/useMemoryStore";
import { memoryEngine } from "../../memory/MemoryEngine";

describe("MemoryEngine", () => {
  let mockDb: any;

  function mockFindOne<T>(doc: T | null) {
    return vi.fn().mockReturnValue({
      exec: vi
        .fn()
        .mockResolvedValue(doc ? { toJSON: () => doc, incrementalPatch: vi.fn() } : null),
    });
  }
  function mockFind<T>(docs: T[]) {
    return vi.fn().mockReturnValue({
      exec: vi.fn().mockResolvedValue(docs.map((d) => ({ toJSON: () => d }))),
    });
  }
  function mockCount<T>(val: T) {
    return vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue(val) });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    (memoryEngine as any).initialized = false;
    (memoryEngine as any).sessionIdleTimers = new Map();
    (memoryEngine as any).sessionWriteQueues = new Map();
    (memoryEngine as any).memoryClearPromise = null;
    (memoryEngine as any).vaultTransitionPromise = null;
    (memoryEngine as any).releaseVaultTransition = null;
    mockStoreState._activeSessionId = null;

    mockDb = {
      memory: {
        find: vi.fn(),
        findOne: vi.fn(),
        insert: vi.fn(),
        count: vi.fn(),
      },
    };
    (initDB as any).mockResolvedValue(mockDb);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("isInitialized", () => {
    it("returns false before initialize", () =>
      expect(memoryEngine.isInitialized()).toBe(false));
  });

  describe("initialize", () => {
    it("sets initialized = true", async () => {
      mockDb.memory.findOne = mockFindOne(null);
      (memoryPipeline.getStats as any).mockResolvedValue({
        atoms: 0,
        scenarios: 0,
      });
      await memoryEngine.initialize();
      expect(memoryEngine.isInitialized()).toBe(true);
    });

    it("no inicializa dos veces", async () => {
      mockDb.memory.findOne = mockFindOne(null);
      (memoryPipeline.getStats as any).mockResolvedValue({
        atoms: 0,
        scenarios: 0,
      });
      await memoryEngine.initialize();
      await memoryEngine.initialize();
      expect(initDB).toHaveBeenCalledTimes(1);
    });

    it("loads existing person into the store", async () => {
      const persona = {
        id: "persona",
        preferences: [],
        goals: [],
        tone: "",
        workflows: [],
        updatedAt: "",
        generatedFromScenarioIds: [],
      };
      mockDb.memory.findOne = mockFindOne(persona);
      (memoryPipeline.getStats as any).mockResolvedValue({
        atoms: 0,
        scenarios: 0,
      });
      await memoryEngine.initialize();
      expect(mockStoreState.setPersona).toHaveBeenCalledWith(persona);
    });

    it("updates counters from pipeline", async () => {
      mockDb.memory.findOne = mockFindOne(null);
      (memoryPipeline.getStats as any).mockResolvedValue({
        atoms: 5,
        scenarios: 2,
      });
      await memoryEngine.initialize();
      expect(mockStoreState.updateCounts).toHaveBeenCalledWith(5, 2);
    });

    it("does not throw if the DB fails", async () => {
      (initDB as any).mockRejectedValue(new Error("down"));
      await expect(memoryEngine.initialize()).resolves.toBeUndefined();
      expect(memoryEngine.isInitialized()).toBe(false);
    });
  });

  describe("vault transition", () => {
    it("blocks writes during lock and allows new ones after unlock", async () => {
      let resolveInsert!: (value: { remove: ReturnType<typeof vi.fn> }) => void;
      const insertedMessage = { remove: vi.fn() };
      mockDb.memory.findOne = vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue(null),
      });
      const insert = vi.fn()
        .mockReturnValueOnce(new Promise((resolve) => { resolveInsert = resolve; }))
        .mockResolvedValue({ remove: vi.fn() });
      mockDb.memory.insert = insert;

      const inFlight = memoryEngine.addMessage("s1", "user", "before-lock");
      for (let attempt = 0; attempt < 10 && !insert.mock.calls.length; attempt += 1) {
        await Promise.resolve();
      }
      (memoryEngine as any).beginVaultTransition();
      const blocked = memoryEngine.addMessage("s1", "user", "during-lock");
      await Promise.resolve();
      expect(insert).toHaveBeenCalledTimes(1);

      resolveInsert(insertedMessage);
      await expect(inFlight).resolves.toEqual(expect.any(String));
      (memoryEngine as any).endVaultTransition();
      await expect(blocked).rejects.toMatchObject({ name: "AbortError" });

      await expect(memoryEngine.addMessage("s1", "user", "after-unlock"))
        .resolves.toEqual(expect.any(String));
      expect(insert).toHaveBeenCalledTimes(2);
    });
  });

  describe("createSession", () => {
    it("creates session with given title", async () => {
      const id = await memoryEngine.createSession("My session");
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(mockDb.memory.insert).toHaveBeenCalledWith(
        expect.objectContaining({ title: "My session" }),
      );
    });
    it("sets active session in store", async () => {
      await memoryEngine.createSession("test");
      expect(mockStoreState.setActiveSession).toHaveBeenCalled();
    });
    it("messageIds starts empty", async () => {
      await memoryEngine.createSession("test");
      expect(mockDb.memory.insert.mock.calls[0][0].messageIds).toEqual(
        [],
      );
    });
    it("startedAt and lastActive are ISO", async () => {
      await memoryEngine.createSession("test");
      const doc = mockDb.memory.insert.mock.calls[0][0];
      expect(doc.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(doc.lastActive).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe("addMessage", () => {
    const sessionDoc = {
      toJSON: () =>
        ({
          id: "s1",
          title: "",
          messageIds: ["msg_0"],
          startedAt: "",
          lastActive: "",
        }) as MemorySession,
      incrementalPatch: vi.fn(),
    };

    it("inserts the message into the DB", async () => {
      mockDb.memory.findOne = vi
        .fn()
        .mockReturnValue({ exec: vi.fn().mockResolvedValue(null) });
      await memoryEngine.addMessage("s1", "user", "Hola");
      expect(mockDb.memory.insert).toHaveBeenCalledWith(
        expect.objectContaining({ role: "user", content: "Hola" }),
      );
    });
    it("updates messageIds and lastActive", async () => {
      const patchSpy = vi.fn();
      mockDb.memory.findOne = vi
        .fn()
        .mockReturnValue({ exec: vi.fn().mockResolvedValue(sessionDoc) });
      sessionDoc.incrementalPatch = patchSpy;
      await memoryEngine.addMessage("s1", "user", "Hola");
      expect(patchSpy).toHaveBeenCalledWith(
        expect.objectContaining({ messageIds: ["msg_0", expect.any(String)] }),
      );
    });
    it("calls pipeline.onNewMessage if the role is user", async () => {
      mockDb.memory.findOne = vi
        .fn()
        .mockReturnValue({ exec: vi.fn().mockResolvedValue(null) });
      const id = await memoryEngine.addMessage("s1", "user", "Hola");
      expect(memoryPipeline.onNewMessage).toHaveBeenCalledWith(
        expect.objectContaining({ id }),
      );
    });

    it("does not wait for background memory extraction", async () => {
      mockDb.memory.findOne = vi
        .fn()
        .mockReturnValue({ exec: vi.fn().mockResolvedValue(null) });
      let releaseExtraction!: () => void;
      (memoryPipeline.onNewMessage as any).mockReturnValueOnce(
        new Promise<void>((resolve) => {
          releaseExtraction = resolve;
        }),
      );

      await expect(memoryEngine.addMessage("s1", "user", "Hola")).resolves.toEqual(
        expect.any(String),
      );
      releaseExtraction();
    });
    it.each(["assistant", "system"] as const)(
      "NO llama pipeline.onNewMessage si rol es %s",
      async (role) => {
        mockDb.memory.findOne = vi
          .fn()
          .mockReturnValue({ exec: vi.fn().mockResolvedValue(null) });
        await memoryEngine.addMessage("s1", role, "test");
        expect(memoryPipeline.onNewMessage).not.toHaveBeenCalled();
      },
    );

    // ── Privacidad: el flag isPrivate se persiste y se propaga ──
    it("persists isPrivate=true on the inserted message", async () => {
      mockDb.memory.findOne = vi
        .fn()
        .mockReturnValue({ exec: vi.fn().mockResolvedValue(null) });
      await memoryEngine.addMessage("s1", "user", "secreto", undefined, true);
      expect(mockDb.memory.insert).toHaveBeenCalledWith(
        expect.objectContaining({ content: "secreto", isPrivate: true }),
      );
    });

    it("saves isPrivate=false by default", async () => {
      mockDb.memory.findOne = vi
        .fn()
        .mockReturnValue({ exec: vi.fn().mockResolvedValue(null) });
      await memoryEngine.addMessage("s1", "user", "public");
      expect(mockDb.memory.insert).toHaveBeenCalledWith(
        expect.objectContaining({ isPrivate: false }),
      );
    });

    it("omits undefined sources from the stored message", async () => {
      mockDb.memory.findOne = vi
        .fn()
        .mockReturnValue({ exec: vi.fn().mockResolvedValue(null) });
      await memoryEngine.addMessage("s1", "assistant", "respuesta");
      expect(mockDb.memory.insert.mock.calls[0]![0]).not.toHaveProperty(
        "sources",
      );
    });

    it("does not send private messages to the memory pipeline", async () => {
      mockDb.memory.findOne = vi
        .fn()
        .mockReturnValue({ exec: vi.fn().mockResolvedValue(null) });
      await memoryEngine.addMessage("s1", "user", "secreto", undefined, true);
      expect(memoryPipeline.onNewMessage).not.toHaveBeenCalled();
    });
  });

  describe("closeSession", () => {
    it("clears active session in store", async () => {
      mockDb.memory.findOne = vi
        .fn()
        .mockReturnValue({ exec: vi.fn().mockResolvedValue(null) });
      mockDb.memory.find = vi
        .fn()
        .mockReturnValue({ exec: vi.fn().mockResolvedValue([]) });
      await memoryEngine.closeSession("s1");
      expect(mockStoreState.setActiveSession).toHaveBeenCalledWith(null);
    });
    it("does not generate a summary if < 4 messages", async () => {
      const patchSpy = vi.fn();
      mockDb.memory.findOne = vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue({
          toJSON: () => ({ messageIds: ["m1"] }) as MemorySession,
          incrementalPatch: patchSpy,
        }),
      });
      mockDb.memory.find = vi
        .fn()
        .mockReturnValue({ exec: vi.fn().mockResolvedValue([]) });
      await memoryEngine.closeSession("s1");
      expect(patchSpy).not.toHaveBeenCalled();
    });

    it("generates a summary if >= 4 messages", async () => {
      // Arrange: 4 messages in DB
      const msgs = Array.from({ length: 4 }, (_, i) => ({
        toJSON: () =>
          ({
            id: `m${i}`,
            sessionId: "s1",
            role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
            isPrivate: false,
            content: `Message ${i}`,
            createdAt: `2025-01-0${i + 1}T00:00:00.000Z`,
          }) as MemoryChatMessage,
      }));
      mockDb.memory.find = vi.fn().mockReturnValue({
        exec: vi
          .fn()
          .mockResolvedValue(msgs), // desc order, luego reverse()
      });

      // Mock aiManager for generateSessionSummary
      const { aiManager } = await import("../../services/ai/ProviderManager");
      (aiManager.generateText as any).mockResolvedValue({
        text: "Session summary",
      });

      const patchSpy = vi.fn();
      mockDb.memory.findOne = vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue({
          toJSON: () =>
            ({
              id: "s1",
              title: "test",
              messageIds: ["m0", "m1", "m2", "m3"],
              startedAt: "",
              lastActive: "",
            }) as MemorySession,
          incrementalPatch: patchSpy,
        }),
      });

      await memoryEngine.closeSession("s1");
      expect(patchSpy).toHaveBeenCalledWith(
        expect.objectContaining({ summary: "Session summary" }),
      );
    });

    it("does not generate a summary if all messages are private", async () => {
      const patchSpy = vi.fn();
      mockDb.memory.findOne = vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue({
          toJSON: () => ({ messageIds: ["m0"] }) as MemorySession,
          incrementalPatch: patchSpy,
        }),
      });
      const msgs = Array.from({ length: 4 }, (_, i) => ({
        toJSON: () =>
          ({
            id: `m${i}`,
            sessionId: "s1",
            role: "user" as const,
            content: `SECRETO ${i}`,
            isPrivate: true,
            createdAt: `2025-01-0${i + 1}T00:00:00.000Z`,
          }) as MemoryChatMessage,
      }));
      mockDb.memory.find = vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue(msgs),
      });
      const { aiManager } = await import("../../services/ai/ProviderManager");
      await memoryEngine.closeSession("s1");
      // With no public messages there is no summary (private content is never
      // persisted in the session summary).
      expect(aiManager.generateText).not.toHaveBeenCalled();
      expect(patchSpy).not.toHaveBeenCalled();
    });

    it("the summary excludes private messages from the batch", async () => {
      const patchSpy = vi.fn();
      mockDb.memory.findOne = vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue({
          toJSON: () => ({ messageIds: ["m0"] }) as MemorySession,
          incrementalPatch: patchSpy,
        }),
      });
      const msgs = [
        {
          toJSON: () =>
            ({
              id: "m0",
              sessionId: "s1",
              role: "user" as const,
              isPrivate: false,
              content: "recent public",
              createdAt: "2025-01-05T00:00:00.000Z",
            }) as MemoryChatMessage,
        },
        {
          toJSON: () =>
            ({
              id: "m1",
              sessionId: "s1",
              role: "user" as const,
              content: "SECRETO PRIVADO",
              isPrivate: true,
              createdAt: "2025-01-04T00:00:00.000Z",
            }) as MemoryChatMessage,
        },
        {
          toJSON: () =>
            ({
              id: "m2",
              sessionId: "s1",
              role: "user" as const,
              isPrivate: false,
              content: "public 2",
              createdAt: "2025-01-03T00:00:00.000Z",
            }) as MemoryChatMessage,
        },
        {
          toJSON: () =>
            ({
              id: "m3",
              sessionId: "s1",
              role: "user" as const,
              isPrivate: false,
              content: "público 3",
              createdAt: "2025-01-02T00:00:00.000Z",
            }) as MemoryChatMessage,
        },
        {
          toJSON: () =>
            ({
              id: "m4",
              sessionId: "s1",
              role: "user" as const,
              isPrivate: false,
              content: "public 4",
              createdAt: "2025-01-01T00:00:00.000Z",
            }) as MemoryChatMessage,
        },
      ];
      mockDb.memory.find = vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue(msgs),
      });
      const { aiManager } = await import("../../services/ai/ProviderManager");
      (aiManager.generateText as any).mockResolvedValue({
        text: "public summary",
      });
      await memoryEngine.closeSession("s1");
      expect(aiManager.generateText).toHaveBeenCalled();
      // The summary prompt never contains the private message.
      const prompt = vi.mocked(aiManager.generateText).mock.calls[0]![0] as string;
      expect(prompt).not.toContain("PRIVATE SECRET");
      expect(prompt).toContain("recent public");
      expect(patchSpy).toHaveBeenCalledWith(
        expect.objectContaining({ summary: "public summary" }),
      );
    });
  });

  describe("getContextForQuery", () => {
    it("initializes and returns contextString", async () => {
      mockDb.memory.findOne = mockFindOne(null);
      (memoryPipeline.getStats as any).mockResolvedValue({
        atoms: 0,
        scenarios: 0,
      });
      (memoryRecall.recall as any).mockResolvedValue({ contextString: "ctx" });
      expect(await memoryEngine.getContextForQuery("q", "s1")).toBe("ctx");
      expect(memoryEngine.isInitialized()).toBe(true);
    });
    it("does not reinitialize if already ready", async () => {
      (memoryEngine as any).initialized = true;
      (memoryRecall.recall as any).mockResolvedValue({ contextString: "ctx" });
      expect(await memoryEngine.getContextForQuery("q", "s1")).toBe("ctx");
      expect(initDB).not.toHaveBeenCalled();
    });
    it("discards a context that finishes after a vault change", async () => {
      (memoryEngine as any).initialized = true;
      let resolveRecall!: (value: { contextString: string }) => void;
      (memoryRecall.recall as any).mockReturnValue(
        new Promise((resolve) => {
          resolveRecall = resolve;
        }),
      );

      const pendingContext = memoryEngine.getContextForQuery("q", "s1");
      await Promise.resolve();
      memoryEngine.resetForVaultTransition();
      resolveRecall({ contextString: "old-vault-context" });

      await expect(pendingContext).rejects.toMatchObject({
        name: "AbortError",
        message: "Memory recall invalidated",
      });
    });
  });

  describe("getActiveSession / getOrCreateSession", () => {
    it("getActiveSession returns null without an active session", async () => {
      expect(await memoryEngine.getActiveSession()).toBeNull();
    });
    it("getOrCreateSession returns existing one if there is an active session", async () => {
      mockStoreState._activeSessionId = "existing";
      expect(await memoryEngine.getOrCreateSession("Nueva")).toBe("existing");
    });
    it("getOrCreateSession creates a new one if there is no active session", async () => {
      mockStoreState._activeSessionId = null;
      expect(await memoryEngine.getOrCreateSession("Nueva")).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });
  });

  describe("clearAllMemory", () => {
    it("waits for an in-flight session write before clearing collections", async () => {
      let resolveInsert!: (value: { remove: ReturnType<typeof vi.fn> }) => void;
      const insertedMessage = { remove: vi.fn() };
      mockDb.memory.findOne = vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue(null),
      });
      mockDb.memory.insert = vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveInsert = resolve;
        }),
      );
      const removeCalls = [
        vi.fn().mockResolvedValue(undefined),
        vi.fn().mockResolvedValue(undefined),
        vi.fn().mockResolvedValue(undefined),
        vi.fn().mockResolvedValue(undefined),
      ];
      mockDb.memory.find = vi
        .fn()
        .mockReturnValueOnce({ remove: removeCalls[0] })
        .mockReturnValueOnce({ remove: removeCalls[1] })
        .mockReturnValueOnce({ remove: removeCalls[2] })
        .mockReturnValueOnce({ remove: removeCalls[3] });

      const pendingMessage = memoryEngine.addMessage("s1", "user", "late");
      for (let attempt = 0; attempt < 10 && !mockDb.memory.insert.mock.calls.length; attempt += 1) {
        await Promise.resolve();
      }
      expect(mockDb.memory.insert).toHaveBeenCalledTimes(1);
      const clearing = memoryEngine.clearAllMemory();
      await Promise.resolve();

      expect(removeCalls[0]).not.toHaveBeenCalled();
      resolveInsert(insertedMessage);
      await expect(pendingMessage).resolves.toEqual(expect.any(String));
      await expect(clearing).resolves.toBeUndefined();
      expect(removeCalls.every((remove) => remove.mock.calls.length === 1)).toBe(true);
    });

    it("includes session creation in the clear barrier", async () => {
      let resolveInsert!: (value: { remove: ReturnType<typeof vi.fn> }) => void;
      const insertedSession = { remove: vi.fn() };
      mockDb.memory.insert = vi.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveInsert = resolve;
        }),
      );
      const removeSessions = vi.fn().mockResolvedValue(undefined);
      const stubRemove = () => ({ remove: vi.fn().mockResolvedValue(undefined) });
      mockDb.memory.find = vi
        .fn()
        .mockReturnValueOnce(stubRemove()) // atoms
        .mockReturnValueOnce(stubRemove()) // profiles
        .mockReturnValueOnce({ remove: removeSessions }) // sessions
        .mockReturnValueOnce(stubRemove()); // messages

      const creating = memoryEngine.createSession("late");
      for (let attempt = 0; attempt < 10 && !mockDb.memory.insert.mock.calls.length; attempt += 1) {
        await Promise.resolve();
      }
      const clearing = memoryEngine.clearAllMemory();
      await Promise.resolve();
      expect(removeSessions).not.toHaveBeenCalled();

      resolveInsert(insertedSession);
      await expect(creating).resolves.toEqual(expect.any(String));
      await expect(clearing).resolves.toBeUndefined();
      expect(removeSessions).toHaveBeenCalledTimes(1);
    });

    it("delays new writes while clearing is in progress", async () => {
      let resolveRemove!: () => void;
      const removePromise = new Promise<void>((resolve) => {
        resolveRemove = resolve;
      });
      const stubRemove = () => ({ remove: vi.fn().mockResolvedValue(undefined) });
      mockDb.memory.find = vi
        .fn()
        // The first call into the Promise.all resolves the slow remove for
        // atoms; the others resolve immediately.
        .mockReturnValueOnce({
          remove: vi.fn().mockReturnValue(removePromise),
        })
        .mockReturnValueOnce(stubRemove())
        .mockReturnValueOnce(stubRemove())
        .mockReturnValueOnce(stubRemove());
      const insert = vi.fn().mockResolvedValue({ remove: vi.fn() });
      mockDb.memory.insert = insert;
      mockDb.memory.findOne = vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue(null),
      });

      const clearing = memoryEngine.clearAllMemory();
      await Promise.resolve();
      const pendingMessage = memoryEngine.addMessage("s1", "user", "after-clear");
      await Promise.resolve();
      expect(insert).not.toHaveBeenCalled();

      resolveRemove();
      await clearing;
      await expect(pendingMessage).resolves.toEqual(expect.any(String));
      expect(insert).toHaveBeenCalledTimes(1);
    });

    it("clears collections and resets", async () => {
      const atomsRemove = vi.fn().mockResolvedValue(undefined);
      const scenariosRemove = vi.fn().mockResolvedValue(undefined);
      const sessionsRemove = vi.fn().mockResolvedValue(undefined);
      const chatRemove = vi.fn().mockResolvedValue(undefined);
      mockDb.memory.find = vi
        .fn()
        .mockReturnValueOnce({ remove: atomsRemove, exec: vi.fn().mockResolvedValue([]) })
        .mockReturnValueOnce({ remove: scenariosRemove, exec: vi.fn().mockResolvedValue([]) })
        .mockReturnValueOnce({ remove: sessionsRemove, exec: vi.fn().mockResolvedValue([]) })
        .mockReturnValueOnce({ remove: chatRemove, exec: vi.fn().mockResolvedValue([]) });
      mockDb.memory.findOne = vi
        .fn()
        .mockReturnValue({ exec: vi.fn().mockResolvedValue(null) });
      await memoryEngine.clearAllMemory();
      expect(atomsRemove).toHaveBeenCalled();
      expect(memoryPipeline.reset).toHaveBeenCalled();
    });

    it("deletes person (via bulk remove of unified profiles) during clear", async () => {
      const atomsRemove = vi.fn().mockResolvedValue(undefined);
      const scenariosRemove = vi.fn().mockResolvedValue(undefined);
      const sessionsRemove = vi.fn().mockResolvedValue(undefined);
      const chatRemove = vi.fn().mockResolvedValue(undefined);

      mockDb.memory.find = vi
        .fn()
        .mockReturnValueOnce({ remove: atomsRemove })
        .mockReturnValueOnce({ remove: scenariosRemove })
        .mockReturnValueOnce({ remove: sessionsRemove })
        .mockReturnValueOnce({ remove: chatRemove });

      await memoryEngine.clearAllMemory();
      // Bulk remove covers all profiles (including persona) — no separate
      // findOne + remove needed (was dead code).
      expect(scenariosRemove).toHaveBeenCalled();
      expect(memoryPipeline.reset).toHaveBeenCalled();
      expect(mockStoreState.reset).toHaveBeenCalled();
    });
  });

  describe("getStats", () => {
    it("returns stats", async () => {
      mockDb.memory.count = vi
        .fn()
        .mockReturnValueOnce({ exec: vi.fn().mockResolvedValue({ amount: 10 }) })
        .mockReturnValueOnce({ exec: vi.fn().mockResolvedValue({ amount: 5 }) });
      mockDb.memory.find = vi.fn().mockReturnValue({
        exec: vi
          .fn()
          .mockResolvedValue([{ id: "s1" }, { id: "s2" }, { id: "s3" }]),
      });
      mockDb.memory.findOne = vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue({ toJSON: () => ({ id: "p1" }) }),
      });
      expect(await memoryEngine.getStats()).toEqual({
        atoms: 10,
        scenarios: 3,
        hasPersona: true,
        sessions: 5,
      });
    });
    it("hasPersona false sin persona", async () => {
      mockDb.memory.count = vi
        .fn()
        .mockReturnValueOnce({ exec: vi.fn().mockResolvedValue(0) })
        .mockReturnValueOnce({ exec: vi.fn().mockResolvedValue(0) });
      mockDb.memory.find = vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue([]),
      });
      mockDb.memory.findOne = vi
        .fn()
        .mockReturnValue({ exec: vi.fn().mockResolvedValue(null) });
      expect((await memoryEngine.getStats()).hasPersona).toBe(false);
    });
  });

  describe("singleton", () => {
    it("memoryEngine definido", () => {
      expect(memoryEngine).toBeDefined();
    });
  });
});
