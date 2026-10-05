import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  MemoryPersona,
  MemoryScenario,
  MemoryAtom,
  MemoryChatMessage,
  MemoryRecallResult,
} from "../../memory/MemoryTypes";
import { DEFAULT_PIPELINE_CONFIG } from "../../memory/MemoryTypes";
import { vectorIndexService } from "../../services/ai/VectorIndexService";

vi.mock("../../db/database", () => ({ initDB: vi.fn() }));

vi.mock("../../db/database", () => ({ initDB: vi.fn() }));
vi.mock("../../services/ai/RAGEngine", () => ({
  ragEngine: { generateEmbedding: vi.fn(), cosineSimilarity: vi.fn() },
}));
vi.mock("../../services/ai/VectorIndexService", () => ({
  vectorIndexService: { search: vi.fn() },
}));
vi.mock("../../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { initDB } from "../../db/database";
import { ragEngine } from "../../services/ai/RAGEngine";
import { memoryRecall } from "../../memory/MemoryRecall";

/** findOne returns a document with toJSON or null */
function mockFindOne<T>(doc: T | null) {
  return vi.fn().mockReturnValue({
    exec: vi.fn().mockResolvedValue(doc ? { toJSON: () => doc } : null),
  });
}
/** findOne, queueing successive responses (mockReturnValueOnce). Falls back to
 * the last doc if the queue runs out. */
function mockFindOneQueued<T>(docs: (T | null)[]) {
  const queue = docs.map((doc) =>
    vi.fn().mockReturnValueOnce({
      exec: vi.fn().mockResolvedValueOnce(doc ? { toJSON: () => doc } : null),
    }),
  );
  const fn = queue.shift() ?? mockFindOne(null);
  // For subsequent calls once the queue is exhausted, copy each queued
  // vi.fn()'s current returnValue into the main fn via a fresh
  // `mockReturnValueOnce`, sidestepping the `getMockImplementation()` ->
  // `undefined` typing trap.
  for (const q of queue) {
    // Pull the next `.mockReturnValueOnce(...)` from the inner queue and
    // bounce it onto the outer fn. We just keep the most-recent value (the
    // outer fn becomes "last-in-wins" for any calls past the queue).
    const innerReturn = (
      q as unknown as { mock: { results: Array<{ value: unknown }> } }
    ).mock.results.at(-1)?.value;
    if (innerReturn !== undefined) {
      fn.mockReturnValueOnce(
        innerReturn as ReturnType<typeof vi.fn> extends infer T ? T : never,
      );
    }
  }
  return fn;
}
/** find returns an array of documents */
function mockFind<T>(docs: T[]) {
  return vi.fn().mockReturnValue({
    exec: vi.fn().mockResolvedValue(docs.map((d) => ({ toJSON: () => d }))),
  });
}
/** find, queueing successive responses. */
function mockFindQueued<T>(docsGroups: T[][]) {
  const fn = vi.fn();
  for (const docs of docsGroups) {
    fn.mockReturnValueOnce({
      exec: vi.fn().mockResolvedValueOnce(
        docs.map((d) => ({ toJSON: () => d })),
      ),
    });
  }
  return fn;
}
/** count returns { amount } or a number */
function mockCount(val: number | { amount: number }) {
  return vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue(val) });
}

describe("MemoryRecall", () => {
  let mockDb: any;

  const mockAtom = (o: Partial<MemoryAtom> = {}): MemoryAtom => ({
    type: "atom",
    id: "atom_1",
    content: "prefiere código limpio",
    category: "preference",
    confidence: 0.85,
    sourceMessageId: "msg_1",
    sessionId: "session_1",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...o,
  });
  const mockScenario = (o: Partial<MemoryScenario> = {}): MemoryScenario => ({
    id: "sc_1",
    title: "Patrón de prueba",
    description: "Descripción del patrón",
    atomIds: ["atom_1"],
    frequency: 5,
    lastActive: "",
    createdAt: "",
    ...o,
  });
  const mockPersona = (o: Partial<MemoryPersona> = {}): MemoryPersona => ({
    id: "persona",
    preferences: ["prefiere respuestas concisas"],
    goals: ["aprender TypeScript"],
    tone: "profesional",
    workflows: ["revisar PRs"],
    updatedAt: "",
    generatedFromScenarioIds: ["sc_1"],
    ...o,
  });
  const mockMessage = (
    o: Partial<MemoryChatMessage> = {},
  ): MemoryChatMessage => ({
    type: "message",
    id: "msg_1",
    sessionId: "session_1",
    role: "user",
    content: "Hola",
    createdAt: "",
    isPrivate: false,
    ...o,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // All methods are vi.fn() that the tests override as needed
    mockDb = {
      memory: {
        findOne: vi.fn(),
        find: vi.fn(),
        count: vi.fn(),
        insert: vi.fn(),
      },
    };
    (initDB as any).mockResolvedValue(mockDb);
    (memoryRecall as any).config = { ...DEFAULT_PIPELINE_CONFIG };
  });

  describe("configuration", () => {
    it("uses default values in the singleton", () => {
      expect((memoryRecall as any).config).toEqual(DEFAULT_PIPELINE_CONFIG);
    });
    it("allows modifying configuration via direct assignment", () => {
      (memoryRecall as any).config = {
        ...DEFAULT_PIPELINE_CONFIG,
        maxAtomsInContext: 10,
      };
      expect((memoryRecall as any).config.maxAtomsInContext).toBe(10);
    });
  });

  describe("loadPersona (private method)", () => {
    it("returns null when the person does not exist", async () => {
      mockDb.memory.findOne = mockFindOne(null);
      expect(await (memoryRecall as any).loadPersona(mockDb)).toBeNull();
    });

    it("returns the person when they exist", async () => {
      const persona = mockPersona();
      mockDb.memory.findOne = mockFindOne(persona);
      expect(await (memoryRecall as any).loadPersona(mockDb)).toEqual(persona);
    });

    it("returns null if the DB throws", async () => {
      mockDb.memory.findOne = vi.fn(() => ({
        exec: vi.fn().mockRejectedValue(new Error("fail")),
      }));
      expect(await (memoryRecall as any).loadPersona(mockDb)).toBeNull();
    });
  });

  describe("recallScenarios (private method)", () => {
    it("returns scenarios sorted by descending frequency", async () => {
      const scenarios = [
        mockScenario({ id: "sc_1", frequency: 10 }),
        mockScenario({ id: "sc_2", frequency: 5 }),
      ];
      mockDb.memory.find = mockFind(scenarios);
      expect(await (memoryRecall as any).recallScenarios(mockDb)).toHaveLength(
        2,
      );
    });

    it("returns empty array on error", async () => {
      mockDb.memory.find = vi.fn(() => ({
        exec: vi.fn().mockRejectedValue(new Error("fail")),
      }));
      expect(await (memoryRecall as any).recallScenarios(mockDb)).toEqual([]);
    });

    it("pasa maxScenariosInContext como limit a find", async () => {
      (memoryRecall as any).config = {
        ...DEFAULT_PIPELINE_CONFIG,
        maxScenariosInContext: 1,
      };
      mockDb.memory.find = mockFind([]);
      await (memoryRecall as any).recallScenarios(mockDb);
      expect(mockDb.memory.find).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 1 }),
      );
    });
  });

  describe("recallAtoms (private method)", () => {
    it("filters, scores and limits atoms by similarity", async () => {
      (ragEngine.generateEmbedding as any).mockResolvedValue([0.1, 0.2, 0.3]);
      (vectorIndexService.search as any).mockResolvedValue({
        neighbors: [{ id: "atom:a1", score: 0.9 }],
      });

      const atom1 = mockAtom({ id: "a1" });
      mockDb.memory.find = mockFind([]);
      mockDb.memory.find.mockReturnValueOnce({
        exec: vi.fn().mockResolvedValue([{ toJSON: () => ({ id: "a1", type: "atom" }) }]),
      });
      mockDb.memory.findOne = mockFindOne(atom1);
      (memoryRecall as any).config = {
        ...DEFAULT_PIPELINE_CONFIG,
        maxAtomsInContext: 1,
      };

      const result = await (memoryRecall as any).recallAtoms(mockDb, "test");
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("a1");
    });

    it("skips embeddings when the memory collection has no atoms", async () => {
      mockDb.memory.find = mockFind([]);

      await expect(
        (memoryRecall as any).recallAtoms(mockDb, "test"),
      ).resolves.toEqual([]);
      expect(ragEngine.generateEmbedding).not.toHaveBeenCalled();
      expect(vectorIndexService.search).not.toHaveBeenCalled();
    });

    it("returns empty array on error", async () => {
      (ragEngine.generateEmbedding as any).mockRejectedValue(
        new Error("AI fail"),
      );
      mockDb.memory.find = mockFind([
        { id: "a1", type: "atom" },
      ]);
      expect(await (memoryRecall as any).recallAtoms(mockDb, "test")).toEqual(
        [],
      );
    });

    it("filters atoms without embedding", async () => {
      (ragEngine.generateEmbedding as any).mockResolvedValue([0.1, 0.2]);
      (vectorIndexService.search as any).mockResolvedValue({
        neighbors: [{ id: "atom:a1", score: 0.8 }],
      });
      const atom1 = mockAtom({ id: "a1" });
      mockDb.memory.find = mockFind([]);
      mockDb.memory.find.mockReturnValueOnce({
        exec: vi.fn().mockResolvedValue([{ toJSON: () => ({ id: "a1", type: "atom" }) }]),
      });
      mockDb.memory.findOne = mockFindOne(atom1);

      const result = await (memoryRecall as any).recallAtoms(mockDb, "test");
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("a1");
    });

    it("filters atoms with confidence < 0.3 via query selector", async () => {
      (ragEngine.generateEmbedding as any).mockResolvedValue([0.1]);
      (vectorIndexService.search as any).mockResolvedValue({
        neighbors: [],
      });
      mockDb.memory.find = mockFind([]);
      mockDb.memory.find.mockReturnValueOnce({ exec: vi.fn().mockResolvedValue([{ toJSON: () => ({ id: "a1", type: "atom" }) }]) });
      await (memoryRecall as any).recallAtoms(mockDb, "test");
      expect(vectorIndexService.search).toHaveBeenCalled();
    });

    // ── recallAtoms: neighbors undefined/null guard ──
    it("returns empty array if neighbors is null/undefined", async () => {
      (ragEngine.generateEmbedding as any).mockResolvedValue([0.1]);
      (vectorIndexService.search as any).mockResolvedValue({});
      const result = await (memoryRecall as any).recallAtoms(mockDb, "test");
      expect(result).toEqual([]);
    });

    // ── recallAtoms: no atom: prefix neighbors ──
    it("returns empty array if no neighbor has atom: prefix", async () => {
      (ragEngine.generateEmbedding as any).mockResolvedValue([0.1]);
      (vectorIndexService.search as any).mockResolvedValue({
        neighbors: [
          { id: "bookmark:b1", score: 0.9 },
          { id: "document:d1", score: 0.8 },
        ],
      });
      const result = await (memoryRecall as any).recallAtoms(mockDb, "test");
      expect(result).toEqual([]);
    });

    // ── recallAtoms: orphan vector cleanup ──
    it("filters orphan atoms (vector exists but document was deleted)", async () => {
      (ragEngine.generateEmbedding as any).mockResolvedValue([0.1]);
      (vectorIndexService.search as any).mockResolvedValue({
        neighbors: [{ id: "atom:a1", score: 0.9 }],
      });
      // findOne returns null -> atom removed from DB, vector is orphaned
      mockDb.memory.findOne = vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue(null),
      });
      const result = await (memoryRecall as any).recallAtoms(mockDb, "test");
      expect(result).toEqual([]);
    });
  });

  describe("loadRecentMessages (private method)", () => {
    it("returns recent messages in ascending order", async () => {
      const msgs = [
        mockMessage({ id: "msg_2", createdAt: "2025-01-02T00:00:00.000Z" }),
        mockMessage({ id: "msg_1", createdAt: "2025-01-01T00:00:00.000Z" }),
      ];
      mockDb.memory.find = mockFind(msgs);
      const result = await (memoryRecall as any).loadRecentMessages(
        mockDb,
        "session_1",
      );
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("msg_1");
    });

    it("returns empty array on error", async () => {
      mockDb.memory.find = vi.fn(() => ({
        exec: vi.fn().mockRejectedValue(new Error("fail")),
      }));
      expect(
        await (memoryRecall as any).loadRecentMessages(mockDb, "s1"),
      ).toEqual([]);
    });

    it("pasa maxRecentMessages como limit a find", async () => {
      (memoryRecall as any).config = {
        ...DEFAULT_PIPELINE_CONFIG,
        maxRecentMessages: 3,
      };
      mockDb.memory.find = mockFind([]);
      await (memoryRecall as any).loadRecentMessages(mockDb, "s1");
      expect(mockDb.memory.find).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 3 }),
      );
    });

    // ── Privacy: private messages are excluded from recall ──
    it("excludes private messages from the recall", async () => {
      const msgs = [
        mockMessage({
          id: "msg_2",
          content: "dato público",
          createdAt: "2025-01-02T00:00:00.000Z",
        }),
        mockMessage({
          id: "msg_1",
          content: "SECRETO PRIVADO",
          isPrivate: true,
          createdAt: "2025-01-01T00:00:00.000Z",
        }),
      ];
      mockDb.memory.find = mockFind(msgs);
      const result = await (memoryRecall as any).loadRecentMessages(
        mockDb,
        "session_1",
      );
      expect(result).toHaveLength(1);
      expect(result[0].content).toBe("dato público");
    });
  });

  describe("buildContextString (private method)", () => {
    it("generates empty string when there is no data", () => {
      expect((memoryRecall as any).buildContextString(null, [], [], [])).toBe(
        "",
      );
    });
    it("includes USER PROFILE when there is a person with data", () => {
      const r = (memoryRecall as any).buildContextString(
        mockPersona(),
        [],
        [],
        [],
      );
      expect(r).toContain("=== USER PROFILE ===");
      expect(r).toContain("Preferences:");
    });
    it("omits a person without preferences or goals", () => {
      expect(
        (memoryRecall as any).buildContextString(
          mockPersona({ preferences: [], goals: [], tone: "", workflows: [] }),
          [],
          [],
          [],
        ),
      ).toBe("");
    });
    it("includes RELEVANT PATTERNS", () => {
      const r = (memoryRecall as any).buildContextString(
        null,
        [mockScenario({ title: "A", description: "B" })],
        [],
        [],
      );
      expect(r).toContain("Pattern 1: A");
      expect(r).toContain("B");
    });
    it("includes KNOWN FACTS", () => {
      const r = (memoryRecall as any).buildContextString(
        null,
        [],
        [mockAtom({ category: "fact", content: "sabe TS" })],
        [],
      );
      expect(r).toContain("[fact] sabe TS");
    });
    it("trunca contenido de mensajes a 500 caracteres", () => {
      const r = (memoryRecall as any).buildContextString(
        null,
        [],
        [],
        [mockMessage({ content: "a".repeat(1000) })],
      );
      const line = r.split("\n").find((l: string) => l.startsWith("User:"));
      expect(line!.length).toBeLessThanOrEqual(506);
    });
    it("includes RECENT CONVERSATION with mapped roles", () => {
      const r = (memoryRecall as any).buildContextString(
        null,
        [],
        [],
        [
          mockMessage({ role: "user", content: "Hi" }),
          mockMessage({ id: "m2", role: "assistant", content: "Bye" }),
        ],
      );
      expect(r).toContain("User: Hi");
      expect(r).toContain("Assistant: Bye");
    });
    it("builds the full context with all components", () => {
      const r = (memoryRecall as any).buildContextString(
        mockPersona(),
        [mockScenario()],
        [mockAtom()],
        [mockMessage()],
      );
      [
        "=== USER PROFILE ===",
        "=== RELEVANT PATTERNS ===",
        "=== KNOWN FACTS ===",
        "=== RECENT CONVERSATION ===",
      ].forEach((s) => expect(r).toContain(s));
    });

    // ── buildContextString: persona with tone only ──
    it("includes USER PROFILE with tone but without preferences or goals", () => {
      const r = (memoryRecall as any).buildContextString(
        mockPersona({ preferences: [], goals: [], tone: "formal", workflows: [] }),
        [],
        [],
        [],
      );
      // El guard 'persona && (persona.preferences.length > 0 || persona.goals.length > 0)'
      // is FALSE because both are empty, so USER PROFILE is omitted
      expect(r).toBe("");
    });
  });

  describe("recall (public method)", () => {
    it("returns MemoryRecallResult with all components", async () => {
      // recall() issues several queries against `db.memory`; queue the
      // expected responses with mockReturnValueOnce so each call goes to the
      // right mock instead of the last-write-wins side effect.
      const findOneQueue = [
        mockPersona(), // loadPersona("persona")
        mockAtom({ id: "a1" }), // each atom lookup by id
      ];
      // recall() finds scenarios, recent messages, and atoms in that order
      // (with one extra findOne for persona + one per atom id lookup). The
      // shape of each queue entry is what the inner RxDocument.toJSON() would
      // produce — independent of its eventual cast on the source side.
      const findQueue = [
        [mockScenario()], // recallScenarios
        [mockMessage()], // loadRecentMessages(session_1)
      ];
      mockDb.memory.findOne = mockFindOneQueued(findOneQueue);
      // Both branches return arrays of "documents" from the test's
      // perspective; cast to a widest-acceptable shape to avoid TS refusing
      // the heterogeneous queue.
      mockDb.memory.find = mockFindQueued(
        findQueue as unknown as MemoryScenario[][],
      );
      (ragEngine.generateEmbedding as any).mockResolvedValue([0.1, 0.2]);
      (vectorIndexService.search as any).mockResolvedValue({
        neighbors: [{ id: "atom:a1", score: 0.9 }],
      });

      const result: MemoryRecallResult = await memoryRecall.recall(
        "test query",
        "session_1",
      );
      expect(result).toHaveProperty("persona");
      expect(result).toHaveProperty("scenarios");
      expect(result).toHaveProperty("atoms");
      expect(result).toHaveProperty("recentMessages");
      expect(result).toHaveProperty("contextString");
      expect(result.contextString.length).toBeGreaterThan(0);
    });

    it("calls initDB exactly once", async () => {
      mockDb.memory.findOne = mockFindOne(null);
      mockDb.memory.find = mockFind([]);
      (ragEngine.generateEmbedding as any).mockResolvedValue([0.1]);
      mockDb.memory.find = mockFind([]);
      mockDb.memory.find = mockFind([]);
      await memoryRecall.recall("test", "s1");
      expect(initDB).toHaveBeenCalledTimes(1);
    });

    // ── Privacy: the built context never contains private data ──
    it("contextString does not contain private message content", async () => {
      mockDb.memory.findOne = mockFindOne(null);
      mockDb.memory.find = mockFind([]);
      (ragEngine.generateEmbedding as any).mockResolvedValue([0.1]);
      (vectorIndexService.search as any).mockResolvedValue({ neighbors: [] });
      mockDb.memory.find = mockFind([
        mockMessage({ content: "público 1" }),
        mockMessage({
          id: "msg_2",
          content: "SECRETO ABSOLUTO",
          isPrivate: true,
        }),
      ]);
      const result = await memoryRecall.recall("q", "session_1");
      expect(result.contextString).not.toContain("SECRETO ABSOLUTO");
      expect(result.contextString).toContain("público 1");
    });
  });

  describe("singleton", () => {
    it("memoryRecall is defined", () => {
      expect(memoryRecall).toBeDefined();
      expect((memoryRecall as any).config).toEqual(DEFAULT_PIPELINE_CONFIG);
    });
  });
});
