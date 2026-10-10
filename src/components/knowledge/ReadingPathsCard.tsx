import type { BookmarkDocType } from "../../db/schema";
import type { BookmarkForgeDB } from "../../db/types";
import { useState, useEffect } from "react";
import { useGuardedAction } from "../../hooks/useGuardedAction";
import { motion, AnimatePresence } from "motion/react";
import { Sparkles, Bookmark, ArrowRight } from "lucide-react";
import type { TFunction } from "i18next";
import { logger } from "../../utils/logger";
import { logRateLimited } from "../../utils/boundedLog";
import { safeGet, safeSet } from "../../store/safeStorage";
import { parseFencedJson } from "../../utils/jsonFenceStripper";
import { CardProps } from "./shared-props";
import { StreamPreview } from "./StreamPreview";
import {
  boundedBookmarkQuery,
  MAX_KNOWLEDGE_SCAN_ITEMS,
  MAX_PROMPT_TITLES,
} from "../../utils/knowledgeCardBounds";

interface ReadingPathStep {
  title: string;
  description: string;
}

interface ReadingPath {
  id: string;
  title: string;
  steps: ReadingPathStep[];
}

interface Props extends CardProps {
  t: TFunction;
}

const LS_KEY = "bookmarkforge_reading_paths";

export const ReadingPathsCard: React.FC<Props> = ({ cardVariants, t }) => {
  const [paths, setPaths] = useState<ReadingPath[]>([]);
  const [loading, setLoading] = useState(true);
  const [streamText, setStreamText] = useState("");

  // Streaming generation — useGuardedAction + runWithSignal: chunks gate on
  // !signal.aborted (the original had no stale protection at all), and the
  // parsed paths are returned for onSuccess to render + persist.
  const generate = useGuardedAction<ReadingPath[]>({
    onStart: () => setStreamText(""),
    onSuccess: (parsed) => {
      setStreamText("");
      if (parsed.length > 0) {
        setPaths(parsed);
        try {
          safeSet(LS_KEY, JSON.stringify(parsed));
        } catch (e) {
          logger.warn("[ReadingPathsCard] Failed to persist paths", e);
        }
      }
    },
    onError: (err) => {
      setStreamText("");
      logger.error("[ReadingPathsCard] Failed to generate paths", err);
    },
  });
  const generating = generate.isRunning;

  useEffect(() => {
    try {
      const stored = safeGet(LS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setPaths(parsed);
        }
      }
    } catch (err) {
      logger.warn("[ReadingPathsCard] Failed to load cached paths", err);
    }
    setLoading(false);
  }, []);

  const handleGenerate = () => {
    void generate.runWithSignal(async (signal) => {
      const { initDB } = await import("../../container/database");
      const db = await initDB() as BookmarkForgeDB;
      // Reading paths need titles only; cap both the RxDB materialization and
      // the prompt. The recent sample keeps the result useful without making
      // generation proportional to the entire vault.
      const bookmarks = await boundedBookmarkQuery(
        db.bookmarks,
        MAX_KNOWLEDGE_SCAN_ITEMS,
        { isDeleted: false, isPrivate: false },
      ).exec();
      const titles = bookmarks
        .map((b: BookmarkDocType) => b.title)
        .filter(Boolean)
        .slice(0, MAX_PROMPT_TITLES) as string[];

      const { agentService } = await import("../../services/ai/AgentService");

      const prompt = `Create 3 personalized learning paths based on these bookmark titles: ${titles.join(", ")}. For each path, provide a title and 3-5 steps (each step has a title and a short description). Return ONLY a valid JSON array in this exact format with no markdown or extra text: [{"id":"1","title":"Path Title","steps":[{"title":"Step 1","description":"Description 1"}]}]`;

      // Stream raw tokens live while the paths JSON is generated.
      const result = await agentService.globalChat(
        prompt,
        undefined,
        false,
        undefined,
        (chunk) => {
          if (!signal.aborted) {
            setStreamText((prev) => prev + chunk);
          }
        },
      );

      let parsed: ReadingPath[];
      try {
        parsed = parseFencedJson<ReadingPath[]>(result.text);
      } catch {
        parsed = [];
        const jsonMatch = result.text.match(/\[[\s\S]*?\]/);
        if (jsonMatch) {
          try {
            parsed = parseFencedJson<ReadingPath[]>(jsonMatch[0]);
          } catch {
            // Fall through to the empty result below.
          }
        }
        if (parsed.length === 0) {
          // No usable JSON array in the response: surface the failure bounded
          // so providers returning unusable output are diagnosable instead of
          // silently showing "no reading paths yet".
          logRateLimited(
            "warn",
            "reading-paths-ai-parse",
            "AI response contained no parseable JSON array; no reading paths generated",
            { snippet: result.text.slice(0, 200) },
          );
        }
      }
      return parsed;
    });
  };

  if (loading) {return null;}

  return (
    <motion.div
      variants={cardVariants}
      className="lg:col-span-2 p-2 md:p-3 rounded-[3rem] shadow-sm relative overflow-hidden ds-bg-accent-soft ds-border-accent"
    >
      <div className="flex items-center gap-5 mb-10">
        <div className="p-4 text-white rounded-[1.5rem] shadow-2xl ds-bg-accent-primary ds-shadow-accent-hero">
          <Bookmark className="size-7" />
        </div>
        <div>
          <h2 className="ds-h2">{t("app_readingPaths", "Reading Paths")}</h2>
          <p className="ds-label-section mt-1 ds-text-muted">
            {t(
              "app_readingPathsDesc",
              "AI-powered learning paths from your bookmarks",
            )}
          </p>
        </div>
      </div>

      {generating && <StreamPreview text={streamText} />}

      <AnimatePresence mode="wait">
        {paths.length > 0 ? (
          <motion.div
            key="paths"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="grid grid-cols-1 md:grid-cols-3 gap-4"
          >
            {paths.map((path) => (
              <div key={path.id} className="bento-item p-4 flex flex-col">
                <h3 className="font-semibold text-sm text-[var(--text-primary)] dark:text-white mb-2">
                  {path.title}
                </h3>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider mb-4 ds-bg-accent-primary ds-text-on-accent self-start">
                  {t("app_stepsCount", "{{count}} steps", {
                    count: path.steps.length,
                  })}
                </span>
                <div className="space-y-3 flex-1">
                  {path.steps.map((step, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <ArrowRight className="rtl-flip size-3.5 mt-0.5 shrink-0 ds-text-accent-primary" />
                      <div>
                        <p className="text-xs font-semibold text-[var(--text-primary)] dark:text-white">
                          {step.title}
                        </p>
                        <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
                          {step.description}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </motion.div>
        ) : (
          <motion.div
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center justify-center text-center py-8"
          >
            <div className="p-3 rounded-full ds-bg-card mb-4">
              <Sparkles className="size-6 ds-text-muted" />
            </div>
            <h3 className="font-semibold text-sm mb-1 text-[var(--text-primary)] dark:text-white">
              {t("app_noPathsYet", "No reading paths yet")}
            </h3>
            <p className="text-xs text-[var(--text-muted)] mb-4 max-w-[200px]">
              {t(
                "app_pathsDescription",
                "Generate personalized learning paths from your bookmark collection",
              )}
            </p>
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="truncate flex items-center gap-2 px-4 py-2 ds-bg-accent-primary ds-text-on-accent text-xs font-bold rounded-xl hover:scale-105 active:scale-95 transition-all disabled:opacity-50"
            >
              <Sparkles
                className={`size-3.5 ${generating ? "animate-pulse" : ""}`}
              />
              {generating
                ? t("app_generating", "Generating...")
                : t("app_generatePaths", "Generate Reading Paths")}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
