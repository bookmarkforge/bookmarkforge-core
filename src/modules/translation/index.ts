/**
 * src/modules/translation/index.ts
 *
 * Public surface of the private translation module. Core (MIT).
 *
 * UI imports from here:
 *
 *   import { translationService } from "@/modules/translation";
 *   const result = await translationService.translate({
 *     documentId, text, sourceLocale: "en", targetLocale: "es",
 *     onEvent: (event) => { ... },       // streaming + progress + cost
 *   });
 *
 * Deliberately NOT exported: the Pro worker/facade (only reachable through
 * `loadProService`), the raw pipeline internals, and the cloud adapter. Keeping
 * those private is what stops a future component from bypassing the
 * entitlement or the chunking rules.
 */

export { translationService, TranslationService } from "./translationService";
export type { PrepareEngineOptions } from "./translationService";

export {
  chunkText,
  reassembleChunks,
  hashChunkText,
} from "./chunking/chunkText";
export type { TextChunk, ChunkKind, ChunkTextOptions } from "./chunking/chunkText";
export { estimateTokens, fitsTokenBudget } from "./chunking/tokenEstimator";

export {
  buildReviewPrompt,
  buildTranslatePrompt,
  getPromptPack,
  renderGlossaryRules,
} from "./prompts/prompts";
export type { BuiltPrompt, TranslationPromptPack } from "./prompts/prompts";

export {
  describeEngine,
  engineFamily,
  listEngineDescriptors,
  recommendedWebLLMModel,
} from "./engines/engineCatalog";
export { selectTranslationEngine, listAvailableEngines } from "./engines/engineSelector";
export {
  probeOllama,
  probeTranslationCapabilities,
} from "./engines/capabilities";
export { loadLocalTranslationEngine, isLocalTranslationAvailable } from "./engines/localEngine";

export {
  TranslationError,
  TranslationEngineUnavailableError,
  TranslationResponseError,
} from "./errors";
export type { TranslationErrorCode } from "./errors";

export {
  estimateCostUSD,
  estimateDocumentCostUSD,
} from "./cost/costMeter";
export type { TranslationCostSnapshot } from "./cost/costMeter";

export { translationGlossary } from "./glossary/translationGlossary";

export {
  markdownToSimpleBlocks,
  saveTranslationAsDocument,
} from "./knowledge/translationGraph";
export type {
  SaveTranslatedDocumentOptions,
  SaveTranslatedDocumentResult,
} from "./knowledge/translationGraph";

export {
  CHUNK_MAX_TOKENS,
  CHUNK_TARGET_TOKENS,
  LOCALE_DISPLAY_NAMES,
  THERMAL_PACING_MS,
  TRANSLATION_TEMPERATURE,
} from "./constants";

export type {
  GlossaryEntry,
  LocalEngineId,
  LocalTranslationEngineFacade,
  TranslationCapabilities,
  TranslationEngineDescriptor,
  TranslationEngineId,
  TranslationEngineRuntime,
  TranslationEngineUnavailableReason,
  TranslationEvent,
  TranslationPair,
  TranslationPhase,
  TranslationRequest,
  TranslationResult,
} from "./types";
