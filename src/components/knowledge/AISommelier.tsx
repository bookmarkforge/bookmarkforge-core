import type { BookmarkForgeDB } from "../../db/types";
import type { BookmarkDocType } from "../../db/schema";
import type { RxDocument } from "rxdb";
import { useState, useRef } from "react";
import { BookmarkView, toBookmarkView } from "../../types/bookmark";
import { motion, AnimatePresence } from "motion/react";
import { Sparkles, Link, RefreshCw, ArrowRight } from "lucide-react";
import type { TFunction } from "i18next";
import { safeGet, safeSet, safeRemove } from "../../store/safeStorage";
import { parseFencedJson } from "../../utils/jsonFenceStripper";
import { CardProps } from "./shared-props";
import { StreamPreview } from "./StreamPreview";
import { useGuardedDataLoad } from "../../hooks/useGuardedDataLoad";
import { useGuardedAction } from "../../hooks/useGuardedAction";
import { logRateLimited } from "../../utils/boundedLog";
import {
  boundedBookmarkQuery,
  MAX_PROMPT_TITLES,
  MAX_SELECT_ITEMS,
} from "../../utils/knowledgeCardBounds";

interface Pairing {
  title: string;
  reason: string;
  tags: string[];
}

interface Props extends CardProps {
  t: TFunction;
}

export const AISommelier: React.FC<Props> = ({ cardVariants, t }) => {
  const [pairings, setPairings] = useState<Pairing[]>([]);
  const [bookmarks, setBookmarks] = useState<BookmarkView[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [streamText, setStreamText] = useState("");
  const {
    loading: _bookmarksLoading,
  } = useGuardedDataLoad<BookmarkView[]>(
    async (signal) => {
      const { initDB } = await import("../../container/database");
      const db = await initDB() as BookmarkForgeDB;
      // Bound the pick-list: the card only needs bookmarks to choose from,
      // not a census. The limit caps both the materialization (find().exec()
      // over 100k+ docs) and the rendered <option> count on large vaults.
      const docs = await boundedBookmarkQuery(
        db.bookmarks,
        MAX_SELECT_ITEMS,
        { isDeleted: false, isPrivate: false },
      ).exec();
      if (signal.aborted) {return [];}
      return docs.map((d: RxDocument<BookmarkDocType>) => toBookmarkView(d));
    },
    {
      onSuccess: (bookmarks) => setBookmarks(bookmarks),
      onError: () => setBookmarks([]),
    },
  );
  const {
    runWithSignal: runSelect,
    isRunning: isLoading,
  } = useGuardedAction<{ pairings: Pairing[]; fromCache: boolean }>({
    blockReentry: false,
    onStart: () => setStreamText(""),
    onSuccess: ({ pairings, fromCache }) => {
      setStreamText("");
      setPairings(pairings);
      if (!fromCache && selectedIdRef.current) {
        safeSet(
          `bookmarkforge_sommelier_${selectedIdRef.current}`,
          JSON.stringify(pairings),
        );
      }
    },
    onError: (error) => {
      setStreamText("");
      if (!(error instanceof Error && error.name === "AbortError")) {
        setPairings([]);
      }
    },
  });
  // Call-time selection id: onSuccess resolves asynchronously and would
  // otherwise read the LATEST selectedId (different bookmark).
  const selectedIdRef = useRef<string>("");

  const handleSelect = (id: string) => {
    setSelectedId(id);
    selectedIdRef.current = id;
    const bm = bookmarks.find((b: BookmarkView) => b.id === id);
    if (!bm) {
      setPairings([]);
      setStreamText("");
      return;
    }
    const cacheKey = `bookmarkforge_sommelier_${id}`;
    void runSelect(async (signal) => {
      try {
        const cached = safeGet(cacheKey);
        if (cached) {
          const parsed: Pairing[] = JSON.parse(cached);
          if (signal.aborted) {return { pairings: [], fromCache: false } as const;}
          return { pairings: parsed, fromCache: true } as const;
        }
      } catch {
        /* ignore corrupt cache */
        logRateLimited(
          "warn",
          "sommelier-cache-parse",
          "Cached AI pairings are corrupted; regenerating",
        );
      }

      const { agentService } = await import("../../services/ai/AgentService");
      if (signal.aborted) {return { pairings: [], fromCache: false } as const;}
      const bmTags = (bm.tags || []).join(", ");
      // Bound the prompt: titles are capped so a large vault cannot turn
      // into an unbounded token blast at the provider.
      const titles = bookmarks
        .filter((b: BookmarkView) => b.id !== id)
        .slice(0, MAX_PROMPT_TITLES)
        .map((b: BookmarkView) => b.title)
        .join(", ");
      const prompt = `Act as a knowledge sommelier. For the bookmark '${bm.title}' with tags [${bmTags}], find 2-3 other bookmarks from this list that would pair well with it — complementary topics, prerequisites, or interesting contrasts. Return JSON array of {title, reason, tags}. Bookmark list: ${titles}`;
      // Stream raw tokens live while the pairing JSON is generated.
      const res = await agentService.globalChat(
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
      if (signal.aborted) {return { pairings: [], fromCache: false } as const;}
      return {
        pairings: parseFencedJson<Pairing[]>(res.text),
        fromCache: false,
      } as const;
    });
  };

  const handleRefresh = async () => {
    if (!selectedId) {return;}
    const cacheKey = `bookmarkforge_sommelier_${selectedId}`;
    safeRemove(cacheKey);
    await handleSelect(selectedId);
  };

  return (
    <motion.div
      variants={cardVariants}
      className="bento-item p-5 ds-bg-card ds-radius-card"
    >
      <div className="flex items-start justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-rose-50 dark:bg-rose-900/20">
            <Sparkles className="size-5 text-rose-500" />
          </div>
          <div>
            <h3 className="font-semibold text-sm text-[var(--text-primary)] dark:text-white truncate">
              {t("sommelier_title", "AI Sommelier")}
            </h3>
            <p className="text-[10px] text-[var(--text-muted)]">
              {t("sommelier_subtitle", "Pair bookmarks contextually")}
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-5">
        <select
          value={selectedId}
          onChange={(e) => handleSelect(e.target.value)}
          aria-label={t("sommelier_select", "Select a bookmark")}
          className="flex-1 px-3 py-2 text-xs rounded-xl ds-bg-card ds-border ds-text-primary focus:outline-none focus:ring-2 focus:ring-rose-400/50 appearance-none cursor-pointer"
        >
          <option value="">
            {t("sommelier_select", "Select a bookmark...")}
          </option>
          {bookmarks.map((bm: BookmarkView) => (
            <option key={bm.id} value={bm.id}>
              {bm.title}
            </option>
          ))}
        </select>
        {selectedId && (
          <button
            onClick={handleRefresh}
            disabled={isLoading}
            className="p-2 rounded-xl ds-bg-card ds-border hover:ds-bg-accent-primary/10 transition-all disabled:opacity-50"
            title={t("sommelier_refresh", "Refresh pairings")}
          >
            <RefreshCw
              className={`size-4 ds-text-muted ${isLoading ? "animate-spin" : ""}`}
            />
          </button>
        )}
      </div>

      <AnimatePresence mode="popLayout">
        {isLoading && (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="py-8"
          >
            <div className="flex items-center justify-center">
              <Sparkles className="size-5 text-rose-400 animate-pulse" />
              <span className="ms-2 text-xs ds-text-muted">
                {t("sommelier_analyzing", "Pairing bookmarks...")}
              </span>
            </div>
            <StreamPreview text={streamText} />
          </motion.div>
        )}

        {!isLoading && pairings.length > 0 && (
          <motion.div
            key="pairings"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-3"
          >
            {pairings.map((p, idx) => (
              <motion.div
                key={`${p.title}-${idx}`}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.08 }}
                className="p-4 rounded-2xl mb-3 ds-bg-accent-soft"
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <Link className="size-3.5 ds-text-muted shrink-0" />
                  <span className="text-xs font-semibold ds-text-primary">
                    {p.title}
                  </span>
                </div>
                <p className="text-[10px] italic ds-text-muted mb-2 leading-relaxed">
                  {p.reason}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {p.tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-2 py-0.5 rounded-full text-[9px] font-semibold ds-bg-card ds-border ds-text-muted"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}

        {!isLoading && selectedId && pairings.length === 0 && (
          <motion.div
            key="empty"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center py-8 text-center"
          >
            <Sparkles className="size-8 ds-text-muted mb-2" />
            <p className="text-xs ds-text-muted">
              {t(
                "sommelier_noPairings",
                "No pairings found. Try another bookmark.",
              )}
            </p>
          </motion.div>
        )}

        {!isLoading && !selectedId && (
          <motion.div
            key="idle"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col items-center justify-center py-8 text-center"
          >
            <ArrowRight className="rtl-flip size-8 ds-text-muted mb-2" />
            <p className="text-xs ds-text-muted">
              {t(
                "sommelier_noSelection",
                "Select a bookmark from the dropdown to see contextual pairings.",
              )}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
