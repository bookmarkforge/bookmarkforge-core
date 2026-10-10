import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Languages, RefreshCw, Globe } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useGuardedAction } from "../../hooks/useGuardedAction";
import type { TFunction } from "i18next";
import { safeGet, safeSet } from "../../store/safeStorage";
import { logger } from "../../utils/logger";
import { scanCrossLanguageBridges } from "../../services/knowledgeScanService";
import type { ScanBookmark, Bridge } from "../../utils/knowledgeScan";
import { CardProps } from "./shared-props";

interface Props extends CardProps {
  t: TFunction;
}

const LANGUAGE_FLAGS: Record<string, string> = {
  en: "\uD83C\uDDEC\uD83C\uDDE7",
  ja: "\uD83C\uDDEF\uD83C\uDDF5",
  ko: "\uD83C\uDDF0\uD83C\uDDF7",
  zh: "\uD83C\uDDE8\uD83C\uDDF3",
  ru: "\uD83C\uDDF7\uD83C\uDDFA",
  ar: "\uD83C\uDDF8\uD83C\uDDE6",
  hi: "\uD83C\uDDEE\uD83C\uDDF3",
  de: "\uD83C\uDDE9\uD83C\uDDEA",
  fr: "\uD83C\uDDEB\uD83C\uDDF7",
  es: "\uD83C\uDDEA\uD83C\uDDF8",
  it: "\uD83C\uDDEE\uD83C\uDDF9",
  pt: "\uD83C\uDDF5\uD83C\uDDF9",
};

const STORAGE_KEY = "bookmarkforge_language_bridges";

export function CrossLanguageBridge({
  cardVariants: _cardVariants,
  t: _t,
}: Props) {
  const { t } = useTranslation();
  const [bridges, setBridges] = useState<Bridge[]>([]);
  const [loading, setLoading] = useState(true);
  // 0..100 whole-percent scan progress; null while not scanning. Updated
  // from the worker's status messages (throttled to whole-percent changes).
  const [scanProgress, setScanProgress] = useState<number | null>(null);

  // Scan is a manual/refresh action — useGuardedAction: isRunning feeds the
  // rescan spinner, a late result after unmount is dropped (the original had
  // no unmount protection), and the initial `loading` gate stays a separate
  // state because the card must hide ONLY during the first scan.
  const scan = useGuardedAction<Bridge[]>({
    onSuccess: (computed) => {
      setBridges(computed);
      setLoading(false);
      setScanProgress(null);
      try {
        safeSet(STORAGE_KEY, JSON.stringify(computed));
      } catch {
        /* INTENTIONAL SILENCE: optional localStorage persistence is best-effort. */
      }
    },
    onError: (err) => {
      // The original finally cleared loading on failure too — the card must
      // render its empty state instead of hiding forever.
      setLoading(false);
      setScanProgress(null);
      // An abort is the expected outcome of a refresh or unmount, not a
      // failure — do not log it as an error.
      if (err instanceof Error && err.name === "AbortError") {return;}
      logger.error("[CrossLanguageBridge] scan failed", err);
    },
  });
  const scanning = scan.isRunning;

  // The pairwise scan runs in a Web Worker (see knowledgeScanService) with a
  // bounded per-language sample, so a vault with 100k+ bookmarks cannot
  // freeze the UI. The topic fallback label is i18n and is resolved at render
  // time (`bridge.topic ?? t(...)`), keeping the worker free of i18n deps.
  const scanBridges = useCallback(() => {
    setScanProgress(null);
    void scan.runWithSignal(async (signal) => {
      const { initDB } = await import("../../container/database");
      const db = await initDB();
      if (signal.aborted) {return [];}
      const rows = await db.bookmarks
        .find({
          selector: { isDeleted: false, isPrivate: false },
        })
        .exec();
      if (signal.aborted) {return [];}

      const bookmarks: ScanBookmark[] = rows.map((bm) => ({
        id: bm.id,
        title: bm.title,
        url: bm.url,
        tags: Array.isArray(bm.tags) ? bm.tags : [],
        updatedAt: bm.updatedAt,
        visitCount: typeof bm.visitCount === "number" ? bm.visitCount : 0,
      }));
      // Worker scan with live progress and cancellation: abort (unmount or a
      // newer scan) retires the worker task / stops the inline fallback.
      return scanCrossLanguageBridges(bookmarks, {}, {
        signal,
        onProgress: (_phase, fraction) => {
          setScanProgress((prev) => {
            const next = Math.round(fraction * 100);
            return prev === next ? prev : next;
          });
        },
      });
    });
  }, [scan.runWithSignal]);

  useEffect(() => {
    try {
      const cached = safeGet(STORAGE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached) as Bridge[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          setBridges(parsed);
          setLoading(false);
          return;
        }
      }
    } catch {
      /* INTENTIONAL SILENCE: invalid optional cache triggers a fresh scan. */
    }
    scanBridges();
  }, [scanBridges]);

  if (loading) {return null;}

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bento-item p-5"
    >
      <div className="flex items-start justify-between mb-0">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-900/20">
            <Languages className="size-5 text-blue-500" />
          </div>
          <div>
            <h3 className="font-semibold text-sm text-[var(--text-primary)] dark:text-white">
              {t("crossLang_title", "Cross-Language Bridges")}
            </h3>
            <p className="text-[10px] text-[var(--text-muted)]">
              {t("crossLang_subtitle", "Bookmarks linking different languages")}
            </p>
          </div>
        </div>
        <button
          onClick={scanBridges}
          disabled={scanning}
          className="p-1.5 rounded-lg hover:bg-[var(--state-hover-bg)] text-[var(--text-muted)] hover:text-blue-500 transition-all disabled:opacity-50"
          title={t("crossLang_rescan", "Rescan")}
        >
          <RefreshCw className={`size-4 ${scanning ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Keep this slot mounted at a fixed 2px height in every state. During a
          rescan with existing bridges, only the bar changes width/opacity;
          no spinner block is inserted, so the bridge list cannot jump. */}
      <div
        data-testid="cross-lang-progress-slot"
        className="h-0.5 mb-3.5 w-full overflow-hidden rounded-full ds-bg-secondary"
        aria-hidden={!scanning}
      >
        <div
          data-testid="cross-lang-progress-bar"
          role={scanning ? "progressbar" : undefined}
          aria-label={scanning ? t("app_scanning", "Scanning…") : undefined}
          aria-valuemin={scanning ? 0 : undefined}
          aria-valuemax={scanning ? 100 : undefined}
          aria-valuenow={scanning ? scanProgress ?? 0 : undefined}
          className={`h-full ds-bg-accent-primary transition-[width,opacity] duration-200 ${scanning ? "opacity-100" : "opacity-0"}`}
          style={{ width: `${scanning ? scanProgress ?? 0 : 0}%` }}
        />
      </div>

      {bridges.length === 0 && !scanning && (
        <div className="flex flex-col items-center justify-center text-center py-6">
          <Globe className="size-8 text-[var(--text-muted)] mb-2" />
          <p className="text-xs text-[var(--text-muted)]">
            {t(
              "crossLang_noBridges",
              "No cross-language bridges found. Bookmark pages in different languages with shared tags to create bridges.",
            )}
          </p>
        </div>
      )}

      {scanning && bridges.length === 0 && (
        <div
          data-testid="cross-lang-rescan-spinner"
          className="flex items-center justify-center gap-2 py-6"
        >
          <RefreshCw className="size-5 animate-spin text-[var(--text-muted)]" />
          {scanProgress !== null && (
            <span className="text-xs tabular-nums text-[var(--text-muted)]">
              {t("app_scanning", "Scanning…")} {scanProgress}%
            </span>
          )}
        </div>
      )}

      <AnimatePresence>
        <div className="space-y-3">
          {bridges.map((bridge, i) => (
            <motion.div
              key={bridge.topic ?? `bridge-${i}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="p-3 rounded-2xl ds-bg-card ds-border"
            >
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)]">
                  {bridge.topic ?? t("crossLang_unknownTopic", "Shared Topic")}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {bridge.pairs.map((pair) => (
                  <div
                    key={`${pair.lang}-${pair.title}`}
                    className="flex items-center gap-2 p-2 rounded-xl bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)]"
                  >
                    <span className="text-base leading-none">
                      {LANGUAGE_FLAGS[pair.lang] || "\uD83C\uDF10"}
                    </span>
                    <span className="text-xs font-medium text-[var(--text-secondary)] truncate">
                      {pair.title}
                    </span>
                  </div>
                ))}
              </div>
            </motion.div>
          ))}
        </div>
      </AnimatePresence>

      {bridges.length > 0 && (
        <div className="mt-3 flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
          <Globe className="size-3" />
          <span>
            {t("crossLang_count", "{{count}} bridge(s) found", {
              count: bridges.length,
            })}
          </span>
        </div>
      )}
    </motion.div>
  );
}
