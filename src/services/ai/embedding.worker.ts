// Dynamic import: @huggingface/transformers (~23 MB ONNX WASM) is only loaded
// when the worker receives its first embedding request, not at app startup.
import type { FeatureExtractionPipeline } from "@huggingface/transformers";
// Integrity verification for downloaded model files: installs a verifying
// custom cache on the transformers env so every HF download is hashed against
// the pinned digest manifest (fail-closed in production).
import { configureModelIntegrity } from "../../utils/modelIntegrity";
import {
  EMBEDDING_MODEL_ID,
  EMBEDDING_MODEL_PIPELINE_OPTIONS,
} from "./embeddingModel";

let embedder: FeatureExtractionPipeline | null = null;
let initializationPromise: Promise<FeatureExtractionPipeline> | null = null;
const taskQueue: { text: string; id: string }[] = [];
let queuedTextCharacters = 0;
const MAX_QUEUE_SIZE = 100;
const MAX_TEXT_LENGTH = 1_000_000;
const MAX_QUEUED_TEXT_CHARACTERS = 8 * 1024 * 1024;
const INFERENCE_TIMEOUT_MS = 30_000;
const MODEL_INIT_TIMEOUT_MS = 120_000;
let isProcessing = false;
let workerFatal = false;

function isFatalTimeout(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.startsWith("Timeout: embedding inference exceeded") ||
      error.message.startsWith("Timeout: embedding model initialization exceeded"))
  );
}

function rejectQueuedTasks(error: string): void {
  while (taskQueue.length > 0) {
    const pending = taskQueue.shift()!;
    queuedTextCharacters -= pending.text.length;
    self.postMessage({
      id: pending.id,
      taskId: pending.id,
      error,
      fatal: true,
    });
  }
  queuedTextCharacters = Math.max(0, queuedTextCharacters);
}

function releaseInputText(data: unknown): void {
  if (typeof data !== "object" || data === null) {return;}
  const record = data as Record<string, unknown>;
  if (typeof record.text === "string") {
    record.text = "";
  }
  if (typeof record.payload === "string") {
    record.payload = "";
  }
}

function releaseEmbeddingOutput(
  output: { data: ArrayLike<number> } | undefined,
): void {
  const data = output?.data;
  if (
    ArrayBuffer.isView(data) &&
    "fill" in data &&
    typeof data.fill === "function"
  ) {
    (data as unknown as { fill(value: number): void }).fill(0);
  }
}

async function withTimeout<T>(
  operation: Promise<T>,
  label: string,
  timeoutMs = INFERENCE_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(`Timeout: ${label} exceeded ${timeoutMs}ms`),
        ),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function getEmbedder(currentTaskId?: string): Promise<FeatureExtractionPipeline> {
  if (embedder) {return embedder;}
  if (initializationPromise) {return initializationPromise;}

  const operation = (async (): Promise<FeatureExtractionPipeline> => {
    if (currentTaskId) {
      self.postMessage({
        taskId: currentTaskId,
        status: "loading",
        message: "Downloading embedding model (~23 MB)...",
      });
    }

    try {
      if (currentTaskId) {
        self.postMessage({
          taskId: currentTaskId,
          status: "loading",
          message: "Loading Transformers.js library...",
        });
      }

      const hf = await import("@huggingface/transformers");
      // env/pipeline are named exports — the module has no default export, so
      // the old (hf as any).default.env access would throw (undefined.env).
      const { pipeline, env } = hf;

      env.allowLocalModels = false;
      env.useBrowserCache = true;
      env.remoteHost = "https://huggingface.co";
      env.remotePathTemplate = "{model}/resolve/{revision}/";
      const backends = env.backends as Record<string, Record<string, { proxy: boolean }>> | undefined;
      if (backends?.onnx?.wasm) {backends.onnx.wasm.proxy = false;}
      // SECURITY (supply chain): every model download is verified against the
      // pinned SHA-256 manifest before it is cached or executed. Fail-closed.
      configureModelIntegrity(env);

      if (currentTaskId) {
        self.postMessage({
          taskId: currentTaskId,
          status: "loading",
          message: "Initializing AI model (first time may take a moment)...",
        });
      }

      embedder = await pipeline(
        "feature-extraction",
        EMBEDDING_MODEL_ID,
        { ...EMBEDDING_MODEL_PIPELINE_OPTIONS },
      );

      if (currentTaskId) {
        self.postMessage({ taskId: currentTaskId, status: "ready" });
      }
      return embedder;
    } catch (primaryError: unknown) {
      // Integrity failures are security failures, not backend capability
      // failures. Never retry them through an alternate pipeline because that
      // could bypass the pinned model verification path.
      const primaryMessage =
        primaryError instanceof Error ? primaryError.message : String(primaryError);
      if (/integrity|digest|manifest|hash/i.test(primaryMessage)) {
        throw primaryError instanceof Error
          ? primaryError
          : new Error("Embedding model integrity verification failed");
      }
      self.postMessage({
        taskId: currentTaskId,
        status: "warning",
        message: "WebGPU not supported, falling back to WASM backend",
      });
      if (currentTaskId) {
        self.postMessage({
          taskId: currentTaskId,
          status: "loading",
          message: "Falling back to WASM backend...",
        });
      }
      try {
        const { pipeline: fallbackPipeline } =
          await import("@huggingface/transformers");
        embedder = await fallbackPipeline(
          "feature-extraction",
          EMBEDDING_MODEL_ID,
          { ...EMBEDDING_MODEL_PIPELINE_OPTIONS },
        );
        if (currentTaskId) {
          self.postMessage({ taskId: currentTaskId, status: "ready" });
        }
        return embedder;
      } catch (fallbackError) {
        // Preserve the fallback failure because it is the operation that was
        // actually attempted after the primary backend failed. The shared
        // promise rejects all waiters instead of leaving polling intervals
        // alive forever.
        throw fallbackError instanceof Error
          ? fallbackError
          : primaryError instanceof Error
            ? primaryError
            : new Error(String(fallbackError));
      }
    }
  })();
  const timedOperation = withTimeout(
    operation,
    "embedding model initialization",
    MODEL_INIT_TIMEOUT_MS,
  );
  initializationPromise = timedOperation;
  // Keep the shared promise registered until the underlying initialization
  // settles. A timeout must not let the next queued task start a duplicate
  // 23 MB model download while the first attempt is still running.
  void operation.then(
    () => {
      if (initializationPromise === timedOperation) {
        initializationPromise = null;
      }
    },
    () => {
      if (initializationPromise === timedOperation) {
        initializationPromise = null;
      }
    },
  );
  return timedOperation;
}

async function processQueue() {
  if (isProcessing || taskQueue.length === 0) {return;}

  isProcessing = true;
  try {
    while (taskQueue.length > 0) {
      const { text, id } = taskQueue.shift()!;
      try {
        const generateEmbedding = (await getEmbedder(
          id,
        )) as FeatureExtractionPipeline;
        let output: { data: ArrayLike<number> } | undefined;
        try {
          output = (await withTimeout(
            generateEmbedding(text, {
              pooling: "mean",
              normalize: true,
            }),
            "embedding inference",
          )) as { data: ArrayLike<number> };

          const embedding = Array.from(output.data);
          self.postMessage({
            id,
            embedding,
            taskId: id,
            result: embedding,
          });
        } finally {
          // `embedding` is an independent JS array. Release the model's typed
          // output buffer immediately after postMessage to avoid retaining a
          // second copy during the next queued inference.
          releaseEmbeddingOutput(output);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const fatal = isFatalTimeout(error);
        self.postMessage({
          id,
          error: message,
          taskId: id,
          ...(fatal ? { fatal: true } : {}),
        });
        if (fatal) {
          // Promise.race cannot cancel the underlying model call. Poison this
          // worker and drain local work instead of starting more model work
          // concurrently with the timed-out operation. WorkerPool will retire
          // the worker after receiving this fatal response.
          workerFatal = true;
          rejectQueuedTasks(
            message.startsWith("Timeout: embedding model initialization")
              ? "Embedding worker stopped after model initialization timeout"
              : "Embedding worker stopped after inference timeout",
          );
          break;
        }
      } finally {
        queuedTextCharacters -= text.length;
      }
    }
  } finally {
    isProcessing = false;
  }
}

self.onmessage = async (e) => {
  if (workerFatal) {
    const data = e.data as Record<string, unknown>;
    const failedTaskId = data.taskId ?? data.id ?? "unknown";
    releaseInputText(data);
    self.postMessage({
      id: failedTaskId,
      taskId: failedTaskId,
      error: "Embedding worker unavailable after inference timeout",
      fatal: true,
    });
    return;
  }

  const { text, id, taskId, type, payload } = e.data;
  // Release any caller-owned text references before model initialization. The
  // prefetch task intentionally has no text payload and only warms the model.
  releaseInputText(e.data);
  const actualId =
    taskId ||
    id ||
    `task_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;

  if (type === "prefetch") {
    try {
      await getEmbedder(actualId);
      self.postMessage({ taskId: actualId, result: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const fatal = isFatalTimeout(error);
      if (fatal) {workerFatal = true;}
      self.postMessage({
        taskId: actualId,
        error: message,
        ...(fatal ? { fatal: true } : {}),
      });
    }
    return;
  }

  const actualText = payload || text || "";
  if (typeof actualText !== "string") {
    self.postMessage({ taskId: actualId, error: "Embedding payload must be text" });
    return;
  }
  if (actualText.length > MAX_TEXT_LENGTH) {
    self.postMessage({
      taskId: actualId,
      error: `Embedding text exceeds ${MAX_TEXT_LENGTH} characters`,
    });
    return;
  }
  if (
    taskQueue.length >= MAX_QUEUE_SIZE ||
    queuedTextCharacters + actualText.length > MAX_QUEUED_TEXT_CHARACTERS
  ) {
    self.postMessage({
      taskId: actualId,
      error:
        taskQueue.length >= MAX_QUEUE_SIZE
          ? "Embedding worker queue is full"
          : "Embedding worker queued text memory limit exceeded",
    });
    return;
  }
  taskQueue.push({ text: actualText, id: actualId });
  queuedTextCharacters += actualText.length;
  processQueue();
};
