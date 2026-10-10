import React from "react";
import { BarChart3, AlertTriangle, DollarSign, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatDate } from "../../utils/localization";
import { rateLimitService, QuotaUsage } from "../../services/RateLimitService";

interface APIUsageDashboardProps {
  className?: string;
}

const PROVIDER_COSTS: Record<
  string,
  { per1kInput: number; per1kOutput: number; currency: string }
> = {
  google: { per1kInput: 0.000075, per1kOutput: 0.0003, currency: "USD" },
  openai: { per1kInput: 0.0015, per1kOutput: 0.006, currency: "USD" },
  anthropic: { per1kInput: 0.003, per1kOutput: 0.015, currency: "USD" },
  groq: { per1kInput: 0.00009, per1kOutput: 0.00009, currency: "USD" },
};

const PROVIDER_LABELS: Record<string, string> = {
  google: "Google Gemini",
  openai: "OpenAI",
  anthropic: "Anthropic Claude",
  groq: "Groq",
};

const PROVIDER_COLORS: Record<string, string> = {
  google: "text-blue-500 bg-blue-500/10 border-blue-500/20",
  openai:
    "ds-text-success ds-bg-success/10 border-[var(--success-soft-border)]/20",
  anthropic: "text-orange-500 bg-orange-500/10 border-orange-500/20",
  groq: "ds-text-warning ds-bg-warning-soft border-[var(--color-warning)]/20",
};

export const APIUsageDashboard: React.FC<APIUsageDashboardProps> = ({
  className = "",
}) => {
  const { t, i18n } = useTranslation();
  const [usage, setUsage] = React.useState<Record<string, QuotaUsage>>({});
  const [lastUpdate, setLastUpdate] = React.useState<Date>(new Date());

  const refreshUsage = () => {
    setUsage(rateLimitService.getAllUsage());
    setLastUpdate(new Date());
  };

  React.useEffect(() => {
    refreshUsage();
    const interval = setInterval(refreshUsage, 30000);
    return () => clearInterval(interval);
  }, []);

  const providers = Object.keys(usage);
  if (providers.length === 0) {
    return (
      <div
        data-testid="settings-api-usage"
        className={`p-6 bg-[var(--bg-primary)] rounded-2xl border border-[var(--divider)] ${className}`}
      >
        <div className="flex items-center gap-3 mb-4">
          <BarChart3 className="size-5 text-[var(--text-muted)]" />
          <h3 className="text-sm font-semibold text-[var(--text-muted)] uppercase tracking-wider">
            {t("app_apiUsage", "API Usage")}
          </h3>
        </div>
        <p className="text-sm text-[var(--text-muted)] text-center py-8">
          {t(
            "app_noApiUsage",
            "No API usage yet. Start using AI features to see your usage here.",
          )}
        </p>
      </div>
    );
  }

  return (
    <div
      className={`p-6 bg-[var(--bg-primary)] rounded-2xl border border-[var(--divider)] ${className}`}
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <BarChart3 className="size-5 text-cyan-500" />
          <h3 className="text-sm font-semibold text-[var(--text-muted)] uppercase tracking-wider">
            {t("app_apiUsage", "API Usage")}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-[var(--text-secondary)]">
            {formatDate(lastUpdate, {
              hour: "numeric",
              minute: "numeric",
              second: "numeric",
            }, i18n.language)}
          </span>
          <button
            onClick={refreshUsage}
            className="p-1.5 hover:bg-[var(--state-hover-bg)] rounded-lg transition-colors"
            aria-label={t("aria_refresh_usage", "Refresh usage")}
          >
            <RefreshCw className="size-3.5 text-[var(--text-muted)]" />
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {providers.map((provider) => {
          const data = usage[provider];
          if (!data || data.requestsToday === 0) {return null;}

          const config = rateLimitService.getConfig(provider);
          const usagePercent = Math.min(
            (data.requestsToday / config.maxRequests) * 100,
            100,
          );
          const isNearLimit = rateLimitService.isNearLimit(provider, 0.9);
          const isExhausted = rateLimitService.checkLimit(provider).exhausted;

          const costConfig = PROVIDER_COSTS[provider];
          const estimatedCost = costConfig
            ? (data.tokensToday / 1000) *
              ((costConfig.per1kInput + costConfig.per1kOutput) / 2)
            : data.costEstimate;
          const formattedCost = Number.isFinite(estimatedCost)
            ? estimatedCost.toFixed(4)
            : "0.0000";

          return (
            <div
              key={provider}
              className={`p-4 rounded-xl border ${
                isExhausted
                  ? "bg-[var(--color-danger)]/5 border-[var(--danger-soft-border)]/20"
                  : isNearLimit
                    ? "bg-[var(--color-warning)]/5 border-[var(--warning-soft-border)]/20"
                    : "bg-[var(--bg-card)]/50 border-[var(--divider)]/50"
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${PROVIDER_COLORS[provider] || "text-[var(--text-muted)] bg-[var(--bg-secondary)]/10 border-[var(--divider)]/20"}`}
                  >
                    {PROVIDER_LABELS[provider] || provider}
                  </span>
                  {isExhausted && (
                    <span className="flex items-center gap-1 text-[10px] ds-text-danger font-bold">
                      <AlertTriangle className="size-3" />
                      {t("app_limitReached", "LIMIT REACHED")}
                    </span>
                  )}
                  {isNearLimit && !isExhausted && (
                    <span className="flex items-center gap-1 text-[10px] ds-text-warning font-bold">
                      <AlertTriangle className="size-3" />
                      {t("app_nearLimit", "NEAR LIMIT")}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-[var(--text-muted)]">
                    {data.requestsToday} / {config.maxRequests}{" "}
                    {t("app_reqs", "reqs")}
                  </span>
                  <span className="flex items-center gap-1 text-[var(--text-muted)]">
                    <DollarSign className="size-3" />~{formattedCost}
                  </span>
                </div>
              </div>

              <div className="w-full h-2 bg-[var(--bg-secondary)] rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    isExhausted
                      ? "bg-[var(--color-danger)]"
                      : isNearLimit
                        ? "bg-[var(--color-warning)]"
                        : "bg-cyan-500"
                  }`}
                  style={{ width: `${usagePercent}%` }}
                />
              </div>

              <div className="flex justify-between mt-1 text-[10px] text-[var(--text-secondary)]">
                <span>
                  {t("app_percentUsed", "{{percent}}% used", {
                    percent: Math.round(usagePercent),
                  })}
                </span>
                <span>
                  {t("app_tokensCount", `{{count}} tokens`, {
                    count: data.tokensToday,
                  })}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {providers.some((p) => rateLimitService.isNearLimit(p)) && (
        <div className="mt-4 p-3 bg-[var(--color-warning)]/10 border border-[var(--warning-soft-border)]/20 rounded-lg">
          <p className="text-xs ds-text-warning font-medium">
            {t(
              "app_apiUsageWarning",
              "You are approaching your daily API limit. Consider switching to a different provider or waiting until tomorrow when limits reset.",
            )}
          </p>
        </div>
      )}
    </div>
  );
};
