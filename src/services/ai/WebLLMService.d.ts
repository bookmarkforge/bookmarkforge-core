/* Open Core placeholder: generated type surface of the proprietary module
   `src/services/ai/WebLLMService.ts`. No implementation is present in this repository. */
interface WebLLMGenerateOptions {
    temperature?: number;
    max_tokens?: number;
    isPrivate?: boolean;
    tools?: unknown[];
    complexity?: "simple" | "complex";
}
export type WebLLMCapabilityBlocker = "webgpu-unavailable" | "shader-f16-unsupported" | "insufficient-memory";
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
    firstSummaryLatencyMs: number | null;
}
export declare class WebLLMService {
    private engine;
    private isInitializing;
    private currentModel;
    progressCallback: ((progress: {
        text: string;
        progress: number;
    }) => void) | null;
    private progressListeners;
    onProgress(listener: (progress: {
        text: string;
        progress: number;
    }) => void): () => void;
    private webGpuSupported;
    private f16Supported;
    private unloadTimer;
    private readonly TTL_MS;
    private unloadedByIdleTimer;
    private readonly INIT_BUDGET_MS;
    private taskQueue;
    private readonly MAX_TASK_QUEUE_SIZE;
    private isProcessingQueue;
    private initializationPromise;
    private unloadPromise;
    private lifecycleGeneration;
    private processQueue;
    private metrics;
    private lastError;
    private modelInstalledAt;
    private resetUnloadTimer;
    private clearUnloadTimer;
    isWebGPUSupported(): Promise<boolean>;
    assertCanRunLocalLLM(): Promise<void>;
    getCapabilityBlocker(): Promise<WebLLMCapabilityBlocker | null>;
    getHealthStatus(): Promise<WebLLMHealthStatus>;
    getMetrics(): WebLLMHealthMetrics;
    canRunLocalLLM(): Promise<boolean>;
    init(modelId?: string, force?: boolean): Promise<void>;
    private initializeInternal;
    private getRecommendedModel;
    generateText(prompt: string, systemPrompt?: string, options?: WebLLMGenerateOptions, signal?: AbortSignal): Promise<string>;
    unload(): Promise<void>;
    isModelLoaded(): boolean;
    getCurrentModel(): string;
}
export declare const webLLMService: WebLLMService;
export {};
