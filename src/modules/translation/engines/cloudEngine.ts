/**
 * src/modules/translation/engines/cloudEngine.ts
 *
 * BYOK cloud translation for the Free plan — Core (MIT).
 *
 * This is the ONLY path where translated text leaves the device, and it is
 * reached only when:
 *   - the selector resolved `cloud` (Free plan, or an explicit Pro choice), and
 *   - the provider manager reports a configured provider.
 *
 * Privacy posture: `isPrivate: false` is passed EXPLICITLY. ProviderManager
 * fails closed on omitted privacy metadata, so the opt-in cannot be accidental.
 *
 * Cost posture: ProviderManager records the spend itself. This adapter returns
 * the DELTA of the app's cost ledger so the translation meter reports real
 * money instead of duplicating the pricing table.
 */

import { aiManager } from "../../../services/ai/ProviderManager";
import type { AIProvider } from "../../../services/ai/types";
import { TranslationError } from "../errors";
import { readSpendSnapshot } from "../cost/costMeter";

export interface CloudGenerateOptions {
  systemPrompt: string;
  userPrompt: string;
  temperature: number;
  maxTokens: number;
  onDelta?: (delta: string) => void;
  signal?: AbortSignal;
  onProvider?: (provider: AIProvider) => void;
}

export interface CloudGenerateResult {
  text: string;
  provider: string;
  model: string;
  costDeltaUSD: number;
}

export async function cloudGenerate(
  options: CloudGenerateOptions,
): Promise<CloudGenerateResult> {
  const info = aiManager.getProviderInfo();
  if (!info.isConfigured) {
    throw new TranslationError(
      "not-configured",
      "No cloud AI provider is configured. Add an API key in Settings.",
    );
  }

  const spendBefore = readSpendSnapshot();

  try {
    const response = await aiManager.streamGenerateText(
      options.userPrompt,
      options.systemPrompt,
      {
        // Explicit opt-in: this call is allowed to leave the device.
        isPrivate: false,
        signal: options.signal,
      },
      options.onDelta,
      (provider) => options.onProvider?.(provider),
    );

    return {
      text: response.text ?? "",
      provider: response.provider,
      model: info.model,
      costDeltaUSD: Math.max(0, readSpendSnapshot() - spendBefore),
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {throw error;}
    throw new TranslationError(
      "generation-failed",
      error instanceof Error ? error.message : String(error),
      error,
    );
  }
}
