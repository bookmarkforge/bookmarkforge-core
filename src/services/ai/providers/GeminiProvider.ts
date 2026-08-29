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
import { AI_MODELS } from "../../../constants/config";
import { fetchWithAiSession } from "../aiSession";

function getGeminiProxyEndpoint(): string {
  // AI sessions are same-origin by design. An external proxy would require
  // forwarding the session cookie and defeats the CSRF/origin contract.
  return "/api/services/ai/generate";
}

const GEMINI_PROXY_ENDPOINT = getGeminiProxyEndpoint();

export function getGeminiProxyUrlForTests(): string {
  return GEMINI_PROXY_ENDPOINT;
}

function getGeminiProxyHeaders(): Record<string, string> {
  return { "Content-Type": "application/json" };
}

export interface GeminiProviderConfig {
  apiKey: string | null;
  model?: string;
}

export class GeminiProvider {
  /**
   * @deprecated Since all Gemini calls now route through the backend
   * (firewalledFetch), this.apiKey is never read by generateText or
   * streamGenerateText. Kept for backward compatibility with
   * VaultIntegration.setApiKey() which still calls setApiKey() as part
   * of the S9 vault hygiene contract (purge on lock, rehydrate on unlock).
   */
  private apiKey: string | null;
  private defaultModel = AI_MODELS.GEMINI_EXP;

  constructor(config: GeminiProviderConfig) {
    this.apiKey = config.apiKey;
  }

  /**
   * Update the in-memory API key copy without rebuilding the instance.
   * Used by the S9 vault hygiene contract: purge with `null` on vault lock,
   * rehydrate with the key on unlock (mirror of OpenAICompatibleProvider).
   *
   * @deprecated The apiKey is no longer used for API calls (all go through
   * backend). Kept for vault lock/unlock hygiene compatibility.
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

    // Security: Always route through our backend (firewalledFetch) instead of
    // calling the Google API directly from the frontend. The SDK's internal
    // fetch bypasses the SSRF firewall and on-prem proxy, so we must not use
    // it in the browser. The backend proxies the request with full firewall
    // protection, and can inject the API key server-side when configured.
    return this.callBackend(prompt, systemPrompt, options, model);
  }

  private async callBackend(
    prompt: string,
    systemPrompt?: string,
    options?: AIRequestOptions,
    model?: string,
  ): Promise<AIResponse> {
    const requestOptions: RequestInit = {
      method: "POST",
      headers: getGeminiProxyHeaders(),
      body: JSON.stringify({
        prompt: buildSafeUserContent(prompt),
        systemPrompt,
        model,
        responseMimeType: options?.responseMimeType,
        responseSchema: options?.responseSchema,
        tools: options?.tools,
      }),
      signal: options?.signal,
    };
    const response = await fetchWithAiSession(
      (sessionOptions) => fetchWithTimeout(GEMINI_PROXY_ENDPOINT, sessionOptions),
      requestOptions,
    );

    if (!response.ok) {
      const errText = await readBoundedResponseText(response, 64_000);
      throw new Error(
        `Backend AI error ${response.status}: ${sanitizeErrorMessage(errText)}`,
      );
    }

    const data = await readBoundedResponseJson<{
      error?: unknown;
      text?: unknown;
      groundingMetadata?: AIResponse["groundingMetadata"];
    }>(response);
    if (data.error) {throw new Error(sanitizeErrorMessage(String(data.error)));}

    return {
      text: typeof data.text === "string" ? data.text : "",
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

    // Security: Always route through our backend (firewalledFetch) instead of
    // calling the Google API directly from the frontend. See generateText().
    return this.callBackendStream(
      prompt,
      systemPrompt,
      options,
      model,
      onChunk,
    );
  }

  private async callBackendStream(
    prompt: string,
    systemPrompt?: string,
    options?: AIRequestOptions,
    model?: string,
    onChunk?: (chunk: string) => void,
  ): Promise<AIResponse> {
    const requestOptions: RequestInit = {
      method: "POST",
      headers: getGeminiProxyHeaders(),
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
    };
    const response = await fetchWithAiSession(
      (sessionOptions) => fetchWithTimeout(GEMINI_PROXY_ENDPOINT, sessionOptions),
      requestOptions,
    );

    if (!response.ok) {
      const errText = await readBoundedResponseText(response, 64_000);
      throw new Error(
        `Backend AI error ${response.status}: ${sanitizeErrorMessage(errText)}`,
      );
    }

    const { readSSEStream } = await import("../utils");
    const fullText = await readSSEStream(response, onChunk);
    return { text: fullText, provider: "gemini" };
  }
}
