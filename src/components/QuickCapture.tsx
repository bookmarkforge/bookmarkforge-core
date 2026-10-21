import React, { useState, useRef, useEffect } from "react";
import { Zap, Link, FileText, Send, Loader2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import i18n from "i18next";
import { metadataService } from "../services/MetadataService";
import { generateId } from "../utils/id";
import { hashString } from "../utils/crypto-core";
import { toast } from "sonner";
import { isFreeLimitError } from "../services/LicenseService";
import {
  ProUnavailableError,
  announceProUnavailable,
} from "../services/pro-access";
import { FREE_LIMITS } from "../constants/license";
import { STORAGE_KEYS } from "../constants/storage-keys";
import { safeSet } from "../store/safeStorage";
import { motion, AnimatePresence } from "motion/react";
import { logger } from "../utils/logger";
import { safeGet } from "../store/safeStorage";
import { useGuardedAction } from "../hooks/useGuardedAction";
import { generateWithPrivacy } from "../services/ai/privacy";
import { parseFencedJson } from "../utils/jsonFenceStripper";
import { FreeTierSaveHint } from "./FreeTierSaveHint";

const MAX_CAPTURE_TITLE_CHARS = 200;
const MAX_CAPTURE_SUMMARY_CHARS = 4_000;
const MAX_CAPTURE_TAGS = 8;
const MAX_CAPTURE_TAG_CHARS = 80;

function normalizeCaptureText(
  value: unknown,
  fallback: string,
  maxChars: number,
): string {
  if (typeof value !== "string") {return fallback;}
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxChars) : fallback;
}

function normalizeCaptureTags(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) {return fallback;}
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const tag of value) {
    if (typeof tag !== "string") {continue;}
    const normalized = tag.trim().slice(0, MAX_CAPTURE_TAG_CHARS);
    if (normalized && !seen.has(normalized.toLowerCase())) {
      seen.add(normalized.toLowerCase());
      tags.push(normalized);
    }
    if (tags.length >= MAX_CAPTURE_TAGS) {break;}
  }
  return tags.length > 0 ? tags : fallback;
}

/**
 * Race embedding generation against the capture UX deadline and cancel the
 * underlying worker task when the deadline wins.
 */
export async function generateEmbeddingWithTimeout(
  generateEmbedding: (
    text: string,
    signal: AbortSignal,
  ) => Promise<number[]>,
  text: string,
  parentSignal?: AbortSignal,
): Promise<number[]> {
  if (parentSignal?.aborted) {
    throw new DOMException("Capture request aborted", "AbortError");
  }

  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let onParentAbort: (() => void) | undefined;
  try {
    const timeoutResult = new Promise<number[]>((resolve) => {
      timeout = setTimeout(() => resolve([]), 3000);
    });
    const parentAbortResult = parentSignal
      ? new Promise<number[]>((_, reject) => {
          onParentAbort = () => {
            controller.abort();
            reject(new DOMException("Capture request aborted", "AbortError"));
          };
          if (parentSignal.aborted) {
            onParentAbort();
          } else {
            parentSignal.addEventListener("abort", onParentAbort, { once: true });
          }
        })
      : null;

    const operation = Promise.race(
      parentAbortResult
        ? [generateEmbedding(text, controller.signal), timeoutResult, parentAbortResult]
        : [generateEmbedding(text, controller.signal), timeoutResult],
    );
    return await operation.catch((error: unknown) => {
      if (parentSignal?.aborted) {throw error;}
      return [];
    });
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
    if (parentSignal && onParentAbort) {
      parentSignal.removeEventListener("abort", onParentAbort);
    }
    controller.abort();
  }
}

/**
 * QuickCapture component - Provides a zero-friction way to capture links and text.
 */
export const QuickCapture: React.FC = () => {
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  const [title, setTitle] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);

  // The capture pipeline races several external services (metadata fetch, AI
  // summary, hierarchy suggestion, embeddings) against the user closing the
  // panel or unmounting. Each step degrades gracefully on failure but must
  // stop at the next await boundary once the guard's signal aborts —
  // useGuardedAction + runWithSignal, with the success toast keyed off the
  // kind that was actually captured.
  const {
    runWithSignal: runCapture,
    isRunning: isProcessing,
    cancel: cancelCapture,
  } = useGuardedAction<"bookmark" | "note">({
    onSuccess: (kind) => {
      toast.success(
        t(kind === "bookmark" ? "app_bookmarkCaptured" : "app_noteCaptured"),
      );
      setInput("");
      setTitle("");
      setIsOpen(false);
    },
    onError: (error) => {
      // The guard's signal abort invalidates the generation first, so an
      // AbortError can never reach onError while current — keep the explicit
      // check for parity with the original silent-abort handling.
      if (
        (error instanceof Error || error instanceof DOMException) &&
        error.name === "AbortError"
      ) {
        return;
      }
      logger.error("Quick capture error:", error);
      if (isFreeLimitError(error)) {
        // The wall, made visible: this replaces the old generic
        // "capture failed" toast that discarded completed AI work with a
        // message that explains the pause and points to the one fix.
        // Every blocked attempt surfaces it — it's error feedback, not
        // marketing — but one line, single instance, ~4s, never stacking.
        toast.error(
          t(
            "app_freeLimitToast",
            "Free holds {{limit}} saves — your vault is safe; new saves pause.",
            { limit: FREE_LIMITS.maxBookmarks },
          ),
          {
            duration: 4000,
            action: {
              label: t("app_freeLimitToastAction"),
              onClick: () =>
                window.dispatchEvent(new CustomEvent("forge:open-settings")),
            },
          },
        );
        // Design doc: the wall banner's trigger is event-driven — the first
        // blocked save while at the wall opens the one full pitch on the
        // dashboard (30-day cooldown handled there via storage). The pending
        // flag survives routing: a save blocked on /bookmarks still shows
        // the banner when the user reaches the dashboard.
        safeSet(STORAGE_KEYS.FREE_TIER_WALL_HIT_PENDING, "1");
        window.dispatchEvent(new CustomEvent("bmf:free-wall-hit"));
        return;
      }
      if (error instanceof ProUnavailableError) {
        // A Pro surface was reached without access: open the shared
        // "Available in Pro" panel instead of the generic capture-error toast.
        announceProUnavailable(error);
        return;
      }
      toast.error(t("app_captureError"));
    },
  });

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const handleCapture = async () => {
    if (!input.trim()) {
      return;
    }

    await runCapture(async (signal) => {
      const isUrl = /^https?:\/\/[^\s]+$/.test(input.trim());
      const raw = input.trim();
      const userTitle = title.trim();
      const captureIsPrivate = safeGet("default_private") === "true";

      // Capture is an explicit user action. Keep database/AI services out of
      // the initial shell and fetch them only when the user actually saves a
      // note or URL. Promise.all preserves each module singleton while
      // avoiding a serial waterfall on the first capture.
      const [{ initDB }, { aiManager }, { ragEngine }, { taggingService }] =
        await Promise.all([
          import("../container/database"),
          import("../services/ai/ProviderManager"),
          import("../services/ai/RAGEngine"),
          import("../services/ai/TaggingService"),
        ]);
      const db = await initDB();
      if (signal.aborted) {
        throw new DOMException("Capture request aborted", "AbortError");
      }

      if (isUrl) {
        // Each external enrichment step degrades gracefully when offline /
        // no API key is configured, so a capture still succeeds.
        let title = raw;
        let summary = "";
        let tags: string[] = ["captured"];
        let embedding: number[] = [];
        let hierarchy = "";

        try {
          const metadata = await metadataService.fetchMetadata(raw, signal);
          title = metadata.title || raw;
          summary = metadata.description || "";
        } catch (e) {
          if (signal.aborted) {throw e;}
          logger.warn("Quick capture: metadata fetch failed, using raw URL", {
            error: e,
          });
        }
        if (signal.aborted) {
          throw new DOMException("Capture request aborted", "AbortError");
        }

        try {
          const aiResponse = await generateWithPrivacy(
            aiManager,
            { isPrivate: captureIsPrivate },
            `Summarize this content and provide 3 relevant tags in JSON format: { "summary": "...", "tags": ["...", "...", "..."] }. Content: ${title} - ${summary}`,
            "You are a knowledge management assistant. Always respond in JSON format.",
            {
              complexity: "simple",
              responseMimeType: "application/json",
              signal,
            },
          );
          try {
            const aiData = parseFencedJson<Record<string, unknown>>(aiResponse.text);
            summary = normalizeCaptureText(
              aiData.summary,
              summary,
              MAX_CAPTURE_SUMMARY_CHARS,
            );
            tags = normalizeCaptureTags(aiData.tags, tags);
          } catch (e) {
            logger.warn("Quick capture AI returned non-JSON; using fallback metadata", {
              provider: aiResponse.provider,
              error: e,
            });
          }
        } catch (e) {
          if (signal.aborted) {throw e;}
          logger.warn(
            "Quick capture: AI summarization unavailable, saving without summary",
            { error: e },
          );
        }
        if (signal.aborted) {
          throw new DOMException("Capture request aborted", "AbortError");
        }

        try {
          hierarchy = await taggingService.suggestHierarchy(
            `${title} ${summary}`,
            title,
            i18n.language as "en" | "es",
            captureIsPrivate,
            signal,
          );
        } catch (e) {
          if (signal.aborted) {throw e;}
          logger.warn("Quick capture: hierarchy suggestion failed", {
            error: e,
          });
        }
        if (signal.aborted) {
          throw new DOMException("Capture request aborted", "AbortError");
        }

        try {
          embedding = await generateEmbeddingWithTimeout(
            (text, embeddingSignal) =>
              ragEngine.generateEmbedding(text, embeddingSignal),
            `${title} ${summary} ${hierarchy}`,
            signal,
          );
        } catch (e) {
          if (signal.aborted) {throw e;}
          logger.warn(
            "Quick capture: embedding generation failed, saving without embedding",
            { error: e },
          );
        }
        if (signal.aborted) {
          throw new DOMException("Capture request aborted", "AbortError");
        }

        await db.bookmarks.insert({
          id: generateId(),
          url: raw,
          urlHash: await hashString(raw),
          title: userTitle || title,
          summary,
          tags,
          processed: true,
          embedding,
          relatedLinks: [],
          visitCount: 0,
          isPrivate: safeGet("default_private") === "true",
          isDeleted: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });

        return "bookmark" as const;
      } else {
        let title = "Quick Note";
        let tags: string[] = ["note"];
        let embedding: number[] = [];
        let hierarchy = "";

        try {
          const aiResponse = await generateWithPrivacy(
            aiManager,
            { isPrivate: captureIsPrivate },
            `Provide a short title and 3 relevant tags for this text in JSON format: { "title": "...", "tags": ["...", "...", "..."] }. Text: ${raw}`,
            "You are a knowledge management assistant. Always respond in JSON format.",
            {
              complexity: "simple",
              responseMimeType: "application/json",
              signal,
            },
          );
          try {
            const aiData = parseFencedJson<Record<string, unknown>>(aiResponse.text);
            title = normalizeCaptureText(
              aiData.title,
              title,
              MAX_CAPTURE_TITLE_CHARS,
            );
            tags = normalizeCaptureTags(aiData.tags, tags);
          } catch (e) {
            logger.warn("Quick capture AI returned non-JSON; using fallback metadata", {
              provider: aiResponse.provider,
              error: e,
            });
          }
        } catch (e) {
          if (signal.aborted) {throw e;}
          logger.warn(
            "Quick capture: AI title suggestion unavailable, using default",
            { error: e },
          );
        }
        if (signal.aborted) {
          throw new DOMException("Capture request aborted", "AbortError");
        }

        try {
          hierarchy = await taggingService.suggestHierarchy(
            raw,
            title,
            i18n.language as "en" | "es",
            captureIsPrivate,
            signal,
          );
        } catch (e) {
          if (signal.aborted) {throw e;}
          logger.warn("Quick capture: hierarchy suggestion failed", {
            error: e,
          });
        }
        if (signal.aborted) {
          throw new DOMException("Capture request aborted", "AbortError");
        }

        try {
          embedding = await generateEmbeddingWithTimeout(
            (text, embeddingSignal) =>
              ragEngine.generateEmbedding(text, embeddingSignal),
            `${raw} ${hierarchy}`,
            signal,
          );
        } catch (e) {
          if (signal.aborted) {throw e;}
          logger.warn(
            "Quick capture: embedding generation failed, saving without embedding",
            { error: e },
          );
        }
        if (signal.aborted) {
          throw new DOMException("Capture request aborted", "AbortError");
        }

        await db.documents.insert({
          id: generateId(),
          folderId: hierarchy || "root",
          title,
          blocks: [],
          textContent: raw,
          tags,
          links: [],
          embedding,
          processed: true,
          isDeleted: false,
          isPrivate: safeGet("default_private") === "true",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });

        return "note" as const;
      }
    });
  };

  const closeCapture = () => {
    cancelCapture();
    setIsOpen(false);
    // Return focus to the trigger after closing so keyboard users do not land
    // on BODY when the capture panel is dismissed.
    requestAnimationFrame(() => fabRef.current?.focus());
  };

  return (
    // On mobile the FAB must clear the fixed bottom nav (BottomNav is
    // md:hidden, z-50, rendered AFTER this component in MainApp, so at the
    // same z-index it paints on top and swallows clicks on the FAB).
    <div className="fixed bottom-20 end-4 z-50 md:bottom-4">
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="absolute bottom-12 end-0 w-[calc(100vw-2rem)] sm:w-96 shadow-2xl p-4 overflow-hidden ds-radius-card ds-bg-card ds-border"
          >
            <div className="flex items-center gap-2 mb-4">
              <Zap className="size-4 ds-text-warning" />
              <h3 className="text-sm font-semibold uppercase tracking-wider ds-text-primary line-clamp-2">
                {t("app_quickCapture")}
              </h3>
              <button
                onClick={closeCapture}
                aria-label={t("app_closeQuickCapture", "Close quick capture")}
                data-testid="close-quick-capture-button"
                className="ms-auto p-1 ds-ghost-bg ds-radius-button"
              >
                <X className="size-4 ds-text-muted" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="relative">
                <input
                  ref={inputRef}
                  type="text"
                  data-testid="quick-capture-input"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCapture()}
                  placeholder={t("app_urlPlaceholder", "Enter URL...")}
                  aria-label={t("app_urlPlaceholder", "Enter URL...")}
                  className="w-full ps-10 pe-4 py-3 border-none text-sm transition-all ds-radius-button ds-bg-input ds-text-primary"
                  disabled={isProcessing}
                />
                <div className="absolute start-3 top-1/2 -translate-y-1/2">
                  {input.startsWith("http") ? (
                    <Link className="size-4 text-blue-500" />
                  ) : (
                    <FileText className="size-4 ds-text-success" />
                  )}
                </div>
              </div>
              <div className="relative">
                <input
                  type="text"
                  data-testid="bookmark-title-input"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t("app_titlePlaceholder", "Enter title (optional)")}
                  aria-label={t("app_titlePlaceholder", "Enter title (optional)")}
                  className="w-full px-4 py-3 border-none text-sm transition-all ds-radius-button ds-bg-input ds-text-primary"
                  disabled={isProcessing}
                />
              </div>
              <FreeTierSaveHint />
              <button
                onClick={handleCapture}
                data-testid="save-bookmark-button"
                disabled={isProcessing || !input.trim()}
                aria-label={t("app_submitCapture", "Submit capture")}
                className="truncate w-full py-3 disabled:opacity-50 disabled:cursor-not-allowed transition-all ds-radius-button ds-bg-accent-primary ds-text-white font-medium flex items-center justify-center gap-2"
              >
                {isProcessing ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
                {t("app_saveBookmark", "Save Bookmark")}
              </button>
            </div>

            <p className="mt-3 text-[10px] text-center ds-text-muted">
              {t("app_captureHint")}
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      <button
        ref={fabRef}
        onClick={() => (isOpen ? closeCapture() : setIsOpen(true))}
        data-testid="add-bookmark-button"
        aria-label={
          isOpen
            ? t("app_closeQuickCapture", "Close quick capture")
            : t("app_openQuickCapture", "Open quick capture")
        }
        className="truncate size-12 rounded-full flex items-center justify-center shadow-lg transition-all hover:scale-110 active:scale-95"
        style={{
          borderRadius: "var(--radius-toggle)",
          background: isOpen ? "var(--bg-card)" : "var(--accent-primary)",
          color: isOpen ? "var(--text-primary)" : "white",
          transform: isOpen ? "rotate(45deg)" : undefined,
        }}
      >
        {isOpen ? <X className="size-5" /> : <Zap className="size-5" />}
      </button>
    </div>
  );
};
