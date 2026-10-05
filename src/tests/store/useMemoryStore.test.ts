import { describe, it, expect, beforeEach } from "vitest";
import { useMemoryStore } from "../../store/useMemoryStore";
import type { MemoryPersona } from "../../memory/MemoryTypes";

describe("useMemoryStore", () => {
  // We reset the store before each test
  beforeEach(() => {
    useMemoryStore.setState({
      activeSessionId: null,
      persona: null,
      isProcessing: false,
      atomsCount: 0,
      scenariosCount: 0,
      lastPipelineRun: null,
    });
  });

  describe("Estado inicial", () => {
    it("has correct default values", () => {
      const state = useMemoryStore.getState();
      expect(state.activeSessionId).toBeNull();
      expect(state.persona).toBeNull();
      expect(state.isProcessing).toBe(false);
      expect(state.atomsCount).toBe(0);
      expect(state.scenariosCount).toBe(0);
      expect(state.lastPipelineRun).toBeNull();
    });
  });

  describe("setActiveSession", () => {
    it("updates the session id", () => {
      useMemoryStore.getState().setActiveSession("sesion-1");
      expect(useMemoryStore.getState().activeSessionId).toBe("sesion-1");
    });

    it("accepts null to clear the session", () => {
      useMemoryStore.setState({ activeSessionId: "sesion-1" });
      useMemoryStore.getState().setActiveSession(null);
      expect(useMemoryStore.getState().activeSessionId).toBeNull();
    });
  });

  describe("setPersona", () => {
    const mockPersona: MemoryPersona = {
      id: "persona-1",
      preferences: ["le gusta el código limpio"],
      goals: ["mejorar rendimiento"],
      tone: "profesional",
      workflows: ["revisión de PR"],
      updatedAt: "2025-01-01T00:00:00.000Z",
      generatedFromScenarioIds: [],
    };

    it("sets the person object", () => {
      useMemoryStore.getState().setPersona(mockPersona);
      expect(useMemoryStore.getState().persona).toEqual(mockPersona);
    });

    it("accepts null to clear the person", () => {
      useMemoryStore.setState({ persona: mockPersona });
      useMemoryStore.getState().setPersona(null);
      expect(useMemoryStore.getState().persona).toBeNull();
    });
  });

  describe("setProcessing", () => {
    it("activa el estado de procesamiento", () => {
      useMemoryStore.getState().setProcessing(true);
      expect(useMemoryStore.getState().isProcessing).toBe(true);
    });

    it("clears the processing state", () => {
      useMemoryStore.setState({ isProcessing: true });
      useMemoryStore.getState().setProcessing(false);
      expect(useMemoryStore.getState().isProcessing).toBe(false);
    });
  });

  describe("updateCounts", () => {
    it("sets atomsCount and scenariosCount", () => {
      useMemoryStore.getState().updateCounts(10, 3);
      const state = useMemoryStore.getState();
      expect(state.atomsCount).toBe(10);
      expect(state.scenariosCount).toBe(3);
    });
  });

  describe("setLastPipelineRun", () => {
    it("sets the last pipeline timestamp", () => {
      const timestamp = "2025-06-15T10:30:00.000Z";
      useMemoryStore.getState().setLastPipelineRun(timestamp);
      expect(useMemoryStore.getState().lastPipelineRun).toBe(timestamp);
    });
  });

  describe("reset", () => {
    it("restores all default values", () => {
      // Modificamos el estado
      useMemoryStore.setState({
        activeSessionId: "sesion-1",
        persona: {
          id: "p1",
          preferences: [],
          goals: [],
          tone: "",
          workflows: [],
          updatedAt: "",
          generatedFromScenarioIds: [],
        },
        isProcessing: true,
        atomsCount: 10,
        scenariosCount: 3,
        lastPipelineRun: "2025-06-15T10:30:00.000Z",
      });

      useMemoryStore.getState().reset();

      const state = useMemoryStore.getState();
      expect(state.activeSessionId).toBeNull();
      expect(state.persona).toBeNull();
      expect(state.isProcessing).toBe(false);
      expect(state.atomsCount).toBe(0);
      expect(state.scenariosCount).toBe(0);
      expect(state.lastPipelineRun).toBeNull();
    });
  });
});
