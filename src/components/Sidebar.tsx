import React, { useState, useEffect, useCallback, useMemo, Suspense, lazy } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
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
  Copy,
} from "lucide-react";
import { Modal } from "@mantine/core";
import { safeGet, safeSet } from "../store/safeStorage";
import { useRxDB } from "../hooks/useRxDB";
import { useGuardedAction } from "../hooks/useGuardedAction";
import { TOUR_ID_MAP } from "../utils/browser-types";
const LazyQRCode = lazy(() => import("react-qr-code"));

const SIDEBAR_STORAGE_KEY = "bookmarkforge_sidebar_collapsed";

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

const sidebarItems = (t: TFunction) => [
  { id: "dashboard", label: t("app_dashboard"), icon: LayoutDashboard },
  { id: "documents", label: t("app_documents"), icon: FileText },
  { id: "bookmarks", label: t("app_bookmarksTitle"), icon: Bookmark },
  { id: "graph", label: t("app_graph"), icon: Share2 },
  {
    id: "canvas",
    label: t("app_canvas", { defaultValue: "Canvas" }),
    icon: LayoutDashboard,
  },
  {
    id: "database",
    label: t("app_database", { defaultValue: "Database" }),
    icon: Table,
  },
  {
    id: "kanban",
    label: t("app_kanban", { defaultValue: "Kanban" }),
    icon: Columns,
  },
  {
    id: "calendar",
    label: t("app_calendar", { defaultValue: "Calendar" }),
    icon: CalendarDays,
  },
  {
    id: "list",
    label: t("app_listView", { defaultValue: "List" }),
    icon: List,
  },
  {
    id: "gallery",
    label: t("app_galleryView", { defaultValue: "Gallery" }),
    icon: Grid3X3,
  },
  {
    id: "timeline",
    label: t("app_timelineView", { defaultValue: "Timeline" }),
    icon: History,
  },
  { id: "chatLocal", label: t("app_chatLocal"), icon: MessageSquare },
  { id: "voiceLocal", label: t("app_voiceLocal"), icon: Mic },
  { id: "collaboration", label: t("app_collaborationTitle"), icon: Users },
  { id: "analytics", label: t("app_analytics"), icon: Activity },
  {
    id: "chat",
    label: t("app_supportChat", { defaultValue: "Support" }),
    icon: HelpCircle,
  },
];

const Sidebar = function Sidebar({
  activeTab,
  setActiveTab,
}: SidebarProps) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(() => {
    return safeGet(SIDEBAR_STORAGE_KEY) === "true";
  });
  const [showShareModal, setShowShareModal] = useState(false);
  const [collectionName, setCollectionName] = useState("");
  const [shareRoomId, setShareRoomId] = useState("");
  const [shareRoomSecret, setShareRoomSecret] = useState("");
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  // generateLink and copyToClipboard each own a guard (independent — copy
  // only runs after the share link exists, so no real concurrency). The 2s
  // "copied" timer lives inside copy's onSuccess (ShareButton pattern): it
  // is cleared on unmount and reset by each new copy, so the manual-guard
  // isCurrent check it replaces was moot.
  const {
    run: runGenerate,
    isRunning: isGenerating,
  } = useGuardedAction<{ roomId: string; roomSecret: string }>({
    onStart: () => setCopied(false),
    onSuccess: ({ roomId, roomSecret }) => {
      setShareRoomId(roomId);
      setShareRoomSecret(roomSecret);
    },
    onError: () => {
      setShareRoomId("");
      setShareRoomSecret("");
    },
  });
  const { run: runCopyLink } = useGuardedAction<void>({
    onSuccess: () => {
      setCopied(true);
      if (copiedTimerRef.current) {
        clearTimeout(copiedTimerRef.current);
      }
      copiedTimerRef.current = setTimeout(() => setCopied(false), 2000);
    },
  });

  const db = useRxDB();

  useEffect(() => {
    safeSet(SIDEBAR_STORAGE_KEY, collapsed.toString());
    // Drives the Tailwind `sidebar-collapsed:` variant (content offset) and
    // the `.sidebar-collapsed .sidebar-item` rules (centered icons).
    document.documentElement.classList.toggle("sidebar-collapsed", collapsed);
  }, [collapsed]);

  // Clears the "copied" timer if the sidebar unmounts with one pending.
  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) {
        clearTimeout(copiedTimerRef.current);
        copiedTimerRef.current = null;
      }
    };
  }, []);

  const items = useMemo(() => sidebarItems(t), [t]);

  const handleNavClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      const tabId = e.currentTarget.getAttribute("data-tab-id");
      if (tabId) {setActiveTab(tabId);}
    },
    [setActiveTab],
  );

  const handleGenerateLink = useCallback(async () => {
    if (!collectionName.trim()) {return;}
    await runGenerate(async () => {
      const suffixBytes = new Uint8Array(4);
      crypto.getRandomValues(suffixBytes);
      const suffix = Array.from(suffixBytes, (b) => b.toString(16).padStart(2, "0")).join("");
      const roomId = `${collectionName.trim().replace(/\s+/g, "-")}-${suffix}`;
      const { collaborationService } =
        await import("../services/CollaborationService");
      const roomSecret = await collaborationService.start(db, roomId);
      return { roomId, roomSecret: roomSecret ?? "" };
    });
  }, [collectionName, db, runGenerate]);

  const handleCopyLink = useCallback(() => {
    const link = `${window.location.origin}/collaboration?room=${encodeURIComponent(shareRoomId)}${shareRoomSecret ? `#secret=${encodeURIComponent(shareRoomSecret)}` : ""}`;
    // Clipboard failures stay silent (no onError), matching the previous
    // try/catch that swallowed the error.
    void runCopyLink(async () => {
      await navigator.clipboard.writeText(link);
    });
  }, [shareRoomId, shareRoomSecret, runCopyLink]);

  const handleCloseModal = useCallback(() => {
    if (copiedTimerRef.current) {
      clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = null;
    }
    setShowShareModal(false);
    setCollectionName("");
    setShareRoomId("");
    setShareRoomSecret("");
    setCopied(false);
  }, []);

  const shareLink = shareRoomId
    ? `${window.location.origin}/collaboration?room=${encodeURIComponent(shareRoomId)}${shareRoomSecret ? `#secret=${encodeURIComponent(shareRoomSecret)}` : ""}`
    : "";

  return (
    <RouteErrorBoundary
      fallback={
        <div className="hidden md:flex flex-col fixed start-0 top-0 h-screen w-16 items-center justify-center ds-bg-sidebar">
          <p className="text-[10px] ds-text-muted text-center px-1">Nav error</p>
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
      <div className="p-3 ds-divider-t space-y-2">
        {!collapsed && (
          <div className="text-[10px] text-center ds-text-muted">
            {t("app_bookmarkForge", { defaultValue: "BookmarkForge" })}
          </div>
        )}
        <button
          onClick={() => setShowShareModal(true)}
          className={`truncate w-full flex items-center justify-center ds-ghost-btn ds-radius-button ${collapsed ? "p-1.5 ds-ghost-btn-icon" : "gap-2 py-1.5 px-2 text-xs"}`}
          aria-label={t("app_shareCollection", {
            defaultValue: "Share Collection",
          })}
          title={
            collapsed
              ? t("app_shareCollection", { defaultValue: "Share Collection" })
              : undefined
          }
        >
          <Share2 className="size-3.5 shrink-0" />
          {!collapsed && (
            <span className="truncate">
              {t("app_shareCollection", { defaultValue: "Share Collection" })}
            </span>
          )}
        </button>
      </div>

      <Modal
        opened={showShareModal}
        onClose={handleCloseModal}
        title={t("app_shareCollectionTitle", {
          defaultValue: "Share Collection",
        })}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">
              {t("app_collectionName", {
                defaultValue: "Collection / Folder name",
              })}
            </label>
            <input
              type="text"
              aria-label={t("app_collectionName", {
                defaultValue: "Collection / Folder name",
              })}
              value={collectionName}
              onChange={(e) => setCollectionName(e.target.value)}
              placeholder={t("app_collectionNamePlaceholder", {
                defaultValue: "e.g. Research Papers",
              })}
              className="w-full px-3 py-2 border rounded ds-bg-input ds-border-input ds-text-primary"
            />
          </div>

          <button
            onClick={handleGenerateLink}
            disabled={!collectionName.trim() || isGenerating}
            className="truncate w-full py-2 px-4 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isGenerating
              ? t("app_generating", { defaultValue: "Generating..." })
              : t("app_generateShareLink", {
                  defaultValue: "Generate Share Link",
                })}
          </button>

          {shareRoomId && (
            <div className="space-y-3 p-3 border rounded ds-border-input ds-bg-secondary">
              <p className="text-sm font-medium">
                {t("app_shareLinkLabel", { defaultValue: "Share Link" })}
              </p>
              <p className="text-xs break-all ds-text-muted select-all">
                {shareLink}
              </p>
              <div className="flex justify-center">
                <div className="size-[150px] ds-bg-card p-2 ds-border-input rounded">
                  <Suspense fallback={<div className="size-[134px] animate-pulse ds-bg-secondary rounded" />}>
                    <LazyQRCode
                      value={shareLink}
                      size={134}
                      style={{ height: "auto", maxWidth: "100%", width: "100%" }}
                      viewBox={`0 0 134 134`}
                      level="M"
                    />
                  </Suspense>
                </div>
              </div>
              <button
                onClick={handleCopyLink}
                className="truncate w-full py-2 px-4 border rounded flex items-center justify-center gap-2 ds-border-input ds-text-primary hover:ds-bg-secondary transition-colors"
              >
                <Copy className="size-4" />
                {copied
                  ? t("app_copied", { defaultValue: "Copied!" })
                  : t("app_copyLink", { defaultValue: "Copy Link" })}
              </button>
            </div>
          )}
        </div>
      </Modal>
    </aside>
    </RouteErrorBoundary>
  );
};

export { Sidebar };
export default Sidebar;
