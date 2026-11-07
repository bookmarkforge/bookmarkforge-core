/**
 * Puter AI Provider
 * Handles interactions with the native Puter.com AI runtime.
 * Requires no user API key: authentication is provided by the Puter.com
 * browser environment itself. Isolated from the Core to avoid vendor lock-in.
 */

import { AIResponse, AIRequestOptions, ChatMessage } from "../types";
import { logger } from "../../../utils/logger";

export interface PuterProviderConfig {
  model?: string;
}

export class PuterProvider {
  static readonly requiresKey = false;

  private readonly model: string;

  constructor(config: PuterProviderConfig = {}) {
    this.model = config.model || "gpt-4o-mini";
  }

  isAvailable(): boolean {
    return typeof window !== "undefined" && !!window.puter;
  }

  async generateText(
    prompt: string,
    systemPrompt?: string,
    options?: AIRequestOptions,
  ): Promise<AIResponse> {
    if (!this.isAvailable()) {
      throw new Error(
        "Puter AI is only available when the app runs inside Puter.com",
      );
    }

    const messages: ChatMessage[] = [];
    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }
    messages.push({ role: "user", content: prompt });

    const model = options?.model || this.model;

    try {
      const result = await window.puter!.ai.chat(messages, { model });

      return {
        text: typeof result.text === "string" ? result.text : "",
        provider: "puter",
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error("Puter AI error:", { error: msg });
      throw new Error(msg);
    }
  }

  async streamGenerateText(
    prompt: string,
    systemPrompt?: string,
    onChunk?: (chunk: string) => void,
    _signal?: AbortSignal,
    onComplete?: () => void,
  ): Promise<AIResponse> {
    // Puter's native chat is non-streaming; deliver the full text as a single
    // chunk, mirroring the WebLLM local route contract.
    const result = await this.generateText(prompt, systemPrompt);
    onChunk?.(result.text);
    onComplete?.();
    return { ...result, provider: "puter" };
  }

  getModel(): string {
    return this.model;
  }
}
