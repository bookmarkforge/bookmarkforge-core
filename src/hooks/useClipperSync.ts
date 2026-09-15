import { useEffect } from "react";
import { generateId } from "../utils/id";
import { hashString } from "../utils/crypto-core";
import { toast } from "sonner";
import { initDB } from "../db/database";
import type { BookmarkDocType } from "../db/schema";
import { TabType } from "./useTabManager";
import { logger } from "../utils/logger";
import { isFreeLimitError } from "../services/LicenseService";
import { FREE_LIMITS } from "../constants/license";
import { STORAGE_KEYS } from "../constants/storage-keys";
import { safeSet } from "../store/safeStorage";

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
  // Options-aware: the free-limit toast interpolates {{limit}} via
  // t(key, options); the existing one-argument calls remain unchanged.
  t: (key: string, options?: Record<string, unknown>) => string,
  _setCurrentDocId: (id: string) => void,
  _setActiveTab: (tab: TabType) => void,
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
      };
      let cancelled = false;
      saveClipperData().then(() => {
        if (!cancelled) {
          toast.success(t("app_bookmarksTitle") + ": " + data.title);
        }
      }).catch((error: unknown) => {
        if (isFreeLimitError(error)) {
          // The 1,000 wall, made visible: this was INTENTIONAL SILENCE
          // before — the user clicked "save" in the extension and nothing
          // ever happened. Now the one blocked save that matters reports
          // itself with the same message as the in-app paths.
          logger.info("[ClipperSync] save blocked by free-tier wall");
          toast.error(
            t("app_freeLimitToast", { limit: FREE_LIMITS.maxBookmarks }),
            {
              id: "free-limit",
              duration: 4000,
              action: {
                label: t("app_freeLimitToastAction"),
                onClick: () =>
                  window.dispatchEvent(
                    new CustomEvent("forge:open-settings"),
                  ),
              },
            },
          );
          safeSet(STORAGE_KEYS.FREE_TIER_WALL_HIT_PENDING, "1");
          window.dispatchEvent(new CustomEvent("bmf:free-wall-hit"));
          return;
        }
        // A clipper save still needs feedback: the extension has no other
        // visible error surface, so silence makes a failed save look like
        // success. Keep the detailed error in logs, but show a short retry
        // message for failures other than the free-tier wall.
        logger.error("[ClipperSync] Failed to save clipped page", { error });
        toast.error(
          t("app_captureError"),
        );
      });
      return () => { cancelled = true; };
    }
  }, [lastMessage, t]);
};
