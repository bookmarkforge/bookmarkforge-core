import { useState, useMemo, useTransition } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { Image, FileText, Bookmark, Search, X, Grid3X3 } from "lucide-react";
import { initDB } from "../../container/database";
import type { DocumentDocType, BookmarkDocType } from "../../db/schema";
import type { RxDocument } from "rxdb";
import { logger } from "../../utils/logger";
import { useGuardedDataLoad } from "../../hooks/useGuardedDataLoad";

interface GalleryItem {
  id: string;
  type: "document" | "bookmark";
  title: string;
  excerpt: string;
  tags: string[];
  updatedAt: string;
}

interface GalleryViewProps {
  onSelectDocument?: (id: string) => void;
  onSelectBookmark?: () => void;
}

export default function GalleryView({
  onSelectDocument,
  onSelectBookmark,
}: GalleryViewProps) {
  const { t } = useTranslation();
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [search, setSearch] = useState("");
  const [, startTransition] = useTransition();
  // Mount load: autoLoad runs it once; the guard's auto-cancel on unmount
  // drops any late result (the original loadItems + `return cancel`).
  const { loading } = useGuardedDataLoad<GalleryItem[]>(
    async (signal) => {
      const db = await initDB();
      if (signal.aborted) {return [];}
      const [docs, bookmarks] = await Promise.all([
        db.documents.find({ limit: 500 }).exec(),
        db.bookmarks.find({ limit: 500 }).exec(),
      ]);
      if (signal.aborted) {return [];}
      const list: GalleryItem[] = [
        ...docs
          .filter((d: RxDocument<DocumentDocType>) => !d.isDeleted)
          .map((d: RxDocument<DocumentDocType>) => ({
          id: d.id,
          type: "document" as const,
          title: d.title || "Untitled",
          excerpt: (d.textContent || "").substring(0, 150),
          tags: d.tags || [],
          updatedAt: d.updatedAt,
        })),
        ...bookmarks
          .filter((b: RxDocument<BookmarkDocType>) => !b.isDeleted)
          .map((b: RxDocument<BookmarkDocType>) => ({
          id: b.id,
          type: "bookmark" as const,
          title: b.title || "Untitled",
          excerpt: b.url || "",
          tags: b.tags || [],
          updatedAt: b.updatedAt,
        })),
      ];
      list.sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
      return list;
    },
    {
      onSuccess: (list) => setItems(list),
      onError: (err) =>
        logger.error("[GalleryView] Failed to load items:", err),
    },
  );

  const filtered = useMemo(
    () =>
      search
        ? items.filter((item) => {
            const q = search.toLowerCase();
            return (
              item.title.toLowerCase().includes(q) ||
              item.excerpt.toLowerCase().includes(q) ||
              item.tags.some((tag) => tag.toLowerCase().includes(q))
            );
          })
        : items,
    [items, search],
  );

  const handleItemClick = (item: GalleryItem) => {
    if (item.type === "document") {
      onSelectDocument?.(item.id);
    } else {
      onSelectBookmark?.();
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col h-full"
    >
      <div className="flex items-center justify-between p-4 ds-border-divider">
        <div className="flex items-center gap-2">
          <Grid3X3 className="size-5 ds-text-accent" />
          <h1 className="ds-h2">{t("app_galleryView", "Gallery")}</h1>
          <span className="ds-text-tiny ds-text-muted ms-2">
            {filtered.length} {t("app_items", "items")}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3 px-4 py-3 ds-border-divider">
        <div className="relative max-w-md">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 size-4 ds-text-muted" />
          <input
            type="text"
            aria-label={t("app_search", "Search")}
            value={search}
            onChange={(e) => startTransition(() => setSearch(e.target.value))}
            placeholder={t("app_search", "Search...")}
            className="w-full ps-9 pe-8 py-2 text-sm ds-input ds-radius-input ds-border-divider"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute end-2 top-1/2 -translate-y-1/2 ds-text-muted hover:ds-text-primary"
              aria-label={t("app_clear", "Clear")}
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {Array.from({ length: 12 }).map((_, i) => (
              <div
                key={i}
                className="h-48 ds-bg-card-soft ds-radius-card animate-pulse"
              />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full ds-text-muted gap-2">
            <Image className="size-12 opacity-30" />
            <p className="ds-text-secondary">
              {search
                ? t("app_noResults", "No results found")
                : t("app_noItems", "No items yet")}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map((item) => (
              <motion.button
                key={`${item.type}-${item.id}`}
                layout
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                onClick={() => handleItemClick(item)}
                className="truncate group text-start ds-card-soft-primary ds-radius-card ds-border-soft overflow-hidden hover:ds-shadow-sm transition-all"
              >
                <div className="h-32 ds-bg-card-soft flex items-center justify-center overflow-hidden">
                  <div
                    className={`p-3 ds-radius-full ${
                      item.type === "document"
                        ? "ds-bg-accent-soft ds-text-accent"
                        : "bg-[var(--color-warning)]/10 ds-text-warning"
                    }`}
                  >
                    {item.type === "document" ? (
                      <FileText className="size-8" />
                    ) : (
                      <Bookmark className="size-8" />
                    )}
                  </div>
                </div>
                <div className="p-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span
                      className={`ds-text-tiny px-1.5 py-0.5 rounded-full ${
                        item.type === "document"
                          ? "ds-bg-accent-soft ds-text-accent"
                          : "bg-[var(--warning-soft)] ds-text-warning"
                      }`}
                    >
                      {item.type === "document"
                        ? t("app_document", "Doc")
                        : t("app_bookmark", "Link")}
                    </span>
                  </div>
                  <p className="ds-card-subtitle font-medium line-clamp-1">
                    {item.title}
                  </p>
                  <p className="ds-text-tiny ds-text-muted mt-1 line-clamp-2">
                    {item.excerpt}
                  </p>
                  {item.tags.length > 0 && (
                    <div className="flex gap-1 mt-2 flex-wrap">
                      {item.tags.slice(0, 3).map((tag) => (
                        <span
                          key={tag}
                          className="ds-text-tiny ds-text-muted bg-[var(--bg-secondary)] px-1.5 py-0.5 rounded-full"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </motion.button>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}
