import { logger } from "../../../utils/logger";
import { secureStorage } from "../../SecureStorage";
import { logRateLimited } from "../../../utils/boundedLog";

type TaskType = "chat" | "embed" | "classify" | "search" | "code" | "summarize";
// Exported so ProviderManager can restrict the optimizer to usable providers.
export type AIProviderId =
  "gemini" | "ollama" | "webllm" | "openai" | "anthropic" | "groq";

interface QState {
  taskType: TaskType;
  complexity: "simple" | "complex";
  connectivity: "online" | "offline" | "slow";
  batteryRange: "high" | "low";
}

interface Outcome {
  taskType: TaskType;
  provider: AIProviderId;
  latencyMs: number;
  success: boolean;
  cost: number;
  timestamp: string;
}

const QTABLE_KEY = "bmf_routing_qtable";
const EXPLORATION_RATE = 0.1;
const LEARNING_RATE = 0.5;
const DISCOUNT_FACTOR = 0.9;
const PROVIDERS: AIProviderId[] = [
  "gemini",
  "ollama",
  "webllm",
  "openai",
  "anthropic",
  "groq",
];

function stateKey(state: QState): string {
  return `${state.taskType}|${state.complexity}|${state.connectivity}|${state.batteryRange}`;
}

class RoutingOptimizer {
  private qTable = new Map<string, Map<AIProviderId, number>>();
  private outcomeHistory: Outcome[] = [];
  private totalDecisions = 0;
  private initialized = false;
  // Persistence is serialized so a vault clear always runs after any write
  // already in flight. The generation guard also skips queued writes from the
  // previous vault instead of allowing them to repopulate cleared state.
  private persistenceGeneration = 0;
  private persistenceChain: Promise<void> = Promise.resolve();

  async init(): Promise<void> {
    if (this.initialized) {return;}
    // A clear() queues removal in the same chain. Do not restore the old
    // snapshot before that removal has completed.
    await this.persistenceChain;
    if (this.initialized) {return;}
    const generation = this.persistenceGeneration;
    try {
      const stored =
        await secureStorage.get<Record<string, Record<string, number>>>(
          QTABLE_KEY,
        );
      // A vault transition may have happened while storage was being read.
      // Do not restore the old vault's routing state after it was cleared.
      if (generation === this.persistenceGeneration && stored) {
        for (const [key, actions] of Object.entries(stored)) {
          this.qTable.set(
            key,
            new Map(Object.entries(actions) as [AIProviderId, number][]),
          );
        }
      }
    } catch (error) {
      // Missing/corrupt routing state is recoverable as a fresh table, but
      // losing learned provider data should still be visible and bounded.
      logRateLimited(
        "warn",
        "routing-optimizer-load",
        "Failed to restore routing state; starting fresh",
        { error: error instanceof Error ? error.message : String(error) },
      );
    }
    if (generation === this.persistenceGeneration) {
      this.initialized = true;
      logger.info("[RoutingOptimizer] Initialized");
    }
  }

  /**
   * Selects the best provider for a task, restricted to the providers that
   * are actually usable by the caller.
   *
   * CRITICAL (audit #1): exploration/exploitation must NEVER pick a provider
   * the caller has not configured — doing so routes ~10% of requests to
   * providers without an API key (failures) or to more expensive providers.
   * When `availableProviders` is omitted (legacy/tests), the full PROVIDERS
   * list is used to preserve backward-compatible behavior.
   */
  async selectProvider(
    taskType: TaskType,
    state: Partial<QState>,
    defaultProvider: AIProviderId,
    availableProviders: AIProviderId[] = PROVIDERS,
  ): Promise<AIProviderId> {
    await this.init();
    this.totalDecisions++;

    const usable =
      availableProviders.length > 0 ? availableProviders : [defaultProvider];

    const fullState: QState = {
      taskType,
      complexity: state.complexity ?? "simple",
      connectivity: state.connectivity ?? "online",
      batteryRange: state.batteryRange ?? "high",
    };

    const key = stateKey(fullState);
    const qValues = this.qTable.get(key) ?? new Map();

    // Epsilon-greedy: explore ONLY among usable providers
    if (Math.random() < EXPLORATION_RATE) {
      const randomProvider =
        usable[Math.floor(Math.random() * usable.length)]!;
      logger.debug(
        `[RoutingOptimizer] Exploring: ${randomProvider} for ${taskType} (of ${usable.length} available providers)`,
      );
      return randomProvider;
    }

    // Exploit: pick the best KNOWN provider among the usable ones
    const best = usable
      .map((p) => [p, qValues.get(p) ?? 0] as const)
      .sort((a, b) => b[1] - a[1])[0];
    if (best && best[1] > 0) {
      logger.debug(
        `[RoutingOptimizer] Best: ${best[0]!} (Q=${best[1]!.toFixed(3)}) for ${taskType}`,
      );
      return best[0]!;
    }

    // Contract: never return a provider outside the usable list. If the
    // list were empty (defaultProvider not included), fall back to the default.
    if (usable.includes(defaultProvider)) {return defaultProvider;}
    return usable[0] ?? defaultProvider;
  }

  async recordOutcome(
    taskType: TaskType,
    provider: AIProviderId,
    latencyMs: number,
    success: boolean,
    cost: number,
    state: Partial<QState> = {},
  ): Promise<void> {
    const generation = this.persistenceGeneration;
    await this.init();
    // Do not record outcomes produced by a vault/session that was cleared
    // while the optimizer was loading its persisted state.
    if (generation !== this.persistenceGeneration) {return;}

    const outcome: Outcome = {
      taskType,
      provider,
      latencyMs,
      success,
      cost,
      timestamp: new Date().toISOString(),
    };
    this.outcomeHistory.push(outcome);
    if (this.outcomeHistory.length > 1000) {
      this.outcomeHistory = this.outcomeHistory.slice(-1000);
    }

    // Reward: combination of success, latency (lower is better), cost (lower is better)
    const latencyReward = Math.max(0, 1 - latencyMs / 10000);
    const costReward = Math.max(0, 1 - cost * 100);
    const successReward = success ? 1 : -1;
    const reward = successReward * 0.5 + latencyReward * 0.3 + costReward * 0.2;

    const fullState: QState = {
      taskType,
      complexity: state.complexity ?? "simple",
      connectivity: state.connectivity ?? "online",
      batteryRange: state.batteryRange ?? "high",
    };

    const key = stateKey(fullState);
    if (!this.qTable.has(key)) {
      this.qTable.set(key, new Map());
    }
    const qValues = this.qTable.get(key)!;
    const currentQ = qValues.get(provider) ?? 0;
    // Discounted max over the OTHER actions of this state — excluding the
    // action being updated, so the update does not reinforce itself.
    const bestOther = Math.max(
      0,
      ...Array.from(qValues.entries())
        .filter(([p]) => p !== provider)
        .map(([, v]) => v),
    );
    const newQ =
      currentQ +
      LEARNING_RATE * (reward + DISCOUNT_FACTOR * bestOther - currentQ);
    qValues.set(provider, newQ);
    this.qTable.set(key, qValues);

    // Persist periodically, unless a vault transition happened while this
    // outcome was being processed.
    if (
      this.totalDecisions % 10 === 0 &&
      generation === this.persistenceGeneration
    ) {
      await this.persist();
    }
  }

  getStats(): {
    totalDecisions: number;
    statesLearned: number;
    recentOutcomes: Outcome[];
  } {
    return {
      totalDecisions: this.totalDecisions,
      statesLearned: this.qTable.size,
      recentOutcomes: this.outcomeHistory.slice(-20),
    };
  }

  private enqueuePersistence(operation: () => Promise<void>): Promise<void> {
    const next = this.persistenceChain.then(operation, operation);
    // Keep the queue usable after an individual storage operation fails.
    this.persistenceChain = next.catch(() => undefined);
    return next;
  }

  async persist(): Promise<void> {
    const generation = this.persistenceGeneration;
    const obj: Record<string, Record<string, number>> = {};
    for (const [key, actions] of this.qTable) {
      obj[key] = Object.fromEntries(actions);
    }
    await this.enqueuePersistence(async () => {
      if (generation !== this.persistenceGeneration) {return;}
      try {
        await secureStorage.set(QTABLE_KEY, obj);
      } catch (_err) {
        logger.warn("[RoutingOptimizer] Persist failed");
      }
    });
  }

  clear(): void {
    this.persistenceGeneration++;
    this.initialized = false;
    this.qTable.clear();
    this.outcomeHistory = [];
    this.totalDecisions = 0;
    void this.enqueuePersistence(async () => {
      try {
        await secureStorage.remove(QTABLE_KEY);
      } catch (err) {
        logger.warn("[RoutingOptimizer] Failed to clear Q-table", {
          error: err,
        });
      }
    });
  }
}

export const routingOptimizer = new RoutingOptimizer();
