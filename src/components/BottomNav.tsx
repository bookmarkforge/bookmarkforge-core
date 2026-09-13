import {
  LayoutDashboard,
  FileText,
  Bookmark,
  MessageSquare,
  Search,
  Settings,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  BOTTOM_NAV_TAB_IDS,
  type BottomNavTabId,
} from "../constants/navigation";

interface BottomNavProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onOpenSettings: () => void;
  onOpenSearch: () => void;
}

export const BottomNav = ({
  activeTab,
  setActiveTab,
  onOpenSettings,
  onOpenSearch,
}: BottomNavProps) => {
  const { t } = useTranslation();

  // Per-tab presentation keyed by the CANONICAL tab id from
  // src/constants/navigation.ts (the same array the E2E selector gate
  // imports); Record keying enforces both drift directions at typecheck.
  const NAV_ITEM_META: Record<
    BottomNavTabId,
    { labelKey: string; icon: React.ComponentType<{ className?: string }> }
  > = {
    dashboard: { labelKey: "app_dashboard", icon: LayoutDashboard },
    documents: { labelKey: "app_documents", icon: FileText },
    bookmarks: { labelKey: "app_bookmarksTitle", icon: Bookmark },
    chatLocal: { labelKey: "app_chatLocal", icon: MessageSquare },
  };
  const navItems = BOTTOM_NAV_TAB_IDS.map((id) => ({
    id,
    label: t(NAV_ITEM_META[id].labelKey),
    icon: NAV_ITEM_META[id].icon,
  }));

  return (
    <nav
      aria-label={t("app_mainNavigation", "Main navigation")}
      data-testid="bottom-nav"
      className="md:hidden fixed bottom-0 left-0 right-0 px-4 py-2 pb-safe z-50 ds-bg-topbar ds-border-t"
    >
      <div className="flex items-center justify-between max-w-lg mx-auto">
        {navItems.map((item) => (
          <button
            key={item.id}
            data-bottom-nav-tab={item.id}
            onClick={() => setActiveTab(item.id)}
            aria-current={activeTab === item.id ? "page" : undefined}
            className={`truncate flex flex-col items-center gap-1 p-2 transition-all ${activeTab === item.id ? "ds-text-accent" : "ds-text-muted"}`}
          >
            <item.icon className="size-5" />
            <span className="truncate max-w-[4.5rem] text-[10px] font-bold uppercase tracking-tighter">
              {item.label}
            </span>
          </button>
        ))}
        <button
          onClick={onOpenSearch}
          aria-label={t("app_search", "Search")}
          className="truncate flex flex-col items-center gap-1 p-2 ds-text-muted"
        >
          <Search className="size-5" />
          <span className="truncate max-w-[4.5rem] text-[10px] font-bold uppercase tracking-tighter">
            {t("app_search")}
          </span>
        </button>
        <button
          onClick={onOpenSettings}
          aria-label={t("app_settings", "Settings")}
          className="truncate flex flex-col items-center gap-1 p-2 ds-text-muted"
        >
          <Settings className="size-5" />
          <span className="truncate max-w-[4.5rem] text-[10px] font-bold uppercase tracking-tighter">
            {t("app_settings")}
          </span>
        </button>
      </div>
    </nav>
  );
};
