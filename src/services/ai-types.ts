/**
 * src/services/ai-types.ts — Core-side mirror of the Pro AI type contracts.
 *
 * Why this exists: the proprietary AI modules (WebLLMService, GlobalRAGService,
 * SpecializedAgentsService, FlashcardService) define types that Core code
 * legitimately references (progress payloads, capability blockers, RAG
 * grounding metadata). Importing those types from the Pro modules directly
 * would make Core's type graph depend on Pro source files; the compiler erases
 * `import type`, but the *declaration* dependency still points across the
 * boundary and the public export must satisfy it from the generated `.d.ts`
 * pairs. Re-exporting the contracts here keeps that dependency aimed at a
 * Core file (MIT, exported as-is), while the implementation stays Pro.
 */
export type { WebLLMCapabilityBlocker } from "./ai/WebLLMService";
export type { RAGResult } from "./ai/GlobalRAGService";
