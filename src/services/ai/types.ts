/**
 * AI Service Types
 * Centralized type definitions for AI providers and services
 */

export type AIProvider =
  | "ollama"
  | "openai"
  | "anthropic"
  | "groq"
  | "gemini"
  | "webllm"
  | "custom"
  | "unknown";

interface GroundingSource {
  uri: string;
  title: string;
}

export interface GroundingMetadata {
  sources: GroundingSource[];
}

export interface AIResponse {
  text: string;
  provider: AIProvider;
  groundingMetadata?: GroundingMetadata;
}

interface _AIStreamChunk {
  text: string;
  done: boolean;
  provider: AIProvider;
}

export interface ProviderInfo {
  provider: AIProvider;
  model: string;
  fullSupport: boolean;
  name: string;
  error?: string;
  availableModels?: string[];
  isConfigured: boolean;
  /** Internal: routing reason recorded by the optimizer for learning purposes */
  _routingReason?: string;
}

interface _NavigatorWithMemory {
  deviceMemory?: number;
  hardwareConcurrency?: number;
  connection?: {
    effectiveType?: string;
  };
  mozConnection?: {
    effectiveType?: string;
  };
  webkitConnection?: {
    effectiveType?: string;
  };
  getBattery?: () => Promise<{
    level: number;
    charging: boolean;
  }>;
}

export interface AIRequestOptions {
  complexity?: "simple" | "complex";
  isPrivate?: boolean;
  model?: string;
  responseMimeType?: string;
  responseSchema?: Record<string, unknown>;
  tools?: Record<string, unknown>[];
  /** Optional caller cancellation propagated to network providers. */
  signal?: AbortSignal;
}
