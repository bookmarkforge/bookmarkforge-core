/**
 * OpenAI Compatible Provider
 * Handles OpenAI, Anthropic, Groq, and OpenRouter (all use OpenAI-compatible API)
 */

import { AIProvider, AIResponse } from "../types";
import {
  fetchWithRetry,
  fetchWithTimeout,
  readSSEStream,
  buildSafeUserContent,
  cancelResponseBody,
  readBoundedResponseJson,
} from "../utils";
import { logger } from "../../../utils/logger";
import { firewalledFetch } from "../../../utils/networkFirewall";

export interface OpenAICompatibleConfig {
  apiKey: string;
  provider: AIProvider;
  model: string;
  baseUrl?: string;
}

interface _Message {
  role: "system" | "user" | "assistant";
  content: string;
}

export class OpenAICompatibleProvider {
  private apiKey: string;
  private provider: AIProvider;
  private model: string;
  private baseUrl?: string;

  constructor(config: OpenAICompatibleConfig) {
    this.apiKey = config.apiKey;
    this.provider = config.provider;
    this.model = config.model;
    this.baseUrl = config.baseUrl;
  }

  /**
   * Replace the API key in place (used to rehydrate the copy after the vault
   * unlocks without rebuilding the provider or re-fetching models).
   */
  setApiKey(key: string): void {
    this.apiKey = key;
  }

  /**
   * Discard the API key from memory (used when the vault locks so the key
   * copy cannot outlive the lock). Calls after this fail closed.
   */
  clearApiKey(): void {
    this.apiKey = "";
  }

  /**
   * SECURITY (S9): never send a request with a cleared key — the vault is
   * locked and the copy was purged. Failing closed avoids leaking an empty
   * `Bearer ` header to a provider endpoint.
   */
  private assertApiKeyAvailable(): void {
    if (!this.apiKey) {
      throw new Error("API key unavailable (vault is locked)");
    }
  }

  async generateText(
    prompt: string,
    systemPrompt?: string,
    signal?: AbortSignal,
  ): Promise<AIResponse> {
    this.assertApiKeyAvailable();
    if (this.provider === "anthropic") {
      return this.callAnthropic(prompt, systemPrompt, signal);
    }
    return this.callOpenAICompatible(prompt, systemPrompt, signal);
  }

  private async callAnthropic(
    prompt: string,
    systemPrompt?: string,
    signal?: AbortSignal,
  ): Promise<AIResponse> {
    const response = await fetchWithRetry(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "client-2024-04-04",
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 2048,
          ...(systemPrompt ? { system: systemPrompt } : {}),
          messages: [{ role: "user", content: buildSafeUserContent(prompt) }],
        }),
        signal,
      },
    );

    if (!response.ok) {
      await cancelResponseBody(response);
      throw new Error(`Anthropic API error ${response.status}`);
    }

    const data = await readBoundedResponseJson<{
      content?: Array<{ text?: unknown }>;
    }>(response);
    const text = data.content?.[0]?.text;
    if (typeof text !== "string") {
      throw new Error("Anthropic response did not contain text");
    }
    return { text, provider: "anthropic" };
  }

  private async callOpenAICompatible(
    prompt: string,
    systemPrompt?: string,
    signal?: AbortSignal,
  ): Promise<AIResponse> {
    const endpoint = this.getEndpoint();

    const response = await fetchWithRetry(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
          { role: "user", content: buildSafeUserContent(prompt) },
        ],
        max_tokens: 2048,
        temperature: 0.7,
      }),
      signal,
    });

    if (!response.ok) {
      await cancelResponseBody(response);
      throw new Error(`${this.provider} API error ${response.status}`);
    }

    const data = await readBoundedResponseJson<{
      choices?: Array<{ message?: { content?: unknown } }>;
    }>(response);
    const text = data.choices?.[0]?.message?.content;
    return {
      text: typeof text === "string" ? text : "",
      provider: this.provider,
    };
  }

  async streamGenerateText(
    prompt: string,
    systemPrompt?: string,
    onChunk?: (chunk: string) => void,
    signal?: AbortSignal,
  ): Promise<AIResponse> {
    this.assertApiKeyAvailable();
    if (this.provider === "anthropic") {
      return this.streamAnthropic(prompt, systemPrompt, onChunk, signal);
    }
    return this.streamOpenAICompatible(prompt, systemPrompt, onChunk, signal);
  }

  private async streamAnthropic(
    prompt: string,
    systemPrompt?: string,
    onChunk?: (chunk: string) => void,
    signal?: AbortSignal,
  ): Promise<AIResponse> {
    const response = await fetchWithRetry(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "client-2024-04-04",
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 2048,
          stream: true,
          ...(systemPrompt ? { system: systemPrompt } : {}),
          messages: [{ role: "user", content: buildSafeUserContent(prompt) }],
        }),
        signal,
      },
    );

    if (!response.ok) {
      await cancelResponseBody(response);
      throw new Error(`Anthropic API error ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      await cancelResponseBody(response);
      throw new Error("Response body is not readable");
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let fullText = "";

    try {
      while (true) {
      const { done, value } = await reader.read();
      if (done) {break;}

      buffer += decoder.decode(value, { stream: true });
      if (buffer.length > 1_000_000) {
        throw new Error("Anthropic stream line buffer exceeds the configured limit");
      }
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6).trim();
          if (data === "[DONE]") {continue;}
          let parsed: {
            delta?: { text?: unknown };
            content_block?: { text?: unknown };
          } | null = null;
          try {
            parsed = JSON.parse(data) as {
              delta?: { text?: unknown };
              content_block?: { text?: unknown };
            };
          } catch (_err) {
            // Skip unparseable SSE lines
            continue;
          }
          if (!parsed) {continue;}
          const deltaText = parsed.delta?.text;
          const blockText = parsed.content_block?.text;
          const content =
            typeof deltaText === "string"
              ? deltaText
              : typeof blockText === "string"
                ? blockText
                : "";
          if (content) {
            if (fullText.length + content.length > 1_000_000) {
              throw new Error("Anthropic stream output exceeds the configured limit");
            }
            fullText += content;
            onChunk?.(content);
          }
        }
      }
    }

      return { text: fullText, provider: "anthropic" };
    } catch (error) {
      try {
        await reader.cancel();
      } catch {
        // Preserve the original stream/parser error.
      }
      throw error;
    } finally {
      reader.releaseLock();
    }
  }

  private async streamOpenAICompatible(
    prompt: string,
    systemPrompt?: string,
    onChunk?: (chunk: string) => void,
    signal?: AbortSignal,
  ): Promise<AIResponse> {
    const endpoint = this.getEndpoint();

    const response = await firewalledFetch(
      endpoint,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            ...(systemPrompt
              ? [{ role: "system", content: systemPrompt }]
              : []),
            { role: "user", content: buildSafeUserContent(prompt) },
          ],
          max_tokens: 2048,
          temperature: 0.7,
          stream: true,
        }),
        signal,
      },
      "ai-provider",
    );

    if (!response.ok) {
      await cancelResponseBody(response);
      throw new Error(`${this.provider} API error ${response.status}`);
    }

    const fullText = await readSSEStream(response, onChunk);
    return { text: fullText, provider: this.provider };
  }

  async fetchAvailableModels(): Promise<string[]> {
    // No key → nothing to list; never attach an empty Authorization header.
    if (!this.apiKey) {return [];}
    if (this.provider === "anthropic") {
      // Anthropic doesn't have a public models list endpoint that's easy to use from browser
      return [
        "claude-3-5-sonnet-latest",
        "claude-3-5-haiku-latest",
        "claude-3-opus-latest",
        "claude-3-sonnet-20240229",
        "claude-3-haiku-20240307",
      ];
    }

    try {
      let endpoint = "";
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      if (this.provider === "groq") {
        endpoint = "https://api.groq.com/openai/v1/models";
        headers["Authorization"] = `Bearer ${this.apiKey}`;
      } else if (this.provider === "openai" || this.provider === "custom") {
        const isOpenRouter = this.apiKey.startsWith("sk-or-");
        endpoint =
          this.provider === "custom" && this.baseUrl
            ? `${this.baseUrl}/models`
            : isOpenRouter
              ? "https://openrouter.ai/api/v1/models"
              : "https://api.openai.com/v1/models";
        headers["Authorization"] = `Bearer ${this.apiKey}`;
      }

      if (!endpoint) {return [];}

      const res = await fetchWithTimeout(endpoint, { headers }, 5000);
      if (res.ok) {
        const data = await readBoundedResponseJson<{
          data?: Array<{ id?: unknown }>;
        }>(res);
        const models = (data.data || [])
          .map((model) => model.id)
          .filter((id): id is string => typeof id === "string");
        return models.sort();
      }
      await cancelResponseBody(res);
    } catch (e) {
      logger.error("Error fetching models", { error: e });
    }
    return [];
  }

  private getEndpoint(): string {
    if (this.provider === "groq") {
      return "https://api.groq.com/openai/v1/chat/completions";
    }
    if (this.provider === "openai" || this.provider === "custom") {
      const isOpenRouter = this.apiKey.startsWith("sk-or-");
      return this.provider === "custom" && this.baseUrl
        ? `${this.baseUrl}/chat/completions`
        : isOpenRouter
          ? "https://openrouter.ai/api/v1/chat/completions"
          : "https://api.openai.com/v1/chat/completions";
    }
    // Fallback
    return "https://api.openai.com/v1/chat/completions";
  }

  updateModel(model: string): void {
    this.model = model;
  }
}
