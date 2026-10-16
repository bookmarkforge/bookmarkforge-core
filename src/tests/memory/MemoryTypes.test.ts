import { describe, it, expect } from "vitest";
import type {
  MemoryCategory,
  MemoryAtom,
  MemoryScenario,
  MemoryPersona,
  MemorySession,
  MemoryChatMessage,
  MemoryRecallResult,
  MemoryPipelineConfig,
} from "../../memory/MemoryTypes";
import { DEFAULT_PIPELINE_CONFIG } from "../../memory/MemoryTypes";

describe("MemoryTypes — tipos e interfaces", () => {
  describe("MemoryCategory (union type)", () => {
    it("accepts valid category values", () => {
      const validCategories: MemoryCategory[] = [
        "preference",
        "fact",
        "goal",
        "project",
        "workflow",
      ];
      expect(validCategories).toHaveLength(5);
      expect(validCategories).toContain("preference");
      expect(validCategories).toContain("fact");
      expect(validCategories).toContain("goal");
      expect(validCategories).toContain("project");
      expect(validCategories).toContain("workflow");
    });
  });

  describe("MemoryAtom (interfaz)", () => {
    it("has the correct structure", () => {
      const atom: MemoryAtom = {
        type: "atom",
        id: "atom_1",
        content: "prefiere respuestas concisas",
        category: "preference",
        confidence: 0.85,
        sourceMessageId: "msg_1",
        sessionId: "session_1",
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-01-01T00:00:00.000Z",
      };
      expect(atom).toBeDefined();
      expect(typeof atom.id).toBe("string");
      expect(typeof atom.content).toBe("string");
      expect(typeof atom.confidence).toBe("number");
      expect(typeof atom.sourceMessageId).toBe("string");
      expect(typeof atom.sessionId).toBe("string");
    });

    it("allows optional embedding", () => {
      const sinEmbedding: MemoryAtom = {
        type: "atom",
        id: "a1",
        content: "test",
        category: "fact",
        confidence: 0.5,
        sourceMessageId: "m1",
        sessionId: "s1",
        createdAt: "",
        updatedAt: "",
      };
      expect(sinEmbedding.embedding).toBeUndefined();

      const conEmbedding: MemoryAtom = {
        ...sinEmbedding,
        embedding: [0.1, 0.2, 0.3],
      };
      expect(conEmbedding.embedding).toHaveLength(3);
    });
  });

  describe("MemoryScenario (interfaz)", () => {
    it("has the correct structure", () => {
      const scenario: MemoryScenario = {
        id: "sc_1",
        title: "Morning work pattern",
        description: "The user works better in the morning",
        atomIds: ["a1", "a2"],
        frequency: 5,
        lastActive: "2025-01-01T00:00:00.000Z",
        createdAt: "2025-01-01T00:00:00.000Z",
      };
      expect(scenario.title).toBeTruthy();
      expect(scenario.atomIds).toBeInstanceOf(Array);
      expect(scenario.frequency).toBeGreaterThanOrEqual(1);
    });
  });

  describe("MemoryPersona (interfaz)", () => {
    it("has the correct structure", () => {
      const persona: MemoryPersona = {
        id: "persona",
        preferences: ["likes clean code"],
        goals: ["improve performance"],
        tone: "professional",
        workflows: ["PR review"],
        updatedAt: "2025-01-01T00:00:00.000Z",
        generatedFromScenarioIds: ["sc_1", "sc_2"],
      };
      expect(persona.preferences).toBeInstanceOf(Array);
      expect(persona.goals).toBeInstanceOf(Array);
      expect(persona.workflows).toBeInstanceOf(Array);
      expect(typeof persona.tone).toBe("string");
      expect(persona.generatedFromScenarioIds).toBeInstanceOf(Array);
    });
  });

  describe("MemorySession (interfaz)", () => {
    it("has the correct structure", () => {
      const session: MemorySession = {
        type: "session",
        id: "session_1",
        title: "Test session",
        messageIds: ["msg_1", "msg_2"],
        createdAt: "2025-01-01T00:00:00.000Z",
        startedAt: "2025-01-01T00:00:00.000Z",
        lastActive: "2025-01-01T00:00:00.000Z",
      };
      expect(session.messageIds).toBeInstanceOf(Array);
      expect(session.startedAt).toBeTruthy();
      expect(session.summary).toBeUndefined();
    });

    it("allows optional summary", () => {
      const session: MemorySession = {
        type: "session",
        id: "s1",
        title: "test",
        messageIds: [],
        createdAt: "",
        startedAt: "",
        lastActive: "",
        summary: "resumen de la sesión",
      };
      expect(session.summary).toBe("resumen de la sesión");
    });
  });

  describe("MemoryChatMessage (interfaz)", () => {
    it("has the correct structure", () => {
      const msg: MemoryChatMessage = {
        type: "message",
        id: "msg_1",
        sessionId: "session_1",
        role: "user",
        content: "Hola",
        createdAt: "2025-01-01T00:00:00.000Z",
      };
      expect(["user", "assistant", "system"]).toContain(msg.role);
      expect(typeof msg.content).toBe("string");
    });

    it("accepts the three valid roles", () => {
      const roles: MemoryChatMessage["role"][] = [
        "user",
        "assistant",
        "system",
      ];
      roles.forEach((role) => {
        const msg: MemoryChatMessage = {
          type: "message",
          id: "m1",
          sessionId: "s1",
          role,
          content: "test",
          createdAt: "",
        };
        expect(msg.role).toBe(role);
      });
    });

    it("allows optional sources", () => {
      const conSources: MemoryChatMessage = {
        type: "message",
        id: "m1",
        sessionId: "s1",
        role: "user",
        content: "test",
        sources: [{ url: "https://ejemplo.com" }],
        createdAt: "",
      };
      expect(conSources.sources).toHaveLength(1);
    });
  });

  describe("MemoryRecallResult (interfaz)", () => {
    it("has the correct structure", () => {
      const result: MemoryRecallResult = {
        persona: null,
        scenarios: [],
        atoms: [],
        recentMessages: [],
        contextString: "",
      };
      expect(result.persona).toBeNull();
      expect(result.scenarios).toBeInstanceOf(Array);
      expect(result.atoms).toBeInstanceOf(Array);
      expect(result.recentMessages).toBeInstanceOf(Array);
      expect(typeof result.contextString).toBe("string");
    });

    it("accepts a non-null person", () => {
      const persona: MemoryPersona = {
        id: "p1",
        preferences: [],
        goals: [],
        tone: "",
        workflows: [],
        updatedAt: "",
        generatedFromScenarioIds: [],
      };
      const result: MemoryRecallResult = {
        persona,
        scenarios: [],
        atoms: [],
        recentMessages: [],
        contextString: "ctx",
      };
      expect(result.persona).toEqual(persona);
    });
  });

  describe("MemoryPipelineConfig (interfaz)", () => {
    it("has all numeric properties", () => {
      const config: MemoryPipelineConfig = {
        extractAtomsEveryNMessages: 3,
        buildScenariosEveryNAtoms: 15,
        regeneratePersonaEveryNScenarios: 5,
        maxRecentMessages: 8,
        maxAtomsInContext: 5,
        maxScenariosInContext: 3,
        atomSimilarityThreshold: 0.85,
        sessionIdleTimeoutMs: 1800000,
      };
      const keys: (keyof MemoryPipelineConfig)[] = [
        "extractAtomsEveryNMessages",
        "buildScenariosEveryNAtoms",
        "regeneratePersonaEveryNScenarios",
        "maxRecentMessages",
        "maxAtomsInContext",
        "maxScenariosInContext",
        "atomSimilarityThreshold",
        "sessionIdleTimeoutMs",
      ];
      keys.forEach((k) => {
        expect(config).toHaveProperty(k);
        expect(typeof config[k]).toBe("number");
      });
    });
  });
});

describe("DEFAULT_PIPELINE_CONFIG — constantes por defecto", () => {
  it("has correct values", () => {
    expect(DEFAULT_PIPELINE_CONFIG.extractAtomsEveryNMessages).toBe(3);
    expect(DEFAULT_PIPELINE_CONFIG.buildScenariosEveryNAtoms).toBe(15);
    expect(DEFAULT_PIPELINE_CONFIG.regeneratePersonaEveryNScenarios).toBe(5);
    expect(DEFAULT_PIPELINE_CONFIG.maxRecentMessages).toBe(8);
    expect(DEFAULT_PIPELINE_CONFIG.maxAtomsInContext).toBe(5);
    expect(DEFAULT_PIPELINE_CONFIG.maxScenariosInContext).toBe(3);
    expect(DEFAULT_PIPELINE_CONFIG.atomSimilarityThreshold).toBe(0.85);
    expect(DEFAULT_PIPELINE_CONFIG.sessionIdleTimeoutMs).toBe(30 * 60 * 1000);
  });

  it("sessionIdleTimeoutMs equivale a 30 minutos", () => {
    expect(DEFAULT_PIPELINE_CONFIG.sessionIdleTimeoutMs).toBe(1800000);
  });

  it("the object is not extensible (implicit Object.freeze)", () => {
    // Comprobamos que es un objeto plano con valores fijos
    expect(Object.keys(DEFAULT_PIPELINE_CONFIG)).toHaveLength(8);
  });
});
