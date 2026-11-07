import { logger } from "../../utils/logger";
import { secureStorage } from "../SecureStorage";
import { observabilityHub } from "../../observability/ObservabilityHub";

export const PROVIDER_PRICING: Record<
  string,
  { inputPer1K: number; outputPer1K: number }
> = {
  google: { inputPer1K: 0.000075, outputPer1K: 0.0003 },
  gemini: { inputPer1K: 0.000075, outputPer1K: 0.0003 },
  openai: { inputPer1K: 0.0015, outputPer1K: 0.006 },
  anthropic: { inputPer1K: 0.003, outputPer1K: 0.015 },
  groq: { inputPer1K: 0.00009, outputPer1K: 0.00009 },
  custom: { inputPer1K: 0.0015, outputPer1K: 0.006 },
  ollama: { inputPer1K: 0, outputPer1K: 0 },
  webllm: { inputPer1K: 0, outputPer1K: 0 },
};

interface CostRecord {
  id: string;
  provider: string;
  model: string;
  operation: string;
  tokensIn: number;
  tokensOut: number;
  cost: number;
  durationMs: number;
  timestamp: string;
}

interface BudgetConfig {
  maxDailyUSD: number;
  enabled: boolean;
}

interface BudgetStatus {
  percentUsed: number;
  remaining: number;
  maxDailyUSD: number;
  alertLevel: "none" | "info" | "warning" | "critical" | "hard-stop";
}

const RECORDS_KEY = "bmf_cost_records";
const BUDGET_KEY = "bmf_cost_budget";
const MAX_RECORDS = 10000;
const RETENTION_DAYS = 90;

class CostTrackerService {
  private records: CostRecord[] = [];
  private budgets: Record<string, BudgetConfig> = {};
  // Per-provider count of requests admitted by assertUnderBudget whose cost
  // has not yet been recorded (in-flight spends). Prevents the concurrent
  // overshoot described on assertUnderBudget.
  private pendingSpends = new Map<string, number>();
  private initialized = false;

  async init(): Promise<void> {
    if (this.initialized) {return;}
    try {
      const stored = await secureStorage.get<CostRecord[]>(RECORDS_KEY);
      if (stored) {this.records = stored;}
      const budgetStored =
        await secureStorage.get<Record<string, BudgetConfig>>(BUDGET_KEY);
      if (budgetStored) {this.budgets = budgetStored;}
    } catch (error) {
      logger.warn("[CostTracker] Failed to load stored records", { error });
      this.records = [];
      this.budgets = {};
    }
    this.initialized = true;
    logger.info("[CostTracker] Initialized");
  }

  async recordRequest(
    provider: string,
    model: string,
    operation: string,
    tokensIn: number,
    tokensOut: number,
    durationMs: number,
  ): Promise<void> {
    await this.init();
    const pricing = PROVIDER_PRICING[provider];
    if (!pricing) {
      throw new Error(`No pricing configured for provider: ${provider}`);
    }
    const cost =
      (Math.max(0, tokensIn) * pricing.inputPer1K +
        Math.max(0, tokensOut) * pricing.outputPer1K) /
      1000;

    const record: CostRecord = {
      id: crypto.randomUUID(),
      provider,
      model,
      operation,
      tokensIn,
      tokensOut,
      cost,
      durationMs,
      timestamp: new Date().toISOString(),
    };

    this.records.push(record);
    if (this.records.length > MAX_RECORDS) {
      this.records = this.records.slice(-MAX_RECORDS);
    }

    observabilityHub.recordAICall(
      provider,
      model,
      durationMs,
      tokensIn,
      tokensOut,
    );

    const budgetStatus = this.getBudgetStatus(provider);
    if (budgetStatus.alertLevel === "hard-stop") {
      logger.warn(
        `[CostTracker] Hard stop reached for ${provider} — blocking request`,
      );
    }

    // Release the in-flight reservation admitted by assertUnderBudget.
    const pending = this.pendingSpends.get(provider);
    if (pending !== undefined) {
      if (pending <= 1) {this.pendingSpends.delete(provider);}
      else {this.pendingSpends.set(provider, pending - 1);}
    }

    await this.persist();
  }

  getUsageHistory(provider?: string, days: number = 7): CostRecord[] {
    const cutoff = Date.now() - days * 86400000;
    const filtered = this.records.filter(
      (r) => new Date(r.timestamp).getTime() > cutoff,
    );
    return provider
      ? filtered.filter((r) => r.provider === provider)
      : filtered;
  }

  getCostByProvider(days: number = 7): Record<string, number> {
    const costs: Record<string, number> = {};
    for (const r of this.getUsageHistory(undefined, days)) {
      costs[r.provider] = (costs[r.provider] ?? 0) + r.cost;
    }
    return costs;
  }

  getCostByOperation(days: number = 7): Record<string, number> {
    const costs: Record<string, number> = {};
    for (const r of this.getUsageHistory(undefined, days)) {
      costs[r.operation] = (costs[r.operation] ?? 0) + r.cost;
    }
    return costs;
  }

  getTotalTokensByProvider(
    days: number = 7,
  ): Record<string, { in: number; out: number }> {
    const totals: Record<string, { in: number; out: number }> = {};
    for (const r of this.getUsageHistory(undefined, days)) {
      if (!totals[r.provider]) {totals[r.provider] = { in: 0, out: 0 };}
      totals[r.provider]!.in += r.tokensIn;
      totals[r.provider]!.out += r.tokensOut;
    }
    return totals;
  }

  async setBudget(
    provider: string,
    maxDailyUSD: number,
    enabled: boolean = true,
  ): Promise<void> {
    this.budgets[provider] = { maxDailyUSD, enabled };
    try {
      await secureStorage.set(BUDGET_KEY, this.budgets);
    } catch (err) {
      logger.warn("[CostTracker] Failed to persist budget", { error: err });
    }
  }

  getBudget(provider: string): BudgetConfig {
    return this.budgets[provider] ?? { maxDailyUSD: 5, enabled: false };
  }

  getBudgetStatus(provider: string): BudgetStatus {
    const config = this.getBudget(provider);
    if (!config.enabled)
      {return {
        percentUsed: 0,
        remaining: 0,
        maxDailyUSD: config.maxDailyUSD,
        alertLevel: "none",
      };}

    const today = new Date().toISOString().slice(0, 10);
    const todayCost = this.records
      .filter((r) => r.provider === provider && r.timestamp.startsWith(today))
      .reduce((sum, r) => sum + r.cost, 0);

    const percent = (todayCost / config.maxDailyUSD) * 100;
    let alertLevel: BudgetStatus["alertLevel"] = "none";
    if (percent >= 100) {alertLevel = "hard-stop";}
    else if (percent >= 90) {alertLevel = "critical";}
    else if (percent >= 75) {alertLevel = "warning";}
    else if (percent >= 50) {alertLevel = "info";}

    return {
      percentUsed: Math.round(percent * 100) / 100,
      remaining: Math.max(0, config.maxDailyUSD - todayCost),
      maxDailyUSD: config.maxDailyUSD,
      alertLevel,
    };
  }

  /**
   * CRITICAL (audit #2): real hard-stop enforcement. Callers MUST invoke
   * this BEFORE spending money on a paid request. Throws when the provider's
   * daily budget is exhausted (alertLevel === "hard-stop"), so the request
   * is blocked instead of merely being logged.
   *
   * Concurrency guard: `assertUnderBudget` reserves one in-flight spend for
   * the provider (pendingSpends) that `recordRequest` later consumes. Two
   * concurrent requests therefore both see the OTHER's reservation as an
   * already-committed cost — a hard-stop can never overshoot by more than
   * the cost of the requests that were already in flight; it fails closed
   * (reservation never released) if a request dies before recording.
   */
  async assertUnderBudget(provider: string): Promise<void> {
    await this.init();
    const status = this.getBudgetStatus(provider);
    // Count every concurrent in-flight request as already-spent EXCEPT the
    // one being admitted (it will record its own cost on success).
    const inFlight = this.pendingSpends.get(provider) ?? 0;
    // A concurrent in-flight request (~1 full extra request) is treated as
    // already spent: at >= 99% used, only the first admitted request can
    // proceed without overflowing.
    if (status.alertLevel === "hard-stop" || (inFlight >= 1 && status.percentUsed >= 99)) {
      throw new Error(
        `Daily budget exhausted for ${provider} ($${status.maxDailyUSD}/day). ` +
          `Wait for tomorrow or increase the limit in Settings.`,
      );
    }
    this.pendingSpends.set(provider, inFlight + 1);
  }

  getTotalCost(days: number = 30): number {
    return this.getUsageHistory(undefined, days).reduce(
      (sum, r) => sum + r.cost,
      0,
    );
  }

  async clearRecords(): Promise<void> {
    this.records = [];
    // A manual reset must also release any stale in-flight reservations;
    // otherwise a request that died mid-spend would block the provider
    // forever on the next reload.
    this.pendingSpends.clear();
    await this.persist();
  }

  private async persist(): Promise<void> {
    try {
      const cutoff = Date.now() - RETENTION_DAYS * 86400000;
      this.records = this.records.filter(
        (r) => new Date(r.timestamp).getTime() > cutoff,
      );
      await secureStorage.set(RECORDS_KEY, this.records);    } catch (_err) {
      logger.warn("[CostTracker] Failed to persist records");
    }
  }
}

export const costTrackerService = new CostTrackerService();
