import type { BookmarkForgeDB } from "../../db/types";
import type { BookmarkDocType } from "../../db/schema";
import type { RxDocument } from "rxdb";
import { BookmarkView, toBookmarkView } from "../../types/bookmark";
import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Music, Sparkles, FileText, Copy, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useGuardedDataLoad } from "../../hooks/useGuardedDataLoad";
import { useGuardedAction } from "../../hooks/useGuardedAction";
import { CardProps } from "./shared-props";
import { logRateLimited } from "../../utils/boundedLog";
import { boundedBookmarkQuery, MAX_SELECT_ITEMS } from "../../utils/knowledgeCardBounds";
import { generateWithPrivacy } from "../../services/ai/privacy";

interface Props extends CardProps {
  t: TFunction;
}

const STYLES = [
  { key: "children", label: "Children's Story" },
  { key: "scientific", label: "Scientific Paper" },
  { key: "tweet", label: "Twitter Thread" },
  { key: "poem", label: "Poem" },
  { key: "recipe", label: "Recipe" },
] as const;

export const BookmarkCoverSongs: React.FC<Props> = ({ cardVariants, t }) => {
  const { t: translate } = useTranslation();
  const [bookmarks, setBookmarks] = useState<BookmarkView[]>([]);
  const [selectedBookmarkId, setSelectedBookmarkId] = useState<string>("");
  const [selectedStyle, setSelectedStyle] = useState<string>("children");
  const [coverResult, setCoverResult] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mount load: autoLoad runs it once; the guard's auto-cancel on unmount
  // drops late results (the original loadBookmarks + `return loadGuard.cancel`).
  useGuardedDataLoad<BookmarkView[]>(
    async (signal) => {
      const { initDB } = await import("../../container/database");
      const db = await initDB() as BookmarkForgeDB;
      if (signal.aborted) {return [];}
      // Bound the pick-list: the card only needs bookmarks to choose from,
      // not a census. The isDeleted filter moves into the query (planable
      // via the [isDeleted, updatedAt] index) and the limit caps both the
      // materialization and the rendered <option> count on large vaults.
      const docs = await boundedBookmarkQuery(
        db.bookmarks,
        MAX_SELECT_ITEMS,
        { isDeleted: false, isPrivate: false },
      ).exec();
      if (signal.aborted) {return [];}
      return docs.map((b: RxDocument<BookmarkDocType>) => toBookmarkView(b));
    },
    {
      onSuccess: (items) => setBookmarks(items),
      onError: () => setBookmarks([]),
    },
  );
  // Generate owns its guard; the selection/style change effect cancels it
  // (the fixed cancel resets isRunning, covering the manual setIsLoading).
  const {
    runWithSignal,
    isRunning: isLoading,
    cancel: cancelGenerate,
  } = useGuardedAction<string>({
    onSuccess: (text) => setCoverResult(text),
    onError: () => {
      setCoverResult(
        translate(
          "app_coverError",
          "Failed to generate cover. Please try again.",
        ),
      );
    },
  });

  useEffect(() => {
    cancelGenerate();
    setCoverResult("");
    setCopied(false);
  }, [cancelGenerate, selectedBookmarkId, selectedStyle]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const selectedBookmark = bookmarks.find(
    (b: BookmarkView) => b.id === selectedBookmarkId,
  );

  const handleGenerate = () => {
    if (!selectedBookmark || !selectedBookmark.content) {return;}
    // Capture at call time: the property narrowing does not flow into the
    // operation closure.
    const selectedContent = selectedBookmark.content;
    void runWithSignal(async (signal) => {
      const { aiManager } = await import("../../services/ai/ProviderManager");
      const content = selectedContent.substring(0, 3000);
      const prompt = `Rewrite the following content as a ${selectedStyle} style. Be creative but keep all factual information accurate:\n\n${content}`;
      const res = await generateWithPrivacy(
        aiManager,
        selectedBookmark,
        prompt,
        undefined,
        { signal },
      );
      return res.text;
    });
  };

  const handleCopy = async () => {
    if (!coverResult) {return;}
    try {
      await navigator.clipboard.writeText(coverResult);
      setCopied(true);
      if (copyTimerRef.current !== null) {
        clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = setTimeout(() => {
        copyTimerRef.current = null;
        setCopied(false);
      }, 2000);
    } catch {
      // Clipboard unavailable (permissions/iframe) — surface it bounded so
      // the failure is diagnosable without spamming on repeated clicks.
      logRateLimited(
        "warn",
        "cover-copy-clipboard",
        "Clipboard write failed; copy to clipboard unavailable",
      );
    }
  };

  return (
    <motion.div
      variants={cardVariants}
      className="p-2 md:p-3 rounded-[3rem] shadow-sm ds-card col-span-1"
    >
      <div className="flex items-center gap-5 mb-8">
        <div className="p-4 rounded-[1.5rem] shadow-2xl ds-bg-accent-primary ds-shadow-accent-hero text-white">
          <Music className="size-7" />
        </div>
        <div>
          <h2 className="ds-h2 truncate">
            {t("app_bookmarkCoverSongs", "Bookmark Cover Songs")}
          </h2>
          <p className="ds-label-section mt-1 ds-text-muted">
            {t("app_coverSubtitle", "Rewrite bookmarks in creative styles")}
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest ds-text-muted block mb-2">
            {t("app_selectBookmark", "Select a Bookmark")}
          </label>
          <select
            value={selectedBookmarkId}
            onChange={(e) => setSelectedBookmarkId(e.target.value)}
            aria-label={t("app_selectBookmark", "Select a Bookmark")}
            className="w-full p-3 rounded-xl text-xs font-medium ds-bg-card ds-border ds-text-primary focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">
              {t("app_chooseBookmark", "Choose a bookmark...")}
            </option>
            {bookmarks.map((bm: BookmarkView) => (
              <option key={bm.id} value={bm.id}>
                {bm.title}
              </option>
            ))}
          </select>
          {bookmarks.length === 0 && (
            <p className="text-xs ds-text-muted text-center py-4">
              {t("app_noBookmarks", "No bookmarks found")}
            </p>
          )}
        </div>

        <div>
          <label className="text-[10px] font-bold uppercase tracking-widest ds-text-muted block mb-3">
            {t("app_chooseStyle", "Choose a Style")}
          </label>
          <div className="flex flex-wrap gap-2">
            {STYLES.map((style) => (
              <button
                key={style.key}
                onClick={() => setSelectedStyle(style.key)}
                className={`truncate rounded-xl p-3 text-xs font-bold transition-all ${
                  selectedStyle === style.key
                    ? "ds-bg-accent-primary ds-text-on-accent"
                    : "ds-bg-card ds-border ds-text-muted hover:ds-bg-accent-soft"
                }`}
              >
                {style.label}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={handleGenerate}
          disabled={isLoading || !selectedBookmark}
          className="truncate flex items-center gap-2 px-5 py-3 bg-blue-600 text-white text-xs font-bold rounded-xl hover:scale-105 active:scale-95 transition-all disabled:opacity-50 w-full justify-center"
        >
          {isLoading ? (
            <Sparkles className="size-4 animate-spin" />
          ) : (
            <FileText className="size-4" />
          )}
          {isLoading
            ? translate("app_generating", "Generating Cover...")
            : translate("app_generateCover", "Generate Cover")}
        </button>

        <AnimatePresence>
          {coverResult && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mt-4 p-5 rounded-2xl ds-bg-secondary relative group"
            >
              <button
                onClick={handleCopy}
                className="truncate absolute top-3 right-3 p-2 rounded-xl ds-bg-muted hover:ds-bg-accent-soft transition-colors"
                title={translate("app_copyToClipboard", "Copy to clipboard")}
              >
                {copied ? (
                  <Check className="size-4 text-green-500" />
                ) : (
                  <Copy className="size-4 ds-text-muted" />
                )}
              </button>
              <p className="text-sm ds-text-secondary leading-relaxed whitespace-pre-line pe-10">
                {coverResult}
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
};
