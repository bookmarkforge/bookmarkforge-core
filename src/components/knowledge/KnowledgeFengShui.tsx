import type { BookmarkForgeDB } from "../../db/types";
import { useState, useTransition } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Shuffle,
  Sparkles,
  Check,
  RefreshCw,
  Tags,
  Folder,
  Lightbulb,
} from "lucide-react";
import type { TFunction } from "i18next";
import { safeGet, safeSet } from "../../store/safeStorage";
import { parseFencedJson } from "../../utils/jsonFenceStripper";
import { CardProps } from "./shared-props";
import { StreamPreview } from "./StreamPreview";
import { useGuardedDataLoad } from "../../hooks/useGuardedDataLoad";
import { useGuardedAction } from "../../hooks/useGuardedAction";
import { logRateLimited } from "../../utils/boundedLog";

interface Suggestion {
  type: "merge" | "rename" | "restructure" | "split";
  description: string;
  from: string;
  to: string;
  severity: "low" | "medium" | "high";
}

interface Props extends CardProps {
  t: TFunction;
}

const severityConfig: Record<string, { border: string; bg: string }> = {
  high: { border: "border-l-red-500", bg: "bg-red-50 dark:bg-red-900/10" },
  medium: {
    border: "border-l-amber-500",
    bg: "bg-amber-50 dark:bg-amber-900/10",
  },
  low: { border: "border-l-blue-500", bg: "bg-blue-50 dark:bg-blue-900/10" },
};

const typeIcons: Record<
  Suggestion["type"],
  React.FC<{ className?: string }>
> = {
  merge: Shuffle,
  rename: Tags,
  restructure: Folder,
  split: Shuffle,
};

export const KnowledgeFengShui: React.FC<Props> = ({ cardVariants, t }) => {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [tagCounts, setTagCounts] = useState<Record<string, number>>({});
  const [, startTransition] = useTransition();
  const [appliedSuggestions, setAppliedSuggestions] = useState<string[]>(() => {
    try {
      const saved = safeGet("bookmarkforge_fengshui_applied");
      return saved ? JSON.parse(saved) : [];
    } catch {
      logRateLimited(
        "warn",
        "fengshui-applied-cache-parse",
        "Stored applied feng shui suggestions are corrupted; starting empty",
      );
      return [];
    }
  });
  const [streamText, setStreamText] = useState("");
  const {
    loading,
  } = useGuardedDataLoad<Record<string, number>>(
    async (signal) => {
      const { initDB } = await import("../../container/database");
      const db = await initDB() as BookmarkForgeDB;
      const all = await db.bookmarks
        .find({ selector: { isDeleted: false, isPrivate: false } })
        .exec();
      if (signal.aborted) {return {};}
      const counts: Record<string, number> = {};
      let orphaned = 0;
      for (const bm of all) {
        const tags = bm.tags || [];
        if (tags.length === 0) {
          orphaned++;
        } else {
          for (const tag of tags) {
            counts[tag] = (counts[tag] || 0) + 1;
          }
        }
      }
      counts["__orphaned__"] = orphaned;
      return counts;
    },
    {
      onSuccess: (counts) => setTagCounts(counts),
      onError: () => setTagCounts({}),
    },
  );
  const {
    runWithSignal: runAnalyze,
    isRunning: analyzing,
  } = useGuardedAction<Suggestion[]>({
    blockReentry: false,
    onSuccess: (suggestions) => {
      startTransition(() => setSuggestions(suggestions));
      safeSet("bookmarkforge_fengshui", JSON.stringify(suggestions));
    },
  });

  const orphanedCount = tagCounts["__orphaned__"] || 0;
  const tagEntries = Object.entries(tagCounts).filter(
    ([k]) => k !== "__orphaned__",
  );
  const totalBookmarks = tagEntries.reduce((sum, [, v]) => sum + v, 0);
  const totalTags = tagEntries.length;
  const maxCount = Math.max(...tagEntries.map(([, v]) => v), 1);

  const analyzeStructure = () => {
    setStreamText("");
    void runAnalyze(async (signal) => {
      const algoSuggestions: Suggestion[] = [];
    const tags = tagEntries.map(([k]) => k);

    for (const tag of tags) {
      if (tagCounts[tag] === 1) {
        algoSuggestions.push({
          type: "merge",
          description: t(
            "fengshui_singleTag",
            "Tag '{{tag}}' has only 1 bookmark. Consider merging into a parent tag or removing it.",
            { tag },
          ),
          from: tag,
          to: "",
          severity: "low",
        });
      }
    }

    const normalized = tags.map((t) => ({
      original: t,
      noSep: t.toLowerCase().replace(/[-_\s]/g, ""),
      words: t
        .toLowerCase()
        .split(/[-_\s]+/)
        .filter(Boolean),
    }));
    const seen = new Set<string>();
    for (let i = 0; i < normalized.length; i++) {
      for (let j = i + 1; j < normalized.length; j++) {
        const a = normalized[i]!;
        const b = normalized[j]!;
        const key = [a.original, b.original].sort().join("::");
        if (seen.has(key)) {continue;}

        let similar = false;
        if (
          a.noSep === b.noSep ||
          a.original.toLowerCase() === b.original.toLowerCase()
        ) {
          similar = true;
        } else {
          const acronymA = a.words.map((w) => w[0] || "").join("");
          const acronymB = b.words.map((w) => w[0] || "").join("");
          if (
            acronymA === b.noSep ||
            acronymB === a.noSep ||
            acronymA === acronymB
          ) {
            similar = true;
          }
        }

        if (similar) {
          seen.add(key);
          algoSuggestions.push({
            type: "merge",
            description: t(
              "fengshui_similarTags",
              "Tags '{{from}}' and '{{to}}' appear similar. Consider merging them.",
              { from: a.original, to: b.original },
            ),
            from: a.original,
            to: b.original,
            severity: "high",
          });
        }
      }
    }

    for (const tag of tags) {
      if ((tagCounts[tag] || 0) >= 10) {
        algoSuggestions.push({
          type: "split",
          description: t(
            "fengshui_largeTag",
            "Tag '{{tag}}' has {{count}} bookmarks. Consider splitting into subtags.",
            { tag, count: tagCounts[tag] },
          ),
          from: tag,
          to: "",
          severity: "medium",
        });
      }
    }

    if (orphanedCount > 0) {
      algoSuggestions.push({
        type: "restructure",
        description: t(
          "fengshui_orphaned",
          "{{count}} bookmarks have no tags. Consider adding tags to improve discoverability.",
          { count: orphanedCount },
        ),
        from: "__orphaned__",
        to: "",
        severity: "medium",
      });
    }

      try {
        const { agentService } = await import("../../services/ai/AgentService");
        const aiPrompt = `Analyze these bookmark tags and their counts: ${JSON.stringify(tagCounts)}. Suggest 3 improvements to the tag structure for better organization. Return JSON array of {type, description, from, to, severity}. Types: merge, rename, restructure, split.`;
        // Stream raw tokens live while the suggestions JSON is generated.
        const res = await agentService.globalChat(
          aiPrompt,
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
        if (signal.aborted) {return algoSuggestions;}
        setStreamText("");
        const aiSuggestions = parseFencedJson<Suggestion[]>(res.text);
        algoSuggestions.push(...aiSuggestions);
      } catch (error) {
        setStreamText("");
        // AI analysis is optional: a plain failure keeps the algorithmic
        // suggestions. An abort must propagate so the guard discards the
        // whole result — matching the original early return.
        if (error instanceof Error && error.name === "AbortError") {
          throw error;
        }
        // Non-abort AI failure: keep the algorithmic suggestions, but leave
        // a bounded trace so providers returning unusable output are visible.
        logRateLimited(
          "warn",
          "fengshui-ai-parse",
          "AI tag suggestions unavailable; kept algorithmic suggestions only",
          { error: error instanceof Error ? error.message : String(error) },
        );
      }

      return algoSuggestions;
    });
  };

  const toggleApplied = (index: number) => {
    const id = String(index);
    setAppliedSuggestions((prev) => {
      const next = prev.includes(id)
        ? prev.filter((x) => x !== id)
        : [...prev, id];
      safeSet("bookmarkforge_fengshui_applied", JSON.stringify(next));
      return next;
    });
  };

  if (loading) {return null;}

  return (
    <motion.div
      variants={cardVariants}
      className="bento-item p-5 ds-bg-card ds-radius-card"
    >
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-purple-50 dark:bg-purple-900/20">
            <Lightbulb className="size-5 text-purple-500" />
          </div>
          <div>
            <h3 className="font-semibold text-sm text-[var(--text-primary)] dark:text-white truncate">
              {t("fengshui_title", "Knowledge Feng Shui")}
            </h3>
            <p className="text-[10px] text-[var(--text-muted)]">
              {t(
                "fengshui_subtitle",
                "Reorganize your tag structure for better flow",
              )}
            </p>
          </div>
        </div>
        <button
          onClick={analyzeStructure}
          disabled={analyzing}
          className="truncate flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold rounded-xl transition-all bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 hover:bg-purple-200 dark:hover:bg-purple-900/50 disabled:opacity-50"
        >
          {analyzing ? (
            <RefreshCw className="size-3 animate-spin" />
          ) : (
            <Sparkles className="size-3" />
          )}
          {analyzing
            ? t("fengshui_analyzing", "Analyzing...")
            : t("fengshui_analyze", "Analyze Structure")}
        </button>
      </div>

      <div className="flex gap-4 mb-6 text-[11px] font-semibold">
        <span className="px-3 py-1.5 rounded-lg ds-bg-card ds-border">
          {t("fengshui_tagCount", "{{count}} tags", { count: totalTags })}
        </span>
        <span className="px-3 py-1.5 rounded-lg ds-bg-card ds-border">
          {t("fengshui_bookmarkCount", "{{count}} bookmarks", {
            count: totalBookmarks,
          })}
        </span>
        <span
          className={`px-3 py-1.5 rounded-lg ds-bg-card ds-border ${orphanedCount > 0 ? "text-red-500" : ""}`}
        >
          {t("fengshui_orphanedCount", "{{count}} orphaned", {
            count: orphanedCount,
          })}
        </span>
      </div>

      {tagEntries.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6 p-3 rounded-xl ds-bg-card ds-border">
          {tagEntries.map(([tag, count]) => (
            <span
              key={tag}
              className="px-2.5 py-1 rounded-full text-[10px] font-semibold transition-all ds-bg-accent-primary/10 ds-text-accent-primary"
              style={{
                fontSize: `${Math.max(9, Math.min(14, 9 + (count / maxCount) * 5))}px`,
                opacity: 0.5 + (count / maxCount) * 0.5,
              }}
            >
              {tag} ({count})
            </span>
          ))}
        </div>
      )}

      {analyzing && <StreamPreview text={streamText} />}

      <AnimatePresence>
        {suggestions.length > 0 && (
          <div className="space-y-3">
            <h4 className="text-xs font-bold ds-text-secondary uppercase tracking-wider truncate">
              {t("fengshui_suggestions", "Suggestions ({{count}})", {
                count: suggestions.length,
              })}
            </h4>
            {suggestions.map((s, idx) => {
              const isApplied = appliedSuggestions.includes(String(idx));
              const sev = severityConfig[s.severity] || {
                border: "border-l-amber-500",
                bg: "bg-amber-50 dark:bg-amber-900/10",
              };
              const Icon = typeIcons[s.type] || Shuffle;
              return (
                <motion.div
                  key={`${s.type}-${s.from}-${s.to}-${idx}`}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  className={`p-4 rounded-xl border-s-4 ${sev.border} ${sev.bg} ${isApplied ? "opacity-50" : ""}`}
                >
                  <div className="flex items-start gap-3">
                    <div className="p-1.5 rounded-lg ds-bg-card">
                      <Icon className="size-4 ds-text-secondary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p
                        className={`text-xs leading-relaxed ${isApplied ? "line-through ds-text-muted" : "ds-text-secondary"}`}
                      >
                        {s.description}
                      </p>
                      {s.from && s.to && (
                        <div className="flex items-center gap-1 mt-1 text-[10px] font-mono ds-text-muted">
                          <span className="truncate max-w-[100px]">
                            {s.from}
                          </span>
                          <span>→</span>
                          <span className="truncate max-w-[100px]">{s.to}</span>
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => toggleApplied(idx)}
                      className={`truncate p-1.5 rounded-lg shrink-0 transition-all ${
                        isApplied
                          ? "bg-green-100 dark:bg-green-900/20 text-green-600"
                          : "ds-bg-card ds-border hover:ds-bg-accent-primary/10"
                      }`}
                    >
                      {isApplied ? (
                        <Check className="size-3.5" />
                      ) : (
                        <Check className="size-3.5 ds-text-muted" />
                      )}
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </AnimatePresence>

      {!analyzing && suggestions.length === 0 && (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <Lightbulb className="size-8 ds-text-muted mb-2" />
          <p className="text-xs ds-text-muted">
            {t(
              "fengshui_noSuggestions",
              "Press 'Analyze Structure' to get suggestions for improving your tag organization.",
            )}
          </p>
        </div>
      )}
    </motion.div>
  );
};
