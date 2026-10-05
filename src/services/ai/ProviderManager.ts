/**
 * ProviderManager - Refactored with separated concerns
 * Uses dedicated classes for caching, vault integration, and provider configuration
 */
import {
  AIProvider,
  AIResponse,
  AIRequestOptions,
  ProviderInfo,
} from "./types";
import {
  detectProvider,
  sanitizeErrorMessage,
  getUserFriendlyErrorMessage,
} from "./utils";
import { resourceManager } from "./ResourceManager";
import { loadWebLLMService, ProUnavailableError } from "../pro-access";
import { rateLimitService } from "../RateLimitService";
import { getNavigatorExtensions } from "../../utils/browser-types";
import { logger } from "../../utils/logger";
import { formatDate } from "../../utils/localization";
import i18n from "../../i18n";
import { AIRequestCache } from "./AIRequestCache";
import { VaultIntegration } from "./VaultIntegration";
import type { AIProviderId } from "./adapters/RoutingOptimizer";
import { ProviderConfiguration } from "./ProviderConfiguration";
import { firewalledFetch } from "../../utils/networkFirewall";
import { AI_MODELS } from "../../constants/config";
import { safeGet } from "../../store/safeStorage";
import { STORAGE_KEYS } from "../../constants/storage-keys";
import { securityVault } from "../SecurityVault";

/**
 * Central AI orchestrator that manages provider selection, authentication,
 * request routing, caching, and fallback logic. Delegates to specialized
 * classes: AIRequestCache (caching), VaultIntegration (secrets),
 * ProviderConfiguration (provider settings).
 *
 * Automatically selects the best provider based on connectivity, battery,
 * privacy settings, and task complexity. Falls back to Gemini on errors.
 *
 * @example
 * ```ts
 * const manager = new ProviderManager();
 * const response = await manager.generateText('Summarize this article');
 * ```
 */
export class ProviderManager {
  // Separated concerns
  private cache: AIRequestCache;
  private vault: VaultIntegration;
  private config: ProviderConfiguration;

  // Ollama availability cache
  private ollamaAvailableCache: boolean | null = null;
  private ollamaCheckTime: number = 0;
  private ollamaAvailabilityPromise: Promise<boolean> | null = null;
  private ollamaAvailabilityGeneration = 0;
  private readonly OLLAMA_CACHE_TTL_MS = 60_000; // 1 minute cache
  // The exact Q-state consumed by the most recent selectProvider() call,
  // captured by resolveProvider so recordRoutingOutcome() writes under the
  // SAME key the optimizer explored (never a re-read of network/battery).
  private lastRoutingState:
    | {
        complexity: "simple" | "complex";
        connectivity: "online" | "offline" | "slow";
        batteryRange: "high" | "low";
      }
    | undefined = undefined;

  /** Creates the ProviderManager with cache, vault, and configuration delegates. */
  constructor() {
    this.cache = new AIRequestCache();
    // Single shared VaultIntegration: ProviderConfiguration receives this
    // same instance (it must not own a second one, see S9 lock/unlock).
    this.vault = new VaultIntegration();
    this.config = new ProviderConfiguration(this.vault);
    // AI responses may contain vault-derived text even when the caller did
    // not mark the request private. Do not retain them across vault changes.
    // The Q-table learns provider behavior from THIS vault's traffic — it
    // must not carry routing preferences across a vault switch (same
    // cross-vault contamination class as AIRequestCache/RAGEngine caches).
    const clearRoutingTable = (): void => {
      void import("./adapters/RoutingOptimizer")
        .then(({ routingOptimizer }) => routingOptimizer.clear())
        .catch((error: unknown) => {
          logger.warn("[ProviderManager] Failed to clear routing table", {
            error: error instanceof Error ? error.message : String(error),
          });
        });
    };
    // AI responses may contain vault-derived text even when the caller did
    // not mark the request private. Do not retain them across vault changes.
    securityVault.onLock(() => {
      this.cache.clear();
      clearRoutingTable();
    });
    securityVault.onUnlock(() => {
      this.cache.clear();
      clearRoutingTable();
      // Opportunistic WebLLM preload on every successful unlock (fire-and-
      // forget): by the time the user interacts with AI, the model is warm.
      // Safety is inherited from warmup() itself — canRunLocalLLM() skips
      // devices that cannot run local AI, test mode (forge_test_mode) skips
      // E2E runs before their stubs are installed, and the detached promise
      // can never reject (init failures are logged inside warmup). The
      // unlock flow itself is never slowed: nothing here is awaited.
      void this.warmup().catch((err: unknown) => {
        logger.warn(
          "[ProviderManager] Unlock warmup failed (non-fatal)",
          {
            error: err instanceof Error ? err.message : String(err),
          },
        );
      });
    });
  }

  // Vault & Security - delegated to VaultIntegration
  /** Returns whether the security vault is currently locked. */
  async isVaultLocked(): Promise<boolean> {
    return this.vault.isVaultLocked();
  }

  /**
   * Unlocks the vault with the user's master password.
   * On success, syncs the API key into provider configuration.
   * @param password - The user's master password
   * @returns `true` if unlock succeeded
   */
  async unlockVault(password: string): Promise<boolean> {
    const success = await this.vault.unlockVault(password);
    if (success) {
      // Reconcile persisted provider config from SecureStorage (authoritative
      // store) on EVERY unlock — not just opportunistically via warmup().
      // Idempotent: init() guards on `ready`. A config read failure must not
      // fail the unlock, so swallow and log.
      try {
        await this.config.init();
      } catch (err) {
        logger.warn("[ProviderManager] config.init failed after unlock", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      if (this.vault.getApiKey()) {
        await this.config.setApiKey(this.vault.getApiKey()!);
      }
    }
    return success;
  }

  /**
   * Re-encrypts all stored secrets under a new master password.
   * @param newPassword - The new master password
   */
  async updateMasterPassword(newPassword: string): Promise<void> {
    await this.vault.updateMasterPassword(newPassword);
  }

  // Provider Management - delegated to ProviderConfiguration
  /** Returns info about the currently selected provider and its configuration. */
  getProviderInfo(): ProviderInfo {
    return this.config.getProviderInfo();
  }

  /**
   * Switches the active AI provider. Unloads WebLLM if switching away from it.
   * @param provider - The provider identifier to activate
   */
  async setProvider(provider: AIProvider): Promise<void> {
    const oldProvider = this.config.getSelectedProvider();
    const apiKey = this.vault.getApiKey();
    await this.config.setProvider(provider, apiKey);

    // Unload WebLLM if switching away. Gated: without Pro there is no local
    // engine to unload, so the rejection is the expected, quiet path.
    if (oldProvider === "webllm" && provider !== "webllm") {
      await loadWebLLMService()
        .then((s) => s.unload())
        .catch(() => undefined);
    }
  }

  /**
   * Stores the API key in both vault (encrypted) and provider config.
   * @param key - The API key for the selected provider
   */
  async setApiKey(key: string): Promise<void> {
    await this.vault.setApiKey(key);
    await this.config.setApiKey(key);
  }

  /** Returns the stored API key, or `null` if the vault is locked. */
  getApiKey(): string | null {
    return this.vault.getApiKey();
  }

  // Local AI Configuration - delegated to ProviderConfiguration
  async setOllamaSettings(url: string, model: string): Promise<void> {
    await this.config.setOllamaSettings(url, model);
    this.ollamaAvailabilityGeneration++;
    this.ollamaAvailableCache = null;
    this.ollamaCheckTime = 0;
    this.ollamaAvailabilityPromise = null;
  }

  getOllamaSettings() {
    return this.config.getOllamaSettings();
  }

  async setWebLlmModel(model: string): Promise<void> {
    await this.config.setWebLlmModel(model);
  }

  getWebLlmModel(): string {
    return this.config.getWebLlmModel();
  }

  // Cache Management - delegated to AIRequestCache
  /** Clears all cached AI request results. */
  clearCache(): void {
    this.cache.clear();
  }

  getCacheStats() {
    return this.cache.getStats();
  }

  /**
   * Generates text using the optimal AI provider for the current conditions.
   *
   * Implements multi-layer cost optimization:
   * 1. Provider-level prompt caching: structures prompts for provider KV-state caching
   *    (Anthropic/OpenAI: ~90% discount on cached system prompt prefix)
   * 2. Model routing: routes simple tasks to cheap local models (Ollama/WebLLM)
   *    vs complex tasks to premium cloud models
   * 3. Token budget enforcement: prevents runaway costs before API calls
   * 4. Semantic caching: finds semantically similar requests to reuse responses
   * 5. Batch processing: queues non-realtime workloads for 50% batch API discount
   *
   * Checks rate limits, resolves the best provider (local vs cloud based on
   * connectivity, battery, privacy, complexity), queries semantic and strict
   * caches, and falls back to Gemini on provider errors.
   *
   * @param prompt - The user prompt (max 100k chars)
   * @param systemPrompt - Optional system instruction (max 50k chars)
   * @param options - Request options including privacy flag and complexity hint
   * @returns The generated AI response with text and provider info
   * @throws {Error} If prompt exceeds length limits or rate limit is exceeded
   *
   * @example
   * ```ts
   * const res = await aiManager.generateText('Explain TypeScript generics');
   * console.log(res.text);
   * ```
   */
  // ── Shared request validation (consolidation of generateText /
  // streamGenerateText guards) ────────────────────────────────────────────
  //
  // AUDIT FINDINGS this consolidation eliminated — the two entry points had
  // drifted copy-pasted versions of the same checks:
  //   1. Input validation (prompt ≤ 100k, system prompt ≤ 50k, pre-flight
  //      abort) was DUPLICATED verbatim in both methods — a future threshold
  //      or message change could silently diverge (e.g. fix the limit in one
  //      and not the other).
  //   2. The POST-RESOLVE abort re-check existed ONLY on generateText: a
  //      signal aborted while resolveProvider awaited (battery probe,
  //      availability pings) slipped through streaming and was only caught
  //      after rate limiting + budget.
  //   3. The fail-closed isPrivate default was structured differently:
  //      generateText ALWAYS resolves; streaming resolved only when private
  //      OR the descriptor was unconfigured — so a configured selected cloud
  //      provider could skip resolveProvider on the stream path (while the
  //      non-stream path always resolved it away). The streaming local-only
  //      refusal message also carried a " for streaming." suffix that the
  //      non-stream path never had. Both paths now share ONE _mustResolve
  //      computation (options?.isPrivate !== false) with the "OR
  //      unconfigured" kept as the streaming-specific extra condition.
  // Callers: generateText and streamGenerateText, at the same position
  // (first statement) so no other check can run before them.

  /**
   * Validates request inputs — the SINGLE source of truth for prompt
   * length, system-prompt length, and the pre-flight abort check, shared
   * by generateText and streamGenerateText.
   */
  private assertValidAIRequest(
    prompt: string,
    systemPrompt?: string,
    options?: AIRequestOptions,
  ): void {
    if (prompt.length > 100000) {
      throw new Error("Prompt too long (max 100k characters)");
    }
    if (systemPrompt && systemPrompt.length > 50000) {
      throw new Error("System prompt too long (max 50k characters)");
    }
    this.assertSignalNotAborted(options);
  }

  /**
   * Throws the shared AbortError when the caller's signal has fired.
   * Used pre-flight (inside assertValidAIRequest) and post-resolve by BOTH
   * generation paths — abort awareness can no longer diverge between them.
   */
  private assertSignalNotAborted(options?: AIRequestOptions): void {
    if (options?.signal?.aborted) {
      throw new DOMException("AI request aborted", "AbortError");
    }
  }

  // Main Generation Method
  async generateText(
    prompt: string,
    systemPrompt?: string,
    options?: AIRequestOptions,
  ): Promise<AIResponse> {
    // Shared guard: input validation + the fail-closed isPrivate default.
    // Both generation entry points MUST run the identical checks — see the
    // guard's doc block for the divergence this consolidation eliminated.
    this.assertValidAIRequest(prompt, systemPrompt, options);

    // Fail-closed privacy default: ANY request whose options omit
    // isPrivate (or pass true) must resolve through resolveProvider so
    // private data can only route to local AI — never to a cloud provider
    // by accident.
    const _mustResolve = options?.isPrivate !== false;

    // Normalize isPrivate once with fail-closed semantics to ensure
    // consistency across all layers (cache, semantic cache, provider).
    // This prevents a contradiction where ProviderManager treats
    // undefined as private but cache layers treat it as public.
    // P1 audit fix: eliminate the undefined semantic gap.
    const isPrivate = options?.isPrivate !== false;

    // Resolve the provider before checking rate limits. The configured
    // provider can be an unconfigured cloud default while a local provider is
    // reachable; charging or blocking the former would make local fallback
    // depend on an unrelated cloud quota.
    const optimalProvider = await this.resolveProvider(options);
    this.assertSignalNotAborted(options);
    let { provider, model } = optimalProvider;

    // Rate limiting applies to the provider that will actually receive the
    // request. Local providers are deliberately not rate-limited here.
    if (provider !== "ollama" && provider !== "webllm") {
      const status = rateLimitService.checkLimit(provider);
      if (status.exhausted) {
        throw new Error(
          `Rate limit exceeded for ${provider}. Resets at ${formatDate(status.resetAt, { hour: "numeric", minute: "numeric", second: "numeric" }, i18n.language)}`,
        );
      }
    }

    // SECURITY (S9): never call cloud providers while the Security Vault is
    // locked — the vault-protected API key is only usable while unlocked.
    // Local AI (Ollama/WebLLM) remains available.
    if (
      provider !== "ollama" &&
      provider !== "webllm" &&
      (await this.isVaultLocked())
    ) {
      throw new Error(
        "Cloud AI is unavailable while the Security Vault is locked. Unlock the vault to use cloud providers, or use local AI (Ollama/WebLLM).",
      );
    }

    // Check strict cache (audit #4: provider + isPrivate form part of the key
    // so responses never leak across providers or privacy contexts).
    const cached = this.cache.get(prompt, systemPrompt, {
      model,
      provider,
      isPrivate,
    });
    if (cached) {
      return cached;
    }

    // CRITICAL (audit #2): enforce the daily cost budget BEFORE spending
    // money. Local AI is free and never budget-limited. A cache hit above
    // already returned, so this only blocks real paid requests.
    if (provider !== "ollama" && provider !== "webllm") {
      const { costTrackerService } = await import("./CostTrackerService");
      await costTrackerService.assertUnderBudget(provider);
    }

    try {
      const startTime = performance.now();

      // Check semantic cache for identical intents (only if not forcing a specific model/tool)
      if (!options?.tools) {
        const { semanticCache } = await import("./SemanticCacheService");
        const semanticMatch = await semanticCache.findSimilar(
          prompt,
          systemPrompt,
        );
        if (semanticMatch) {
          // S0/R8 fix (post-review): if the cached match was served by a
          // cloud provider but the current request is marked isPrivate, we
          // MUST discard the cache hit. We do NOT mutate the cache here —
          // `SemanticCacheService` has no invalidate() method. Just skip
          // the hit and continue to the switch (which will route to local).
          if (
            isPrivate &&
            semanticMatch.provider !== "webllm" &&
            semanticMatch.provider !== "ollama"
          ) {
            logger.warn(
              "[ProviderManager] Discarding semantic cache hit for private prompt (cloud provider result). Continuing to local AI.",
            );
            // Intentionally do NOT return semanticMatch.
          } else {
            return semanticMatch; // Token saving!
          }
        }
      }

      let result: AIResponse;

      switch (provider) {
        case "gemini":
          result = await this.config
            .getGeminiProvider()
            .generateText(prompt, systemPrompt, { ...options, model });
          break;

        case "webllm":
          result = await this.generateWithWebLLM(
            prompt,
            systemPrompt,
            model,
            options,
          );
          break;

        case "ollama":
          result = await this.config
            .getOllamaProvider()
            .generateText(prompt, systemPrompt, options?.signal);
          break;

        case "openai":
        case "anthropic":
        case "groq":
        case "custom": {
          const openAIProvider = this.config.getOpenAIProvider();
          if (openAIProvider) {
            result = await openAIProvider.generateText(
              prompt,
              systemPrompt,
              options?.signal,
            );
          } else {
            throw new Error(
              `${provider} provider not initialized with API key`,
            );
          }
          break;
        }

        default:
          // Fallback to Gemini backend
          result = await this.config
            .getGeminiProvider()
            .generateText(prompt, systemPrompt, {
              model: "gemini-3-flash-preview",
              signal: options?.signal,
            });
          // Bookkeeping below (cache metadata, rate limit, observability,
          // cost) must reflect the provider that actually served the
          // request, or unknown-provider cost accounting fails hard.
          provider = "gemini";
          model = "gemini-3-flash-preview";
      }

      // Cache and record. NEVER persist private prompts/responses to any
      // cache (in-memory or Voy index in IndexedDB) — that would leak
      // vault data the user marked private.
      if (!isPrivate) {
        this.cache.set(prompt, result, systemPrompt, {
          model,
          provider,
          isPrivate,
        });

        if (!options?.tools) {
          const { semanticCache } = await import("./SemanticCacheService");
          // P1 audit fix: pass provider context to semantic cache for consistency
          // with strict cache. The semantic cache now enforces privacy at the
          // boundary (rejects isPrivate !== false) and stores provider metadata.
          semanticCache.add(prompt, result, systemPrompt, {
            isPrivate: false,
            provider,
          }).catch((err) =>
            logger.warn("[ProviderManager] Semantic cache add failed", {
              error: err,
            }),
          );
        }
      }

      if (provider !== "ollama" && provider !== "webllm") {
        await rateLimitService.recordRequest(
          provider,
          prompt.length + (systemPrompt?.length || 0),
        );
      }

      const durationMs = performance.now() - startTime;
      const estimatedTokensIn = Math.ceil(
        (prompt.length + (systemPrompt?.length || 0)) / 4,
      );
      const estimatedTokensOut = Math.ceil((result.text?.length || 0) / 4);
      const { observabilityHub } =
        await import("../../observability/ObservabilityHub");
      observabilityHub.recordAICall(
        provider,
        model,
        durationMs,
        estimatedTokensIn,
        estimatedTokensOut,
      );

      const { costTrackerService } = await import("./CostTrackerService");
      await costTrackerService.recordRequest(
        provider,
        model,
        "generateText",
        estimatedTokensIn,
        estimatedTokensOut,
        durationMs,
      );

      // Feed the routing optimizer (success-only: failures are recorded only
      // when a provider was actually attempted — the catch block below also
      // fires for pre-flight rejections like rate-limit/budget, which must
      // never punish a provider that was never called).
      this.recordRoutingOutcome(
        options?.complexity === "complex" ? "summarize" : "chat",
        provider,
        durationMs,
        estimatedTokensIn,
        estimatedTokensOut,
        options,
      );

      return result;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw error;
      }
      const msg = error instanceof Error ? error.message : String(error);
      const sanitizedMsg = sanitizeErrorMessage(msg);
      logger.error(`AI Error [${provider}/${model}]:`, { error: sanitizedMsg });

      // S5/R1 — NEVER fallback to cloud AI automatically.
      // If isPrivate is set OR if the user hasn't explicitly opted in,
      // we fail hard so the user knows data did NOT leak to a third party.
      // Cloud AI fallback must be an explicit opt-in per request.
      throw new Error(getUserFriendlyErrorMessage(msg, provider, model));
    }
  }

  /**
   * Generates text via streaming from the optimal provider.
   * Calls onChunk progressively as tokens arrive from the API.
   * Skips cache (streaming is real-time) and does not cache the result.
   *
   * @param onProvider - Optional callback invoked with the resolved provider
   *   right before streaming starts (after routing, vault and rate-limit
   *   guards pass). Lets UIs show which engine is generating while tokens
   *   are still arriving — the value matches `AIResponse.provider`.
   */
  async streamGenerateText(
    prompt: string,
    systemPrompt?: string,
    options?: AIRequestOptions,
    onChunk?: (chunk: string) => void,
    onProvider?: (provider: AIProvider) => void,
    onComplete?: () => void,
  ): Promise<AIResponse> {
    // Shared guard: identical validation to generateText (consolidated).
    this.assertValidAIRequest(prompt, systemPrompt, options);

    const providerInfo = this.config.getProviderInfo();

    // Fail-closed privacy default (now IDENTICAL to generateText):
    // ANY request whose options omit isPrivate (or pass true) resolves
    // through resolveProvider so private data can only route to local AI.
    // The previous structure (resolve when private OR unconfigured) allowed
    // a configured-selected cloud provider to skip resolveProvider entirely
    // — divergence #3 of the consolidation audit.
    const _mustResolve = options?.isPrivate !== false;

    // Normalize isPrivate once with fail-closed semantics to ensure
    // consistency across all layers. P1 audit fix: eliminate the
    // undefined semantic gap between ProviderManager and cache layers.
    const isPrivate = options?.isPrivate !== false;

    let provider = providerInfo.provider;
    let model = providerInfo.model;
    if (_mustResolve || !providerInfo.isConfigured) {
      const optimal = await this.resolveProvider(options);
      provider = optimal.provider;
      model = optimal.model;
      if (provider !== "ollama" && provider !== "webllm") {
        throw new Error(
          "This document is marked as Private, but no Local AI is available for streaming.",
        );
      }
    }
    // DIVERGENCE FIXED (consolidation audit): the post-resolve abort
    // re-check existed only on generateText. resolveProvider can await
    // (battery probe, provider availability), so a signal aborted during
    // resolution previously slipped through on the streaming path and was
    // only re-checked after rate limiting + cost budget. Now both paths
    // re-check at the same point via the shared helper.
    this.assertSignalNotAborted(options);

    // SECURITY (S9): never stream from cloud providers while the Security
    // Vault is locked — the vault-protected API key is only usable while
    // unlocked. Local AI (Ollama/WebLLM) remains available.
    if (
      provider !== "ollama" &&
      provider !== "webllm" &&
      (await this.isVaultLocked())
    ) {
      throw new Error(
        "Cloud AI is unavailable while the Security Vault is locked. Unlock the vault to use cloud providers, or use local AI (Ollama/WebLLM).",
      );
    }

    if (provider !== "ollama" && provider !== "webllm") {
      const status = rateLimitService.checkLimit(provider);
      if (status.exhausted) {
        throw new Error(
          `Rate limit exceeded for ${provider}. Resets at ${formatDate(status.resetAt, { hour: "numeric", minute: "numeric", second: "numeric" }, i18n.language)}`,
        );
      }

      // CRITICAL (audit #2): enforce the daily cost budget on the streaming
      // path too (the primary chat path) BEFORE tokens start flowing.
      const { costTrackerService } = await import("./CostTrackerService");
      await costTrackerService.assertUnderBudget(provider);
    }

    if (options?.signal?.aborted) {
      throw new DOMException("AI request aborted", "AbortError");
    }
    // WebLLM capability pre-assert: the shared guard must fire BEFORE the
    // provider announcement, not only inside generateWithWebLLM below.
    // Without this, a forced webllm selection on a device without a capable
    // GPU would emit onProvider("webllm") and only afterwards fail closed —
    // the UI would briefly claim a provider whose request cannot run
    // (exactly what the contract on the next line forbids). Same cached
    // probes, so this is ~free on capable devices.
    if (provider === "webllm") {
      // The webllm provider IS Pro: without the license this throws
      // ProUnavailableError, which the routing error path already reports.
      const webLLMService = await loadWebLLMService();
      await webLLMService.assertCanRunLocalLLM();
    }
    // Report the resolved provider only once every guard has passed, so the
    // UI never claims a provider whose request then fails validation.
    onProvider?.(provider);

    try {
      const startTime = performance.now();
      let result: AIResponse;

      switch (provider) {
        case "gemini":
          result = await this.config
            .getGeminiProvider()
            .streamGenerateText(
              prompt,
              systemPrompt,
              { ...options, model },
              onChunk,
            );
          break;

        case "webllm":
          // WebLLM has no incremental token stream, so deliver the full text
          // as a single chunk. Crucially, handle it EXPLICITLY — falling
          // through to the Gemini default below would route local-only
          // (possibly private) data to a cloud provider (S5/R1).
          result = await this.generateWithWebLLM(
            prompt,
            systemPrompt,
            model,
            options,
          );
          onChunk?.(result.text);
          break;

        case "ollama":
          result = await this.config
            .getOllamaProvider()
            .streamGenerateText(
              prompt,
              systemPrompt,
              onChunk,
              options?.signal,
              onComplete,
            );
          break;

        case "openai":
        case "anthropic":
        case "groq":
        case "custom": {
          const openAIProvider = this.config.getOpenAIProvider();
          if (openAIProvider) {
            result = await openAIProvider.streamGenerateText(
              prompt,
              systemPrompt,
              onChunk,
              options?.signal,
            );
          } else {
            throw new Error(
              `${provider} provider not initialized with API key`,
            );
          }
          break;
        }

        default:
          result = await this.config
            .getGeminiProvider()
            .streamGenerateText(
              prompt,
              systemPrompt,
              {
                model: "gemini-3-flash-preview",
                signal: options?.signal,
              },
              onChunk,
            );
          // Same bookkeeping fix as generateText: the fallback served via
          // Gemini, so cost/rate-limit must not record the unknown provider.
          provider = "gemini";
          model = "gemini-3-flash-preview";
      }

      if (provider !== "ollama" && provider !== "webllm") {
        await rateLimitService.recordRequest(
          provider,
          prompt.length + (systemPrompt?.length || 0),
        );
        // Cost tracking on the stream path: without it, streaming requests
        // would bypass the daily budget entirely (audit #2).
        const durationMs = performance.now() - startTime;
        const { costTrackerService } = await import("./CostTrackerService");
        await costTrackerService.recordRequest(
          provider,
          model,
          "streamGenerateText",
          Math.ceil((prompt.length + (systemPrompt?.length || 0)) / 4),
          Math.ceil((result.text?.length || 0) / 4),
          durationMs,
        );
      }

      // Success-only routing feedback for both local and cloud providers;
      // the local/cloud branches above both exit here with `provider` set.
      this.recordRoutingOutcome(
        options?.complexity === "complex" ? "summarize" : "chat",
        provider,
        performance.now() - startTime,
        Math.ceil((prompt.length + (systemPrompt?.length || 0)) / 4),
        Math.ceil((result.text?.length || 0) / 4),
        options,
      );

      return result;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw error;
      }
      const msg = error instanceof Error ? error.message : String(error);
      const sanitizedMsg = sanitizeErrorMessage(msg);
      logger.error(`AI Stream Error [${provider}/${model}]:`, {
        error: sanitizedMsg,
      });

      // S5/R1 — NEVER fallback to cloud AI automatically on stream errors.
      throw new Error(getUserFriendlyErrorMessage(msg, provider, model));
    }
  }

  private async generateWithWebLLM(
    prompt: string,
    systemPrompt?: string,
    _model?: string,
    _options?: AIRequestOptions,
  ): Promise<AIResponse> {
    const webLLMService = await loadWebLLMService();

    // Fail closed BEFORE arming the 45s timeout or touching the engine: when
    // the device cannot run WebLLM (no WebGPU, or an adapter without
    // shader-f16), surface the capability error instead of the misleading
    // "engine not initialized" state error — the user explicitly selected
    // this provider, so they need to hear WHY it cannot run. Delegates to the
    // shared WebLLMService.assertCanRunLocalLLM() so init(), generateText()
    // and this path can never drift apart in messages.
    await webLLMService.assertCanRunLocalLLM();

    const controller = new AbortController();
    const callerSignal = _options?.signal;
    const onCallerAbort = () => controller.abort();
    if (callerSignal) {
      if (callerSignal.aborted) {
        controller.abort();
      } else {
        callerSignal.addEventListener("abort", onCallerAbort, { once: true });
      }
    }
    const timeoutId = setTimeout(
      () => controller.abort(),
      45000, // 45s: local LLMs can be slow on first inference
    );

    try {
      const text = await webLLMService.generateText(
        prompt,
        systemPrompt,
        _options,
        controller.signal,
      );
      return { text, provider: "webllm" };
    } catch (e: unknown) {
      if (callerSignal?.aborted) {
        throw e;
      }
      const errMsg = e instanceof Error ? e.message : String(e);
      const isTimeout = errMsg === "AbortError" || (e instanceof DOMException && (e as DOMException).name === "AbortError");

      // S5/R1 — NEVER fallback to cloud AI automatically.
      // WebLLM errors (GPU context loss, timeout) always fail hard.
      // The user must explicitly opt in to cloud AI per request.
      if (typeof window !== "undefined") {
        try {
          const { toast } = await import("sonner");
          toast.error("Local AI Failed", {
            description:
              errMsg === "WEBGPU_CONTEXT_LOST"
                ? "GPU connection lost. Local AI model was unloaded."
                : isTimeout
                  ? "Local AI timed out."
                  : "Local AI encountered an error.",
            duration: 7000,
          });
        } catch {
          /* INTENTIONAL SILENCE: optional toast UI is unavailable; the error is rethrown below. */
        }
      }
      throw new Error(
        `Local AI failed: ${isTimeout ? "Timed out after 45s" : errMsg}. Enable a cloud provider manually if you want AI features.`,
      );
    } finally {
      clearTimeout(timeoutId);
      callerSignal?.removeEventListener("abort", onCallerAbort);
    }
  }

  /**
   * Resolves the provider for a request under CURRENT device conditions.
   *
   * The name is deliberate — this resolves a provider, it does not promise
   * an optimal one: the result depends on privacy flags, connectivity,
   * battery, the user's explicit selection, and two independent device
   * gates. The WebLLM local route requires BOTH the capability verdict
   * (webLLMService.canRunLocalLLM(): WebGPU surface + shader-f16 + >= 4 GB
   * RAM) AND the 8 GB comfort tier (resourceManager.isHighEndDevice()) —
   * see the DUAL GATE comments on the local-route branches. An explicit
   * user selection is authoritative over all availability heuristics (and
   * is deliberately NOT capability-filtered: a forced selection on a
   * blocked device fails closed later, at the generation entry points,
   * with the precise capability error). The routing-outcome feedback
   * (recordRoutingOutcome) is written under the state this method captures
   * in lastRoutingState.
   */
  private async resolveProvider(
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
    const hasOllama = await this.config.getOllamaProvider().isAvailable();

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
    this.lastRoutingState = {
      complexity,
      connectivity: isOffline
        ? "offline"
        : isSlowConnection
          ? "slow"
          : "online",
      batteryRange: isLowBattery ? "low" : "high",
    };

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
          model: this.config.getWebLlmModel(),
          fullSupport: false,
          name: "WebLLM (Browser)",
          isConfigured: true,
        };
      }
      if (hasOllama) {
        return {
          provider: "ollama",
          model: this.config.getOllamaSettings().model,
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
    const defaultInfo = this.config.getProviderInfo();
    const externalApiKey = this.vault.getApiKey();
    const selectedProvider = this.config.getSelectedProvider();

    // An explicit provider selection is authoritative. Resolve it before
    // adaptive routing so availability heuristics cannot silently replace the
    // provider the user configured.
    if (!isPrivate && selectedProvider && selectedProvider !== "gemini") {
      if (selectedProvider === "ollama" || selectedProvider === "webllm") {
        return {
          ...defaultInfo,
          provider: selectedProvider,
          model: this.getModelForProvider(selectedProvider),
        };
      }
      if (externalApiKey || defaultInfo.isConfigured) {
        return {
          ...defaultInfo,
          provider: selectedProvider,
          model: defaultInfo.model || this.getModelForProvider(selectedProvider),
        };
      }
    }

    if (!isPrivate && !defaultInfo.isConfigured && !externalApiKey) {
      // Same dual gate as the offline/private branch: capability
      // (hasWebLLM = canRunLocalLLM()) AND the 8 GB tier.
      if (hasWebLLM && resourceManager.isHighEndDevice()) {
        return {
          provider: "webllm",
          model: this.config.getWebLlmModel(),
          fullSupport: false,
          name: "WebLLM (Browser)",
          isConfigured: true,
        };
      }
      if (hasOllama) {
        return {
          provider: "ollama",
          model: this.config.getOllamaSettings().model,
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
          model: this.config.getWebLlmModel(),
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
          model: this.config.getOllamaSettings().model,
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
    const routingState = this.lastRoutingState ?? {
      complexity: options?.complexity ?? "simple",
      connectivity: "online",
      batteryRange: "high",
    };

    // CRITICAL (audit #1): the optimizer may only consider providers that are
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
            model: this.getModelForProvider(learnedProvider),
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

  /**
   * Pre-loads the WebLLM local model in the background for faster first inference.
   * Silently skips if WebGPU is unavailable or no model is selected.
   * Skips entirely in test environments (detected via localStorage flag).
   * Safe to call repeatedly: init() is idempotent while the requested model
   * stays loaded, so multiple warmups never reload the engine.
   */
  // Lifecycle
  async warmup(): Promise<void> {
    // Reconcile persisted provider config from SecureStorage (the
    // authoritative store) before anything reads it. Idempotent — init()
    // guards on `ready`, so warmup may safely run more than once. A config
    // read failure must NEVER abort the rest of warmup (e.g. WebLLM model
    // preload), so swallow and log instead of letting it propagate.
    try {
      await this.config.init();
    } catch (err) {
      logger.warn("[ProviderManager] config.init failed during warmup", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Skip warmup in test environments
    const isTestMode = safeGet(STORAGE_KEYS.TEST_MODE) === "true";
    const selectedProvider = this.config.getSelectedProvider();
    const externalApiKey = this.vault.getApiKey();

    // Always log for debugging
    logger.info("[ProviderManager] warmup check", {
      selectedProvider,
      hasExternalApiKey: !!externalApiKey,
      isTestMode,
    });

    if (isTestMode) {
      logger.info("[ProviderManager] WebLLM warmup skipped: test mode");
      return;
    }

    if (selectedProvider === "webllm" || !externalApiKey) {
      // Gated: warmup only touches the engine when the session has a Pro
      // license; otherwise it is a no-op (there is nothing to warm).
      const webLLMService = await loadWebLLMService().catch(() => null);
      if (!webLLMService) {
        logger.info(
          "[ProviderManager] WebLLM warmup skipped: Pro unavailable",
        );
        return;
      }
      // Device capability guard (webLLMService.canRunLocalLLM() below): only
      // preload the model when the device can actually run WebLLM
      // (WebGPU + shader-f16 + >=4GB RAM). A GPU-less or
      // low-RAM device would otherwise attempt init() and fast-fail on EVERY
      // unlock — a wasted call that still acquires GPU resources and bumps
      // error metrics before throwing. A capability-probe failure (e.g. the
      // adapter request throws) is treated the same as "cannot run": skip
      // the init, log the reason, never abort warmup.
      const canRunLocalLLM = await webLLMService
        .canRunLocalLLM()
        .catch((e: unknown) => {
          logger.warn(
            "[ProviderManager] WebLLM capability check failed during warmup",
            { error: e instanceof Error ? e.message : String(e) },
          );
          return false;
        });
      if (!canRunLocalLLM) {
        // Name the WHY, not just the verdict: a generic "cannot run" hides
        // whether the remedy is a different browser (no WebGPU surface),
        // different hardware (adapter without shader-f16) or more RAM
        // (below the 4 GB floor). getHealthStatus() reads the same cached
        // probes, so this is ~free and cannot disagree with the
        // canRunLocalLLM() verdict above. The legacy message stays as the
        // prefix so existing log parsers and tests keep matching; the
        // precise cause is appended after the dash.
        const health = await webLLMService.getHealthStatus().catch(
          () => null,
        );
        const cause = !health
          ? ""
          : !health.webGPUSupported
            ? " — WebGPU is not available in this browser"
            : !health.f16Supported
              ? " — WebGPU adapter lacks shader-f16 (half-precision)"
              : health.deviceMemoryGB < 4
                ? ` — insufficient device memory (${health.deviceMemoryGB} GB < 4 GB floor)`
                : " — cause unidentified";
        logger.info(
          "[ProviderManager] WebLLM warmup skipped: device cannot run local LLM" +
            cause,
        );
        return;
      }
      // Use hardware-aware model selection during warmup
      const recommendedModel = this.getRecommendedWebLLMModel();
      const modelToInit = this.config.getWebLlmModel() || recommendedModel;
      webLLMService.init(modelToInit).catch((e: unknown) => {
        logger.warn(
          "[ProviderManager] WebLLM warmup skipped: " +
            (e instanceof Error ? e.message : String(e)),
        );
      });
    }
  }

  /**
   * Recommends a WebLLM model based on the device's hardware capabilities.
   * Public so it can be used by settings UI to suggest appropriate models.
   */
  getRecommendedWebLLMModel(): string {
    const nav = getNavigatorExtensions() as { deviceMemory?: number; hardwareConcurrency?: number };
    const ram = nav.deviceMemory || 4;
    const cores = nav.hardwareConcurrency || 4;

    if (ram < 4 || cores < 4) {
      return "TinyLlama-1.1B-Chat-v1.0-q4f16_1-MLC";
    } else if (ram < 8) {
      return "Llama-3.2-1B-Instruct-q4f16_1-MLC";
    } else if (ram < 12) {
      return "Llama-3.2-3B-Instruct-q4f16_1-MLC";
    } else {
      // High-RAM devices (≥12GB) get the best quality model
      return "Phi-3.5-mini-instruct-q4f16_1-MLC";
    }
  }

  /**
   * Resets the manager state: clears API key, cache, and Ollama availability.
   */
  reset(): void {
    this.vault.clearApiKey();
    this.cache.clear();
    this.ollamaAvailableCache = null;
    this.ollamaCheckTime = 0;
    this.ollamaAvailabilityGeneration++;
    this.ollamaAvailabilityPromise = null;
  }

  // Backward compatibility methods
  /**
   * Fetches available model names from the current provider.
   * @returns Array of model identifiers, or empty array if unsupported
   */
  async fetchAvailableModels(): Promise<string[]> {
    const providerInfo = this.config.getProviderInfo();
    const { provider } = providerInfo;
    const key = this.vault.getApiKey();
    if (!key || provider === "unknown" || provider === "gemini") {return [];}

    try {
      if (provider === "anthropic") {
        return [
          AI_MODELS.ANTHROPIC_DEFAULT,
          AI_MODELS.ANTHROPIC_HAIKU,
          AI_MODELS.ANTHROPIC_OPUS,
        ];
      }

      const openAIProvider = this.config.getOpenAIProvider();
      if (openAIProvider) {
        return await openAIProvider.fetchAvailableModels();
      }

      return [];
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error("[ProviderManager] Failed to fetch models", {
        error: errorMsg,
        provider,
        hasKey: !!key,
      });
      return [];
    }
  }

  /**
   * Checks if a local Ollama instance is reachable. Result is cached for 60 seconds.
   * @returns `true` if Ollama is responding on the configured URL
   */
  async isOllamaAvailable(): Promise<boolean> {
    const now = Date.now();
    if (
      this.ollamaAvailableCache !== null &&
      now - this.ollamaCheckTime < this.OLLAMA_CACHE_TTL_MS
    ) {
      return this.ollamaAvailableCache;
    }
    if (this.ollamaAvailabilityPromise) {
      return this.ollamaAvailabilityPromise;
    }

    const generation = this.ollamaAvailabilityGeneration;
    const operation = (async (): Promise<boolean> => {
      let available = false;
      try {
        const config = this.config.getOllamaSettings();
        const baseUrl = config.url.replace("/api/generate", "");
        const res = await firewalledFetch(
          `${baseUrl}/api/tags`,
          { method: "GET" },
          "ollama-check",
        );
        available = res.ok;
        // This probe does not consume a response body. Cancel it explicitly
        // so failed/large mock or browser responses do not retain a stream.
        try {
          await res.body?.cancel();
        } catch {
          // Availability is determined by the status, not by body cleanup.
        }
      } catch (_err) {
        available = false;
      }

      if (generation === this.ollamaAvailabilityGeneration) {
        this.ollamaAvailableCache = available;
        this.ollamaCheckTime = Date.now();
      }
      return available;
    })();

    let tracked: Promise<boolean>;
    // eslint-disable-next-line prefer-const -- declared separately so the finally callback can close over it
    tracked = operation.finally(() => {
      if (this.ollamaAvailabilityPromise === tracked) {
        this.ollamaAvailabilityPromise = null;
      }
    });
    this.ollamaAvailabilityPromise = tracked;
    return tracked;
  }

  /** Backward compatibility methods */

  // Custom base URL management
  getCustomBaseUrl(): string | undefined {
    return this.config.getCustomBaseUrl();
  }

  async setCustomBaseUrl(baseUrl: string): Promise<void> {
    await this.config.setCustomBaseUrl(baseUrl);
    if (this.config.getSelectedProvider() === "custom") {
      await this.setProvider("custom");
    }
  }

  // Model management
  async setModel(model: string): Promise<void> {
    const selectedProvider = this.config.getSelectedProvider();
    if (selectedProvider === "ollama") {
      await this.config.setOllamaSettings(
        this.config.getOllamaSettings().url,
        model,
      );
    } else if (selectedProvider === "webllm") {
      await this.config.setWebLlmModel(model);
    } else if (
      selectedProvider === "openai" ||
      selectedProvider === "anthropic" ||
      selectedProvider === "groq" ||
      selectedProvider === "custom"
    ) {
      await this.config.setModel(model);
    }
  }

  /**
   * Feed a completed request back into the routing optimizer (fire-and-
   * forget, never fails the request). Without this, the epsilon-greedy
   * exploration in selectProvider() would route ~10% of requests to random
   * usable providers and NEVER learn to correct those choices — a silent,
   * uncorrected cost/behavior leak.
   */
  private recordRoutingOutcome(
    taskType: "chat" | "summarize",
    provider: AIProvider,
    durationMs: number,
    estimatedTokensIn: number,
    estimatedTokensOut: number,
    options?: AIRequestOptions,
  ): void {
    void import("./adapters/RoutingOptimizer")
      .then(async ({ routingOptimizer }) =>
        routingOptimizer.recordOutcome(
          taskType as Parameters<typeof routingOptimizer.recordOutcome>[0],
          provider as Parameters<typeof routingOptimizer.recordOutcome>[1],
          durationMs,
          true,
          (estimatedTokensIn + estimatedTokensOut) / 1_000_000,
          // The EXACT state the optimizer explored for this request — never
          // a fresh network/battery read, which could write under a different
          // key than the one that was explored (corrupting the Q-table).
          (this.lastRoutingState ?? {
            complexity: options?.complexity ?? "simple",
            connectivity: "online",
            batteryRange: "high",
          }),
        ),
      )
      .catch((error: unknown) => {
        logger.warn("[ProviderManager] Routing outcome record failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }

  private getModelForProvider(provider: string): string {
    switch (provider) {
      case "gemini":
        return AI_MODELS.GEMINI_DEFAULT;
      case "ollama":
        return this.config.getOllamaSettings().model;
      case "webllm":
        return this.config.getWebLlmModel();
      case "openai":
        return AI_MODELS.OPENAI_DEFAULT ?? "gpt-4o-mini";
      case "anthropic":
        return AI_MODELS.ANTHROPIC_DEFAULT ?? "claude-3-haiku-20240307";
      case "groq":
        return AI_MODELS.GROQ_DEFAULT ?? "mixtral-8x7b-32768";
      default:
        return AI_MODELS.GEMINI_DEFAULT;
    }
  }
}

// Singleton instance
export const aiManager = new ProviderManager();

// Re-export for backward compatibility
export {
  detectProvider,
  sanitizeErrorMessage,
  getUserFriendlyErrorMessage,
} from "./utils";
export type {
  AIProvider,
  AIResponse,
  AIRequestOptions,
  ProviderInfo,
} from "./types";
