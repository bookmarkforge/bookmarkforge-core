import { useState, useEffect } from "react";
import { useGuardedDataLoad } from "../../hooks/useGuardedDataLoad";
import { useGuardedAction } from "../../hooks/useGuardedAction";
import { motion, AnimatePresence } from "motion/react";
import { MessageSquare, Link, AlertTriangle, Lightbulb, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  boundedBookmarkQuery,
  MAX_KNOWLEDGE_SCAN_ITEMS,
} from "../../utils/knowledgeCardBounds";

interface Props {
  content: string;
  isPrivate?: boolean;
  currentBookmarkId: string;
}

interface Annotation {
  type: "connection" | "contradiction" | "insight";
  text: string;
  relatedTitle?: string;
}

function extractKeywords(text: string): string[] {
  return [
    ...new Set(
      text
        .slice(0, 1000)
        .split(/\s+/)
        .filter((w) => w.length > 4)
        .map((w) => w.replace(/[^a-zA-Z0-9À-ÿ]/g, "").toLowerCase())
        .filter(Boolean),
    ),
  ];
}

function hasContrastWords(text: string): boolean {
  return /however|but|contrary|although|yet|whereas|nevertheless|on the other hand/i.test(
    text,
  );
}

function tagOverlap(
  tagsA: string[],
  tagsB: string[],
  keywordsA: string[],
): number {
  const setB = new Set(tagsB.map((t) => t.toLowerCase()));
  const matched = tagsA.filter((t) => setB.has(t.toLowerCase()));
  const keywordMatch = keywordsA.filter((k) => setB.has(k)).length;
  return matched.length + keywordMatch;
}

export const AIReadingPartner: React.FC<Props> = ({
  content,
  // A caller that has content but omitted its persisted privacy decision
  // must take the local path rather than risk a cloud disclosure.
  isPrivate = true,
  currentBookmarkId,
}) => {
  useTranslation();
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  // Local analysis (mount/content change) is a data-load: autoLoad re-runs on
  // content/bookmark change, and a newer load supersedes the in-flight one.
  // The empty-content case returns [] so onSuccess clears annotations.
  const { loading: isAutoAnalyzing } = useGuardedDataLoad<Annotation[]>(
    async (signal) => {
      const keywords = extractKeywords(content);
      if (!content || keywords.length === 0) {
        return [];
      }
      const { initDB } = await import("../../container/database");
      const db = await initDB();
      const allBookmarks = await boundedBookmarkQuery(
        db.bookmarks,
        MAX_KNOWLEDGE_SCAN_ITEMS,
      ).exec();
      if (signal.aborted) {return [];}

      const result: Annotation[] = [];
      const otherBookmarks = allBookmarks.filter(
        (b: { id: string; title?: string; tags?: string[] }) =>
          b.id !== currentBookmarkId,
      );

      for (const bm of otherBookmarks) {
        if (result.length >= 5) {break;}

        const bmKeywords = extractKeywords(
          (bm.title ?? "") + " " + (bm.tags ?? []).join(" "),
        );
        const overlap = tagOverlap(bm.tags ?? [], bm.tags ?? [], keywords);
        const sharedKeywords = keywords.filter((k) => bmKeywords.includes(k));
        if (sharedKeywords.length === 0) {continue;}

        const title = bm.title ?? "Untitled";

        if (overlap >= 2) {
          result.push({
            type: "connection",
            text: `Related to ${title}`,
            relatedTitle: title,
          });
        } else if (hasContrastWords(content)) {
          result.push({
            type: "contradiction",
            text: `This may contradict ${title}`,
            relatedTitle: title,
          });
        } else {
          result.push({
            type: "insight",
            text: `This reminds me of ${title}`,
            relatedTitle: title,
          });
        }
      }

      return result;
    },
    {
      onSuccess: (result) => setAnnotations(result),
      onError: () => {
        // db not available — skip annotations
      },
    },
  );
  // Deep analysis owns its action; content/bookmark changes cancel it (the
  // original shared guard dropped it via the effect's begin()).
  const {
    runWithSignal,
    isRunning: isDeepAnalyzing,
    cancel: cancelDeep,
  } = useGuardedAction<{ text: string }>({
    onSuccess: ({ text }) => {
      setAnnotations((prev) => [
        ...prev,
        { type: "insight" as const, text } as Annotation,
      ]);
    },
    onError: () => {
      // silently fail
    },
  });
  const isAnalyzing = isAutoAnalyzing || isDeepAnalyzing;

  useEffect(() => {
    cancelDeep();
  }, [content, currentBookmarkId, cancelDeep]);

  const handleDeepAnalysis = () => {
    void runWithSignal(async (signal) => {
      const { agentService } = await import("../../services/ai/AgentService");
      const result = await agentService.globalChat(
        `Analyze this content and find deeper connections, contradictions, and insights:\n\n${content.slice(
          0,
          3000,
        )}`,
        undefined,
        isPrivate,
        undefined,
        undefined,
        undefined,
        undefined,
        signal,
      );
      const text =
        (result as { text?: string } | undefined)?.text ||
        "Deep analysis complete.";
      return { text };
    });
  };

  const annotationIcon = (type: Annotation["type"]) => {
    switch (type) {
      case "connection":
        return <Link size={14} />;
      case "contradiction":
        return <AlertTriangle size={14} />;
      case "insight":
        return <Lightbulb size={14} />;
    }
  };

  const annotationColor = (type: Annotation["type"]) => {
    switch (type) {
      case "connection":
        return {
          bg: "rgba(59,130,246,0.12)",
          border: "#3b82f6",
          text: "#60a5fa",
        };
      case "contradiction":
        return {
          bg: "rgba(245,158,11,0.12)",
          border: "#f59e0b",
          text: "#fbbf24",
        };
      case "insight":
        return {
          bg: "rgba(139,92,246,0.12)",
          border: "#8b5cf6",
          text: "#a78bfa",
        };
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        right: 0,
        top: "50%",
        transform: "translateY(-50%)",
        zIndex: 40,
        display: "flex",
        alignItems: "center",
      }}
    >
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          background: "var(--ds-bg-accent-primary, #3b82f6)",
          color: "#fff",
          padding: 8,
          borderRadius: "12px 0 0 12px",
          border: "none",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 4,
          writingMode: "vertical-lr",
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: 1,
        }}
      >
        <MessageSquare size={14} style={{ transform: "rotate(90deg)" }} />
        AI
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 280, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: "easeInOut" }}
            style={{
              overflow: "hidden",
              background: "var(--ds-bg-card, #1e293b)",
              borderRadius: "16px 0 0 16px",
              boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
              border: "1px solid var(--ds-border, #334155)",
              borderRight: "none",
              maxHeight: "70vh",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "12px 16px",
                borderBottom: "1px solid var(--ds-border, #334155)",
              }}
            >
              <span style={{ fontWeight: 600, fontSize: 14, color: "#e2e8f0" }}>
                AI Reading Partner
              </span>
              <button
                onClick={() => setIsOpen(false)}
                style={{
                  background: "none",
                  border: "none",
                  color: "#94a3b8",
                  cursor: "pointer",
                  padding: 4,
                }}
              >
                <X size={16} />
              </button>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
              {isAnalyzing && annotations.length === 0 && (
                <div
                  style={{
                    color: "#94a3b8",
                    fontSize: 13,
                    textAlign: "center",
                    padding: 24,
                  }}
                >
                  Analyzing…
                </div>
              )}

              {!isAnalyzing && annotations.length === 0 && (
                <div
                  style={{
                    color: "#94a3b8",
                    fontSize: 13,
                    textAlign: "center",
                    padding: 24,
                  }}
                >
                  No annotations yet.
                </div>
              )}

              {annotations.map((ann, i) => {
                const colors = annotationColor(ann.type);
                return (
                  <div
                    key={i}
                    style={{
                      padding: 12,
                      borderRadius: 12,
                      marginBottom: 8,
                      background: colors.bg,
                      borderInlineStart: `3px solid ${colors.border}`,
                      fontSize: 13,
                      color: "#e2e8f0",
                      cursor: ann.relatedTitle ? "pointer" : "default",
                    }}
                    title={ann.relatedTitle ?? undefined}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        marginBottom: 4,
                        color: colors.text,
                        fontWeight: 500,
                        fontSize: 12,
                      }}
                    >
                      {annotationIcon(ann.type)}
                      <span style={{ textTransform: "capitalize" }}>
                        {ann.type}
                      </span>
                    </div>
                    <div style={{ lineHeight: 1.5 }}>{ann.text}</div>
                  </div>
                );
              })}
            </div>

            <div
              style={{
                padding: "8px 12px",
                borderTop: "1px solid var(--ds-border, #334155)",
              }}
            >
              <button
                onClick={handleDeepAnalysis}
                disabled={isAnalyzing}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "1px solid var(--ds-border, #334155)",
                  background: "transparent",
                  color: "#e2e8f0",
                  fontSize: 13,
                  cursor: isAnalyzing ? "default" : "pointer",
                  opacity: isAnalyzing ? 0.6 : 1,
                }}
 className="truncate">
                {isAnalyzing ? "Analyzing…" : "Analyze Full Page"}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

