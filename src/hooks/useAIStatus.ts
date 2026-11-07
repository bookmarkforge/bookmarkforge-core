import { useState, useEffect, useCallback } from "react";
import { aiManager } from "../services/ai/ProviderManager";
import type { ProviderInfo } from "../services/ai/ProviderManager";
import { logger } from "../utils/logger";
import { AI_MODELS } from "../constants/config";
import { useVisibilityPolling } from "./useVisibilityPolling";

interface AIStatus {
  provider: string;
  model: string;
  isLocal: boolean;
  fullSupport: boolean;
  isConfigured: boolean;
}

const INITIAL_STATUS: AIStatus = {
  provider: "Gemini",
  model: AI_MODELS.GEMINI_EXP,
  isLocal: false,
  fullSupport: true,
  isConfigured: false,
};

export const useAIStatus = (): AIStatus => {
  const [aiStatus, setAiStatus] = useState<AIStatus>(() => {
    try {
      const info: ProviderInfo = aiManager.getProviderInfo();
      return {
        provider: info.name,
        model: info.model,
        isLocal: info.provider === "ollama" || info.provider === "webllm",
        fullSupport: info.fullSupport,
        isConfigured: info.isConfigured,
      };
    } catch (_err) {
      return INITIAL_STATUS;
    }
  });

  const updateStatus = useCallback(() => {
    try {
      const info: ProviderInfo = aiManager.getProviderInfo();
      const next: AIStatus = {
        provider: info.name,
        model: info.model,
        isLocal: info.provider === "ollama" || info.provider === "webllm",
        fullSupport: info.fullSupport,
        isConfigured: info.isConfigured,
      };
      setAiStatus((prev) =>
        prev.provider === next.provider &&
        prev.model === next.model &&
        prev.isLocal === next.isLocal &&
        prev.fullSupport === next.fullSupport &&
        prev.isConfigured === next.isConfigured
          ? prev
          : next,
      );
    } catch (error) {
      logger.warn("[useAIStatus] Failed to update AI status:", error);
    }
  }, []);

  useEffect(() => {
    // Fire once on mount so the hook's polling tick starts from a known
    // state. The polling cadence itself is then owned by useVisibilityPolling
    // which pauses on hidden tabs and resumes with a fresh refresh.
    void updateStatus();
  }, []);
  useVisibilityPolling(() => void updateStatus(), { intervalMs: 5000 });

  return aiStatus;
};
