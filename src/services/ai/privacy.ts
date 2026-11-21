import type { AIRequestOptions } from "./types";

/** Any vault-derived source that carries its persisted privacy decision. */
interface AIPrivacySource {
  readonly isPrivate: boolean;
}

/** AI response shape shared by ProviderManager and lightweight test doubles. */
interface ScopedAIResponse {
  text: string;
  provider: string;
  groundingMetadata?: unknown;
}

interface ScopedAITextGenerator {
  generateText: (
    prompt: string,
    systemPrompt?: string,
    options?: AIRequestOptions,
  ) => Promise<ScopedAIResponse>;
}

/**
 * Generate from vault-derived content without allowing a caller to forget or
 * override the source's privacy decision. Non-privacy options remain caller
 * controlled (model, tools, cancellation, etc.); `isPrivate` is authoritative
 * from the source and is always written last. Missing/corrupt privacy
 * metadata fails closed as private rather than silently taking the cloud path.
 */
export function generateWithPrivacy(
  generator: ScopedAITextGenerator,
  source: AIPrivacySource,
  prompt: string,
  systemPrompt?: string,
  options?: Omit<AIRequestOptions, "isPrivate">,
): Promise<ScopedAIResponse> {
  return generator.generateText(prompt, systemPrompt, {
    ...options,
    isPrivate: source.isPrivate !== false,
  });
}
