import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate, useLocation } from "react-router";
import { logger } from "../utils/logger";
import { safeGet, safeSet } from "../store/safeStorage";

export type TabType =
  | "dashboard"
  | "editor"
  | "documents"
  | "bookmarks"
  | "chat"
  | "graph"
  | "canvas"
  | "shared"
  | "chatLocal"
  | "analytics"
  | "collaboration"
  | "voiceLocal"
  | string;

interface UseTabManagerReturn {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  currentDocId: string;
  setCurrentDocId: (id: string) => void;
}

const STORAGE_KEY = "bookmarkforge_current_doc_id";
const DEFAULT_DOC_ID = "doc-1";

export const useTabManager = (): UseTabManagerReturn => {
  const navigate = useNavigate();
  const location = useLocation();

  // Memoize active tab computation
  // P74: `/app` is the canonical app entry (the root `/` 301s to the
  // landing page in production, so the app lives at /app). Both map to
  // the dashboard tab.
  const activeTab = useMemo<TabType>(() => {
    if (location.pathname === "/" || location.pathname === "/app") {
      return "dashboard";
    }
    const path = location.pathname.substring(1).split("/")[0];
    return path as TabType;
  }, [location.pathname]);

  const setActiveTab = useCallback(
    (tab: TabType) => {
      if (!tab || typeof tab !== "string") {
        logger.warn("[useTabManager] Invalid tab provided:", tab);
        return;
      }

      if (tab === "dashboard") {
        navigate("/app");
      } else {
        navigate(`/${tab}`);
      }
    },
    [navigate],
  );

  const [currentDocId, setCurrentDocIdState] = useState<string>(() => {
    try {
      return safeGet(STORAGE_KEY) || DEFAULT_DOC_ID;
    } catch (_err) {
      // Fallback when localStorage is unavailable
      return DEFAULT_DOC_ID;
    }
  });

  const setCurrentDocId = useCallback((id: string) => {
    if (!id || typeof id !== "string") {
      logger.warn("[useTabManager] Invalid doc ID provided:", id);
      return;
    }

    setCurrentDocIdState(id);
    try {
      safeSet(STORAGE_KEY, id);
    } catch (error) {
      logger.warn(
        "[useTabManager] Failed to save doc ID to localStorage:",
        error,
      );
    }
  }, []);

  // Sync with localStorage changes from other tabs
  useEffect(() => {
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY && event.newValue) {
        setCurrentDocIdState(event.newValue);
      }
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  return {
    activeTab,
    setActiveTab,
    currentDocId,
    setCurrentDocId,
  };
};
