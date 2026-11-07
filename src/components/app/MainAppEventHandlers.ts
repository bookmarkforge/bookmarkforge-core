import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { type TabType } from "../../hooks/useTabManager";
import { initDB } from "../../container/database";
import { generateId } from "../../utils/id";

export interface MainAppEventHandlers {
  openSettings: () => void;
  openSearch: () => void;
  handleNavigate: (tab: string) => void;
  handleSelectDocument: (id: string) => void;
  handleChatSelectSource: (type: "document" | "bookmark", id: string) => void;
  handleVoiceSearch: () => void;
  handleVoiceNavigate: (path: string) => void;
  handleVoiceAction: (action: string, params: Record<string, unknown>) => Promise<void>;
  handleOmnibarNavigate: (tab: string) => void;
  handleOmnibarAction: (action: string) => Promise<void>;
  handleSelectDocumentFromOmnibar: (id: string) => void;
  handleSelectBookmarkFromOmnibar: () => void;
}

export function useMainAppEventHandlers(
  setActiveTab: (tab: TabType) => void,
  setCurrentDocId: (id: string) => void,
  setShowOmnibar: (show: boolean) => void,
  setShowSettings: (show: boolean) => void,
  setShowAnalysis: (show: boolean) => void,
  setShowFlashcards: (show: boolean) => void,
  toggleTheme: () => void,
): MainAppEventHandlers {
  const { t } = useTranslation();

  const openSettings = () => setShowSettings(true);
  const openSearch = () => setShowOmnibar(true);

  const handleNavigate = (tab: string) => {
    setActiveTab(tab as TabType);
  };

  const handleSelectDocument = (id: string) => {
    setCurrentDocId(id);
    setActiveTab("editor");
  };

  const handleChatSelectSource = (
    type: "document" | "bookmark",
    id: string,
  ) => {
    if (type === "document") {
      setCurrentDocId(id);
      setActiveTab("editor");
    } else if (type === "bookmark") {
      setActiveTab("bookmarks");
    }
  };

  const handleVoiceSearch = () => setActiveTab("bookmarks");
  const handleVoiceNavigate = (p: string) => setActiveTab(p as TabType);
  
  const handleVoiceAction = async (action: string, params: Record<string, unknown>) => {
    const actionMap: Record<string, () => void> = {
      search: () => setShowOmnibar(true),
      bookmark: () => setActiveTab("bookmarks"),
      settings: () => setActiveTab("settings"),
      dashboard: () => setActiveTab("dashboard"),
      chat: () => setActiveTab("chat"),
    };
    const handler = actionMap[action];
    if (handler) {
      handler();
    } else if (params?.tab && typeof params.tab === "string") {
      setActiveTab(params.tab as TabType);
    }
  };

  const handleOmnibarNavigate = (tab: string) => {
    setActiveTab(tab as TabType);
    setShowOmnibar(false);
  };

  const handleOmnibarAction = async (action: string) => {
    if (action === "create_doc") {
      const db = await initDB();
      const id = generateId();
      await db.documents.insert({
        id,
        folderId: "root",
        title: t("app.untitledDocument"),
        blocks: [],
        textContent: "",
        tags: [],
        links: [],
        embedding: [],
        processed: false,
        isPrivate: false,
        isDeleted: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      setCurrentDocId(id);
      setActiveTab("editor");
    } else if (action === "toggle_theme") {
      toggleTheme();
    } else if (action === "show_analysis") {
      setShowAnalysis(true);
    } else if (action === "show_flashcards") {
      setShowFlashcards(true);
    }
    setShowOmnibar(false);
  };

  const handleSelectDocumentFromOmnibar = (id: string) => {
    setCurrentDocId(id);
    setActiveTab("editor");
    setShowOmnibar(false);
  };

  const handleSelectBookmarkFromOmnibar = () => {
    setActiveTab("bookmarks");
    setShowOmnibar(false);
  };

  return {
    openSettings,
    openSearch,
    handleNavigate,
    handleSelectDocument,
    handleChatSelectSource,
    handleVoiceSearch,
    handleVoiceNavigate,
    handleVoiceAction,
    handleOmnibarNavigate,
    handleOmnibarAction,
    handleSelectDocumentFromOmnibar,
    handleSelectBookmarkFromOmnibar,
  };
}

export function useMainAppEventListeners(
  setActiveTab: (tab: TabType) => void,
  setShowOmnibar: (show: boolean) => void,
  setShowSettings: (show: boolean) => void,
) {
  // Navigation bridge for non-router code (e.g. the startup AI hint toast in
  // AppInitializer, which mounts outside the Router): a `bmf:navigate` custom
  // event carries a `tab` that maps through setActiveTab to a route.
  useEffect(() => {
    const handleBmfNavigate = (e: Event) => {
      const tab = (e as CustomEvent<{ tab?: string }>).detail?.tab;
      if (tab && typeof tab === "string") {
        setActiveTab(tab as TabType);
      }
    };
    window.addEventListener("bmf:navigate", handleBmfNavigate);
    return () => window.removeEventListener("bmf:navigate", handleBmfNavigate);
  }, [setActiveTab]);

  useEffect(() => {
    const handleOpenSettings = () => setShowSettings(true);
    window.addEventListener("forge:open-settings", handleOpenSettings);
    return () =>
      window.removeEventListener("forge:open-settings", handleOpenSettings);
  }, [setShowSettings]);

  // Search is owned by the shell, so surfaces that want to hand the user off
  // to it (the dashboard's first-run checklist) ask for it by event instead
  // of reaching into the Omnibar's state.
  useEffect(() => {
    const handleOpenSearch = () => setShowOmnibar(true);
    window.addEventListener("forge:open-search", handleOpenSearch);
    return () =>
      window.removeEventListener("forge:open-search", handleOpenSearch);
  }, [setShowOmnibar]);

  // Whatever opened it — Ctrl+K, the sidebar, voice, the checklist — opening
  // search means the user has tried to retrieve something. That is the last
  // first-run step, so record it here, at the single place search opens.
  useEffect(() => {
    // This is handled in the MainApp component via showOmnibar state
    // markFirstRunSearchTried is called when showOmnibar becomes true
  }, []);
}