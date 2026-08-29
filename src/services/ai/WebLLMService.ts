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
  private currentModel = "Llama-3.2-1B-Instruct-q4f16_1-MLC";
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
      modelLoaded: this.currentModel,
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

  async canRunLocalLLM(): Promise<boolean> {
    const status = await this.getHealthStatus();
    return status.canRunLocalLLM;
  }

  /**
   * Initializes the WebLLM engine with the specified model.
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

      const webGpuSupported = await this.isWebGPUSupported();
      if (!webGpuSupported) {
        throw new Error("WebGPU is not supported in this browser");
      }

      // MLC models use q4f16 quantization which requires shader-f16.
      // If the adapter lacks it, CreateMLCEngine will fail with an
      // uncaptured GPU error. Bail early with a clear message.
      if (!this.f16Supported) {
        throw new Error(
          "WebGPU adapter does not support shader-f16 (half-precision). " +
            "Local AI models require a GPU with f16 support. " +
            "Use a cloud provider (Gemini, OpenAI, etc.) instead.",
        );
      }

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

            const response = await engine.chat.completions.create({
              messages,
              temperature: options?.temperature ?? 0.7,
              max_tokens: options?.max_tokens ?? 2048,
            });
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
