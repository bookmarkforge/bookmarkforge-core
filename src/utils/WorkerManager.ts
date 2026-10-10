/**
 * WorkerManager — generic lifecycle manager for single-Worker services
 * Extracts duplicated logic from WebLLMService, RAGEngine, VectorIndexService (P1-3)
 *
 * Features:
 *  - lifecycleGeneration bump to invalidate in-flight operations after terminate
 *  - bounded pending queue with MAX_PENDING
 *  - per-request timeout (default 30s) with worker retire on timeout
 *  - abort via AbortSignal
 *  - doubleZero integration for password buffers is caller responsibility
 */

import { logger } from "./logger";

export interface WorkerManagerOptions {
  maxPending?: number;
  timeoutMs?: number;
  workerUrl: string | URL;
  name: string;
}

type PendingEntry<T> = {
  id: string;
  resolve: (v: T) => void;
  reject: (e: Error) => void;
  timer?: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  onAbort?: () => void;
};

export class WorkerManager<Req = unknown, Res = unknown> {
  private worker: Worker | null = null;
  private generation = 0;
  private pending = new Map<string, PendingEntry<Res>>();
  private readonly maxPending: number;
  private readonly timeoutMs: number;
  private readonly workerUrl: string | URL;
  private readonly name: string;

  constructor(opts: WorkerManagerOptions) {
    this.workerUrl = opts.workerUrl;
    this.name = opts.name;
    this.maxPending = opts.maxPending ?? 100;
    this.timeoutMs = opts.timeoutMs ?? 30000;
  }

  get lifecycleGeneration(): number { return this.generation; }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(this.workerUrl, { type: "module" });
    w.onmessage = (e) => this.handleMessage(e);
    w.onerror = (e) => this.handleError(e);
    this.worker = w;
    return w;
  }

  private handleMessage(e: MessageEvent): void {
    const { id, result, error } = e.data ?? {};
    if (!id) return;
    const entry = this.pending.get(id);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    if (entry.signal && entry.onAbort) entry.signal.removeEventListener("abort", entry.onAbort);
    this.pending.delete(id);
    if (error) entry.reject(new Error(error));
    else entry.resolve(result as Res);
  }

  private handleError(e: ErrorEvent): void {
    logger.error(`[WorkerManager:${this.name}] worker error`, { error: e.message });
    // Reject all pending with fatal and retire worker
    const err = new Error(`Worker ${this.name} error: ${e.message}`);
    for (const [, p] of this.pending) {
      if (p.timer) clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
    this.terminateWorker();
  }

  private terminateWorker(): void {
    if (this.worker) {
      try { this.worker.terminate(); } catch { /* INTENTIONAL SILENCE: terminating an already-dead worker is idempotent. */ }
      this.worker = null;
    }
    this.generation++;
  }

  async enqueue(
    type: string,
    payload: Req,
    opts?: { signal?: AbortSignal; transferables?: Transferable[] }
  ): Promise<Res> {
    if (this.pending.size >= this.maxPending) {
      throw new Error(`Worker ${this.name} queue full (${this.maxPending})`);
    }
    const worker = this.ensureWorker();
    const id = crypto.randomUUID();
    return new Promise<Res>((resolve, reject) => {
      const entry: PendingEntry<Res> = { id, resolve, reject, signal: opts?.signal };
      // timeout
      entry.timer = setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        const err = new Error(`Worker ${this.name} timeout for ${type}`);
        reject(err);
        // retire hung worker
        this.terminateWorker();
      }, this.timeoutMs);

      const onAbort = () => {
        if (this.pending.has(id)) {
          if (entry.timer) clearTimeout(entry.timer);
          this.pending.delete(id);
          reject(new DOMException("Aborted", "AbortError"));
          // retire to avoid overlap
          const w = this.worker;
          if (w) this.terminateWorker();
        }
      };
      entry.onAbort = onAbort;
      if (opts?.signal) {
        if (opts.signal.aborted) { onAbort(); return; }
        opts.signal.addEventListener("abort", onAbort, { once: true });
      }

      this.pending.set(id, entry);
      try {
        worker.postMessage({ id, type, payload }, opts?.transferables ?? []);
      } catch (err) {
        if (entry.timer) clearTimeout(entry.timer);
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  terminate(): void {
    for (const [, p] of this.pending) {
      if (p.timer) clearTimeout(p.timer);
      p.reject(new Error(`Worker ${this.name} terminated`));
    }
    this.pending.clear();
    this.terminateWorker();
  }

  /** For callers that need to invalidate without terminating (bump generation) */
  invalidate(): void {
    this.generation++;
    for (const [, p] of this.pending) {
      if (p.timer) clearTimeout(p.timer);
      p.reject(new Error(`Worker ${this.name} invalidated`));
    }
    this.pending.clear();
  }
}
