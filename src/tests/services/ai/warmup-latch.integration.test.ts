import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Real-composition integration test: ProviderManager.warmup() × WebLLMService's
 * idle-TTL latch, with BOTH production classes running unmocked.
 *
 * The two unit suites each cover half the chain:
 *   - WebLLMService.test.ts runs the REAL service but drives init() directly
 *     (it pins the latch contract: non-force init refused, force reloads).
 *   - ProviderManager.test.ts runs the REAL warmup() but against a MOCKED
 *     webLLMService (its containment test simulates the latch refusal by
 *     scripting init to reject with the latch error).
 *
 * Neither proves the composition: that the real warmup's capability probes
 * pass on a capable device, reach the real init, and that the real latch's
 * refusal is contained end to end through the real unlock wiring. This file
 * closes that gap — only BOUNDARY modules are mocked (MLC engine creation,
 * secure storage, config, rate limiting, routing), so a change to either
 * production class breaks these tests.
 */

// ---- WebLLMService boundary mocks (same shapes as WebLLMService.test.ts) ----

vi.mock("../../../utils/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../../services/ai/ResourceManager", () => ({
  resourceManager: {
    switchToWebLLM: vi.fn().mockResolvedValue(undefined),
    // P1: second conjunct of the local-route DUAL GATE (ProviderManager.ts
    // resolveProvider) — without it every private-data routing call crashes.
    isHighEndDevice: vi.fn().mockReturnValue(true),
  },
}));

// ProviderManager resolves WebLLM through the Pro loader, and `pro-access`
// refuses to hand the module out without a license — so without this the
// warmup under test would short-circuit as "Pro unavailable" and never touch
// an engine. Every other method keeps its real implementation: this test is
// about the warmup × idle-TTL composition, not about entitlement plumbing.
vi.mock("../../../services/LicenseService", async () => {
  const actual = await vi.importActual<
    typeof import("../../../services/LicenseService")
  >("../../../services/LicenseService");
  return {
    ...actual,
    licenseService: {
      ...actual.licenseService,
      hasProAccess: () => true,
    },
  };
});

vi.mock("@mlc-ai/web-llm", () => ({
  CreateMLCEngine: vi.fn(),
  hasModelInCache: vi.fn(),
  prebuiltAppConfig: {
    model_list: [
      { model_id: "Llama-3.2-1B-Instruct-q4f16_1-MLC" },
      { model_id: "Llama-3.2-3B-Instruct-q4f16_1-MLC" },
      { model_id: "Llama-3.1-8B-Instruct-q4f16_1-MLC" },
    ],
  },
}));

vi.mock("sonner", () => ({
  toast: {
    warning: vi.fn(),
  },
}));

// ---- ProviderManager boundary mocks (same shapes as ProviderManager.test.ts) ----

const mockCache = {
  get: vi.fn(),
  set: vi.fn(),
  clear: vi.fn(),
  getStats: vi.fn().mockReturnValue({ size: 0, maxSize: 100, ttl: 300000 }),
};

let mockGetApiKey: ReturnType<typeof vi.fn>;
let mockGetSelectedProvider: ReturnType<typeof vi.fn>;

vi.mock("../../../services/ai/AIRequestCache", () => ({
  AIRequestCache: vi.fn().mockImplementation(function () {
    return mockCache;
  }),
}));

vi.mock("../../../services/ai/VaultIntegration", () => ({
  VaultIntegration: vi.fn().mockImplementation(function () {
    mockGetApiKey = vi.fn().mockReturnValue(null);
    return {
      isVaultLocked: vi.fn().mockReturnValue(false),
      unlockVault: vi.fn(),
      updateMasterPassword: vi.fn(),
      setApiKey: vi.fn(),
      getApiKey: mockGetApiKey,
      clearApiKey: vi.fn(),
    };
  }),
}));

vi.mock("../../../services/ai/ProviderConfiguration", () => ({
  ProviderConfiguration: vi.fn().mockImplementation(function () {
    mockGetSelectedProvider = vi.fn().mockReturnValue("webllm");
    return {
      init: vi.fn().mockResolvedValue(undefined),
      getProviderInfo: vi.fn().mockReturnValue({
        provider: "webllm",
        model: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
        fullSupport: true,
        name: "WebLLM",
        isConfigured: true,
      }),
      getSelectedProvider: mockGetSelectedProvider,
      setProvider: vi.fn(),
      setApiKey: vi.fn(),
      setOllamaSettings: vi.fn(),
      getOllamaSettings: vi
        .fn()
        .mockReturnValue({
          url: "http://localhost:11434/api/generate",
          model: "llama3.2",
        }),
      setWebLlmModel: vi.fn(),
      getWebLlmModel: vi
        .fn()
        .mockReturnValue("Llama-3.2-1B-Instruct-q4f16_1-MLC"),
      setModel: vi.fn(),
      getCustomBaseUrl: vi.fn().mockReturnValue(""),
      setCustomBaseUrl: vi.fn(),
      // Routing (resolveProvider) probes availability eagerly:
      getOllamaProvider: vi.fn().mockReturnValue({
        isAvailable: vi.fn().mockResolvedValue(false),
      }),
      getGeminiProvider: vi.fn().mockReturnValue({
        isAvailable: vi.fn().mockResolvedValue(false),
      }),
      getOpenAIProvider: vi.fn().mockReturnValue({
        isAvailable: vi.fn().mockResolvedValue(false),
      }),
    };
  }),
}));

vi.mock("../../../services/RateLimitService", () => ({
  rateLimitService: {
    checkLimit: vi.fn().mockReturnValue({
      remaining: 100,
      used: 0,
      resetAt: Date.now() + 60000,
      exhausted: false,
    }),
    recordRequest: vi.fn(),
  },
}));

vi.mock("../../../services/SecurityVault", () => ({
  SECURE_STORAGE_KEYS: {},
  securityVault: {
    isLocked: vi.fn().mockReturnValue(false),
    lock: vi.fn().mockResolvedValue(undefined),
    onLock: vi.fn(() => () => {}),
    onUnlock: vi.fn(() => () => {}),
  },
}));

vi.mock("../../../services/ai/utils", () => ({
  detectProvider: vi.fn(),
  sanitizeErrorMessage: vi.fn((msg: string) => msg),
  getUserFriendlyErrorMessage: vi.fn((msg: string) => msg),
  // P1: part of the ai/utils contract WebLLMService consumes at chat time;
  // exercised there (WebLLMService.test asserts the wrapped content) and
  // directly by src/tests/ai/buildSafeUserContent.test.ts.
  buildSafeUserContent: vi.fn((content: string) => content),
}));

vi.mock("../../../services/ai/adapters/RoutingOptimizer", () => ({
  routingOptimizer: {
    selectProvider: vi.fn(
      (_taskType: unknown, _context: unknown, defaultProvider: string) =>
        defaultProvider,
    ),
    // The constructor wires clear() into the vault lock/unlock handlers.
    clear: vi.fn(),
  },
}));

vi.mock("../../../services/ai/SemanticCacheService", () => ({
  semanticCache: {
    findSimilar: vi.fn().mockResolvedValue(null),
    add: vi.fn().mockResolvedValue(undefined),
  },
}));

// NOTE: WebLLMService is deliberately NOT mocked — it is the subject of the
// composition, together with ProviderManager.

const mockLocalStorage = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
})();
vi.stubGlobal("localStorage", mockLocalStorage);

const { ProviderManager } =
  await import("../../../services/ai/ProviderManager");
const { webLLMService } = await import("../../../services/ai/WebLLMService");
const { CreateMLCEngine, hasModelInCache } = await import("@mlc-ai/web-llm");
const { logger } = await import("../../../utils/logger");

const IDLE_TTL_MS = 30 * 60 * 1000;

describe("warmup × idle-TTL latch (real composition)", () => {
  let manager: InstanceType<typeof ProviderManager>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Capable device: WebGPU surface + shader-f16 adapter + 8 GB RAM, so the
    // REAL canRunLocalLLM() probes pass and warmup reaches the real init().
    const fakeAdapter = {
      features: new Set(["shader-f16"]),
    };
    vi.stubGlobal("navigator", {
      onLine: true,
      hardwareConcurrency: 8,
      deviceMemory: 8,
      gpu: { requestAdapter: vi.fn().mockResolvedValue(fakeAdapter) },
      connection: { type: "wifi", effectiveType: "4g", saveData: false },
    });

    (CreateMLCEngine as any).mockImplementation(
      async (_modelId: string, options: any) => {
        if (options?.initProgressCallback) {
          options.initProgressCallback({
            text: "Loading model...",
            progress: 0.5,
          });
          options.initProgressCallback({ text: "Model loaded", progress: 1.0 });
        }
        return {
          chat: { completions: { create: vi.fn() } },
          unload: vi.fn().mockResolvedValue(undefined),
        };
      },
    );
    (hasModelInCache as any).mockResolvedValue(true);

    // The real service singleton persists across tests in this file. Two
    // pieces of state must be reset by hand because the production contract
    // deliberately keeps them across unload():
    //  1. unloadedByIdleTimer — only init(force=true) consumes the latch, so
    //     a test that fires the TTL leaves it engaged and every later test
    //     would inherit the refusal.
    //  2. (unload() in afterEach handles the engine and the TTL timer.)
    (webLLMService as any).unloadedByIdleTimer = false;
    manager = new ProviderManager();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    await webLLMService.unload();
  });

  it("real warmup drives the real latched init: the post-TTL refusal is contained and named, and no engine is created", async () => {
    // The WHOLE lifecycle runs under fake timers: the TTL timer is armed by
    // init's own finally, so it must be armed while the fake clock controls
    // time (the exact lesson from the unit suite's interplay tests).
    vi.useFakeTimers();
    try {
      // First warmup preloads for real: capability probes pass on the
      // capable-device stub, the real init installs the engine.
      await manager.warmup();
      await vi.waitFor(() => {
        expect(webLLMService.isModelLoaded()).toBe(true);
      });
      expect(webLLMService.getCurrentModel()).toBe(
        "Llama-3.2-1B-Instruct-q4f16_1-MLC",
      );
      const engineCreatesAfterLoad =
        vi.mocked(CreateMLCEngine).mock.calls.length;

      // The REAL 30-minute TTL callback releases the engine and latches it.
      vi.advanceTimersByTime(IDLE_TTL_MS + 1);
      await vi.runAllTimersAsync();
      expect(webLLMService.isModelLoaded()).toBe(false);

      // The next opportunistic warmup (unlock / editor focus) must not
      // resurrect the engine: the REAL init refuses, the REAL warmup
      // contains the refusal.
      await expect(manager.warmup()).resolves.not.toThrow();

      // No engine was created, loaded, or re-acquired.
      expect(webLLMService.isModelLoaded()).toBe(false);
      expect(vi.mocked(CreateMLCEngine).mock.calls.length).toBe(
        engineCreatesAfterLoad,
      );

      // The refusal is named through the real chain: warmup's init catch
      // logs the single concatenated warn with the latch message.
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("unloaded after 30 minutes of inactivity"),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("the refusal never leaks an unhandled rejection through the real unlock wiring", async () => {
    // The production trigger is the vault unlock listener (registered in
    // ProviderManager's constructor), which fires warmup detached. After an
    // idle unload, EVERY unlock hits the latch refusal — it must be
    // contained by warmup's catch, never surface as an unhandled rejection.
    vi.useFakeTimers();
    try {
      await manager.warmup();
      await vi.waitFor(() => {
        expect(webLLMService.isModelLoaded()).toBe(true);
      });
      vi.advanceTimersByTime(IDLE_TTL_MS + 1);
      await vi.runAllTimersAsync();
      expect(webLLMService.isModelLoaded()).toBe(false);

      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => {
        unhandled.push(reason);
      };
      process.on("unhandledRejection", onUnhandled);
      try {
        await expect(manager.warmup()).resolves.not.toThrow();
      } finally {
        process.off("unhandledRejection", onUnhandled);
      }
      expect(unhandled).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("only the user's explicit reload (init force=true) revives the engine, after which warmup is idempotent again", async () => {
    vi.useFakeTimers();
    try {
      await manager.warmup();
      await vi.waitFor(() => {
        expect(webLLMService.isModelLoaded()).toBe(true);
      });
      const engineCreatesAfterLoad =
        vi.mocked(CreateMLCEngine).mock.calls.length;

      vi.advanceTimersByTime(IDLE_TTL_MS + 1);
      await vi.runAllTimersAsync();

      // Warmup stays refused while the latch holds.
      await expect(manager.warmup()).resolves.not.toThrow();
      expect(webLLMService.isModelLoaded()).toBe(false);

      // The deliberate re-acquisition path (settings toast action) reloads
      // and consumes the latch. The real retry calls init(modelId, true)
      // with the SELECTED model (not the hardware default), so force the
      // same model warmup uses — otherwise the id difference alone would
      // legitimately re-initialize.
      await expect(
        webLLMService.init("Llama-3.2-1B-Instruct-q4f16_1-MLC", true),
      ).resolves.not.toThrow();
      expect(webLLMService.isModelLoaded()).toBe(true);
      expect(webLLMService.getCurrentModel()).toBe(
        "Llama-3.2-1B-Instruct-q4f16_1-MLC",
      );

      // Warmup re-armed: it now resolves idempotently against the loaded
      // engine without creating another one.
      await expect(manager.warmup()).resolves.not.toThrow();
      expect(vi.mocked(CreateMLCEngine).mock.calls.length).toBe(
        engineCreatesAfterLoad + 1,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("a manual unload does NOT latch: real warmup recovers the engine for real", async () => {
    // Negative control pinning the latch's scope through the composition:
    // memory pressure / provider switch release the engine for THEIR reason,
    // and a later warmup (unlock, editor focus) must genuinely reload.
    vi.useRealTimers();
    await manager.warmup();
    await vi.waitFor(() => {
      expect(webLLMService.isModelLoaded()).toBe(true);
    });

    await webLLMService.unload();
    expect(webLLMService.isModelLoaded()).toBe(false);
    const engineCreatesBeforeRecovery =
      vi.mocked(CreateMLCEngine).mock.calls.length;

    // Recovery: warmup drives the real init through capability probes into
    // a SECOND real engine creation.
    await manager.warmup();
    await vi.waitFor(() => {
      expect(webLLMService.isModelLoaded()).toBe(true);
    });
    expect(vi.mocked(CreateMLCEngine).mock.calls.length).toBe(
      engineCreatesBeforeRecovery + 1,
    );
    // And the refusal path never logged — the latch was never involved.
    expect(logger.info).not.toHaveBeenCalledWith(
      expect.stringContaining("idle TTL"),
    );
    expect(logger.warn).not.toHaveBeenCalledWith(
      expect.stringContaining("unloaded after 30 minutes of inactivity"),
    );
  });

  // ── P1 mock-contract sweep ──────────────────────────────────────────────
  it("P1: private-data routing evaluates the high-end-device dual gate", async () => {
    const { resourceManager } = await import(
      "../../../services/ai/ResourceManager"
    );

    // The capable-device fixture makes the REAL canRunLocalLLM() probes pass,
    // so the private-data local route reaches
    // `hasWebLLM && resourceManager.isHighEndDevice()` (the DUAL GATE).
    const result = await (manager as any).resolveProvider({
      isPrivate: true,
      complexity: "simple",
    });

    expect(resourceManager.isHighEndDevice).toHaveBeenCalled();
    expect(result.provider).toBe("webllm");
  });
});
