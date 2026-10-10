/**
 * Gemini Provider
 * Handles interactions with Google's Gemini API
 */

import { AIResponse, AIRequestOptions } from "../types";
import {
  fetchWithTimeout,
  sanitizeErrorMessage,
  buildSafeUserContent,
  readBoundedResponseText,
  readBoundedResponseJson,
} from "../utils";
import { AI_MODELS, GEMINI_API_BASE } from "../../../constants/config";

function getGeminiApiBase(): string {
  return GEMINI_API_BASE ?? "https://generativelanguage.googleapis.com/v1beta/models";
}

function getGeminiApiHeaders(apiKey: string | null): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-goog-api-key": apiKey ?? "",
  };
}

interface GeminiContentResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  groundingMetadata?: AIResponse["groundingMetadata"];
  error?: unknown;
}

export interface GeminiProviderConfig {
  apiKey: string | null;
  model?: string;
}

export class GeminiProvider {
  private apiKey: string | null;
  private defaultModel = AI_MODELS.GEMINI_EXP;

  constructor(config: GeminiProviderConfig) {
    this.apiKey = config.apiKey;
  }

  /**
   * Update the in-memory API key copy without rebuilding the instance.
   * Used by the S9 vault hygiene contract: purge with `null` on vault lock,
   * rehydrate with the key on unlock (mirror of OpenAICompatibleProvider).
   */
  setApiKey(key: string | null): void {
    this.apiKey = key;
  }

  async generateText(
    prompt: string,
    systemPrompt?: string,
    options?: AIRequestOptions,
  ): Promise<AIResponse> {
    const model = options?.model || this.defaultModel;
    return this.callBackend(prompt, systemPrompt, options, model);
  }

  private async callBackend(
    prompt: string,
    systemPrompt?: string,
    options?: AIRequestOptions,
    model?: string,
  ): Promise<AIResponse> {
    const apiBase = getGeminiApiBase();
    const response = await fetchWithTimeout(
      `${apiBase}/${model}:generateContent`,
      {
        method: "POST",
        headers: getGeminiApiHeaders(this.apiKey),
        body: JSON.stringify({
          prompt: buildSafeUserContent(prompt),
          systemPrompt,
          model,
          responseMimeType: options?.responseMimeType,
          responseSchema: options?.responseSchema,
          tools: options?.tools,
        }),
        signal: options?.signal,
      },
    );

    if (!response.ok) {
      const errText = await readBoundedResponseText(response, 64_000);
      throw new Error(
        `Gemini API error ${response.status}: ${sanitizeErrorMessage(errText)}`,
      );
    }

    const data: GeminiContentResponse = await readBoundedResponseJson(response);
    if (data.error) {throw new Error(sanitizeErrorMessage(String(data.error)));}
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

    return {
      text,
      provider: "gemini",
      groundingMetadata: data.groundingMetadata,
    };
  }

  async streamGenerateText(
    prompt: string,
    systemPrompt?: string,
    options?: AIRequestOptions,
    onChunk?: (chunk: string) => void,
  ): Promise<AIResponse> {
    const model = options?.model || this.defaultModel;
    return this.callBackendStream(prompt, systemPrompt, options, model, onChunk);
  }

  private async callBackendStream(
    prompt: string,
    systemPrompt?: string,
    options?: AIRequestOptions,
    model?: string,
    onChunk?: (chunk: string) => void,
  ): Promise<AIResponse> {
    const apiBase = getGeminiApiBase();
    const response = await fetchWithTimeout(
      `${apiBase}/${model}:streamGenerateContent?alt=sse`,
      {
        method: "POST",
        headers: getGeminiApiHeaders(this.apiKey),
        body: JSON.stringify({
          prompt: buildSafeUserContent(prompt),
          systemPrompt,
          model,
          stream: true,
          responseMimeType: options?.responseMimeType,
          responseSchema: options?.responseSchema,
          tools: options?.tools,
        }),
        signal: options?.signal,
      },
    );

    if (!response.ok) {
      const errText = await readBoundedResponseText(response, 64_000);
      throw new Error(
        `Gemini API error ${response.status}: ${sanitizeErrorMessage(errText)}`,
      );
    }

    const { readSSEStream } = await import("../utils");
    const fullText = await readSSEStream(response, onChunk);
    return { text: fullText, provider: "gemini" };
  }
}