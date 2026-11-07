/**
 * src/modules/translation/cost/costMeter.ts
 *
 * Spend accounting for translation — Core (MIT).
 *
 * Two numbers matter to the product:
 *   totalUSD   what this run actually cost the user (0 for a local engine);
 *   savedUSD   what the SAME run would have cost on their configured cloud
 *              provider (the "Pro pays for itself" number).
 *
 * `totalUSD` is not recomputed from the pricing table: ProviderManager already
 * calls `costTrackerService.recordRequest` for every cloud call, and charging
 * twice would corrupt the user's daily budget. The pipeline instead feeds the
 * meter the DELTA of `costTrackerService.getTotalCost(1)` around each call.
 * `savedUSD` uses the table because no request was made.
 */

import {
  PROVIDER_PRICING,
  costTrackerService,
} from "../../../services/ai/CostTrackerService";
import type { TranslationEngineId } from "../types";

export interface TranslationCostSnapshot {
  totalUSD: number;
  savedUSD: number;
  provider: string;
  model: string;
  isFreePlan: boolean;
  isLocal: boolean;
}

/** Cost of `tokensIn`/`tokensOut` at a provider's published rates. */
export function estimateCostUSD(
  provider: string,
  tokensIn: number,
  tokensOut: number,
): number {
  const pricing = PROVIDER_PRICING[provider] ?? PROVIDER_PRICING.custom;
  if (!pricing) {return 0;}
  return (
    (Math.max(0, tokensIn) * pricing.inputPer1K +
      Math.max(0, tokensOut) * pricing.outputPer1K) /
    1000
  );
}

/**
 * Pre-flight estimate for the whole document.
 *
 * Output length is assumed 1.15× the input (translation expands slightly on
 * most European pairs). This is an ESTIMATE to show before spending, never a
 * budget guard — the budget guard is `costTrackerService.assertUnderBudget`
 * inside ProviderManager.
 */
export function estimateDocumentCostUSD(
  provider: string,
  sourceTokens: number,
): number {
  const tokensOut = Math.ceil(sourceTokens * 1.15);
  return estimateCostUSD(provider, sourceTokens, tokensOut);
}

/** Total spend recorded by the app in the last day (delta source). */
export function readSpendSnapshot(): number {
  return costTrackerService.getTotalCost(1);
}

export interface TranslationCostMeterOptions {
  engine: TranslationEngineId;
  /** Provider used (or that WOULD be used) for the savings comparison. */
  cloudProvider: string;
  cloudModel: string;
  isFreePlan: boolean;
}

export class TranslationCostMeter {
  private totalUSD = 0;
  private savedTokens = { in: 0, out: 0 };
  private readonly options: TranslationCostMeterOptions;

  constructor(options: TranslationCostMeterOptions) {
    this.options = options;
  }

  get isLocal(): boolean {
    return this.options.engine !== "cloud";
  }

  /**
   * Record the cost of one provider call. `actualDeltaUSD` is the measured
   * increase of the app's cost ledger (0 for local engines).
   */
  observe(tokensIn: number, tokensOut: number, actualDeltaUSD: number): void {
    this.totalUSD += Math.max(0, actualDeltaUSD);
    if (this.isLocal) {
      this.savedTokens.in += tokensIn;
      this.savedTokens.out += tokensOut;
    }
  }

  snapshot(): TranslationCostSnapshot {
    return {
      totalUSD: this.totalUSD,
      savedUSD: this.isLocal
        ? estimateCostUSD(
            this.options.cloudProvider,
            this.savedTokens.in,
            this.savedTokens.out,
          )
        : 0,
      provider: this.options.cloudProvider,
      model: this.options.cloudModel,
      isFreePlan: this.options.isFreePlan,
      isLocal: this.isLocal,
    };
  }
}
