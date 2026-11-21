/**
 * Ollama Provider
 * Handles interactions with local Ollama instance
 */

import { AIResponse } from "../types";
import {
  fetchWithTimeout,
  fetchWithRetry,
  readSSEStream,
  buildSafeUserContent,
  cancelResponseBody,
  readBoundedResponseJson,
  readBoundedResponseText,
} from "../utils";
import {
  buildProviderApiError,
  isModelUnavailableError,
} from "../providerErrors";
import { AI_CONFIG, AI_MODELS } from "../../../constants/config";
import { logger } from "../../../utils/logger";

export interface OllamaConfig {
  url: string;
  model: string;
}

export class OllamaProvider {
  private config: OllamaConfig;
  private availabilityCache: boolean | null = null;
  private cacheTime: number = 0;
  private availabilityPromise: Promise<boolean> | null = null;
  private availabilityGeneration = 0;
  private readonly CACHE_TTL_MS = 60_000; // 1 minute cache

  constructor(config: OllamaConfig) {
    this.config = config;
  }

  async isAvailable(): Promise<boolean> {
    const now = Date.now();
    if (
      this.availabilityCache !== null &&
      now - this.cacheTime < this.CACHE_TTL_MS
    ) {
      return this.availabilityCache;
    }
    if (this.availabilityPromise) {
      return this.availabilityPromise;
    }

    const generation = this.availabilityGeneration;
    const operation = (async (): Promise<boolean> => {
      let available = false;
      try {
        const baseUrl = this.config.url.replace("/api/generate", "");
        const res = await fetchWithTimeout(
          `${baseUrl}/api/tags`,
          { method: "GET" },
          AI_CONFIG.OLLAMA_CHECK_TIMEOUT_MS,
        );
        available = res.ok;
        await cancelResponseBody(res);
      } catch (_err) {
        available = false;
      }

      if (generation === this.availabilityGeneration) {
        this.availabilityCache = available;
        this.cacheTime = Date.now();
      }
      return available;
    })();

    let tracked: Promise<boolean>;
    // eslint-disable-next-line prefer-const -- declared separately so the finally callback can close over it
    tracked = operation.finally(() => {
      if (this.availabilityPromise === tracked) {
        this.availabilityPromise = null;
      }
    });
    this.availabilityPromise = tracked;
    return tracked;
  }

  /**
   * POST to the Ollama endpoint, transparently retrying once with the
   * default local model when the configured model is not pulled locally
   * (HTTP 404 "model 'x' not found"). Other errors are classified so auth-
   * irrelevant local failures still surface the upstream detail.
   */
  private async postWithModelFallback(
    bodyFor: (model: string) => Record<string, unknown>,
    url: string,
    signal?: AbortSignal,
    timeoutMs?: number,
  ): Promise<{ response: Response; model: string }> {
    const candidates = [
      this.config.model,
      ...(this.config.model !== AI_MODELS.OLLAMA_DEFAULT
        ? [AI_MODELS.OLLAMA_DEFAULT]
        : []),
    ];
    let lastError: Error | null = null;

    for (const model of candidates) {
      const response = await fetchWithRetry(
        url,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(bodyFor(model)),
          signal,
        },
        undefined,
        timeoutMs,
      );

      if (response.ok) {
        if (model !== this.config.model) {
          logger.warn(
            "[OllamaProvider] Configured model missing; served by default model",
            { configured: this.config.model, servedBy: model },
          );
        }
        return { response, model };
      }

      const errText = await readBoundedResponseText(response, 32_000);
      if (isModelUnavailableError(response.status, errText)) {
        lastError = buildProviderApiError("Ollama", response.status, errText, model);
        continue;
      }
      throw buildProviderApiError("Ollama", response.status, errText, model);
    }

    throw (
      lastError ??
      new Error("Ollama API error: no local model available")
    );
  }

  async generateText(
    prompt: string,
    systemPrompt?: string,
    signal?: AbortSignal,
  ): Promise<AIResponse> {
    const { response } = await this.postWithModelFallback(
      (model) => ({
        model,
        prompt: systemPrompt
          ? `${systemPrompt}\n\n${buildSafeUserContent(prompt)}`
          : buildSafeUserContent(prompt),
        stream: false,
      }),
      this.config.url,
      signal,
      AI_CONFIG.OLLAMA_GENERATE_TIMEOUT_MS,
    );

    const data = await readBoundedResponseJson<{ response?: unknown }>(response);
    return {
      text: typeof data.response === "string" ? data.response : "",
      provider: "ollama",
    };
  }

  async streamGenerateText(
    prompt: string,
    systemPrompt?: string,
    onChunk?: (chunk: string) => void,
    signal?: AbortSignal,
    onComplete?: () => void,
  ): Promise<AIResponse> {
    const { response } = await this.postWithModelFallback(
      (model) => ({
        model,
        prompt: systemPrompt
          ? `${systemPrompt}\n\n${buildSafeUserContent(prompt)}`
          : buildSafeUserContent(prompt),
        stream: true,
      }),
      this.config.url,
      signal,
    );

    const fullText = await readSSEStream(
      response,
      onChunk,
      "ndjson",
      onComplete,
    );
    return { text: fullText, provider: "ollama" };
  }

  updateConfig(config: Partial<OllamaConfig>): void {
    this.config = { ...this.config, ...config };
    // Reset availability cache when config changes
    this.availabilityCache = null;
    this.cacheTime = 0;
    this.availabilityGeneration++;
    this.availabilityPromise = null;
  }

  getConfig(): OllamaConfig {
    return { ...this.config };
  }
}
