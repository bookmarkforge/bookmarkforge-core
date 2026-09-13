// WebLLMService - Browser-based LLM using WebGPU
// Now using dynamic imports to avoid loading @mlc-ai/web-llm at startup

import { resourceManager } from "./ResourceManager";
import { logger } from "../../utils/logger";
import { safeErrorForLog } from "../../utils/safeErrorForLog";
import {
  getNavigatorExtensions,
  getNavigatorGPU,
} from "../../utils/browser-types";
import { dynamicImport } from "../../utils/dynamicImport";
import { buildSafeUserContent } from "./utils";
import type * as WebLLM from "@mlc-ai/web-llm";

interface WebLLMGenerateOptions {
  temperature?: number;
  max_tokens?: number;
  isPrivate?: boolean;
  tools?: unknown[];
  complexity?: "simple" | "complex";
}

/**
 * The precise reason a device cannot run local AI, enumerated in the same
 * order as the capability ladder. `getCapabilityBlocker()` resolves to
 * `null` exactly when the device is capable — i.e. when canRunLocalLLM()
 * is true and assertCanRunLocalLLM() would not throw.
 */
export type WebLLMCapabilityBlocker =
  | "webgpu-unavailable"
  | "shader-f16-unsupported"
  | "insufficient-memory";

interface WebLLMHealthStatus {
  healthy: boolean;
  webGPUSupported: boolean;
  f16Supported: boolean;
  engineReady: boolean;
  modelLoaded: string | null;
  isInitializing: boolean;
  deviceMemoryGB: number;
  hardwareConcurrency: number;
  lastError: string | null;
  canRunLocalLLM: boolean;
  timestamp: number;
}

interface WebLLMHealthMetrics {
  initializationCount: number;
  generationCount: number;
  errorCount: number;
  lastInitTime: number;
  avgGenerationTime: number;
  totalGenerationTime: number;
  /** Wall-clock ms from model install to the first successful generation (F1-D). */
  firstSummaryLatencyMs: number | null;
}

interface WebLLMTask {
  task: () => Promise<string>;
  resolve: (val: string) => void;
  reject: (err: unknown) => void;
  cancelled: boolean;
  cleanup: () => void;
}

function createAbortError(message = "WebLLM generation aborted"): DOMException {
  return new DOMException(message, "AbortError");
}

// Cache for dynamically imported module
let mlcModule: typeof WebLLM | null = null;

// Default timeout for GPU inference — without this, a degenerate prompt or a
// slow GPU could cause the generation to run indefinitely when no caller-provided
// AbortSignal is supplied.
const GPU_INFERENCE_TIMEOUT_MS = 120_000;

// Dynamically import MLC-WebLLM only when needed
async function getMLC(): Promise<typeof WebLLM> {
  if (mlcModule) {return mlcModule;}

  const module = await dynamicImport(
    () => import("@mlc-ai/web-llm"),
    "@mlc-ai/web-llm",
    { timeout: 30000, retries: 2, retryDelay: 2000 },
  );
  mlcModule = module;
  return mlcModule;
}

export class WebLLMService {
  private engine: WebLLM.MLCEngine | null = null;
  private isInitializing = false;
  // Empty string means "no model loaded" — a fresh service and an unloaded
  // one must both report the same honest "none" via getCurrentModel(), not
  // a default model id that is not actually in memory.
  private currentModel = "";
  public progressCallback:
    ((progress: { text: string; progress: number }) => void) | null = null;
  private progressListeners = new Set<
    (progress: { text: string; progress: number }) => void
  >();

  onProgress(
    listener: (progress: { text: string; progress: number }) => void,
  ): () => void {
    this.progressListeners.add(listener);
    return () => {
      this.progressListeners.delete(listener);
    };
  }
  private webGpuSupported: boolean | null = null;
  private f16Supported = false;
  private unloadTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly TTL_MS = 30 * 60 * 1000; // 30 minutes of inactivity
  /**
   * Latch set ONLY by the idle-TTL callback: the engine was released by the
   * 30-minute idle policy, so opportunistic init callers (warmup — the unlock
   * listener and the editor-focus handler, the only non-force init callers)
   * must not silently resurrect it. Cleared exclusively by init(force=true),
   * i.e. the user's explicit re-acquisition — never by unload() itself (the
   * TTL path sets the latch and THEN unloads) and never by other unload
   * callers (memory pressure, provider switch, vault lock): those must stay
   * recoverable by a plain warmup, which the vault re-unlock flow relies on.
   */
  private unloadedByIdleTimer = false;

  // Device budget (audit §4.3 item 5): engine init served from the model
  // cache (no download) must stay under 60 s. Exceeding it is a device/
  // model-size regression signal, not a failure — warn and continue.
  private readonly INIT_BUDGET_MS = 60 * 1000;

  // Task Queue for OOM Protection
  private taskQueue: WebLLMTask[] = [];
  private readonly MAX_TASK_QUEUE_SIZE = 20;
  private isProcessingQueue = false;
  private initializationPromise: Promise<void> | null = null;
  private unloadPromise: Promise<void> | null = null;
  private lifecycleGeneration = 0;

  private async processQueue() {
    if (this.isProcessingQueue || this.taskQueue.length === 0) {return;}
    this.isProcessingQueue = true;
    try {
      while (this.taskQueue.length > 0) {
        const item = this.taskQueue.shift();
        if (!item || item.cancelled) {
          item?.cleanup();
          continue;
        }
        try {
          const result = await item.task();
          item.resolve(result);
        } catch (e) {
          item.reject(e);
        } finally {
          item.cleanup();
        }
        // Do not retain a cooldown timer after the queue has become idle.
        if (this.taskQueue.length > 0) {
          await new Promise((r) => setTimeout(r, 500));
        }
      }
    } finally {
      this.isProcessingQueue = false;
    }
  }

  // Health metrics
  private metrics: WebLLMHealthMetrics = {
    initializationCount: 0,
    generationCount: 0,
    errorCount: 0,
    lastInitTime: 0,
    avgGenerationTime: 0,
    totalGenerationTime: 0,
    firstSummaryLatencyMs: null,
  };
  private lastError: string | null = null;
  /** Timestamp set when init() finishes installing/loading the model. */
  private modelInstalledAt: number | null = null;

  private resetUnloadTimer() {
    if (this.unloadTimer) {clearTimeout(this.unloadTimer);}
    this.unloadTimer = setTimeout(() => {
      logger.info("[WebLLM] TTL expired. Unloading model to free VRAM");
      // Record WHY the engine went away before unloading: the latch is what
      // lets init() tell "idle-policy release — stay down" apart from the
      // other unload reasons that a plain warmup may recover from.
      this.unloadedByIdleTimer = true;
      this.unload();
    }, this.TTL_MS);
  }

  private clearUnloadTimer() {
    if (this.unloadTimer) {
      clearTimeout(this.unloadTimer);
      this.unloadTimer = null;
    }
  }

  /**
   * Checks if WebGPU is supported in the current environment.
   *
   * The name describes the RETURN value precisely: whether a WebGPU adapter
   * can be acquired (surface present + an adapter answers). It is NOT a
   * full runnability check — shader-f16 and the 4 GB RAM floor are separate
   * gates (see assertCanRunLocalLLM()/canRunLocalLLM()).
   *
   * SIDE EFFECT (part of the contract, relied on by assertCanRunLocalLLM
   * and getHealthStatus): a successful adapter acquisition also populates
   * this.f16Supported from the adapter's feature set. A rejection or a
   * missing surface caches webGpuSupported=false (and leaves the f16
   * verdict at its false default) — the catch path is what makes probe
   * failures behave as "not supported" everywhere.
   *
   * Cached after the first probe for the service instance's lifetime; a GPU
   * appearing later is not observed. Pair with assertCanRunLocalLLM() when
   * the precise blocker (no surface / no shader-f16 / low RAM) is needed as
   * an error message.
   */
  async isWebGPUSupported(): Promise<boolean> {
    if (this.webGpuSupported !== null) {return this.webGpuSupported;}

    try {
      // 1. Basic check for GPU API
      const gpu = getNavigatorGPU();
      if (!gpu) {
        this.webGpuSupported = false;
        return false;
      }

      // Prefer the discrete/high-performance adapter. The fallback keeps the
      // feature usable on integrated GPUs when the browser cannot honor the
      // preference; the application must never pretend GPU support exists when
      // no adapter was returned.
      const adapter =
        (await gpu.requestAdapter({
          powerPreference: "high-performance",
        })) || (await gpu.requestAdapter({ powerPreference: "low-power" }));

      this.webGpuSupported = adapter !== null;

      if (this.webGpuSupported && adapter) {
        // Check f16 (half-precision) support — MLC shaders require it.
        // If the adapter lacks 'shader-f16', CreateMLCEngine will fail
        // with an uncaptured GPUUncapturedErrorEvent. Detect early so
        // we can skip init gracefully instead of letting the engine crash.
        const features = (adapter as { features?: Set<string> }).features;
        const hasF16 = features?.has("shader-f16") ?? false;
        if (!hasF16) {
          logger.warn(
            "[WebLLM] WebGPU adapter lacks shader-f16 — local AI models " +
              "requiring half-precision will not work on this device.",
          );
        }
        this.f16Supported = hasF16;
        logger.info("[WebLLM] WebGPU detected and available", {
          f16: hasF16,
        });
      } else {
        logger.warn("[WebLLM] WebGPU API present but no adapter found");
      }

      return this.webGpuSupported;
    } catch (e) {
      logger.warn("[WebLLM] WebGPU detection error", {
        error: safeErrorForLog(e),
      });
      this.webGpuSupported = false;
      return false;
    }
  }

  /**
   * Throws the precise capability error when the device cannot run WebLLM.
   *
   * The single source of truth for the hard capability blockers — no WebGPU
   * surface, an adapter without shader-f16, or device memory below the
   * 4 GB floor — shared by init(), generateText() and ProviderManager's
   * generation path so the messages can never drift and every entry point
   * surfaces the same fail-closed error. This is the throw-based mirror of
   * canRunLocalLLM(): a device that passes this check is exactly a device
   * for which canRunLocalLLM() is true (in particular, a forced webllm
   * selection on a low-RAM device fails HERE with the memory error instead
   * of the misleading "engine not initialized" state error). All checks are
   * cached after the first probe, so calling this on a capable device is
   * ~free.
   */
  async assertCanRunLocalLLM(): Promise<void> {
    const blocker = await this.getCapabilityBlocker();
    if (blocker === "webgpu-unavailable") {
      throw new Error("WebGPU is not supported in this browser");
    }
    if (blocker === "shader-f16-unsupported") {
      throw new Error(
        "WebGPU adapter does not support shader-f16 (half-precision). " +
          "Local AI models require a GPU with f16 support. " +
          "Use a cloud provider (Gemini, OpenAI, etc.) instead.",
      );
    }
    if (blocker === "insufficient-memory") {
      const deviceMemory = getNavigatorExtensions().deviceMemory || 4;
      throw new Error(
        `Insufficient device memory for local AI models: ${deviceMemory} GB ` +
          "available, 4 GB required. " +
          "Use a cloud provider (Gemini, OpenAI, etc.) instead.",
      );
    }
  }

  /**
   * Returns the precise capability blocker for this device, or `null` when
   * the device can run local AI.
   *
   * The non-throwing mirror of assertCanRunLocalLLM(): the SAME ladder
   * (WebGPU surface -> shader-f16 -> >= 4 GB RAM), the SAME cache, so both
   * gates can never disagree — assertCanRunLocalLLM() is implemented on top
   * of this method and merely maps each blocker to its user-facing error.
   * Support diagnostics consumes the enum to tell end users WHY local AI
   * is unavailable (missing WebGPU vs. f16 vs. RAM) instead of a generic
   * "WebGPU or RAM required" message. Never throws: a device that reaches
   * the end of the ladder is capable and yields `null`.
   */
  async getCapabilityBlocker(): Promise<WebLLMCapabilityBlocker | null> {
    const webGpuSupported = await this.isWebGPUSupported();
    if (!webGpuSupported) {
      return "webgpu-unavailable";
    }
    if (!this.f16Supported) {
      return "shader-f16-unsupported";
    }
    const deviceMemory = getNavigatorExtensions().deviceMemory || 4;
    if (deviceMemory < 4) {
      return "insufficient-memory";
    }
    return null;
  }

  /**
   * Returns health status of the WebLLM service.
   */
  async getHealthStatus(): Promise<WebLLMHealthStatus> {
    const webGpuSupported = await this.isWebGPUSupported();
    const deviceMemory =
      getNavigatorExtensions().deviceMemory || 4;
    const hardwareConcurrency = navigator.hardwareConcurrency || 4;

    return {
      healthy: webGpuSupported && this.f16Supported && this.engine !== null,
      webGPUSupported: webGpuSupported,
      f16Supported: this.f16Supported,
      engineReady: this.engine !== null,
      modelLoaded: this.currentModel || null,
      isInitializing: this.isInitializing,
      deviceMemoryGB: deviceMemory,
      hardwareConcurrency,
      lastError: this.lastError,
      canRunLocalLLM: webGpuSupported && this.f16Supported && deviceMemory >= 4,
      timestamp: Date.now(),
    };
  }

  /**
   * Returns health metrics.
   */
  getMetrics(): WebLLMHealthMetrics {
    return { ...this.metrics };
  }

  /**
   * Device-capability check ONLY: whether THIS DEVICE can run local LLM
   * inference at all (WebGPU surface present, adapter supports shader-f16,
   * and device memory is at least the 4 GB floor).
   *
   * Deliberately says NOTHING about whether a model is downloaded or the
   * engine is ready (see isModelLoaded()/getHealthStatus()), about network
   * connectivity, or about whether a specific generation request will
   * succeed. A `true` verdict does not mean a model is loaded; a `false`
   * verdict means every WebLLM entry point (init, generateText, warmup)
   * will refuse (including the opportunistic preload paths: warmup is a
   * CALLER that consults the verdict, not an entry point that bypasses it).
   *
   * Non-throwing by design: probe failures (e.g. requestAdapter rejecting)
   * surface as `false`. Callers that need the PRECISE reason as an error
   * should use assertCanRunLocalLLM() instead — it throws the
   * capability-specific message (no surface / no shader-f16 / low RAM) and
   * shares this method's verdict by construction.
   *
   * Caching: the WebGPU surface verdict is computed once per service
   * instance and cached for its lifetime (the RAM floor is read per call).
   * A GPU appearing after the first probe is not observed.
   */
  async canRunLocalLLM(): Promise<boolean> {
    const status = await this.getHealthStatus();
    return status.canRunLocalLLM;
  }

  /**
   * Initializes the WebLLM engine with the specified model.
   *
   * Safe to call repeatedly: an init for the already-loaded model is a
   * no-op (model-scoped idempotency in initializeInternal); a DIFFERENT
   * model id re-initializes.
   *
   * @param modelId - Model to load; defaults to the hardware-aware
   *   recommendation when omitted.
   * @param force - Skips ONLY the network-awareness gate (the cellular /
   *   save-data "Data Usage Warning" shown when the model is not cached —
   *   this is what the toast's "Download anyway" action calls). It NEVER
   *   bypasses the capability gates: assertCanRunLocalLLM() runs on every
   *   path, so a forced init on a device that cannot run local AI still
   *   fails closed with the capability error, and the pinned-model
   *   registry check applies with or without force.
   */
  async init(modelId?: string, force: boolean = false): Promise<void> {
    if (this.initializationPromise) {return this.initializationPromise;}
    let tracked: Promise<void>;
    const operation = this.initializeInternal(modelId, force);
    // eslint-disable-next-line prefer-const -- declared separately so the finally callback can close over it
    tracked = operation.finally(() => {
      if (this.initializationPromise === tracked) {
        this.initializationPromise = null;
      }
    });
    this.initializationPromise = tracked;
    return tracked;
  }

  private async initializeInternal(
    modelId?: string,
    force: boolean = false,
  ): Promise<void> {
    // Idempotent for the already-loaded model: a warmup that races an active
    // session (e.g. focus-triggered preload while the engine is in use) must
    // not tear down and reload a multi-GB model it already has. A DIFFERENT
    // model id still re-initializes (explicit user model change), and the
    // concurrent-call dedup below is unaffected.
    if (this.engine !== null && modelId === this.currentModel) {
      logger.debug(
        "[WebLLM] init skipped: requested model already loaded",
        { model: this.currentModel },
      );
      return;
    }
    // Idle-unload latch (checked BEFORE any resource acquisition, so a
    // refused opportunistic preload does not even touch the GPU resource
    // switch or bump metrics): after the TTL timer released the model, a
    // non-force init — which only warmup ever issues — must not re-acquire
    // a multi-GB engine the idle policy deliberately freed. The user's
    // explicit retry (init(force=true), the settings toast action) is the
    // only path that may reload, making re-acquisition always deliberate.
    if (this.unloadedByIdleTimer) {
      if (!force) {
        logger.info(
          "[WebLLM] init skipped: model was unloaded by the idle TTL " +
            "timer — opportunistic preload does not resurrect it",
        );
        throw new Error(
          "Local AI model was unloaded after 30 minutes of inactivity. " +
            "Reload it explicitly from the AI settings.",
        );
      }
      this.unloadedByIdleTimer = false;
    }
    if (this.isInitializing) {return;}
    this.isInitializing = true;
    this.metrics.initializationCount++;
    const startTime = Date.now();
    let initGeneration = this.lifecycleGeneration;

    try {
      // Do not initialize a new engine while the previous one is still
      // releasing GPU resources.
      if (this.unloadPromise) {
        await this.unloadPromise;
      }
      initGeneration = this.lifecycleGeneration;
      await resourceManager.switchToWebLLM();

      // Capability gate (shared with generateText and ProviderManager's
      // generation path so the messages can never drift): bail early with a
      // clear message before CreateMLCEngine can fail with an uncaptured GPU
      // error on devices that cannot run WebLLM (MLC models use q4f16
      // quantization, which requires shader-f16).
      await this.assertCanRunLocalLLM();

      const deviceMemory =
        getNavigatorExtensions().deviceMemory || 4;
      const recommendedModel = this.getRecommendedModel(deviceMemory);
      const modelToLoad = modelId || recommendedModel;

      // Network awareness and cost warning
      if (!force) {
        const { hasModelInCache } = await getMLC();
        const isCached = await hasModelInCache(modelToLoad);

        if (!isCached) {
          const conn = getNavigatorExtensions().connection;
          const isCellular =
            conn?.type === "cellular" || conn?.effectiveType?.includes("3g");
          const saveData = conn?.saveData;

          if (isCellular || saveData) {
            const { toast } = await import("sonner");
            toast.warning("Data Usage Warning", {
              description: `Downloading ${modelToLoad} may consume several GBs of data on your current connection.`,
              action: {
                label: "Download anyway",
                onClick: () => this.init(modelToLoad, true),
              },
              duration: 10000,
            });
            this.isInitializing = false;
            return;
          }
        }
      }

      logger.info(`[WebLLM] Initializing with model: ${modelToLoad}`);

      // Dynamically import MLC module
      const { CreateMLCEngine, prebuiltAppConfig } = await getMLC();

      // SECURITY: pin to the model registry shipped with the installed MLC
      // version (^0.2.82). This prevents a remote/compromised MLC registry
      // from injecting an arbitrary model or wasm runtime that would execute
      // in the app origin. We only allow models present in prebuiltAppConfig.
      const knownModels = (prebuiltAppConfig?.model_list || []).map(
        (m: { model_id: string }) => m.model_id,
      );
      if (!knownModels.includes(modelToLoad)) {
        throw new Error(
          `[WebLLM] Refusing to load unpinned model "${modelToLoad}". ` +
            `Only models from the pinned MLC registry are allowed.`,
        );
      }

      const createdEngine = await CreateMLCEngine(modelToLoad, {
        initProgressCallback: (progress) => {
          if (this.lifecycleGeneration !== initGeneration) {return;}
          if (this.progressCallback) {
            this.progressCallback(progress);
          }
          this.progressListeners.forEach((listener) => {
            try {
              listener(progress);
            } catch (err) {
              logger.warn("Error in WebLLM progress listener", {
                error: safeErrorForLog(err),
              });
            }
          });
          logger.info(
            `[WebLLM] Progress: ${progress.text} (${Math.round(progress.progress * 100)}%)`,
          );
        },
      });

      // An unload/reset may have happened while the model was downloading.
      // Never publish an engine created by that obsolete initialization.
      if (this.lifecycleGeneration !== initGeneration) {
        try {
          await createdEngine.unload();
        } catch (error) {
          logger.warn("[WebLLM] Error unloading obsolete engine", {
            error: safeErrorForLog(error),
          });
        }
        throw createAbortError("WebLLM initialization was invalidated");
      }
      this.engine = createdEngine;

      this.currentModel = modelToLoad;
      this.modelInstalledAt = Date.now();
      this.metrics.lastInitTime = Date.now() - startTime;
      this.lastError = null;
      logger.info(
        `[WebLLM] Initialized successfully in ${this.metrics.lastInitTime}ms`,
      );
      if (this.metrics.lastInitTime > this.INIT_BUDGET_MS) {
        logger.warn(
          `[WebLLM] Init took ${this.metrics.lastInitTime}ms — exceeds the ` +
            `60 s device budget (audit §4.3 item 5); slower model or device.`,
        );
      }
    } catch (error) {
      this.metrics.errorCount++;
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.lastError = errorMsg;
      logger.warn("[WebLLM] Initialization failed", { error: errorMsg });
      throw error;
    } finally {
      this.isInitializing = false;
      // Do not keep a TTL timer alive when initialization was declined or
      // failed before an engine exists. Preserve the timer only for a loaded
      // engine that can actually be unloaded.
      if (this.engine && this.lifecycleGeneration === initGeneration) {
        this.resetUnloadTimer();
      } else if (!this.engine) {
        this.clearUnloadTimer();
      }
    }
  }

  /**
   * Get recommended model based on device memory.
   */
  private getRecommendedModel(deviceMemoryGB: number): string {
    if (deviceMemoryGB >= 8) {
      return "Llama-3.1-8B-Instruct-q4f16_1-MLC";
    } else if (deviceMemoryGB >= 4) {
      return "Llama-3.2-3B-Instruct-q4f16_1-MLC";
    } else {
      return "Llama-3.2-1B-Instruct-q4f16_1-MLC";
    }
  }

  /**
   * Generates text using the loaded model.
   * @param signal - Optional AbortSignal to cancel in-flight generation
   *   (e.g. from a timeout). The task is dequeued and rejects with
   *   "AbortError" if the signal fires before execution starts. Once
   *   `engine.chat.completions.create()` has started, WebLLM exposes no
   *   cancellation handle for an in-progress GPU submission: abort rejects
   *   this caller promptly and invalidates its result, but the GPU inference
   *   itself may continue until the engine completes it.
   */
  async generateText(
    prompt: string,
    systemPrompt?: string,
    options?: WebLLMGenerateOptions,
    signal?: AbortSignal,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(createAbortError());
        return;
      }
      if (this.taskQueue.length >= this.MAX_TASK_QUEUE_SIZE) {
        reject(new Error("WebLLM generation queue is full"));
        return;
      }

      const requestGeneration = this.lifecycleGeneration;
      // eslint-disable-next-line prefer-const -- declared separately so onAbort can close over it
      let item!: WebLLMTask;
      const onAbort = () => {
        if (item.cancelled) {return;}
        item.cancelled = true;
        item.cleanup();
        reject(createAbortError());
      };
      item = {
        resolve,
        reject,
        cancelled: false,
        cleanup: () => {
          signal?.removeEventListener("abort", onAbort);
        },
        task: async () => {
          // Check abort and lifecycle before starting heavy inference work.
          if (
            item.cancelled ||
            signal?.aborted ||
            requestGeneration !== this.lifecycleGeneration
          ) {
            throw createAbortError();
          }
          // Capability guard (defense in depth): a caller that reaches
          // generateText without going through ProviderManager's generation
          // path still surfaces the precise capability error on unsupported
          // devices instead of the misleading "engine not initialized" state
          // error. Cached after the first probe, so ~free on capable devices.
          await this.assertCanRunLocalLLM();

          const engine = this.engine;
          if (!engine) {
            throw new Error(
              "WebLLM engine not initialized. Call init() first.",
            );
          }

          this.metrics.generationCount++;
          const startTime = Date.now();

          try {
            // IMPORTANT: Once this promise is handed to WebLLM, an already
            // submitted GPU inference cannot be interrupted through the
            // current WebLLM API. The caller's AbortSignal is still honored
            // below: its promise is rejected and the result is discarded, but
            // the underlying GPU work may run to completion.
            const messages: WebLLM.ChatCompletionMessageParam[] = [];
            if (systemPrompt) {
              messages.push({
                role: "system",
                content: systemPrompt,
              } as WebLLM.ChatCompletionSystemMessageParam);
            }
            messages.push({
              role: "user",
              content: buildSafeUserContent(prompt),
            } as WebLLM.ChatCompletionUserMessageParam);

            const response = await Promise.race([
              engine.chat.completions.create({
                messages,
                temperature: options?.temperature ?? 0.7,
                max_tokens: options?.max_tokens ?? 2048,
              }),
              new Promise<never>((_, reject) => {
                const timer = setTimeout(
                  () => reject(new Error("GPU inference timeout")),
                  GPU_INFERENCE_TIMEOUT_MS,
                );
                signal?.addEventListener("abort", () => clearTimeout(timer), { once: true });
              }),
            ]);
            if (
              signal?.aborted ||
              item.cancelled ||
              requestGeneration !== this.lifecycleGeneration
            ) {
              throw createAbortError();
            }

            const text = response.choices[0]?.message?.content || "";
            const generationTime = Date.now() - startTime;
            this.metrics.totalGenerationTime += generationTime;
            this.metrics.avgGenerationTime =
              this.metrics.totalGenerationTime / this.metrics.generationCount;

            // F1-D: measure the wall-clock time from model install to the
            // first successful summary (surfaced in the diagnostics panel).
            if (
              this.metrics.firstSummaryLatencyMs === null &&
              this.modelInstalledAt !== null
            ) {
              this.metrics.firstSummaryLatencyMs =
                Date.now() - this.modelInstalledAt;
            }

            this.resetUnloadTimer();
            return text;
          } catch (error) {
            this.metrics.errorCount++;
            const errorMsg =
              error instanceof Error ? error.message : String(error);
            this.lastError = errorMsg;
            logger.warn("[WebLLM] Generation failed", { error: errorMsg });

            // Check for GPU context loss or memory crash (OOM)
            const isContextLost =
              errorMsg.toLowerCase().includes("device lost") ||
              errorMsg.toLowerCase().includes("gpu connection lost") ||
              errorMsg.toLowerCase().includes("context lost") ||
              errorMsg.toLowerCase().includes("device has been lost") ||
              errorMsg.toLowerCase().includes("oom") ||
              errorMsg.toLowerCase().includes("out of memory");

            if (isContextLost) {
              logger.warn(
                "[WebLLM] WebGPU context loss or OOM detected. Forcing model unload for recovery...",
              );
              this.unload().catch((un) =>
                logger.warn("[WebLLM] Error unloading after context loss", {
                  error: safeErrorForLog(un),
                }),
              );
              throw new Error("WEBGPU_CONTEXT_LOST");
            }

            throw error;
          }
        },
      };
      if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) {
          onAbort();
          return;
        }
      }
      this.taskQueue.push(item);
      this.processQueue();
    });
  }

  /**
   * Unloads the model to free VRAM.
   */
  async unload(): Promise<void> {
    this.lifecycleGeneration++;
    this.clearUnloadTimer();

    // Reject queued work immediately. An already-running WebLLM call cannot
    // be force-cancelled by the engine API, but its result is invalidated by
    // lifecycleGeneration and will never be published to the caller.
    const queued = this.taskQueue.splice(0);
    for (const item of queued) {
      item.cancelled = true;
      item.cleanup();
      item.reject(createAbortError("WebLLM model unloaded"));
    }

    const engine = this.engine;
    this.engine = null;
    this.modelInstalledAt = null;
    // Reset the model name too: leaving it stale made getCurrentModel()
    // report a model that was no longer loaded ("current" must mean current).
    // Empty string = no model in memory; SupportDiagnostics coalesces this
    // to undefined and getHealthStatus() maps it to null.
    this.currentModel = "";
    this.metrics.firstSummaryLatencyMs = null;
    mlcModule = null;
    if (!engine) {return;}

    let tracked: Promise<void>;
    const operation = (async () => {
      try {
        await engine.unload();
      } catch (error) {
        logger.warn("[WebLLM] Error during unload", {
          error: safeErrorForLog(error),
        });
      } finally {
        logger.info("[WebLLM] Model unloaded");
      }
    })();
    // eslint-disable-next-line prefer-const -- declared separately so the finally callback can close over it
    tracked = operation.finally(() => {
      if (this.unloadPromise === tracked) {
        this.unloadPromise = null;
      }
    });
    this.unloadPromise = tracked;
    return tracked;
  }

  /**
   * Checks if a model is currently loaded.
   */
  isModelLoaded(): boolean {
    return this.engine !== null;
  }

  /**
   * Gets the currently loaded model ID.
   */
  getCurrentModel(): string {
    return this.currentModel;
  }
}

export const webLLMService = new WebLLMService();
