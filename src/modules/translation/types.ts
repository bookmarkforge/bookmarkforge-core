/**
 * src/modules/translation/types.ts
 *
 * Public contracts of the private translation module.
 *
 * Open Core boundary: THIS FILE IS CORE (MIT). It carries only types and pure
 * data — no runtime import of @mlc-ai/web-llm, @huggingface/transformers or any
 * Pro module. The local runtimes live in `./pro/` and are resolved through
 * `src/services/pro-access.ts` (see `engines/localEngine.ts`), so a Free build
 * never links or downloads them.
 *
 * Failure posture: the module is fail-closed. Nothing here defaults to a cloud
 * provider; the caller (and the entitlement-aware selector) must opt into the
 * BYOK cloud path explicitly.
 */

/** Engines the translation pipeline can drive. */
export type TranslationEngineId = "webllm" | "ollama" | "nllb" | "cloud";

/** Engines that execute entirely on the user's machine. */
export type LocalEngineId = Exclude<TranslationEngineId, "cloud">;

export type TranslationEngineRuntime = "webgpu" | "wasm" | "http" | "cloud";

/**
 * Why an engine cannot be used right now.
 *
 * `pro-required` is the only entitlement blocker; the remaining values are
 * device/configuration blockers, and each one is surfaced verbatim so the UI
 * can offer the right remedy (upgrade vs. install Ollama vs. use the cloud).
 */
export type TranslationEngineUnavailableReason =
  | "pro-required"
  | "webgpu-unavailable"
  | "shader-f16-unsupported"
  | "insufficient-memory"
  | "ollama-unreachable"
  | "not-configured"
  | "unsupported-language-pair";

export interface TranslationEngineDescriptor {
  id: TranslationEngineId;
  runtime: TranslationEngineRuntime;
  /** Runtime model id (MLC registry id, Ollama tag or HF repo id). */
  modelId: string;
  /** Human-readable engine name (brand names are not translated). */
  label: string;
  /**
   * True when this engine is a Paid capability. Enforced twice: by the
   * selector (before any load) and by the Pro loader itself.
   */
  requiresPro: boolean;
  requiresWebGPU: boolean;
  minDeviceMemoryGB: number;
  /**
   * One-time model download in bytes (0 when the engine downloads nothing:
   * Ollama serves an already-installed model, cloud is pay-per-token).
   */
  downloadBytes: number;
  /** Set when the engine cannot currently be selected. */
  unavailableReason?: TranslationEngineUnavailableReason;
  /** Chinese/Japanese/Korean-free label of the runtime for diagnostics. */
  isLocal: boolean;
}

/** Device facts the selector needs. All are read without loading a Pro module. */
export interface TranslationCapabilities {
  webgpu: boolean;
  shaderF16: boolean;
  deviceMemoryGB: number;
  hardwareConcurrency: number;
  /** Result of the loopback `GET /api/tags` probe (Ollama). */
  ollamaReachable: boolean;
  /** Configured cloud provider is usable (key present / provider ready). */
  cloudConfigured: boolean;
}

/** A user-authored terminology rule, injected into the system prompt verbatim. */
export interface GlossaryEntry {
  source: string;
  target: string;
  /** Optional disambiguation note shown to the model, e.g. "verb, not noun". */
  note?: string;
}

/**
 * One cached source/target pair. `hash` is a content hash of `sourceText`, so
 * an edit that changes one paragraph only invalidates that paragraph's entry.
 */
export interface TranslationPair {
  index: number;
  hash: string;
  sourceText: string;
  translatedText: string;
  engine: TranslationEngineId;
  modelId: string;
  reviewed: boolean;
  createdAt: string;
}

export type TranslationPhase =
  | "chunking"
  | "cache"
  | "translate"
  | "review"
  | "persist";

/**
 * Streaming events emitted by the pipeline. `chunk-delta` carries only the new
 * text of one chunk, never the whole document, so the UI can append without
 * re-rendering what is already on screen.
 */
export type TranslationEvent =
  | {
      type: "engine-selected";
      engine: TranslationEngineId;
      modelId: string;
      modelLoaded: boolean;
    }
  | {
      type: "plan";
      totalChunks: number;
      translatableChunks: number;
      cachedChunks: number;
      estimatedSourceTokens: number;
    }
  | {
      type: "phase";
      phase: TranslationPhase;
      index?: number;
      total?: number;
    }
  | {
      type: "model-progress";
      stage: "download" | "init" | "generate" | "dispose";
      progress: number;
      text: string;
    }
  | {
      type: "chunk-start";
      index: number;
      total: number;
      estimatedTokens: number;
      fromCache: boolean;
      /**
       * The source block exactly as the pipeline chunked it. The split view
       * renders this on the left, so both columns share one chunking decision
       * instead of the UI re-deriving chunks with different options (NLLB uses
       * a smaller window).
       */
      sourceText: string;
      /** "code" blocks are echoed verbatim and must not be editable/translated. */
      kind: "prose" | "code" | "table" | "heading";
      translatable: boolean;
      /**
       * Whitespace that preceded this chunk in the source. The pipeline's own
       * reassembly is `separatorBefore + translated` per chunk; consumers that
       * rebuild the text from rows must carry it or paragraph/list/table
       * breaks are lost on save.
       */
      separatorBefore: string;
    }
  | { type: "chunk-delta"; index: number; delta: string }
  | {
      type: "chunk-done";
      index: number;
      text: string;
      reviewed: boolean;
      fromCache: boolean;
    }
  | {
      type: "cost";
      totalUSD: number;
      /** What the same run would have cost if the local engine were used. */
      savedUSD: number;
      provider: string;
      model: string;
      isFreePlan: boolean;
    }
  | {
      type: "done";
      totalChunks: number;
      cacheHits: number;
      totalUSD: number;
      durationMs: number;
    };

export interface TranslationRequest {
  /**
   * Stable id of the source item. Used only as part of the cache key and for
   * the knowledge-graph link; it is never sent to any provider.
   */
  documentId: string;
  /** Full source text (Markdown/HTML preserved). */
  text: string;
  sourceLocale: string;
  targetLocale: string;
  /** Injected into the system prompt as mandatory rules (capped by the caller). */
  glossary?: GlossaryEntry[];
  /**
   * `auto` follows the plan: Pro prefers WebLLM, then Ollama, then NLLB;
   * Free is cloud-only. An explicit local engine for a Free user fails closed
   * with a typed entitlement error instead of silently going to the cloud.
   */
  engine?: TranslationEngineId | "auto";
  /** Run the editorial second pass. Default: `local-only`. */
  reviewPass?: "always" | "local-only" | "off";
  signal?: AbortSignal;
  onEvent?: (event: TranslationEvent) => void;
}

export interface TranslationResult {
  engine: TranslationEngineId;
  modelId: string;
  sourceLocale: string;
  targetLocale: string;
  /** Final (post-review) text for every chunk, in document order. */
  chunks: TranslationPair[];
  /** Reassembled document, formatting byte-identical to the source. */
  text: string;
  cacheHits: number;
  totalUSD: number;
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Local worker protocol (main thread <-> Pro worker)
// ---------------------------------------------------------------------------

/** Lang configuration for the NLLB fallback (FLORES-200 codes). */
export interface NllbLanguagePair {
  srcLang: string;
  tgtLang: string;
}

/** Core-side contract of the Pro engine facade (implemented in ./pro/). */
export interface LocalEngineInitOptions {
  engine: LocalEngineId;
  modelId: string;
  nllb?: NllbLanguagePair;
  ollamaEndpoint?: string;
  onProgress?: (progress: {
    stage: LocalEngineProgressStage;
    progress: number;
    text: string;
  }) => void;
  signal?: AbortSignal;
}

export interface LocalEngineGenerateOptions {
  systemPrompt: string;
  userPrompt: string;
  rawSourceText: string;
  temperature: number;
  maxTokens: number;
  onDelta?: (delta: string) => void;
  signal?: AbortSignal;
}

export interface LocalTranslationEngineFacade {
  readonly isLoaded: boolean;
  init(options: LocalEngineInitOptions): Promise<void>;
  generate(options: LocalEngineGenerateOptions): Promise<string>;
  cancel(): void;
  dispose(): Promise<void>;
}

export type LocalEngineKind = LocalEngineId;

export interface LocalInitPayload {
  engine: LocalEngineKind;
  /** MLC registry id, Ollama model tag, or HF repo id. */
  modelId: string;
  /** Required by NLLB only. */
  nllb?: NllbLanguagePair;
  /** Required by Ollama only (loopback URL, e.g. http://localhost:11434). */
  ollamaEndpoint?: string;
}

export interface LocalGeneratePayload {
  /** Prompt pair built from the versioned prompt pack. */
  systemPrompt: string;
  userPrompt: string;
  /**
   * Untranslated chunk. Required by NLLB, which is a direct MT model (it takes
   * raw text + FLORES codes and ignores instruct prompts).
   */
  rawSourceText: string;
  temperature: number;
  maxTokens: number;
}

export type LocalEngineRequest =
  | { id: string; type: "init"; payload: LocalInitPayload }
  | { id: string; type: "translate"; payload: LocalGeneratePayload }
  /** Interrupts the in-flight generation (engine keeps its loaded weights). */
  | { id: string; type: "cancel"; payload: { targetId: string } }
  | { id: string; type: "status"; payload: Record<string, never> }
  | { id: string; type: "dispose"; payload: Record<string, never> };

export type LocalEngineProgressStage =
  | "download"
  | "init"
  | "generate"
  | "dispose";

export type LocalEngineResponse =
  | {
      id: string;
      type: "progress";
      stage: LocalEngineProgressStage;
      progress: number;
      text: string;
    }
  | { id: string; type: "delta"; text: string }
  | {
      id: string;
      type: "result";
      text: string;
      engine: LocalEngineKind;
      modelId: string;
    }
  | {
      id: string;
      type: "status";
      engine: LocalEngineKind | null;
      modelId: string | null;
      loaded: boolean;
    }
  | {
      id: string;
      type: "error";
      code:
        | "MODEL_NOT_PINNED"
        | "ENGINE_UNAVAILABLE"
        | "GENERATION_FAILED"
        | "CANCELLED"
        | "INVALID_REQUEST";
      message: string;
    };
