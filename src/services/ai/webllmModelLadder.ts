/**
 * src/services/ai/webllmModelLadder.ts
 *
 * Single hardware-aware WebLLM model recommendation shared by
 * WebLLMService (init default) and ProviderManager (warmup / settings
 * suggestion). Previously each owned a private ladder and they had already
 * diverged (8B vs 3B at 8 GB, Phi vs Llama at ≥12 GB).
 *
 * License posture: the top tier is Qwen2.5-7B (Apache-2.0); mid tiers are
 * Llama 3.2 (Llama Community License — commercial use allowed) and the floor
 * is TinyLlama (Apache-2.0). Every id must exist in the MLC prebuilt registry
 * shipped with the installed @mlc-ai/web-llm version.
 */
export function recommendedWebLLMChatModel(
  deviceMemoryGB: number,
  hardwareConcurrency = 4,
): string {
  if (deviceMemoryGB < 4 || hardwareConcurrency < 4) {
    return "TinyLlama-1.1B-Chat-v1.0-q4f16_1-MLC";
  }
  if (deviceMemoryGB < 8) {
    return "Llama-3.2-1B-Instruct-q4f16_1-MLC";
  }
  if (deviceMemoryGB < 12) {
    return "Llama-3.2-3B-Instruct-q4f16_1-MLC";
  }
  return "Qwen2.5-7B-Instruct-q4f16_1-MLC";
}
