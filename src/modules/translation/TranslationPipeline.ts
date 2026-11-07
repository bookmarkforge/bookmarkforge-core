/**
 * src/modules/translation/TranslationPipeline.ts
 *
 * The two-pass translation pipeline — Core (MIT), orchestration only.
 *
 * Flow per chunk:
 *   cache lookup ──hit──▶ emit (0 ms)
 *        │miss
 *        ▼
 *   pass 1  fidelity translation (temperature 0, markdown preserved)
 *        ▼
 *   pass 2  editorial review (local engines by default; opt-in for cloud)
 *        ▼
 *   encrypt + persist the pair  ──▶ next chunk (1.5 s GPU cooldown when heavy)
 *
 * Non-negotiable behaviours:
 *  - Sequential by design. A 3B model sharing one GPU does not benefit from
 *    concurrency, and parallel chunks would reorder the document.
 *  - Code fences never reach the model (they are echoed verbatim), so a
 *    quantized model cannot "fix" the user's code.
 *  - The model is loaded lazily, AFTER the cache is consulted: reopening a
 *    fully cached document must not download or reload a 2 GB model.
 *  - A review pass that returns nothing degrades to the draft (logged); a
 *    translation pass that returns nothing fails closed for that run.
 */

import { logger } from "../../utils/logger";
import { licenseService } from "../../services/LicenseService";
import {
  announceProUnavailable,
  ProUnavailableError,
} from "../../services/pro-access";
import { aiManager } from "../../services/ai/ProviderManager";
import { translationCache, type TranslationCacheContext } from "./cache/translationCache";
import { chunkText, type TextChunk } from "./chunking/chunkText";
import { estimateTokens } from "./chunking/tokenEstimator";
import { engineFamily } from "./engines/engineCatalog";
import { selectTranslationEngine } from "./engines/engineSelector";
import { probeTranslationCapabilities } from "./engines/capabilities";
import { loadLocalTranslationEngine } from "./engines/localEngine";
import { cloudGenerate } from "./engines/cloudEngine";
import { TranslationCostMeter } from "./cost/costMeter";
import {
  buildReviewPrompt,
  buildTranslatePrompt,
  getPromptPack,
} from "./prompts/prompts";
import {
  floresCode,
  OLLAMA_DEFAULT_ENDPOINT,
  THERMAL_CHUNK_MIN_TOKENS,
  THERMAL_PACING_MS,
  TRANSLATION_MAX_OUTPUT_TOKENS,
} from "./constants";
import {
  TranslationEngineUnavailableError,
  TranslationError,
  TranslationResponseError,
} from "./errors";
import type {
  LocalEngineId,
  LocalTranslationEngineFacade,
  TranslationEngineId,
  TranslationEvent,
  TranslationPair,
  TranslationRequest,
  TranslationResult,
} from "./types";

function emit(
  request: TranslationRequest,
  event: TranslationEvent,
): void {
  if (!request.onEvent) {return;}
  try {
    request.onEvent(event);
  } catch (error) {
    // A UI callback must never break a long translation run.
    logger.warn("[translation] event listener threw", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException("Translation aborted", "AbortError");
  }
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(new DOMException("Translation aborted", "AbortError"));
    };
    if (signal?.aborted) {
      clearTimeout(timer);
      reject(new DOMException("Translation aborted", "AbortError"));
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Strip wrappers a model may echo despite the prompt: the `<source>` delimiters
 * and a leading "Translation:" label. Markdown fences are NOT stripped — they
 * may be genuine document content.
 */
function normalizeModelOutput(raw: string): string {
  let out = raw.trim();
  if (out.startsWith("<source>")) {
    out = out.slice("<source>".length);
  }
  if (out.endsWith("</source>")) {
    out = out.slice(0, -"</source>".length);
  }
  out = out.replace(/^\s*(?:translation|traducción|traduccion|traduction|übersetzung)\s*:\s*/i, "");
  return out.trim();
}

/** NLLB's context window is 1024 positions; keep chunks well below it. */
function chunkOptionsFor(engine: TranslationEngineId): {
  targetTokens?: number;
  maxTokens?: number;
  minTokens?: number;
} {
  if (engine === "nllb") {
    return { targetTokens: 320, maxTokens: 420, minTokens: 120 };
  }
  return {};
}

function shouldReview(
  engine: TranslationEngineId,
  policy: TranslationRequest["reviewPass"],
): boolean {
  if (policy === "off") {return false;}
  // NLLB is a direct MT model: it re-translates the source rather than editing
  // a draft, so a "review" pass would be a second identical translation (and a
  // second model run) with no possible improvement.
  if (engine === "nllb") {return false;}
  if (policy === "always") {return true;}
  // Default (`local-only`): small local models benefit; cloud models at
  // temperature 0 do not justify doubling the user's bill.
  return engine !== "cloud";
}

export class TranslationPipeline {
  async translate(request: TranslationRequest): Promise<TranslationResult> {
    const startedAt = Date.now();
    if (!request.text || request.text.trim().length === 0) {
      throw new TranslationError("empty-source", "There is no text to translate.");
    }
    throwIfAborted(request.signal);

    const isPro = licenseService.hasProAccess();
    const capabilities = await probeTranslationCapabilities();

    let selection;
    try {
      selection = selectTranslationEngine({
        isPro,
        preferred: request.engine ?? "auto",
        capabilities,
        sourceLocale: request.sourceLocale,
        targetLocale: request.targetLocale,
      });
    } catch (error) {
      if (error instanceof TranslationEngineUnavailableError && error.code === "pro-required") {
        // Same panel every other Pro surface opens; the module never invents
        // its own upgrade dialog.
        announceProUnavailable(
          new ProUnavailableError("TranslationLocalEngine", "no-license"),
        );
      }
      throw error;
    }

    const engine = selection.descriptor.id;
    const modelId = selection.descriptor.modelId;
    throwIfAborted(request.signal);

    emit(request, {
      type: "engine-selected",
      engine,
      modelId,
      modelLoaded: false,
    });

    const promptPack = getPromptPack();
    const cacheContext: TranslationCacheContext = {
      documentId: request.documentId,
      sourceLocale: request.sourceLocale,
      targetLocale: request.targetLocale,
      engineFamily: engineFamily(engine),
      promptVersion: promptPack.version,
    };

    emit(request, { type: "phase", phase: "chunking" });
    const chunks = chunkText(request.text, chunkOptionsFor(engine));
    if (chunks.length === 0) {
      throw new TranslationError("empty-source", "There is no text to translate.");
    }

    const totalTokens = chunks.reduce((sum, chunk) => sum + chunk.estimatedTokens, 0);
    const cacheMap = await translationCache.load(cacheContext);

    const cachedHits = chunks.filter((chunk) => {
      if (!chunk.translatable) {return true;}
      const pair = cacheMap.get(chunk.hash);
      return Boolean(pair && pair.sourceText === chunk.text);
    }).length;

    emit(request, {
      type: "plan",
      totalChunks: chunks.length,
      translatableChunks: chunks.filter((chunk) => chunk.translatable).length,
      cachedChunks: cachedHits,
      estimatedSourceTokens: totalTokens,
    });

    const providerInfo = aiManager.getProviderInfo();
    const costMeter = new TranslationCostMeter({
      engine,
      cloudProvider: providerInfo.provider,
      cloudModel: providerInfo.model,
      isFreePlan: !isPro,
    });

    // An explicitly supplied glossary (even an empty one) wins over the stored
    // one: the caller may be translating with a curated, per-document set.
    const glossary = request.glossary ?? (await this.loadGlossary());

    const reviewEnabled = shouldReview(engine, request.reviewPass);
    const local =
      engine === "cloud"
        ? null
        : await this.initLocalEngine(engine, modelId, request, chunks, cacheMap);

    const pairs: TranslationPair[] = [];
    let cacheHits = 0;
    let tokensIn = 0;
    let tokensOut = 0;

    for (const chunk of chunks) {
      throwIfAborted(request.signal);

      if (!chunk.translatable) {
        // Code fences: echo verbatim, never send to a model.
        const pair = this.passthroughPair(chunk, engine, modelId);
        pairs.push(pair);
        emit(request, {
          type: "chunk-start",
          index: chunk.index,
          total: chunks.length,
          estimatedTokens: chunk.estimatedTokens,
          fromCache: true,
          sourceText: chunk.text,
          kind: chunk.kind,
          translatable: chunk.translatable,
        });
        emit(request, {
          type: "chunk-done",
          index: chunk.index,
          text: chunk.text,
          reviewed: true,
          fromCache: true,
        });
        continue;
      }

      const cached = cacheMap.get(chunk.hash);
      if (cached && cached.sourceText === chunk.text) {
        cacheHits += 1;
        pairs.push(cached);
        emit(request, {
          type: "chunk-start",
          index: chunk.index,
          total: chunks.length,
          estimatedTokens: chunk.estimatedTokens,
          fromCache: true,
          sourceText: chunk.text,
          kind: chunk.kind,
          translatable: chunk.translatable,
        });
        emit(request, {
          type: "chunk-done",
          index: chunk.index,
          text: cached.translatedText,
          reviewed: cached.reviewed,
          fromCache: true,
        });
        continue;
      }

      emit(request, {
        type: "chunk-start",
        index: chunk.index,
        total: chunks.length,
        estimatedTokens: chunk.estimatedTokens,
        fromCache: false,
        sourceText: chunk.text,
        kind: chunk.kind,
        translatable: chunk.translatable,
      });

      const translatePrompt = buildTranslatePrompt(chunk.text, {
        sourceLocale: request.sourceLocale,
        targetLocale: request.targetLocale,
        glossary,
      });

      emit(request, { type: "phase", phase: "translate", index: chunk.index, total: chunks.length });

      const draft = await this.runGeneration({
        engine,
        chunk,
        systemPrompt: translatePrompt.systemPrompt,
        userPrompt: translatePrompt.userPrompt,
        temperature: translatePrompt.temperature,
        local,
        signal: request.signal,
        onDelta: (delta) => emit(request, { type: "chunk-delta", index: chunk.index, delta }),
      });

      const chunkTokensIn = estimateTokens(translatePrompt.systemPrompt + translatePrompt.userPrompt);
      tokensIn += chunkTokensIn;
      tokensOut += estimateTokens(draft.text);
      costMeter.observe(chunkTokensIn, estimateTokens(draft.text), draft.costDeltaUSD);

      let finalText = normalizeModelOutput(draft.text);
      if (!finalText) {
        throw new TranslationResponseError(
          `The ${engine} engine returned an empty translation for chunk ${chunk.index + 1}.`,
        );
      }

      let reviewed = false;
      if (reviewEnabled) {
        emit(request, { type: "phase", phase: "review", index: chunk.index, total: chunks.length });
        try {
          const reviewPrompt = buildReviewPrompt(chunk.text, finalText, {
            sourceLocale: request.sourceLocale,
            targetLocale: request.targetLocale,
            glossary,
          });
          const reviewedResult = await this.runGeneration({
            engine,
            chunk,
            systemPrompt: reviewPrompt.systemPrompt,
            userPrompt: reviewPrompt.userPrompt,
            // Review never streams into the UI: the draft is already on screen
            // and replacing it token by token would flicker. The final text
            // arrives with `chunk-done`.
            temperature: reviewPrompt.temperature,
            local,
            signal: request.signal,
          });
          const reviewedText = normalizeModelOutput(reviewedResult.text);
          const reviewTokensIn = estimateTokens(reviewPrompt.systemPrompt + reviewPrompt.userPrompt);
          tokensIn += reviewTokensIn;
          tokensOut += estimateTokens(reviewedText);
          costMeter.observe(reviewTokensIn, estimateTokens(reviewedText), reviewedResult.costDeltaUSD);

          if (reviewedText) {
            finalText = reviewedText;
            reviewed = true;
          } else {
            logger.warn("[translation] review pass returned no text; keeping the draft", {
              chunk: chunk.index,
            });
          }
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") {throw error;}
          // The review pass is an accuracy enhancement, not a hard dependency:
          // a provider hiccup on pass 2 must not discard a good pass 1.
          logger.warn("[translation] review pass failed; keeping the draft", {
            chunk: chunk.index,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const pair: TranslationPair = {
        index: chunk.index,
        hash: chunk.hash,
        sourceText: chunk.text,
        translatedText: finalText,
        engine,
        modelId,
        reviewed,
        createdAt: new Date().toISOString(),
      };
      pairs.push(pair);
      await translationCache.put(cacheContext, pair);

      emit(request, {
        type: "chunk-done",
        index: chunk.index,
        text: finalText,
        reviewed,
        fromCache: false,
      });

      const snapshot = costMeter.snapshot();
      emit(request, {
        type: "cost",
        totalUSD: snapshot.totalUSD,
        savedUSD: snapshot.savedUSD,
        provider: snapshot.provider,
        model: snapshot.model,
        isFreePlan: snapshot.isFreePlan,
      });

      // GPU cooldown between heavy chunks: sustained 100 % utilization on
      // laptop GPUs throttles the whole machine, and the user is reading the
      // streaming output anyway.
      if (
        chunk.estimatedTokens >= THERMAL_CHUNK_MIN_TOKENS &&
        chunk.index < chunks.length - 1
      ) {
        await sleep(THERMAL_PACING_MS, request.signal);
      }
    }

    throwIfAborted(request.signal);
    emit(request, { type: "phase", phase: "persist" });
    await translationCache.flush(cacheContext);

    const translatedByIndex = new Map(pairs.map((pair) => [pair.index, pair.translatedText]));
    const text = chunks
      .map((chunk) => `${chunk.separatorBefore}${translatedByIndex.get(chunk.index) ?? chunk.text}`)
      .join("");

    const durationMs = Date.now() - startedAt;
    const snapshot = costMeter.snapshot();
    emit(request, {
      type: "done",
      totalChunks: chunks.length,
      cacheHits,
      totalUSD: snapshot.totalUSD,
      durationMs,
    });

    logger.info("[translation] run finished", {
      engine,
      chunks: chunks.length,
      cacheHits,
      durationMs,
      tokensIn,
      tokensOut,
    });

    return {
      engine,
      modelId,
      sourceLocale: request.sourceLocale,
      targetLocale: request.targetLocale,
      chunks: pairs.sort((a, b) => a.index - b.index),
      text,
      cacheHits,
      totalUSD: snapshot.totalUSD,
      durationMs,
    };
  }

  private passthroughPair(
    chunk: TextChunk,
    engine: TranslationEngineId,
    modelId: string,
  ): TranslationPair {
    return {
      index: chunk.index,
      hash: chunk.hash,
      sourceText: chunk.text,
      translatedText: chunk.text,
      engine,
      modelId,
      reviewed: true,
      createdAt: new Date().toISOString(),
    };
  }

  private async loadGlossary() {
    const { translationGlossary } = await import("./glossary/translationGlossary");
    return translationGlossary.forPrompt();
  }

  /**
   * Load the local model only when there is real work for it: a fully cached
   * document must open instantly without touching the GPU or downloading a
   * multi-gigabyte model.
   */
  private async initLocalEngine(
    engine: LocalEngineId,
    modelId: string,
    request: TranslationRequest,
    chunks: TextChunk[],
    cacheMap: Map<string, TranslationPair>,
  ) {
    const hasMiss = chunks.some((chunk) => {
      if (!chunk.translatable) {return false;}
      const pair = cacheMap.get(chunk.hash);
      return !(pair && pair.sourceText === chunk.text);
    });
    if (!hasMiss) {return null;}

    let facade;
    try {
      facade = await loadLocalTranslationEngine();
    } catch (error) {
      if (error instanceof ProUnavailableError) {
        announceProUnavailable(
          new ProUnavailableError("TranslationLocalEngine", error.reason),
        );
        throw new TranslationEngineUnavailableError(
          engine,
          "pro-required",
          "Local translation requires a Pro license.",
        );
      }
      throw error;
    }

    const srcLang = floresCode(request.sourceLocale);
    const tgtLang = floresCode(request.targetLocale);
    if (engine === "nllb" && (!srcLang || !tgtLang)) {
      throw new TranslationEngineUnavailableError(
        engine,
        "unsupported-language-pair",
        `NLLB does not support ${request.sourceLocale} → ${request.targetLocale}.`,
      );
    }

    emit(request, { type: "phase", phase: "translate" });
    await facade.init({
      engine,
      modelId,
      nllb: srcLang && tgtLang ? { srcLang, tgtLang } : undefined,
      ollamaEndpoint: OLLAMA_DEFAULT_ENDPOINT,
      signal: request.signal,
      onProgress: (progress) =>
        emit(request, {
          type: "model-progress",
          stage: progress.stage,
          progress: progress.progress,
          text: progress.text,
        }),
    });
    return facade;
  }

  private async runGeneration(input: {
    engine: TranslationEngineId;
    chunk: TextChunk;
    systemPrompt: string;
    userPrompt: string;
    temperature: number;
    local: LocalTranslationEngineFacade | null;
    signal?: AbortSignal;
    onDelta?: (delta: string) => void;
  }): Promise<{ text: string; costDeltaUSD: number }> {
    throwIfAborted(input.signal);

    if (input.engine === "cloud") {
      const result = await cloudGenerate({
        systemPrompt: input.systemPrompt,
        userPrompt: input.userPrompt,
        temperature: input.temperature,
        maxTokens: TRANSLATION_MAX_OUTPUT_TOKENS,
        onDelta: input.onDelta,
        signal: input.signal,
      });
      return { text: result.text, costDeltaUSD: result.costDeltaUSD };
    }

    if (!input.local) {
      throw new TranslationEngineUnavailableError(
        input.engine,
        "not-configured",
        "Local engine was not initialized.",
      );
    }

    const text = await input.local.generate({
      systemPrompt: input.systemPrompt,
      userPrompt: input.userPrompt,
      rawSourceText: input.chunk.text,
      temperature: input.temperature,
      maxTokens: TRANSLATION_MAX_OUTPUT_TOKENS,
      onDelta: input.onDelta,
      signal: input.signal,
    });
    return { text, costDeltaUSD: 0 };
  }
}


export const translationPipeline = new TranslationPipeline();
