import { getDB } from "../../db/database";
import { logRateLimited } from "../../utils/boundedLog";
import { logger } from "../../utils/logger";
import { loadWebLLMService } from "../pro-access";

// Experimental API declarations
interface MemoryPressureRecord {
  state: "critical" | "moderate";
  time: number;
}

interface MemoryPressureObserverConstructor {
  new (callback: (records: MemoryPressureRecord[]) => void): {
    observe(): void;
    disconnect(): void;
  };
}

interface PerformanceWithMemory extends Performance {
  memory?: {
    usedJSHeapSize: number;
    jsHeapSizeLimit: number;
    totalJSHeapSize: number;
  };
}

interface NavigatorWithDeviceMemory extends Navigator {
  deviceMemory?: number;
}

/**
 * Measures the byte size of a cached Response WITHOUT materializing the
 * whole body into memory. Model files cached by transformers.js can be
 * hundreds of MB — calling response.blob() just to read blob.size would
 * spike the JS heap in the very service that exists to prevent OOM.
 *
 * Strategy (cheapest first):
 *  1. Content-Length header when present (O(1), zero body read).
 *  2. Stream the body through a reader, counting bytes chunk by chunk
 *     (constant memory — never holds the whole file at once).
 *  3. Fall back to blob() only when the body is not readable.
 */
async function measureCachedResponseSize(response: Response): Promise<number> {
  const contentLength = response.headers.get("content-length");
  const headerSize = contentLength ? Number(contentLength) : NaN;
  if (Number.isFinite(headerSize) && headerSize >= 0) {
    return headerSize;
  }

  const body = response.body;
  if (body && typeof body.getReader === "function") {
    const reader = body.getReader();
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {break;}
        total += value ? value.byteLength : 0;
      }
    } finally {
      reader.releaseLock();
    }
    return total;
  }

  const blob = await response.blob();
  return blob.size;
}

/**
 * ResourceManager - Coordinates memory usage between heavy AI components
 * to prevent OOM (Out Of Memory) crashes on mobile/low-RAM devices.
 */
class ResourceManager {
  private activeComponent: "webllm" | "rag" | null = null;
  private memoryCheckInterval: ReturnType<typeof setInterval> | null = null;
  private isLeaderTab = false;
  private leaderChannel: BroadcastChannel | null = null;
  private memoryPressureObserver: { disconnect(): void } | null = null;
  private pageLeaveHandler: (() => void) | null = null;
  // The interval and the experimental observer can report the same critical
  // pressure event concurrently. Share one in-flight recovery so model unload
  // and RxDB cleanup are never performed twice under peak memory pressure.
  private criticalPressurePromise: Promise<void> | null = null;

  private electionTimer: ReturnType<typeof setTimeout> | null = null;
  private leaderId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  constructor() {
    // Start monitoring immediately (backward-compatible: tests expect
    // setInterval in constructor). Leader election runs in parallel; the
    // non-leader tab cancels its interval within 200ms.
    this.startMonitoringIfWindow();
  }

  private startMonitoringIfWindow(): void {
    if (typeof window === "undefined") {return;}
    // Always stop any existing interval before starting a new one —
    // prevents multiple concurrent intervals when electLeader re-enters
    // after a leader-leaving message.
    this.stop();
    this.startMemoryMonitoring();
    this.electLeader();
  }

  /**
   * Leader-tab election via BroadcastChannel (Fase 3). Only ONE tab keeps
   * the memory check interval long-term — without this, every tab runs
   * setInterval(30s) and triggers RxDB cleanup simultaneously on shared
   * IndexedDB, causing I/O thrash.
   *
   * The election runs in parallel with startMemoryMonitoring(); the losing
   * tab cancels its interval after the election resolves.
   */
  private electLeader(): void {
    // Clear any pending election timer from a previous election round
    // (e.g. after a "leader-leaving" message triggers re-entry).
    if (this.electionTimer) {
      clearTimeout(this.electionTimer);
      this.electionTimer = null;
    }

    if (this.pageLeaveHandler) {
      window.removeEventListener("pagehide", this.pageLeaveHandler);
      window.removeEventListener("beforeunload", this.pageLeaveHandler);
      this.pageLeaveHandler = null;
    }
    this.leaderChannel?.close();

    try {
      this.leaderChannel = new BroadcastChannel("bmf-resource-leader");
    } catch (e: unknown) {
      // BroadcastChannel unavailable (private mode / unsupported browser):
      // degrade to leader-tab behavior so memory monitoring still runs.
      logRateLimited(
        "warn",
        "ResourceManager:leader-channel",
        "BroadcastChannel unavailable, falling back to leader tab",
        { error: e instanceof Error ? e.message : String(e) },
      );
      this.isLeaderTab = true;
      return;
    }

    const candidateId = this.leaderId;
    let sawOtherLeader = false;

    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === "leader-claim" && e.data?.id !== candidateId) {
        if (e.data.id > candidateId) {
          sawOtherLeader = true;
        }
      }
      if (e.data?.type === "leader-leaving" && sawOtherLeader) {
        this.leaderChannel?.close();
        this.startMonitoringIfWindow();
      }
    };
    this.leaderChannel.addEventListener("message", onMessage);
    this.leaderChannel.postMessage({ type: "leader-claim", id: candidateId });

    this.electionTimer = setTimeout(() => {
      this.electionTimer = null;
      if (sawOtherLeader && !this.isLeaderTab) {
        logger.info(
          "[ResourceManager] Another tab is the leader — stopping memory monitoring",
        );
        // Keep the election channel and page lifecycle listeners alive. A
        // losing tab must hear the leader-leaving message to re-elect itself;
        // calling stop() here would close the channel and make recovery
        // impossible until a full reload.
        this.stopMemoryMonitoring();
      } else {
        this.isLeaderTab = true;
        logger.info(
          "[ResourceManager] Elected as leader tab for memory monitoring",
        );
      }
    }, 200);

    const onLeave = () => {
      if (this.isLeaderTab) {
        try {
          this.leaderChannel?.postMessage({ type: "leader-leaving" });
        } catch (e: unknown) {
          // Expected when stop() closed the channel first; logged (rate-
          // limited) so an unexpected close storm is not completely silent.
          logRateLimited(
            "warn",
            "ResourceManager:leader-leaving-post",
            "Failed to post leader-leaving message",
            { error: e instanceof Error ? e.message : String(e) },
          );
        }
      }
      this.stop();
      if (this.electionTimer) {
        clearTimeout(this.electionTimer);
        this.electionTimer = null;
      }
      window.removeEventListener("pagehide", onLeave);
      window.removeEventListener("beforeunload", onLeave);
      this.pageLeaveHandler = null;
      this.leaderChannel?.close();
    };
    this.pageLeaveHandler = onLeave;
    window.addEventListener("pagehide", onLeave, { once: true });
    window.addEventListener("beforeunload", onLeave, { once: true });
  }

  /** Stops only the memory observer/interval, retaining the election channel. */
  private stopMemoryMonitoring(): void {
    if (this.memoryCheckInterval) {
      clearInterval(this.memoryCheckInterval);
      this.memoryCheckInterval = null;
    }
    this.memoryPressureObserver?.disconnect();
    this.memoryPressureObserver = null;
  }

  /**
   * Starts monitoring memory pressure and usage (only called on leader tab).
   */
  private startMemoryMonitoring() {
    if (typeof window === "undefined") {return;}

    this.stopMemoryMonitoring();

    const Win = window as unknown as {
      MemoryPressureObserver?: MemoryPressureObserverConstructor;
    };
    if (Win.MemoryPressureObserver) {
      try {
        const observer = new Win.MemoryPressureObserver((records) => {
          const lastRecord = records[records.length - 1]!;
          logger.warn("[ResourceManager] Memory pressure detected", {
            state: lastRecord.state,
          });
          this.handleMemoryPressure(
            lastRecord.state === "critical" ? "critical" : "moderate",
          ).catch((error: unknown) => {
            logger.warn("[ResourceManager] Memory pressure cleanup failed", {
              error: error instanceof Error ? error.message : String(error),
            });
          });
        });
        observer.observe();
        this.memoryPressureObserver = observer;
      } catch (e: unknown) {
        logger.warn(
          "[ResourceManager] Failed to initialize MemoryPressureObserver",
          { error: e instanceof Error ? e.message : String(e) },
        );
      }
    }

    // Fallback: periodic check of JS heap (Chromium only). Now runs only
    // on the leader tab.
    this.memoryCheckInterval = setInterval(() => {
      this.checkJSHeap().catch((error: unknown) => {
        logger.warn("[ResourceManager] Periodic memory check failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, 30000); // Every 30 seconds
  }

  stop(): void {
    this.stopMemoryMonitoring();

    // Stopping monitoring must also release the cross-tab election resources.
    // Otherwise a losing tab keeps a BroadcastChannel and page lifecycle
    // listeners alive indefinitely after its interval has been cancelled.
    if (this.electionTimer) {
      clearTimeout(this.electionTimer);
      this.electionTimer = null;
    }
    if (this.pageLeaveHandler && typeof window !== "undefined") {
      window.removeEventListener("pagehide", this.pageLeaveHandler);
      window.removeEventListener("beforeunload", this.pageLeaveHandler);
      this.pageLeaveHandler = null;
    }
    this.leaderChannel?.close();
    this.leaderChannel = null;
    this.isLeaderTab = false;
  }

  /**
   * Checks JS heap usage and triggers cleanup if too high.
   */
  private async checkJSHeap() {
    const memory = (performance as PerformanceWithMemory).memory;
    if (!memory) {return;}

    const used = memory.usedJSHeapSize;
    const limit = memory.jsHeapSizeLimit;
    const usageRatio = used / limit;

    if (usageRatio > 0.85) {
      logger.warn("[ResourceManager] Critical memory usage detected", {
        usage: `${(usageRatio * 100).toFixed(1)}%`,
      });
      await this.handleMemoryPressure("critical");
    } else if (usageRatio > 0.7) {
      logger.warn("[ResourceManager] Moderate memory usage detected", {
        usage: `${(usageRatio * 100).toFixed(1)}%`,
      });
      await this.handleMemoryPressure("moderate");
    }
  }

  /**
   * Handles memory pressure by unloading heavy components.
   */
  private handleMemoryPressure(level: "moderate" | "critical"): Promise<void> {
    if (level === "critical") {
      if (this.criticalPressurePromise) {
        return this.criticalPressurePromise;
      }
      const operation = this.handleMemoryPressureInternal(level);
      const tracked = operation.finally(() => {
        this.criticalPressurePromise = null;
      });
      this.criticalPressurePromise = tracked;
      return tracked;
    }
    return this.handleMemoryPressureInternal(level);
  }

  private async handleMemoryPressureInternal(
    level: "moderate" | "critical",
  ): Promise<void> {
    if (level === "critical") {
      logger.info(
        "[ResourceManager] Critical pressure: Unloading all AI engines and clearing RxDB cache",
      );
      // Gated: without Pro there is no local engine to unload — the promise
      // rejects and cleanup continues with the (Core) embedding engine.
      await loadWebLLMService()
        .then((s) => s.unload())
        .catch(() => undefined);
      const { ragEngine } = await import("./RAGEngine");
      await ragEngine.unload();

      // Cleanup RxDB
      // Iterate db.collections dynamically (no hardcoded list) so any
      // collection added to COLLECTIONS is covered automatically.
      // Capability-check each collection: cleanup() is an RxDB method that
      // depends on the cleanup plugin being registered — never cast blindly.
      const dbInstance = await getDB();
      if (dbInstance) {
        const collections = dbInstance.collections as unknown as Record<
          string,
          { name: string; cleanup?: () => Promise<unknown> }
        >;
        for (const collection of Object.values(collections)) {
          const cleanupFn = collection.cleanup;
          if (typeof cleanupFn !== "function") {
            logger.warn("[ResourceManager] Skipped collection without cleanup()", {
              collection: collection.name,
            });
            continue;
          }
          try {
            await cleanupFn.call(collection);
          } catch (e: unknown) {
            logger.warn("[ResourceManager] Failed to cleanup collection", {
              collection: collection.name,
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }
      }

      this.activeComponent = null;
    } else if (level === "moderate") {
      logger.info(
        "[ResourceManager] Moderate pressure: Unloading inactive AI engines",
      );
      if (this.activeComponent === "webllm") {
        const { ragEngine } = await import("./RAGEngine");
        await ragEngine.unload();
      } else if (this.activeComponent === "rag") {
        await loadWebLLMService()
          .then((s) => s.unload())
          .catch(() => undefined);
      }
    }
  }

  /**
   * Checks if the device has enough memory to run heavy models.
   */
  private isLowEndDevice(): boolean {
    const memory = (navigator as NavigatorWithDeviceMemory).deviceMemory || 4;
    const cores = navigator.hardwareConcurrency || 4;
    return memory < 8 || cores < 4;
  }

  /**
   * RAM/CPU-only device tier check (>= 8GB RAM and >= 4 cores).
   *
   * Deliberately NOT a WebGPU/WebLLM capability test: it knows nothing about
   * GPU availability or shader-f16 support, so it reports true even on a
   * GPU-less machine as long as the RAM/CPU tier qualifies. Treat it as a
   * coarse pre-filter; pair it with webLLMService.canRunLocalLLM() before
   * actually running WebLLM.
   */
  isHighEndDevice(): boolean {
    return !this.isLowEndDevice();
  }

  async switchToWebLLM() {
    if (this.activeComponent === "webllm") {return;}

    // Defensive capability gate (fail-closed, mirrors WebLLMService's
    // assertCanRunLocalLLM surface check): a device without a WebGPU surface
    // must never acquire GPU resources — the RAG unload below and the
    // exclusive-component flag flip would both be wasted work forcing the
    // next RAG user through its own unload cycle. The cheap surface check
    // (no adapter request) is deliberate: the full probe (adapter + f16 +
    // RAM) is initializeInternal's assertCanRunLocalLLM, which runs right
    // after this on every real init path. Deliberately NOT applied to
    // switchToRAG — RAG embeddings do not require WebGPU.
    const gpu = (
      navigator as NavigatorWithDeviceMemory & { gpu?: unknown }
    ).gpu;
    if (!gpu) {
      logger.warn(
        "[ResourceManager] WebLLM switch refused: no WebGPU surface in this browser",
      );
      throw new Error("WebGPU is not supported in this browser");
    }

    const memory = (navigator as NavigatorWithDeviceMemory).deviceMemory || 4;
    if (memory <= 8) {
      logger.info(
        "[ResourceManager] Enforcing strict mutual exclusion. Unloading RAG engine...",
      );
      const { ragEngine } = await import("./RAGEngine");
      await ragEngine.unload();

      // Cooldown timer to allow Garbage Collector to clean up VRAM
      logger.info("[ResourceManager] Waiting for GC cooldown (2000ms)...");
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    this.activeComponent = "webllm";
  }

  async switchToRAG() {
    if (this.activeComponent === "rag") {return;}

    const memory = (navigator as NavigatorWithDeviceMemory).deviceMemory || 4;
    if (memory <= 8) {
      logger.info(
        "[ResourceManager] Enforcing strict mutual exclusion. Unloading WebLLM engine...",
      );
      // Gated: without Pro there is no local engine to unload.
      await loadWebLLMService()
        .then((s) => s.unload())
        .catch(() => undefined);

      // Cooldown timer to allow Garbage Collector to clean up VRAM
      logger.info("[ResourceManager] Waiting for GC cooldown (2000ms)...");
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    this.activeComponent = "rag";
  }

  /**
   * Gets the status of models stored in the browser cache.
   */
  async getHFModelStatus() {
    if (typeof window === "undefined" || !("caches" in window)) {return [];}

    try {
      const cacheNames = await caches.keys();
      const hfCaches = cacheNames.filter((name) =>
        name.includes("transformers-cache"),
      );

      const status = [];
      for (const name of hfCaches) {
        const cache = await caches.open(name);
        const requests = await cache.keys();
        let totalSize = 0;

        for (const request of requests) {
          const response = await cache.match(request);
          if (!response) {continue;}
          try {
            // In practice transformers.js cache entries are fetched over HTTP
            // with Content-Length present, so the O(1) header path dominates;
            // the stream fallback only runs when the header is absent.
            totalSize += await measureCachedResponseSize(response);
          } catch (e: unknown) {
            // One unreadable entry must not wipe out the whole status report.
            logger.warn("[ResourceManager] Failed to measure cached model entry", {
              cache: name,
              url: request.url,
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }

        status.push({
          name: name,
          size: totalSize,
          count: requests.length,
        });
      }
      return status;
    } catch (e: unknown) {
      logger.error("[ResourceManager] Error getting model status", {
        error: e instanceof Error ? e.message : String(e),
      });
      return [];
    }
  }

  /**
   * Deletes a specific model cache.
   */
  async deleteHFModel(cacheName: string) {
    if (typeof window === "undefined" || !("caches" in window)) {return false;}
    try {
      return await caches.delete(cacheName);
    } catch (e: unknown) {
      logger.error("[ResourceManager] Error deleting model", {
        cacheName,
        error: e instanceof Error ? e.message : String(e),
      });
      return false;
    }
  }
}

export const resourceManager = new ResourceManager();
