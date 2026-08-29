import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../\.\./services/ai/providers/OllamaProvider", () => ({
  OllamaProvider: vi.fn().mockImplementation(function () {
    return {
      updateConfig: vi.fn(),
      getConfig: vi.fn().mockReturnValue({
        url: "http://localhost:11434/api/generate",
        model: "llama3.2",
      }),
      isAvailable: vi.fn(),
      generateText: vi.fn(),
    };
  }),
}));

vi.mock("../../\.\./services/ai/providers/GeminiProvider", () => ({
  GeminiProvider: vi.fn().mockImplementation(function () {
    return {
      generateText: vi.fn(),
      streamGenerateText: vi.fn(),
      setApiKey: vi.fn(),
    };
  }),
}));

let apiKeyChangeCb: ((key: string | null) => void) | null = null;

vi.mock("../../\.\./services/ai/providers/OpenAICompatibleProvider", () => ({
  OpenAICompatibleProvider: vi.fn().mockImplementation(function () {
    return {
      generateText: vi.fn(),
      fetchAvailableModels: vi.fn().mockResolvedValue([]),
      setApiKey: vi.fn(),
      clearApiKey: vi.fn(),
    };
  }),
}));

vi.mock("../../\.\./services/ai/VaultIntegration", () => ({
  VaultIntegration: vi.fn().mockImplementation(function () {
    return {
      getApiKey: vi.fn().mockReturnValue(null),
      setApiKey: vi.fn(),
      encryptSecret: vi.fn(),
      isLocked: vi.fn().mockReturnValue(false),
      onApiKeyChange: vi.fn((cb: (key: string | null) => void) => {
        apiKeyChangeCb = cb;
        return () => {
          apiKeyChangeCb = null;
        };
      }),
    };
  }),
}));

vi.mock("../../\.\./services/ai/utils", () => ({
  detectProvider: vi.fn(),
}));

vi.mock("../../../utils/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../\.\./services/SecureStorage", () => ({
  secureStorage: {
    getSecret: vi.fn().mockResolvedValue(null),
    setSecret: vi.fn().mockResolvedValue(undefined),
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
Object.defineProperty(globalThis, "localStorage", { value: mockLocalStorage });

const { detectProvider } = await import("../../\.\./services/ai/utils");
const { VaultIntegration } =
  await import("../../\.\./services/ai/VaultIntegration");
const { OllamaProvider } =
  await import("../../\.\./services/ai/providers/OllamaProvider");
const { ProviderConfiguration } =
  await import("../../\.\./services/ai/ProviderConfiguration");

describe("ProviderConfiguration", () => {
  let config: InstanceType<typeof ProviderConfiguration>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLocalStorage.clear();
    apiKeyChangeCb = null;
    config = new ProviderConfiguration(new VaultIntegration());
  });

  describe("constructor", () => {
    it("uses default values when localStorage is empty", () => {
      expect(mockLocalStorage.getItem).toHaveBeenCalledWith("webllm_model");
      expect(mockLocalStorage.getItem).toHaveBeenCalledWith("ollama_url");
      expect(mockLocalStorage.getItem).toHaveBeenCalledWith("ollama_model");
      expect(mockLocalStorage.getItem).toHaveBeenCalledWith(
        "selected_ai_provider",
      );
    });

    it("loads values from localStorage if they exist", () => {
      mockLocalStorage.setItem(
        "ollama_url",
        "http://custom:11434/api/generate",
      );
      mockLocalStorage.setItem("ollama_model", "mistral");
      mockLocalStorage.setItem("webllm_model", "Phi-3.5-mini-instruct");
      mockLocalStorage.setItem("selected_ai_provider", "ollama");
      const cfg = new ProviderConfiguration(new VaultIntegration());
      expect(OllamaProvider).toHaveBeenCalledWith({
        url: "http://custom:11434/api/generate",
        model: "mistral",
      });
      expect(cfg.getWebLlmModel()).toBe("Phi-3.5-mini-instruct");
      expect(cfg.getSelectedProvider()).toBe("ollama");
    });

    it("inicializa selectedProvider como null si no hay en localStorage", () => {
      expect(config.getSelectedProvider()).toBeNull();
    });
  });

  describe("getProviderInfo", () => {
    it("returns default info when there is no selected provider", () => {
      const info = config.getProviderInfo();
      expect(info.provider).toBe("gemini");
      expect(info.model).toBe("gemini-2.0-flash-exp");
      expect(info.isConfigured).toBe(false);
    });

    it("returns ollama info when selected", () => {
      mockLocalStorage.setItem("selected_ai_provider", "ollama");
      const cfg = new ProviderConfiguration(new VaultIntegration());
      const info = cfg.getProviderInfo();
      expect(info.provider).toBe("ollama");
      expect(info.isConfigured).toBe(true);
    });

    it("returns webllm info when selected", () => {
      mockLocalStorage.setItem("selected_ai_provider", "webllm");
      const cfg = new ProviderConfiguration(new VaultIntegration());
      const info = cfg.getProviderInfo();
      expect(info.provider).toBe("webllm");
      expect(info.isConfigured).toBe(true);
    });
  });

  describe("setProvider", () => {
    it("saves the provider to localStorage", async () => {
      await config.setProvider("gemini");
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
        "selected_ai_provider",
        "gemini",
      );
    });

    it("updates providerInfo internally", async () => {
      await config.setProvider("ollama");
      expect(config.getProviderInfo().provider).toBe("ollama");
    });

    it("does not detect an API key when none is provided", async () => {
      await config.setProvider("openai");
      expect(detectProvider).not.toHaveBeenCalled();
    });
  });

  describe("setApiKey", () => {
    it("detects the provider from the API key", async () => {
      (detectProvider as ReturnType<typeof vi.fn>).mockReturnValue({
        provider: "openai",
        model: "gpt-4o-mini",
        fullSupport: true,
        name: "OpenAI",
        isConfigured: true,
      });
      const result = await config.setApiKey("sk-test-key-12345");
      expect(detectProvider).toHaveBeenCalledWith("sk-test-key-12345");
      expect(result.provider).toBe("openai");
    });

    it("configures OpenAICompatibleProvider for non-gemini keys", async () => {
      (detectProvider as ReturnType<typeof vi.fn>).mockReturnValue({
        provider: "openai",
        model: "gpt-4o-mini",
        fullSupport: true,
        name: "OpenAI",
        isConfigured: true,
      });
      await config.setApiKey("sk-test-key");
      expect(config.getOpenAIProvider()).not.toBeNull();
    });

    it("returns updated providerInfo", async () => {
      const mockInfo = {
        provider: "openai",
        model: "gpt-4o-mini",
        fullSupport: true,
        name: "OpenAI",
        isConfigured: true,
      };
      (detectProvider as ReturnType<typeof vi.fn>).mockReturnValue(mockInfo);
      const result = await config.setApiKey("sk-test-key");
      expect(result).toMatchObject(mockInfo);
    });
  });

  describe("Ollama settings", () => {
    it("setOllamaSettings updates configuration and localStorage", async () => {
      await config.setOllamaSettings(
        "http://remote:11434/api/generate",
        "codellama",
      );
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
        "ollama_url",
        "http://remote:11434/api/generate",
      );
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
        "ollama_model",
        "codellama",
      );
    });

    it("getOllamaSettings returns the current configuration", () => {
      const settings = config.getOllamaSettings();
      expect(settings).toHaveProperty("url");
      expect(settings).toHaveProperty("model");
    });
  });

  describe("WebLLM model", () => {
    it("setWebLlmModel updates and persists", async () => {
      await config.setWebLlmModel("Phi-3.5-mini-instruct-q4f16_1-MLC");
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
        "webllm_model",
        "Phi-3.5-mini-instruct-q4f16_1-MLC",
      );
      expect(config.getWebLlmModel()).toBe("Phi-3.5-mini-instruct-q4f16_1-MLC");
    });
  });

  describe("setModel", () => {
    it("updates model for ollama and persists it", async () => {
      await config.setProvider("ollama");
      await config.setModel("codellama");
      expect(config.getProviderInfo().model).toBe("codellama");
    });

    it("updates model for webllm and persists it", async () => {
      await config.setProvider("webllm");
      await config.setModel("Phi-3.5-mini-instruct");
      expect(config.getProviderInfo().model).toBe("Phi-3.5-mini-instruct");
    });
  });

  describe("init (SecureStorage)", () => {
    it("loads persisted values from SecureStorage", async () => {
      const secureStorage = (
        await import("../../\.\./services/SecureStorage")
      ).secureStorage as any;
      secureStorage.getSecret.mockImplementation((key: string) => {
        const map: Record<string, string> = {
          bmf_provider_ollama_url: "http://custom:11434/api/generate",
          bmf_provider_ollama_model: "mistral",
          bmf_provider_webllm_model: "Phi-3.5-mini-instruct-q4f16_1-MLC",
          bmf_provider_selected_ai_provider: "ollama",
          bmf_provider_custom_ai_base_url: "https://custom.api.com/v1",
        };
        return Promise.resolve(map[key] || null);
      });

      await config.init();

      // doInit rehydrates the existing provider via updateConfig (does not build
      // a new one) — the loaded values reach the mock.
      const ollama = config.getOllamaProvider() as any;
      expect(ollama.updateConfig).toHaveBeenCalledWith({
        url: "http://custom:11434/api/generate",
        model: "mistral",
      });
      expect(config.getWebLlmModel()).toBe("Phi-3.5-mini-instruct-q4f16_1-MLC");
      expect(config.getSelectedProvider()).toBe("ollama");
      expect(config.getCustomBaseUrl()).toBe("https://custom.api.com/v1");
    });

    it("is idempotent (concurrent calls deduplicated)", async () => {
      const secureStorage = (
        await import("../../\.\./services/SecureStorage")
      ).secureStorage as any;
      secureStorage.getSecret.mockResolvedValue(null);
      await Promise.all([config.init(), config.init()]);
      expect(secureStorage.getSecret).toHaveBeenCalledTimes(5);
    });
  });

  describe("custom base URL", () => {
    it("persists the custom base URL", async () => {
      const secureStorage = (
        await import("../../\.\./services/SecureStorage")
      ).secureStorage as any;
      secureStorage.setSecret.mockResolvedValue(undefined);
      await config.setCustomBaseUrl("https://my-api.com/v1");
      expect(secureStorage.setSecret).toHaveBeenCalledWith(
        "bmf_provider_custom_ai_base_url",
        "https://my-api.com/v1",
      );
      expect(config.getCustomBaseUrl()).toBe("https://my-api.com/v1");
    });

    it("rejects plain http for non-loopback hosts", async () => {
      await expect(
        config.setCustomBaseUrl("http://evil.com/v1"),
      ).rejects.toThrow();
    });

    it("rejects URLs with embedded credentials", async () => {
      await expect(
        config.setCustomBaseUrl("https://user:pass@api.com/v1"),
      ).rejects.toThrow(/credentials/i);
    });

    it("rejects URLs with suspicious query params", async () => {
      await expect(
        config.setCustomBaseUrl("https://api.com/v1?api_key=xyz"),
      ).rejects.toThrow();
      await expect(
        config.setCustomBaseUrl("https://api.com/v1?token=abc"),
      ).rejects.toThrow();
    });

    it("accepts http on loopback", async () => {
      const secureStorage = (
        await import("../../\.\./services/SecureStorage")
      ).secureStorage as any;
      secureStorage.setSecret.mockResolvedValue(undefined);
      await expect(
        config.setCustomBaseUrl("http://localhost:11434/api"),
      ).resolves.toBeUndefined();
    });
  });

  describe("getters de providers", () => {
    it("getOllamaProvider returns an instance", () => {
      expect(config.getOllamaProvider()).toBeDefined();
    });
    it("getGeminiProvider returns an instance", () => {
      expect(config.getGeminiProvider()).toBeDefined();
    });
    it("getOpenAIProvider returns null when not configured", () => {
      expect(config.getOpenAIProvider()).toBeNull();
    });
  });

  describe("S9 - key sync with the vault (regression)", () => {
    const OPENAI_KEY = "sk-test-key-12345";

    async function configureProvider(): Promise<void> {
      (detectProvider as ReturnType<typeof vi.fn>).mockReturnValue({
        provider: "openai",
        model: "gpt-4o-mini",
        fullSupport: true,
        name: "OpenAI",
        isConfigured: true,
      });
      await config.setApiKey(OPENAI_KEY);
    }

    it("se suscribe a onApiKeyChange en el constructor", () => {
      expect(apiKeyChangeCb).not.toBeNull();
    });

    it("discards openAIProvider key when the vault locks", async () => {
      await configureProvider();
      expect(config.getOpenAIProvider()).not.toBeNull();
      const provider = config.getOpenAIProvider()!;

      // Simula el lock del vault: VaultIntegration.notifyApiKeyListeners(null)
      apiKeyChangeCb?.(null);

      expect(provider.clearApiKey).toHaveBeenCalled();
    });

    it("rehydrates the key into the existing provider on unlock", async () => {
      await configureProvider();
      const provider = config.getOpenAIProvider()!;

      apiKeyChangeCb?.(OPENAI_KEY);

      expect(provider.setApiKey).toHaveBeenCalledWith(OPENAI_KEY);
      expect(config.getOpenAIProvider()).toBe(provider); // same instance
    });

    it("builds a provider if it did not exist and the vault notifies a key", async () => {
      expect(config.getOpenAIProvider()).toBeNull();

      apiKeyChangeCb?.(OPENAI_KEY);

      // Built by the constructor (rebuild), not updated in place.
      expect(config.getOpenAIProvider()).not.toBeNull();
      expect(config.getOpenAIProvider()!.setApiKey).not.toHaveBeenCalled();
    });

    it("ignores gemini/unknown keys in the rebuild (only OpenAI-compatible)", () => {
      (detectProvider as ReturnType<typeof vi.fn>).mockReturnValue({
        provider: "gemini",
        model: "gemini-2.0-flash-exp",
        fullSupport: true,
        name: "Gemini",
        isConfigured: true,
      });
      apiKeyChangeCb?.("AIzaSyTest123");
      expect(config.getOpenAIProvider()).toBeNull();
    });

    it("does not write a gemini key inside the existing provider (in-place branch)", async () => {
      // Provider OpenAI existente con su key.
      await configureProvider();
      const provider = config.getOpenAIProvider()!;
      provider.setApiKey("sk-original-key");
      (provider.setApiKey as ReturnType<typeof vi.fn>).mockClear();

      // The user switches to Gemini → the notification with the gemini key must NOT
      // touch the openAIProvider (same filter as the rebuild).
      (detectProvider as ReturnType<typeof vi.fn>).mockReturnValue({
        provider: "gemini",
        model: "gemini-2.0-flash-exp",
        fullSupport: true,
        name: "Gemini",
        isConfigured: true,
      });
      apiKeyChangeCb?.("AIzaSyTest123");

      expect(provider.setApiKey).not.toHaveBeenCalled();
    });

    it("purges geminiProvider key when the vault locks", async () => {
      const GEMINI_KEY = "AIzaSyGeminiTest123";
      (detectProvider as ReturnType<typeof vi.fn>).mockReturnValue({
        provider: "gemini",
        model: "gemini-2.0-flash-exp",
        fullSupport: true,
        name: "Gemini",
        isConfigured: true,
      });
      // setApiKey replaces the instance with one carrying the loaded key.
      await config.setApiKey(GEMINI_KEY);
      const provider = config.getGeminiProvider();
      (provider.setApiKey as ReturnType<typeof vi.fn>).mockClear();

      // Lock del vault: VaultIntegration.notifyApiKeyListeners(null)
      apiKeyChangeCb?.(null);

      // La copia en memoria de la key gemini NO sobrevive al lock.
      expect(provider.setApiKey).toHaveBeenCalledWith(null);
    });

    it("rehydrates the geminiProvider key on unlock", async () => {
      const GEMINI_KEY = "AIzaSyGeminiTest123";
      (detectProvider as ReturnType<typeof vi.fn>).mockReturnValue({
        provider: "gemini",
        model: "gemini-2.0-flash-exp",
        fullSupport: true,
        name: "Gemini",
        isConfigured: true,
      });
      // La instancia del constructor (apiKey: null) es la que recibe el evento.
      const provider = config.getGeminiProvider();
      (provider.setApiKey as ReturnType<typeof vi.fn>).mockClear();

      // Unlock: the vault notifies the decrypted key → in-place rehydration.
      apiKeyChangeCb?.(GEMINI_KEY);

      expect(provider.setApiKey).toHaveBeenCalledWith(GEMINI_KEY);
      expect(config.getGeminiProvider()).toBe(provider); // same instance
    });

    it("purges the gemini copy when switching to a non-gemini provider", async () => {
      // 1) Configura Gemini → la instancia guarda la key en memoria.
      (detectProvider as ReturnType<typeof vi.fn>).mockReturnValue({
        provider: "gemini",
        model: "gemini-2.0-flash-exp",
        fullSupport: true,
        name: "Gemini",
        isConfigured: true,
      });
      await config.setApiKey("AIzaSyGeminiTest123");
      expect(config.getGeminiProvider()).not.toBeNull();

      // 2) Switches to OpenAI (sk- key) → the gemini copy must be purged on the
      //    spot, without waiting for the next vault lock.
      (detectProvider as ReturnType<typeof vi.fn>).mockReturnValue({
        provider: "openai",
        model: "gpt-4o-mini",
        fullSupport: true,
        name: "OpenAI",
        isConfigured: true,
      });
      await config.setApiKey("sk-switch-test-key");

      const gemini = config.getGeminiProvider();
      expect(gemini.setApiKey).toHaveBeenCalledWith(null);
    });

    it("rebuilds geminiProvider in setApiKey and stays functional after the lock", async () => {
      const GEMINI_KEY = "AIzaSyGeminiTest123";
      (detectProvider as ReturnType<typeof vi.fn>).mockReturnValue({
        provider: "gemini",
        model: "gemini-2.0-flash-exp",
        fullSupport: true,
        name: "Gemini",
        isConfigured: true,
      });
      await config.setApiKey(GEMINI_KEY);

      // El lock purga la key en memoria...
      apiKeyChangeCb?.(null);
      expect(config.getGeminiProvider().setApiKey).toHaveBeenCalledWith(null);

      // ...and the unlock rehydrates it on the same instance.
      apiKeyChangeCb?.(GEMINI_KEY);
      expect(config.getGeminiProvider().setApiKey).toHaveBeenCalledWith(
        GEMINI_KEY,
      );
    });
  });
});
