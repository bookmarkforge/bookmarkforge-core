/**
 * src/modules/translation/engines/engineSelector.ts
 *
 * Entitlement- and capability-aware engine selection. Core (MIT).
 *
 * Plan policy (product spec):
 *   Free → BYOK cloud only. Local engines are the Pro hook.
 *   Pro  → local first (WebLLM → Ollama → NLLB), cloud only as an explicit
 *          choice or as a last-resort fallback when the device cannot run any
 *          local engine (and a key is configured).
 *
 * The selector NEVER silently upgrades a Free request to a local engine nor a
 * Pro request to a paid cloud call: cloud fallback for Pro is only taken when
 * `preferred === "auto"` and the device genuinely cannot run local inference,
 * and the returned `fallback` flag lets the pipeline tell the user.
 */

import { floresCode } from "../constants";
import { TranslationEngineUnavailableError } from "../errors";
import type {
  TranslationCapabilities,
  TranslationEngineDescriptor,
  TranslationEngineId,
  TranslationEngineUnavailableReason,
} from "../types";
import { describeEngine } from "./engineCatalog";

export interface SelectTranslationEngineOptions {
  /** Result of `licenseService.hasProAccess()`, injected for testability. */
  isPro: boolean;
  preferred?: TranslationEngineId | "auto";
  capabilities: TranslationCapabilities;
  sourceLocale: string;
  targetLocale: string;
  /**
   * Pro-local-engine preference order. Lets the settings screen pin a model
   * without bypassing the availability checks.
   */
  localChain?: Array<Exclude<TranslationEngineId, "cloud">>;
}

export interface TranslationEngineSelection {
  descriptor: TranslationEngineDescriptor;
  /** True when `auto` could not use a local engine and fell back to cloud. */
  fallback: boolean;
  /** Machine-readable notes the UI can translate (never user-facing text). */
  warnings: TranslationEngineUnavailableReason[];
}

/** Why a local engine is unusable right now, or null when it is usable. */
export function localEngineBlocker(
  engine: Exclude<TranslationEngineId, "cloud">,
  capabilities: TranslationCapabilities,
  sourceLocale: string,
  targetLocale: string,
): TranslationEngineUnavailableReason | null {
  switch (engine) {
    case "webllm":
      if (!capabilities.webgpu) {return "webgpu-unavailable";}
      if (!capabilities.shaderF16) {return "shader-f16-unsupported";}
      if (capabilities.deviceMemoryGB < 4) {return "insufficient-memory";}
      return null;
    case "ollama":
      return capabilities.ollamaReachable ? null : "ollama-unreachable";
    case "nllb":
      return floresCode(sourceLocale) && floresCode(targetLocale)
        ? null
        : "unsupported-language-pair";
  }
}

/**
 * Resolve the engine for a translation request.
 *
 * @throws TranslationEngineUnavailableError `pro-required` when a local engine
 *   was requested by a Free user (fail closed — no silent cloud spend).
 * @throws TranslationEngineUnavailableError `not-configured` when no engine is
 *   usable at all.
 */
export function selectTranslationEngine(
  options: SelectTranslationEngineOptions,
): TranslationEngineSelection {
  const preferred = options.preferred ?? "auto";

  if (preferred !== "auto" && preferred !== "cloud") {
    if (!options.isPro) {
      throw new TranslationEngineUnavailableError(
        preferred,
        "pro-required",
        `Local translation engine "${preferred}" requires a Pro license.`,
      );
    }
    const blocker = localEngineBlocker(
      preferred,
      options.capabilities,
      options.sourceLocale,
      options.targetLocale,
    );
    if (blocker) {
      throw new TranslationEngineUnavailableError(preferred, blocker);
    }
    return {
      descriptor: describeEngine(preferred),
      fallback: false,
      warnings: [],
    };
  }

  if (preferred === "cloud") {
    if (!options.capabilities.cloudConfigured) {
      throw new TranslationEngineUnavailableError(
        "cloud",
        "not-configured",
        "No cloud AI provider is configured. Add an API key in Settings.",
      );
    }
    return { descriptor: describeEngine("cloud"), fallback: false, warnings: [] };
  }

  const warnings: TranslationEngineUnavailableReason[] = [];

  if (options.isPro) {
    const chain = options.localChain ?? ["webllm", "ollama", "nllb"];
    for (const engine of chain) {
      const blocker = localEngineBlocker(
        engine,
        options.capabilities,
        options.sourceLocale,
        options.targetLocale,
      );
      if (!blocker) {
        return { descriptor: describeEngine(engine), fallback: false, warnings };
      }
      warnings.push(blocker);
    }
  }

  if (options.capabilities.cloudConfigured) {
    return {
      descriptor: describeEngine("cloud"),
      // Free users were never promised local inference; only a Pro auto run
      // that exhausted the local chain is a genuine fallback.
      fallback: options.isPro,
      warnings,
    };
  }

  const lastReason: TranslationEngineUnavailableReason =
    warnings.length > 0 ? warnings[warnings.length - 1]! : "not-configured";
  throw new TranslationEngineUnavailableError(
    options.isPro ? "webllm" : "cloud",
    options.isPro ? lastReason : "not-configured",
    options.isPro
      ? "Local AI cannot run on this device and no cloud provider is configured."
      : "No cloud AI provider is configured. Add an API key in Settings.",
  );
}

/** Every engine with its current blocker, for the settings picker. */
export function listAvailableEngines(
  options: SelectTranslationEngineOptions,
): TranslationEngineDescriptor[] {
  const all: TranslationEngineId[] = ["cloud", "webllm", "ollama", "nllb"];

  return all.map((engine) => {
    const descriptor = describeEngine(engine);
    if (engine === "cloud") {
      return options.capabilities.cloudConfigured
        ? descriptor
        : { ...descriptor, unavailableReason: "not-configured" as const };
    }
    // Entitlement is reported before capability: a Free user needs the upgrade
    // nudge, not a lecture about their GPU.
    if (!options.isPro) {
      return { ...descriptor, unavailableReason: "pro-required" as const };
    }
    const blocker = localEngineBlocker(
      engine,
      options.capabilities,
      options.sourceLocale,
      options.targetLocale,
    );
    return blocker ? { ...descriptor, unavailableReason: blocker } : descriptor;
  });
}
