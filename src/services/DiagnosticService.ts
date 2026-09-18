import { aiManager } from "./ai/ProviderManager";
import { logger, redactSecrets } from "../utils/logger";
import {
  getCollection,
  getNavigatorExtensions,
  getNavigatorGPU,
} from "../utils/browser-types";
import {
  isDBInitialized,
  getDB,
  getDBInitDurationMs,
  getDBInitAttempts,
} from "../db/database";
import { cloudSyncService } from "./integrations/cloudSync";
import { getBuildHash } from "../utils/bundleIntegrity";
import { vectorIndexService } from "./ai/VectorIndexService";
import { loadWebLLMService } from "./pro-access";
// ADR-052 Phase 1: local-only exposure counter for the v5 sunset (ADR-053's
// registry will extend it when that lands).
import {
  reportVaultSaltInventory,
  reportVaultSecretFormatExposure,
} from "./security-vault/kdf-salt";

export interface SystemDiagnostics {
  db: {
    initialized: boolean;
    initDurationMs: number | null;
    initAttempts: number | null;
    queryLatency: {
      bookmarkCountMs: number | null;
      vectorCountMs: number | null;
      sampleReadMs: number | null;
    };
    size: number; // Estimated in bytes
    bookmarkCount: number;
    vectorCount: number;
    vectorIndexStatus: string;
    vectorIndexLoadDurationMs: number | null;
  };
  ai: {
    provider: string;
    model: string;
    cacheStats: {
      size: number;
      maxSize: number;
      ttl: number;
    };
    ollamaAvailable: boolean;
    webLlmStatus: string;
    webLlmFirstSummaryLatencyMs: number | null;
    webGpuSupported: boolean;
    webGpuAdapter: string | null;
  };
  environment: {
    onLine: boolean;
    batteryLevel: number | null;
    charging: boolean | null;
    memoryLimit?: number;
    cores: number;
    userAgent: string;
    isARM64: boolean;
  };
  performance: {
    upTime: number;
    lastError: string | null;
    buildHash: string;
  };
  sync: {
    providers: Record<string, unknown>;
  };
  /** ADR-052 Phase 1: residual legacy-v5 secret corpus (local-only). */
  vaultCrypto: {
    /** "ok" = every secret was read and classified; "unknown" = storage unreadable. */
    status: "ok" | "unknown";
    inspected: number;
    legacyV5: number;
    saltedV6: number;
  };
  /** ADR-053 Phase B — unified per-salt inventory (one entry per registry descriptor). */
  salts?: Array<{
    purpose: "master-kdf" | "db-key-kdf";
    governance: string;
    rotatesWithPassword: boolean;
    provisioned: boolean;
    corpus?: { legacyV5: number; saltedV6: number; legacyKeys: string[] };
  }>;
}

class DiagnosticService {
  private startTime: number = Date.now();
  private lastError: string | null = null;
  private monitorInterval: ReturnType<typeof setInterval> | null = null;
  private auditTimer: ReturnType<typeof setTimeout> | null = null;
  private errorHandler: ((event: ErrorEvent) => void) | null = null;
  private pageLeaveHandler: (() => void) | null = null;

  constructor() {
    this.errorHandler = (event: ErrorEvent) => {
      this.lastError = redactSecrets(event.message);
      // Use warn (not error) to avoid recursive logging if
      // ObservabilityHub has monkeypatched logger.error.
      logger.warn("[DiagnosticService] Runtime Error Detected", {
        error: redactSecrets(event.message),
        stack: event.error?.stack,
      });
    };
    if (typeof window === "undefined") {return;}
    window.addEventListener("error", this.errorHandler);

    // Start proactive monitoring
    this.startMonitoring();

    // Auto-cleanup on page unload to avoid interval leaks in long-lived PWAs.
    this.pageLeaveHandler = () => this.destroy();
    window.addEventListener("pagehide", this.pageLeaveHandler, { once: true });
  }

  destroy(): void {
    if (typeof window !== "undefined" && this.errorHandler) {
      window.removeEventListener("error", this.errorHandler);
      this.errorHandler = null;
    }
    if (typeof window !== "undefined" && this.pageLeaveHandler) {
      window.removeEventListener("pagehide", this.pageLeaveHandler);
      this.pageLeaveHandler = null;
    }
    if (this.auditTimer) {
      clearTimeout(this.auditTimer);
      this.auditTimer = null;
    }
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
  }

  private startMonitoring() {
    if (this.monitorInterval) {return;}

    // Perform initial check after a short delay to not block startup.
    this.auditTimer = setTimeout(() => {
      this.auditTimer = null;
      this.performSilentAudit().catch((error: unknown) => {
        logger.warn("[DiagnosticService] Initial silent audit failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, 5000);

    // Periodic checks every 2 minutes
    this.monitorInterval = setInterval(() => {
      this.performSilentAudit().catch((error: unknown) => {
        logger.warn("[DiagnosticService] Periodic silent audit failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, 120_000);
  }

  private async performSilentAudit() {
    const diagnostics = await this.getDiagnostics();
    const insights: string[] = [];

    // 1. Check for Hardware/Software Mismatches
    if (!diagnostics.ai.webGpuSupported && diagnostics.environment.cores >= 8) {
      insights.push(
        "High-end CPU detected but WebGPU is unavailable. Suggest checking browser flags or native ARM64 version.",
      );
    }

    // 2. Memory Pressure Check
    if (
      diagnostics.environment.memoryLimit &&
      diagnostics.environment.memoryLimit < 4
    ) {
      insights.push(
        `Low device memory (${diagnostics.environment.memoryLimit}GB). Performance may be degraded.`,
      );
    }

    // 3. Database Health
    if (!diagnostics.db.initialized) {
      insights.push("Database failed to initialize properly.");
    }

    if (insights.length > 0) {
      logger.warn("System Health Audit Insights", { insights });
      // We could also trigger a toast here if in development mode
      if (import.meta.env.DEV) {
        logger.debug("[DiagnosticService] Health insights", { insights });
      }
    }
  }

  async getDiagnostics(): Promise<SystemDiagnostics> {
    const db = await getDB();
    let bookmarkCount = 0;
    let vectorCount = 0;
    let bookmarkCountMs: number | null = null;
    let vectorCountMs: number | null = null;
    let sampleReadMs: number | null = null;

    if (db) {
      try {
        let queryStartedAt = performance.now();
        bookmarkCount = db.bookmarks ? await db.bookmarks.count().exec() : 0;
        bookmarkCountMs = Math.round(performance.now() - queryStartedAt);

        // Vectors are owned by VectorIndexService (an in-memory WebWorker),
        // not by an RxDB collection named "vectorIndex". vectorCount is
        // reported as 0 because no such collection exists in the schema; the
        // real index state is reported by vectorIndexService.getLoadStatus()
        // below.
        queryStartedAt = performance.now();
        const vectorIndex = getCollection(db, "vectorIndex") as
          | { count: () => { exec: () => Promise<number> } }
          | undefined;
        vectorCount = vectorIndex
          ? await vectorIndex.count().exec()
          : 0;
        vectorCountMs = Math.round(performance.now() - queryStartedAt);

        // A bounded materialization query complements count() timings with
        // the read path used by list views, without loading the whole vault.
        const bookmarksWithFind = db.bookmarks as unknown as {
          find?: (query: { limit: number }) => {
            exec: () => Promise<unknown>;
          };
        };
        if (typeof bookmarksWithFind.find === "function") {
          queryStartedAt = performance.now();
          await bookmarksWithFind.find({ limit: 10 }).exec();
          sampleReadMs = Math.round(performance.now() - queryStartedAt);
        }
      } catch (e: unknown) {
        logger.error("Failed to get DB counts for diagnostics", {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    const aiInfo = aiManager.getProviderInfo();
    const cacheStats = aiManager.getCacheStats();
    const ollamaAvailable = await aiManager.isOllamaAvailable();

    // Derive the WebLLM status from the service's REAL health (engine
    // readiness + device capability) instead of hardcoding "Ready" — a
    // hardcoded value promised more than the diagnostics data verified.
    // The ladder is mutually exclusive and ordered: a transient
    // "Initializing" beats the blocker check, a hard capability blocker
    // beats a stale lastError (the init failed BECAUSE the device cannot
    // run local AI), and a probe failure reports "Unknown" — never a lie.
    let webLlmStatus = "Not initialized";
    try {
      // Gated resolution: without Pro the service never loads and the
      // diagnostics honestly report the engine as not initialized.
      const webLLMService = await loadWebLLMService();
      const webLlmHealth = await webLLMService.getHealthStatus();
      webLlmStatus = webLlmHealth.isInitializing
        ? "Initializing"
        : !webLlmHealth.canRunLocalLLM
          ? "Device not capable"
          : webLlmHealth.engineReady
            ? "Ready"
            : webLlmHealth.lastError
              ? "Initialization failed"
              : "Not initialized";
    } catch (e: unknown) {
      logger.warn(
        "WebLLM health probe failed in diagnostics",
        e instanceof Error ? e.message : String(e),
      );
      webLlmStatus = "Unknown";
    }

    let webGpuAdapter: string | null = null;
    let webGpuSupported = false;
    if ("gpu" in navigator) {
      try {
        const adapter = await getNavigatorGPU()?.requestAdapter({
          powerPreference: "high-performance",
        });
        if (adapter) {
          webGpuSupported = true;
          const info = await adapter.requestAdapterInfo();
          webGpuAdapter = `${info.vendor} - ${info.architecture} (${info.description})`;
        }
      } catch (e: unknown) {
        logger.warn(
          "WebGPU detection failed in diagnostics",
          e instanceof Error ? e.message : String(e),
        );
      }
    }

    const isARM64 =
      /arm64|aarch64/i.test(navigator.userAgent) ||
      navigator.platform?.toLowerCase().includes("arm");

    let batteryLevel: number | null = null;
    let charging: boolean | null = null;
    if ("getBattery" in navigator) {
      try {
        const battery = await getNavigatorExtensions().getBattery?.();
        batteryLevel = battery?.level ?? null;
        charging = battery?.charging ?? null;
      } catch (e) {
        logger.warn(
          "Battery detection failed in diagnostics",
          e instanceof Error ? e.message : String(e),
        );
      }
    }

    // ADR-052 Phase 1: local-only v5 exposure report. Fail-soft: an error
    // here must never break diagnostics; "unknown" is honest (zero would
    // falsely signal a fully migrated vault).
    const vaultCrypto = await reportVaultSecretFormatExposure().catch(
      (error: unknown): SystemDiagnostics["vaultCrypto"] => {
        logger.warn("[DiagnosticService] Vault crypto exposure report failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        return { status: "unknown", inspected: 0, legacyV5: 0, saltedV6: 0 };
      },
    );

    // ADR-053 Phase B: unified per-salt inventory from the registry. Fail-
    // soft like the exposure report — diagnostics never break on it.
    const salts = await reportVaultSaltInventory().catch(
      (error: unknown): SystemDiagnostics["salts"] => {
        logger.warn("[DiagnosticService] Vault salt inventory failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        return undefined;
      },
    );

    return {
      db: {
        initialized: isDBInitialized(),
        initDurationMs: getDBInitDurationMs(),
        initAttempts: getDBInitAttempts(),
        queryLatency: {
          bookmarkCountMs,
          vectorCountMs,
          sampleReadMs,
        },
        size: 0,
        bookmarkCount,
        vectorCount,
        vectorIndexStatus: vectorIndexService.getLoadStatus(),
        vectorIndexLoadDurationMs: vectorIndexService.getLoadDurationMs(),
      },
      ai: {
        provider: aiInfo.provider,
        model: aiInfo.model,
        cacheStats,
        ollamaAvailable,
        webLlmStatus,
        webLlmFirstSummaryLatencyMs:
          (await loadWebLLMService()
            .then((s) => s.getMetrics().firstSummaryLatencyMs)
            .catch(() => null)) ?? null,
        webGpuSupported,
        webGpuAdapter,
      },
      environment: {
        onLine: navigator.onLine,
        batteryLevel,
        charging,
        memoryLimit: getNavigatorExtensions().deviceMemory,
        cores: navigator.hardwareConcurrency || 1,
        userAgent: navigator.userAgent,
        isARM64,
      },
      performance: {
        upTime: Math.floor((Date.now() - this.startTime) / 1000),
        lastError: this.lastError,
        buildHash: getBuildHash() || "dev",
      },
      sync: {
        providers: cloudSyncService.getSyncMetrics(),
      },
      vaultCrypto: {
        status: vaultCrypto.status,
        inspected: vaultCrypto.inspected,
        legacyV5: vaultCrypto.legacyV5,
        saltedV6: vaultCrypto.saltedV6,
      },
      ...(salts !== undefined ? { salts } : {}),
    };
  }
}

export const diagnosticService = new DiagnosticService();
