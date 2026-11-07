import { initDB } from "../db/database";
import { ragEngine } from "../services/ai/RAGEngine";
import { vectorIndexService } from "../services/ai/VectorIndexService";
import { logger } from "../utils/logger";
import type { RxDocument } from "rxdb";
import type { BookmarkForgeDB } from "../db/types";
import type {
  MemoryRecallResult,
  MemoryPersona,
  MemoryScenario,
  MemoryAtom,
  MemoryChatMessage,
  MemoryPipelineConfig,
  MemoryRecord,
} from "./MemoryTypes";
import { DEFAULT_PIPELINE_CONFIG } from "./MemoryTypes";

class MemoryRecall {
  private config: MemoryPipelineConfig;

  constructor(config: Partial<MemoryPipelineConfig> = {}) {
    this.config = { ...DEFAULT_PIPELINE_CONFIG, ...config };
  }

  async recall(
    query: string,
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<MemoryRecallResult> {
    if (signal?.aborted) {
      throw new DOMException("Memory recall aborted", "AbortError");
    }
    const db = await initDB();
    if (signal?.aborted) {
      throw new DOMException("Memory recall aborted", "AbortError");
    }

    const [persona, scenarios, atoms, recentMessages] = await Promise.all([
      this.loadPersona(db),
      this.recallScenarios(db),
      this.recallAtoms(db, query, signal),
      this.loadRecentMessages(db, sessionId),
    ]);
    if (signal?.aborted) {
      throw new DOMException("Memory recall aborted", "AbortError");
    }

    const contextString = this.buildContextString(
      persona,
      scenarios,
      atoms,
      recentMessages,
    );

    return { persona, scenarios, atoms, recentMessages, contextString };
  }

  private async loadPersona(db: BookmarkForgeDB): Promise<MemoryPersona | null> {
    try {
      const persona = await db.memory
        .findOne("persona")
        .exec();
      return persona ? (persona.toJSON() as unknown as MemoryPersona) : null;
    } catch (_err) {
      return null;
    }
  }

  private async recallScenarios(db: BookmarkForgeDB): Promise<MemoryScenario[]> {
    try {
      const scenarios = await db.memory
        .find({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- rxdb selector typing is opaque
          selector: { type: "profile", profileType: "scenario" } as any,
          sort: [{ frequency: "desc" }],
          limit: this.config.maxScenariosInContext,
        })
        .exec();

      return scenarios.map(
        (s: RxDocument<MemoryRecord>) =>
          s.toJSON() as unknown as MemoryScenario,
      );
    } catch (_err) {
      return [];
    }
  }

  private async recallAtoms(
    db: BookmarkForgeDB,
    query: string,
    signal?: AbortSignal,
  ): Promise<MemoryAtom[]> {
    try {
      if (signal?.aborted) {
        throw new DOMException("Memory atom recall aborted", "AbortError");
      }

      // A fresh vault has no memory atoms yet. Avoid loading the embedding
      // model just to search an empty collection; local chat can continue
      // directly to the selected provider (for example Ollama).
      const atomProbe = await db.memory
        .find({ selector: { type: "atom" }, limit: 1 })
        .exec();
      if (atomProbe.length === 0) {
        return [];
      }

      const queryEmbedding = await ragEngine.generateEmbedding(query, signal);

      // Use vector index for instant semantic search
      const searchResults = await vectorIndexService.search(
        queryEmbedding,
        this.config.maxAtomsInContext,
        signal,
      );

      if (signal?.aborted) {
        throw new DOMException("Memory atom recall aborted", "AbortError");
      }
      const neighbors = (
        searchResults as { neighbors?: Array<{ id: string }> } | null
      )?.neighbors;
      if (!neighbors) {
        return [];
      }

      // Filter for memory atoms and extract IDs
      const atomIds = neighbors
        .filter((n): n is { id: string } => n.id.startsWith("atom:"))
        .map((n) => n.id.replace("atom:", ""));

      if (atomIds.length === 0) {
        return [];
      }

      // Fetch the actual atom documents from RxDB
      const atoms = await Promise.all(
        atomIds.map((id) => db.memory.findOne(id).exec()),
      );
      if (signal?.aborted) {
        throw new DOMException("Memory atom recall aborted", "AbortError");
      }

      return atoms
        .filter(Boolean)
        .map((a) => (a as RxDocument<MemoryRecord>).toJSON() as MemoryAtom);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw error;
      }
      logger.warn("[MemoryRecall] Failed to recall atoms", {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  private async loadRecentMessages(
    db: BookmarkForgeDB,
    sessionId: string,
  ): Promise<MemoryChatMessage[]> {
    try {
      const messages = await db.memory
        .find({
          selector: { type: "message", sessionId },
          sort: [{ createdAt: "desc" }],
          limit: this.config.maxRecentMessages,
        })
        .exec();

      // PRIVACY: private messages are excluded from the recall context so
      // their content never reaches the LLM prompt, even within a session.
      return messages
        .map(
          (m: RxDocument<MemoryRecord>) =>
            m.toJSON() as MemoryChatMessage,
        )
        .filter((m: MemoryChatMessage) => m.isPrivate === false)
        .reverse();
    } catch (_err) {
      return [];
    }
  }

  private buildContextString(
    persona: MemoryPersona | null,
    scenarios: MemoryScenario[],
    atoms: MemoryAtom[],
    recentMessages: MemoryChatMessage[],
  ): string {
    const parts: string[] = [];

    if (
      persona &&
      (persona.preferences.length > 0 || persona.goals.length > 0)
    ) {
      parts.push("=== USER PROFILE ===");
      if (persona.preferences.length > 0) {
        parts.push(`Preferences: ${persona.preferences.join("; ")}`);
      }
      if (persona.goals.length > 0) {
        parts.push(`Goals: ${persona.goals.join("; ")}`);
      }
      if (persona.tone) {
        parts.push(`Communication style: ${persona.tone}`);
      }
      if (persona.workflows.length > 0) {
        parts.push(`Known workflows: ${persona.workflows.join("; ")}`);
      }
      parts.push("");
    }

    if (scenarios.length > 0) {
      parts.push("=== RELEVANT PATTERNS ===");
      scenarios.forEach((s, i) => {
        parts.push(`Pattern ${i + 1}: ${s.title}`);
        parts.push(s.description);
      });
      parts.push("");
    }

    if (atoms.length > 0) {
      parts.push("=== KNOWN FACTS ===");
      atoms.forEach((a) => {
        parts.push(`[${a.category}] ${a.content}`);
      });
      parts.push("");
    }

    if (recentMessages.length > 0) {
      parts.push("=== RECENT CONVERSATION ===");
      recentMessages.forEach((m) => {
        const role = m.role === "user" ? "User" : "Assistant";
        parts.push(`${role}: ${m.content.substring(0, 500)}`);
      });
      parts.push("");
    }

    return parts.join("\n");
  }
}

export const memoryRecall = new MemoryRecall();
