import { useState, useEffect, useTransition } from "react";
import { useTranslation } from "react-i18next";
import { formatDate } from "../../utils/localization";
import { motion } from "motion/react";
import { logger } from "../../utils/logger";
import {
  History,
  FileText,
  Bookmark,
  Search,
  X,
  CalendarDays,
} from "lucide-react";
import { initDB } from "../../container/database";
import type { DocumentDocType, BookmarkDocType } from "../../db/schema";
import type { RxDocument } from "rxdb";
import { useGuardedDataLoad } from "../../hooks/useGuardedDataLoad";
import { analyticsService } from "../../services/AnalyticsService";

interface TimelineEntry {
  id: string;
  type: "document" | "bookmark";
  title: string;
  excerpt: string;
  tags: string[];
  date: Date;
  dateLabel: string;
}

interface TimelineViewProps {
  onSelectDocument?: (id: string) => void;
  onSelectBookmark?: () => void;
}

function formatDateLabel(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) {return "Today";}
  if (days === 1) {return "Yesterday";}
  if (days < 7) {return `${days} days ago`;}
  if (days < 30) {return `${Math.floor(days / 7)} weeks ago`;}
  if (days < 365) {return `${Math.floor(days / 30)} months ago`;}
  return `${Math.floor(days / 365)} years ago`;
}

export default function TimelineView({
  onSelectDocument,
  onSelectBookmark,
}: TimelineViewProps) {
  const { t, i18n } = useTranslation();
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [search, setSearch] = useState("");
  const [, startTransition] = useTransition();
  useEffect(() => {
    analyticsService.track("timeline_viewed");
  }, []);

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
      const list: TimelineEntry[] = [
        ...docs
          .filter((d: RxDocument<DocumentDocType>) => !d.isDeleted)
          .map((d: RxDocument<DocumentDocType>) => {
          const date = new Date(d.updatedAt);
          return {
            id: d.id,
            type: "document" as const,
            title: d.title || "Untitled",
            excerpt: (d.textContent || "").substring(0, 120),
            tags: d.tags || [],
            date,
            dateLabel: formatDateLabel(date),
          };
        }),
        ...bookmarks
          .filter((b: RxDocument<BookmarkDocType>) => !b.isDeleted)
          .map((b: RxDocument<BookmarkDocType>) => {
          const date = new Date(b.updatedAt);
          return {
            id: b.id,
            type: "bookmark" as const,
            title: b.title || "Untitled",
            excerpt: b.url || "",
            tags: b.tags || [],
            date,
            dateLabel: formatDateLabel(date),
          };
        }),
      ];
      list.sort((a, b) => b.date.getTime() - a.date.getTime());
      return list;
    },
    {
      onSuccess: (list) => setEntries(list),
      onError: (err) => {
        logger.error("[TimelineView] Failed to load items:", err);
      },
    },
  );

  const filtered = search
    ? entries.filter((e) => {
        const q = search.toLowerCase();
        return (
          e.title.toLowerCase().includes(q) ||
          e.excerpt.toLowerCase().includes(q) ||
          e.tags.some((tag) => tag.toLowerCase().includes(q))
        );
      })
    : entries;

  const grouped = filtered.reduce<Record<string, TimelineEntry[]>>(
    (acc, entry) => {
      const key = entry.dateLabel;
      if (!acc[key]) {acc[key] = [];}
      acc[key].push(entry);
      return acc;
    },
    {},
  );

  const handleItemClick = (item: TimelineEntry) => {
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
          <History className="size-5 ds-text-accent" />
          <h1 className="ds-h2">{t("app_timelineView", "Timeline")}</h1>
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
          <div className="space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex gap-4">
                <div className="w-24 h-4 ds-bg-card-soft ds-radius-card animate-pulse shrink-0" />
                <div className="flex-1 h-16 ds-bg-card-soft ds-radius-card animate-pulse" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full ds-text-muted gap-2">
            <CalendarDays className="size-12 opacity-30" />
            <p className="ds-text-secondary">
              {search
                ? t("app_noResults", "No results found")
                : t("app_noItems", "No items yet")}
            </p>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto space-y-6">
            {Object.entries(grouped).map(([dateLabel, items]) => (
              <div key={dateLabel}>
                <div className="flex items-center gap-3 mb-3">
                  <CalendarDays className="size-4 ds-text-muted shrink-0" />
                  <h2 className="ds-label-section ds-text-muted">
                    {dateLabel}
                  </h2>
                  <div className="flex-1 h-px ds-bg-divider" />
                </div>
                <div className="relative ms-2 space-y-2">
                  <div className="absolute start-3 top-0 bottom-0 w-px ds-bg-divider" />
                  {items.map((entry) => (
                    <button
                      key={`${entry.type}-${entry.id}`}
                      onClick={() => handleItemClick(entry)}
                      className="truncate relative w-full text-start ps-10 pe-4 py-3 flex items-start gap-3 hover:ds-bg-card-soft ds-radius-card transition-colors group"
                    >
                      <div
                        className={`absolute start-2 top-4 size-2.5 rounded-full ring-2 ds-ring-card ${
                          entry.type === "document"
                            ? "ds-bg-accent"
                            : "bg-[var(--color-warning)]"
                        }`}
                      />
                      <div
                        className={`mt-0.5 p-1.5 ds-radius-button shrink-0 ${
                          entry.type === "document"
                            ? "ds-bg-accent-soft ds-text-accent"
                            : "bg-[var(--color-warning)]/10 ds-text-warning"
                        }`}
                      >
                        {entry.type === "document" ? (
                          <FileText className="size-3.5" />
                        ) : (
                          <Bookmark className="size-3.5" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="ds-card-subtitle truncate font-medium">
                            {entry.title}
                          </span>
                          <span
                            className={`ds-text-tiny px-1.5 py-0.5 rounded-full shrink-0 ${
                              entry.type === "document"
                                ? "ds-bg-accent-soft ds-text-accent"
                                : "bg-[var(--warning-soft)] ds-text-warning"
                            }`}
                          >
                            {entry.type === "document"
                              ? t("app_document", "Doc")
                              : t("app_bookmark", "Link")}
                          </span>
                        </div>
                        <p className="ds-text-tiny ds-text-muted mt-0.5 line-clamp-1">
                          {entry.excerpt}
                        </p>
                        {entry.tags.length > 0 && (
                          <div className="flex gap-1 mt-1 flex-wrap">
                            {entry.tags.slice(0, 3).map((tag) => (
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
                      <span className="ds-text-tiny ds-text-muted shrink-0 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {formatDate(entry.date, {}, i18n.language)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}
