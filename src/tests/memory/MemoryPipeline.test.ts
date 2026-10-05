import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MemoryChatMessage, MemoryAtom } from "../../memory/MemoryTypes";
import { DEFAULT_PIPELINE_CONFIG } from "../../memory/MemoryTypes";

vi.mock("../../db/database", () => ({ initDB: vi.fn() }));
vi.mock("../../services/ai/ProviderManager", () => ({
  aiManager: { generateText: vi.fn() },
}));
vi.mock("../../services/ai/RAGEngine", () => ({
  ragEngine: { generateEmbedding: vi.fn(), cosineSimilarity: vi.fn() },
}));
vi.mock("../../services/ai/VectorIndexService", () => ({
  vectorIndexService: {
    add: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("../../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { initDB } from "../../db/database";
import { aiManager } from "../../services/ai/ProviderManager";
import { ragEngine } from "../../services/ai/RAGEngine";
import { vectorIndexService } from "../../services/ai/VectorIndexService";
import { memoryPipeline } from "../../memory/MemoryPipeline";

/** Helper for mocking an RxDB collection: find({...}) returns { exec: fn } */
function mockFind<T>(docs: T[]) {
  return vi.fn().mockReturnValue({
    exec: vi.fn().mockResolvedValue(docs.map((d) => ({ toJSON: () => d }))),
  });
}
function mockFindOne<T>(doc: T | null) {
  return vi.fn().mockReturnValue({
    exec: vi
      .fn()
      .mockResolvedValue(doc ? { toJSON: () => doc, incrementalPatch: vi.fn() } : null),
  });
}
function mockCount<T>(val: T) {
  return vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue(val) });
}

describe("MemoryPipeline", () => {
  let mockDb: any;

  const msg = (o: Partial<MemoryChatMessage> = {}): MemoryChatMessage => ({
    type: "message" as const,
    id: "m1",
    sessionId: "s1",
    role: "user",
    content: "Hola",
    createdAt: "2025-01-01T00:00:00.000Z",
    isPrivate: false,
    ...o,
  });
  const atom = (o: Partial<MemoryAtom> = {}): MemoryAtom => ({
    type: "atom" as const,
    id: "a1",
    content: "prefiere TS",
    category: "preference",
    confidence: 0.5,
    sourceMessageId: "m1",
    sessionId: "s1",
    createdAt: "",
    updatedAt: "",
    ...o,
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    memoryPipeline.reset();
    (memoryPipeline as any).config = { ...DEFAULT_PIPELINE_CONFIG };

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

  // ===== Configuration =====
  describe("configuration", () => {
    it("uses default configuration", () =>
      expect((memoryPipeline as any).config).toEqual(DEFAULT_PIPELINE_CONFIG));
    it("allows modifying configuration", () => {
      (memoryPipeline as any).config = {
        ...DEFAULT_PIPELINE_CONFIG,
        extractAtomsEveryNMessages: 5,
      };
      expect((memoryPipeline as any).config.extractAtomsEveryNMessages).toBe(5);
    });
    it("counters at zero after reset", () => {
      expect((memoryPipeline as any).messageCounter).toBe(0);
      expect((memoryPipeline as any).atomCounter).toBe(0);
      expect((memoryPipeline as any).scenarioCounter).toBe(0);
      expect((memoryPipeline as any).isRunning).toBe(false);
    });
  });

  // ===== similarity =====
  describe("similarity", () => {
    it("identical → 1", () =>
      expect((memoryPipeline as any).similarity("a b", "a b")).toBe(1));
    it("no match → 0", () =>
      expect((memoryPipeline as any).similarity("foo", "bar")).toBe(0));
    it("correct Jaccard", () =>
      expect((memoryPipeline as any).similarity("a b c", "a b")).toBeCloseTo(
        2 / 3,
      ));
    it("empty → 1", () =>
      expect((memoryPipeline as any).similarity("", "")).toBe(1));
    it("ignores spaces", () =>
      expect((memoryPipeline as any).similarity("a  b", "a b")).toBe(1));
    it("distinguishes case", () =>
      expect((memoryPipeline as any).similarity("A", "a")).toBe(0));
  });

  // ===== Contadores (onNewMessage, onNewAtom, onNewScenario) =====
  describe("contadores y umbrales", () => {
    it("onNewMessage increments", async () => {
      await memoryPipeline.onNewMessage(msg());
      expect((memoryPipeline as any).messageCounter).toBe(1);
    });
    it("onNewMessage triggers extractAtoms when reaching the threshold", async () => {
      (memoryPipeline as any).config.extractAtomsEveryNMessages = 2;
      const spy = vi
        .spyOn(memoryPipeline as any, "extractAtoms")
        .mockResolvedValue(undefined);
      await memoryPipeline.onNewMessage(msg());
      await memoryPipeline.onNewMessage(msg());
      expect(spy).toHaveBeenCalledTimes(1);
      expect((memoryPipeline as any).messageCounter).toBe(0);
    });
    it("onNewMessage omitido si isRunning", async () => {
      (memoryPipeline as any).isRunning = true;
      (memoryPipeline as any).config.extractAtomsEveryNMessages = 1;
      const spy = vi
        .spyOn(memoryPipeline as any, "extractAtoms")
        .mockResolvedValue(undefined);
      await memoryPipeline.onNewMessage(msg());
      expect(spy).not.toHaveBeenCalled();
    });
    it("onNewAtom increments and triggers buildScenarios at the threshold", async () => {
      (memoryPipeline as any).config.buildScenariosEveryNAtoms = 2;
      const spy = vi
        .spyOn(memoryPipeline as any, "buildScenarios")
        .mockResolvedValue(undefined);
      await memoryPipeline.onNewAtom();
      await memoryPipeline.onNewAtom();
      expect(spy).toHaveBeenCalledTimes(1);
    });
    it("onNewScenario increments and triggers regeneratePersona at the threshold", async () => {
      (memoryPipeline as any).config.regeneratePersonaEveryNScenarios = 2;
      const spy = vi
        .spyOn(memoryPipeline as any, "regeneratePersona")
        .mockResolvedValue(undefined);
      await memoryPipeline.onNewScenario();
      await memoryPipeline.onNewScenario();
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  // ===== extractAtoms — integration tests with DB mocks =====
  describe("extractAtoms", () => {
    it("does nothing if < 2 messages", async () => {
          mockDb.memory.find = vi.fn()
          .mockReturnValueOnce({ exec: vi.fn().mockResolvedValueOnce([]) });
      await (memoryPipeline as any).extractAtoms("s1", (memoryPipeline as any).lifecycleGeneration);
      expect(aiManager.generateText).not.toHaveBeenCalled();
    }, 30000);

    it("extracts atoms and inserts them", async () => {
      // 2 messages → passes the length filter
          mockDb.memory.find = vi.fn()
          .mockReturnValueOnce({ exec: vi.fn().mockResolvedValueOnce([
          {
            toJSON: () =>
              msg({ content: "A", createdAt: "2025-01-02T00:00:00.000Z" }),
          },
          {
            toJSON: () =>
              msg({ content: "B", createdAt: "2025-01-01T00:00:00.000Z" }),
          },
        ]) })
          .mockReturnValueOnce({ exec: vi.fn().mockResolvedValueOnce([]) });
      // AI responds with 1 atom
      (aiManager.generateText as any).mockResolvedValue({
        text: JSON.stringify([
          { content: "prefiere Rust", category: "preference" },
        ]),
      });
      (ragEngine.generateEmbedding as any).mockResolvedValue([0.1, 0.2, 0.3]);

      await (memoryPipeline as any).extractAtoms("s1", (memoryPipeline as any).lifecycleGeneration);
      expect(mockDb.memory.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "prefiere Rust",
          category: "preference",
        }),
      );
    });

    it("removes the atom and its vector when the vault changes during indexing", async () => {
          mockDb.memory.find = vi.fn()
          .mockReturnValueOnce({ exec: vi.fn().mockResolvedValueOnce([
          { toJSON: () => msg({ content: "A" }) },
          { toJSON: () => msg({ content: "B" }) },
        ]) })
          .mockReturnValueOnce({ exec: vi.fn().mockResolvedValueOnce([]) });
      (aiManager.generateText as any).mockResolvedValue({
        text: JSON.stringify([{ content: "nuevo hecho", category: "fact" }]),
      });
      (ragEngine.generateEmbedding as any).mockResolvedValue([0.1, 0.2]);
      const removeAtom = vi.fn().mockResolvedValue(undefined);
      mockDb.memory.insert = vi.fn().mockResolvedValue({ remove: removeAtom });
      let resolveIndex!: () => void;
      const addMock = vi.mocked(vectorIndexService.add);
      addMock.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveIndex = resolve;
        }),
      );

      const generation = (memoryPipeline as any).lifecycleGeneration;
      const pending = (memoryPipeline as any).extractAtoms("s1", generation);
      for (let attempt = 0; attempt < 10 && !addMock.mock.calls.length; attempt += 1) {
        await Promise.resolve();
      }
      memoryPipeline.reset();
      resolveIndex();
      await pending;

      expect(removeAtom).toHaveBeenCalledTimes(1);
      expect(vectorIndexService.remove).toHaveBeenCalledWith([
        expect.stringMatching(/^atom:/),
      ]);
    });

    it("truncates giant messages to 2000 chars in the extraction prompt", async () => {
      // A whole document pasted into the chat must not blow up the LLM prompt.
      const huge = "A".repeat(5000);
          mockDb.memory.find = vi.fn()
          .mockReturnValueOnce({ exec: vi.fn().mockResolvedValueOnce([
          { toJSON: () => msg({ content: huge, createdAt: "2025-01-02T00:00:00.000Z" }) },
          { toJSON: () => msg({ content: "B", createdAt: "2025-01-01T00:00:00.000Z" }) },
        ]) })
          .mockReturnValueOnce({ exec: vi.fn().mockResolvedValueOnce([]) });
      (aiManager.generateText as any).mockResolvedValue({
        text: JSON.stringify([{ content: "prefiere Rust", category: "preference" }]),
      });
      (ragEngine.generateEmbedding as any).mockResolvedValue([0.1, 0.2, 0.3]);

      await (memoryPipeline as any).extractAtoms("s1", (memoryPipeline as any).lifecycleGeneration);
      const prompt = (aiManager.generateText as any).mock.calls[0]![0] as string;
      expect(prompt).not.toContain("A".repeat(2001)); // the full body never reaches the prompt
      expect(prompt).toContain("A".repeat(2000)); // the truncated prefix does
    });

    it("detects duplicates and skips insertion", async () => {
          mockDb.memory.find = vi.fn()
          .mockReturnValueOnce({ exec: vi.fn().mockResolvedValueOnce([
            { toJSON: () => msg({ createdAt: "2025-01-02T00:00:00.000Z" }) },
            { toJSON: () => msg({ createdAt: "2025-01-01T00:00:00.000Z" }) },
          ]) })
          .mockReturnValueOnce({ exec: vi.fn().mockResolvedValueOnce([
            { toJSON: () => atom({ content: "prefiere TypeScript" }) },
          ]) });
      (aiManager.generateText as any).mockResolvedValue({
        text: JSON.stringify([
          { content: "prefiere TypeScript", category: "preference" },
        ]),
      });
      await (memoryPipeline as any).extractAtoms("s1", (memoryPipeline as any).lifecycleGeneration);
      expect(mockDb.memory.insert).not.toHaveBeenCalled();
    });

    it("handles JSON parse error", async () => {
          mockDb.memory.find = vi.fn()
          .mockReturnValueOnce({ exec: vi.fn().mockResolvedValueOnce([
            { toJSON: () => msg() },
            { toJSON: () => msg() },
          ]) });
      (aiManager.generateText as any).mockResolvedValue({
        text: "invalid json",
      });
      await (memoryPipeline as any).extractAtoms("s1", (memoryPipeline as any).lifecycleGeneration);
      expect(mockDb.memory.insert).not.toHaveBeenCalled();
    });

    it("respects the 5-atom limit", async () => {
          mockDb.memory.find = vi.fn()
          .mockReturnValueOnce({ exec: vi.fn().mockResolvedValueOnce([
            { toJSON: () => msg() },
            { toJSON: () => msg() },
          ]) })
          .mockReturnValueOnce({ exec: vi.fn().mockResolvedValueOnce([]) });
      const atoms6 = Array.from({ length: 6 }, (_, i) => ({
        content: `fact ${i}`,
        category: "fact" as const,
      }));
      (aiManager.generateText as any).mockResolvedValue({
        text: JSON.stringify(atoms6),
      });
      (ragEngine.generateEmbedding as any).mockResolvedValue([0.1, 0.2]);
      await (memoryPipeline as any).extractAtoms("s1", (memoryPipeline as any).lifecycleGeneration);
      expect(mockDb.memory.insert).toHaveBeenCalledTimes(5);
    });

    // ── extractAtoms: !Array.isArray(extracted) guard ──
    it("handles JSON response that is not an array", async () => {
          mockDb.memory.find = vi.fn()
          .mockReturnValueOnce({ exec: vi.fn().mockResolvedValueOnce([
            { toJSON: () => msg() },
            { toJSON: () => msg() },
          ]) })
          .mockReturnValueOnce({ exec: vi.fn().mockResolvedValueOnce([]) });
      // AI returns valid JSON but it is not an array
      (aiManager.generateText as any).mockResolvedValue({
        text: JSON.stringify({ content: "not array", category: "fact" }),
      });
      await (memoryPipeline as any).extractAtoms("s1", (memoryPipeline as any).lifecycleGeneration);
      // extracted = [] after the !Array.isArray guard
      expect(mockDb.memory.insert).not.toHaveBeenCalled();
    });

    // ── extractAtoms: boostConfidence called with new atoms ──
    it("calls boostConfidence after inserting new atoms", async () => {
      const boostSpy = vi
        .spyOn(memoryPipeline as any, "boostConfidence")
        .mockResolvedValue(undefined);

          mockDb.memory.find = vi.fn()
          .mockReturnValueOnce({ exec: vi.fn().mockResolvedValueOnce([
            { toJSON: () => msg() },
            { toJSON: () => msg() },
          ]) })
          .mockReturnValueOnce({ exec: vi.fn().mockResolvedValueOnce([]) });
      (aiManager.generateText as any).mockResolvedValue({
        text: JSON.stringify([
          { content: "nuevo fact", category: "fact" },
        ]),
      });
      (ragEngine.generateEmbedding as any).mockResolvedValue([0.1]);

      await (memoryPipeline as any).extractAtoms("s1", (memoryPipeline as any).lifecycleGeneration);
      expect(boostSpy).toHaveBeenCalled();
      boostSpy.mockRestore();
    });
  });

  // ===== Privacy: isPrivate excluded from atoms/scenarios =====
  describe("privacy: private data is never stored in atoms or scenarios", () => {
    it("extractAtoms with a 100% private batch: does not call AI or insert atoms", async () => {
          mockDb.memory.find = vi.fn()
          .mockReturnValueOnce({ exec: vi.fn().mockResolvedValueOnce([
          {
            toJSON: () =>
              msg({
                content: "SECRETO A",
                isPrivate: true,
                createdAt: "2025-01-02T00:00:00.000Z",
              }),
          },
          {
            toJSON: () =>
              msg({
                content: "SECRETO B",
                isPrivate: true,
                createdAt: "2025-01-01T00:00:00.000Z",
              }),
          },
        ]) });
      await (memoryPipeline as any).extractAtoms("s1", (memoryPipeline as any).lifecycleGeneration);
      // Private content never reaches the LLM or the memory store.
      expect(aiManager.generateText).not.toHaveBeenCalled();
      expect(mockDb.memory.insert).not.toHaveBeenCalled();
    });

    it("extractAtoms with a mixed batch: the prompt excludes private content", async () => {
          mockDb.memory.find = vi.fn()
          .mockReturnValueOnce({ exec: vi.fn().mockResolvedValueOnce([
          {
            toJSON: () =>
              msg({
                content: "público reciente",
                createdAt: "2025-01-03T00:00:00.000Z",
              }),
          },
          {
            toJSON: () =>
              msg({
                content: "SECRETO PRIVADO",
                isPrivate: true,
                createdAt: "2025-01-02T00:00:00.000Z",
              }),
          },
          {
            toJSON: () =>
              msg({
                content: "público anterior",
                createdAt: "2025-01-01T00:00:00.000Z",
              }),
          },
        ]) })
          .mockReturnValueOnce({ exec: vi.fn().mockResolvedValueOnce([]) });
      (aiManager.generateText as any).mockResolvedValue({
        text: JSON.stringify([{ content: "hecho público", category: "fact" }]),
      });
      (ragEngine.generateEmbedding as any).mockResolvedValue([0.1]);

      await (memoryPipeline as any).extractAtoms("s1", (memoryPipeline as any).lifecycleGeneration);

      const prompt = vi.mocked(aiManager.generateText).mock.calls[0]![0] as string;
      expect(prompt).not.toContain("SECRETO PRIVADO");
      expect(prompt).toContain("público reciente");
      expect(prompt).toContain("público anterior");
      // Atoms are inserted (derived only from public content).
      expect(mockDb.memory.insert).toHaveBeenCalledWith(
        expect.objectContaining({ content: "hecho público" }),
      );
    });

    it("private extractAtoms never fires onNewAtom (no atoms means no scenarios)", async () => {
      const onNewAtomSpy = vi
        .spyOn(memoryPipeline as any, "onNewAtom")
        .mockResolvedValue(undefined);
          mockDb.memory.find = vi.fn()
          .mockReturnValueOnce({ exec: vi.fn().mockResolvedValueOnce([
          { toJSON: () => msg({ content: "s1", isPrivate: true }) },
          { toJSON: () => msg({ content: "s2", isPrivate: true }) },
        ]) });
      await (memoryPipeline as any).extractAtoms("s1", (memoryPipeline as any).lifecycleGeneration);
      expect(onNewAtomSpy).not.toHaveBeenCalled();
      onNewAtomSpy.mockRestore();
    });

    it("full chain: a private session never produces scenarios", async () => {
      // 1) A 100% private batch creates no atoms.
          mockDb.memory.find = vi.fn()
          .mockReturnValueOnce({ exec: vi.fn().mockResolvedValueOnce([
          { toJSON: () => msg({ content: "s1", isPrivate: true }) },
          { toJSON: () => msg({ content: "s2", isPrivate: true }) },
        ]) });
      await (memoryPipeline as any).extractAtoms("s1", (memoryPipeline as any).lifecycleGeneration);
      expect(mockDb.memory.insert).not.toHaveBeenCalled();

      // 2) The next pipeline step (buildScenarios) has no atoms
      //    to derive scenarios from → it calls no AI and inserts nothing.
          mockDb.memory.find = vi.fn()
          .mockReturnValueOnce({ exec: vi.fn().mockResolvedValueOnce([]) });
      await (memoryPipeline as any).buildScenarios((memoryPipeline as any).lifecycleGeneration);
      expect(aiManager.generateText).not.toHaveBeenCalled();
      expect(mockDb.memory.insert).not.toHaveBeenCalled();
    });
  });

  // ===== buildScenarios =====
  describe("buildScenarios", () => {
    it("does nothing with fewer than 5 atoms", async () => {
          mockDb.memory.find = vi.fn()
          .mockReturnValueOnce({ exec: vi.fn().mockResolvedValueOnce([]) });
      await (memoryPipeline as any).buildScenarios((memoryPipeline as any).lifecycleGeneration);
      expect(aiManager.generateText).not.toHaveBeenCalled();
    });

    it("construye escenarios", async () => {
      const atoms = Array.from({ length: 5 }, (_, i) =>
        atom({ id: `a${i}`, content: `fact ${i}`, confidence: 0.6 }),
      );
          mockDb.memory.find = vi.fn()
          .mockReturnValueOnce({ exec: vi.fn().mockResolvedValueOnce(atoms.map((a) => ({ toJSON: () => a }))) })
          .mockReturnValueOnce({ exec: vi.fn().mockResolvedValueOnce([]) });
      (aiManager.generateText as any).mockResolvedValue({
        text: JSON.stringify([
          {
            title: "PatrÃ³n A",
            description: "Desc",
            relatedAtomContents: ["fact 0", "fact 1"],
          },
        ]),
      });
      mockDb.memory.findOne = vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue({ toJSON: () => atom({ id: "a0" }) }),
      });
      await (memoryPipeline as any).buildScenarios((memoryPipeline as any).lifecycleGeneration);
      expect(mockDb.memory.insert).toHaveBeenCalledWith(
        expect.objectContaining({ title: "PatrÃ³n A" }),
      );
    });

    it("does not insert duplicates by title", async () => {
      const atoms = Array.from({ length: 5 }, (_, i) =>
        atom({ id: `a${i}`, content: `fact ${i}`, confidence: 0.6 }),
      );
          mockDb.memory.find = vi.fn()
          .mockReturnValueOnce({ exec: vi.fn().mockResolvedValueOnce(atoms.map((a) => ({ toJSON: () => a }))) })
          .mockReturnValueOnce({ exec: vi.fn().mockResolvedValueOnce([{ toJSON: () => ({ title: "PatrÃ³n A" }) }]) });
      (aiManager.generateText as any).mockResolvedValue({
        text: JSON.stringify([
          {
            title: "PatrÃ³n A",
            description: "Desc",
            relatedAtomContents: ["fact 0", "fact 1"],
          },
        ]),
      });
      await (memoryPipeline as any).buildScenarios((memoryPipeline as any).lifecycleGeneration);
      expect(mockDb.memory.insert).not.toHaveBeenCalled();
    });

    // ── buildScenarios: relatedAtomContents.length < 2 guard ──
    it("skips scenarios with fewer than 2 related atoms", async () => {
      const atoms = Array.from({ length: 5 }, (_, i) =>
        atom({ id: `a${i}`, content: `fact ${i}`, confidence: 0.6 }),
      );
          mockDb.memory.find = vi.fn()
          .mockReturnValueOnce({ exec: vi.fn().mockResolvedValueOnce(atoms.map((a) => ({ toJSON: () => a }))) })
          .mockReturnValueOnce({ exec: vi.fn().mockResolvedValueOnce([]) });
      (aiManager.generateText as any).mockResolvedValue({
        text: JSON.stringify([
          {
            title: "Escenario vÃ¡lido",
            description: "Tiene 2 Ã¡tomos",
            relatedAtomContents: ["fact 0", "fact 1"],
          },
          {
            title: "Escenario invÃ¡lido",
            description: "Solo 1 Ã¡tomo",
            relatedAtomContents: ["fact 0"],
          },
        ]),
      });
      mockDb.memory.findOne = vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue({ toJSON: () => atom({ id: "a0" }) }),
      });
      await (memoryPipeline as any).buildScenarios((memoryPipeline as any).lifecycleGeneration);
      // Only the scenario with >= 2 atoms is inserted
      expect(mockDb.memory.insert).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Escenario vÃ¡lido" }),
      );
      expect(mockDb.memory.insert).not.toHaveBeenCalledWith(
        expect.objectContaining({ title: "Escenario invÃ¡lido" }),
      );
    });
  });

  // ===== regeneratePersona =====
  describe("regeneratePersona", () => {
    it("does nothing without scenarios", async () => {
          mockDb.memory.find = vi.fn()
          .mockReturnValueOnce({ exec: vi.fn().mockResolvedValueOnce([]) });
      await (memoryPipeline as any).regeneratePersona((memoryPipeline as any).lifecycleGeneration);
      expect(aiManager.generateText).not.toHaveBeenCalled();
    });

    it("generates and saves a new person", async () => {
          mockDb.memory.find = vi.fn()
          .mockReturnValueOnce({ exec: vi.fn().mockResolvedValueOnce([
          {
            toJSON: () => ({
              id: "sc_1",
              title: "A",
              description: "B",
              frequency: 5,
            }),
          },
        ]) });
      (aiManager.generateText as any).mockResolvedValue({
        text: JSON.stringify({
          preferences: ["limpio"],
          goals: ["aprender"],
          tone: "pro",
          workflows: ["revisar"],
        }),
      });
      mockDb.memory.findOne = vi
        .fn()
        .mockReturnValue({ exec: vi.fn().mockResolvedValue(null) });
      await (memoryPipeline as any).regeneratePersona((memoryPipeline as any).lifecycleGeneration);
      expect(mockDb.memory.insert).toHaveBeenCalledWith(
        expect.objectContaining({ id: "persona", preferences: ["limpio"] }),
      );
    });

    it("updates an existing person", async () => {
          mockDb.memory.find = vi.fn()
          .mockReturnValueOnce({ exec: vi.fn().mockResolvedValueOnce([
          {
            toJSON: () => ({
              id: "sc_1",
              title: "A",
              description: "B",
              frequency: 5,
            }),
          },
        ]) });
      (aiManager.generateText as any).mockResolvedValue({
        text: JSON.stringify({
          preferences: [],
          goals: [],
          tone: "",
          workflows: [],
        }),
      });
      const patchSpy = vi.fn();
      mockDb.memory.findOne = vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue({
          toJSON: () => ({
            id: "persona",
            preferences: [],
            goals: [],
            tone: "",
            workflows: [],
            updatedAt: "",
            generatedFromScenarioIds: [],
          }),
          incrementalPatch: patchSpy,
        }),
      });
      await (memoryPipeline as any).regeneratePersona((memoryPipeline as any).lifecycleGeneration);
      expect(patchSpy).toHaveBeenCalled();
      expect(mockDb.memory.insert).not.toHaveBeenCalled();
    });

    it("reverts an old person if the vault changes during the patch", async () => {
          mockDb.memory.find = vi.fn()
          .mockReturnValueOnce({ exec: vi.fn().mockResolvedValueOnce([
          {
            toJSON: () => ({
              id: "sc_1",
              title: "A",
              description: "B",
              frequency: 5,
            }),
          },
        ]) });
      (aiManager.generateText as any).mockResolvedValue({
        text: JSON.stringify({
          preferences: ["nueva"],
          goals: ["nuevo objetivo"],
          tone: "nuevo tono",
          workflows: ["nuevo flujo"],
        }),
      });
      let resolvePatch!: () => void;
      const patchSpy = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<void>((resolve) => {
              resolvePatch = resolve;
            }),
        )
        .mockResolvedValue(undefined);
      const previousPersona = {
        id: "persona",
        preferences: ["antigua"],
        goals: ["objetivo antiguo"],
        tone: "tono antiguo",
        workflows: ["flujo antiguo"],
        updatedAt: "old",
        generatedFromScenarioIds: ["sc_old"],
      };
      mockDb.memory.findOne = vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue({
          toJSON: () => previousPersona,
          incrementalPatch: patchSpy,
        }),
      });

      const generation = (memoryPipeline as any).lifecycleGeneration;
      const pending = (memoryPipeline as any).regeneratePersona(generation);
      for (let attempt = 0; attempt < 10 && !patchSpy.mock.calls.length; attempt += 1) {
        await Promise.resolve();
      }
      memoryPipeline.reset();
      resolvePatch();
      await pending;

      expect(patchSpy).toHaveBeenCalledTimes(2);
      expect(patchSpy.mock.calls[1]![0]).toMatchObject({
        preferences: ["antigua"],
        goals: ["objetivo antiguo"],
        tone: "tono antiguo",
        workflows: ["flujo antiguo"],
      });
    });

    it("handles JSON parse failure", async () => {
          mockDb.memory.find = vi.fn()
          .mockReturnValueOnce({ exec: vi.fn().mockResolvedValueOnce([
          {
            toJSON: () => ({
              id: "sc_1",
              title: "A",
              description: "B",
              frequency: 5,
            }),
          },
        ]) });
      (aiManager.generateText as any).mockResolvedValue({
        text: "invalid json", // cannot be parsed
      });
      await (memoryPipeline as any).regeneratePersona((memoryPipeline as any).lifecycleGeneration);
      // the catch block handles the error, inserts nothing and patches nothing
      expect(mockDb.memory.insert).not.toHaveBeenCalled();
    });
  });

  // ===== boostConfidence =====
  describe("boostConfidence", () => {
    it("does nothing if there is only 1 match (matches.length <= 1)", async () => {
      mockDb.memory.findOne = vi.fn(); // should not be called
      await (memoryPipeline as any).boostConfidence(
        mockDb,
        ["prefiere ts", "prefiere python"],
        [atom({ id: "new1", content: "algo nuevo", confidence: 0.5 })],
      );
      // Only 1 existing match (something new vs itself does not count)
      expect(mockDb.memory.findOne).not.toHaveBeenCalled();
    });

    it("increments confidence when there are multiple matches", async () => {
      // Jaccard over Sets: Set removes duplicates
      // "a b c d e f g h" → Set{a,b,c,d,e,f,g,h} (8)
      // "a b c d e f g i" → Set{a,b,c,d,e,f,g,i} (8)
      // overlap=7, union=9 → 7/9 ≈ 0.777 > 0.7 ✓
      const existingContents = [
        "a b c d e f g h",
        "a b c d e f g i",
      ];
      const newAtomId = "new-boost-1";

      const patchSpy = vi.fn();
      mockDb.memory.findOne = vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue({
          toJSON: () =>
            ({
              id: newAtomId,
              content: "a b c d e f g h",
              confidence: 0.5,
              updatedAt: "",
            }) as MemoryAtom,
          incrementalPatch: patchSpy,
        }),
      });

      await (memoryPipeline as any).boostConfidence(
        mockDb,
        existingContents,
        [atom({ id: newAtomId, content: "a b c d e f g h", confidence: 0.5 })],
      );

      expect(patchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          confidence: expect.any(Number),
        }),
      );
      // confidence = min(1, 0.5 + 0.1 * (matches.length - 1))
      // matches: sim("same same same a", "same same same a") + sim("same same same a", "same same same b")
      // ambass > 0.7 → matches.length = 2 → confidence = min(1, 0.5 + 0.1) = 0.6
      const patchCall = patchSpy.mock.calls[0]![0];
      expect(patchCall.confidence).toBe(0.6);
    });

    it("does not increment when the atom is not found in the DB", async () => {
      // Same content as test 2: Jaccard > 0.7 to enter the if
      const existingContents = [
        "a b c d e f g h",
        "a b c d e f g i",
      ];

      mockDb.memory.findOne = vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue(null), // atom not found
      });

      await (memoryPipeline as any).boostConfidence(
        mockDb,
        existingContents,
        [atom({ id: "missing-1", content: "a b c d e f g h", confidence: 0.5 })],
      );
      // findOne was called but exec returned null → no patch
      expect(mockDb.memory.findOne).toHaveBeenCalled();
    });
  });

  // ===== findAtomIdsByContents =====
  describe("findAtomIdsByContents", () => {
    it("returns IDs of found atoms", async () => {
      mockDb.memory.findOne = vi.fn().mockReturnValue({
        exec: vi
          .fn()
          .mockResolvedValue({ toJSON: () => atom({ id: "a1" }) }),
      });
      const ids = await (memoryPipeline as any).findAtomIdsByContents(mockDb, [
        "fact 0",
      ]);
      expect(ids).toEqual(["a1"]);
    });

    it("returns an empty array when no atom matches", async () => {
      mockDb.memory.findOne = vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue(null),
      });
      const ids = await (memoryPipeline as any).findAtomIdsByContents(mockDb, [
        "nonexistent",
      ]);
      expect(ids).toEqual([]);
    });
  });

  // ===== getStats =====
  describe("getStats", () => {
    it("uses schema-declared profileType selectors", async () => {
      mockDb.memory.find = vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue([]),
      });
      mockDb.memory.count = vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue(0),
      });
      mockDb.memory.findOne = vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue(null),
      });

      await memoryPipeline.getStats();

      expect(mockDb.memory.find).toHaveBeenCalledWith(
        expect.objectContaining({
          selector: expect.objectContaining({
            type: "profile",
            profileType: "scenario",
          }),
        }),
      );
    });

    it("returns statistics", async () => {
          mockDb.memory.find = vi.fn()
          .mockReturnValueOnce({ exec: vi.fn().mockResolvedValueOnce([{ id: "s1" }, { id: "s2" }, { id: "s3" }]) });
    mockDb.memory.count = vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue({ amount: 10 }) });
      mockDb.memory.findOne = vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue({ toJSON: () => ({ id: "p1" }) }),
      });
      expect(await memoryPipeline.getStats()).toEqual({
        atoms: 10,
        scenarios: 3,
        hasPersona: true,
      });
    });
    it("hasPersona false sin persona", async () => {
          mockDb.memory.find = vi.fn()
          .mockReturnValueOnce({ exec: vi.fn().mockResolvedValueOnce([]) });
    mockDb.memory.count = vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue(0) });
      mockDb.memory.findOne = vi
        .fn()
        .mockReturnValue({ exec: vi.fn().mockResolvedValue(null) });
      expect((await memoryPipeline.getStats()).hasPersona).toBe(false);
    });
  });

  // ===== reset =====
  describe("reset", () => {
    it("resets counters and isRunning", () => {
      (memoryPipeline as any).messageCounter = 5;
      (memoryPipeline as any).atomCounter = 3;
      (memoryPipeline as any).scenarioCounter = 7;
      (memoryPipeline as any).isRunning = true;
      memoryPipeline.reset();
      expect((memoryPipeline as any).messageCounter).toBe(0);
      expect((memoryPipeline as any).atomCounter).toBe(0);
      expect((memoryPipeline as any).scenarioCounter).toBe(0);
      expect((memoryPipeline as any).isRunning).toBe(false);
    });
  });

  // ===== Singleton =====
  describe("singleton", () => {
    it("memoryPipeline definido", () => {
      expect(memoryPipeline).toBeDefined();
    });
  });
});
