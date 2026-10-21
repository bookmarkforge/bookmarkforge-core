import { useState } from "react";
import { motion, AnimatePresence, type Variants } from "motion/react";
import { Share2, Sparkles, X, CheckSquare } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { BookmarkDocType } from "../../db/schema";
import type { RxDocument } from "rxdb";
import { BookmarkView, toBookmarkView } from "../../types/bookmark";
import { useGuardedAction } from "../../hooks/useGuardedAction";
import { useGuardedDataLoad } from "../../hooks/useGuardedDataLoad";
import { generateWithPrivacy } from "../../services/ai/privacy";

interface Props {
  cardVariants: Variants;
}

export const BookmarkFusion: React.FC<Props> = ({ cardVariants }) => {
  const { t: translate } = useTranslation();
  const [bookmarks, setBookmarks] = useState<BookmarkView[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [fusedContent, setFusedContent] = useState("");
  const [showModal, setShowModal] = useState(false);

  // Mount load + fuse action — the guard family: a late load result after
  // unmount is dropped, and a fuse superseded mid-generation is a no-op.
  useGuardedDataLoad<BookmarkView[]>(
    async () => {
      const { initDB } = await import("../../container/database");
      const db = await initDB();
      // This card uses the default cloud-capable chat path; private bookmarks
      // are not eligible source material for it.
      const docs = await db.bookmarks
        .find({ selector: { isDeleted: false, isPrivate: false } })
        .exec();
      return docs.map((d: RxDocument<BookmarkDocType>) => toBookmarkView(d));
    },
    {
      initialLoading: false,
      onSuccess: setBookmarks,
      onError: () => setBookmarks([]),
    },
  );

  const toggleId = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const fuse = useGuardedAction<string>({
    onSuccess: (text) => {
      setFusedContent(text);
      setShowModal(true);
    },
    onError: () => {
      setFusedContent(
        translate(
          "app_fusionError",
          "Failed to fuse bookmarks. Please try again.",
        ),
      );
      setShowModal(true);
    },
  });
  const isLoading = fuse.isRunning;

  const handleFuse = async () => {
    if (selectedIds.length < 2) {return;}
    await fuse.run(async () => {
      const { aiManager } = await import("../../services/ai/ProviderManager");
      // Set for the lookup: `selectedIds.includes` inside the filter was
      // O(n×m) with 100k bookmarks and many selections.
      const selectedIdSet = new Set(selectedIds);
      const selected = bookmarks.filter((b) => selectedIdSet.has(b.id));
      const excerpts = selected
        .map((b) => `--- ${b.title} ---\n${(b.content ?? "").substring(0, 2000)}`)
        .join("\n\n");
      const prompt = `Synthesize the following bookmarks into a cohesive insight. Identify common themes, contradictions, and generate a new integrated perspective.\n\n${excerpts}`;
      const res = await generateWithPrivacy(
        aiManager,
        { isPrivate: selected.some((bookmark) => bookmark.isPrivate !== false) },
        prompt,
      );
      return res.text;
    });
  };

  return (
    <>
      <motion.div
        variants={cardVariants}
        className="p-2 md:p-3 rounded-[3rem] shadow-sm ds-card"
      >
        <div className="flex items-center gap-5 mb-8">
          <div className="p-4 rounded-[1.5rem] shadow-2xl ds-bg-accent-primary ds-shadow-accent-hero text-white">
            <Share2 className="size-7" />
          </div>
          <div>
            <h2 className="ds-h2 truncate">
              {translate("app_bookmarkFusion", "Bookmark Fusion")}
            </h2>
            <p className="ds-label-section mt-1 ds-text-muted">
              {translate("app_fusionSubtitle", "Merge bookmarks into insights")}
            </p>
          </div>
        </div>

        <div className="space-y-2 max-h-[300px] overflow-y-auto mb-6">
          {bookmarks.map((bm) => (
            <label
              key={bm.id}
              className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all ds-bg-card ds-border hover:shadow-sm ${
                selectedIds.includes(bm.id)
                  ? "ds-border-accent ds-bg-accent-soft"
                  : ""
              }`}
            >
              <input
                type="checkbox"
                checked={selectedIds.includes(bm.id)}
                onChange={() => toggleId(bm.id)}
                aria-label={bm.title}
                className="accent-blue-500 size-4 shrink-0"
              />
              <span className="text-xs font-medium ds-text-primary truncate">
                {bm.title}
              </span>
            </label>
          ))}
          {bookmarks.length === 0 && (
            <p className="text-xs ds-text-muted text-center py-6">
              {translate("app_noBookmarks", "No bookmarks found")}
            </p>
          )}
        </div>

        <button
          onClick={handleFuse}
          disabled={isLoading || selectedIds.length < 2}
          className="truncate flex items-center gap-2 px-5 py-3 bg-blue-600 text-white text-xs font-bold rounded-xl hover:scale-105 active:scale-95 transition-all disabled:opacity-50 w-full justify-center"
        >
          {isLoading ? (
            <Sparkles className="size-4 animate-spin" />
          ) : (
            <CheckSquare className="size-4" />
          )}
          {isLoading
            ? translate("app_fusing", "Fusing...")
            : translate("app_fuseSelected", "Fuse Selected ({count})", {
                count: selectedIds.length,
              })}
        </button>
      </motion.div>

      <AnimatePresence>
        {showModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
            onClick={() => setShowModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-2xl max-h-[80vh] overflow-y-auto p-8 rounded-[2.5rem] ds-card shadow-2xl"
            >
              <button
                onClick={() => setShowModal(false)}
                className="absolute top-4 right-4 p-2 rounded-xl ds-bg-muted hover:ds-bg-accent-soft transition-colors"
              >
                <X className="size-4 ds-text-muted" />
              </button>
              <div className="flex items-center gap-3 mb-6">
                <div className="p-3 rounded-xl ds-bg-accent-soft ds-text-accent">
                  <Sparkles className="size-5" />
                </div>
                <h3 className="font-extrabold text-lg ds-text-primary truncate">
                  {translate("app_fusionResult", "Fusion Result")}
                </h3>
              </div>
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <p className="text-sm ds-text-secondary leading-relaxed whitespace-pre-line">
                  {fusedContent}
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
