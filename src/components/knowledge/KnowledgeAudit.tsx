import type { BookmarkForgeDB } from "../../db/types";
import { useState, useEffect, useRef } from "react";
import { motion } from "motion/react";
import {
  FileText,
  Download,
  Sparkles,
  CheckCircle,
  AlertTriangle,
  BarChart3,
} from "lucide-react";
import type { TFunction } from "i18next";
import { formatDate } from "../../utils/localization";
import i18n from "../../i18n";
import { sanitizeText } from "../../services/SanitizationService";
import { parseFencedJson } from "../../utils/jsonFenceStripper";
import { CardProps } from "./shared-props";
import { StreamPreview } from "./StreamPreview";
import { useGuardedDataLoad } from "../../hooks/useGuardedDataLoad";
import { useGuardedAction } from "../../hooks/useGuardedAction";
import { logRateLimited } from "../../utils/boundedLog";
import { MAX_AUDIT_SAMPLE } from "../../utils/auditScan";
import { boundedBookmarkQuery } from "../../utils/knowledgeCardBounds";
import { runAuditScan } from "../../services/auditScanService";

interface Report {
  generatedAt: string;
  totalBookmarks: number;
  // Number of bookmarks actually scanned (the newest MAX_AUDIT_SAMPLE).
  // Health metrics (visitedIn30d, coverageByTag, outdatedCount) are
  // computed over this sample on large vaults; totalBookmarks is the true
  // count, so the health score must divide by the sample, not the total.
  sampleSize: number;
  totalTags: number;
  visitedIn30d: number;
  coverageByTag: { tag: string; count: number; lastVisitDays: number }[];
  gaps: string[];
  contradictions: string[];
  outdatedCount: number;
  recommendation: string;
}

interface Props extends CardProps {
  t: TFunction;
}

export const KnowledgeAudit: React.FC<Props> = ({ cardVariants, t }) => {
  const [report, setReport] = useState<Report | null>(null);
  const [scanProgress, setScanProgress] = useState<number | null>(null);
  const [streamText, setStreamText] = useState("");
  const [_aiInsights, setAiInsights] = useState<string | null>(null);
  const revokeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reportUrlRef = useRef<string | null>(null);
  const {
    loading,
  } = useGuardedDataLoad<Report | null>(
    async (signal) => {
      setScanProgress(0);
      const { initDB } = await import("../../container/database");
      const db = await initDB() as BookmarkForgeDB;
      // Bound the scan: the audit is a health dashboard, so the newest
      // MAX_AUDIT_SAMPLE bookmarks (index-backed sort + limit) are a
      // representative sample, and the headline total comes from a cheap
      // count() instead of materializing the whole collection.
      const [totalBookmarks, docs] = await Promise.all([
        db.bookmarks
          .count({ selector: { isDeleted: false, isPrivate: false } })
          .exec(),
        boundedBookmarkQuery(db.bookmarks, MAX_AUDIT_SAMPLE, {
          isDeleted: false,
          isPrivate: false,
        }).exec(),
      ]);
      if (signal.aborted) {return null;}

      const scan = await runAuditScan(
        docs.map((bm) => ({
          id: bm.id,
          title: bm.title,
          tags: bm.tags || [],
          createdAt: bm.createdAt || "",
          lastVisitedAt: bm.lastVisitedAt || "",
          updatedAt: bm.updatedAt || "",
        })),
        {
          signal,
          onProgress: (_phase, fraction) => {
            setScanProgress((previous) => {
              const next = Math.round(fraction * 100);
              return previous === next ? previous : next;
            });
          },
        },
      );

      return {
        generatedAt: new Date().toISOString(),
        totalBookmarks,
        sampleSize: docs.length,
        ...scan,
        gaps: [],
        contradictions: [],
        recommendation: "",
      };
    },
    {
      onSuccess: (report) => {
        setReport(report);
        setScanProgress(null);
      },
      onError: () => setScanProgress(null),
    },
  );
  const {
    runWithSignal: runGenerateAudit,
    isRunning: generating,
  } = useGuardedAction<void>({
    blockReentry: false,
    onStart: () => setStreamText(""),
    onSuccess: () => setStreamText(""),
    onError: (error) => {
      const isAbortError =
        (error instanceof Error || error instanceof DOMException) &&
        error.name === "AbortError";
      if (!isAbortError) {
        setStreamText("");
      }
      // AI analysis failed; user can retry
    },
  });

  useEffect(() => {
    return () => {
      if (revokeTimerRef.current) {
        clearTimeout(revokeTimerRef.current);
        revokeTimerRef.current = undefined;
      }
      if (reportUrlRef.current) {
        URL.revokeObjectURL(reportUrlRef.current);
        reportUrlRef.current = null;
      }
    };
  }, []);



  const healthScore = report
    ? Math.round(
        (report.visitedIn30d / Math.max(report.sampleSize, 1)) * 100,
      )
    : 0;

  const handleGenerateAudit = () => {
    if (!report) {return;}
    const currentReport = report;
    void runGenerateAudit(async (signal) => {
      const { agentService } = await import("../../services/ai/AgentService");
      if (signal.aborted) {return;}
      const topTags = currentReport.coverageByTag
        .slice(0, 5)
        .map((c) => c.tag)
        .join(", ");
      const prompt = `Act as a knowledge auditor. Analyze this bookmark library data and provide: 1) 2-3 knowledge gaps (missing important topics), 2) any contradictions between bookmarks, 3) estimated outdated percentage (based on bookmarks older than 1 year with no recent visit), 4) one key recommendation. Data: ${currentReport.totalBookmarks} bookmarks across ${currentReport.totalTags} tags. Top tags: ${topTags}. Return JSON with keys: gaps (string[]), contradictions (string[]), outdatedCount (number), recommendation (string).`;
      // Stream raw tokens live while the audit JSON is generated.
      const response = await agentService.globalChat(
        prompt,
        undefined,
        false,
        undefined,
        (chunk) => {
          if (!signal.aborted) {
            setStreamText((prev) => prev + chunk);
          }
        },
        undefined,
        undefined,
        signal,
      );
      if (signal.aborted) {return;}
      setStreamText("");
      setAiInsights(response.text);

      let parsed: Partial<Report>;
      try {
        parsed = parseFencedJson<Partial<Report>>(response.text);
      } catch {
        parsed = {};
        setStreamText("");
        // The audit report is kept (without AI fields); surface the failure
        // bounded so providers returning non-JSON are diagnosable.
        logRateLimited(
          "warn",
          "knowledge-audit-ai-parse",
          "AI audit response could not be parsed as JSON; report kept without AI fields",
          { snippet: response.text.slice(0, 200) },
        );
      }

      if (signal.aborted) {return;}
      setReport((prev) =>
        prev
          ? {
              ...prev,
              gaps: Array.isArray(parsed.gaps) ? parsed.gaps : [],
              contradictions: Array.isArray(parsed.contradictions)
                ? parsed.contradictions
                : [],
              outdatedCount:
                typeof parsed.outdatedCount === "number"
                  ? parsed.outdatedCount
                  : prev.outdatedCount,
              recommendation:
                typeof parsed.recommendation === "string"
                  ? parsed.recommendation
                  : "",
            }
          : prev,
      );
      // AI analysis failed (non-abort): rethrow so the guard surfaces
      // onError, which clears the stream — user can retry.
    });
  };

  const handleDownload = () => {
    if (!report) {return;}
    const esc = (value: unknown): string => sanitizeText(String(value ?? ""));
    const html = `<!DOCTYPE html>
<html>
<head><title>${esc(t("app_knowledgeAudit", "Knowledge Audit Report"))}</title>
<style>
  body{font-family:'Inter',-apple-system,sans-serif;max-width:900px;margin:40px auto;padding:0 20px;color:#1a1a2e}
  h1{font-size:28px;border-bottom:3px solid #6366f1;padding-bottom:12px}
  h2{font-size:20px;margin-top:32px;color:#6366f1}
  .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin:24px 0}
  .stat-card{background:#f8fafc;border-radius:12px;padding:20px;border:1px solid #e2e8f0}
  .stat-value{font-size:32px;font-weight:700}
  .stat-label{font-size:11px;text-transform:uppercase;letter-spacing:.12em;color:#64748b;margin-top:4px}
  table{width:100%;border-collapse:collapse;margin:16px 0}
  th,td{text-align:start;padding:10px 12px;border-bottom:1px solid #e2e8f0;font-size:14px}
  th{background:#f1f5f9;font-weight:600;text-transform:uppercase;font-size:11px;letter-spacing:.08em}
  .gap-item,.contra-item{background:#fff7ed;border-inline-start:4px solid #f97316;padding:12px 16px;margin:8px 0;border-radius:0 8px 8px 0}
  .contra-item{background:#fef2f2;border-inline-start-color:#ef4444}
  .recommendation{background:linear-gradient(135deg,#eef2ff,#f0fdf4);border-radius:16px;padding:24px;margin:24px 0;border:1px solid #c7d2fe}
  .footer{margin-top:48px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:12px;color:#94a3b8;text-align:center}
</style></head>
<body>
  <h1>${esc(t("app_knowledgeAudit", "Knowledge Audit Report"))}</h1>
  <p style="color:#64748b;margin-top:-8px">${formatDate(report.generatedAt, {}, i18n.language)}</p>
  <div class="stats">
    <div class="stat-card"><div class="stat-value">${esc(report.totalBookmarks)}</div><div class="stat-label">${esc(t("app_totalBookmarks", "Total Bookmarks"))}</div></div>
    <div class="stat-card"><div class="stat-value">${esc(report.totalTags)}</div><div class="stat-label">${esc(t("app_totalTags", "Total Tags"))}</div></div>
    <div class="stat-card"><div class="stat-value">${esc(report.outdatedCount)}</div><div class="stat-label">${esc(t("app_outdated", "Outdated"))}</div></div>
    <div class="stat-card"><div class="stat-value">${esc(healthScore)}%</div><div class="stat-label">${esc(t("app_healthScore", "Health Score"))}</div></div>
  </div>
  <h2>${esc(t("app_coverageByTag", "Coverage by Tag"))}</h2>
  <table><thead><tr><th>${esc(t("app_tag", "Tag"))}</th><th>${esc(t("app_count", "Count"))}</th><th>${esc(t("app_lastVisit", "Last Visit"))}</th></tr></thead><tbody>
    ${report.coverageByTag.map((c) => `<tr><td>${esc(c.tag)}</td><td>${esc(c.count)}</td><td>${esc(c.lastVisitDays >= 0 ? t("app_daysAgo", "{{count}} days ago", { count: c.lastVisitDays }) : t("app_never", "Never"))}</td></tr>`).join("")}
  </tbody></table>
  ${report.gaps.length ? `<h2>${esc(t("app_knowledgeGaps", "Knowledge Gaps"))}</h2>${report.gaps.map((g) => `<div class="gap-item">${esc(g)}</div>`).join("")}` : ""}
  ${report.contradictions.length ? `<h2>${esc(t("app_contradictions", "Contradictions"))}</h2>${report.contradictions.map((c) => `<div class="contra-item">${esc(c)}</div>`).join("")}` : ""}
  ${report.recommendation ? `<h2>${esc(t("app_recommendation", "Recommendation"))}</h2><div class="recommendation">${esc(report.recommendation)}</div>` : ""}
  <div class="footer">${esc(t("app_generatedAt", "Generated at"))} ${formatDate(report.generatedAt, { year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }, i18n.language)}</div>
</body></html>`;

    const blob = new Blob([html], { type: "text/html" });
    // A second download supersedes the first one. Cancel its pending cleanup
    // before replacing the URL, otherwise the old callback can clear the
    // timer reference for the new download.
    if (revokeTimerRef.current) {
      clearTimeout(revokeTimerRef.current);
      revokeTimerRef.current = undefined;
    }
    if (reportUrlRef.current) {
      URL.revokeObjectURL(reportUrlRef.current);
      reportUrlRef.current = null;
    }
    const url = URL.createObjectURL(blob);
    const win = window.open(url, "_blank", "noopener");
    if (!win) {
      URL.revokeObjectURL(url);
      return;
    }
    reportUrlRef.current = url;
    // Best-effort cleanup after the page has had time to load. The unmount
    // cleanup above also revokes it if the card disappears first.
    revokeTimerRef.current = setTimeout(() => {
      URL.revokeObjectURL(url);
      if (reportUrlRef.current === url) {reportUrlRef.current = null;}
      revokeTimerRef.current = undefined;
    }, 1000);
  };

  if (loading) {
    return (
      <motion.div
        variants={cardVariants}
        className="bento-item p-6 flex items-center justify-center gap-2"
      >
        <div className="size-6 border-2 border-[var(--accent-primary)] border-t-transparent rounded-full animate-spin" />
        <span className="text-xs tabular-nums ds-text-muted">
          {t("app_scanning", "Scanning…")} {scanProgress ?? 0}%
        </span>
      </motion.div>
    );
  }

  return (
    <motion.div
      variants={cardVariants}
      className="bento-item p-4 md:p-6 space-y-6"
    >
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl ds-bg-accent-primary ds-text-on-accent">
            <BarChart3 className="size-5" />
          </div>
          <div>
            <h2 className="ds-h2">
              {t("app_knowledgeAudit", "Knowledge Audit Report")}
            </h2>
            {report && (
              <>
                <p className="ds-label-section ds-text-muted">
                  {formatDate(report.generatedAt, {}, i18n.language)}
                </p>
                {report.totalBookmarks > MAX_AUDIT_SAMPLE && (
                  <p
                    data-testid="audit-sample-note"
                    className="text-[11px] ds-text-muted mt-1 max-w-xl"
                  >
                    {t(
                      "app_auditSampleNote",
                      "Showing {{sampleSize}} of {{totalBookmarks}} bookmarks; metrics use this sample.",
                      {
                        sampleSize: report.sampleSize,
                        totalBookmarks: report.totalBookmarks,
                      },
                    )}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleGenerateAudit}
            disabled={generating}
            className="truncate flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all disabled:opacity-50 ds-bg-accent-primary ds-text-on-accent hover:scale-105 active:scale-95"
          >
            <FileText
              className={`size-3.5 ${generating ? "animate-pulse" : ""}`}
            />
            {generating
              ? t("app_generating", "Generating...")
              : t("app_generateFullAudit", "Generate Full Audit")}
          </button>
          {report && (
            <button
              onClick={handleDownload}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all ds-border ds-text-secondary hover:scale-105 active:scale-95"
              title={t("app_downloadReport", "Download Report")}
            >
              <Download className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      {generating && <StreamPreview text={streamText} />}

      {report && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {(
              [
                {
                  label: t("app_totalBookmarks", "Total Bookmarks"),
                  value: report.totalBookmarks,
                  icon: BarChart3,
                  color: "ds-text-accent-primary",
                  bg: "ds-bg-accent-soft",
                },
                {
                  label: t("app_totalTags", "Total Tags"),
                  value: report.totalTags,
                  icon: FileText,
                  color: "ds-text-info",
                  bg: "ds-bg-info-soft",
                },
                {
                  label: t("app_outdated", "Outdated"),
                  value: report.outdatedCount,
                  icon: AlertTriangle,
                  color: "ds-text-warning",
                  bg: "ds-bg-warning-soft",
                },
                {
                  label: t("app_healthScore", "Health Score"),
                  value: `${healthScore}%`,
                  icon: CheckCircle,
                  color:
                    healthScore >= 50 ? "ds-text-success" : "ds-text-warning",
                  bg:
                    healthScore >= 50
                      ? "ds-bg-success-soft"
                      : "ds-bg-warning-soft",
                },
              ] as const
            ).map((item, i) => {
              const Icon = item.icon;
              return (
                <div
                  key={i}
                  className="p-4 rounded-2xl ds-card ds-border flex items-center justify-between group hover:shadow-lg transition-all"
                >
                  <div>
                    <div
                      className={`p-2 rounded-xl ${item.bg} ${item.color} inline-flex group-hover:scale-110 transition-transform`}
                    >
                      <Icon className="size-4" />
                    </div>
                    <p className="ds-label-section ds-text-muted mt-3">
                      {item.label}
                    </p>
                  </div>
                  <span className="ds-display-numeric">{item.value}</span>
                </div>
              );
            })}
          </div>

          <div className="space-y-3">
            <h3 className="ds-h3 truncate">
              {t("app_coverageByTag", "Coverage by Tag")}
            </h3>
            <div className="ds-divide-y divide-y">
              {report.coverageByTag.slice(0, 10).map((c) => {
                const dotColor =
                  c.lastVisitDays < 0
                    ? "bg-gray-400"
                    : c.lastVisitDays <= 30
                      ? "bg-green-500"
                      : c.lastVisitDays <= 90
                        ? "bg-yellow-500"
                        : "bg-red-500";
                const textColor =
                  c.lastVisitDays < 0
                    ? "ds-text-muted"
                    : c.lastVisitDays <= 30
                      ? "ds-text-success"
                      : c.lastVisitDays <= 90
                        ? "ds-text-warning"
                        : "ds-text-error";
                return (
                  <div
                    key={c.tag}
                    className="flex items-center justify-between py-3"
                  >
                    <div className="flex items-center gap-3">
                      <span className={`size-2.5 rounded-full ${dotColor}`} />
                      <span className="ds-text-secondary text-sm font-medium">
                        {c.tag}
                      </span>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="ds-badge ds-bg-accent-soft ds-text-accent-primary text-xs font-bold px-2.5 py-0.5 rounded-full">
                        {c.count}
                      </span>
                      <span className={`text-xs tabular-nums ${textColor}`}>
                        {c.lastVisitDays < 0
                          ? t("app_never", "Never")
                          : c.lastVisitDays <= 1
                            ? t("app_today", "Today")
                            : t("app_daysAgo", "{{count}}d", {
                                count: c.lastVisitDays,
                              })}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {(report.gaps.length > 0 || report.contradictions.length > 0) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {report.gaps.length > 0 && (
                <div className="p-5 rounded-2xl ds-card ds-border">
                  <div className="flex items-center gap-2 mb-4">
                    <Sparkles className="size-4 ds-text-warning" />
                    <h3 className="ds-h3 truncate">
                      {t("app_knowledgeGaps", "Knowledge Gaps")}
                    </h3>
                  </div>
                  <ul className="space-y-2">
                    {report.gaps.map((gap, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-2 text-sm ds-text-secondary"
                      >
                        <span className="size-1.5 rounded-full ds-bg-warning mt-1.5 shrink-0" />
                        {gap}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {report.contradictions.length > 0 && (
                <div className="p-5 rounded-2xl ds-card ds-border">
                  <div className="flex items-center gap-2 mb-4">
                    <AlertTriangle className="size-4 ds-text-error" />
                    <h3 className="ds-h3 truncate">
                      {t("app_contradictions", "Contradictions")}
                    </h3>
                  </div>
                  <ul className="space-y-2">
                    {report.contradictions.map((c, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-2 text-sm ds-text-secondary"
                      >
                        <span className="size-1.5 rounded-full ds-bg-error mt-1.5 shrink-0" />
                        {c}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {report.recommendation && (
            <div className="p-5 rounded-2xl ds-bg-accent-soft ds-border-accent">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle className="size-4 ds-text-success" />
                <h3 className="ds-h3 truncate">
                  {t("app_recommendation", "Recommendation")}
                </h3>
              </div>
              <p className="ds-text-secondary text-sm leading-relaxed">
                {report.recommendation}
              </p>
            </div>
          )}

          <div className="ds-label-section ds-text-muted text-center pt-4 ds-border-t">
            {t("app_generatedAt", "Generated at")}{" "}
            {formatDate(report.generatedAt, { year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }, i18n.language)}
          </div>
        </>
      )}

      {!report && !loading && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <BarChart3 className="size-12 ds-text-muted mb-4" />
          <p className="ds-text-secondary">
            {t("app_noData", "No bookmark data available")}
          </p>
        </div>
      )}
    </motion.div>
  );
};
