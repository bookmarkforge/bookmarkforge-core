import { initDB } from "../db/database";
import type { RxDocument } from "rxdb";
import { aiManager } from "../services/ai/ProviderManager";
import { logger } from "../utils/logger";
import { generateId } from "../utils/id";
import { memoryPipeline } from "./MemoryPipeline";
import { memoryRecall } from "./MemoryRecall";
import { useMemoryStore } from "../store/useMemoryStore";
import type {
  MemoryChatMessage,
  MemoryPersona,
  MemorySession,
  MemoryPipelineConfig,
  MemoryRecord,
} from "./MemoryTypes";
import { DEFAULT_PIPELINE_CONFIG } from "./MemoryTypes";
import { securityVault } from "../services/SecurityVault";

class MemoryEngine {
  private initialized = false;
  private initializePromise: Promise<void> | null = null;
  private initializationGeneration = 0;
  private sessionIdleTimers: Map<string, ReturnType<typeof setTimeout>> =
    new Map();
  // Serialize session writes so concurrent user/assistant messages cannot
  // overwrite each other's messageIds or lastActive patch in RxDB.
  private sessionWriteQueues = new Map<string, Promise<void>>();
  // A full memory wipe is a write barrier. New session writes wait until the
  // wipe completes, while the wipe waits for writes already in progress.
  private memoryClearPromise: Promise<void> | null = null;
  // Vault locks use a barrier that remains closed until unlock. This prevents
  // a write started before lock from crossing into the next vault context.
  private vaultTransitionPromise: Promise<void> | null = null;
  private releaseVaultTransition: (() => void) | null = null;

  /**
   * A vault transition is a hard boundary for conversational context. The
   * database remains encrypted at rest, but active session IDs, persona data,
   * and idle timers must not survive in the in-memory application state.
   */
  resetForVaultTransition(): void {
    for (const timer of this.sessionIdleTimers.values()) {
      clearTimeout(timer);
    }
    this.sessionIdleTimers.clear();
    this.initialized = false;
    this.initializationGeneration += 1;
    this.initializePromise = null;
    useMemoryStore.getState().reset();
    memoryPipeline.reset();
  }

  async initialize(
    _config: Partial<MemoryPipelineConfig> = {},
    signal?: AbortSignal,
  ): Promise<void> {
    if (signal?.aborted) {
      throw new DOMException("Memory initialization aborted", "AbortError");
    }
    if (this.initialized) {return;}
    if (this.initializePromise) {return this.initializePromise;}

    const generation = this.initializationGeneration;
    const operation = this.initializeInternal(generation, signal);
    const guarded = operation.finally(() => {
      if (this.initializePromise === guarded) {
        this.initializePromise = null;
      }
    });
    this.initializePromise = guarded;
    return guarded;
  }

  private async initializeInternal(
    generation: number,
    signal?: AbortSignal,
  ): Promise<void> {
    try {
      const db = await initDB();
      if (signal?.aborted) {
        throw new DOMException("Memory initialization aborted", "AbortError");
      }

      const collections = ["memory"];
      const dbKeys = Object.keys(db);
      const missing = collections.filter((c) => !dbKeys.includes(c));

      if (missing.length > 0) {
        logger.info(
          "[MemoryEngine] Memory collection not yet created, it will be auto-created on first use",
        );
      }

      const persona = await db.memory
        .findOne("persona")
        .exec();
      if (signal?.aborted) {
        throw new DOMException("Memory initialization aborted", "AbortError");
      }
      if (generation !== this.initializationGeneration) {return;}
      if (persona) {
        useMemoryStore
          .getState()
          .setPersona(persona.toJSON() as unknown as MemoryPersona);
      }

      const stats = await memoryPipeline.getStats();
      if (signal?.aborted) {
        throw new DOMException("Memory initialization aborted", "AbortError");
      }
      if (generation !== this.initializationGeneration) {return;}
      useMemoryStore.getState().updateCounts(stats.atoms, stats.scenarios);

      this.initialized = true;
      logger.info("[MemoryEngine] Initialized", { stats });
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        throw e;
      }
      logger.warn(
        "[MemoryEngine] Initialization failed, will retry on next use",
        { error: e instanceof Error ? e.message : String(e) },
      );
    }
  }

  async createSession(title: string, signal?: AbortSignal): Promise<string> {
    return this.enqueueSessionWrite("__session_creation__", () =>
      this.createSessionInternal(title, signal),
    );
  }

  private async createSessionInternal(
    title: string,
    signal?: AbortSignal,
  ): Promise<string> {
    if (signal?.aborted) {
      throw new DOMException("Session creation aborted", "AbortError");
    }
    const db = await initDB();
    if (signal?.aborted) {
      throw new DOMException("Session creation aborted", "AbortError");
    }
    const now = new Date().toISOString();
    const sessionId = generateId();

    const session: MemorySession = {
      type: "session",
      id: sessionId,
      title,
      messageIds: [],
      createdAt: now,
      startedAt: now,
      lastActive: now,
    };

    const insertedSession = await db.memory.insert(session);
    if (signal?.aborted) {
      await insertedSession.remove();
      throw new DOMException("Session creation aborted", "AbortError");
    }
    useMemoryStore.getState().setActiveSession(sessionId);
    logger.info("[MemoryEngine] Created session", { sessionId, title });
    return sessionId;
  }

  private enqueueSessionWrite<T>(
    sessionId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const generation = this.initializationGeneration;
    const previous = this.sessionWriteQueues.get(sessionId) ?? Promise.resolve();
    const clearBarrier = this.memoryClearPromise ?? Promise.resolve();
    const vaultBarrier = this.vaultTransitionPromise ?? Promise.resolve();
    const guardedOperation = () => {
      if (generation !== this.initializationGeneration) {
        throw new DOMException("Session write invalidated", "AbortError");
      }
      return operation();
    };
    const queued = Promise.all([previous, clearBarrier, vaultBarrier]).then(
      guardedOperation,
      guardedOperation,
    );
    const tracking = queued.then(
      () => undefined,
      () => undefined,
    );
    this.sessionWriteQueues.set(sessionId, tracking);
    void tracking.finally(() => {
      if (this.sessionWriteQueues.get(sessionId) === tracking) {
        this.sessionWriteQueues.delete(sessionId);
      }
    });
    return queued;
  }

  beginVaultTransition(): void {
    this.resetForVaultTransition();
    if (this.vaultTransitionPromise) {return;}

    const pendingWrites = [...this.sessionWriteQueues.values()];
    let release!: () => void;
    const unlockGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const operation = Promise.all([
      Promise.allSettled(pendingWrites).then(() => undefined),
      unlockGate,
    ]).then(() => undefined);
    this.vaultTransitionPromise = operation;
    this.releaseVaultTransition = release;
    void operation.finally(() => {
      if (this.vaultTransitionPromise === operation) {
        this.vaultTransitionPromise = null;
        this.releaseVaultTransition = null;
      }
    });
  }

  endVaultTransition(): void {
    this.resetForVaultTransition();
    this.releaseVaultTransition?.();
  }

  async addMessage(
    sessionId: string,
    role: "user" | "assistant" | "system",
    content: string,
    sources?: unknown[],
    isPrivate: boolean = false,
    signal?: AbortSignal,
  ): Promise<string> {
    return this.enqueueSessionWrite(sessionId, () =>
      this.addMessageInternal(
        sessionId,
        role,
        content,
        sources,
        isPrivate,
        signal,
      ),
    );
  }

  private async addMessageInternal(
    sessionId: string,
    role: "user" | "assistant" | "system",
    content: string,
    sources?: unknown[],
    isPrivate: boolean = false,
    signal?: AbortSignal,
  ): Promise<string> {
    if (signal?.aborted) {
      throw new DOMException("Memory message write aborted", "AbortError");
    }
    const db = await initDB();
    if (signal?.aborted) {
      throw new DOMException("Memory message write aborted", "AbortError");
    }
    const now = new Date().toISOString();
    const messageId = generateId();

    const message: MemoryChatMessage = {
      type: "message",
      id: messageId,
      sessionId,
      role,
      content,
      ...(sources ? { sources } : {}),
      isPrivate,
      createdAt: now,
    };

    const insertedMessage = await db.memory.insert(message);
    if (signal?.aborted) {
      await insertedMessage.remove();
      throw new DOMException("Memory message write aborted", "AbortError");
    }

    const sessionDoc = await db.memory.findOne(sessionId).exec();
    let previousMessageIds: string[] | null = null;
    let previousLastActive: string | null = null;
    if (sessionDoc) {
      const session = sessionDoc.toJSON() as MemorySession;
      previousMessageIds = session.messageIds;
      previousLastActive = session.lastActive;
      await sessionDoc.incrementalPatch({
        messageIds: [...session.messageIds, messageId],
        lastActive: now,
      });
    }
    if (signal?.aborted) {
      if (sessionDoc && previousMessageIds) {
        await sessionDoc.incrementalPatch({
          messageIds: previousMessageIds,
          ...(previousLastActive ? { lastActive: previousLastActive } : {}),
        });
      }
      await insertedMessage.remove();
      throw new DOMException("Memory message write aborted", "AbortError");
    }

    if (role === "user") {
      this.resetSessionIdleTimer(sessionId);
      if (!signal?.aborted && !isPrivate) {
        // Atom extraction may load an embedding model or call a local AI
        // provider. It is enrichment, not part of the durable chat write;
        // never make the user's response wait for that background work.
        void Promise.resolve(memoryPipeline.onNewMessage(message)).catch(
          (error: unknown) => {
            logger.warn("[MemoryEngine] Background memory extraction failed", {
              error: error instanceof Error ? error.message : String(error),
            });
          },
        );
      }
    }

    return messageId;
  }

  async closeSession(sessionId: string): Promise<void> {
    return this.enqueueSessionWrite(sessionId, () =>
      this.closeSessionInternal(sessionId),
    );
  }

  private async closeSessionInternal(sessionId: string): Promise<void> {
    const db = await initDB();
    const sessionDoc = await db.memory.findOne(sessionId).exec();

    if (sessionDoc) {
      const SUMMARY_MESSAGE_LIMIT = 10;
      const messages = await db.memory
        .find({
          selector: { type: "message", sessionId },
          sort: [{ createdAt: "desc" }],
          limit: SUMMARY_MESSAGE_LIMIT,
        })
        .exec();

      // PRIVACY: private messages are excluded from the session summary too
      // (consistent with extractAtoms), so private content is never persisted
      // into the session summary.
      const publicMessages = messages.filter(
        (m: RxDocument<MemoryRecord>) =>
          (m.toJSON() as MemoryChatMessage).isPrivate === false,
      );

      if (publicMessages.length >= 4) {
        const summary = await this.generateSessionSummary(
          // The generator only reads `(m as MemoryChatMessage).role` and
          // `.content`; the unified-collection doc shape is a strict superset
          // of the chat-message shape so a structural cast is safe here.
          publicMessages.reverse() as unknown as RxDocument<MemoryChatMessage>[],
        );
        await sessionDoc.incrementalPatch({ summary });
      }
    }

    const timer = this.sessionIdleTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.sessionIdleTimers.delete(sessionId);
    }

    useMemoryStore.getState().setActiveSession(null);
    logger.info("[MemoryEngine] Closed session", { sessionId });
  }

  async getContextForQuery(
    query: string,
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const generation = this.initializationGeneration;
    // A chat request is active now; defer idle closure while its context is
    // being recalled. The timer is refreshed again when the message is saved.
    this.resetSessionIdleTimer(sessionId);
    if (signal?.aborted) {
      throw new DOMException("Memory recall aborted", "AbortError");
    }
    if (!this.initialized) {
      await this.initialize({}, signal);
    }
    if (generation !== this.initializationGeneration) {
      throw new DOMException("Memory recall invalidated", "AbortError");
    }

    const recallResult = await memoryRecall.recall(query, sessionId, signal);
    if (signal?.aborted) {
      throw new DOMException("Memory recall aborted", "AbortError");
    }
    if (generation !== this.initializationGeneration) {
      throw new DOMException("Memory recall invalidated", "AbortError");
    }
    return recallResult.contextString;
  }

  async getActiveSession(): Promise<string | null> {
    return useMemoryStore.getState().activeSessionId;
  }

  async getOrCreateSession(
    title: string,
    signal?: AbortSignal,
  ): Promise<string> {
    if (signal?.aborted) {
      throw new DOMException("Session lookup aborted", "AbortError");
    }
    const existing = useMemoryStore.getState().activeSessionId;
    if (existing) {
      this.resetSessionIdleTimer(existing);
      return existing;
    }
    return this.createSession(title, signal);
  }

  private resetSessionIdleTimer(sessionId: string): void {
    const existing = this.sessionIdleTimers.get(sessionId);
    if (existing) {clearTimeout(existing);}

    const timer = setTimeout(() => {
      // Remove the fired handle before doing summary work. A slow summary
      // must not leave a dead timer entry that looks active to later writes.
      this.sessionIdleTimers.delete(sessionId);
      this.closeSession(sessionId).catch((error: unknown) =>
        logger.warn("[MemoryEngine] Idle session close failed", {
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }, DEFAULT_PIPELINE_CONFIG.sessionIdleTimeoutMs);

    this.sessionIdleTimers.set(sessionId, timer);
  }

  private async generateSessionSummary(
    messages: RxDocument<MemoryChatMessage>[],
  ): Promise<string> {
    try {
      const text = messages
        .slice(-10)
        .map((m) => {
          const doc = m.toJSON() as MemoryChatMessage;
          return `${doc.role}: ${doc.content.substring(0, 300)}`;
        })
        .join("\n");

      const systemPrompt = `Summarize this conversation in 1-2 sentences. Be concise. Respond with ONLY the summary.`;

      const response = await aiManager.generateText(text, systemPrompt, {
        complexity: "simple",
        isPrivate: true,
      });

      return response.text.trim();
    } catch (e) {
      logger.warn("[MemoryEngine] Failed to generate session summary", { error: e });
      return "";
    }
  }

  async clearAllMemory(): Promise<void> {
    ++this.initializationGeneration;
    for (const timer of this.sessionIdleTimers.values()) {
      clearTimeout(timer);
    }
    this.sessionIdleTimers.clear();
    this.initialized = false;
    this.initializePromise = null;

    const previousClear = this.memoryClearPromise;
    const pendingWrites = [...this.sessionWriteQueues.values()];
    const operation = (async () => {
      if (previousClear) {
        await previousClear;
      }
      // Let writes that crossed the wipe boundary finish (or reject) before
      // deleting collections. Otherwise a late insert can resurrect memory
      // immediately after the user asked to clear it.
      await Promise.allSettled(pendingWrites);

      const db = await initDB();
      await Promise.all([
        db.memory
          .find({ selector: { type: "atom" } as Record<string, unknown> })
          .remove(),
        db.memory
          .find({ selector: { type: "profile" } as Record<string, unknown> })
          .remove(),
        db.memory
          .find({ selector: { type: "session" } as Record<string, unknown> })
          .remove(),
        db.memory
          .find({ selector: { type: "message" } as Record<string, unknown> })
          .remove(),
      ]);

      useMemoryStore.getState().reset();
      memoryPipeline.reset();
      logger.info("[MemoryEngine] All memory cleared");
    })();
    this.memoryClearPromise = operation;

    try {
      await operation;
    } catch (e) {
      logger.error("[MemoryEngine] Failed to clear memory", { error: e });
    } finally {
      if (this.memoryClearPromise === operation) {
        this.memoryClearPromise = null;
      }
    }
  }

  async getStats(): Promise<{
    atoms: number;
    scenarios: number;
    hasPersona: boolean;
    sessions: number;
  }> {
    const db = await initDB();    const [atoms, scenarioDocs, persona, sessions] = await Promise.all([
      db.memory.count({ selector: { type: "atom" } }).exec(),
      db.memory
        .find({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any -- rxdb selector typing on discriminated unions is opaque
          selector: { type: "profile", profileType: "scenario" } as any,
        })
        .exec(),
      db.memory.findOne("persona").exec(),
      db.memory.count({ selector: { type: "session" } }).exec(),
    ]);

    // RxDB .count().exec() returns a number in current versions; the
    // legacy double-cast (amount || number) was for an older RxDB shape.
    const extractCount = (raw: unknown): number => {
      if (typeof raw === "number") {return raw;}
      if (raw && typeof raw === "object" && "amount" in (raw as Record<string, unknown>))
        {return (raw as { amount: number }).amount;}
      return 0;
    };

    return {
      atoms: extractCount(atoms),
      scenarios: scenarioDocs.length,
      hasPersona: !!persona,
      sessions: extractCount(sessions),
    };
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}

export const memoryEngine = new MemoryEngine();

// Do not carry a conversation, persona snapshot, or scheduled memory work
// across vault lock/unlock boundaries. Persistent records remain protected by
// the encrypted RxDB storage and are reloaded lazily in the new lifecycle.
securityVault.onLock(() => memoryEngine.beginVaultTransition());
securityVault.onUnlock(() => memoryEngine.endVaultTransition());
