import type { BookmarkForgeDB } from "../../db/types";
import { useState, useEffect, useRef } from "react";
import { useGuardedDataLoad } from "../../hooks/useGuardedDataLoad";
import { useGuardedAction } from "../../hooks/useGuardedAction";
import { motion, AnimatePresence } from "motion/react";
import { Globe, Sparkles, Eye, Copy, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatDate } from "../../utils/localization";
import type { TFunction } from "i18next";
import { safeGet, safeSet } from "../../store/safeStorage";
import { SanitizationService } from "../../services/SanitizationService";
import { logRateLimited } from "../../utils/boundedLog";
import { CardProps } from "./shared-props";
import { boundedBookmarkQuery,
  MAX_AI_SOURCE_ITEMS,
  MAX_KNOWLEDGE_SCAN_ITEMS,
} from "../../utils/knowledgeCardBounds";
import { generateWithPrivacy } from "../../services/ai/privacy";


interface Props extends CardProps {
  t: TFunction;
}

interface PublishedSite {
  tag: string;
  html: string;
  publishedAt: string;
}

export const KnowledgeBasePublisher: React.FC<Props> = ({ cardVariants }) => {
  const { t: translate, i18n } = useTranslation();
  const [collections, setCollections] = useState<
    { tag: string; count: number }[]
  >([]);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [published, setPublished] = useState(false);
  const [previewHtml, setPreviewHtml] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [copied, setCopied] = useState(false);
  const [publishedSites, setPublishedSites] = useState<PublishedSite[]>(() => {
    try {
      const saved = safeGet("bookmarkforge_published_sites");
      return saved ? JSON.parse(saved) : [];
    } catch {
      logRateLimited(
        "warn",
        "published-sites-cache-parse",
        "Stored published sites are corrupted; starting empty",
      );
      return [];
    }
  });
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const {
    loading: _collectionsLoading,
  } = useGuardedDataLoad<{ tag: string; count: number }[]>(
    async (signal) => {
      const { initDB } = await import("../../container/database");
      const db = await initDB() as BookmarkForgeDB;
      // Tag counts are intentionally a bounded, recent sample: materializing
      // the whole vault here freezes the dashboard on large local databases.
      const docs = await boundedBookmarkQuery(
        db.bookmarks,
        MAX_KNOWLEDGE_SCAN_ITEMS,
        { isDeleted: false, isPrivate: false },
      ).exec();
      if (signal.aborted) {return [];}
      const tagMap: Record<string, number> = {};
      docs.forEach((d: { tags?: string[] }) => {
        (d.tags || []).forEach((tag: string) => {
          tagMap[tag] = (tagMap[tag] || 0) + 1;
        });
      });
      return Object.entries(tagMap)
        .map(([tag, count]) => ({ tag, count }))
        .sort((a, b) => b.count - a.count);
    },
    {
      onSuccess: (cols) => setCollections(cols),
      onError: () => setCollections([]),
    },
  );

  useEffect(() => {
    // The data-load hook cancels its guard on unmount automatically; only
    // the copied-timer cleanup remains.
    return () => {
      if (copiedTimerRef.current) {
        clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = null;
      }
    };
  }, []);

  const {
    runWithSignal: runPublish,
    isRunning: publishing,
  } = useGuardedAction<PublishedSite>({
    blockReentry: false,
    onStart: () => {
      setPublished(false);
      setPreviewHtml("");
    },
    onSuccess: (newSite) => {
      setPreviewHtml(newSite.html);
      setPublished(true);
      const updated = [...publishedSites, newSite];
      setPublishedSites(updated);
      safeSet("bookmarkforge_published_sites", JSON.stringify(updated));
    },
    onError: (error) => {
      // AbortError is dropped by the guard; plain failures clear the preview.
      if (!(error instanceof Error && error.name === "AbortError")) {
        setPreviewHtml("");
      }
    },
  });

  const handlePublish = (tag: string) => {
    setSelectedTag(tag);
    void runPublish(async (signal) => {
      const { initDB } = await import("../../container/database");
      const db = await initDB() as BookmarkForgeDB;
      // Query only the selected tag and cap the source material. The prior
      // full-vault read was both unnecessary and capable of creating an
      // unbounded AI prompt for a popular collection.
      const docs = await boundedBookmarkQuery(
        db.bookmarks,
        MAX_AI_SOURCE_ITEMS,
        {
          isDeleted: false,
          isPrivate: false,
          tags: { $elemMatch: { $eq: tag } },
        },
      ).exec();
      if (signal.aborted) {return undefined as unknown as PublishedSite;}
      const entries = docs
        .map(
          (d: { title: string; summary?: string; content?: string }) =>
            `- ${d.title}: ${(d.summary || d.content || "").slice(0, 300)}`,
        )
        .join("\n");

      const { aiManager } = await import("../../services/ai/ProviderManager");
      if (signal.aborted) {return undefined as unknown as PublishedSite;}
      const prompt = `Generate a beautiful HTML knowledge base page for the given topic using the provided bookmarks as entries. Each entry should have title, summary, and tags. The page should have a clean professional design with embedded CSS. Return ONLY valid HTML.\n\nTopic: ${tag}\n\nBookmarks:\n${entries}`;
      const res = await generateWithPrivacy(
        aiManager,
        { isPrivate: false },
        prompt,
        undefined,
        { signal },
      );
      if (signal.aborted) {return undefined as unknown as PublishedSite;}
      // Sanitize AI-generated HTML before storing or displaying it.
      const html = SanitizationService.sanitizeHtml(res.text, false);

      return { tag, html, publishedAt: new Date().toISOString() };
    });
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(previewHtml);
      setCopied(true);
      if (copiedTimerRef.current) {
        clearTimeout(copiedTimerRef.current);
      }
      copiedTimerRef.current = setTimeout(() => {
        setCopied(false);
        copiedTimerRef.current = null;
      }, 2000);
    } catch {
      // Clipboard unavailable (permissions/iframe) — surface it bounded so
      // the failure is diagnosable without spamming on repeated clicks.
      logRateLimited(
        "warn",
        "publisher-copy-clipboard",
        "Clipboard write failed; copy to clipboard unavailable",
      );
    }
  };

  const handleDeleteSite = (index: number) => {
    const updated = publishedSites.filter((_, i) => i !== index);
    setPublishedSites(updated);
    safeSet("bookmarkforge_published_sites", JSON.stringify(updated));
  };

  return (
    <motion.div variants={cardVariants} className="bento-item p-5">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-3 rounded-xl ds-bg-accent-soft ds-text-accent">
          <Globe className="size-5" />
        </div>
        <h3 className="font-semibold text-sm ds-text-primary">
          {translate("app_knowledgeBasePublisher", "Knowledge Base Publisher")}
        </h3>
      </div>

      <div className="space-y-3 mb-6">
        {collections.map((col) => (
          <div
            key={col.tag}
            className="flex items-center justify-between p-4 rounded-2xl mb-3 ds-bg-card ds-border"
          >
            <div>
              <span className="text-sm font-semibold ds-text-primary">
                {col.tag}
              </span>
              <span className="text-xs ds-text-muted ms-2">
                {col.count} {translate("app_bookmarks", "bookmarks")}
              </span>
            </div>
            <button
              onClick={() => handlePublish(col.tag)}
              disabled={publishing && selectedTag === col.tag}
              className="truncate flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-xs font-bold rounded-xl hover:scale-105 active:scale-95 transition-all disabled:opacity-50"
            >
              {publishing && selectedTag === col.tag ? (
                <Sparkles className="size-3.5 animate-spin" />
              ) : (
                <Globe className="size-3.5" />
              )}
              {translate("app_publish", "Publish")}
            </button>
          </div>
        ))}
        {collections.length === 0 && (
          <p className="text-xs ds-text-muted text-center py-6">
            {translate("app_noCollections", "No collections found")}
          </p>
        )}
      </div>

      {published && (
        <div className="flex items-center gap-3 mb-6">
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 text-xs font-semibold">
            <Check className="size-3.5" />
            {translate("app_published", "Published")}
          </div>
          {previewHtml && (
            <>
              <button
                onClick={() => setShowPreview(true)}
                className="truncate flex items-center gap-2 px-4 py-2 bg-violet-500 text-white text-xs font-bold rounded-xl hover:scale-105 active:scale-95 transition-all"
              >
                <Eye className="size-3.5" />
                {translate("app_preview", "Preview")}
              </button>
              <button
                onClick={handleCopy}
                className="truncate flex items-center gap-2 px-4 py-2 bg-gray-500 text-white text-xs font-bold rounded-xl hover:scale-105 active:scale-95 transition-all"
              >
                {copied ? (
                  <Check className="size-3.5" />
                ) : (
                  <Copy className="size-3.5" />
                )}
                {copied
                  ? translate("app_copied", "Copied!")
                  : translate("app_copyHtml", "Copy HTML")}
              </button>
            </>
          )}
        </div>
      )}

      {publishedSites.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider ds-text-muted mb-3">
            {translate("app_previouslyPublished", "Previously Published")}
          </h4>
          <div className="space-y-2">
            {publishedSites.map((site, i) => (
              <div
                key={i}
                className="flex items-center justify-between p-3 rounded-xl ds-bg-card ds-border"
              >
                <div>
                  <span className="text-xs font-semibold ds-text-primary">
                    {site.tag}
                  </span>
                  <span className="text-[10px] ds-text-muted ms-2">
                    {formatDate(site.publishedAt, {}, i18n.language)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setPreviewHtml(site.html);
                      setShowPreview(true);
                    }}
                    className="p-2 rounded-lg hover:bg-accent-soft transition-colors ds-text-muted"
                  >
                    <Eye className="size-3.5" />
                  </button>
                  <button
                    onClick={() => handleDeleteSite(i)}
                    className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-red-500"
                  >
                    <span className="text-xs font-bold">✕</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <AnimatePresence>
        {showPreview && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
            onClick={() => setShowPreview(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-4xl max-h-[85vh] overflow-hidden rounded-2xl ds-card shadow-2xl"
            >
              <div className="flex items-center justify-between p-4 border-b ds-border">
                <h3 className="text-sm font-semibold ds-text-primary truncate">
                  {translate("app_preview", "Preview")}
                </h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCopy}
                    className="truncate flex items-center gap-1.5 px-3 py-1.5 bg-gray-500 text-white text-xs font-bold rounded-lg hover:scale-105 transition-all"
                  >
                    {copied ? (
                      <Check className="size-3" />
                    ) : (
                      <Copy className="size-3" />
                    )}
                    {copied
                      ? translate("app_copied", "Copied!")
                      : translate("app_copyHtml", "Copy HTML")}
                  </button>
                  <button
                    onClick={() => setShowPreview(false)}
                    className="p-1.5 rounded-lg hover:bg-accent-soft transition-colors ds-text-muted"
                  >
                    <span className="text-lg font-bold">✕</span>
                  </button>
                </div>
              </div>
              <div className="overflow-y-auto max-h-[calc(85vh-64px)]">
                <iframe
                  title={translate("app_preview", "Preview")}
                  srcDoc={SanitizationService.sanitizeHtml(previewHtml, false)}
                  sandbox=""
                  className="w-full h-full min-h-[60vh] border-0"
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};
