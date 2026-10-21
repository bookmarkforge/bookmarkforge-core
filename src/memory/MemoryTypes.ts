export type MemoryCategory =
  "preference" | "fact" | "goal" | "project" | "workflow";

export interface MemoryAtom {
  type: "atom";
  id: string;
  content: string;
  category: MemoryCategory;
  confidence: number;
  sourceMessageId: string;
  sessionId: string;
  embedding?: number[];
  createdAt: string;
  updatedAt: string;
}

export interface MemoryScenario {
  id: string;
  title: string;
  description: string;
  atomIds: string[];
  frequency: number;
  lastActive: string;
  createdAt: string;
}

export interface MemoryPersona {
  id: string;
  preferences: string[];
  goals: string[];
  tone: string;
  workflows: string[];
  updatedAt: string;
  generatedFromScenarioIds: string[];
}

/**
 * Unified profile type stored in the `memoryProfiles` collection.
 * Uses a `type` discriminator field to distinguish scenarios from personas.
 * Scenarios have type="scenario"; the single persona has type="persona".
 */
interface MemoryProfileScenario {
  type: "scenario";
  id: string;
  title: string;
  description: string;
  atomIds: string[];
  frequency: number;
  lastActive: string;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryProfilePersona {
  type: "persona";
  id: string;
  preferences: string[];
  goals: string[];
  tone: string;
  workflows: string[];
  updatedAt: string;
  generatedFromScenarioIds: string[];
  createdAt: string;
}

export type MemoryProfile = MemoryProfileScenario | MemoryProfilePersona;

export interface MemorySession {
  type: "session";
  id: string;
  title: string;
  messageIds: string[];
  /**
   * The unified memory collection requires `createdAt` on every doc. For a
   * session it equals `startedAt`; we keep both fields because the call sites
   * already distinguish them and the encrypted schema already serialises `createdAt`.
   */
  createdAt: string;
  startedAt: string;
  lastActive: string;
  summary?: string;
}

export interface MemoryChatMessage {
  type: "message";
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: string;
  sources?: unknown[];
  /**
   * Privacy flag. Private messages are EXCLUDED from the memory pipeline:
   * they never become atoms/scenarios and are excluded from recall context.
   */
  isPrivate?: boolean;
  createdAt: string;
}

/**
 * Union of every document stored in the unified `memory` collection. Use this
 * when reading through `db.memory` and narrowing by `doc.type` to recover the
 * specific entity shape.
 */
export type MemoryRecord =
  | MemoryAtom
  | MemoryProfile
  | MemorySession
  | MemoryChatMessage;

export interface MemoryRecallResult {
  persona: MemoryPersona | null;
  scenarios: MemoryScenario[];
  atoms: MemoryAtom[];
  recentMessages: MemoryChatMessage[];
  contextString: string;
}

export interface MemoryPipelineConfig {
  extractAtomsEveryNMessages: number;
  buildScenariosEveryNAtoms: number;
  regeneratePersonaEveryNScenarios: number;
  maxRecentMessages: number;
  maxAtomsInContext: number;
  maxScenariosInContext: number;
  atomSimilarityThreshold: number;
  sessionIdleTimeoutMs: number;
}

export const DEFAULT_PIPELINE_CONFIG: MemoryPipelineConfig = {
  extractAtomsEveryNMessages: 3,
  buildScenariosEveryNAtoms: 15,
  regeneratePersonaEveryNScenarios: 5,
  maxRecentMessages: 8,
  maxAtomsInContext: 5,
  maxScenariosInContext: 3,
  atomSimilarityThreshold: 0.85,
  sessionIdleTimeoutMs: 30 * 60 * 1000,
};
