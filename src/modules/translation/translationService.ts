/**
 * src/modules/translation/translationService.ts
 *
 * Public facade of the translation module — Core (MIT).
 *
 * UI code should depend on THIS, never on the pipeline or the engine clients:
 *  - one AbortController per document, so a new run cancels the previous one
 *    instead of interleaving two models on one GPU;
 *  - `prepareLocalEngine` is the explicit "download this model?" entry point,
 *    so the on-demand download consent required by the product can live in the
 *    settings UI instead of hiding inside a translation action;
 *  - engine listing for the picker, with entitlement blockers as data.
 */

import { licenseService } from "../../services/LicenseService";
import { securityVault } from "../../services/SecurityVault";
import {
  announceProUnavailable,
  ProUnavailableError,
} from "../../services/pro-access";
import { translationCache } from "./cache/translationCache";
import { probeTranslationCapabilities } from "./engines/capabilities";
import {
  describeEngine,
  engineFamily,
  recommendedWebLLMModel,
} from "./engines/engineCatalog";
import {
  listAvailableEngines,
  selectTranslationEngine,
} from "./engines/engineSelector";
import { loadLocalTranslationEngine } from "./engines/localEngine";
import { TranslationPipeline, translationPipeline } from "./TranslationPipeline";
import { getPromptPack } from "./prompts/prompts";
import {
  floresCode,
  OLLAMA_DEFAULT_ENDPOINT,
  OLLAMA_DEFAULT_MODEL,
} from "./constants";
import type {
  LocalEngineId,
  TranslationEngineDescriptor,
  TranslationEngineId,
  TranslationRequest,
  TranslationResult,
} from "./types";
import { TranslationEngineUnavailableError, TranslationError } from "./errors";

export interface PrepareEngineOptions {
  modelId?: string;
  sourceLocale: string;
  targetLocale: string;
  onProgress?: (progress: {
    stage: "download" | "init" | "generate" | "dispose";
    progress: number;
    text: string;
  }) => void;
  signal?: AbortSignal;
}

export class TranslationService {
  private readonly controllers = new Map<string, AbortController>();

  constructor(private readonly pipeline: TranslationPipeline = translationPipeline) {}

  /**
   * Translate a document. The returned promise rejects with `AbortError` when
   * it is cancelled (by a newer run or `cancel()`).
   */
  async translate(request: TranslationRequest): Promise<TranslationResult> {
    const controller = new AbortController();
    const previous = this.controllers.get(request.documentId);
    // A second run for the same document supersedes the first: two models
    // cannot share the GPU, and interleaved chunks would corrupt the view.
    previous?.abort();
    this.controllers.set(request.documentId, controller);

    const forwardAbort = () => controller.abort();
    if (request.signal?.aborted) {
      controller.abort();
    } else {
      request.signal?.addEventListener("abort", forwardAbort, { once: true });
    }

    try {
      return await this.pipeline.translate({ ...request, signal: controller.signal });
    } finally {
      request.signal?.removeEventListener("abort", forwardAbort);
      if (this.controllers.get(request.documentId) === controller) {
        this.controllers.delete(request.documentId);
      }
    }
  }

  /** Cancel the run for one document, if any. */
  cancel(documentId: string): void {
    this.controllers.get(documentId)?.abort();
    this.controllers.delete(documentId);
  }

  /** Cancel every run (vault lock, navigation away, memory pressure). */
  cancelAll(): void {
    for (const controller of this.controllers.values()) {controller.abort();}
    this.controllers.clear();
  }

  /**
   * Engines with their current blockers, for the settings/picker UI.
   * Capability probing is cached for the session (see capabilities.ts).
   */
  async availableEngines(
    sourceLocale: string,
    targetLocale: string,
  ): Promise<TranslationEngineDescriptor[]> {
    const capabilities = await probeTranslationCapabilities();
    return listAvailableEngines({
      isPro: licenseService.hasProAccess(),
      capabilities,
      sourceLocale,
      targetLocale,
    });
  }

  /**
   * Which engine `auto` (or an explicit choice) resolves to, WITHOUT starting
   * any download or generation. The workspace uses it to ask for download
   * consent before a multi-gigabyte fetch, and to label the picker honestly.
   */
  async resolveEngine(input: {
    preferred?: TranslationEngineId | "auto";
    sourceLocale: string;
    targetLocale: string;
  }): Promise<TranslationEngineDescriptor> {
    const capabilities = await probeTranslationCapabilities();
    try {
      return selectTranslationEngine({
        isPro: licenseService.hasProAccess(),
        preferred: input.preferred ?? "auto",
        capabilities,
        sourceLocale: input.sourceLocale,
        targetLocale: input.targetLocale,
      }).descriptor;
    } catch (error) {
      if (error instanceof TranslationEngineUnavailableError && error.code === "pro-required") {
        announceProUnavailable(
          new ProUnavailableError("TranslationLocalEngine", "no-license"),
        );
      }
      throw error;
    }
  }

  /**
   * Explicit model preparation (the "download ~2 GB" consent path).
   *
   * Requires Pro: it resolves the Pro engine through the seam, so a Free user
   * gets the typed ProUnavailableError without any download starting.
   */
  async prepareLocalEngine(
    engine: LocalEngineId,
    options: PrepareEngineOptions,
  ): Promise<{ engine: LocalEngineId; modelId: string }> {
    if (!licenseService.hasProAccess()) {
      // Reuse the loader's error shape so callers have a single entitlement
      // branch (pro-access rejects before the Pro chunk is fetched).
      await loadLocalTranslationEngine();
    }

    const modelId =
      options.modelId ??
      (engine === "ollama"
        ? OLLAMA_DEFAULT_MODEL
        : engine === "nllb"
          ? describeEngine("nllb").modelId
          : recommendedWebLLMModel(8));

    const facade = await loadLocalTranslationEngine();
    const srcLang = floresCode(options.sourceLocale);
    const tgtLang = floresCode(options.targetLocale);
    if (engine === "nllb" && (!srcLang || !tgtLang)) {
      throw new TranslationError(
        "unsupported-language-pair",
        `NLLB does not support ${options.sourceLocale} → ${options.targetLocale}.`,
      );
    }

    await facade.init({
      engine,
      modelId,
      nllb: srcLang && tgtLang ? { srcLang, tgtLang } : undefined,
      ollamaEndpoint: OLLAMA_DEFAULT_ENDPOINT,
      onProgress: options.onProgress,
      signal: options.signal,
    });
    return { engine, modelId };
  }

  /** Release the loaded model (frees VRAM / WASM heap). */
  async releaseLocalEngine(): Promise<void> {
    try {
      const facade = await loadLocalTranslationEngine();
      await facade.dispose();
    } catch {
      // INTENTIONAL SILENCE: nothing is loaded when the Pro runtime is not
      // resolvable, so there is nothing to release.
    }
  }

  /** Drop the cached pairs of one document/locale/engine combination. */
  async invalidateCache(input: {
    documentId: string;
    sourceLocale: string;
    targetLocale: string;
    engine: TranslationEngineId;
  }): Promise<void> {
    await translationCache.invalidate({
      documentId: input.documentId,
      sourceLocale: input.sourceLocale,
      targetLocale: input.targetLocale,
      engineFamily: engineFamily(input.engine),
      promptVersion: getPromptPack().version,
    });
  }

  /** Cache entries are decrypted in memory only; call on vault lock. */
  onVaultLocked(): void {
    this.cancelAll();
    translationCache.reset();
  }
}

export const translationService = new TranslationService();

// Lock boundary (AGENTS.md §2): a lock must never leave decrypted translation
// pairs or a running generation in memory. The encrypted bundles in
// SecureStorage become unreadable at the same moment (the device key is
// wrapped), so a later unlock simply repopulates from disk.
securityVault.onLock(() => {
  translationService.onVaultLocked();
});
