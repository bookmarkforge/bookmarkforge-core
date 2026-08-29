import { useEffect } from "react";
import { generateId } from "../utils/id";
import { hashString } from "../utils/crypto-core";
import { toast } from "sonner";
import { initDB } from "../db/database";
import type { BookmarkDocType } from "../db/schema";
import { TabType } from "./useTabManager";
import { logger } from "../utils/logger";

interface ClipperMessage {
  type: "clipper-add";
  data: {
    title: string;
    url?: string;
    [key: string]: unknown;
  };
}

export const useClipperSync = (
  lastMessage: unknown | null,
  t: (key: string) => string,
  setCurrentDocId: (id: string) => void,
  setActiveTab: (tab: TabType) => void,
) => {
  useEffect(() => {
    if (
      lastMessage &&
      typeof lastMessage === "object" &&
      "type" in lastMessage &&
      (lastMessage as { type: string }).type === "clipper-add"
    ) {
      const msg = lastMessage as ClipperMessage;
      const data = msg.data;
      if (typeof data?.title !== "string" || data.title.trim().length === 0) {
        logger.warn("[ClipperSync] Rejected clipper message: missing title");
        return;
      }
      const url =
        typeof data.url === "string" && data.url.trim().length > 0
          ? data.url.trim()
          : "";
      if (url && !/^https?:\/\//i.test(url)) {
        logger.warn("[ClipperSync] Rejected clipper message: invalid url");
        return;
      }
      const saveClipperData = async () => {
        const db = await initDB();
        await db.bookmarks.insert({
          id: generateId(),
          title: data.title.slice(0, 500),
          url,
          urlHash: await hashString(url),
          summary: t("clippedFromWeb"),
          tags: ["clipped"],
          isPrivate: false,
          isDeleted: false,
          processed: true,
          embedding: [],
          relatedLinks: [],
          visitCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } as BookmarkDocType);
        toast.success(t("app_bookmarksTitle") + ": " + data.title);
      };
      saveClipperData();
    }
  }, [lastMessage, t, setCurrentDocId, setActiveTab]);
};
