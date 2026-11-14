/**
 * Provider resolution for ProviderManager: picks the AI provider for a
 * request based on connectivity, battery, privacy flags, explicit user
 * selection, and the learned routing optimizer. Extracted verbatim from
 * ProviderManager.resolveProvider — the class injects its config/vault
 * delegates through ProviderRoutingContext so this module stays free of
 * `this` state.
 */
import {
  AIRequestOptions,
  ProviderInfo,
} from "./types";
import { detectProvider } from "./utils";
import { resourceManager } from "./ResourceManager";
import { loadWebLLMService, ProUnavailableError } from "../pro-access";
import { getNavigatorExtensions } from "../../utils/browser-types";
import { logger } from "../../utils/logger";
import type { AIProviderId } from "./adapters/RoutingOptimizer";
import type { ProviderConfiguration } from "./ProviderConfiguration";
import { AI_MODELS } from "../../constants/config";

export interface RoutingState {
  complexity: "simple" | "complex";
  connectivity: "online" | "offline" | "slow";
  batteryRange: "high" | "low";
}

export interface ProviderRoutingContext {
  config: ProviderConfiguration;
  getApiKey: () => string | null;
  getModelForProvider: (provider: string) => string;
  setRoutingState: (state: RoutingState) => void;
}

export async function resolveProviderRouting(
  ctx: ProviderRoutingContext,
  options?: AIRequestOptions,
): Promise<ProviderInfo> {
  // WebLLM is a Pro-gated module (pro-access). For ROUTING that is exactly
  // what hasWebLLM=false means: a Free or Open-Core user cannot route to
  // the local LLM, but their cloud and Ollama routes must not depend on it.
  // Best-effort probe: loadProService rejects with ProUnavailableError
  // before any Pro bytes are fetched, and we degrade to hasWebLLM=false
  // instead of failing the whole request resolution (surfaced by the E2E
  // custom-provider suite: anonymous routing 500'd on the entitlement).
  let webLLMService: Awaited<ReturnType<typeof loadWebLLMService>> | null = null;
  try {
    webLLMService = await loadWebLLMService();
  } catch (error) {
    if (!(error instanceof ProUnavailableError)) {
      throw error;
    }
  }

  const isOffline = !navigator.onLine;
  // hasWebLLM = the device-capability verdict ONLY (WebGPU surface +
  // shader-f16 + >= 4 GB RAM). It says nothing about the 8 GB comfort
  // tier, engine/model state, or request success — every local-route
  // branch below pairs it with resourceManager.isHighEndDevice() as a
  // second, independent gate (see the DUAL GATE comment there).
  const hasWebLLM = webLLMService ? await webLLMService.canRunLocalLLM() : false;
  const hasOllama = await ctx.config.getOllamaProvider().isAvailable();

  const navigatorAny = getNavigatorExtensions();
  const connection = navigatorAny.connection;
  const isSlowConnection =
    connection?.effectiveType === "3g" || connection?.effectiveType === "2g";

  let isLowBattery = false;
  if (
    (
      getNavigatorExtensions()
    ).getBattery
  ) {
    try {
      const navBattery = getNavigatorExtensions() as { getBattery: () => Promise<{ level: number; charging: boolean }> };
      const battery = await navBattery.getBattery();
      isLowBattery = battery.level < 0.2 && !battery.charging;
    } catch (e: unknown) {
      logger.warn("Failed to get battery status", { error: e });
    }
  }

  // Missing privacy metadata fails closed: callers must explicitly opt into
  // the cloud-capable path with `isPrivate: false`.
  const isPrivate = options?.isPrivate !== false;
  const complexity = options?.complexity || "simple";

  // Capture the exact Q-state BEFORE any early return, so recordRoutingOutcome
  // (called later with the selected provider) writes under the same key that
  // this selection would have explored. Without this, offline/local early
  // returns would leave lastRoutingState from a PREVIOUS request — feedback
  // written to the wrong state row.
  const capturedRoutingState: RoutingState = {
    complexity,
    connectivity: isOffline
      ? "offline"
      : isSlowConnection
        ? "slow"
        : "online",
    batteryRange: isLowBattery ? "low" : "high",
  };
  ctx.setRoutingState(capturedRoutingState);

  // Offline or private data: use local
  if (isOffline || isPrivate) {
    // DUAL GATE (intentional, mirrored at every local-route branch below):
    // hasWebLLM = canRunLocalLLM() — the CAPABILITY verdict (WebGPU surface
    // + shader-f16 + the >= 4 GB memory floor) — is necessary but NOT
    // sufficient. The 8 GB RAM/CPU TIER check (isHighEndDevice) is a
    // second, independent requirement: WebLLM routing needs a device that
    // can run the model COMFORTABLY, not merely at the floor. Do not
    // remove either conjunct: dropping the tier check would route private
    // data to a 4-7 GB device that only barely clears the capability
    // floor; dropping the capability check would route to devices that
    // cannot run WebLLM at all.
    if (hasWebLLM && resourceManager.isHighEndDevice()) {
      return {
        provider: "webllm",
        model: ctx.config.getWebLlmModel(),
        fullSupport: false,
        name: "WebLLM (Browser)",
        isConfigured: true,
      };
    }
    if (hasOllama) {
      return {
        provider: "ollama",
        model: ctx.config.getOllamaSettings().model,
        fullSupport: false,
        name: "Ollama (Local)",
        isConfigured: true,
      };
    }
    if (isPrivate) {
      throw new Error(
        "This document is marked as Private, but no Local AI is available.",
      );
    }
  }

  // Never route to an unconfigured cloud provider. In particular, the
  // default Gemini descriptor is intentionally present for UI purposes even
  // when no key/session is configured. Prefer a reachable local provider so
  // an installed Ollama instance is usable without an accidental 404 or
  // unauthenticated backend request.
  const defaultInfo = ctx.config.getProviderInfo();
  const externalApiKey = ctx.getApiKey();
  const selectedProvider = ctx.config.getSelectedProvider();

  // An explicit provider selection is authoritative. Resolve it before
  // adaptive routing so availability heuristics cannot silently replace the
  // provider the user configured.
  if (!isPrivate && selectedProvider && selectedProvider !== "gemini") {
    if (selectedProvider === "ollama" || selectedProvider === "webllm") {
      return {
        ...defaultInfo,
        provider: selectedProvider,
        model: ctx.getModelForProvider(selectedProvider),
      };
    }
    if (externalApiKey || defaultInfo.isConfigured) {
      return {
        ...defaultInfo,
        provider: selectedProvider,
        model: defaultInfo.model || ctx.getModelForProvider(selectedProvider),
      };
    }
  }

  if (!isPrivate && !defaultInfo.isConfigured && !externalApiKey) {
    // Same dual gate as the offline/private branch: capability
    // (hasWebLLM = canRunLocalLLM()) AND the 8 GB tier.
    if (hasWebLLM && resourceManager.isHighEndDevice()) {
      return {
        provider: "webllm",
        model: ctx.config.getWebLlmModel(),
        fullSupport: false,
        name: "WebLLM (Browser)",
        isConfigured: true,
      };
    }
    if (hasOllama) {
      return {
        provider: "ollama",
        model: ctx.config.getOllamaSettings().model,
        fullSupport: false,
        name: "Ollama (Local)",
        isConfigured: true,
      };
    }
    throw new Error(
      "No AI provider is configured. Configure a cloud provider or start a local AI provider.",
    );
  }

  // Low battery or slow network: prefer cloud only when the user has not
  // explicitly selected a provider. An explicit provider choice is a user
  // contract and must not be silently replaced by a local fallback.
  if (!isPrivate && !selectedProvider && (isLowBattery || isSlowConnection)) {
    return {
      provider: "gemini",
      model: AI_MODELS.GEMINI_DEFAULT,
      fullSupport: true,
      name: "Google Gemini",
      isConfigured: false,
    };
  }

  // Simple tasks: prefer local only when no provider was explicitly chosen.
// Routes simple queries to local AI (Ollama/WebLLM) which is ~10x cheaper
// than cloud providers for equivalent quality on narrow tasks.
  if (!selectedProvider && complexity === "simple") {
    // Same dual gate as the offline/private branch: capability
    // (hasWebLLM = canRunLocalLLM()) AND the 8 GB tier.
    if (hasWebLLM && resourceManager.isHighEndDevice()) {
      return {
        provider: "webllm",
        model: ctx.config.getWebLlmModel(),
        fullSupport: false,
        name: "WebLLM (Browser)",
        isConfigured: true,
        // Mark as routed-from-cloud for optimizer learning
        _routingReason: "simple-task-local-route",
      };
    }
    if (hasOllama) {
      return {
        provider: "ollama",
        model: ctx.config.getOllamaSettings().model,
        fullSupport: false,
        name: "Ollama (Local)",
        isConfigured: true,
        _routingReason: "simple-task-local-route",
      };
    }
  }

  // Use selected or external key provider. Local providers (Ollama, WebLLM)
  // are a deliberate user choice and must not be overridden just because an
  // API key happens to be stored.
  const isLocalProvider =
    selectedProvider === "ollama" || selectedProvider === "webllm";
  if (
    selectedProvider &&
    !isLocalProvider &&
    selectedProvider !== "gemini" &&
    externalApiKey
  ) {
    // Defense in depth: never route private data to a cloud provider even
    // if the early return above was refactored away.
    if (isPrivate) {
      throw new Error(
        "This document is marked as Private, but no Local AI is available.",
      );
    }
    return detectProvider(externalApiKey);
  }

  // Apply learned routing from optimizer (non-blocking)
  const taskType = options?.complexity === "complex" ? "summarize" : "chat";
  // Reuse the state captured before the early returns — identical to what
  // selectProvider receives.
  const routingState = capturedRoutingState;

  // CRITICAL: the optimizer may only consider providers that are
  // actually usable right now — the locked providers, the provider detected
  // from the configured API key, and any reachable local AI. Without this
  // restriction, epsilon-greedy exploration would route requests to
  // providers with no API key configured.
  const availableProviders: AIProviderId[] = [];
  if (defaultInfo.provider !== "unknown") {
    availableProviders.push(defaultInfo.provider as AIProviderId);
  }
  if (externalApiKey) {
    const detected = detectProvider(externalApiKey);
    const detectedRaw = detected?.provider;
    if (
      detectedRaw &&
      detectedRaw !== "unknown" &&
      !availableProviders.includes(detectedRaw as AIProviderId)
    ) {
      availableProviders.push(detectedRaw as AIProviderId);
    }
  }
  if (hasWebLLM && !availableProviders.includes("webllm")) {
    availableProviders.push("webllm");
  }
  if (hasOllama && !availableProviders.includes("ollama")) {
    availableProviders.push("ollama");
  }

  try {
    const { routingOptimizer } = await import("./adapters/RoutingOptimizer");
    const learnedProvider = await routingOptimizer.selectProvider(
      taskType,
      routingState,
      defaultInfo.provider as unknown as Parameters<typeof routingOptimizer.selectProvider>[2],
      availableProviders,
    );
    if (
      learnedProvider !== (defaultInfo.provider as string) &&
      learnedProvider !== ("unknown" as string)
    ) {
      if (
        isPrivate &&
        learnedProvider !== "webllm" &&
        learnedProvider !== "ollama"
      ) {
        logger.warn(
          "[ProviderManager] RoutingOptimizer suggested a cloud provider for private data; ignoring to honor isPrivate",
          { suggested: learnedProvider },
        );
      } else {
        return {
          ...defaultInfo,
          provider: learnedProvider,
          model: ctx.getModelForProvider(learnedProvider),
        };
      }
    }
  } catch (err) {
    logger.warn(
      "[ProviderManager] Routing optimizer unavailable, using default provider",
      { error: err },
    );
  }

  return defaultInfo;
}
