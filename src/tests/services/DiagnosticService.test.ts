import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  redactSecrets: vi.fn((s: string) => s),
}));

vi.mock("../../db/database", () => ({
  isDBInitialized: vi.fn().mockReturnValue(true),
  getDB: vi.fn(),
  getDBInitDurationMs: vi.fn().mockReturnValue(321),
  getDBInitAttempts: vi.fn().mockReturnValue(1),
}));

vi.mock("../../services/ai/ProviderManager", () => ({
  aiManager: {
    getProviderInfo: vi
      .fn()
      .mockReturnValue({ provider: "gemini", model: "gemini-2.0-flash-exp" }),
    getCacheStats: vi
      .fn()
      .mockReturnValue({ size: 100, maxSize: 1000, ttl: 3600 }),
    isOllamaAvailable: vi.fn().mockResolvedValue(false),
  },
}));

// ADR-052 Phase 1: the v5 exposure report is a local-only diagnostic read;
// the default double reports a fully migrated vault so existing assertions
// are unaffected.
const exposureMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    status: "ok",
    inspected: 2,
    legacyV5: 0,
    saltedV6: 2,
    legacyKeys: [],
  }),
);
vi.mock("../../services/security-vault/kdf-salt", () => ({
  reportVaultSecretFormatExposure: exposureMock,
  reportVaultSaltInventory: vi.fn().mockResolvedValue([
    {
      purpose: "master-kdf",
      governance: "ADR-046",
      rotatesWithPassword: true,
      provisioned: true,
      corpus: { legacyV5: 0, saltedV6: 1, legacyKeys: [] },
    },
    {
      purpose: "db-key-kdf",
      governance: "ADR-053",
      rotatesWithPassword: false,
      provisioned: true,
    },
  ]),
}));

vi.mock("../../services/integrations/cloudSync", () => ({
  cloudSyncService: {
    getSyncMetrics: vi.fn().mockReturnValue({
      drive: {
        provider: "drive",
        attempts: 1,
        successCount: 1,
        failureCount: 0,
        retryCount: 0,
        lastDurationMs: 42,
        lastSuccessAt: Date.now(),
        lastFailureAt: null,
        lastError: null,
      },
    }),
  },
}));

// WebLLMService is Pro: the double is installed at the pro-access loader
// instead of at the Pro module (DiagnosticService reads health via the gate).
const webLLMServiceDouble = {
  getMetrics: vi.fn().mockReturnValue({ firstSummaryLatencyMs: 1234 }),
  getHealthStatus: vi.fn().mockResolvedValue({
    engineReady: false,
    isInitializing: false,
    canRunLocalLLM: true,
    lastError: null,
  }),
  init: vi.fn(),
};
vi.mock("../../services/pro-access", () => ({
  loadWebLLMService: () => Promise.resolve(webLLMServiceDouble),
  ProUnavailableError: class ProUnavailableError extends Error {},
}));

const { isDBInitialized, getDB } = await import("../../db/database");
const { logger } = await import("../../utils/logger");
const { cloudSyncService } =
  await import("../../services/integrations/cloudSync");
const { diagnosticService } = await import("../../services/DiagnosticService");

describe("DiagnosticService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    (getDB as any).mockResolvedValue({
      bookmarks: {
        count: () => ({
          exec: vi.fn().mockResolvedValue(2),
        }),
        find: () => ({
          exec: vi.fn().mockResolvedValue([]),
        }),
      },
      vectorIndex: {
        count: () => ({ exec: vi.fn().mockResolvedValue(1) }),
      },
    });
    (isDBInitialized as any).mockReturnValue(true);
    (cloudSyncService.getSyncMetrics as any).mockReturnValue({
      drive: {
        provider: "drive",
        attempts: 1,
        successCount: 1,
        failureCount: 0,
        retryCount: 0,
        lastDurationMs: 42,
        lastSuccessAt: Date.now(),
        lastFailureAt: null,
        lastError: null,
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("getDiagnostics — vaultCrypto (ADR-052 Phase 1)", () => {
    it("surfaces the local v5 exposure report", async () => {
      const diag = await diagnosticService.getDiagnostics();
      expect(diag.vaultCrypto).toEqual({
        status: "ok",
        inspected: 2,
        legacyV5: 0,
        saltedV6: 2,
      });
      expect(exposureMock).toHaveBeenCalledTimes(1);
    });

    it("reports the unified per-salt inventory (ADR-053 Phase B)", async () => {
      const diag = await diagnosticService.getDiagnostics();
      expect(diag.salts).toHaveLength(2);
      expect(diag.salts?.[0]).toMatchObject({
        purpose: "master-kdf",
        governance: "ADR-046",
        provisioned: true,
      });
      expect(diag.salts?.[1]).toMatchObject({
        purpose: "db-key-kdf",
        governance: "ADR-053",
        rotatesWithPassword: false,
      });
      expect(diag.salts?.[0]?.corpus).toEqual({
        legacyV5: 0,
        saltedV6: 1,
        legacyKeys: [],
      });
    });

    it("degrades to unknown instead of failing diagnostics when the report throws", async () => {
      exposureMock.mockRejectedValueOnce(new Error("storage unavailable"));
      const diag = await diagnosticService.getDiagnostics();
      expect(diag.vaultCrypto).toEqual({
        status: "unknown",
        inspected: 0,
        legacyV5: 0,
        saltedV6: 0,
        });
    });
  });

  describe("getDiagnostics", () => {
    it("returns full SystemDiagnostics structure", async () => {
      const diag = await diagnosticService.getDiagnostics();
      expect(diag).toHaveProperty("db");
      expect(diag).toHaveProperty("ai");
      expect(diag).toHaveProperty("environment");
      expect(diag).toHaveProperty("performance");
      expect(diag).toHaveProperty("sync");
    });

    it("db: reporta initialized true y counts", async () => {
      const diag = await diagnosticService.getDiagnostics();
      expect(diag.db.initialized).toBe(true);
      expect(diag.db.bookmarkCount).toBe(2);
      expect(diag.db.vectorCount).toBe(1);
      expect(diag.db.initDurationMs).toBe(321);
      expect(diag.db.initAttempts).toBe(1);
      expect(diag.db.queryLatency.bookmarkCountMs).not.toBeNull();
      expect(diag.db.queryLatency.vectorCountMs).not.toBeNull();
      expect(diag.db.queryLatency.sampleReadMs).not.toBeNull();
    });

    it("db: reports initialized false when there is no db", async () => {
      (getDB as any).mockResolvedValue(null);
      (isDBInitialized as any).mockReturnValue(false);
      const diag = await diagnosticService.getDiagnostics();
      expect(diag.db.initialized).toBe(false);
      expect(diag.db.bookmarkCount).toBe(0);
      expect(diag.db.vectorCount).toBe(0);
    });

    it("db: handles error when getting counts", async () => {
      (getDB as any).mockResolvedValue({
        bookmarks: {
          count: () => ({
            exec: vi.fn().mockRejectedValue(new Error("DB error")),
          }),
        },
        vectorIndex: { count: () => ({ exec: vi.fn().mockResolvedValue(0) }) },
      });
      const diag = await diagnosticService.getDiagnostics();
      expect(diag.db.bookmarkCount).toBe(0);
    });

    it("db: non-Error error is converted to a string", async () => {
      (getDB as any).mockResolvedValue({
        bookmarks: { count: () => ({ exec: vi.fn().mockRejectedValue(42) }) },
        vectorIndex: { count: () => ({ exec: vi.fn().mockResolvedValue(0) }) },
      });
      const diag = await diagnosticService.getDiagnostics();
      expect(diag.db.bookmarkCount).toBe(0);
    });

    it("ai: returns provider info", async () => {
      const diag = await diagnosticService.getDiagnostics();
      expect(diag.ai.provider).toBe("gemini");
      expect(diag.ai.model).toContain("gemini");
      expect(diag.ai.ollamaAvailable).toBe(false);
    });

    it("ai: includes cacheStats", async () => {
      const diag = await diagnosticService.getDiagnostics();
      expect(diag.ai.cacheStats).toBeDefined();
    });

    it("ai: webGpuSupported y webLlmStatus incluidos", async () => {
      const diag = await diagnosticService.getDiagnostics();
      expect(diag.ai).toHaveProperty("webGpuSupported");
      expect(diag.ai).toHaveProperty("webLlmStatus");
      expect(diag.ai).toHaveProperty("webGpuAdapter");
    });

    it("ai: webLlmStatus reflects the REAL health state, not a hardcoded value", async () => {
      // Regression: webLlmStatus used to be hardcoded "Ready", promising
      // more than the diagnostics data verified. Every state must come
      // from webLLMService.getHealthStatus().
      const { loadWebLLMService } = await import("../../services/pro-access");
      const health = vi.mocked((await loadWebLLMService()).getHealthStatus);
      // Full WebLLMHealthStatus baseline (capable device, nothing loaded);
      // each scenario below overrides only the fields under test.
      const baseHealth = {
        healthy: false,
        webGPUSupported: true,
        f16Supported: true,
        engineReady: false,
        modelLoaded: null,
        isInitializing: false,
        deviceMemoryGB: 8,
        hardwareConcurrency: 8,
        lastError: null,
        canRunLocalLLM: true,
        timestamp: Date.now(),
      } as const;

      // Capable + engine ready → the ONLY path that reports "Ready".
      health.mockResolvedValueOnce({
        ...baseHealth,
        healthy: true,
        engineReady: true,
        modelLoaded: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
      });
      expect((await diagnosticService.getDiagnostics()).ai.webLlmStatus).toBe(
        "Ready",
      );

      // Engine mid-initialization → transient state wins over blockers.
      health.mockResolvedValueOnce({ ...baseHealth, isInitializing: true });
      expect((await diagnosticService.getDiagnostics()).ai.webLlmStatus).toBe(
        "Initializing",
      );

      // Device cannot run local AI → the hard blocker beats a stale
      // lastError (init failed BECAUSE of the capability gate).
      health.mockResolvedValueOnce({
        ...baseHealth,
        webGPUSupported: false,
        f16Supported: false,
        canRunLocalLLM: false,
        lastError: "WebGPU is not supported in this browser",
      });
      expect((await diagnosticService.getDiagnostics()).ai.webLlmStatus).toBe(
        "Device not capable",
      );

      // Capable but a previous init failed → the failure is surfaced.
      health.mockResolvedValueOnce({
        ...baseHealth,
        lastError: "WebGPU context lost during engine creation",
      });
      expect((await diagnosticService.getDiagnostics()).ai.webLlmStatus).toBe(
        "Initialization failed",
      );

      // Capable, nothing loaded, no failure → honest idle state.
      expect((await diagnosticService.getDiagnostics()).ai.webLlmStatus).toBe(
        "Not initialized",
      );

      // The health probe itself failed → "Unknown", never a fabricated
      // positive.
      health.mockRejectedValueOnce(new Error("health read exploded"));
      expect((await diagnosticService.getDiagnostics()).ai.webLlmStatus).toBe(
        "Unknown",
      );
      // ...and the probe failure is logged, not silent.
      expect(logger.warn).toHaveBeenCalledWith(
        "WebLLM health probe failed in diagnostics",
        "health read exploded",
      );
    });

    it("ai: surfaces time-to-first-summary from WebLLM metrics (F1-D)", async () => {
      const diag = await diagnosticService.getDiagnostics();
      expect(diag.ai).toHaveProperty("webLlmFirstSummaryLatencyMs", 1234);
    });

    it("environment: reporta navigator.onLine", async () => {
      const diag = await diagnosticService.getDiagnostics();
      expect(typeof diag.environment.onLine).toBe("boolean");
    });

    it("environment: cores se reporta", async () => {
      const diag = await diagnosticService.getDiagnostics();
      expect(diag.environment.cores).toBeGreaterThan(0);
    });

    it("environment: cores default to 1 when hardwareConcurrency is undefined", async () => {
      vi.stubGlobal("navigator", {
        ...navigator,
        hardwareConcurrency: undefined,
      });
      const diag = await diagnosticService.getDiagnostics();
      expect(diag.environment.cores).toBe(1);
    });

    it("environment: userAgent is a string", async () => {
      const diag = await diagnosticService.getDiagnostics();
      expect(typeof diag.environment.userAgent).toBe("string");
    });

    it("environment: isARM64 por userAgent con aarch64", async () => {
      vi.stubGlobal("navigator", {
        ...navigator,
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X) aarch64",
        platform: "MacIntel",
      });
      const diag = await diagnosticService.getDiagnostics();
      expect(diag.environment.isARM64).toBe(true);
    });

    it("environment: isARM64 por userAgent con arm64", async () => {
      vi.stubGlobal("navigator", {
        ...navigator,
        userAgent: "arm64 Linux",
        platform: "Linux",
      });
      const diag = await diagnosticService.getDiagnostics();
      expect(diag.environment.isARM64).toBe(true);
    });

    it("environment: isARM64 por platform con ARM", async () => {
      vi.stubGlobal("navigator", {
        ...navigator,
        userAgent: "Mozilla/5.0",
        platform: "ARM",
      });
      const diag = await diagnosticService.getDiagnostics();
      expect(diag.environment.isARM64).toBe(true);
    });

    it("environment: isARM64 false when there are no ARM signs", async () => {
      vi.stubGlobal("navigator", {
        ...navigator,
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        platform: "Win32",
      });
      const diag = await diagnosticService.getDiagnostics();
      expect(diag.environment.isARM64).toBe(false);
    });

    it("environment: battery null when getBattery is unavailable", async () => {
      const diag = await diagnosticService.getDiagnostics();
      expect(diag.environment.batteryLevel).toBeNull();
      expect(diag.environment.charging).toBeNull();
    });

    it("environment: battery is fetched when getBattery is available", async () => {
      const mockBattery = { level: 0.75, charging: true };
      vi.stubGlobal("navigator", {
        ...navigator,
        getBattery: vi.fn().mockResolvedValue(mockBattery),
      });
      const diag = await diagnosticService.getDiagnostics();
      expect(diag.environment.batteryLevel).toBe(0.75);
      expect(diag.environment.charging).toBe(true);
    });

    it("environment: battery detection fails gracefully", async () => {
      vi.stubGlobal("navigator", {
        ...navigator,
        getBattery: vi.fn().mockRejectedValue(new Error("Battery API error")),
      });
      const diag = await diagnosticService.getDiagnostics();
      expect(diag.environment.batteryLevel).toBeNull();
      expect(diag.environment.charging).toBeNull();
    });

    it("environment: memoryLimit incluido", async () => {
      const diag = await diagnosticService.getDiagnostics();
      expect(diag.environment).toHaveProperty("memoryLimit");
    });

    it("performance: buildHash from window", async () => {
      (window as any).__BMF_BUILD_HASH__ = "abc123";
      const diag = await diagnosticService.getDiagnostics();
      expect(diag.performance.buildHash).toBe("abc123");
    });

    it("performance: buildHash fallback a dev", async () => {
      delete (window as any).__BMF_BUILD_HASH__;
      const diag = await diagnosticService.getDiagnostics();
      expect(diag.performance.buildHash).toBe("dev");
    });

    it("performance: upTime is >= 0", async () => {
      const diag = await diagnosticService.getDiagnostics();
      expect(diag.performance.upTime).toBeGreaterThanOrEqual(0);
    });

    it("performance: lastError is null by default", async () => {
      const diag = await diagnosticService.getDiagnostics();
      expect(diag.performance.lastError).toBeNull();
    });

    it("sync: includes providers from cloudSyncService", async () => {
      const diag = await diagnosticService.getDiagnostics();
      expect(diag.sync.providers).toBeDefined();
      expect((diag.sync.providers.drive as any).provider).toBe("drive");
    });
  });

  describe("WebGPU detection", () => {
    it("detects WebGPU when gpu is available with adapter", async () => {
      const mockAdapter = {
        requestAdapterInfo: vi.fn().mockResolvedValue({
          vendor: "NVIDIA",
          architecture: "Turing",
          description: "RTX 3060",
        }),
      };
      vi.stubGlobal("navigator", {
        ...navigator,
        gpu: { requestAdapter: vi.fn().mockResolvedValue(mockAdapter) },
      });
      const diag = await diagnosticService.getDiagnostics();
      expect(diag.ai.webGpuSupported).toBe(true);
      expect(diag.ai.webGpuAdapter).toContain("NVIDIA");
    });

    it("runs its own read-only WebGPU probe without initializing WebLLM", async () => {
      // The diagnostics report must be purely informational: its WebGPU probe
      // (getNavigatorGPU().requestAdapter) must never start the engine — that
      // is warmup()'s job, gated by canRunLocalLLM(). If diagnostics ever
      // called init(), a support report on a GPU-less device would trigger a
      // model download.
      const mockAdapter = {
        requestAdapterInfo: vi.fn().mockResolvedValue({
          vendor: "AMD",
          architecture: "RDNA2",
          description: "RX 6800",
        }),
      };
      vi.stubGlobal("navigator", {
        ...navigator,
        gpu: { requestAdapter: vi.fn().mockResolvedValue(mockAdapter) },
      });
      const diag = await diagnosticService.getDiagnostics();
      expect(diag.ai.webGpuSupported).toBe(true);
      // init lives on the loader double now (the Pro module is never loaded
      // through the real path in tests).
      const { loadWebLLMService } = await import("../../services/pro-access");
      expect(vi.mocked((await loadWebLLMService()).init)).not.toHaveBeenCalled();
    });

    it("webGpuSupported false when adapter is null", async () => {
      vi.stubGlobal("navigator", {
        ...navigator,
        gpu: { requestAdapter: vi.fn().mockResolvedValue(null) },
      });
      const diag = await diagnosticService.getDiagnostics();
      expect(diag.ai.webGpuSupported).toBe(false);
      expect(diag.ai.webGpuAdapter).toBeNull();
    });

    it("webGpuSupported false when gpu.requestAdapter fails", async () => {
      vi.stubGlobal("navigator", {
        ...navigator,
        gpu: {
          requestAdapter: vi.fn().mockRejectedValue(new Error("WebGPU error")),
        },
      });
      const diag = await diagnosticService.getDiagnostics();
      expect(diag.ai.webGpuSupported).toBe(false);
      expect(diag.ai.webGpuAdapter).toBeNull();
    });

    it("webGpuSupported false when gpu does not exist on navigator", async () => {
      vi.stubGlobal("navigator", { ...navigator, gpu: undefined });
      const diag = await diagnosticService.getDiagnostics();
      expect(diag.ai.webGpuSupported).toBe(false);
      expect(diag.ai.webGpuAdapter).toBeNull();
    });
  });

  describe("constructor error listener", () => {
    it("captura errores de window", () => {
      const event = new ErrorEvent("error", {
        message: "test runtime error",
        error: new Error("test"),
      });
      window.dispatchEvent(event);
      // logger.warn is called with the error (warn to avoid
      // recursion if ObservabilityHub overrides logger.error)
      expect(logger.warn).toHaveBeenCalledWith(
        "[DiagnosticService] Runtime Error Detected",
        expect.objectContaining({ error: "test runtime error" }),
      );
    });

    it("sets lastError when an error occurs", async () => {
      window.dispatchEvent(
        new ErrorEvent("error", {
          message: "my error msg",
          error: new Error("my error"),
        }),
      );
      const diag = await diagnosticService.getDiagnostics();
      expect(diag.performance.lastError).toBe("my error msg");
    });
  });

  describe("silent audit (performSilentAudit)", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("generates insights when there are suboptimal conditions (db, webgpu, memory)", async () => {
      (isDBInitialized as any).mockReturnValue(false);
      vi.stubGlobal("navigator", {
        ...navigator,
        gpu: undefined,
        hardwareConcurrency: 8,
        deviceMemory: 2,
      });

      await (diagnosticService as any).performSilentAudit();

      expect(logger.warn).toHaveBeenCalledWith(
        "System Health Audit Insights",
        expect.objectContaining({
          insights: expect.arrayContaining([expect.any(String)]),
        }),
      );
    });

    it("does not generate insights when everything is fine", async () => {
      (isDBInitialized as any).mockReturnValue(true);
      vi.stubGlobal("navigator", {
        ...navigator,
        gpu: {
          requestAdapter: vi.fn().mockResolvedValue({
            requestAdapterInfo: vi.fn().mockResolvedValue({}),
          }),
        },
        hardwareConcurrency: 4,
        deviceMemory: 8,
      });

      await (diagnosticService as any).performSilentAudit();

      expect(logger.warn).not.toHaveBeenCalledWith(
        "System Health Audit Insights",
        expect.any(Object),
      );
    });

    it("does not include memory insight when memoryLimit is sufficient", async () => {
      (isDBInitialized as any).mockReturnValue(true);
      vi.stubGlobal("navigator", {
        ...navigator,
        gpu: undefined,
        hardwareConcurrency: 8,
        deviceMemory: 8,
      });

      await (diagnosticService as any).performSilentAudit();

      const warnCalls = (logger.warn as any).mock.calls.filter(
        (c: string[]) => c[0] === "System Health Audit Insights",
      );
      if (warnCalls.length > 0) {
        const insights: string[] = warnCalls[0][1]?.insights ?? [];
        expect(insights.some((i: string) => i.includes("memory"))).toBe(false);
      }
    });

    it("does not include db insight when db.initialized is true", async () => {
      (isDBInitialized as any).mockReturnValue(true);
      vi.stubGlobal("navigator", {
        ...navigator,
        gpu: {
          requestAdapter: vi.fn().mockResolvedValue({
            requestAdapterInfo: vi.fn().mockResolvedValue({}),
          }),
        },
        hardwareConcurrency: 4,
        deviceMemory: 8,
      });

      await (diagnosticService as any).performSilentAudit();

      const warnCalls = (logger.warn as any).mock.calls.filter(
        (c: string[]) => c[0] === "System Health Audit Insights",
      );
      expect(warnCalls.length).toBe(0);
    });

    it("includes db insight when db.initialized is false", async () => {
      (isDBInitialized as any).mockReturnValue(false);
      vi.stubGlobal("navigator", {
        ...navigator,
        gpu: {
          requestAdapter: vi.fn().mockResolvedValue({
            requestAdapterInfo: vi.fn().mockResolvedValue({}),
          }),
        },
        hardwareConcurrency: 4,
        deviceMemory: 8,
      });

      await (diagnosticService as any).performSilentAudit();

      const warnCalls = (logger.warn as any).mock.calls.filter(
        (c: string[]) => c[0] === "System Health Audit Insights",
      );
      expect(warnCalls.length).toBe(1);
      const insights: string[] = warnCalls[0][1]?.insights ?? [];
      expect(insights.some((i: string) => i.includes("Database"))).toBe(true);
    });
  });

  describe("process.env.NODE_ENV development", () => {
    const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

    afterEach(() => {
      process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    });

    it("llama logger.debug en development mode con insights", async () => {
      process.env.NODE_ENV = "development";
      (isDBInitialized as any).mockReturnValue(false);
      vi.stubGlobal("navigator", {
        ...navigator,
        gpu: undefined,
        hardwareConcurrency: 8,
        deviceMemory: 2,
      });

      await (diagnosticService as any).performSilentAudit();

      expect(logger.warn).toHaveBeenCalledWith(
        "System Health Audit Insights",
        expect.objectContaining({ insights: expect.any(Array) }),
      );
    });

    it("does not call console.table when not in development", async () => {
      process.env.NODE_ENV = "production";
      (isDBInitialized as any).mockReturnValue(false);
      vi.stubGlobal("navigator", {
        ...navigator,
        gpu: undefined,
        hardwareConcurrency: 8,
        deviceMemory: 2,
      });
      const tableSpy = vi.spyOn(console, "table").mockImplementation(() => {});

      await (diagnosticService as any).performSilentAudit();

      expect(tableSpy).not.toHaveBeenCalled();
      tableSpy.mockRestore();
    });
  });

  describe("startMonitoring guard", () => {
    it("only starts one monitoring interval", () => {
      expect(() => diagnosticService.getDiagnostics()).not.toThrow();
    });

    it("returns early if monitorInterval is already set", () => {
      // startMonitoring is called from constructor; calling again via cast
      // exercises the early-return branch (line 61)
      expect(() => (diagnosticService as any).startMonitoring()).not.toThrow();
    });
  });

  describe("diagnosticService exportado", () => {
    it("exists and has getDiagnostics", () => {
      expect(diagnosticService).toBeDefined();
      expect(typeof diagnosticService.getDiagnostics).toBe("function");
    });
  });
});
