import { AIProvider, ProviderInfo } from "./types";
import {
  OllamaProvider,
  GeminiProvider,
  OpenAICompatibleProvider,
} from "./providers";
import { VaultIntegration } from "./VaultIntegration";
import { detectProvider } from "./utils";
import { secureStorage } from "../SecureStorage";
import { AI_MODELS } from "../../constants/config";
import { safeGet, safeSet } from "../../store/safeStorage";

const LS_PREFIX = "bmf_provider_";

/**
 * ProviderConfiguration - Manages provider settings and configurations
 * Handles provider selection, model configuration, and provider info
 *
 * Config values are persisted in SecureStorage (IndexedDB) with localStorage fallback.
 */
export class ProviderConfiguration {
  private ollamaProvider: OllamaProvider;
  private geminiProvider: GeminiProvider;
  private openAIProvider: OpenAICompatibleProvider | null = null;
  private selectedProvider: AIProvider | null = null;
  private webLlmModel: string;
  private customBaseUrl: string | undefined;
  private providerInfo: ProviderInfo;
  private ready: boolean = false;
  // Dedupes concurrent init() calls (e.g. unlockVault + warmup firing after
  // an unlock) so the SecureStorage reads run exactly once — matches the
  // SecureStorage initPromise pattern.
  private initPromise: Promise<void> | null = null;

  /**
   * @param vault - The SHARED VaultIntegration instance (owned by
   * ProviderManager). ProviderConfiguration must NOT create its own — two
   * instances would hold independent in-memory API keys and break the S9
   * lock/unlock purge contract (only one is subscribed to vault events).
   */
  constructor(private readonly vault: VaultIntegration) {
    this.webLlmModel =
      safeGet("webllm_model") || "Llama-3.2-1B-Instruct-q4f16_1-MLC";
    this.customBaseUrl = safeGet("custom_ai_base_url") || undefined;

    this.ollamaProvider = new OllamaProvider({
      url: safeGet("ollama_url") || "http://localhost:11434/api/generate",
      model: safeGet("ollama_model") || "llama3.2",
    });

    this.geminiProvider = new GeminiProvider({ apiKey: null });

    this.selectedProvider =
      (safeGet("selected_ai_provider") as AIProvider) || null;
    this.providerInfo = this.getDefaultProviderInfo();

    // SECURITY (S9): both cloud providers hold their OWN decrypted API key
    // copies (besides vault.getApiKey()). Keep them in sync with the vault
    // state: purge them on lock, rehydrate them on unlock — otherwise the
    // key copies would outlive a vault lock in memory and cloud AI would
    // silently break after an unlock.
    vault.onApiKeyChange((key) => {
      // Lock: purge BOTH in-memory key copies.
      if (!key) {
        this.openAIProvider?.clearApiKey();
        this.geminiProvider.setApiKey(null);
        return;
      }
      // Rehydrate the Gemini copy on unlock (the initial setApiKey() path
      // still rebuilds the provider from scratch).
      if (this.isGeminiKey(key)) {
        this.geminiProvider.setApiKey(key);
        return;
      }
      // Only OpenAI-compatible keys belong in openAIProvider (gemini/unknown
      // keys must never be written here) — same filter as rebuildOpenAIProvider.
      if (!this.isOpenAICompatibleKey(key)) {return;}
      if (this.openAIProvider) {
        this.openAIProvider.setApiKey(key);
      } else {
        this.rebuildOpenAIProvider(key);
      }
    });
  }

  private isGeminiKey(key: string): boolean {
    return detectProvider(key)?.provider === "gemini";
  }

  private isOpenAICompatibleKey(key: string): boolean {
    const detected = detectProvider(key);
    return (
      !!detected &&
      detected.provider !== "gemini" &&
      detected.provider !== "unknown"
    );
  }

  /**
   * Whether the stored provider selection is an OpenAI-compatible surface.
   * The user's SELECTION is authoritative for "custom" — the mock/serving
   * endpoint may hand out any key shape (e.g. `sk-mock-...` for a local
   * OpenAI-compatible server), and detectProvider would misclassify that as
   * "unknown" and silently discard it. Gemini keys must still NOT feed the
   * OpenAI-compatible provider (they speak the Gemini protocol).
   */
  private isCustomSelection(): boolean {
    return this.selectedProvider === "custom";
  }

  /**
   * Build an OpenAI-compatible provider from the vault's key WITHOUT hitting
   * the network (no model fetch) — used to rehydrate after an unlock.
   */
  private rebuildOpenAIProvider(key: string): void {
    if (this.isCustomSelection()) {
      // Custom provider: the selection decides the endpoint family; the key
      // format is irrelevant (local OpenAI-compatible servers accept any
      // non-empty value). Reuses the OpenAI-compatible wire protocol.
      this.openAIProvider = new OpenAICompatibleProvider({
        apiKey: key,
        provider: "custom",
        model: this.providerInfo.model || "custom-model",
        baseUrl: this.customBaseUrl,
      });
      return;
    }
    if (!this.isOpenAICompatibleKey(key)) {return;}
    const detected = detectProvider(key);
    this.openAIProvider = new OpenAICompatibleProvider({
      apiKey: key,
      provider: detected.provider,
      model: detected.model,
      baseUrl: this.customBaseUrl,
    });
  }

  /** Async one-time init — loads persisted config from SecureStorage, overwriting localStorage defaults. */
  async init(): Promise<void> {
    if (this.ready) {return;}
    if (this.initPromise) {return this.initPromise;}
    this.initPromise = this.doInit().finally(() => {
      this.initPromise = null;
    });
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    const [
      ollamaUrl,
      ollamaModel,
      webllmModel,
      selectedProvider,
      customBaseUrl,
    ] = await Promise.all([
      secureStorage.getSecret(`${LS_PREFIX}ollama_url`),
      secureStorage.getSecret(`${LS_PREFIX}ollama_model`),
      secureStorage.getSecret(`${LS_PREFIX}webllm_model`),
      secureStorage.getSecret(`${LS_PREFIX}selected_ai_provider`),
      secureStorage.getSecret(`${LS_PREFIX}custom_ai_base_url`),
    ]);

    if (ollamaUrl || ollamaModel) {
      this.ollamaProvider.updateConfig({
        url: ollamaUrl || this.ollamaProvider.getConfig().url,
        model: ollamaModel || this.ollamaProvider.getConfig().model,
      });
    }
    if (webllmModel) {this.webLlmModel = webllmModel;}
    if (customBaseUrl) {this.customBaseUrl = customBaseUrl;}
    if (selectedProvider)
      {this.selectedProvider = selectedProvider as AIProvider;}

    this.providerInfo = this.getDefaultProviderInfo();
    this.ready = true;
  }

  /**
   * Get default provider info based on selection
   */
  private getDefaultProviderInfo(): ProviderInfo {
    const hasApiKey = this.vault.getApiKey() !== null;

    if (this.selectedProvider === "ollama") {
      return {
        provider: "ollama",
        model: this.ollamaProvider.getConfig().model,
        fullSupport: false,
        name: "Ollama (Local)",
        isConfigured: true,
      };
    } else if (this.selectedProvider === "webllm") {
      return {
        provider: "webllm",
        model: this.webLlmModel,
        fullSupport: false,
        name: "WebLLM (Browser)",
        isConfigured: true,
      };
    } else if (this.selectedProvider && hasApiKey) {
      // User selected a provider and has an API key
      return this.getProviderInfoForProvider(
        this.selectedProvider,
        hasApiKey ? this.vault.getApiKey() || undefined : undefined,
      );
    }
    // No provider selected or no API key - not configured
    return {
      provider: "gemini",
      model: AI_MODELS.GEMINI_EXP,
      fullSupport: true,
      name: "Google Gemini",
      isConfigured: false,
    };
  }

  /**
   * Get provider info for a specific provider
   */
  private getProviderInfoForProvider(
    provider: AIProvider,
    externalApiKey?: string | null,
  ): ProviderInfo {
    const configs: Record<AIProvider, ProviderInfo> = {
      ollama: {
        provider: "ollama",
        model: this.ollamaProvider.getConfig().model,
        fullSupport: false,
        name: "Ollama (Local)",
        isConfigured: true,
      },
      webllm: {
        provider: "webllm",
        model: this.webLlmModel,
        fullSupport: false,
        name: "WebLLM (Browser)",
        isConfigured: true,
      },
      openai: {
        provider: "openai",
        model: AI_MODELS.OPENAI_DEFAULT,
        fullSupport: true,
        name: "OpenAI (GPT-4)",
        isConfigured: !!externalApiKey,
      },
      anthropic: {
        provider: "anthropic",
        model: AI_MODELS.ANTHROPIC_DEFAULT,
        fullSupport: true,
        name: "Anthropic (Claude)",
        isConfigured: !!externalApiKey,
      },
      groq: {
        provider: "groq",
        model: AI_MODELS.GROQ_DEFAULT,
        fullSupport: true,
        name: "Groq (Llama)",
        isConfigured: !!externalApiKey,
      },
      gemini: {
        provider: "gemini",
        model: AI_MODELS.GEMINI_EXP,
        fullSupport: true,
        name: "Google Gemini",
        isConfigured: !!externalApiKey,
      },
      custom: {
        provider: "custom",
        model: "custom-model",
        fullSupport: true,
        name: "Custom AI (OpenAI Format)",
        isConfigured: !!externalApiKey,
      },
      unknown: {
        provider: "unknown",
        model: "unknown",
        fullSupport: false,
        name: "Unknown",
        isConfigured: false,
      },
    };

    if (
      externalApiKey &&
      provider !== "ollama" &&
      provider !== "webllm" &&
      provider !== "gemini" &&
      // The CUSTOM selection labels itself: key-prefix sniffing (detectProvider)
      // would mislabel a local OpenAI-compatible server's key (e.g. "sk-mock")
      // as "OpenAI" and hide the Custom form in the settings UI.
      provider !== "custom"
    ) {
      const detected = detectProvider(externalApiKey);
      return { ...detected, isConfigured: true };
    }

    return configs[provider] || configs.gemini;
  }

  /**
   * Get current provider info
   */
  getProviderInfo(): ProviderInfo {
    return this.providerInfo;
  }

  /**
   * Get selected provider
   */
  getSelectedProvider(): AIProvider | null {
    return this.selectedProvider;
  }

  /**
   * Set provider
   */
  async setProvider(
    provider: AIProvider,
    externalApiKey?: string | null,
  ): Promise<void> {
    this.selectedProvider = provider;
    await secureStorage.setSecret(`${LS_PREFIX}selected_ai_provider`, provider);
    safeSet("selected_ai_provider", provider);

    this.providerInfo = this.getProviderInfoForProvider(
      provider,
      externalApiKey,
    );
  }

  /**
   * Set API key and update provider configuration.
   * The CUSTOM selection is special: the key format is not sniffed (any
   * non-empty value is accepted — local OpenAI-compatible servers do not use
   * vendor prefixes) and the stored base URL decides the endpoint.
   */
  async setApiKey(key: string): Promise<ProviderInfo> {
    if (this.isCustomSelection()) {
      // SECURITY (S9): switching away from Gemini must purge the previous
      // in-memory gemini copy immediately (same as the detected path below).
      this.geminiProvider.setApiKey(null);
      const customBaseUrl =
        (await secureStorage.getSecret(`${LS_PREFIX}custom_ai_base_url`)) ||
        safeGet("custom_ai_base_url") ||
        undefined;
      this.customBaseUrl = customBaseUrl;
      this.openAIProvider = new OpenAICompatibleProvider({
        apiKey: key,
        provider: "custom",
        model: this.providerInfo.model || "custom-model",
        baseUrl: customBaseUrl,
      });
      // No vendor model listing is assumed: expose the manually-set model.
      this.providerInfo = {
        provider: "custom",
        model: this.providerInfo.model || "custom-model",
        fullSupport: true,
        name: "Custom AI (OpenAI Format)",
        isConfigured: true,
      };
      return this.providerInfo;
    }

    const detected = detectProvider(key);

    // Update provider info
    this.providerInfo = { ...detected };

    // Update OpenAI provider if applicable
    if (detected.provider !== "gemini" && detected.provider !== "unknown") {
      // SECURITY (S9): switching away from Gemini must purge the previous
      // in-memory gemini copy immediately (not just at the next vault lock) —
      // otherwise a stale gemini key would linger in memory between the switch
      // and the lock.
      this.geminiProvider.setApiKey(null);
      const customBaseUrl =
        (await secureStorage.getSecret(`${LS_PREFIX}custom_ai_base_url`)) ||
        safeGet("custom_ai_base_url") ||
        undefined;
      this.openAIProvider = new OpenAICompatibleProvider({
        apiKey: key,
        provider: detected.provider,
        model: detected.model,
        baseUrl: customBaseUrl,
      });

      // Fetch available models
      const models = await this.openAIProvider.fetchAvailableModels();
      this.providerInfo.availableModels = models;
    }

    // Update Gemini provider
    if (detected.provider === "gemini") {
      this.geminiProvider = new GeminiProvider({ apiKey: key });
    }

    return this.providerInfo;
  }

  /**
   * Get Ollama provider instance
   */
  getOllamaProvider(): OllamaProvider {
    return this.ollamaProvider;
  }

  /**
   * Get Gemini provider instance
   */
  getGeminiProvider(): GeminiProvider {
    return this.geminiProvider;
  }

  /**
   * Get OpenAI-compatible provider instance
   */
  getOpenAIProvider(): OpenAICompatibleProvider | null {
    return this.openAIProvider;
  }

  /**
   * Set Ollama settings
   */
  async setOllamaSettings(url: string, model: string): Promise<void> {
    this.ollamaProvider.updateConfig({ url, model });
    await Promise.all([
      secureStorage.setSecret(`${LS_PREFIX}ollama_url`, url),
      secureStorage.setSecret(`${LS_PREFIX}ollama_model`, model),
    ]);
    safeSet("ollama_url", url);
    safeSet("ollama_model", model);

    if (this.selectedProvider === "ollama") {
      this.providerInfo = { ...this.providerInfo, model };
    }
  }

  /**
   * Get Ollama settings
   */
  getOllamaSettings() {
    return this.ollamaProvider.getConfig();
  }

  /**
   * Set WebLLM model
   */
  async setWebLlmModel(model: string): Promise<void> {
    this.webLlmModel = model;
    await secureStorage.setSecret(`${LS_PREFIX}webllm_model`, model);
    safeSet("webllm_model", model);
    if (this.selectedProvider === "webllm") {
      this.providerInfo = { ...this.providerInfo, model };
    }
  }

  /**
   * Get WebLLM model
   */
  getWebLlmModel(): string {
    return this.webLlmModel;
  }

  async setModel(model: string): Promise<void> {
    if (this.selectedProvider === "ollama") {
      this.ollamaProvider.updateConfig({ model });
      await secureStorage.setSecret(`${LS_PREFIX}ollama_model`, model);
      safeSet("ollama_model", model);
    } else if (this.selectedProvider === "webllm") {
      this.webLlmModel = model;
      await secureStorage.setSecret(`${LS_PREFIX}webllm_model`, model);
      safeSet("webllm_model", model);
    }
    this.providerInfo.model = model;
  }

  /**
   * Get custom base URL for OpenAI-compatible providers
   */
  getCustomBaseUrl(): string | undefined {
    return this.customBaseUrl;
  }

  /**
   * Set custom base URL for OpenAI-compatible providers
   */
  async setCustomBaseUrl(baseUrl: string): Promise<void> {
    // SECURITY: reject plaintext http:// for non-loopback hosts to prevent
    // MITM/exfiltration of API keys and prompts over an unencrypted channel.
    let parsed: URL;
    try {
      parsed = new URL(baseUrl);
    } catch (_err) {
      throw new Error("Invalid custom base URL");
    }
    const isLoopback =
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "[::1]";
    if (parsed.protocol === "http:" && !isLoopback) {
      throw new Error(
        "Custom AI base URL must use https:// (or http://localhost for local models)",
      );
    }
    // SECURITY (F17): reject URLs that embed credentials or secret query params,
    // since they would otherwise be persisted and could leak API keys.
    if (parsed.username || parsed.password) {
      throw new Error("Custom AI base URL must not contain credentials");
    }
    const SUSPICIOUS_PARAMS = ["api_key", "key", "token", "secret", "ak", "sk"];
    for (const param of SUSPICIOUS_PARAMS) {
      if (parsed.searchParams.has(param)) {
        throw new Error(
          `Custom AI base URL must not contain a '${param}' parameter`,
        );
      }
    }
    this.customBaseUrl = baseUrl;
    await secureStorage.setSecret(`${LS_PREFIX}custom_ai_base_url`, baseUrl);
    safeSet("custom_ai_base_url", baseUrl);
  }
}
