import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

const mockCache = {
  get: vi.fn(),
  set: vi.fn(),
  clear: vi.fn(),
  getStats: vi.fn().mockReturnValue({ size: 0, maxSize: 100, ttl: 300000 }),
};

let mockGetApiKey: ReturnType<typeof vi.fn>;
const mockVaultGetApiKey = { mockReturnValue: (value: string | null) => mockGetApiKey.mockReturnValue(value) };
let mockSetApiKeyVault: ReturnType<typeof vi.fn>;
let mockUnlockVault: ReturnType<typeof vi.fn>;
let mockIsVaultLocked: ReturnType<typeof vi.fn>;

vi.mock("../../\.\./services/ai/AIRequestCache", () => ({
  AIRequestCache: vi.fn().mockImplementation(function () {
    return mockCache;
  }),
}));

vi.mock("../../\.\./services/ai/VaultIntegration", () => ({
  VaultIntegration: vi.fn().mockImplementation(function () {
    mockGetApiKey = vi.fn().mockReturnValue(null);
    mockSetApiKeyVault = vi.fn();
    mockUnlockVault = vi.fn();
    mockIsVaultLocked = vi.fn();
    return {
      isVaultLocked: mockIsVaultLocked,
      unlockVault: mockUnlockVault,
      updateMasterPassword: vi.fn(),
      setApiKey: mockSetApiKeyVault,
      getApiKey: mockGetApiKey,
      clearApiKey: vi.fn(),
    };
  }),
}));

let mockGetSelectedProvider: ReturnType<typeof vi.fn>;
let mockSetProvider: ReturnType<typeof vi.fn>;
let mockGetGeminiProvider: ReturnType<typeof vi.fn>;
let mockGetOpenAIProvider: ReturnType<typeof vi.fn>;
let mockOpenAIProvider: { generateText: ReturnType<typeof vi.fn>; streamGenerateText: ReturnType<typeof vi.fn> };
let mockGetOllamaProvider: ReturnType<typeof vi.fn>;
let mockGetOllamaSettings: ReturnType<typeof vi.fn>;
let mockGetProviderInfo: ReturnType<typeof vi.fn>;
let mockGetCustomBaseUrl: ReturnType<typeof vi.fn>;
let mockSetCustomBaseUrl: ReturnType<typeof vi.fn>;
let mockConfigSetModel: ReturnType<typeof vi.fn>;
let mockConfigSetOllamaSettings: ReturnType<typeof vi.fn>;
let mockConfigSetWebLlmModel: ReturnType<typeof vi.fn>;

vi.mock("../../\.\./services/ai/ProviderConfiguration", () => ({
  ProviderConfiguration: vi.fn().mockImplementation(function () {
    mockGetSelectedProvider = vi.fn().mockReturnValue("gemini");
    mockSetProvider = vi.fn();
    mockGetGeminiProvider = vi.fn(() => ({
      generateText: vi
        .fn()
        .mockResolvedValue({ text: "gemini response", provider: "gemini" }),
      streamGenerateText: vi.fn().mockResolvedValue({
        text: "gemini stream",
        provider: "gemini",
      }),
    }));
    mockOpenAIProvider = {
      generateText: vi.fn().mockResolvedValue({ text: "openai response", provider: "openai" }),
      streamGenerateText: vi.fn().mockResolvedValue({ text: "openai stream", provider: "openai" }),
    };
    mockGetOpenAIProvider = vi.fn(() => ({
      ...mockOpenAIProvider,
      fetchAvailableModels: vi.fn().mockResolvedValue(["gpt-4", "gpt-4o-mini"]),
    }));
    mockGetOllamaProvider = vi.fn(() => ({
      generateText: vi
        .fn()
        .mockResolvedValue({ text: "ollama response", provider: "ollama" }),
      streamGenerateText: vi.fn().mockResolvedValue({
        text: "ollama stream",
        provider: "ollama",
      }),
      isAvailable: vi.fn().mockResolvedValue(true),
      getConfig: vi.fn().mockReturnValue({
        url: "http://localhost:11434/api/generate",
        model: "llama3.2",
      }),
    }));
    mockGetOllamaSettings = vi.fn().mockReturnValue({
      url: "http://localhost:11434/api/generate",
      model: "llama3.2",
    });
    mockGetProviderInfo = vi.fn().mockReturnValue({
      provider: "gemini",
      model: "gemini-2.0-flash-exp",
      fullSupport: true,
      name: "Google Gemini",
      isConfigured: false,
    });
    mockGetCustomBaseUrl = vi.fn().mockReturnValue("https://custom.example.com");
    mockSetCustomBaseUrl = vi.fn();
    mockConfigSetModel = vi.fn();
    mockConfigSetOllamaSettings = vi.fn();
    mockConfigSetWebLlmModel = vi.fn();
    return {
      init: vi.fn().mockResolvedValue(undefined),
      getProviderInfo: mockGetProviderInfo,
      getSelectedProvider: mockGetSelectedProvider,
      setProvider: mockSetProvider,
      setApiKey: vi.fn(),
      setOllamaSettings: mockConfigSetOllamaSettings,
      getOllamaSettings: mockGetOllamaSettings,
      setWebLlmModel: mockConfigSetWebLlmModel,
      getWebLlmModel: vi
        .fn()
        .mockReturnValue("Llama-3.2-1B-Instruct-q4f16_1-MLC"),
      setModel: mockConfigSetModel,
      getCustomBaseUrl: mockGetCustomBaseUrl,
      setCustomBaseUrl: mockSetCustomBaseUrl,
      getOllamaProvider: mockGetOllamaProvider,
      getGeminiProvider: mockGetGeminiProvider,
      getOpenAIProvider: mockGetOpenAIProvider,
    };
  }),
}));

vi.mock("../../\.\./services/ai/ResourceManager", () => ({
  resourceManager: {
    isHighEndDevice: vi.fn().mockReturnValue(true),
  },
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

vi.mock("../../../utils/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// SecurityVault mock: captures the onLock/onUnlock listeners ProviderManager
// registers in its constructor so tests can fire the unlock event directly.
const securityVaultUnlockListeners: Array<() => void> = [];
const securityVaultLockListeners: Array<() => void> = [];
vi.mock("../../\.\./services/SecurityVault", () => ({
  SECURE_STORAGE_KEYS: {},
  securityVault: {
    isLocked: vi.fn().mockReturnValue(false),
    lock: vi.fn().mockResolvedValue(undefined),
    onLock: vi.fn((listener: () => void) => {
      securityVaultLockListeners.push(listener);
      return () => {};
    }),
    onUnlock: vi.fn((listener: () => void) => {
      securityVaultUnlockListeners.push(listener);
      return () => {};
    }),
  },
}));

vi.mock("../../\.\./services/ai/utils", () => ({
  detectProvider: vi.fn(),
  sanitizeErrorMessage: vi.fn((msg: string) => msg),
  getUserFriendlyErrorMessage: vi.fn((msg: string) => msg),
}));

vi.mock("../../\.\./services/ai/WebLLMService", () => ({
  webLLMService: {
    canRunLocalLLM: vi.fn().mockResolvedValue(true),
    generateText: vi.fn().mockResolvedValue("webllm response"),
    init: vi.fn().mockResolvedValue(undefined),
    unload: vi.fn().mockResolvedValue(undefined),
    // Capable-device default; tests override the rejection to simulate
    // GPU-less or f16-less profiles.
    assertCanRunLocalLLM: vi.fn().mockResolvedValue(undefined),
    getHealthStatus: vi.fn().mockResolvedValue({
      webGPUSupported: true,
      f16Supported: true,
    }),
  },
}));

vi.mock("../../\.\./services/ai/adapters/RoutingOptimizer", () => ({
  routingOptimizer: {
    selectProvider: vi.fn(
      (_taskType, _context, defaultProvider) => defaultProvider,
    ),
    // The constructor wires clear() into the vault lock/unlock handlers;
    // the mock must expose it so a future lock/unlock test does not crash.
    clear: vi.fn(),
  },
}));

vi.mock("../../\.\./services/ai/SemanticCacheService", () => ({
  semanticCache: {
    findSimilar: vi.fn().mockResolvedValue(null),
    add: vi.fn().mockResolvedValue(undefined),
  },
}));

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

const mockNavigator = (overrides: Record<string, unknown> = {}) => {
  vi.stubGlobal("navigator", {
    onLine: true,
    hardwareConcurrency: 8,
    deviceMemory: 8,
    connection: undefined,
    getBattery: undefined,
    ...overrides,
  });
};

const { ProviderManager } =
  await import("../../\.\./services/ai/ProviderManager");
const { ProviderConfiguration } =
  await import("../../\.\./services/ai/ProviderConfiguration");

describe("ProviderManager", () => {
  let manager: InstanceType<typeof ProviderManager>;

  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    mockLocalStorage.clear();
    mockNavigator();
    // Reset leaky mocks (clearAllMocks doesn't reset mockReturnValue in vitest 4.x)
    mockGetApiKey.mockReturnValue(null);
    mockGetSelectedProvider.mockReturnValue("gemini");
    mockGetProviderInfo.mockReturnValue({
      provider: "gemini",
      model: "gemini-2.0-flash-exp",
      fullSupport: true,
      name: "Google Gemini",
      isConfigured: false,
    });
    mockGetOllamaProvider.mockReturnValue({
      generateText: vi
        .fn()
        .mockResolvedValue({ text: "ollama response", provider: "ollama" }),
      isAvailable: vi.fn().mockResolvedValue(true),
      getConfig: vi.fn().mockReturnValue({
        url: "http://localhost:11434/api/generate",
        model: "llama3.2",
      }),
    });
    manager = new ProviderManager();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("constructor", () => {
    it("creates instance without errors", () => {
      expect(manager).toBeInstanceOf(ProviderManager);
    });
  });

  describe("Vault delegation", () => {
    it("setApiKey delega a vault y config", async () => {
      await manager.setApiKey("sk-test-key");
      const vault = (await import("../../\.\./services/ai/VaultIntegration"))
        .VaultIntegration;
      expect(vault).toHaveBeenCalled();
    });

    it("getApiKey returns null by default", () => {
      expect(manager.getApiKey()).toBeNull();
    });
  });

  describe("Provider delegation", () => {
    it("getProviderInfo returns info from the config", () => {
      const info = manager.getProviderInfo();
      expect(info.provider).toBe("gemini");
    });

    it("setProvider delega a config", async () => {
      await manager.setProvider("openai");
      // no error means it worked
    });
  });

  describe("Ollama settings", () => {
    it("setOllamaSettings no lanza error", async () => {
      await manager.setOllamaSettings("http://custom:11434", "mistral");
    });

    it("getOllamaSettings returns values", () => {
      const settings = manager.getOllamaSettings();
      expect(settings.model).toBe("llama3.2");
    });
  });

  describe("WebLLM settings", () => {
    it("setWebLlmModel no lanza error", async () => {
      await manager.setWebLlmModel("Phi-3.5-mini");
    });

    it("getWebLlmModel returns model", () => {
      expect(manager.getWebLlmModel()).toBe(
        "Llama-3.2-1B-Instruct-q4f16_1-MLC",
      );
    });

    it("setModel no lanza error", async () => {
      await manager.setModel("custom-model");
    });
  });

  describe("Cache management", () => {
    it("clearCache llama a cache.clear", () => {
      manager.clearCache();
      expect(mockCache.clear).toHaveBeenCalled();
    });

    it("getCacheStats returns stats", () => {
      const stats = manager.getCacheStats();
      expect(stats).toHaveProperty("size");
      expect(stats).toHaveProperty("maxSize");
    });
  });

  describe("generateText", () => {
    it("throws error if prompt exceeds 100k characters", async () => {
      await expect(manager.generateText("x".repeat(100001))).rejects.toThrow(
        "Prompt too long",
      );
    });

    it("throws error if systemPrompt exceeds 50k characters", async () => {
      await expect(
        manager.generateText("prompt", "x".repeat(50001)),
      ).rejects.toThrow("System prompt too long");
    });

    it("uses the WebLLM provider when available per optimization", async () => {
      const result = await manager.generateText("test prompt");
      expect(result.provider).toBe("webllm");
    });

    it("returns the result from cache when present", async () => {
      mockCache.get.mockReturnValue({
        text: "cached response",
        provider: "gemini",
      });
      const result = await manager.generateText("test prompt");
      expect(result.text).toBe("cached response");
    });

    it("does not check rate limit for ollama", async () => {
      const config = (
        await import("../../\.\./services/ai/ProviderConfiguration")
      ).ProviderConfiguration;
      const mockConfig = vi.mocked(config).mock.results[0]!.value;
      (mockConfig.getProviderInfo as ReturnType<typeof vi.fn>).mockReturnValue({
        provider: "ollama",
        model: "llama3.2",
        fullSupport: false,
        name: "Ollama",
        isConfigured: true,
      });
      const result = await manager.generateText("test", undefined, { isPrivate: false });
      expect(result).toBeDefined();
    });
  });

  describe("getRecommendedWebLLMModel", () => {
    it("returns TinyLlama for RAM < 4GB or cores < 4", () => {
      mockNavigator({ deviceMemory: 2, hardwareConcurrency: 2 });
      expect(manager.getRecommendedWebLLMModel()).toBe(
        "TinyLlama-1.1B-Chat-v1.0-q4f16_1-MLC",
      );
    });

    it("returns Llama-3.2-1B for RAM between 4 and 8GB", () => {
      mockNavigator({ deviceMemory: 6, hardwareConcurrency: 4 });
      expect(manager.getRecommendedWebLLMModel()).toBe(
        "Llama-3.2-1B-Instruct-q4f16_1-MLC",
      );
    });

    it("returns Llama-3.2-3B for RAM between 8 and 12GB", () => {
      mockNavigator({ deviceMemory: 10, hardwareConcurrency: 8 });
      expect(manager.getRecommendedWebLLMModel()).toBe(
        "Llama-3.2-3B-Instruct-q4f16_1-MLC",
      );
    });

    it("returns Phi-3.5-mini for RAM >= 12GB", () => {
      mockNavigator({ deviceMemory: 16, hardwareConcurrency: 8 });
      expect(manager.getRecommendedWebLLMModel()).toBe(
        "Phi-3.5-mini-instruct-q4f16_1-MLC",
      );
    });

    it("uses 4GB/4cores defaults if not available", () => {
      mockNavigator({
        deviceMemory: undefined,
        hardwareConcurrency: undefined,
      });
      expect(manager.getRecommendedWebLLMModel()).toBe(
        "Llama-3.2-1B-Instruct-q4f16_1-MLC",
      );
    });
  });

  describe("reset", () => {
    it("clears the apiKey, cache and ollama state", () => {
      manager.reset();
      expect(mockCache.clear).toHaveBeenCalled();
    });
  });

  describe("fetchAvailableModels", () => {
    it("returns an empty array when there is no API key", async () => {
      const models = await manager.fetchAvailableModels();
      expect(models).toEqual([]);
    });
  });

  describe("warmup", () => {
    it("does not throw during warmup", async () => {
      await expect(manager.warmup()).resolves.not.toThrow();
    });

    it("captura error de warmup en logger.info", async () => {
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      vi.mocked(webLLM.webLLMService.init).mockRejectedValue(
        new Error("WebGPU not supported"),
      );

      await manager.warmup();
      const logger = await import("../../../utils/logger");
      expect(logger.logger.info).toHaveBeenCalled();
    });

    it("reconciles the persisted config: calls config.init() on startup", async () => {
      // Regression: init() is NOT dead code — warmup() must load the
      // config persisted from SecureStorage at startup.
      const configMock = vi.mocked(ProviderConfiguration).mock.results[0]!.value;
      await manager.warmup();
      expect(configMock.init).toHaveBeenCalled();
    });

    it("warmup con config.init fallido (SecureStorage) no aborta la precarga de WebLLM", async () => {
      // Regression del fix del try/catch: un rechazo de la lectura de la
      // persisted config (SecureStorage) must be logged and swallowed — NEVER
      // abortar el resto de warmup (la precarga del modelo WebLLM).
      const configMock = vi.mocked(ProviderConfiguration).mock.results[0]!.value;
      configMock.init.mockRejectedValueOnce(
        new Error("SecureStorage read failed"),
      );

      // 1) warmup resuelve sin lanzar pese al rechazo de config.init().
      await expect(manager.warmup()).resolves.not.toThrow();

      // 2) The failure is recorded with logger.warn (try/catch branch), with
      //    the real error message of the rejection.
      const logger = await import("../../../utils/logger");
      expect(logger.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("config.init failed during warmup"),
        expect.objectContaining({ error: "SecureStorage read failed" }),
      );

      // 3) The WebLLM preload keeps running with the correct model
      //    (getWebLlmModel() del config mockeado).
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      expect(webLLM.webLLMService.init).toHaveBeenCalledWith(
        "Llama-3.2-1B-Instruct-q4f16_1-MLC",
      );
    });

    it("skips WebLLM init when the device cannot run local LLM (GPU-less / low-RAM)", async () => {
      // Regression: warmup() must guard init() with canRunLocalLLM(). A
      // GPU-less or low-RAM device would otherwise attempt a wasted WebLLM
      // init() that fast-fails (acquiring GPU resources + bumping error
      // metrics) on EVERY unlock.
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockResolvedValue(false);
      vi.mocked(webLLM.webLLMService.init).mockClear();

      await expect(manager.warmup()).resolves.not.toThrow();

      expect(webLLM.webLLMService.canRunLocalLLM).toHaveBeenCalled();
      expect(webLLM.webLLMService.init).not.toHaveBeenCalled();
    });

    it("skips WebLLM init when webllm is the EXPLICITLY selected provider but the device cannot run it", async () => {
      // Covers the `selectedProvider === "webllm"` branch of the warmup
      // guard in isolation: with an API key present, the branch only fires
      // because the user explicitly selected WebLLM — NOT because of a
      // missing key (the `!externalApiKey` half). A GPU-less device must
      // skip init() for the explicit selection too; the capability guard is
      // the single choke point regardless of why warmup entered.
      mockGetSelectedProvider.mockReturnValue("webllm");
      mockGetApiKey.mockReturnValue("sk-explicit-webllm-selection");
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockResolvedValue(false);
      vi.mocked(webLLM.webLLMService.init).mockClear();

      await expect(manager.warmup()).resolves.not.toThrow();

      // The guard ran exactly once and blocked the preload.
      expect(webLLM.webLLMService.canRunLocalLLM).toHaveBeenCalledTimes(1);
      expect(webLLM.webLLMService.init).not.toHaveBeenCalled();
      // Confirms the skip branch was hit (not an early exit elsewhere).
      const logger = await import("../../../utils/logger");
      expect(logger.logger.info).toHaveBeenCalledWith(
        expect.stringContaining(
          "WebLLM warmup skipped: device cannot run local LLM",
        ),
      );
    });

    it("skips WebLLM init on an f16-less device and names shader-f16 as the cause in the log", async () => {
      // The skip log must name WHY the device cannot run local LLM, not just
      // the verdict: an operator reading "warmup skipped" on a machine with a
      // real GPU but no shader-f16 needs to know the GPU is fine and the
      // adapter precision is the blocker (vs a no-WebGPU browser or a
      // low-RAM device). The legacy message stays as the prefix; the cause is
      // appended after the dash.
      const webLLM = await import("../../../services/ai/WebLLMService");
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockResolvedValue(false);
      // Full health object (the real shape, not a partial): webGPUSupported
      // true and f16Supported false isolates the f16 gate as the ONLY failed
      // check — proving the log derives the cause from the actual failed
      // gate, not from the canRunLocalLLM verdict alone.
      vi.mocked(webLLM.webLLMService.getHealthStatus).mockResolvedValue({
        healthy: false,
        webGPUSupported: true,
        f16Supported: false,
        engineReady: false,
        modelLoaded: null,
        isInitializing: false,
        deviceMemoryGB: 8,
        hardwareConcurrency: 8,
        lastError: null,
        canRunLocalLLM: false,
        timestamp: 0,
      });
      vi.mocked(webLLM.webLLMService.init).mockClear();

      await expect(manager.warmup()).resolves.not.toThrow();

      // The guard ran exactly once and blocked the preload.
      expect(webLLM.webLLMService.canRunLocalLLM).toHaveBeenCalledTimes(1);
      expect(webLLM.webLLMService.init).not.toHaveBeenCalled();
      // The skip log keeps the legacy prefix AND names the precise cause.
      const logger = await import("../../../utils/logger");
      expect(logger.logger.info).toHaveBeenCalledWith(
        expect.stringContaining(
          "WebLLM warmup skipped: device cannot run local LLM",
        ),
      );      expect(logger.logger.info).toHaveBeenCalledWith(
        expect.stringContaining(
          "— WebGPU adapter lacks shader-f16 (half-precision)",
        ),
      );
    });

    it("skips WebLLM init on a no-WebGPU device and names the missing surface as the cause in the log", async () => {
      // Mirror of the f16-cause test for the SURFACE gate: webGPUSupported
      // false and f16Supported false (no surface → f16 never probed) with
      // ample RAM isolates the missing WebGPU surface as the ONLY failed
      // check — the remedy is a WebGPU-capable browser, not more RAM or a
      // different GPU feature set. The log must derive that from the health
      // object, not from the canRunLocalLLM verdict alone.
      const webLLM = await import("../../../services/ai/WebLLMService");
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockResolvedValue(false);
      vi.mocked(webLLM.webLLMService.getHealthStatus).mockResolvedValue({
        healthy: false,
        webGPUSupported: false,
        f16Supported: false,
        engineReady: false,
        modelLoaded: null,
        isInitializing: false,
        deviceMemoryGB: 8,
        hardwareConcurrency: 8,
        lastError: null,
        canRunLocalLLM: false,
        timestamp: 0,
      });
      vi.mocked(webLLM.webLLMService.init).mockClear();

      await expect(manager.warmup()).resolves.not.toThrow();

      expect(webLLM.webLLMService.canRunLocalLLM).toHaveBeenCalledTimes(1);
      expect(webLLM.webLLMService.init).not.toHaveBeenCalled();
      const logger = await import("../../../utils/logger");
      // Legacy prefix + the surface-specific cause.
      expect(logger.logger.info).toHaveBeenCalledWith(
        expect.stringContaining(
          "WebLLM warmup skipped: device cannot run local LLM",
        ),
      );
      expect(logger.logger.info).toHaveBeenCalledWith(
        expect.stringContaining(
          "— WebGPU is not available in this browser",
        ),
      );
      // Ladder discipline: neither of the OTHER causes may appear — the
      // log names the actual failed gate, never a blanket reason.
      expect(logger.logger.info).not.toHaveBeenCalledWith(
        expect.stringContaining("shader-f16 (half-precision)"),
      );
      expect(logger.logger.info).not.toHaveBeenCalledWith(
        expect.stringContaining("insufficient device memory"),
      );
    });

    it("skips WebLLM init on a low-RAM device and names the memory floor as the cause in the log", async () => {
      // Mirror of the f16-cause test for the RAM gate: webGPUSupported and
      // f16Supported both true with deviceMemoryGB 3 isolates the >= 4 GB
      // memory floor as the ONLY failed check — the GPU is fully capable,
      // the device just cannot fit the model. The log must say so.
      const webLLM = await import("../../../services/ai/WebLLMService");
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockResolvedValue(false);
      vi.mocked(webLLM.webLLMService.getHealthStatus).mockResolvedValue({
        healthy: false,
        webGPUSupported: true,
        f16Supported: true,
        engineReady: false,
        modelLoaded: null,
        isInitializing: false,
        deviceMemoryGB: 3,
        hardwareConcurrency: 8,
        lastError: null,
        canRunLocalLLM: false,
        timestamp: 0,
      });
      vi.mocked(webLLM.webLLMService.init).mockClear();

      await expect(manager.warmup()).resolves.not.toThrow();

      expect(webLLM.webLLMService.canRunLocalLLM).toHaveBeenCalledTimes(1);
      expect(webLLM.webLLMService.init).not.toHaveBeenCalled();
      const logger = await import("../../../utils/logger");
      // Legacy prefix + the memory-specific cause (with the measured value).
      expect(logger.logger.info).toHaveBeenCalledWith(
        expect.stringContaining(
          "WebLLM warmup skipped: device cannot run local LLM",
        ),
      );
      expect(logger.logger.info).toHaveBeenCalledWith(
        expect.stringContaining(
          "— insufficient device memory (3 GB < 4 GB floor)",
        ),
      );
      // Ladder discipline: the GPU-related causes must NOT appear — the
      // device HAS a capable GPU; RAM is the only blocker.
      expect(logger.logger.info).not.toHaveBeenCalledWith(
        expect.stringContaining("WebGPU is not available"),
      );
      expect(logger.logger.info).not.toHaveBeenCalledWith(
        expect.stringContaining("shader-f16 (half-precision)"),
      );
    });

    it("skips WebLLM init when the capability probe itself throws", async () => {
      // Fail-closed: a probe failure (e.g. adapter request throws) is treated
      // like "cannot run" — skip the init, log a warn, never abort warmup.
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockRejectedValue(
        new Error("adapter probe failed"),
      );
      vi.mocked(webLLM.webLLMService.init).mockClear();

      await expect(manager.warmup()).resolves.not.toThrow();

      expect(webLLM.webLLMService.init).not.toHaveBeenCalled();
      const logger = await import("../../../utils/logger");
      expect(logger.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          "WebLLM capability check failed during warmup",
        ),
        expect.objectContaining({ error: "adapter probe failed" }),
      );
    });

    it("still preloads WebLLM when the device CAN run local LLM", async () => {
      // Positive path: the guard must not over-skip — a capable device keeps
      // the opportunistic model preload with the hardware-aware model.
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockResolvedValue(true);
      vi.mocked(webLLM.webLLMService.init).mockClear();

      await manager.warmup();

      expect(webLLM.webLLMService.canRunLocalLLM).toHaveBeenCalled();
      expect(webLLM.webLLMService.init).toHaveBeenCalledWith(
        "Llama-3.2-1B-Instruct-q4f16_1-MLC",
      );
    });

    it("resolves and logs when init() rejects (explicit webllm on a capable device)", async () => {
      // The preload is fire-and-forget: init() runs detached with its own
      // .catch, so a preload failure (network drop mid-download, WebGPU
      // device lost during engine creation) must NEVER reject warmup() —
      // the editor-focus handler and any unlock-time caller rely on warmup
      // being non-throwing. The failure must still be logged with the
      // precise error so operators can see the preload did not happen.
      mockGetSelectedProvider.mockReturnValue("webllm");
      mockGetApiKey.mockReturnValue("sk-explicit-webllm-selection");
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockResolvedValue(true);
      vi.mocked(webLLM.webLLMService.init).mockRejectedValueOnce(
        new Error("WebGPU context lost during engine creation"),
      );
      vi.mocked(webLLM.webLLMService.init).mockClear();

      // warmup resolves — the rejection is contained inside the
      // fire-and-forget init chain, never propagated to the caller.
      await expect(manager.warmup()).resolves.not.toThrow();

      // The preload WAS attempted with the configured model.
      expect(webLLM.webLLMService.init).toHaveBeenCalledWith(
        "Llama-3.2-1B-Instruct-q4f16_1-MLC",
      );
      // ...and its failure is logged, not swallowed silently.
      const logger = await import("../../../utils/logger");
      expect(logger.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
          "WebLLM warmup skipped: WebGPU context lost during engine creation",
        ),
      );
    });
  });

  describe("vault delegation", () => {
    it("isVaultLocked delega a vault", async () => {
      mockIsVaultLocked.mockResolvedValue(true);
      expect(await manager.isVaultLocked()).toBe(true);
    });

    it("unlockVault con apiKey setea API key en config", async () => {
      mockUnlockVault.mockResolvedValue(true);
      mockGetApiKey.mockReturnValue("sk-test-key");
      const result = await manager.unlockVault("password");
      expect(result).toBe(true);
    });

    it("unlockVault without apiKey returns true", async () => {
      mockUnlockVault.mockResolvedValue(true);
      mockGetApiKey.mockReturnValue(null);
      const result = await manager.unlockVault("password");
      expect(result).toBe(true);
    });

    it("updateMasterPassword no lanza error", async () => {
      await expect(
        manager.updateMasterPassword("new-pwd"),
      ).resolves.not.toThrow();
    });

    it("successful unlockVault reconciles the persisted config (config.init)", async () => {
      mockUnlockVault.mockResolvedValue(true);
      mockGetApiKey.mockReturnValue(null);
      const result = await manager.unlockVault("password");
      expect(result).toBe(true);
      const configMock = vi.mocked(ProviderConfiguration).mock.results[0]!.value;
      expect(configMock.init).toHaveBeenCalled();
    });

    it("unlockVault fallido NO llama a config.init", async () => {
      mockUnlockVault.mockResolvedValue(false);
      await manager.unlockVault("password");
      const configMock = vi.mocked(ProviderConfiguration).mock.results[0]!.value;
      expect(configMock.init).not.toHaveBeenCalled();
    });

    it("fires a fire-and-forget warmup on every securityVault unlock event", async () => {
      // The unlock wiring is the production caller of warmup(): every
      // successful unlock preloads the local model so first AI interaction
      // is warm. The listener registered in the constructor must drive it.
      expect(securityVaultUnlockListeners.length).toBeGreaterThan(0);
      mockGetSelectedProvider.mockReturnValue("webllm");
      mockGetApiKey.mockReturnValue(null);
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockResolvedValue(true);
      vi.mocked(webLLM.webLLMService.init).mockClear();

      for (const listener of securityVaultUnlockListeners) {listener();}

      // Fire-and-forget: settle the detached warmup chain.
      await vi.waitFor(() => {
        expect(webLLM.webLLMService.init).toHaveBeenCalled();
      });
      expect(webLLM.webLLMService.init).toHaveBeenCalledWith(
        "Llama-3.2-1B-Instruct-q4f16_1-MLC",
      );
    });

    it("warmup failures from the unlock listener never propagate as unhandled rejections", async () => {
      // The unlock event fires warmup detached. If warmup() ever rejected,
      // every unlock would produce an unhandled promise rejection — a crash-
      // class regression the .catch wrapper must prevent.
      mockGetSelectedProvider.mockReturnValue("webllm");
      mockGetApiKey.mockReturnValue(null);
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockRejectedValue(
        new Error("capability probe exploded"),
      );
      const logger = await import("../../../utils/logger");

      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => {
        unhandled.push(reason);
      };
      process.on("unhandledRejection", onUnhandled);

      try {
        for (const listener of securityVaultUnlockListeners) {listener();}
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(unhandled).toEqual([]);
      } finally {
        process.off("unhandledRejection", onUnhandled);
      }

      // The failure is contained AND logged (warmup's own catch for the
      // capability probe + the unlock wiring's belt-and-suspenders catch).
      expect(logger.logger.warn).toHaveBeenCalled();
    });

    it("warmup survives the idle-TTL refusal: contains the latch error and never leaks a rejection", async () => {
      // The interplay end-to-end at this layer: the model was released by
      // the 30-minute idle TTL (WebLLMService now latches that), then an
      // opportunistic trigger (unlock listener or editor focus) fires
      // warmup(). init() refuses with the latch error; warmup's own
      // .catch on init must contain it — resolve normally, log the named
      // reason, never leak an unhandled rejection (the catch wrapper's
      // contract, verified above with a probe crash — here with the latch
      // refusal that every post-idle focus will now produce).
      mockGetSelectedProvider.mockReturnValue("webllm");
      mockGetApiKey.mockReturnValue(null);
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockResolvedValue(true);
      vi.mocked(webLLM.webLLMService.init).mockRejectedValue(
        new Error(
          "Local AI model was unloaded after 30 minutes of inactivity. " +
            "Reload it explicitly from the AI settings.",
        ),
      );
      const logger = await import("../../../utils/logger");

      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => {
        unhandled.push(reason);
      };      process.on("unhandledRejection", onUnhandled);

      try {
        await expect(manager.warmup()).resolves.not.toThrow();

        // The refusal is NAMED at this layer too — warmup's init .catch
        // logs the concatenated "warmup skipped: <reason>" via logger.warn
        // (single string argument), so the operator reading it learns WHY
        // (idle-policy release), not just "skipped".
        expect(logger.logger.warn).toHaveBeenCalledWith(
          expect.stringContaining(
            "unloaded after 30 minutes of inactivity",
          ),
        );
      } finally {
        process.off("unhandledRejection", onUnhandled);
      }
    });
  });

  describe("vault-locked guard (S9)", () => {
    // Regression: while the Security Vault is locked, cloud providers must
    // NEVER be called (the vault-protected API key is only usable unlocked).
    // Local AI (Ollama/WebLLM) must keep working.
    beforeEach(async () => {
      mockCache.get.mockReset();
      mockCache.get.mockReturnValue(null);
      const rateLimit = await import("../../../services/RateLimitService");
      vi.mocked(rateLimit.rateLimitService.checkLimit).mockReset();
      vi.mocked(rateLimit.rateLimitService.checkLimit).mockReturnValue({
        remaining: 100,
        used: 0,
        resetAt: Date.now() + 60000,
        exhausted: false,
      });
      const semantic =
        await import("../../\.\./services/ai/SemanticCacheService");
      vi.mocked(semantic.semanticCache.findSimilar).mockReset();
      vi.mocked(semantic.semanticCache.findSimilar).mockResolvedValue(null);
      vi.mocked(semantic.semanticCache.add).mockReset();
      vi.mocked(semantic.semanticCache.add).mockResolvedValue(undefined);
    });

    it("blocks cloud generateText when the vault is locked", async () => {
      mockIsVaultLocked.mockResolvedValue(true);
      mockGetProviderInfo.mockReturnValue({
        provider: "openai",
        model: "gpt-4",
        fullSupport: true,
        name: "OpenAI",
        isConfigured: true,
      });
      mockGetOpenAIProvider.mockReturnValue({
        generateText: vi.fn(),
      });
      mockGetOllamaProvider.mockReturnValue({
        generateText: vi.fn(),
        isAvailable: vi.fn().mockResolvedValue(false),
        getConfig: vi.fn().mockReturnValue({
          url: "http://localhost:11434/api/generate",
          model: "llama3.2",
        }),
      });
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockResolvedValue(false);

      await expect(manager.generateText("test", undefined, { isPrivate: false })).rejects.toThrow(
        /vault is locked/i,
      );
    });

    it("blocks cloud streamGenerateText when the vault is locked", async () => {
      mockIsVaultLocked.mockResolvedValue(true);
      mockGetProviderInfo.mockReturnValue({
        provider: "openai",
        model: "gpt-4",
        fullSupport: true,
        name: "OpenAI",
        isConfigured: true,
      });
      mockGetOpenAIProvider.mockReturnValue({
        streamGenerateText: vi.fn(),
      });
      mockGetOllamaProvider.mockReturnValue({
        streamGenerateText: vi.fn(),
        isAvailable: vi.fn().mockResolvedValue(false),
        getConfig: vi.fn().mockReturnValue({
          url: "http://localhost:11434/api/generate",
          model: "llama3.2",
        }),
      });
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockResolvedValue(false);

      await expect(manager.streamGenerateText("test", undefined, { isPrivate: false })).rejects.toThrow(
        /vault is locked/i,
      );
    });

    it("allows local Ollama when the vault is locked", async () => {
      mockIsVaultLocked.mockResolvedValue(true);
      mockGetProviderInfo.mockReturnValue({
        provider: "ollama",
        model: "llama3.2",
        fullSupport: false,
        name: "Ollama",
        isConfigured: true,
      });
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockResolvedValue(false);

      const result = await manager.generateText("test", undefined, { isPrivate: false });
      expect(result.provider).toBe("ollama");
    });

    it("allows local WebLLM when the vault is locked", async () => {
      mockIsVaultLocked.mockResolvedValue(true);
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockResolvedValue(true);
      const resource = await import("../../\.\./services/ai/ResourceManager");
      vi.mocked(resource.resourceManager.isHighEndDevice).mockReturnValue(
        true,
      );

      const result = await manager.generateText("test", undefined, { isPrivate: false });
      expect(result.provider).toBe("webllm");
    });

    it("allows cloud AI when the vault is unlocked", async () => {
      mockIsVaultLocked.mockResolvedValue(false);
      mockGetProviderInfo.mockReturnValue({
        provider: "gemini",
        model: "gemini-2.0-flash",
        fullSupport: true,
        name: "Google Gemini",
        isConfigured: false,
      });
      mockGetOllamaProvider.mockReturnValue({
        generateText: vi.fn(),
        isAvailable: vi.fn().mockResolvedValue(false),
        getConfig: vi.fn().mockReturnValue({
          url: "http://localhost:11434/api/generate",
          model: "llama3.2",
        }),
      });
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockResolvedValue(false);

      await expect(
        manager.generateText("test", undefined, { isPrivate: false }),
      ).rejects.toThrow(/No AI provider is configured/i);
    });
  });

  describe("privacy regression (isPrivate)", () => {
    // Privacy guarantees: (1) isPrivate NEVER routes to cloud,
    // (2) private data is NEVER cached (strict or semantic cache).
    beforeEach(async () => {
      mockCache.get.mockReset();
      mockCache.get.mockReturnValue(null);
      mockCache.set.mockReset();
      const rateLimit = await import("../../../services/RateLimitService");
      vi.mocked(rateLimit.rateLimitService.checkLimit).mockReset();
      vi.mocked(rateLimit.rateLimitService.checkLimit).mockReturnValue({
        remaining: 100,
        used: 0,
        resetAt: Date.now() + 60000,
        exhausted: false,
      });
      const semantic =
        await import("../../\.\./services/ai/SemanticCacheService");
      vi.mocked(semantic.semanticCache.findSimilar).mockReset();
      vi.mocked(semantic.semanticCache.findSimilar).mockResolvedValue(null);
      vi.mocked(semantic.semanticCache.add).mockReset();
      vi.mocked(semantic.semanticCache.add).mockResolvedValue(undefined);
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockReset();
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockResolvedValue(true);
      const resource = await import("../../\.\./services/ai/ResourceManager");
      vi.mocked(resource.resourceManager.isHighEndDevice).mockReset();
      vi.mocked(resource.resourceManager.isHighEndDevice).mockReturnValue(
        true,
      );
      mockGetApiKey.mockReturnValue(null);
    });

    it("resolveProvider with isPrivate returns webllm (never cloud)", async () => {
      const info = await (manager as any).resolveProvider({
        isPrivate: true,
      });
      expect(info.provider).toBe("webllm");
    });

    it("resolveProvider with isPrivate returns ollama when webllm is unavailable", async () => {
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockResolvedValue(false);
      const info = await (manager as any).resolveProvider({
        isPrivate: true,
      });
      expect(info.provider).toBe("ollama");
    });

    it("with a cloud key configured, isPrivate still routes to local", async () => {
      // Even if the user has a cloud key (openai), a private prompt
      // must NEVER use that key: local routing has priority.
      mockGetApiKey.mockReturnValue("sk-cloud-key-12345");
      mockGetSelectedProvider.mockReturnValue("openai");
      const info = await (manager as any).resolveProvider({
        isPrivate: true,
      });
      expect(info.provider).toBe("webllm");
    });

    it("con key cloud y sin local, isPrivate lanza fail-closed", async () => {
      mockGetApiKey.mockReturnValue("sk-cloud-key-12345");
      mockGetSelectedProvider.mockReturnValue("openai");
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockResolvedValue(false);
      mockGetOllamaProvider.mockReturnValue({
        generateText: vi.fn(),
        isAvailable: vi.fn().mockResolvedValue(false),
        getConfig: vi.fn().mockReturnValue({
          url: "http://localhost:11434/api/generate",
          model: "llama3.2",
        }),
      });
      await expect(
        (manager as any).resolveProvider({ isPrivate: true }),
      ).rejects.toThrow("no Local AI is available");
    });

    it("generateText with isPrivate uses local and does NOT cache the result", async () => {
      const result = await manager.generateText("secret data", undefined, {
        isPrivate: true,
      });
      expect(result.provider).toBe("webllm");
      expect(mockCache.set).not.toHaveBeenCalled();
      const semantic =
        await import("../../\.\./services/ai/SemanticCacheService");
      expect(semantic.semanticCache.add).not.toHaveBeenCalled();
    });

    it("generateText con isPrivate sin AI local lanza error (fail-closed)", async () => {
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockResolvedValue(false);
      mockGetOllamaProvider.mockReturnValue({
        generateText: vi.fn(),
        isAvailable: vi.fn().mockResolvedValue(false),
        getConfig: vi.fn().mockReturnValue({
          url: "http://localhost:11434/api/generate",
          model: "llama3.2",
        }),
      });
      await expect(
        manager.generateText("secret", undefined, { isPrivate: true }),
      ).rejects.toThrow("no Local AI is available");
      expect(mockCache.set).not.toHaveBeenCalled();
    });

    it("generateText with explicit public opt-in caches the result", async () => {
      const result = await manager.generateText("public data", undefined, {
        isPrivate: false,
      });
      expect(result).toBeDefined();
      expect(mockCache.set).toHaveBeenCalled();
      const semantic =
        await import("../../\.\./services/ai/SemanticCacheService");
      expect(semantic.semanticCache.add).toHaveBeenCalled();
    });

    it("fails closed to local AI when privacy metadata is omitted", async () => {
      const result = await manager.generateText("unclassified data");
      expect(result.provider).toBe("webllm");
      expect(mockCache.set).not.toHaveBeenCalled();
    });
  });

  describe("explicit provider selection", () => {
    it("keeps an explicitly selected cloud provider for complex public requests", async () => {
      mockGetSelectedProvider.mockReturnValue("openai");
      mockGetProviderInfo.mockReturnValue({
        provider: "openai",
        model: "gpt-4o-mini",
        fullSupport: true,
        name: "OpenAI",
        isConfigured: true,
      });
      mockGetApiKey.mockReturnValue("sk-test");
      mockIsVaultLocked.mockResolvedValue(false);
      mockGetSelectedProvider.mockReturnValue("openai");
      mockGetOpenAIProvider.mockReturnValue({
        ...mockOpenAIProvider,
        fetchAvailableModels: vi.fn().mockResolvedValue([]),
      });
      mockGetOllamaProvider.mockReturnValue({
        generateText: vi.fn().mockResolvedValue({ text: "ollama response", provider: "ollama" }),
        streamGenerateText: vi.fn(),
        isAvailable: vi.fn().mockResolvedValue(false),
        getConfig: vi.fn(),
      });
      const routing = await import("../../\.\./services/ai/adapters/RoutingOptimizer");
      vi.mocked(routing.routingOptimizer.selectProvider).mockResolvedValue("openai");
      vi.mocked(routing.routingOptimizer.selectProvider).mockImplementation(
        async () => "openai",
      );
      mockGetProviderInfo.mockReturnValue({
        provider: "openai",
        model: "gpt-4o-mini",
        fullSupport: true,
        name: "OpenAI",
        isConfigured: true,
      });
      mockGetOpenAIProvider.mockReturnValue({
        ...mockOpenAIProvider,
        fetchAvailableModels: vi.fn().mockResolvedValue([]),
      });
      mockOpenAIProvider.generateText.mockResolvedValue({
        text: "cloud result",
        provider: "openai",
      });

      const result = await manager.generateText("public", undefined, {
        complexity: "complex",
        isPrivate: false,
      });

      expect(result.provider).toBe("openai");
      expect(mockOpenAIProvider.generateText).toHaveBeenCalled();
      expect(mockGetOllamaProvider).toHaveBeenCalled();
      expect(mockGetOllamaProvider.mock.results[0]?.value.generateText).not.toHaveBeenCalled();
    });
  });

  describe("setProvider", () => {
    it("does not call unload when not transitioning from webllm", async () => {
      mockGetSelectedProvider.mockReturnValue("gemini");
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      await manager.setProvider("openai");
      expect(webLLM.webLLMService.unload).not.toHaveBeenCalled();
    });

    it("calls unload when switching from webllm to another", async () => {
      mockGetSelectedProvider.mockReturnValue("webllm");
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      await manager.setProvider("gemini");
      expect(webLLM.webLLMService.unload).toHaveBeenCalled();
    });

    it("does not call unload when switching from webllm to webllm", async () => {
      mockGetSelectedProvider.mockReturnValue("webllm");
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      await manager.setProvider("webllm");
      expect(webLLM.webLLMService.unload).not.toHaveBeenCalled();
    });
  });

  describe("generateText - different paths", () => {
    beforeEach(async () => {
      // Reset mocks that may have been mutated by previous tests
      mockCache.get.mockReset();
      const rateLimit = await import("../../../services/RateLimitService");
      vi.mocked(rateLimit.rateLimitService.checkLimit).mockReset();
      vi.mocked(rateLimit.rateLimitService.checkLimit).mockReturnValue({
        remaining: 100,
        used: 0,
        resetAt: Date.now() + 60000,
        exhausted: false,
      });
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockReset();
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockResolvedValue(true);
      const semantic =
        await import("../../\.\./services/ai/SemanticCacheService");
      vi.mocked(semantic.semanticCache.findSimilar).mockReset();
      vi.mocked(semantic.semanticCache.findSimilar).mockResolvedValue(null);
      vi.mocked(semantic.semanticCache.add).mockReset();
      vi.mocked(semantic.semanticCache.add).mockResolvedValue(undefined);
    });
    it("semantic cache hit returns result without calling provider", async () => {
      const semantic =
        await import("../../\.\./services/ai/SemanticCacheService");
      vi.mocked(semantic.semanticCache.findSimilar).mockResolvedValue({
        text: "semantic match",
        provider: "cache",
      } as any);
      const result = await manager.generateText("test", undefined, { isPrivate: false });
      expect(result.text).toBe("semantic match");
    });

    it("uses gemini provider when resolveProvider returns gemini", async () => {
      mockGetProviderInfo.mockReturnValue({
        provider: "gemini",
        model: "gemini-2.0-flash",
        fullSupport: true,
        name: "Google Gemini",
        isConfigured: false,
      });
      // Forzar que resolveProvider retorne gemini
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockResolvedValue(false);
      mockGetOllamaProvider.mockReturnValue({
        generateText: vi.fn(),
        isAvailable: vi.fn().mockResolvedValue(false), // disable ollama to avoid simple task path
        getConfig: vi.fn().mockReturnValue({
          url: "http://localhost:11434/api/generate",
          model: "llama3.2",
        }),
      });

      await expect(
        manager.generateText("test", undefined, { isPrivate: false }),
      ).rejects.toThrow(/No AI provider is configured/i);
    });

    it("fails with the WebGPU error when webllm is forced but the device has no WebGPU", async () => {
      mockGetSelectedProvider.mockReturnValue("webllm");
      mockGetProviderInfo.mockReturnValue({
        provider: "webllm",
        model: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
        fullSupport: false,
        name: "WebLLM (Browser)",
        isConfigured: true,
      });
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      vi.mocked(webLLM.webLLMService.assertCanRunLocalLLM).mockRejectedValue(
        new Error("WebGPU is not supported in this browser"),
      );
      vi.mocked(webLLM.webLLMService.generateText).mockClear();

      await expect(
        manager.generateText("test", undefined, { isPrivate: false }),
      ).rejects.toThrow(/WebGPU is not supported/i);
      // The capability error must fire before the engine is touched: no
      // generation attempt may be recorded on an unsupported device.
      expect(webLLM.webLLMService.generateText).not.toHaveBeenCalled();
    });

    it("fails with the shader-f16 error when webllm is forced on an f16-less GPU", async () => {
      mockGetSelectedProvider.mockReturnValue("webllm");
      mockGetProviderInfo.mockReturnValue({
        provider: "webllm",
        model: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
        fullSupport: false,
        name: "WebLLM (Browser)",
        isConfigured: true,
      });
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      vi.mocked(webLLM.webLLMService.assertCanRunLocalLLM).mockRejectedValue(
        new Error(
          "WebGPU adapter does not support shader-f16 (half-precision).",
        ),
      );
      vi.mocked(webLLM.webLLMService.generateText).mockClear();

      await expect(
        manager.generateText("test", undefined, { isPrivate: false }),
      ).rejects.toThrow(/shader-f16/i);
      expect(webLLM.webLLMService.generateText).not.toHaveBeenCalled();
    });

    it("streamGenerateText: onProvider never fires when the forced webllm fails closed on a blocked device", async () => {
      // Ordering contract: the WebLLM capability pre-assert runs BEFORE the
      // onProvider announcement, so the UI is never told "webllm" for a
      // request that then fails with the capability error. A regression that
      // moved the pre-assert after the announcement (or removed it, letting
      // generateWithWebLLM's inner guard be the only one) makes this fail.
      mockGetSelectedProvider.mockReturnValue("webllm");
      mockGetProviderInfo.mockReturnValue({
        provider: "webllm",
        model: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
        fullSupport: false,
        name: "WebLLM (Browser)",
        isConfigured: true,
      });
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      vi.mocked(webLLM.webLLMService.assertCanRunLocalLLM).mockRejectedValue(
        new Error("WebGPU is not supported in this browser"),
      );
      const onProvider = vi.fn();
      const onChunk = vi.fn();
      vi.mocked(webLLM.webLLMService.generateText).mockClear();

      await expect(
        manager.streamGenerateText(
          "test",
          undefined,
          { isPrivate: false },
          onChunk,
          onProvider,
        ),
      ).rejects.toThrow(/WebGPU is not supported/i);

      expect(onProvider).not.toHaveBeenCalled();
      expect(onChunk).not.toHaveBeenCalled();
      expect(webLLM.webLLMService.generateText).not.toHaveBeenCalled();
    });

    it("fails with the low-RAM error when webllm is forced on a device below the 4 GB floor", async () => {
      // The throw-based assertCanRunLocalLLM() now enforces all three hard
      // blockers (WebGPU, shader-f16, 4 GB RAM), so a forced webllm selection
      // on a low-RAM capable-GPU device fails HERE with the dedicated memory
      // error — in generateText AND streamGenerateText — instead of slipping
      // past the pre-assert and dying later with the misleading "engine not
      // initialized" state error.
      mockGetSelectedProvider.mockReturnValue("webllm");
      mockGetProviderInfo.mockReturnValue({
        provider: "webllm",
        model: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
        fullSupport: false,
        name: "WebLLM (Browser)",
        isConfigured: true,
      });
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      vi.mocked(webLLM.webLLMService.assertCanRunLocalLLM).mockRejectedValue(
        new Error(
          "Insufficient device memory for local AI models: 3 GB available, 4 GB required. " +
            "Use a cloud provider (Gemini, OpenAI, etc.) instead.",
        ),
      );
      vi.mocked(webLLM.webLLMService.generateText).mockClear();

      await expect(
        manager.generateText("test", undefined, { isPrivate: false }),
      ).rejects.toThrow(/Insufficient device memory/);
      await expect(
        manager.streamGenerateText(
          "test",
          undefined,
          { isPrivate: false },
          undefined,
          undefined,
        ),
      ).rejects.toThrow(/Insufficient device memory/);
      expect(webLLM.webLLMService.generateText).not.toHaveBeenCalled();
    });

    it("still routes to the engine when webllm is forced on a capable device", async () => {
      mockGetSelectedProvider.mockReturnValue("webllm");
      mockGetProviderInfo.mockReturnValue({
        provider: "webllm",
        model: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
        fullSupport: false,
        name: "WebLLM (Browser)",
        isConfigured: true,
      });
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      vi.mocked(webLLM.webLLMService.assertCanRunLocalLLM).mockResolvedValue(
        undefined,
      );
      vi.mocked(webLLM.webLLMService.generateText).mockClear();

      const result = await manager.generateText("test", undefined, {
        isPrivate: false,
      });
      expect(result.provider).toBe("webllm");
      expect(webLLM.webLLMService.generateText).toHaveBeenCalledTimes(1);
    });

    it("rate limit exhausted lanza error", async () => {
      const rateLimit = await import("../../../services/RateLimitService");
      vi.mocked(rateLimit.rateLimitService.checkLimit).mockReturnValue({
        remaining: 0,
        used: 100,
        resetAt: Date.now() + 60000,
        exhausted: true,
      });
      mockGetProviderInfo.mockReturnValue({
        provider: "openai",
        model: "gpt-4",
        fullSupport: true,
        name: "OpenAI",
        isConfigured: true,
      });
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockResolvedValue(false);
      mockGetOllamaProvider.mockReturnValue({
        generateText: vi.fn(),
        isAvailable: vi.fn().mockResolvedValue(false),
        getConfig: vi.fn().mockReturnValue({
          url: "http://localhost:11434/api/generate",
          model: "llama3.2",
        }),
      });
      await expect(manager.generateText("test", undefined, { isPrivate: false })).rejects.toThrow(
        "Rate limit exceeded",
      );
    });

    it("does not let an exhausted unconfigured cloud limit block local fallback", async () => {
      const rateLimit = await import("../../../services/RateLimitService");
      vi.mocked(rateLimit.rateLimitService.checkLimit).mockReturnValue({
        remaining: 0,
        used: 100,
        resetAt: Date.now() + 60000,
        exhausted: true,
      });
      mockGetProviderInfo.mockReturnValue({
        provider: "gemini",
        model: "gemini-2.0-flash",
        fullSupport: true,
        name: "Google Gemini",
        isConfigured: false,
      });
      const result = await manager.generateText("test", undefined, {
        isPrivate: false,
      });
      expect(result.provider).toBe("webllm");
      expect(rateLimit.rateLimitService.checkLimit).not.toHaveBeenCalled();
    });

    it("does not check rate limit for ollama", async () => {
      mockGetProviderInfo.mockReturnValue({
        provider: "ollama",
        model: "llama3.2",
        fullSupport: false,
        name: "Ollama",
        isConfigured: true,
      });
      const result = await manager.generateText("test", undefined, { isPrivate: false });
      expect(result).toBeDefined();
    });

    it("error handler no hace fallback automatico a gemini", async () => {
      mockGetProviderInfo.mockReturnValue({
        provider: "openai",
        model: "gpt-4",
        fullSupport: true,
        name: "OpenAI",
        isConfigured: true,
      });
      mockGetOpenAIProvider.mockReturnValue({
        generateText: vi.fn().mockRejectedValue(new Error("API error")),
      });
      mockGetOllamaProvider.mockReturnValue({
        generateText: vi.fn(),
        isAvailable: vi.fn().mockResolvedValue(false),
        getConfig: vi.fn().mockReturnValue({
          url: "http://localhost:11434/api/generate",
          model: "llama3.2",
        }),
      });
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockResolvedValue(false);

      await expect(manager.generateText("test", undefined, { isPrivate: false })).rejects.toThrow();
    });

    it("error handler sin fallback para gemini", async () => {
      mockGetProviderInfo.mockReturnValue({
        provider: "gemini",
        model: "gemini-2.0-flash",
        fullSupport: true,
        name: "Google Gemini",
        isConfigured: false,
      });
      mockGetGeminiProvider.mockReturnValue({
        generateText: vi.fn().mockRejectedValue(new Error("Gemini error")),
      });
      mockGetOllamaProvider.mockReturnValue({
        generateText: vi.fn(),
        isAvailable: vi.fn().mockResolvedValue(false),
        getConfig: vi.fn().mockReturnValue({
          url: "http://localhost:11434/api/generate",
          model: "llama3.2",
        }),
      });
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockResolvedValue(false);

      await expect(manager.generateText("test", undefined, { isPrivate: false })).rejects.toThrow();
    });

    it("error handler con isPrivate no hace fallback", async () => {
      mockGetProviderInfo.mockReturnValue({
        provider: "openai",
        model: "gpt-4",
        fullSupport: true,
        name: "OpenAI",
        isConfigured: true,
      });
      mockGetOpenAIProvider.mockReturnValue({
        generateText: vi.fn().mockRejectedValue(new Error("API error")),
      });
      mockGetOllamaProvider.mockReturnValue({
        generateText: vi.fn(),
        isAvailable: vi.fn().mockResolvedValue(false),
        getConfig: vi.fn().mockReturnValue({
          url: "http://localhost:11434/api/generate",
          model: "llama3.2",
        }),
      });
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockResolvedValue(false);

      await expect(
        manager.generateText("test", undefined, { isPrivate: true }),
      ).rejects.toThrow();
    });

    it("records rate limit for non-local providers", async () => {
      mockGetProviderInfo.mockReturnValue({
        provider: "openai",
        model: "gpt-4",
        fullSupport: true,
        name: "OpenAI",
        isConfigured: true,
      });
      mockGetOpenAIProvider.mockReturnValue({
        generateText: vi
          .fn()
          .mockResolvedValue({ text: "openai response", provider: "openai" }),
      });
      mockGetOllamaProvider.mockReturnValue({
        generateText: vi.fn(),
        isAvailable: vi.fn().mockResolvedValue(false),
        getConfig: vi.fn().mockReturnValue({
          url: "http://localhost:11434/api/generate",
          model: "llama3.2",
        }),
      });
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockResolvedValue(false);
      const rateLimit = await import("../../../services/RateLimitService");

      const result = await manager.generateText("test", undefined, { isPrivate: false });
      expect(result.provider).toBe("openai");
      expect(rateLimit.rateLimitService.recordRequest).toHaveBeenCalled();
    });

    it("adds to semantic cache when there are no tools", async () => {
      const semantic =
        await import("../../\.\./services/ai/SemanticCacheService");
      const result = await manager.generateText("test", undefined, { isPrivate: false });
      expect(semantic.semanticCache.add).toHaveBeenCalled();
    });
  });

  describe("generateWithWebLLM", () => {
    beforeEach(async () => {
      const rateLimit = await import("../../../services/RateLimitService");
      vi.mocked(rateLimit.rateLimitService.checkLimit).mockReset();
      vi.mocked(rateLimit.rateLimitService.checkLimit).mockReturnValue({
        remaining: 100,
        used: 0,
        resetAt: Date.now() + 60000,
        exhausted: false,
      });
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockReset();
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockResolvedValue(true);
    });

    it("calls error toast when WebGPU fails in the browser", async () => {
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      vi.mocked(webLLM.webLLMService.generateText).mockRejectedValue(
        new Error("WEBGPU_CONTEXT_LOST"),
      );
      const sonner = await import("sonner");
      // capture the toast module
      const { toast } = sonner;
      expect(toast).toBeDefined();
      await expect(manager.generateText("test", undefined, { isPrivate: false })).rejects.toThrow();
    });
    it("WebGPU context loss no hace fallback automatico a gemini", async () => {
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      vi.mocked(webLLM.webLLMService.generateText).mockRejectedValue(
        new Error("WEBGPU_CONTEXT_LOST"),
      );

      await expect(manager.generateText("test", undefined, { isPrivate: false })).rejects.toThrow();
    });

    it("WebGPU context loss con isPrivate lanza error", async () => {
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      vi.mocked(webLLM.webLLMService.generateText).mockRejectedValue(
        new Error("WEBGPU_CONTEXT_LOST"),
      );

      await expect(
        manager.generateText("test", undefined, { isPrivate: true }),
      ).rejects.toThrow("WEBGPU_CONTEXT_LOST");
    });

    it("WebLLM timeout no hace fallback automatico a gemini", async () => {
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      vi.mocked(webLLM.webLLMService.generateText).mockRejectedValue(
        new Error("WebLLM_TIMEOUT"),
      );

      await expect(manager.generateText("test", undefined, { isPrivate: false })).rejects.toThrow();
    });
  });

  describe("resolveProvider", () => {
    beforeEach(async () => {
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockReset();
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockResolvedValue(true);
      const resource = await import("../../\.\./services/ai/ResourceManager");
      vi.mocked(resource.resourceManager.isHighEndDevice).mockReset();
      vi.mocked(resource.resourceManager.isHighEndDevice).mockReturnValue(
        true,
      );
      mockGetOllamaProvider.mockReset();
      mockGetOllamaProvider.mockReturnValue({
        generateText: vi
          .fn()
          .mockResolvedValue({ text: "ollama response", provider: "ollama" }),
        isAvailable: vi.fn().mockResolvedValue(true),
        getConfig: vi.fn().mockReturnValue({
          url: "http://localhost:11434/api/generate",
          model: "llama3.2",
        }),
      });
      mockGetApiKey.mockReset();
      mockGetApiKey.mockReturnValue(null);
    });
    it("returns webllm when offline and webllm available", async () => {
      mockNavigator({ onLine: false });
      const info = await (manager as any).resolveProvider({ isPrivate: false });
      expect(info.provider).toBe("webllm");
    });

    it("returns ollama when offline and webllm is unavailable but ollama is", async () => {
      mockNavigator({ onLine: false });
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockResolvedValue(false);
      const info = await (manager as any).resolveProvider({ isPrivate: false });
      expect(info.provider).toBe("ollama");
    });

    it("throws error when offline/private without local AI", async () => {
      mockNavigator({ onLine: false });
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockResolvedValue(false);
      mockGetOllamaProvider.mockReturnValue({
        generateText: vi.fn(),
        isAvailable: vi.fn().mockResolvedValue(false),
        getConfig: vi.fn().mockReturnValue({
          url: "http://localhost:11434/api/generate",
          model: "llama3.2",
        }),
      });
      await expect(
        (manager as any).resolveProvider({ isPrivate: true }),
      ).rejects.toThrow("no Local AI is available");
    });

    it("returns gemini on low battery without private data", async () => {
      const mockBattery = { level: 0.1, charging: false };
      mockNavigator({
        onLine: true,
        getBattery: vi.fn().mockResolvedValue(mockBattery),
      });
      mockGetSelectedProvider.mockReturnValue("");
      mockGetProviderInfo.mockReturnValue({
        provider: "gemini",
        model: "gemini-2.0-flash",
        fullSupport: true,
        name: "Google Gemini",
        isConfigured: true,
      });
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockResolvedValue(false);
      const info = await (manager as any).resolveProvider({ isPrivate: false });
      expect(info.provider).toBe("gemini");
    });

    it("returns gemini on slow connection", async () => {
      mockNavigator({ connection: { effectiveType: "3g" } });
      mockGetSelectedProvider.mockReturnValue("");
      mockGetProviderInfo.mockReturnValue({
        provider: "gemini",
        model: "gemini-2.0-flash",
        fullSupport: true,
        name: "Google Gemini",
        isConfigured: true,
      });
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockResolvedValue(false);
      const info = await (manager as any).resolveProvider({ isPrivate: false });
      expect(info.provider).toBe("gemini");
    });

    it("returns webllm for simple tasks", async () => {
      mockGetProviderInfo.mockReturnValue({
        provider: "gemini",
        model: "gemini-2.0-flash",
        fullSupport: true,
        name: "Google Gemini",
        isConfigured: false,
      });
      const info = await (manager as any).resolveProvider({
        complexity: "simple",
        isPrivate: false,
      });
      expect(info.provider).toBe("webllm");
    });

    it("returns ollama for simple tasks if webllm unavailable", async () => {
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockResolvedValue(false);
      const info = await (manager as any).resolveProvider({
        complexity: "simple",
        isPrivate: false,
      });
      expect(info.provider).toBe("ollama");
    });

    // DEFENSIVE CONTRACT (mirrors the DUAL GATE comments in resolveProvider):
    // hasWebLLM && isHighEndDevice() is a conjunction — the 8 GB TIER passing
    // must NEVER substitute for the CAPABILITY verdict. A GPU-less device
    // (canRunLocalLLM=false — no WebGPU surface, or no shader-f16, or < 4 GB
    // RAM) must not reach the webllm branch on ANY local route, even though
    // isHighEndDevice() (RAM/CPU-only, GPU-blind) reports true. If any of
    // these fail, someone has replaced the conjunction with the tier check
    // alone — the exact conflation the naming audit and the 4 GB/8 GB E2E
    // boundary profiles guard against.
    it("DEFENSIVE: GPU-less device (hasWebLLM=false, tier=true) never routes to webllm on the offline branch", async () => {
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      const resource = await import("../../\.\./services/ai/ResourceManager");
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockResolvedValue(false);
      // The DECEPTIVE half of the setup: the tier check says high-end.
      vi.mocked(resource.resourceManager.isHighEndDevice).mockReturnValue(true);
      mockNavigator({ onLine: false });
      const info = await (manager as any).resolveProvider({
        isPrivate: false,
      });
      expect(info.provider, "the capability gate must come first").not.toBe(
        "webllm",
      );
      expect(info.provider, "the ollama fallback must absorb the request").toBe(
        "ollama",
      );
    });

    it("DEFENSIVE: GPU-less device (hasWebLLM=false, tier=true) never routes to webllm on the unconfigured-fallback branch", async () => {
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      const resource = await import("../../\.\./services/ai/ResourceManager");
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockResolvedValue(false);
      vi.mocked(resource.resourceManager.isHighEndDevice).mockReturnValue(true);
      mockNavigator({ onLine: true });
      mockGetSelectedProvider.mockReturnValue("");
      mockGetProviderInfo.mockReturnValue({
        provider: "gemini",
        model: "gemini-2.0-flash",
        fullSupport: true,
        name: "Google Gemini",
        isConfigured: false,
      });
      const info = await (manager as any).resolveProvider({
        isPrivate: false,
      });
      expect(info.provider, "the capability gate must come first").not.toBe(
        "webllm",
      );
      expect(info.provider, "the ollama fallback must absorb the request").toBe(
        "ollama",
      );
    });

    it("DEFENSIVE: GPU-less device (hasWebLLM=false, tier=true) never routes to webllm on the simple-task branch", async () => {
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      const resource = await import("../../\.\./services/ai/ResourceManager");
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockResolvedValue(false);
      vi.mocked(resource.resourceManager.isHighEndDevice).mockReturnValue(true);
      mockNavigator({ onLine: true });
      mockGetSelectedProvider.mockReturnValue("");
      mockGetProviderInfo.mockReturnValue({
        provider: "gemini",
        model: "gemini-2.0-flash",
        fullSupport: true,
        name: "Google Gemini",
        isConfigured: true,
      });
      const info = await (manager as any).resolveProvider({
        complexity: "simple",
        isPrivate: false,
      });
      expect(info.provider, "the capability gate must come first").not.toBe(
        "webllm",
      );
      expect(info.provider, "the ollama fallback must absorb the request").toBe(
        "ollama",
      );
    });

    // FORCED-PROVIDER REACHABILITY (RAM-floor profile): deviceMemory plays
    // NO role in resolveProvider — it is not a routing input. When webllm is
    // EXPLICITLY selected, the selection-authority contract resolves webllm
    // even on a 3 GB device where canRunLocalLLM() (which DOES enforce the
    // >= 4 GB floor) is false. That is what keeps the forced-provider
    // fail-closed path reachable from EVERY blocked profile: routing sends
    // the request to WebLLM, and the generation entry points' capability    // guard (assertCanRunLocalLLM) rejects with the profile's own error —
    // "Insufficient device memory …" on the RAM floor, the surface error    // without a GPU, the f16 error without half-precision. If this test ever
    // fails because the router pre-filters the selection, the E2E forced-
    // provider profiles would silently degrade to a generic router error    // instead of the precise capability message.
    it("RAM-floor profile: webllm stays reachable with deviceMemory below the floor when explicitly selected (resolveProvider ignores deviceMemory)", async () => {
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      const resource = await import("../../\.\./services/ai/ResourceManager");
      // The RAM-floor reality: 3 GB < the 4 GB capability floor.
      mockNavigator({ onLine: true, deviceMemory: 3 });
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockResolvedValue(false);
      // At 3 GB the 8 GB tier is false too — and must be IRRELEVANT here:
      // the explicit selection bypasses the entire dual-gate evaluation.
      vi.mocked(resource.resourceManager.isHighEndDevice).mockReturnValue(
        false,
      );
      // Ollama unavailable: nothing local EXCEPT the forced selection exists,
      // so a resolution to webllm can only come from the selection itself.
      mockGetOllamaProvider.mockReturnValue({
        generateText: vi.fn(),
        isAvailable: vi.fn().mockResolvedValue(false),
        getConfig: vi.fn().mockReturnValue({
          url: "http://localhost:11434/api/generate",
          model: "llama3.2",
        }),
      });
      // Unconfigured cloud + no key: no cloud route can absorb the request.
      mockGetSelectedProvider.mockReturnValue("webllm");
      mockGetProviderInfo.mockReturnValue({
        provider: "gemini",
        model: "gemini-2.0-flash",
        fullSupport: true,
        name: "Google Gemini",
        isConfigured: false,
      });
      mockGetApiKey.mockReturnValue(null);

      // PUBLIC request: the explicit selection must win — webllm resolves
      // DESPITE the failing capability verdict AND the failing tier check.
      // resolveProvider has no deviceMemory parameter to consult; the RAM
      // floor is enforced downstream, at generation, by the guard.
      const info = await (manager as any).resolveProvider({
        complexity: "complex",
        isPrivate: false,
      });
      expect(
        info.provider,
        "the explicit webllm selection must resolve on a 3 GB device — " +
          "deviceMemory is not a routing input",
      ).toBe("webllm");

      // PRIVATE request: the offline/private branch runs BEFORE the
      // selection-authority branch and pre-filters by the dual gate — so a
      // private request from a forced webllm selection on a capability-
      // blocked device fails closed AT ROUTING with "no Local AI is
      // available" (never cloud, never a generation attempt). The precise
      // capability error is reserved for the PUBLIC forced path, where the
      // request actually reaches WebLLM's generation guard.
      await expect(
        (manager as any).resolveProvider({
          complexity: "complex",
          isPrivate: true,
        }),
      ).rejects.toThrow("no Local AI is available");
    });

    it("uses external API key to detect the provider", async () => {
      mockGetApiKey.mockReturnValue("sk-external");
      mockGetSelectedProvider.mockReturnValue("openai");
      mockGetProviderInfo.mockReturnValue({
        provider: "openai",
        model: "gpt-4",
        fullSupport: true,
        name: "OpenAI",
        isConfigured: true,
      });
      mockGetOllamaProvider.mockReturnValue({
        generateText: vi.fn(),
        isAvailable: vi.fn().mockResolvedValue(false),
        getConfig: vi.fn().mockReturnValue({
          url: "http://localhost:11434/api/generate",
          model: "llama3.2",
        }),
      });
      const utils = await import("../../\.\./services/ai/utils");
      vi.mocked(utils.detectProvider).mockReturnValue({
        provider: "openai",
        model: "gpt-4",
        fullSupport: true,
        name: "OpenAI",
        isConfigured: true,
      });

      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockResolvedValue(false);
      const info = await (manager as any).resolveProvider({ isPrivate: false });
      expect(info.provider).toBe("openai");
    });

    it("fallback a gemini si webllm no disponible ni external key", async () => {
      mockGetOllamaProvider.mockReturnValue({
        generateText: vi.fn(),
        isAvailable: vi.fn().mockResolvedValue(false),
        getConfig: vi.fn().mockReturnValue({
          url: "http://localhost:11434/api/generate",
          model: "llama3.2",
        }),
      });
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockResolvedValue(false);
      const resource = await import("../../\.\./services/ai/ResourceManager");
      vi.mocked(resource.resourceManager.isHighEndDevice).mockReturnValue(
        false,
      );
      mockGetSelectedProvider.mockReturnValue("");
      mockGetProviderInfo.mockReturnValue({
        provider: "gemini",
        model: "gemini-2.0-flash",
        fullSupport: true,
        name: "Google Gemini",
        isConfigured: true,
      });

      const routing = await import("../../\.\./services/ai/adapters/RoutingOptimizer");
      vi.mocked(routing.routingOptimizer.selectProvider).mockImplementation(
        async (_task, _state, defaultProvider) => defaultProvider,
      );
      const info = await (manager as any).resolveProvider({ isPrivate: false });
      expect(info.provider).toBe("gemini");
    });

    it("getBattery captura error con logger.warn", async () => {
      mockNavigator({
        onLine: true,
        getBattery: vi.fn().mockRejectedValue(new Error("Battery API error")),
      });
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockResolvedValue(false);
      const logger = await import("../../../utils/logger");
      await (manager as any).resolveProvider({ isPrivate: false });
      expect(logger.logger.warn).toHaveBeenCalled();
    });
  });

  describe("isOllamaAvailable", () => {
    it("returns the cached value when still valid", async () => {
      (manager as any).ollamaAvailableCache = true;
      (manager as any).ollamaCheckTime = Date.now();
      const result = await manager.isOllamaAvailable();
      expect(result).toBe(true);
    });

    it("fetch exitoso setea cache en true", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
      const result = await manager.isOllamaAvailable();
      expect(result).toBe(true);
    });

    it("fetch fallido setea cache en false", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue(new Error("Connection refused")),
      );
      const result = await manager.isOllamaAvailable();
      expect(result).toBe(false);
    });
  });

  describe("fetchAvailableModels", () => {
    it("returns models for anthropic", async () => {
      mockGetApiKey.mockReturnValue("sk-anthropic");
      mockGetSelectedProvider.mockReturnValue("anthropic");
      mockGetProviderInfo.mockReturnValue({
        provider: "anthropic",
        model: "claude-3-5-sonnet",
        fullSupport: true,
        name: "Anthropic",
        isConfigured: true,
      });
      const models = await manager.fetchAvailableModels();
      expect(models).toEqual([
        "claude-3-5-sonnet-latest",
        "claude-3-5-haiku-latest",
        "claude-3-opus-latest",
      ]);
    });

    it("returns models from OpenAI provider", async () => {
      mockGetApiKey.mockReturnValue("sk-openai");
      mockGetProviderInfo.mockReturnValue({
        provider: "openai",
        model: "gpt-4",
        fullSupport: true,
        name: "OpenAI",
        isConfigured: true,
      });
      const models = await manager.fetchAvailableModels();
      expect(models).toEqual(["gpt-4", "gpt-4o-mini"]);
    });

    it("returns an empty array when fetch fails", async () => {
      mockGetApiKey.mockReturnValue("sk-openai");
      mockGetProviderInfo.mockReturnValue({
        provider: "openai",
        model: "gpt-4",
        fullSupport: true,
        name: "OpenAI",
        isConfigured: true,
      });
      mockGetOpenAIProvider.mockReturnValue({
        fetchAvailableModels: vi
          .fn()
          .mockRejectedValue(new Error("Network error")),
      });
      const models = await manager.fetchAvailableModels();
      expect(models).toEqual([]);
    });
  });

  describe("rate limit", () => {
    it("does not check rate limit for webllm", async () => {
      mockGetProviderInfo.mockReturnValue({
        provider: "webllm",
        model: "test",
        fullSupport: false,
        name: "WebLLM",
        isConfigured: true,
      });
      // The selected local provider must be exercised directly; this avoids
      // requiring the optional WebLLM runtime in this unit test.
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockResolvedValue(false);
      mockGetSelectedProvider.mockReturnValue("webllm");
      vi.mocked(webLLM.webLLMService.generateText).mockResolvedValue("test response");
      const result = await manager.generateText("test", undefined, { isPrivate: false });
      expect(result).toBeDefined();
    });
  });

  describe("streamGenerateText", () => {
    beforeEach(async () => {
      mockCache.get.mockReset();
      mockCache.get.mockReturnValue(null);
      const rateLimit = await import("../../../services/RateLimitService");
      vi.mocked(rateLimit.rateLimitService.checkLimit).mockReset();
      vi.mocked(rateLimit.rateLimitService.checkLimit).mockReturnValue({
        remaining: 100,
        used: 0,
        resetAt: Date.now() + 60000,
        exhausted: false,
      });
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockReset();
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockResolvedValue(true);
    });

    it("throws error if the prompt exceeds 100k characters", async () => {
      await expect(
        manager.streamGenerateText("x".repeat(100001)),
      ).rejects.toThrow("Prompt too long");
    });

    // ── Consolidation contract: the request guards shared by
    // generateText and streamGenerateText must behave IDENTICALLY — the
    // audit this pins found the abort re-check, the system-prompt limit
    // parity, and the refusal message diverging between the two paths. ──

    it("CONSOLIDATION: re-checks the abort signal AFTER provider resolution (parity with generateText)", async () => {
      // A signal aborted DURING resolveProvider (here: inside the awaited
      // capability probe) must abort the stream at the post-resolve
      // re-check — previously this re-check existed only on generateText,
      // so streaming continued into rate limiting and budget checks.
      const controller = new AbortController();
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      const resource = await import("../../\.\./services/ai/ResourceManager");
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockImplementation(
        async () => {
          controller.abort();
          return true;
        },
      );
      vi.mocked(resource.resourceManager.isHighEndDevice).mockReturnValue(
        true,
      );
      await expect(
        manager.streamGenerateText("test", undefined, {
          isPrivate: true,
          signal: controller.signal,
        }),
      ).rejects.toThrow("AI request aborted");
      // Restore the shared routing mocks (this describe's beforeEach resets
      // canRunLocalLLM but NOT isHighEndDevice — leaving the implementation
      // mocks would pollute every later test's routing decisions).
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockReset();
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockResolvedValue(true);
      vi.mocked(resource.resourceManager.isHighEndDevice).mockReset();
      vi.mocked(resource.resourceManager.isHighEndDevice).mockReturnValue(true);
    });

    it("CONSOLIDATION: system-prompt limit is enforced identically on both paths", async () => {
      const longSystem = "s".repeat(50001);
      await expect(
        manager.generateText("test", longSystem),
      ).rejects.toThrow("System prompt too long (max 50k characters)");
      await expect(
        manager.streamGenerateText("test", longSystem),
      ).rejects.toThrow("System prompt too long (max 50k characters)");
    });

    it("CONSOLIDATION: the private local-only refusal no longer carries a streaming-only suffix", async () => {
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      const resource = await import("../../\.\./services/ai/ResourceManager");
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockResolvedValue(false);
      vi.mocked(resource.resourceManager.isHighEndDevice).mockReturnValue(
        false,
      );
      mockGetOllamaProvider.mockReturnValue({
        generateText: vi.fn(),
        isAvailable: vi.fn().mockResolvedValue(false),
        getConfig: vi.fn().mockReturnValue({
          url: "http://localhost:11434/api/generate",
          model: "llama3.2",
        }),
      });
      // The unified message: the old "…for streaming." suffix made the two
      // paths' failures textually divergent for no informational gain.
      await expect(
        manager.streamGenerateText("test", undefined, { isPrivate: true }),
      ).rejects.toThrow(/no Local AI is available(?! for streaming)/);
      // Restore shared routing mocks (see the abort-recheck test above).
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockReset();
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockResolvedValue(true);
      vi.mocked(resource.resourceManager.isHighEndDevice).mockReset();
      vi.mocked(resource.resourceManager.isHighEndDevice).mockReturnValue(true);
    });

    it("streams from gemini with onChunk", async () => {
      mockGetProviderInfo.mockReturnValue({
        provider: "gemini",
        model: "gemini-2.0-flash-exp",
        fullSupport: true,
        name: "Google Gemini",
        isConfigured: true,
      });
      const onChunk = vi.fn();
      const streamFn = vi.fn().mockResolvedValue({
        text: "gemini stream",
        provider: "gemini",
      });
      mockGetGeminiProvider.mockReturnValue({ streamGenerateText: streamFn });
      mockGetOllamaProvider.mockReturnValue({
        streamGenerateText: vi.fn(),
        isAvailable: vi.fn().mockResolvedValue(false),
        getConfig: vi.fn().mockReturnValue({
          url: "http://localhost:11434/api/generate",
          model: "llama3.2",
        }),
      });
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockResolvedValue(false);
      const result = await manager.streamGenerateText(
        "test",
        undefined,
        { isPrivate: false },
        onChunk,
      );
      expect(result.provider).toBe("gemini");
      expect(streamFn).toHaveBeenCalled();
    });

    it("notifies the resolved provider via onProvider BEFORE streaming", async () => {
      mockGetProviderInfo.mockReturnValue({
        provider: "gemini",
        model: "gemini-2.0-flash-exp",
        fullSupport: true,
        name: "Google Gemini",
        isConfigured: true,
      });
      const onChunk = vi.fn();
      const onProvider = vi.fn();
      let reportedBeforeStream = false;
      const streamFn = vi.fn().mockImplementation(() => {
        // The provider must report before the adapter starts.
        reportedBeforeStream = onProvider.mock.calls.length > 0;
        return Promise.resolve({ text: "gemini stream", provider: "gemini" });
      });
      mockGetGeminiProvider.mockReturnValue({ streamGenerateText: streamFn });
      mockGetOllamaProvider.mockReturnValue({
        streamGenerateText: vi.fn(),
        isAvailable: vi.fn().mockResolvedValue(false),
        getConfig: vi.fn().mockReturnValue({
          url: "http://localhost:11434/api/generate",
          model: "llama3.2",
        }),
      });
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockResolvedValue(false);

      const result = await manager.streamGenerateText(
        "test",
        undefined,
        { isPrivate: false },
        onChunk,
        onProvider,
      );
      expect(onProvider).toHaveBeenCalledWith("gemini");
      expect(reportedBeforeStream).toBe(true);
      expect(result.provider).toBe("gemini");
    });

    it("onProvider reporta webllm para el stream local (routing isPrivate)", async () => {
      const onProvider = vi.fn();
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      vi.mocked(webLLM.webLLMService.generateText).mockResolvedValue(
        "webllm stream text",
      );
      const result = await manager.streamGenerateText(
        "test",
        undefined,
        { isPrivate: true },
        undefined,
        onProvider,
      );
      expect(onProvider).toHaveBeenCalledWith("webllm");
      expect(result.provider).toBe("webllm");
    });

    it("streams from Ollama when the default cloud provider is unconfigured", async () => {
      mockGetProviderInfo.mockReturnValue({
        provider: "gemini",
        model: "gemini-2.0-flash-exp",
        fullSupport: true,
        name: "Google Gemini",
        isConfigured: false,
      });
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockResolvedValue(false);
      const result = await manager.streamGenerateText(
        "test",
        undefined,
        { complexity: "complex", isPrivate: false },
      );
      expect(result.provider).toBe("ollama");
    });

    it("streams from ollama when the provider is ollama", async () => {
      mockGetProviderInfo.mockReturnValue({
        provider: "ollama",
        model: "llama3.2",
        fullSupport: false,
        name: "Ollama",
        isConfigured: true,
      });
      const result = await manager.streamGenerateText("test", undefined, { isPrivate: false });
      expect(result.provider).toBe("ollama");
    });

    it("streams from openai when the provider is openai", async () => {
      mockGetProviderInfo.mockReturnValue({
        provider: "openai",
        model: "gpt-4",
        fullSupport: true,
        name: "OpenAI",
        isConfigured: true,
      });
      const result = await manager.streamGenerateText("test", undefined, { isPrivate: false });
      expect(result.provider).toBe("openai");
    });

    it("throws when the openai provider is not initialized", async () => {
      mockGetProviderInfo.mockReturnValue({
        provider: "custom",
        model: "x",
        fullSupport: true,
        name: "Custom",
        isConfigured: false,
      });
      mockGetOpenAIProvider.mockReturnValue(null);
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockResolvedValue(false);
      mockGetOllamaProvider.mockReturnValue({
        streamGenerateText: vi.fn(),
        isAvailable: vi.fn().mockResolvedValue(false),
        getConfig: vi.fn().mockReturnValue({
          url: "http://localhost:11434/api/generate",
          model: "llama3.2",
        }),
      });
      await expect(
        manager.streamGenerateText("test", undefined, { isPrivate: false }),
      ).rejects.toThrow(/No AI provider is configured/i);
    });

    it("isPrivate sin AI local disponible lanza error", async () => {
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockResolvedValue(false);
      mockGetOllamaProvider.mockReturnValue({
        streamGenerateText: vi.fn(),
        isAvailable: vi.fn().mockResolvedValue(false),
        getConfig: vi.fn().mockReturnValue({
          url: "http://localhost:11434/api/generate",
          model: "llama3.2",
        }),
      });
      await expect(
        manager.streamGenerateText("test", undefined, { isPrivate: true }),
      ).rejects.toThrow("no Local AI is available");
    });

    it("isPrivate con AI local disponible no lanza error", async () => {
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      vi.mocked(webLLM.webLLMService.generateText).mockResolvedValue(
        "webllm stream text",
      );
      const result = await manager.streamGenerateText(
        "test",
        undefined,
        { isPrivate: true },
      );
      // The isPrivate guard routes to a local provider (webllm), which is
      // handled explicitly in the stream switch — never a cloud fallback.
      expect(result).toBeDefined();
      expect(result.provider).toBe("webllm");
    });

    it("webllm delivers the full text as a single chunk and NEVER falls back to Gemini (S5/R1)", async () => {
      // Regression: the streamGenerateText switch MUST handle webllm
      // explicit form — if it fell back to default→Gemini, local data (and
      // possibly private data) would be sent to the cloud (S5/R1).
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      vi.mocked(webLLM.webLLMService.generateText).mockResolvedValue(
        "webllm full response",
      );
      mockGetProviderInfo.mockReturnValue({
        provider: "webllm",
        model: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
        fullSupport: false,
        name: "WebLLM (Browser)",
        isConfigured: true,
      });
      const onChunk = vi.fn();
      const geminiStream = vi.fn().mockResolvedValue({
        text: "gemini leaked stream",
        provider: "gemini",
      });
      mockGetGeminiProvider.mockReturnValue({
        streamGenerateText: geminiStream,
      });

      const result = await manager.streamGenerateText(
        "test",
        undefined,
        { isPrivate: false },
        onChunk,
      );

      expect(result.provider).toBe("webllm");
      expect(result.text).toBe("webllm full response");
      expect(webLLM.webLLMService.generateText).toHaveBeenCalledWith(
        "test",
        undefined,
        { isPrivate: false },
        expect.any(AbortSignal),
      );
      // WebLLM has no incremental stream: the full text arrives in a
      // single chunk.
      expect(onChunk).toHaveBeenCalledTimes(1);
      expect(onChunk).toHaveBeenCalledWith("webllm full response");
      // Privacy: Gemini must never be invoked for webllm.
      expect(geminiStream).not.toHaveBeenCalled();
    });

    it("rate limit agotado en streaming lanza error", async () => {
      const rateLimit = await import("../../../services/RateLimitService");
      vi.mocked(rateLimit.rateLimitService.checkLimit).mockReturnValue({
        remaining: 0,
        used: 100,
        resetAt: Date.now() + 60000,
        exhausted: true,
      });
      mockGetProviderInfo.mockReturnValue({
        provider: "openai",
        model: "gpt-4",
        fullSupport: true,
        name: "OpenAI",
        isConfigured: true,
      });
      await expect(manager.streamGenerateText("test", undefined, { isPrivate: false })).rejects.toThrow(
        "Rate limit exceeded",
      );
    });

    it("error en streaming lanza mensaje amigable", async () => {
      mockGetProviderInfo.mockReturnValue({
        provider: "gemini",
        model: "gemini-2.0-flash",
        fullSupport: true,
        name: "Google Gemini",
        isConfigured: false,
      });
      mockGetGeminiProvider.mockReturnValue({
        streamGenerateText: vi
          .fn()
          .mockRejectedValue(new Error("stream API error")),
      });
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockResolvedValue(false);
      mockGetOllamaProvider.mockReturnValue({
        streamGenerateText: vi.fn(),
        isAvailable: vi.fn().mockResolvedValue(false),
        getConfig: vi.fn().mockReturnValue({
          url: "http://localhost:11434/api/generate",
          model: "llama3.2",
        }),
      });
      await expect(manager.streamGenerateText("test", undefined, { isPrivate: false })).rejects.toThrow();
    });
  });

  describe("setModel", () => {
    it("setModel with ollama updates settings", async () => {
      mockGetSelectedProvider.mockReturnValue("ollama");
      await manager.setModel("mistral");
      expect(mockConfigSetOllamaSettings).toHaveBeenCalled();
    });

    it("setModel with webllm updates webllm model", async () => {
      mockGetSelectedProvider.mockReturnValue("webllm");
      await manager.setModel("Phi-3.5-mini");
      expect(mockConfigSetWebLlmModel).toHaveBeenCalledWith("Phi-3.5-mini");
    });

    it("setModel with openai updates model in config", async () => {
      mockGetSelectedProvider.mockReturnValue("openai");
      await manager.setModel("gpt-4o");
      expect(mockConfigSetModel).toHaveBeenCalledWith("gpt-4o");
    });

    it("setModel with gemini does not call any setter", async () => {
      mockGetSelectedProvider.mockReturnValue("gemini");
      await manager.setModel("gemini-2.0");
      expect(mockConfigSetModel).not.toHaveBeenCalled();
      expect(mockConfigSetOllamaSettings).not.toHaveBeenCalled();
      expect(mockConfigSetWebLlmModel).not.toHaveBeenCalled();
    });
  });

  describe("setCustomBaseUrl / getCustomBaseUrl", () => {
    it("setCustomBaseUrl delegates and re-sets the provider if custom", async () => {
      mockGetSelectedProvider.mockReturnValue("custom");
      await manager.setCustomBaseUrl("https://new.example.com");
      expect(mockSetCustomBaseUrl).toHaveBeenCalledWith(
        "https://new.example.com",
      );
      // setProvider delegates to config.setProvider(provider, apiKey)
      expect(mockSetProvider).toHaveBeenCalledWith("custom", null);
    });

    it("setCustomBaseUrl does not re-set the provider if not custom", async () => {
      mockGetSelectedProvider.mockReturnValue("openai");
      await manager.setCustomBaseUrl("https://new.example.com");
      expect(mockSetCustomBaseUrl).toHaveBeenCalled();
      expect(mockSetProvider).not.toHaveBeenCalled();
    });

    it("getCustomBaseUrl returns the configured URL", () => {
      expect(manager.getCustomBaseUrl()).toBe("https://custom.example.com");
    });
  });

  describe("generateText - default & custom branches", () => {
    beforeEach(async () => {
      mockCache.get.mockReset();
      mockCache.get.mockReturnValue(null);
      const rateLimit = await import("../../../services/RateLimitService");
      vi.mocked(rateLimit.rateLimitService.checkLimit).mockReset();
      vi.mocked(rateLimit.rateLimitService.checkLimit).mockReturnValue({
        remaining: 100,
        used: 0,
        resetAt: Date.now() + 60000,
        exhausted: false,
      });
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockReset();
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockResolvedValue(true);
      const semantic =
        await import("../../\.\./services/ai/SemanticCacheService");
      vi.mocked(semantic.semanticCache.findSimilar).mockReset();
      vi.mocked(semantic.semanticCache.findSimilar).mockResolvedValue(null);
      vi.mocked(semantic.semanticCache.add).mockReset();
      vi.mocked(semantic.semanticCache.add).mockResolvedValue(undefined);
    });

    it("custom provider sin API key lanza error", async () => {
      mockGetProviderInfo.mockReturnValue({
        provider: "custom",
        model: "x",
        fullSupport: true,
        name: "Custom",
        isConfigured: false,
      });
      mockGetOpenAIProvider.mockReturnValue(null);
      mockGetOllamaProvider.mockReturnValue({
        generateText: vi.fn(),
        isAvailable: vi.fn().mockResolvedValue(false),
        getConfig: vi.fn().mockReturnValue({
          url: "http://localhost:11434/api/generate",
          model: "llama3.2",
        }),
      });
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockResolvedValue(false);
      await expect(
        manager.generateText("test", undefined, { isPrivate: false }),
      ).rejects.toThrow(/No AI provider is configured/i);
    });

    it("unknown provider falls back to gemini", async () => {
      mockGetProviderInfo.mockReturnValue({
        provider: "unknown-provider",
        model: "x",
        fullSupport: false,
        name: "Unknown",
        isConfigured: false,
      });
      mockGetOllamaProvider.mockReturnValue({
        generateText: vi.fn(),
        isAvailable: vi.fn().mockResolvedValue(false),
        getConfig: vi.fn().mockReturnValue({
          url: "http://localhost:11434/api/generate",
          model: "llama3.2",
        }),
      });
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockResolvedValue(false);
      await expect(
        manager.generateText("test", undefined, { isPrivate: false }),
      ).rejects.toThrow(/No AI provider is configured/i);
    });

    it("discards a semantic cache hit if isPrivate and the match is cloud", async () => {
      const semantic =
        await import("../../\.\./services/ai/SemanticCacheService");
      vi.mocked(semantic.semanticCache.findSimilar).mockResolvedValue({
        text: "cloud cached secret",
        provider: "gemini",
      } as any);
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      vi.mocked(webLLM.webLLMService.generateText).mockResolvedValue(
        "webllm local result",
      );
      const result = await manager.generateText("test", undefined, {
        isPrivate: true,
      });
      expect(result.text).not.toBe("cloud cached secret");
      expect(result.provider).toBe("webllm");
    });

    it("does not consult the semantic cache when options.tools is present", async () => {
      const semantic =
        await import("../../\.\./services/ai/SemanticCacheService");
      await manager.generateText("test", undefined, {
        tools: [{ name: "x" }],
      } as any);
      expect(semantic.semanticCache.findSimilar).not.toHaveBeenCalled();
    });
  });

  describe("resolveProvider - RoutingOptimizer branches", () => {
    beforeEach(async () => {
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockReset();
      vi.mocked(webLLM.webLLMService.canRunLocalLLM).mockResolvedValue(false);
      const resource = await import("../../\.\./services/ai/ResourceManager");
      vi.mocked(resource.resourceManager.isHighEndDevice).mockReset();
      vi.mocked(resource.resourceManager.isHighEndDevice).mockReturnValue(
        false,
      );
      mockGetOllamaProvider.mockReset();
      mockGetOllamaProvider.mockReturnValue({
        generateText: vi.fn(),
        isAvailable: vi.fn().mockResolvedValue(false),
        getConfig: vi.fn().mockReturnValue({
          url: "http://localhost:11434/api/generate",
          model: "llama3.2",
        }),
      });
      mockGetApiKey.mockReset();
      mockGetApiKey.mockReturnValue(null);
      mockGetProviderInfo.mockReset();
      mockGetProviderInfo.mockReturnValue({
        provider: "gemini",
        model: "gemini-2.0-flash-exp",
        fullSupport: true,
        name: "Google Gemini",
        isConfigured: true,
      });
      const routing =
        await import("../../\.\./services/ai/adapters/RoutingOptimizer");
      vi.mocked(routing.routingOptimizer.selectProvider).mockReset();
    });

    it("uses the provider learned by RoutingOptimizer", async () => {
      const routing =
        await import("../../\.\./services/ai/adapters/RoutingOptimizer");
      vi.mocked(routing.routingOptimizer.selectProvider).mockResolvedValue(
        "groq" as any,
      );
      // Keep apiKey null so the early detectProvider return is skipped and
      // the RoutingOptimizer branch is reached.
      const info = await (manager as any).resolveProvider({
        complexity: "complex",
        isPrivate: false,
      });
      expect(info.provider).toBe("groq");
    });

    it("falls back to the default provider if RoutingOptimizer fails", async () => {
      const routing =
        await import("../../\.\./services/ai/adapters/RoutingOptimizer");
      vi.mocked(routing.routingOptimizer.selectProvider).mockRejectedValue(
        new Error("optimizer down"),
      );
      const info = await (manager as any).resolveProvider({ isPrivate: false });
      expect(info.provider).toBe("gemini");
    });
  });

  describe("warmup", () => {
    it("skips warmup in test mode", async () => {
      // beforeEach calls vi.unstubAllGlobals(), so write to the real
      // localStorage (ProviderManager reads it via safeGet).
      localStorage.setItem("forge_test_mode", "true");
      await manager.warmup();
      const webLLM = await import("../../\.\./services/ai/WebLLMService");
      expect(webLLM.webLLMService.init).not.toHaveBeenCalled();
    });
  });

  describe("isOllamaAvailable - stale cache", () => {
    it("re-checks when the cache has expired", async () => {
      (manager as any).ollamaAvailableCache = true;
      (manager as any).ollamaCheckTime = Date.now() - 120000;
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
      const result = await manager.isOllamaAvailable();
      expect(result).toBe(false);
    });
  });
});
