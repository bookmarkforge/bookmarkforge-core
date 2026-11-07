/**
 * WorkerPool - Manages a pool of Web Workers for parallel processing
 * Improves performance by reusing workers instead of creating/destroying them
 */

import { logger } from "./logger";

// Bound both queued and active tasks so bursty callers cannot retain an
// unbounded number of payloads, transferables, timers, and promise closures.
const MAX_OUTSTANDING_TASKS = 256;

function createAbortError(): Error {
  const error = new Error("Worker task aborted");
  error.name = "AbortError";
  return error;
}

export type ProgressCallback = (
  taskId: string,
  status: string,
  message?: string,
  progress?: number,
) => void;

interface WorkerTask<T = unknown> {
  id: string;
  type: string;
  payload: T;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  transferables?: Transferable[];
  onProgress?: ProgressCallback;
}

interface PooledWorker {
  worker: Worker;
  busy: boolean;
  id: number;
  currentTaskId?: string;
}

export class WorkerPool {
  private workers: PooledWorker[] = [];
  private pendingQueue: WorkerTask[] = [];
  private activeTasks: Map<string, WorkerTask> = new Map();
  private workerScript: string | URL;
  private maxWorkers: number;
  private taskCounter = 0;
  private workerIdCounter = 0;
  private maxRetries: number;
  private retryCount = new Map<string, number>();
  private terminated = false;

  constructor(
    workerScript: string | URL,
    maxWorkers?: number,
    maxRetries: number = 2,
  ) {
    this.workerScript = workerScript;
    const detectedWorkers =
      typeof navigator !== "undefined" && navigator.hardwareConcurrency
        ? navigator.hardwareConcurrency
        : 4;
    const requestedWorkers = maxWorkers ?? detectedWorkers;
    this.maxWorkers = Math.max(1, Math.min(Math.floor(requestedWorkers) || 1, 8));
    this.maxRetries = Math.max(0, Math.floor(maxRetries) || 0);
    for (let i = 0; i < this.maxWorkers; i++) {
      this.createWorker(this.workerIdCounter++);
    }
  }

  /**
   * Terminate a worker (hung or dead) and replace it with a fresh one,
   * keeping the pool at full capacity. Safe no-op if the id is unknown.
   */
  private retireWorker(id: number): void {
    const target = this.workers.find((w) => w.id === id);
    if (!target) return;
    try {
      target.worker.terminate();
    } catch {
      /* INTENTIONAL SILENCE: retiring an already-dead worker is idempotent. */
    }
    this.workers = this.workers.filter((w) => w.id !== id);
    if (this.terminated) {
      return;
    }
    try {
      this.createWorker(this.workerIdCounter++);
    } catch (e) {
      // Never throw from here: callers (onerror/timeout) rely on this
      // returning so the pool keeps processing and promises settle.
      logger.warn("WorkerPool failed to replace worker", {
        id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  private createWorker(id: number): PooledWorker {
    const worker = new Worker(this.workerScript, { type: "module" });
    const pooledWorker: PooledWorker = { worker, busy: false, id };

    worker.onmessage = (e) => {
      const { taskId, result, error, status, message, progress, fatal } = e.data;

      // Progress/status messages don't complete the task
      if (status && result === undefined && error === undefined) {
        const task =
          this.activeTasks.get(taskId) ??
          this.pendingQueue.find((t) => t.id === taskId);
        if (task?.onProgress) {
          try {
            task.onProgress(taskId, status, message, progress);
          } catch (progressError) {
            // A consumer callback must never break the worker event handler or
            // leave the worker marked busy forever.
            logger.warn("WorkerPool progress callback failed", {
              taskId,
              error:
                progressError instanceof Error
                  ? progressError.message
                  : String(progressError),
            });
          }
        }
        return;
      }

      const task = this.activeTasks.get(taskId);

      // Ignore stale/unknown replies. In particular, never free a worker for
      // an unrelated taskId: doing so could dispatch a second task while the
      // real task is still running.
      if (!task || pooledWorker.currentTaskId !== taskId) {
        return;
      }

      this.retryCount.delete(taskId);
      if (error) {
        task.reject(new Error(error));
      } else {
        task.resolve(result);
      }
      this.activeTasks.delete(taskId);

      if (fatal === true) {
        // A fatal reply means the worker may still hold an uninterruptible
        // operation (for example a timed-out model inference). Retire it
        // before dispatching another task; merely marking it idle would allow
        // work to overlap with the poisoned operation.
        pooledWorker.busy = false;
        pooledWorker.currentTaskId = undefined;
        this.retireWorker(pooledWorker.id);
        this.processQueue();
        return;
      }

      pooledWorker.busy = false;
      pooledWorker.currentTaskId = undefined;
      this.processQueue();
    };

    worker.onerror = (error) => {
      logger.warn("WorkerPool worker error", {
        workerId: id,
        error: typeof error.message === "string" ? error.message : String(error),
      });
      const currentTaskId = pooledWorker.currentTaskId;
      const pendingTask = currentTaskId
        ? this.activeTasks.get(currentTaskId)
        : null;

      if (pendingTask) {
        const attempts = (this.retryCount.get(currentTaskId!) ?? 0) + 1;
        if (attempts <= this.maxRetries) {
          this.retryCount.set(currentTaskId!, attempts);
          logger.info("WorkerPool retrying task", {
            taskId: currentTaskId,
            attempt: attempts,
          });
          // Re-queue the task for a fresh worker attempt
          this.activeTasks.delete(currentTaskId!);
          this.pendingQueue.unshift(pendingTask);
        } else {
          this.retryCount.delete(currentTaskId!);
          pendingTask.reject(
            new Error(`Worker ${id} failed after ${attempts} attempts: ${error.message}`),
          );
          this.activeTasks.delete(currentTaskId!);
        }
      }

      // Terminate and replace the dead worker. retireWorker already removed
      // `pooledWorker` from this.workers, so its flags no longer matter.
      this.retireWorker(id);
      this.processQueue();
    };

    this.workers.push(pooledWorker);
    return pooledWorker;
  }

  private processQueue(): void {
    if (this.pendingQueue.length === 0) {return;}

    // Find or create an available worker
    let worker = this.workers.find((w) => !w.busy);
    if (!worker && this.workers.length < this.maxWorkers) {
      worker = this.createWorker(this.workerIdCounter++);
    }
    if (!worker) {return;}

    const task = this.pendingQueue.shift();
    if (!task) {return;}

    worker.busy = true;
    worker.currentTaskId = task.id;
    this.activeTasks.set(task.id, task);

    try {
      worker.worker.postMessage(
        {
          taskId: task.id,
          type: task.type,
          payload: task.payload,
        },
        task.transferables || [],
      );
    } catch (error) {
      // DataCloneError/terminated-worker failures are synchronous. Settle the
      // task and free the worker immediately instead of waiting 60 seconds.
      this.activeTasks.delete(task.id);
      worker.busy = false;
      worker.currentTaskId = undefined;
      this.retryCount.delete(task.id);
      task.reject(error instanceof Error ? error : new Error(String(error)));
      this.processQueue();
    }
  }

  execute<T, R>(
    type: string,
    payload: T,
    transferables?: Transferable[],
    onProgress?: ProgressCallback,
    signal?: AbortSignal,
  ): Promise<R> {
    if (this.terminated) {
      return Promise.reject(new Error("WorkerPool terminated"));
    }
    if (signal?.aborted) {
      return Promise.reject(createAbortError());
    }
    if (
      this.activeTasks.size + this.pendingQueue.length >=
      MAX_OUTSTANDING_TASKS
    ) {
      const capacityError = new Error(
        `WorkerPool queue capacity exceeded (${MAX_OUTSTANDING_TASKS} tasks)`,
      );
      capacityError.name = "WorkerPoolCapacityError";
      return Promise.reject(capacityError);
    }
    return new Promise((resolve, reject) => {
      const id = `task-${++this.taskCounter}-${Date.now()}`;
      // eslint-disable-next-line prefer-const -- assigned after callbacks close over the task
      let task!: WorkerTask<T>;
      // Safety net: never leave the caller promise hanging if the worker
      // dies or replies with an unknown taskId.
      const timeout = setTimeout(() => {
        // Settle the promise FIRST: the whole point of this safety net is
        // that the caller's promise never hangs, regardless of what the
        // cleanup below does.
        if (this.activeTasks.has(id)) {
          this.activeTasks.delete(id);
          task.reject(new Error(`Worker task ${id} timed out`));
          // Dispatched but never answered: the worker is hung. Retire it so
          // the pool doesn't deadlock with a permanently-busy worker.
          const hung = this.workers.find((w) => w.currentTaskId === id);
          if (hung) this.retireWorker(hung.id);
          this.processQueue();
        } else {
          // Never dispatched (all workers hung): drop it from the queue so
          // the caller's promise can't hang forever behind dead workers.
          const idx = this.pendingQueue.findIndex((t) => t.id === id);
          if (idx >= 0) {
            this.pendingQueue.splice(idx, 1);
            task.reject(new Error(`Worker task ${id} timed out while queued`));
          }
        }
      }, 60000);
      const cleanup = () => {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", onAbort);
      };
      const onAbort = () => {
        const active = this.activeTasks.get(id);
        if (active) {
          this.activeTasks.delete(id);
          task.reject(createAbortError());
          // Workers have no portable way to cancel an arbitrary async
          // operation. Retire the worker so the aborted task cannot continue
          // holding user text or block the queue.
          const running = this.workers.find((w) => w.currentTaskId === id);
          if (running) {this.retireWorker(running.id);}
          this.processQueue();
          return;
        }
        const queuedIndex = this.pendingQueue.findIndex((item) => item.id === id);
        if (queuedIndex >= 0) {
          this.pendingQueue.splice(queuedIndex, 1);
          task.reject(createAbortError());
          this.processQueue();
        }
      };
      task = {
        id,
        type,
        payload,
        resolve: (value: unknown) => {
          cleanup();
          resolve(value as R);
        },
        reject: (error: Error) => {
          cleanup();
          reject(error);
        },
        transferables,
        onProgress,
      };

      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) {
        task.reject(createAbortError());
        return;
      }
      this.pendingQueue.push(task);
      this.processQueue();
    });
  }

  isTerminated(): boolean {
    return this.terminated;
  }

  terminate(): void {
    this.terminated = true;
    this.workers.forEach(({ worker }) => worker.terminate());
    this.workers = [];
    const err = new Error("WorkerPool terminated");
    for (const task of this.pendingQueue) {
      task.reject(err);
    }
    this.pendingQueue = [];
    for (const task of this.activeTasks.values()) {
      task.reject(err);
    }
    this.activeTasks.clear();
    this.retryCount.clear();
  }

  getStats(): { workers: number; busy: number; queue: number } {
    return {
      workers: this.workers.length,
      busy: this.workers.filter((w) => w.busy).length,
      queue: this.pendingQueue.length,
    };
  }
}

// Singleton instances for different worker types
const workerPools = new Map<string, WorkerPool>();

export function getWorkerPool(
  name: string,
  workerScript: string | URL,
  maxWorkers?: number,
): WorkerPool {
  const existing = workerPools.get(name);
  if (existing?.isTerminated()) {
    workerPools.delete(name);
  }
  if (!workerPools.has(name)) {
    workerPools.set(name, new WorkerPool(workerScript, maxWorkers));
  }
  return workerPools.get(name)!;
}

export function terminateAllWorkers(): void {
  workerPools.forEach((pool) => pool.terminate());
  workerPools.clear();
}

// Cleanup on page hide
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    terminateAllWorkers();
  });
}
