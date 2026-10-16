import { useState, useEffect, useCallback } from "react";
import {
  TrendingUp,
  Users,
  BarChart3,
  Clock,
  CheckCircle2,
  Circle,
  Zap,
  Loader2,
  RefreshCw,
  Download,
  Shield,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  analyticsService,
  type AnalyticsSnapshot,
  type RetentionKPIs,
  type EngagementKPIs,
} from "../../services/AnalyticsService";
import { getStoredConsent } from "../ConsentBanner";
import { toast } from "sonner";
import { logger } from "../../utils/logger";

// ── Reusable sub-components ────────────────────────────────────────

interface StatCardProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  color: string;
  subtitle?: string;
}

const StatCard: React.FC<StatCardProps> = ({
  icon: Icon,
  label,
  value,
  color,
  subtitle,
}) => (
  <div
    className="flex items-center justify-between p-3 rounded-xl ds-bg-secondary ds-border"
    title={subtitle}
  >
    <div className="flex items-center gap-3">
      <div className={`p-2 rounded-lg ${color}`}>
        <Icon className="size-4" aria-hidden="true" />
      </div>
      <span className="text-sm font-medium ds-text-secondary truncate">
        {label}
      </span>
    </div>
    <span className="text-sm font-mono ds-text-primary truncate">
      {value}
    </span>
  </div>
);

StatCard.displayName = "StatCard";

interface FunnelStepProps {
  label: string;
  completed: boolean;
  isLast?: boolean;
}

const FunnelStep: React.FC<FunnelStepProps> = ({ label, completed, isLast }) => (
  <div className="flex items-center gap-3">
    <div
      className={`flex items-center justify-center size-6 rounded-full ${
        completed
          ? "ds-bg-accent-primary/20 ds-text-accent"
          : "ds-bg-secondary ds-text-muted"
      }`}
    >
      {completed ? (
        <CheckCircle2 className="size-4" aria-hidden="true" />
      ) : (
        <Circle className="size-4" aria-hidden="true" />
      )}
    </div>
    <div className="flex-1 min-w-0">
      <span
        className={`text-sm font-medium ${
          completed ? "ds-text-primary" : "ds-text-muted"
        }`}
      >
        {label}
      </span>
    </div>
    {!isLast && (
      <div
        className={`w-px h-4 mx-2 ${
          completed ? "ds-bg-accent-primary" : "ds-bg-muted"
        }`}
        aria-hidden="true"
      />
    )}
  </div>
);

FunnelStep.displayName = "FunnelStep";

// ── Main component ─────────────────────────────────────────────────

interface AnalyticsDiagnosticsProps {
  /** Pass translation function from parent modal */
  t: (key: string, options?: Record<string, unknown> | string) => string;
}

/**
 * AnalyticsDiagnostics — displays privacy-first analytics KPIs.
 *
 * Shows three sections:
 * 1. Retention: active days, D1/D7/D30, streaks
 * 2. Engagement: sessions, bookmarks, documents, searches, AI calls, etc.
 * 3. Setup funnel: vault created → first capture → first document
 *
 * All data is local-only (IndexedDB). The component reads from
 * AnalyticsService.getSnapshot() and respects the user's consent state.
 */
export const AnalyticsDiagnostics: React.FC<AnalyticsDiagnosticsProps> = ({
  t,
}) => {
  const { t: tFn } = useTranslation();
  const translate = t || tFn;
  const [snapshot, setSnapshot] = useState<AnalyticsSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [consentGranted, setConsentGranted] = useState(() => {
    const consent = getStoredConsent();
    return consent?.analytics ?? false;
  });

  const loadSnapshot = useCallback(async () => {
    setLoading(true);
    try {
      const data = await analyticsService.getSnapshot();
      setSnapshot(data);
    } catch (err) {
      logger.error("[AnalyticsDiagnostics] Failed to load snapshot", { error: err });
    } finally {
      setLoading(false);
    }
  }, []);

  // Load on mount if consent is granted
  useEffect(() => {
    if (consentGranted) {
      void loadSnapshot();
    }
  }, [consentGranted, loadSnapshot]);

  // Listen for consent changes
  useEffect(() => {
    const checkConsent = () => {
      const consent = getStoredConsent();
      setConsentGranted(consent?.analytics ?? false);
    };
    // Check on storage changes (other tabs or Settings toggles)
    window.addEventListener("storage", checkConsent);
    return () => window.removeEventListener("storage", checkConsent);
  }, []);

  const handleExport = () => {
    if (!snapshot) return;
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bookmarkforge-analytics-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(translate("analytics_exportSuccess", "Analytics snapshot exported"));
  };

  if (!consentGranted) {
    return (
      <section className="space-y-4" data-testid="analytics-diagnostics">
        <h4 className="text-xs font-semibold uppercase tracking-widest flex items-center gap-2 ds-text-muted line-clamp-2">
          <TrendingUp className="size-4" aria-hidden="true" />{" "}
          {translate("analytics_title", "Product Analytics")}
        </h4>
        <div className="p-4 rounded-xl ds-bg-secondary ds-border text-center">
          <Shield className="size-6 mx-auto mb-2 ds-text-muted" aria-hidden="true" />
          <p className="text-sm ds-text-secondary">
            {translate(
              "analytics_consentRequired",
              "Enable analytics in Privacy settings to view usage insights."
            )}
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-4" data-testid="analytics-diagnostics">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-widest flex items-center gap-2 ds-text-muted line-clamp-2">
          <TrendingUp className="size-4" aria-hidden="true" />{" "}
          {translate("analytics_title", "Product Analytics")}
        </h4>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void loadSnapshot()}
            disabled={loading}
            className="p-1.5 rounded-lg ds-bg-secondary ds-text-muted hover:ds-text-primary transition-colors"
            aria-label={translate("analytics_refresh", "Refresh analytics")}
          >
            <RefreshCw
              className={`size-3.5 ${loading ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
          </button>
          {snapshot && snapshot.eventCount > 0 && (
            <button
              onClick={handleExport}
              className="p-1.5 rounded-lg ds-bg-secondary ds-text-muted hover:ds-text-primary transition-colors"
              aria-label={translate("analytics_export", "Export analytics")}
            >
              <Download className="size-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {loading && !snapshot ? (
        <div className="flex items-center justify-center h-24">
          <Loader2 className="size-6 ds-text-accent animate-spin" />
        </div>
      ) : snapshot ? (
        <div className="space-y-6">
          {/* Retention KPIs */}
          <RetentionSection
            retention={snapshot.retention}
            t={translate}
          />

          {/* Engagement KPIs */}
          <EngagementSection
            engagement={snapshot.engagement}
            t={translate}
          />

          {/* Setup Funnel */}
          <FunnelSection
            funnel={snapshot.engagement.funnel}
            t={translate}
          />

          {/* Metadata */}
          <div className="flex items-center justify-between px-3 py-2 rounded-lg ds-bg-secondary text-[10px] ds-text-muted">
            <span>
              {translate("analytics_eventCount", {
                defaultValue: "{{count}} events tracked",
                count: snapshot.eventCount,
              })}
            </span>
            <span>
              {translate("analytics_generated", {
                defaultValue: "Updated {{time}}",
                time: new Date(snapshot.generatedAt).toLocaleTimeString(),
              })}
            </span>
          </div>
        </div>
      ) : (
        <div className="p-4 rounded-xl ds-bg-secondary ds-border text-center">
          <BarChart3 className="size-6 mx-auto mb-2 ds-text-muted" aria-hidden="true" />
          <p className="text-sm ds-text-secondary">
            {translate("analytics_noData", "No analytics data yet. Start using the app to see insights.")}
          </p>
        </div>
      )}
    </section>
  );
};

AnalyticsDiagnostics.displayName = "AnalyticsDiagnostics";

// ── Retention Section ──────────────────────────────────────────────

interface RetentionSectionProps {
  retention: RetentionKPIs;
  t: (key: string, options?: Record<string, unknown> | string) => string;
}

const RetentionSection: React.FC<RetentionSectionProps> = ({
  retention,
  t: translate,
}) => (
  <div className="space-y-3">
    <h5 className="text-[11px] font-semibold uppercase tracking-wider ds-text-muted flex items-center gap-2">
      <Clock className="size-3.5" aria-hidden="true" />
      {translate("analytics_retention", "Retention")}
    </h5>
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      <StatCard
        icon={Clock}
        label={translate("analytics_activeDays", "Active Days")}
        value={retention.activeDays}
        color="bg-blue-500/10 text-blue-500"
        subtitle={translate("analytics_activeDaysDesc", "Unique days with activity")}
      />
      <StatCard
        icon={TrendingUp}
        label={translate("analytics_accountAge", "Account Age")}
        value={`${retention.accountAge}d`}
        color="bg-violet-500/10 text-violet-500"
        subtitle={translate("analytics_accountAgeDesc", "Days since first event")}
      />
      <StatCard
        icon={Zap}
        label={translate("analytics_currentStreak", "Current Streak")}
        value={`${retention.currentStreak}d`}
        color="bg-orange-500/10 text-orange-500"
        subtitle={translate("analytics_currentStreakDesc", "Consecutive active days")}
      />
      <StatCard
        icon={Zap}
        label={translate("analytics_longestStreak", "Best Streak")}
        value={`${retention.longestStreak}d`}
        color="bg-rose-500/10 text-rose-500"
        subtitle={translate("analytics_longestStreakDesc", "Longest active streak ever")}
      />
      <div className="col-span-2 md:col-span-2 flex items-center gap-4 p-3 rounded-xl ds-bg-secondary ds-border">
        <span className="text-xs font-medium ds-text-secondary">
          {translate("analytics_recentActivity", "Recent Activity")}
        </span>
        <div className="flex items-center gap-3 text-xs">
          <span
            className={`px-2 py-0.5 rounded-full font-mono ${
              retention.activeD1
                ? "ds-bg-accent-primary/20 ds-text-accent"
                : "ds-bg-secondary ds-text-muted"
            }`}
          >
            D1: {retention.activeD1 ? "✓" : "—"}
          </span>
          <span
            className={`px-2 py-0.5 rounded-full font-mono ${
              retention.activeD7
                ? "ds-bg-accent-primary/20 ds-text-accent"
                : "ds-bg-secondary ds-text-muted"
            }`}
          >
            D7: {retention.activeD7 ? "✓" : "—"}
          </span>
          <span
            className={`px-2 py-0.5 rounded-full font-mono ${
              retention.activeD30
                ? "ds-bg-accent-primary/20 ds-text-accent"
                : "ds-bg-secondary ds-text-muted"
            }`}
          >
            D30: {retention.activeD30 ? "✓" : "—"}
          </span>
        </div>
      </div>
    </div>
  </div>
);

RetentionSection.displayName = "RetentionSection";

// ── Engagement Section ─────────────────────────────────────────────

interface EngagementSectionProps {
  engagement: EngagementKPIs;
  t: (key: string, options?: Record<string, unknown> | string) => string;
}

const EngagementSection: React.FC<EngagementSectionProps> = ({
  engagement,
  t: translate,
}) => {
  const formatDuration = (seconds: number): string => {
    if (seconds === 0) return "—";
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  };

  return (
    <div className="space-y-3">
      <h5 className="text-[11px] font-semibold uppercase tracking-wider ds-text-muted flex items-center gap-2">
        <Users className="size-3.5" aria-hidden="true" />
        {translate("analytics_engagement", "Engagement")}
      </h5>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatCard
          icon={Users}
          label={translate("analytics_sessions", "Sessions")}
          value={engagement.totalSessions}
          color="bg-blue-500/10 text-blue-500"
        />
        <StatCard
          icon={BarChart3}
          label={translate("analytics_avgSession", "Avg Session")}
          value={formatDuration(engagement.avgSessionDurationSec)}
          color="bg-violet-500/10 text-violet-500"
        />
        <StatCard
          icon={BarChart3}
          label={translate("analytics_medianSession", "Median Session")}
          value={formatDuration(engagement.medianSessionDurationSec)}
          color="bg-indigo-500/10 text-indigo-500"
        />
        <StatCard
          icon={Zap}
          label={translate("analytics_bookmarks", "Bookmarks")}
          value={engagement.totalBookmarks}
          color="bg-cyan-500/10 text-cyan-500"
        />
        <StatCard
          icon={Zap}
          label={translate("analytics_documents", "Documents")}
          value={engagement.totalDocuments}
          color="bg-emerald-500/10 text-emerald-500"
        />
        <StatCard
          icon={Zap}
          label={translate("analytics_searches", "Searches")}
          value={engagement.totalSearches}
          color="bg-amber-500/10 text-amber-500"
        />
        <StatCard
          icon={Zap}
          label={translate("analytics_imports", "Imports")}
          value={engagement.totalImports}
          color="bg-rose-500/10 text-rose-500"
        />
        <StatCard
          icon={Zap}
          label={translate("analytics_exports", "Exports")}
          value={engagement.totalExports}
          color="bg-pink-500/10 text-pink-500"
        />
        <StatCard
          icon={Zap}
          label={translate("analytics_aiCalls", "AI Calls")}
          value={engagement.totalAICalls}
          color="bg-orange-500/10 text-orange-500"
        />
        <StatCard
          icon={Zap}
          label={translate("analytics_p2pSyncs", "P2P Syncs")}
          value={engagement.totalP2PSyncs}
          color="bg-teal-500/10 text-teal-500"
        />
        <StatCard
          icon={Zap}
          label={translate("analytics_captures", "Captures")}
          value={engagement.totalCaptures}
          color="bg-sky-500/10 text-sky-500"
        />
      </div>

      {/* Features Used */}
      {engagement.featuresUsed.length > 0 && (
        <div className="p-3 rounded-xl ds-bg-secondary ds-border">
          <span className="text-[11px] font-semibold uppercase tracking-wider ds-text-muted block mb-2">
            {translate("analytics_featuresUsed", "Features Used")}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {engagement.featuresUsed.map((feature) => (
              <span
                key={feature}
                className="px-2 py-0.5 text-[10px] font-mono rounded-full ds-bg-accent-primary/10 ds-text-accent"
              >
                {feature}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

EngagementSection.displayName = "EngagementSection";

// ── Setup Funnel Section ───────────────────────────────────────────

interface FunnelSectionProps {
  funnel: EngagementKPIs["funnel"];
  t: (key: string, options?: Record<string, unknown> | string) => string;
}

const FunnelSection: React.FC<FunnelSectionProps> = ({
  funnel,
  t: translate,
}) => {
  const steps = [
    {
      label: translate("funnel_vaultCreated", "Vault Created"),
      completed: funnel.vaultCreated,
    },
    {
      label: translate("funnel_firstCapture", "First Capture"),
      completed: funnel.firstCapture,
    },
    {
      label: translate("funnel_firstDocument", "First Document"),
      completed: funnel.firstDocument,
    },
    {
      label: translate("funnel_setupCompleted", "Setup Complete"),
      completed: funnel.setupCompleted,
    },
  ];

  const completedCount = steps.filter((s) => s.completed).length;
  const progress = Math.round((completedCount / steps.length) * 100);

  return (
    <div className="space-y-3">
      <h5 className="text-[11px] font-semibold uppercase tracking-wider ds-text-muted flex items-center gap-2">
        <CheckCircle2 className="size-3.5" aria-hidden="true" />
        {translate("analytics_setupFunnel", "Setup Funnel")}
      </h5>

      {/* Progress bar */}
      <div className="relative h-2 rounded-full ds-bg-secondary overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-500 ease-out"
          style={{
            width: `${progress}%`,
            background: "var(--accent-primary)",
          }}
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={translate("analytics_funnelProgress", {
            defaultValue: "Setup {{progress}}% complete",
            progress,
          })}
        />
      </div>

      {/* Steps */}
      <div className="space-y-2">
        {steps.map((step, i) => (
          <FunnelStep
            key={step.label}
            label={step.label}
            completed={step.completed}
            isLast={i === steps.length - 1}
          />
        ))}
      </div>
    </div>
  );
};

FunnelSection.displayName = "FunnelSection";
