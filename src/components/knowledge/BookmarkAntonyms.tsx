import type { BookmarkDocType } from "../../db/schema";
import type { RxDocument } from "rxdb";
import { useState, useRef } from "react";
import { motion } from "motion/react";
import { Shuffle, Sparkles, ExternalLink } from "lucide-react";
import type { TFunction } from "i18next";
import { safeGet, safeSet, safeRemove } from "../../store/safeStorage";
import { logRateLimited } from "../../utils/boundedLog";
import { parseFencedJson } from "../../utils/jsonFenceStripper";
import { safeParseJsonArray } from "../../utils/safeJsonArray";
import { CardProps } from "./shared-props";
import { StreamPreview } from "./StreamPreview";
import { useGuardedDataLoad } from "../../hooks/useGuardedDataLoad";
import { useGuardedAction } from "../../hooks/useGuardedAction";

interface Props extends CardProps {
  t: TFunction;
}

export const BookmarkAntonyms: React.FC<Props> = ({ cardVariants, t }) => {
  const [bookmarks, setBookmarks] = useState<BookmarkDocType[]>([]);
  const [antonyms, setAntonyms] = useState<
    Record<string, { title: string; perspective: string }[]>
  >({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [streamText, setStreamText] = useState("");
  // findAntonym runs on its own guard (blockReentry: false — a new request
  // supersedes the previous one, like the old begin()). The per-id spinner
  // needs no Record: at most one request is in flight, so
  // `findingAntonym && selectedId === id` reproduces the old loading[id]
  // exactly (supersede keeps it lit until the newer request settles).
  // pendingAntonymIdRef feeds onError the failing bookmark id.
  const pendingAntonymIdRef = useRef<string | null>(null);
  const {
    loading: _bookmarksLoading,
  } = useGuardedDataLoad<BookmarkDocType[]>(
    async (signal) => {
      const { initDB } = await import("../../container/database");
      const db = await initDB();
      const docs = await db.bookmarks
        .find({ selector: { isDeleted: false, isPrivate: false } })
        .exec();
      if (signal.aborted) {return [];}
      return docs.map(
        (d: RxDocument<BookmarkDocType>) =>
          d.toJSON() as unknown as BookmarkDocType,
      );
    },
    {
      onSuccess: (bookmarks) => setBookmarks(bookmarks),
      onError: () => setBookmarks([]),
    },
  );

  const {
    runWithSignal: runFindAntonym,
    isRunning: findingAntonym,
  } = useGuardedAction<{
    id: string;
    result: { title: string; perspective: string }[];
  }>({
    blockReentry: false,
    onSuccess: ({ id, result }) => {
      setStreamText("");
      setAntonyms((prev) => ({ ...prev, [id]: result }));
      safeSet(`bookmarkforge_antonyms_${id}`, JSON.stringify(result));
    },
    onError: (error) => {
      setStreamText("");
      // AbortErrors (supersede/unmount) are silent; other failures clear the
      // bookmark's antonyms so the card shows the empty state.
      if (!(error instanceof Error && error.name === "AbortError")) {
        const id = pendingAntonymIdRef.current;
        if (id) {
          setAntonyms((prev) => ({ ...prev, [id]: [] }));
        }
      }
    },
  });

  const findAntonym = (bookmark: BookmarkDocType) => {
    const { id, title, tags, content } = bookmark;
    pendingAntonymIdRef.current = id;
    setSelectedId(id);
    setStreamText("");
    void runFindAntonym(async (signal) => {
      const cacheKey = `bookmarkforge_antonyms_${id}`;
      {
        const { entries, parseFailed } = safeParseJsonArray<
          { title: string; perspective: string }
        >(safeGet(cacheKey));
        if (parseFailed) {
          // Corrupt cache: drop it and regenerate below instead of silently
          // clearing the bookmark's antonym via the guard's error path.
          safeRemove(cacheKey);
          logRateLimited(
            "warn",
            "antonyms-cache-parse",
            "Cached antonyms are corrupted; regenerating",
          );
        } else if (entries.length > 0) {
          return { id, result: entries };
        }
      }
      const { agentService } = await import("../../services/ai/AgentService");
      const prompt = `Find an opposing or contrasting perspective to this bookmark's content. Return a JSON object with 'title' (a creative name for the opposing view) and 'perspective' (2-3 sentence explanation of the counter-argument). Bookmark: title=${title}, tags=${tags}, content=${content}. Focus on intellectual diversity, not personal attacks.`;
      // Stream raw tokens live while the structured JSON is being generated.
      const res = await agentService.globalChat(
        prompt,
        undefined,
        bookmark.isPrivate,
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
      const parsed = parseFencedJson<{ title: string; perspective: string }>(res.text);
      return {
        id,
        result: [{ title: parsed.title, perspective: parsed.perspective }],
      };
    });
  };

  return (
    <motion.div variants={cardVariants} className="bento-item p-5">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 rounded-lg bg-purple-50 dark:bg-purple-900/20">
          <Shuffle className="size-5 text-purple-500" />
        </div>
        <div>
          <h3 className="font-semibold text-sm text-[var(--text-primary)] dark:text-white">
            {t("bookmarkAntonyms_title", "Bookmark Antonyms")}
          </h3>
          <p className="text-[10px] text-[var(--text-muted)]">
            {t(
              "bookmarkAntonyms_subtitle",
              "Discover opposing viewpoints to fight echo chambers",
            )}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        {bookmarks.map((bm) => {
          const topTags = (bm.tags || []).slice(0, 3);
          const bmAntonyms = antonyms[bm.id];
          return (
            <div key={bm.id}>
              <div className="p-4 rounded-xl ds-bg-card ds-border flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium ds-text-primary truncate">
                    {bm.title}
                  </p>
                  {topTags.length > 0 && (
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {topTags.map((tag: string, i: number) => (
                        <span
                          key={i}
                          className="text-[10px] px-1.5 py-0.5 rounded-full ds-bg-muted ds-text-muted"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => findAntonym(bm)}
                  disabled={findingAntonym && selectedId === bm.id}
                  className="truncate p-2 rounded-lg hover:bg-[var(--state-hover-bg)] text-[var(--text-muted)] hover:text-purple-500 transition-all disabled:opacity-50 shrink-0"
                  title={t("bookmarkAntonyms_find", "Find Antonym")}
                >
                  {findingAntonym && selectedId === bm.id ? (
                    <Sparkles className="size-4 animate-pulse" />
                  ) : (
                    <Shuffle className="size-4" />
                  )}
                </button>
              </div>

              {findingAntonym && selectedId === bm.id && (
                <StreamPreview text={streamText} />
              )}

              {bmAntonyms && bmAntonyms.length > 0 && selectedId === bm.id && (
                <div className="mt-3">
                  {bmAntonyms.map((antonym, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="p-4 rounded-xl"
                      style={{
                        border: "2px solid",
                        borderImage:
                          "linear-gradient(135deg, #ef4444, #3b82f6) 1",
                        background:
                          "linear-gradient(135deg, var(--accent-faint), var(--bg-secondary))",
                      }}
                    >
                      <div className="flex items-center gap-1 mb-2">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-red-500">
                          {t(
                            "bookmarkAntonyms_challengeLabel",
                            "Challenge your view",
                          )}
                        </span>
                        <ExternalLink className="size-3 text-blue-400" />
                      </div>
                      <h4 className="font-bold text-sm ds-text-primary mb-1">
                        {antonym.title}
                      </h4>
                      <p className="text-xs ds-text-secondary leading-relaxed">
                        {antonym.perspective}
                      </p>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {bookmarks.length === 0 && (
          <p className="text-xs ds-text-muted text-center py-6">
            {t("bookmarkAntonyms_noBookmarks", "No bookmarks found")}
          </p>
        )}
      </div>
    </motion.div>
  );
};
