import { useState, useMemo, useTransition } from "react";
import { useTranslation } from "react-i18next";
import { formatDate } from "../../utils/localization";
import { motion } from "motion/react";
import { List, FileText, Bookmark, Search, X } from "lucide-react";
import { initDB } from "../../container/database";
import type { DocumentDocType, BookmarkDocType } from "../../db/schema";
import type { RxDocument } from "rxdb";
import { logger } from "../../utils/logger";
import { useGuardedDataLoad } from "../../hooks/useGuardedDataLoad";

interface ListItem {
  id: string;
  type: "document" | "bookmark";
  title: string;
  excerpt: string;
  tags: string[];
  updatedAt: string;
}

interface ListViewProps {
  onSelectDocument?: (id: string) => void;
  onSelectBookmark?: () => void;
}

export default function ListView({
  onSelectDocument,
  onSelectBookmark,
}: ListViewProps) {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState<ListItem[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "document" | "bookmark">("all");
  const [, startTransition] = useTransition();
  const {
    loading,
  } = useGuardedDataLoad(
    async (signal) => {
      const db = await initDB();
      const [docs, bookmarks] = await Promise.all([
        db.documents.find({ limit: 500 }).exec(),
        db.bookmarks.find({ limit: 500 }).exec(),
      ]);
      if (signal.aborted) {return [];}
      const list: ListItem[] = [
        ...docs
          .filter((d: RxDocument<DocumentDocType>) => !d.isDeleted)
          .map((d: RxDocument<DocumentDocType>) => ({
          id: d.id,
          type: "document" as const,
          title: d.title || "Untitled",
          excerpt: (d.textContent || "").substring(0, 120),
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
      onError: (err) => {
        logger.error("[ListView] Failed to load items:", err);
      },
    },
  );

  const filtered = useMemo(
    () =>
      items.filter((item) => {
        if (filter === "document" && item.type !== "document") {return false;}
        if (filter === "bookmark" && item.type !== "bookmark") {return false;}
        if (search) {
          const q = search.toLowerCase();
          return (
            item.title.toLowerCase().includes(q) ||
            item.excerpt.toLowerCase().includes(q) ||
            item.tags.some((tag) => tag.toLowerCase().includes(q))
          );
        }
        return true;
      }),
    [items, filter, search],
  );

  const handleItemClick = (item: ListItem) => {
    if (item.type === "document") {
      onSelectDocument?.(item.id);
    } else {
      onSelectBookmark?.();
    }
  };

  const filters: { key: typeof filter; label: string }[] = [
    { key: "all", label: t("app_all", "All") },
    { key: "document", label: t("app_documents", "Documents") },
    { key: "bookmark", label: t("app_bookmarksTitle", "Bookmarks") },
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col h-full"
    >
      <div className="flex items-center justify-between p-4 ds-border-divider">
        <div className="flex items-center gap-2">
          <List className="size-5 ds-text-accent" />
          <h1 className="ds-h2">{t("app_listView", "List View")}</h1>
          <span className="ds-text-tiny ds-text-muted ms-2">
            {filtered.length} {t("app_items", "items")}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3 px-4 py-3 ds-border-divider">
        <div className="relative flex-1 max-w-md">
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

        <div
          className="flex gap-1"
          role="tablist"
          aria-label={t("app_filterByType", "Filter by type")}
        >
          {filters.map((f) => (
            <button
              key={f.key}
              role="tab"
              aria-selected={filter === f.key}
              onClick={() => startTransition(() => setFilter(f.key))}
              className={`truncate px-3 py-1.5 text-sm ds-radius-button transition-colors ${
                filter === f.key
                  ? "ds-bg-accent-primary ds-text-on-accent"
                  : "ds-text-muted hover:ds-bg-card-soft"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="h-16 ds-bg-card-soft ds-radius-card animate-pulse"
              />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full ds-text-muted gap-2">
            <List className="size-12 opacity-30" />
            <p className="ds-text-secondary">
              {search
                ? t("app_noResults", "No results found")
                : t("app_noItems", "No items yet")}
            </p>
          </div>
        ) : (
          <div className="divide-y ds-border-divider">
            {filtered.map((item) => (
              <button
                key={`${item.type}-${item.id}`}
                onClick={() => handleItemClick(item)}
                className="truncate w-full text-start px-4 py-3 flex items-start gap-3 hover:ds-bg-card-soft transition-colors group"
              >
                <div
                  className={`mt-1 p-1.5 ds-radius-button ${
                    item.type === "document"
                      ? "ds-bg-accent-soft ds-text-accent"
                      : "bg-[var(--color-warning)]/10 ds-text-warning"
                  }`}
                >
                  {item.type === "document" ? (
                    <FileText className="size-4" />
                  ) : (
                    <Bookmark className="size-4" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="ds-card-subtitle truncate font-medium">
                      {item.title}
                    </span>
                    <span
                      className={`ds-text-tiny px-1.5 py-0.5 rounded-full shrink-0 ${
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
                  <p className="ds-text-tiny ds-text-muted mt-0.5 line-clamp-1">
                    {item.excerpt}
                  </p>
                  {item.tags.length > 0 && (
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {item.tags.slice(0, 4).map((tag) => (
                        <span
                          key={tag}
                          className="ds-text-tiny ds-text-muted bg-[var(--bg-secondary)] px-1.5 py-0.5 rounded-full"
                        >
                          {tag}
                        </span>
                      ))}
                      {item.tags.length > 4 && (
                        <span className="ds-text-tiny ds-text-muted">
                          +{item.tags.length - 4}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <span className="ds-text-tiny ds-text-muted shrink-0 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {formatDate(item.updatedAt, {}, i18n.language)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}
