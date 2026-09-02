import type { BookmarkForgeDB } from "../../db/types";
import { useState, useEffect } from "react";
import { motion } from "motion/react";
import {
  Briefcase,
  Sparkles,
  Download,
  FileText,
  Clock,
  Target,
  MessageSquare,
} from "lucide-react";
import type { TFunction } from "i18next";
import { formatDate } from "../../utils/localization";
import i18n from "../../i18n";
import { safeGet, safeSet } from "../../store/safeStorage";
import { parseFencedJson } from "../../utils/jsonFenceStripper";
import { logger } from "../../utils/logger";
import { logRateLimited } from "../../utils/boundedLog";
import { downloadBlob } from "../../utils/download";
import { CardProps } from "./shared-props";
import { StreamPreview } from "./StreamPreview";
import {
  boundedBookmarkQuery,
  MAX_KNOWLEDGE_SCAN_ITEMS,
} from "../../utils/knowledgeCardBounds";

interface Props extends CardProps {
  t: TFunction;
}

interface BriefingData {
  topic: string;
  keyPoints: string[];
  relevantBookmarks: string[];
  talkingPoints: string[];
  questionsToAsk: string[];
  summary: string;
  generatedAt: string;
}

export const MeetingPrepMode: React.FC<Props> = ({ cardVariants, t }) => {
  const [topic, setTopic] = useState("");
  const [briefing, setBriefing] = useState<BriefingData | null>(null);
  const [generating, setGenerating] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [recentTopics, setRecentTopics] = useState<string[]>([]);

  useEffect(() => {
    try {
      const saved = safeGet("bookmarkforge_recent_topics");
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setRecentTopics(
            parsed.filter((topic): topic is string =>
              typeof topic === "string" && topic.trim().length > 0,
            ).slice(0, 5),
          );
        }
      }
    } catch {
      logRateLimited(
        "warn",
        "meeting-recent-topics-parse",
        "Stored recent topics are corrupted; starting empty",
      );
    }
  }, []);

  const handleGenerate = async () => {
    if (!topic.trim()) {return;}
    setGenerating(true);
    setStreamText("");
    try {
      const { initDB } = await import("../../container/database");
      const db = await initDB() as BookmarkForgeDB;
      // The briefing only uses the top 20 visited bookmarks. Materialize a
      // bounded recent sample instead of every bookmark in the vault; updatedAt
      // is indexed and keeps this query predictable on large databases.
      const bookmarks = await boundedBookmarkQuery(
        db.bookmarks,
        MAX_KNOWLEDGE_SCAN_ITEMS,
        { isDeleted: false, isPrivate: false },
      ).exec();
      const sorted = [...bookmarks]
        .sort((a, b) => (b.visitCount || 0) - (a.visitCount || 0))
        .slice(0, 20);
      const sourceMaterial = sorted
        .map((b) => `${b.title} [${(b.tags || []).join(", ")}]`)
        .join("\n");

      const { agentService } = await import("../../services/ai/AgentService");
      const prompt = `Generate a professional meeting briefing document. Meeting topic: '${topic}'. Use these bookmarks as source material: ${sourceMaterial}. Return JSON with: topic, keyPoints (3-5 bullet items), relevantBookmarks (3-5 titles), talkingPoints (3 points), questionsToAsk (2-3 questions), summary (2-3 sentences).`;
      // Stream raw tokens live while the briefing JSON is generated.
      const res = await agentService.globalChat(
        prompt,
        undefined,
        false,
        undefined,
        (chunk) => setStreamText((prev) => prev + chunk),
      );
      setStreamText("");
      const parsed = parseFencedJson<BriefingData>(res.text);
      const data: BriefingData = {
        ...parsed,
        generatedAt: new Date().toISOString(),
      };
      setBriefing(data);
      safeSet(`bookmarkforge_briefing_${topic}`, JSON.stringify(data));

      const updated = [
        topic,
        ...recentTopics.filter((rt) => rt !== topic),
      ].slice(0, 5);
      setRecentTopics(updated);
      safeSet("bookmarkforge_recent_topics", JSON.stringify(updated));
    } catch (err) {
      setStreamText("");
      logger.error("[MeetingPrepMode] generate failed", err);
    } finally {
      setStreamText("");
      setGenerating(false);
    }
  };

  const handleDownload = () => {
    if (!briefing) {return;}
    const lines = [
      `Meeting Briefing: ${briefing.topic}`,
      `Generated: ${formatDate(briefing.generatedAt, { year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }, i18n.language)}`,
      "",
      `Summary: ${briefing.summary}`,
      "",
      "Key Points:",
      ...briefing.keyPoints.map((kp, i) => `${i + 1}. ${kp}`),
      "",
      "Relevant Bookmarks:",
      ...briefing.relevantBookmarks.map((b) => `- ${b}`),
      "",
      "Talking Points:",
      ...briefing.talkingPoints.map((tp) => `- ${tp}`),
      "",
      "Questions to Ask:",
      ...briefing.questionsToAsk.map((q) => `- ${q}`),
    ].join("\n");
    const blob = new Blob([lines], { type: "text/plain" });
    downloadBlob(
      blob,
      `briefing-${briefing.topic.replace(/\s+/g, "-").toLowerCase()}.txt`,
    );
  };

  const handleSelectTopic = (selected: string) => {
    setTopic(selected);
  };

  return (
    <motion.div variants={cardVariants} className="bento-item p-5 ds-bg-card">
      <div className="flex items-center gap-3 mb-5">
        <div className="p-2.5 rounded-xl bg-blue-50 dark:bg-blue-900/20">
          <Briefcase className="size-5 text-blue-500" />
        </div>
        <div>
          <h3 className="font-semibold text-sm ds-text-primary truncate">
            {t("meetingPrep_title", "Meeting Prep Mode")}
          </h3>
          <p className="text-[10px] ds-text-muted">
            {t(
              "meetingPrep_subtitle",
              "AI-generated briefing documents from your bookmarks",
            )}
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            aria-label={t("meetingPrep_placeholder", "Meeting topic")}
            placeholder={t(
              "meetingPrep_placeholder",
              "e.g., 'Q3 Machine Learning Strategy'",
            )}
            className="flex-1 px-3 py-2.5 text-xs rounded-xl border ds-border bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)] ds-text-primary placeholder:text-[var(--text-muted)] outline-none focus:ring-2 focus:ring-blue-500/30"
            onKeyDown={(e) => {
              if (e.key === "Enter") {handleGenerate();}
            }}
          />
          <button
            onClick={handleGenerate}
            disabled={!topic.trim() || generating}
            className="truncate flex items-center gap-1.5 px-4 py-2.5 text-xs font-bold rounded-xl bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-all whitespace-nowrap"
          >
            {generating ? (
              <Sparkles className="size-4 animate-pulse" />
            ) : (
              <Briefcase className="size-4" />
            )}
            {generating
              ? t("meetingPrep_generating", "Generating...")
              : t("meetingPrep_generate", "Generate Briefing")}
          </button>
        </div>

        {recentTopics.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <Clock className="size-3 ds-text-muted shrink-0" />
            {recentTopics.map((rt) => (
              <button
                key={rt}
                onClick={() => handleSelectTopic(rt)}
                className="truncate px-2.5 py-1 text-[10px] font-medium rounded-lg ds-bg-card ds-border ds-text-secondary hover:ds-text-accent hover:border-blue-300 dark:hover:border-blue-700 transition-all"
              >
                {rt}
              </button>
            ))}
          </div>
        )}
      </div>

      {generating && <StreamPreview text={streamText} />}

      {briefing && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-5 space-y-4"
        >
          <div className="p-4 rounded-2xl ds-bg-card ds-border">
            <div className="flex items-start justify-between mb-3">
              <h4 className="font-bold text-sm ds-text-primary truncate">
                <FileText className="size-4 inline me-1.5 text-blue-500" />
                {briefing.topic}
              </h4>
              <button
                onClick={handleDownload}
                className="truncate flex items-center gap-1 px-3 py-1.5 text-[10px] font-bold rounded-xl bg-green-50 dark:bg-green-900/20 text-green-600 hover:bg-green-100 dark:hover:bg-green-900/30 transition-all"
              >
                <Download className="size-3" />
                {t("meetingPrep_download", "Download Briefing")}
              </button>
            </div>

            <p className="text-xs italic ds-text-secondary mb-4 leading-relaxed border-s-2 border-blue-300 dark:border-blue-700 ps-3">
              {briefing.summary}
            </p>

            <div className="space-y-3">
              <div>
                <h5 className="truncate text-[11px] font-bold ds-text-primary uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Target className="size-3.5 text-green-500" />
                  {t("meetingPrep_keyPoints", "Key Points")}
                </h5>
                <div className="space-y-1.5">
                  {briefing.keyPoints.map((kp, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-2 text-xs ds-text-secondary"
                    >
                      <span className="text-green-500 mt-0.5 shrink-0">
                        <svg
                          className="size-3.5"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      </span>
                      <span>
                        {i + 1}. {kp}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <hr className="ds-border" />

              <div>
                <h5 className="truncate text-[11px] font-bold ds-text-primary uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <FileText className="size-3.5 text-blue-500" />
                  {t("meetingPrep_relevantBookmarks", "Relevant Bookmarks")}
                </h5>
                <div className="space-y-1">
                  {briefing.relevantBookmarks.map((b, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 cursor-pointer"
                    >
                      <span className="w-1 h-1 rounded-full bg-blue-400 shrink-0" />
                      <span>{b}</span>
                    </div>
                  ))}
                </div>
              </div>

              <hr className="ds-border" />

              <div>
                <h5 className="truncate text-[11px] font-bold ds-text-primary uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <MessageSquare className="size-3.5 text-purple-500" />
                  {t("meetingPrep_talkingPoints", "Talking Points")}
                </h5>
                <ul className="space-y-1 list-disc list-inside text-xs ds-text-secondary">
                  {briefing.talkingPoints.map((tp, i) => (
                    <li key={i}>{tp}</li>
                  ))}
                </ul>
              </div>

              <hr className="ds-border" />

              <div>
                <h5 className="truncate text-[11px] font-bold ds-text-primary uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <MessageSquare className="size-3.5 text-orange-500" />
                  {t("meetingPrep_questions", "Questions to Ask")}
                </h5>
                <div className="space-y-1.5">
                  {briefing.questionsToAsk.map((q, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-2 p-2.5 rounded-xl bg-blue-50 dark:bg-blue-900/15 border border-blue-100 dark:border-blue-800/30 text-xs ds-text-primary"
                    >
                      <MessageSquare className="size-3.5 text-blue-400 mt-0.5 shrink-0" />
                      <span>{q}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t ds-border flex items-center gap-1.5 text-[10px] ds-text-muted">
              <Clock className="size-3" />
              {t("meetingPrep_generatedAt", "Generated {{time}}", {
                time: formatDate(briefing.generatedAt, { year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }, i18n.language),
              })}
            </div>
          </div>
        </motion.div>
      )}
    </motion.div>
  );
};
