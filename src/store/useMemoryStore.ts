import { create } from "zustand";
import type { MemoryPersona } from "../memory/MemoryTypes";

interface MemoryState {
  activeSessionId: string | null;
  persona: MemoryPersona | null;
  isProcessing: boolean;
  atomsCount: number;
  scenariosCount: number;
  lastPipelineRun: string | null;

  setActiveSession: (sessionId: string | null) => void;
  setPersona: (persona: MemoryPersona | null) => void;
  setProcessing: (isProcessing: boolean) => void;
  updateCounts: (atomsCount: number, scenariosCount: number) => void;
  setLastPipelineRun: (timestamp: string) => void;
  reset: () => void;
}

export const useMemoryStore = create<MemoryState>((set) => ({
  activeSessionId: null,
  persona: null,
  isProcessing: false,
  atomsCount: 0,
  scenariosCount: 0,
  lastPipelineRun: null,

  setActiveSession: (sessionId) => set({ activeSessionId: sessionId }),
  setPersona: (persona) => set({ persona }),
  setProcessing: (isProcessing) => set({ isProcessing }),
  updateCounts: (atomsCount, scenariosCount) =>
    set({ atomsCount, scenariosCount }),
  setLastPipelineRun: (timestamp) => set({ lastPipelineRun: timestamp }),
  reset: () =>
    set({
      activeSessionId: null,
      persona: null,
      isProcessing: false,
      atomsCount: 0,
      scenariosCount: 0,
      lastPipelineRun: null,
    }),
}));
