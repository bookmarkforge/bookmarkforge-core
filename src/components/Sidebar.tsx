import React, { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  SIDEBAR_TAB_IDS,
  type SidebarTabId,
} from "../constants/navigation";
import { motion, AnimatePresence } from "motion/react";
import { RouteErrorBoundary } from "./errors/RouteErrorBoundary";
import {
  LayoutDashboard,
  FileText,
  Bookmark,
  Share2,
  MessageSquare,
  Mic,
  Users,
  Activity,
  HelpCircle,
  PanelLeftClose,
  Table,
  Columns,
  CalendarDays,
  List,
  Grid3X3,
  History,
  ShieldCheck,
} from "lucide-react";
import { safeGet, safeSet } from "../store/safeStorage";
import { TOUR_ID_MAP } from "../utils/browser-types";

const SIDEBAR_STORAGE_KEY = "bookmarkforge_sidebar_collapsed";

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

// Per-tab presentation (label i18n key + icon), keyed by the CANONICAL tab
// id from src/constants/navigation.ts — the same array the E2E selector gate
// imports. The Record<...> keying enforces both drift directions at
// typecheck: a tab id removed from the shared array becomes an excess-key
// error here, and a shared id missing here fails the Record completeness
// check. The id strings themselves live ONLY in navigation.ts.
// Exported for Sidebar.test.tsx, which pins every labelKey against the whole
// locale corpus (P-05).
export const SIDEBAR_ITEM_META: Record<
  SidebarTabId,
  {
    labelKey: string;
    defaultValue?: string;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  dashboard: { labelKey: "app_dashboard", icon: LayoutDashboard },
  documents: { labelKey: "app_documents", icon: FileText },
  bookmarks: { labelKey: "app_bookmarksTitle", icon: Bookmark },
  graph: { labelKey: "app_graph", icon: Share2 },
  canvas: {
    labelKey: "app_canvas",
    defaultValue: "Canvas",
    icon: LayoutDashboard,
  },
  database: {
    labelKey: "app_database",
    defaultValue: "Database",
    icon: Table,
  },
  kanban: {
    labelKey: "app_kanban",
    defaultValue: "Kanban",
    icon: Columns,
  },
  calendar: {
    labelKey: "app_calendar",
    defaultValue: "Calendar",
    icon: CalendarDays,
  },
  list: { labelKey: "app_listView", defaultValue: "List", icon: List },
  gallery: {
    labelKey: "app_galleryView",
    defaultValue: "Gallery",
    icon: Grid3X3,
  },
  timeline: {
    labelKey: "app_timelineView",
    defaultValue: "Timeline",
    icon: History,
  },
  chatLocal: { labelKey: "app_chatLocal", icon: MessageSquare },
  voiceLocal: { labelKey: "app_voiceLocal", icon: Mic },
  collaboration: { labelKey: "app_collaborationTitle", icon: Users },
  analytics: { labelKey: "app_analytics", icon: Activity },
  // P-05: `app_security` existed in NO locale, so the sidebar rendered the
  // raw key as its label. Point at the key the locales actually define
  // (Sidebar.test.tsx pins every labelKey against the locale corpus).
  security: { labelKey: "app_security_title", icon: ShieldCheck },
  chat: {
    labelKey: "app_supportChat",
    defaultValue: "Support",
    icon: HelpCircle,
  },
};

// Display order comes from the shared SIDEBAR_TAB_IDS array.
const sidebarItems = (t: TFunction) =>
  SIDEBAR_TAB_IDS.map((id) => {
    const meta = SIDEBAR_ITEM_META[id];
    return {
      id,
      label: meta.defaultValue
        ? t(meta.labelKey, { defaultValue: meta.defaultValue })
        : t(meta.labelKey),
      icon: meta.icon,
    };
  });

const Sidebar = function Sidebar({
  activeTab,
  setActiveTab,
}: SidebarProps) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(() => {
    return safeGet(SIDEBAR_STORAGE_KEY) === "true";
  });

  useEffect(() => {
    safeSet(SIDEBAR_STORAGE_KEY, collapsed.toString());
    // Drives the Tailwind `sidebar-collapsed:` variant (content offset) and
    // the `.sidebar-collapsed .sidebar-item` rules (centered icons).
    document.documentElement.classList.toggle("sidebar-collapsed", collapsed);
  }, [collapsed]);

  const items = useMemo(() => sidebarItems(t), [t]);

  const handleNavClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      const tabId = e.currentTarget.getAttribute("data-tab-id");
      if (tabId) {setActiveTab(tabId);}
    },
    [setActiveTab],
  );

  return (
    <RouteErrorBoundary
      fallback={
        <div className="hidden md:flex flex-col fixed start-0 top-0 h-screen w-16 items-center justify-center ds-bg-sidebar">
          <p className="text-[10px] ds-text-muted text-center px-1">{t("app_navError", "Nav error")}</p>
        </div>
      }
    >
    <aside
      data-collapsed={collapsed}
      className="hidden md:flex flex-col fixed start-0 top-0 h-screen z-40 overflow-hidden ds-bg-sidebar ds-border-e ds-shadow-sidebar w-[220px] transition-[width] duration-200 ease-[var(--ease-out)] data-[collapsed=true]:w-16"
      aria-label={t("app_primaryNavigation", "Primary navigation")}
      data-tour-id="tour-sidebar"
    >
      {/* Logo area */}
      <div className="flex items-center justify-between px-3 h-16 shrink-0 ds-divider-b">
        <motion.div
          animate={{ opacity: collapsed ? 0 : 1 }}
          className="flex items-center gap-2 overflow-hidden"
        >
          <img
            src="/logo-64.png"
            alt="BookmarkForge"
            className="size-8 shrink-0"
            width={64}
            height={64}
            loading="lazy"
            decoding="async"
          />
        </motion.div>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1.5 shrink-0 ds-ghost-btn-icon ds-radius-button"
          aria-label={
            collapsed
              ? t("app_expandSidebar", "Expand sidebar")
              : t("app_collapseSidebar", "Collapse sidebar")
          }
        >
          <PanelLeftClose className="rtl-flip size-4" />
        </button>
      </div>

      {/* Navigation items */}
      <nav
        className="flex-1 overflow-y-auto py-3 px-2 space-y-1"
        aria-label={t("app_sidebarNav", "Sidebar sections")}
      >
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={handleNavClick}
              data-tab-id={item.id}
              data-tour-id={TOUR_ID_MAP[item.id]}
              className={`truncate sidebar-item w-full text-start ${isActive ? "active" : ""}`}
              title={collapsed ? item.label : undefined}
              aria-label={item.label}
              aria-current={isActive ? "page" : undefined}
            >
              <Icon className="size-[18px] shrink-0" />
              <AnimatePresence>
                {!collapsed && (
                  <motion.span
                    initial={{ opacity: 0, width: 0 }}
                    animate={{ opacity: 1, width: "auto" }}
                    exit={{ opacity: 0, width: 0 }}
                    className="text-sm whitespace-nowrap overflow-hidden truncate"
                  >
                    {item.label}
                  </motion.span>
                )}
              </AnimatePresence>
            </button>
          );
        })}
      </nav>

      {/* Bottom spacer */}
      <div className="p-3 ds-divider-t">
        {!collapsed && (
          <div className="text-[10px] text-center ds-text-muted">
            {t("app_bookmarkForge", { defaultValue: "BookmarkForge" })}
          </div>
        )}
      </div>
    </aside>
    </RouteErrorBoundary>
  );
};

export { Sidebar };
