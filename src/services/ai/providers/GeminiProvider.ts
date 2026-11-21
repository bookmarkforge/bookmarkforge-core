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
  readSSEStream,
} from "../utils";
import { AI_MODELS, GEMINI_API_BASE } from "../../../constants/config";
import { logger } from "../../../utils/logger";

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
  private defaultModel = AI_MODELS.GEMINI_DEFAULT;

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

  /**
   * Build the official Gemini `generateContent` request body. The REST API
   * rejects ad-hoc fields like `prompt`/`systemPrompt`/`model` with HTTP 400
   * ("Unknown name ..."), so the payload must follow the documented schema:
   * `contents`, `systemInstruction`, `generationConfig`, `tools`.
   */
  private buildRequestBody(
    prompt: string,
    systemPrompt?: string,
    options?: AIRequestOptions,
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      contents: [
        {
          role: "user",
          parts: [{ text: buildSafeUserContent(prompt) }],
        },
      ],
      generationConfig: {
        maxOutputTokens: options?.maxOutputTokens ?? 2048,
        temperature: options?.temperature ?? 0.7,
      },
    };

    if (systemPrompt) {
      body.systemInstruction = {
        parts: [{ text: systemPrompt }],
      };
    }

    const generationConfig = body.generationConfig as Record<string, unknown>;
    if (options?.responseMimeType) {
      generationConfig.responseMimeType = options.responseMimeType;
    }
    if (options?.responseSchema) {
      generationConfig.responseSchema = options.responseSchema;
    }
    if (options?.tools) {
      body.tools = options.tools;
    }

    return body;
  }

  /**
   * Ordered fallback models tried (once each) when Google retires the
   * selected model upstream — the API answers HTTP 404 "model is no longer
   * available" and the request would otherwise hard-fail for every user
   * still pinned to the old default.
   */
  private static readonly MODEL_FALLBACKS = [
    AI_MODELS.GEMINI_FALLBACK,
    "gemini-3.8-flash",
  ];

  /**
   * POST to a Gemini generate endpoint, transparently retrying with the
   * fallback model list when the API reports the model as unavailable.
   * Returns the successful Response plus the model that actually served it
   * (callers must not assume the requested model was used).
   */
  private async postWithModelFallback(
    action: "generateContent" | "streamGenerateContent",
    body: Record<string, unknown>,
    options: AIRequestOptions | undefined,
    preferredModel: string,
  ): Promise<{ response: Response; model: string }> {
    const apiBase = getGeminiApiBase();
    const candidates = [
      preferredModel,
      ...GeminiProvider.MODEL_FALLBACKS.filter((m) => m !== preferredModel),
    ];

    let lastError: Error | null = null;
    for (const model of candidates) {
      if (options?.signal?.aborted) {
        throw new DOMException("Request aborted", "AbortError");
      }
      const suffix = action === "streamGenerateContent" ? "?alt=sse" : "";
      const response = await fetchWithTimeout(
        `${apiBase}/${model}:${action}${suffix}`,
        {
          method: "POST",
          headers: getGeminiApiHeaders(this.apiKey),
          body: JSON.stringify(body),
          signal: options?.signal,
        },
      );

      if (response.ok) {
        if (model !== preferredModel) {
          logger.warn(
            "[GeminiProvider] Primary model unavailable; served by fallback",
            { preferredModel, servedBy: model, action },
          );
        }
        return { response, model };
      }

      const errText = await readBoundedResponseText(response, 64_000);
      if (
        response.status === 404 &&
        GeminiProvider.isModelUnavailableError(errText)
      ) {
        lastError = GeminiProvider.buildApiError(response.status, errText, model);
        continue; // try the next fallback model
      }
      throw GeminiProvider.buildApiError(response.status, errText, model);
    }

    throw (
      lastError ??
      new Error("Gemini API error: all fallback models unavailable")
    );
  }

  /**
   * Detect the "model retired upstream" 404 shape:
   * `{"error":{"code":404,"message":"models/X is not found for API version
   * v1beta, or is not supported for generateContent...","status":"NOT_FOUND"}}`
   */
  private static isModelUnavailableError(bodyText: string): boolean {
    return (
      /"status"\s*:\s*"NOT_FOUND"/i.test(bodyText) ||
      /is not found for API version/i.test(bodyText) ||
      /no longer available/i.test(bodyText) ||
      /is not supported for generateContent/i.test(bodyText)
    );
  }

  /**
   * Turn a Gemini error response into an actionable Error. The status code
   * stays in the message prefix so getUserFriendlyErrorMessage() keeps
   * mapping 401/429/404/400 correctly downstream.
   */
  private static buildApiError(
    status: number,
    bodyText: string,
    model: string,
  ): Error {
    let detail = bodyText;
    try {
      const parsed = JSON.parse(bodyText) as {
        error?: { message?: string; status?: string };
      };
      if (parsed.error?.message) {detail = parsed.error.message;}
    } catch {
      // Non-JSON error body — use the raw text (already bounded).
    }

    const safeDetail = sanitizeErrorMessage(detail);
    if (
      status === 401 ||
      status === 403 ||
      /API_KEY_INVALID|API key not valid|API_KEY_SERVICE_BLOCKED/i.test(detail)
    ) {
      return new Error(
        `Gemini API error ${status}: invalid or revoked API key — check Settings > AI (${safeDetail})`,
      );
    }
    if (
      status === 400 &&
      /Unknown name|Invalid JSON payload|unknown field/i.test(detail)
    ) {
      return new Error(
        `Gemini API error ${status}: incompatible request format — the app and the Gemini API are out of sync, please update BookmarkForge (${safeDetail})`,
      );
    }
    return new Error(
      `Gemini API error ${status} (model ${model}): ${safeDetail}`,
    );
  }

  private async callBackend(
    prompt: string,
    systemPrompt?: string,
    options?: AIRequestOptions,
    model?: string,
  ): Promise<AIResponse> {
    const { response } = await this.postWithModelFallback(
      "generateContent",
      this.buildRequestBody(prompt, systemPrompt, options),
      options,
      model ?? this.defaultModel,
    );

    const data: GeminiContentResponse = await readBoundedResponseJson(response);
    if (data.error) {throw new Error(sanitizeErrorMessage(String(data.error)));}
    const text =
      data.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? "")
        .join("") ?? "";

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
    const { response } = await this.postWithModelFallback(
      "streamGenerateContent",
      this.buildRequestBody(prompt, systemPrompt, options),
      options,
      model ?? this.defaultModel,
    );

    const fullText = await readSSEStream(response, onChunk);
    return { text: fullText, provider: "gemini" };
  }
}
