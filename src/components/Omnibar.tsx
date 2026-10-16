import React, {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
  useTransition,
} from "react";
import {
  Search,
  FileText,
  Bookmark,
  Command,
  ArrowRight,
  Copy,
  Trash2,
  BarChart3,
} from "lucide-react";
import { useRxCollection, useRxQuery } from "../hooks/useRxDB";
import { useTranslation } from "react-i18next";
import Fuse from "fuse.js";
import { toast } from "sonner";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { logger } from "../utils/logger";

// Cap fuzzy matches rendered in the listbox: a threshold-0.3 Fuse search over
// a large vault can match thousands of items; rendering all of them freezes
// the UI. 50 covers everything a user can scan in one look.
const MAX_OMNIBAR_RESULTS = 50;

interface OmnibarProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (tab: string) => void;
  onAction: (action: string) => void;
  onSelectDocument: (id: string) => void;
  onSelectBookmark: (id: string) => void;
}

type ResultType = "doc" | "bookmark" | "command" | "ai";

interface OmnibarResult {
  id: string;
  title: string;
  type: ResultType;
  subtitle?: string;
  icon?: React.ElementType;
  action?: () => Promise<void> | void;
  data?: unknown;
}

const Omnibar = ({
  isOpen,
  onClose,
  onNavigate,
  onAction,
  onSelectDocument,
  onSelectBookmark,
}: OmnibarProps) => {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [activeResult, setActiveResult] = useState<OmnibarResult | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const prevQueryRef = useRef(query);
  const [, startTransition] = useTransition();
  const prevIsOpenRef = useRef(isOpen);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Debounce search query to avoid Fuse freezing UI on every keystroke
  useEffect(() => {
    clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      setDebouncedQuery(query);
    }, 150);
    return () => clearTimeout(debounceTimerRef.current);
  }, [query]);

  // Reset debounced query immediately when omnibar opens/closes
  useEffect(() => {
    if (isOpen) {
      setDebouncedQuery("");
    }
  }, [isOpen]);

  useEffect(() => {
    if (prevQueryRef.current !== query || prevIsOpenRef.current !== isOpen) {
      setSelectedIndex(0);
      prevQueryRef.current = query;
      prevIsOpenRef.current = isOpen;
    }
  }, [query, isOpen]);

  const docsCollection = useRxCollection("documents");
  const bookmarksCollection = useRxCollection("bookmarks");
  const { result: docs = [] } = useRxQuery(docsCollection?.find());
  const { result: bookmarks = [] } = useRxQuery(bookmarksCollection?.find());

  const allItems = useMemo(
    () =>
      [
        ...docs.map((d) => ({
          ...(d.toJSON() as Record<string, unknown>),
          type: "doc" as const,
        })),
        ...bookmarks.map((b) => ({
          ...(b.toJSON() as Record<string, unknown>),
          type: "bookmark" as const,
        })),
      ] as Array<
        Record<string, unknown> & {
          type: "doc" | "bookmark";
          id: string;
          title: string;
          summary?: string;
        }
      >,
    [docs, bookmarks],
  );

  const fuse = useMemo(
    () => new Fuse(allItems, { keys: ["title", "summary"], threshold: 0.3 }),
    [allItems],
  );

  const commands = useMemo(
    (): OmnibarResult[] => [
      {
        id: "cmd-dash",
        title: t("app_dashboard"),
        type: "command" as const,
        icon: Command,
        action: () => {
          onNavigate("dashboard");
          onClose();
        },
      },
      {
        id: "cmd-create",
        title: t("app_newDocument"),
        type: "command" as const,
        icon: FileText,
        action: () => {
          onAction("create_doc");
          onClose();
        },
      },
      {
        // The Intelligence Center modal (Export/Import sovereign-data UI)
        // had no reachable trigger: MainApp only mounts it on the
        // `show_analysis` action, which the Omnibar never offered (the
        // unit-test mock still expects an `omnibar-analysis` entry).
        id: "cmd-analysis",
        title: t("intelligenceCenter"),
        type: "command" as const,
        icon: BarChart3,
        action: () => {
          onAction("show_analysis");
          onClose();
        },
      },
    ],
    [t, onNavigate, onAction, onClose],
  );

  const results = useMemo(() => {
    if (!isOpen) {return [];}
    const cleanQuery = debouncedQuery.replace(/^[>?]/, "").trim();
    if (!cleanQuery) {
      const defaultItems: OmnibarResult[] = allItems.slice(0, 5).map((i) => ({
        id: i.id,
        title: i.title,
        type: i.type,
        icon: i.type === "doc" ? FileText : Bookmark,
        subtitle: i.type === "doc" ? "Document" : "Bookmark",
      }));
      return [...commands, ...defaultItems];
    } else {
      // Cap fuzzy matches: with a large vault, a threshold-0.3 search can
      // match thousands of items; rendering them all freezes the UI.
      const searchResults: OmnibarResult[] = fuse
        .search(cleanQuery)
        .slice(0, MAX_OMNIBAR_RESULTS)
        .map((r) => ({
          id: r.item.id,
          title: r.item.title,
          type: r.item.type as ResultType,
          subtitle: r.item.summary || "",
          icon: r.item.type === "doc" ? FileText : Bookmark,
        }));
      return [
        ...commands.filter((c) =>
          c.title.toLowerCase().includes(cleanQuery.toLowerCase()),
        ),
        ...searchResults,
      ];
    }
  }, [debouncedQuery, isOpen, fuse, commands, allItems]);

  const getActions = useCallback(
    (item: OmnibarResult): OmnibarResult[] => {
      if (item.type === "doc")
        {return [
          {
            id: "act-open",
            title: t("app_open"),
            type: "command",
            icon: ArrowRight,
            action: () => {
              onSelectDocument(item.id);
              onClose();
            },
          },
          {
            id: "act-copy",
            title: t("app_copyLink"),
            type: "command",
            icon: Copy,
            action: async () => {
              try {
                await navigator.clipboard.writeText(
                  window.location.origin + "/doc/" + item.id,
                );
                toast.success(t("app_copied"));
              } catch (err) {
                // Never claim a copy that did not happen; log instead of
                // surfacing an unhandled rejection.
                logger.error("[Omnibar] Failed to copy link", err);
              }
              onClose();
            },
          },
          {
            id: "act-delete",
            title: t("app_delete"),
            type: "command",
            icon: Trash2,
            action: () => {
              onAction("delete_doc_" + item.id);
              onClose();
            },
          },
        ];}
      if (item.type === "bookmark")
        {return [
          {
            id: "act-open",
            title: t("app_open"),
            type: "command",
            icon: ArrowRight,
            action: () => {
              onSelectBookmark(item.id);
              onClose();
            },
          },
        ];}
      return [];
    },
    [t, onSelectDocument, onSelectBookmark, onAction, onClose],
  );

  const handleEnter = useCallback(() => {
    if (activeResult) {
      const actions = getActions(activeResult);
      if (actions.length > 0) {return;}
    }
    const selected = results[selectedIndex];
    if (selected) {
      if (selected.action) {selected.action();}
      else {setActiveResult(selected);}
    }
  }, [activeResult, results, selectedIndex, getActions]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (activeResult) {
          setActiveResult(null);
        } else {
          onClose();
        }
      }
      if (e.key === "ArrowDown")
        {setSelectedIndex((p) => Math.min(p + 1, results.length - 1));}
      if (e.key === "ArrowUp") {setSelectedIndex((p) => Math.max(p - 1, 0));}
      if (e.key === "Enter") {handleEnter();}
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [results, selectedIndex, activeResult, onClose, handleEnter]);

  const containerRef = useFocusTrap(isOpen);

  if (!isOpen) {return null;}

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center pt-[15vh] px-4 ds-bg-black-50"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          if (!activeResult) {onClose();}
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-label={t("app_omnibarPlaceholder")}
    >
      <div
        ref={containerRef}
        className="w-full max-w-2xl shadow-2xl overflow-hidden ds-radius-card ds-bg-card ds-border"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-4 px-6 py-5 ds-divider-b">
          <Search className="size-5 ds-text-accent" aria-hidden="true" />
          <input
            ref={inputRef}
            autoFocus
            type="text"
            className="flex-1 bg-transparent border-none outline-none text-lg ds-text-primary placeholder:text-[var(--text-muted)]"
            placeholder={
              activeResult ? activeResult.title : t("app_omnibarPlaceholder")
            }
            value={query}
            onChange={(e) => startTransition(() => setQuery(e.target.value))}
            aria-label={t("app_omnibarPlaceholder")}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls="omnibar-listbox"
          />
        </div>

        <div
          className="max-h-[60vh] overflow-y-auto p-2"
          role="listbox"
          aria-label={t("app_searchResults")}
          id="omnibar-listbox"
        >
          {!activeResult ? (
            results.map((item, idx) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.id}
                  className="flex items-center gap-4 p-3 cursor-pointer"
                  style={{
                    borderRadius: "var(--radius-card)",
                    background:
                      selectedIndex === idx
                        ? "var(--state-hover-bg)"
                        : "transparent",
                    color: "var(--text-primary)",
                  }}
                  onClick={() => {
                    if (item.action) {
                      void item.action();
                    } else {
                      setActiveResult(item);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (item.action) {
                        void item.action();
                      } else {
                        setActiveResult(item);
                      }
                    }
                  }}
                  role="option"
                  aria-selected={selectedIndex === idx}
                  tabIndex={0}
                >
                  <div className="p-2 ds-radius-item ds-bg-secondary ds-text-accent">
                    {Icon && <Icon className="size-4" aria-hidden="true" />}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold ds-text-primary">
                      {item.title}
                    </p>
                    {item.subtitle && (
                      <p className="text-xs ds-text-muted">{item.subtitle}</p>
                    )}
                  </div>
                </div>
              );
            })
          ) : (
            <div
              className="space-y-1"
              role="group"
              aria-label={t("app_actions")}
            >
              {getActions(activeResult).map((action) => {
                const ActionIcon = action.icon;
                return (
                  <div
                    key={action.id}
                    className="flex items-center gap-4 p-3 cursor-pointer ds-radius-card"
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background =
                        "var(--state-hover-bg)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "transparent";
                    }}
                    onClick={action.action}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        action.action?.();
                      }
                    }}
                  >
                    {ActionIcon && (
                      <ActionIcon
                        className={`size-4 ds-text-accent ${action.icon === ArrowRight ? "rtl-flip" : ""}`}
                        aria-hidden="true"
                      />
                    )}
                    <p className="text-sm font-medium">{action.title}</p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
export default Omnibar;
