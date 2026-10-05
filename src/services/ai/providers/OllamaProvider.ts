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
} from "../utils";
import { AI_CONFIG } from "../../../constants/config";

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

  async generateText(
    prompt: string,
    systemPrompt?: string,
    signal?: AbortSignal,
  ): Promise<AIResponse> {
    const response = await fetchWithRetry(this.config.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.config.model,
        prompt: systemPrompt
          ? `${systemPrompt}\n\n${buildSafeUserContent(prompt)}`
          : buildSafeUserContent(prompt),
        stream: false,
      }),
      signal,
    });

    if (!response.ok) {
      await cancelResponseBody(response);
      throw new Error(`Ollama error ${response.status}`);
    }

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
    const response = await fetchWithRetry(this.config.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.config.model,
        prompt: systemPrompt
          ? `${systemPrompt}\n\n${buildSafeUserContent(prompt)}`
          : buildSafeUserContent(prompt),
        stream: true,
      }),
      signal,
    });

    if (!response.ok) {
      await cancelResponseBody(response);
      throw new Error(`Ollama error ${response.status}`);
    }

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
