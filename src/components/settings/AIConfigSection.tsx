import React from "react";
import { Sparkles, Loader2, Key } from "lucide-react";
import type { TFunction } from "i18next";
import { aiManager, AIProvider } from "../../services/ai/ProviderManager";
import { toast } from "sonner";
import { QuantizationPanel } from "../QuantizationPanel";
import { logger } from "../../utils/logger";
import { useGuardedAction } from "../../hooks/useGuardedAction";
import { ProRequiredState } from "../ProRequiredState";
import { useLicenseStore } from "../../store/useLicenseStore";

interface AIConfigSectionProps {
  apiKey: string;
  setApiKey: (key: string) => void;
  canRunWebLLM: boolean;
  webLlmProgress: { text: string; progress: number } | null;
  onShowDiagnostics: () => void;
  t: TFunction;
}

export const AIConfigSection: React.FC<AIConfigSectionProps> = ({
  apiKey,
  setApiKey,
  canRunWebLLM,
  webLlmProgress,
  onShowDiagnostics,
  t,
}) => {
  // Reactive entitlement: flipping to Pro inside this same modal must swap
  // the upgrade banner for the device warning (or nothing) without a remount.
  const hasPro = useLicenseStore((s) => s.entitlements.plan === "pro");
  const webLlmProRequired = !hasPro;
  const provider = aiManager.getProviderInfo().provider;

  return (
  <section data-testid="settings-ai-config" className="space-y-4">
    <h3 className="ds-label-section flex items-center gap-2">
      <Sparkles className="size-4" /> {t("app_aiProvider")}
    </h3>

    <div className="space-y-5 p-5 shadow-sm ds-card">
      <div className="space-y-3">
        <span className="text-sm font-bold ds-text-primary">
          {t("app_aiProviderSelect")}
        </span>
        <select
          aria-label={t("app_aiProviderSelect")}
          value={aiManager.getProviderInfo().provider}
          onChange={async (e) => {
            const val = e.target.value as AIProvider;
            await aiManager.setProvider(val);
            setApiKey(aiManager.getApiKey() || "");
          }}
          className="w-full px-4 py-3 text-sm outline-none font-medium shadow-inner ds-input"
        >
          <option value="gemini">
            {t("app_cloudAi")} {t("app_geminiLabel", "(Gemini)")}
          </option>
          <option value="openai">{t("app_openai")}</option>
          <option value="anthropic">{t("app_anthropic")}</option>
          <option value="groq">{t("app_groq")}</option>
          <option value="custom">
            {t("app_customProvider", "Custom (OpenAI Format)")}
          </option>
          <option value="ollama">
            {t("app_localAi")} {t("app_ollamaLabel", "(Ollama)")}
          </option>
          <option value="webllm" disabled={!canRunWebLLM || !hasPro}>
            {t("app_webLlmBrowser")}{" "}
            {!canRunWebLLM && `(${t("app_unsupportedDevice")})`}
            {canRunWebLLM && !hasPro && ` — ${t("app_proStateFeaturePro", "Pro")}`}
          </option>
        </select>

        {!canRunWebLLM && webLlmProRequired && (
          // Pro gate takes precedence: the device may be capable, but the
          // local-model runtime itself is Pro — show the shared upgrade
          // state instead of the device-capability warning.
          <div className="mt-3">
            <ProRequiredState feature="Local AI (WebLLM)" reason="license" variant="banner" />
          </div>
        )}

        {canRunWebLLM && webLlmProRequired && (
          // Device-capable + no license: the local-model runtime is Pro, so
          // the capability <option> is disabled and the shared upgrade state
          // replaces the otherwise silent WebLLM forms.
          <div className="mt-3">
            <ProRequiredState feature="Local AI (WebLLM)" reason="license" variant="banner" />
          </div>
        )}

        {!canRunWebLLM && !webLlmProRequired && (
          <div className="mt-3 p-4 ds-badge-warning-soft rounded-lg">
            <p className="text-xs leading-relaxed font-bold ds-text-warning">
              {t(
                "app_webLlmUnsupportedHint",
                "WebLLM is not available on this device. It requires a modern browser with WebGPU enabled and at least 4GB of RAM.",
              )}
              <button
                onClick={onShowDiagnostics}
                className="truncate ms-3 px-3 py-1.5 hover:opacity-80 rounded-lg text-[10px] font-semibold uppercase tracking-widest transition-all ds-bg-warning-soft ds-text-warning ds-radius-button"
              >
                {t("app_runDiagnostics", "Run Diagnostics")}
              </button>
            </p>
          </div>
        )}
      </div>

      {provider === "webllm" && !hasPro ? (
        // The local-model runtime is Pro; for a Free session its forms stay
        // hidden (the shared upgrade state above replaces them). BYOK
        // providers (gemini/openai/anthropic/groq/ollama/custom) are Core.
        null
      ) : provider === "ollama" ? (
        <OllamaForm t={t} />
      ) : provider === "custom" ? (
        <CustomProviderForm apiKey={apiKey} setApiKey={setApiKey} t={t} />
      ) : provider === "webllm" ? (
        <WebLLMForm webLlmProgress={webLlmProgress} t={t} />
      ) : (
        <DefaultProviderForm apiKey={apiKey} setApiKey={setApiKey} t={t} />
      )}
    </div>

    {!hasPro && (
      // The quantization engine tunes the vector store used by the local
      // models — meaningless without them, so it stays behind the gate too.
      <div className="mt-8">
        <ProRequiredState
            feature="Local AI (WebLLM)"
            reason="license"
            variant="banner"
        />
      </div>
    )}
    {hasPro && (
      <div className="mt-8">
        <QuantizationPanel />
      </div>
    )}
  </section>
  );
};

const OllamaForm: React.FC<{ t: TFunction }> = ({ t }) => {
  const initialConfig = aiManager.getOllamaSettings();
  const [url, setUrl] = React.useState(initialConfig.url);
  const [model, setModel] = React.useState(initialConfig.model);

  const updateOllamaSettings = (nextUrl: string, nextModel: string) => {
    void aiManager.setOllamaSettings(nextUrl, nextModel);
  };

  return (
    <div className="space-y-4 pt-4 ds-divider-t">
      <h4 className="text-xs font-semibold uppercase tracking-widest ds-text-accent">
        {t("app_ollamaSettings")}
      </h4>
      <div className="space-y-2">
        <span className="text-xs font-bold ds-text-secondary">
          {t("app_ollamaUrl")}
        </span>
        <input
          type="url"
          aria-label={t("app_ollamaUrl", "Ollama URL")}
          value={url}
          onChange={(e) => {
            const nextUrl = e.target.value;
            setUrl(nextUrl);
            updateOllamaSettings(nextUrl, model);
          }}
          placeholder={t(
            "app_ollamaUrlPlaceholder",
            "http://localhost:11434/api/generate",
          )}
          className="w-full px-4 py-3 text-sm outline-none font-mono shadow-inner ds-input"
        />
        <p className="text-xs font-medium mt-1 ds-text-muted">
          {t("app_ollamaUrlHelp")}
        </p>
      </div>
      <div className="space-y-2 mt-4">
        <span className="text-xs font-bold ds-text-secondary">
          {t("app_ollamaModel")}
        </span>
        <input
          type="text"
          aria-label={t("app_ollamaModel", "Ollama Model")}
          value={model}
          onChange={(e) => {
            const nextModel = e.target.value;
            setModel(nextModel);
            updateOllamaSettings(url, nextModel);
          }}
          placeholder={t("app_ollamaModelPlaceholder", "llama3.2")}
          className="w-full px-4 py-3 text-sm outline-none font-mono shadow-inner ds-input"
        />
        <p className="text-xs text-[var(--text-muted)] font-medium mt-1">
          {t("app_ollamaModelHelp")}
        </p>
      </div>
    </div>
  );
};

const CustomProviderForm: React.FC<{
  apiKey: string;
  setApiKey: (k: string) => void;
  t: TFunction;
}> = ({ apiKey, setApiKey, t }) => (
  <div className="space-y-4 pt-4 border-t border-[var(--divider)] dark:border-[var(--divider)]">
    <h4 className="text-xs font-semibold text-cyan-600 dark:text-cyan-500 uppercase tracking-widest">
      {t("app_customProvider", "Custom AI Provider")}
    </h4>
    <div className="space-y-2">
      <span className="text-xs font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
        {t("app_apiBaseUrl", "API Base URL")}
      </span>
      <input
        type="text"
        aria-label={t("app_apiBaseUrl", "API Base URL")}
        value={aiManager.getCustomBaseUrl()}
        onChange={(e) => {
          aiManager.setCustomBaseUrl(e.target.value);
          if (apiKey) {aiManager.setApiKey(apiKey);}
          setApiKey(apiKey);
        }}
        placeholder={t("placeholder_api_url", "https://api.example.com/v1")}
        className="w-full px-4 py-3 text-sm outline-none font-mono shadow-inner ds-input"
      />
      <p className="text-xs text-[var(--text-muted)] font-medium mt-1">
        {t(
          "app_apiBaseUrlHelp",
          "Must be OpenAI-compatible (e.g. DeepSeek, Mistral)",
        )}
      </p>
    </div>
    <div className="space-y-2 mt-4">
      <span className="text-xs font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
        {t("app_selectedModel", "Model ID")}
      </span>
      <input
        type="text"
        aria-label={t("app_selectedModel", "Model ID")}
        value={aiManager.getProviderInfo().model}
        onChange={(e) => {
          aiManager.setModel(e.target.value);
          setApiKey(apiKey);
        }}
        placeholder={t("placeholder_model_name", "deepseek-chat")}
        className="w-full px-4 py-3 text-sm outline-none font-mono shadow-inner ds-input"
      />
    </div>
    <ApiKeyField apiKey={apiKey} setApiKey={setApiKey} t={t} />
  </div>
);

const WebLLMForm: React.FC<{
  webLlmProgress: { text: string; progress: number } | null;
  t: TFunction;
}> = ({ webLlmProgress, t }) => (
  <div className="space-y-4 pt-4 border-t border-[var(--divider)] dark:border-[var(--divider)]">
    <h4 className="text-xs font-semibold text-cyan-600 dark:text-cyan-500 uppercase tracking-widest">
      {t("app_webLlmBrowser")}
    </h4>
    <p className="text-sm text-[var(--text-secondary)] dark:text-[var(--text-muted)] font-medium">
      {t("app_webLlmDesc")}
    </p>

    {webLlmProgress && (
      <div className="space-y-3 p-4 bg-cyan-50 dark:bg-cyan-500/10 border border-cyan-200 dark:border-cyan-500/20 rounded-xl shadow-sm">
        <div className="flex items-center justify-between text-xs text-cyan-700 dark:text-cyan-400 font-bold uppercase tracking-wider">
          <span>{t("app_downloadingModel")}</span>
          <Loader2 className="size-4 animate-spin" />
        </div>
        <div className="text-[11px] text-cyan-800 dark:text-cyan-400 font-mono break-all font-medium">
          {webLlmProgress.text}
        </div>
        <div className="w-full h-2.5 rounded-full overflow-hidden ds-bg-accent-soft">
          <div
            className="h-full transition-all duration-300 ds-bg-accent"
            style={{ width: `${Math.round(webLlmProgress.progress * 100)}%` }}
          />
        </div>
        <div className="flex justify-end">
          <span className="text-xs text-cyan-700 dark:text-cyan-400 font-bold">
            {Math.round(webLlmProgress.progress * 100)}%
          </span>
        </div>
      </div>
    )}

    <div className="space-y-2 mt-4">
      <span className="text-xs font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
        {t("app_webLlmModel")}
      </span>
      <select
        aria-label={t("app_webLlmModel")}
        value={aiManager.getProviderInfo().model}
        onChange={(e) => {
          aiManager.setWebLlmModel(e.target.value);
        }}
        className="w-full px-4 py-3 text-sm outline-none font-medium shadow-inner ds-input"
      >
        <option value="Llama-3.2-1B-Instruct-q4f16_1-MLC">
          {t("app_modelLlm321b", "Llama-3.2-1B-Instruct")} (
          {t("app_webLlmFast")}, {t("app_size1GB", "~1GB")})
        </option>
        <option value="Llama-3.2-3B-Instruct-q4f16_1-MLC">
          {t("app_modelLlm323b", "Llama-3.2-3B-Instruct")} (
          {t("app_webLlmBalanced")}, {t("app_size2GB", "~2GB")})
        </option>
        <option value="Phi-3.5-mini-instruct-q4f16_1-MLC">
          {t("app_modelPhi35", "Phi-3.5-mini-instruct")} (
          {t("app_webLlmAccurate")}, {t("app_size2_5GB", "~2.5GB")})
        </option>
        <option value="Qwen2.5-1.5B-Instruct-q4f16_1-MLC">
          {t("app_modelQwen25", "Qwen2.5-1.5B-Instruct")} (
          {t("app_webLlmMultilingual")}, {t("app_size1_5GB", "~1.5GB")})
        </option>
        <option value="gemma-2b-it-q4f16_1-MLC">
          {t("app_modelGemma2b", "Gemma-2B-IT (Google, ~2GB)")}
        </option>
      </select>
    </div>
  </div>
);

const DefaultProviderForm: React.FC<{
  apiKey: string;
  setApiKey: (k: string) => void;
  t: TFunction;
}> = ({ apiKey, setApiKey, t }) => (
  <div className="space-y-4 pt-4 border-t border-[var(--divider)] dark:border-[var(--divider)]">
    <ApiKeyField apiKey={apiKey} setApiKey={setApiKey} t={t} />

    {aiManager.getProviderInfo().availableModels &&
      aiManager.getProviderInfo().availableModels!.length > 0 && (
        <div className="space-y-2 mt-4">
          <span className="text-xs font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)]">
            {t("app_selectedModel")}
          </span>
          <select
            aria-label={t("app_selectedModel")}
            value={aiManager.getProviderInfo().model}
            onChange={(e) => {
              aiManager.setModel(e.target.value);
              setApiKey(aiManager.getApiKey() || "");
            }}
            className="w-full px-4 py-3 text-sm outline-none font-medium shadow-inner ds-input"
          >
            {aiManager.getProviderInfo().availableModels!.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
      )}

    {aiManager.getProviderInfo().provider !== "unknown" && (
      <div className="flex items-center gap-3 mt-4 p-3 bg-[var(--bg-secondary)] dark:bg-[var(--bg-primary)]/50 rounded-lg border border-[var(--divider)] dark:border-[var(--divider)]/50">
        <div className="px-3 py-1 bg-cyan-50 dark:bg-cyan-500/10 border border-cyan-200 dark:border-cyan-500/20 rounded-md text-xs text-cyan-700 dark:text-cyan-400 font-bold uppercase tracking-widest">
          {aiManager.getProviderInfo().name}
        </div>
        {!aiManager.getProviderInfo().availableModels && (
          <div className="text-xs font-mono text-[var(--text-muted)] font-medium">
            {aiManager.getProviderInfo().model}
          </div>
        )}
      </div>
    )}
  </div>
);

const ApiKeyField: React.FC<{
  apiKey: string;
  setApiKey: (k: string) => void;
  t: TFunction;
}> = ({ apiKey, setApiKey, t }) => {
  const {
    run: handleSave,
    isRunning: isSaving,
  } = useGuardedAction<void>({
    onSuccess: () => {
      toast.success(t("app_apiKeySaved", "API key saved successfully"));
    },
    onError: (error) => {
      logger.error("Failed to save API key:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : t(
              "app_apiKeySaveError",
              "Failed to save API key. Please set a master password first.",
            ),
      );
    },
  });

  const handleSaveWithKey = () => handleSave(() => aiManager.setApiKey(apiKey));

  return (
  <div className="space-y-2">
    <span className="text-xs font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)] flex items-center gap-1.5">
      <Key className="size-3.5 text-[var(--text-muted)]" /> {t("app_apiKey")}
    </span>
    <div className="flex gap-2">
      <input
        type="password"
        aria-label={t("app_apiKey")}
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        placeholder={t("app_apiKeyPlaceholder", "sk-...")}
        className="flex-1 bg-[var(--bg-secondary)] dark:bg-[var(--bg-primary)] border border-[var(--divider)] dark:border-[var(--divider)] rounded-xl px-4 py-3 text-sm text-[var(--text-primary)] dark:text-white outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 font-mono shadow-inner"
      />
      <button
        onClick={handleSaveWithKey}
        disabled={isSaving}
        className="truncate bg-[var(--bg-primary)] dark:bg-white hover:bg-[var(--state-hover-bg)] dark:hover:bg-[var(--state-hover-bg)] text-white dark:text-[var(--text-primary)] px-6 py-3 rounded-xl text-sm font-bold transition-colors shadow-sm disabled:opacity-50"
      >
        {t("app_save")}
      </button>
    </div>
    <p className="text-[11px] text-[var(--text-muted)] font-medium mt-1">
      {t("app_apiKeyHelp")}
    </p>
  </div>
  );
};
