import React from "react";
import { Settings, X, CheckCircle2, AlertCircle, Activity } from "lucide-react";
import {
  AIProvider,
  ProviderInfo,
  ProviderManager,
} from "../../services/ai/ProviderManager";
import { DiagnosticsModal } from "./DiagnosticsModal";
import { logger } from "../../utils/logger";
import { toast } from "sonner";

interface ApiSettingsModalProps {
  showApiSettings: boolean;
  setShowApiSettings: (show: boolean) => void;
  aiManager: ProviderManager;
  apiKeyInput: string;
  setApiKeyInput: (key: string) => void;
  providerInfo: ProviderInfo;
  setProviderInfo: (info: ProviderInfo) => void;
  t: (key: string) => string;
}

export const ApiSettingsModal = ({
    showApiSettings,
    setShowApiSettings,
    aiManager,
    apiKeyInput,
    setApiKeyInput,
    providerInfo,
    setProviderInfo,
    t,
  }: ApiSettingsModalProps) => {
    const [showDiagnostics, setShowDiagnostics] = React.useState(false);

    if (!showApiSettings) {
      return null;
    }

    return (
      <div className="ds-modal-overlay z-50 p-4">
        <div
          className="w-full max-w-md overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200 ds-card ds-radius-button"
          role="dialog"
          aria-modal="true"
          aria-labelledby="api-settings-title"
        >
          <div className="flex items-center justify-between p-4 ds-topbar">
            <h3
              id="api-settings-title"
              className="text-lg font-semibold flex items-center gap-2 ds-text-primary min-w-0 line-clamp-2"
            >
              <Settings className="size-5 ds-text-muted" />
              {t("app_aiSettings")}
            </h3>
            <button
              onClick={() => setShowApiSettings(false)}
              className="transition-colors ds-text-muted"
              aria-label={t("app_close")}
            >
              <X className="size-5" aria-hidden="true" />
            </button>
          </div>
          <div className="p-6 space-y-6">
            <p className="text-sm ds-text-secondary">
              {t("app_aiSettingsDesc")}
            </p>

            <button
              onClick={() => setShowDiagnostics(true)}
              className="truncate w-full flex items-center justify-between p-3 transition-all group"
            >
              <div className="flex items-center gap-3">
                <Activity className="size-4 ds-text-accent" />
                <span className="text-sm font-medium ds-text-primary">
                  {t("app_systemDiagnostics")}
                </span>
              </div>{" "}
              <span className="text-[10px] px-2 py-1 uppercase font-bold tracking-wider ds-text-accent ds-radius-button ds-bg-accent-soft">
                {t("app_open")}
              </span>
            </button>

            <div className="space-y-4">
              <div className="space-y-2">
                <span className="text-xs font-medium uppercase tracking-wider ds-text-secondary">
                  {t("app_aiProviderSelect")}
                </span>
                <select
                  aria-label={t("app_aiProviderSelect")}
                  value={aiManager.getProviderInfo().provider}
                  onChange={(e) => {
                    const val = e.target.value as AIProvider;
                    aiManager.setProvider(val);
                    setApiKeyInput(aiManager.getApiKey() || "");
                    setProviderInfo(aiManager.getProviderInfo());
                  }}
                  className="w-full px-3 py-2 text-sm outline-none ds-input"
                >
                  <option value="gemini">
                    {t("app_cloudAi")} ({t("app_gemini")})
                  </option>
                  <option value="openai">{t("app_openai")}</option>
                  <option value="anthropic">{t("app_anthropic")}</option>
                  <option value="groq">{t("app_groq")}</option>
                  <option value="ollama">
                    {t("app_localAi")} ({t("app_ollama")})
                  </option>
                </select>
              </div>

              {aiManager.getProviderInfo().provider === "ollama" ? (
                <div className="space-y-4 p-4 ds-bg-secondary border border-[var(--divider)] ds-radius-button">
                  <div className="space-y-2">
                    <span className="text-xs ds-text-secondary">
                      {t("app_ollamaUrl")}
                    </span>
                    <input
                      type="text"
                      aria-label={t("app_ollamaUrl")}
                      value={aiManager.getOllamaSettings().url}
                      onChange={(e) => {
                        aiManager.setOllamaSettings(
                          e.target.value,
                          aiManager.getOllamaSettings().model,
                        );
                        setProviderInfo(aiManager.getProviderInfo());
                      }}
                      placeholder={
                        t("app_ollamaUrlPlaceholder") ||
                        t("app_ollamaUrlExample")
                      }
                      className="w-full px-4 py-2 text-sm outline-none ds-input"
                    />
                  </div>
                  <div className="space-y-2">
                    <span className="text-xs ds-text-secondary">
                      {t("app_ollamaModel")}
                    </span>
                    <input
                      type="text"
                      aria-label={t("app_ollamaModel")}
                      value={aiManager.getOllamaSettings().model}
                      onChange={(e) => {
                        aiManager.setOllamaSettings(
                          aiManager.getOllamaSettings().url,
                          e.target.value,
                        );
                        setProviderInfo(aiManager.getProviderInfo());
                      }}
                      placeholder={
                        t("app_ollamaModelPlaceholder") ||
                        t("app_ollamaModelExample")
                      }
                      className="w-full px-4 py-2 text-sm outline-none ds-input"
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <span className="text-xs font-medium uppercase tracking-wider ds-text-secondary">
                      {t("app_apiKey")}
                    </span>
                    <input
                      type="password"
                      aria-label={t("app_apiKey")}
                      value={apiKeyInput}
                      onChange={(e) => {
                        setApiKeyInput(e.target.value);
                      }}
                      placeholder={
                        t("app_apiKeyAllProviders") ||
                        t("app_apiKeyAllProvidersExample")
                      }
                      className="w-full px-4 py-2 text-sm transition-colors outline-none ds-input"
                    />
                  </div>

                  {aiManager.getProviderInfo().availableModels &&
                    aiManager.getProviderInfo().availableModels!.length > 0 && (
                      <div className="space-y-2">
                        <span className="text-xs font-medium uppercase tracking-wider ds-text-secondary">
                          {t("app_selectedModel")}
                        </span>
                        <select
                          aria-label={t("app_selectedModel")}
                          value={aiManager.getProviderInfo().model}
                          onChange={(e) => {
                            aiManager.setModel(e.target.value);
                            setProviderInfo(aiManager.getProviderInfo());
                          }}
                          className="w-full px-3 py-2 text-sm outline-none ds-input"
                        >
                          {aiManager
                            .getProviderInfo()
                            .availableModels!.map((m: string) => (
                              <option key={m} value={m}>
                                {m}
                              </option>
                            ))}
                        </select>
                      </div>
                    )}
                </div>
              )}
            </div>

            {apiKeyInput &&
              providerInfo.provider !== "unknown" &&
              providerInfo.provider !== "ollama" && (
                <div
                  className="p-4 ds-radius-button"
                  style={{
                    background: providerInfo.fullSupport
                      ? "var(--success-soft)"
                      : "var(--warning-soft)",
                    border: providerInfo.fullSupport
                      ? "1px solid var(--success-soft-border)"
                      : "1px solid var(--warning-soft-border)",
                  }}
                >
                  <div className="flex items-start gap-3">
                    {providerInfo.fullSupport ? (
                      <CheckCircle2 className="size-5 ds-text-success shrink-0 mt-0.5" />
                    ) : (
                      <AlertCircle className="size-5 ds-text-warning shrink-0 mt-0.5" />
                    )}
                    <div>
                      <h4
                        className={`text-sm font-medium mb-1 line-clamp-2 ${providerInfo.fullSupport ? "ds-text-success" : "ds-text-warning"}`}
                      >
                        {t("app_providerDetected")}: {providerInfo.name}
                      </h4>
                      <p className="text-xs leading-relaxed ds-text-secondary">
                        {providerInfo.fullSupport
                          ? t("app_fullSupportDesc")
                          : t("app_partialSupportDesc")}
                      </p>
                      {!providerInfo.availableModels && (
                        <p className="text-xs mt-2 ds-text-muted">
                          {t("app_selectedModel")}: {providerInfo.model}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}
          </div>
          <div className="p-4 flex justify-end gap-2 ds-topbar">
            <button
              onClick={() => setShowApiSettings(false)}
              className="truncate px-4 py-2 text-sm font-medium transition-colors ds-bg-secondary ds-text-primary"
            >
              {t("app_cancel")}
            </button>
            <button
              onClick={async () => {
                try {
                  await aiManager.setApiKey(apiKeyInput);
                  setProviderInfo(aiManager.getProviderInfo());
                  setShowApiSettings(false);
                } catch (error) {
                  logger.error("Failed to save API key:", error);
                  // P90: sonner toast instead of the native alert() dialog.
                  toast.error(
                    error instanceof Error
                      ? error.message
                      : "Failed to save API key. Please set a master password first.",
                  );
                }
              }}
              className="truncate text-white px-6 py-2 text-sm font-medium transition-colors ds-accent-filled"
            >
              {t("app_save")}
            </button>
          </div>
        </div>

        <DiagnosticsModal
          show={showDiagnostics}
          onClose={() => setShowDiagnostics(false)}
          t={t}
        />
      </div>
    );
  };
