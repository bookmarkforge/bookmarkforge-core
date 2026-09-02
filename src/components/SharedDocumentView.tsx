import { useState, useEffect, useLayoutEffect } from "react";
import LZString from "lz-string";
import type { Block } from "@blocknote/core";
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import blockNoteStylesUrl from "@blocknote/mantine/style.css?url";

import { FileText, Download, ArrowLeft, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatDate } from "../utils/localization";
import { toast } from "sonner";
import { logger } from "../utils/logger";
import { hashString } from "../utils/crypto-core";
import { SanitizationService } from "../services/SanitizationService";
import { initDB } from "../container/database";
import { useGuardedAction } from "../hooks/useGuardedAction";

const APP_SALT = "bookmarkforge-share-v1";
const MAX_SHARE_SIZE = 500_000;

function ensureBlockNoteStyles(): void {
  if (document.querySelector('link[data-bmf="blocknote-styles"]')) {
    return;
  }
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = blockNoteStylesUrl;
  link.dataset.bmf = "blocknote-styles";
  document.head.appendChild(link);
}

interface SharedData {
  title: string;
  content: Block[];
  timestamp: number;
  /** Integrity is validated before entering state and is the stable RxDB id. */
  integrity: string;
}

const SharedDocumentEditor = ({ content }: { content: Block[] }) => {
  const editor = useCreateBlockNote({
    initialContent: content.length
      ? content
      : [{ type: "paragraph", content: "" }],
  });

  return <BlockNoteView editor={editor} editable={false} theme="light" />;
};

function sanitizeSharedBlocks(blocks: Block[]): Block[] {
  const sanitizeValue = (value: unknown, key?: string): unknown => {
    if (typeof value === "string") {
      // BlockNote stores links, images, files and embeds in URL-like
      // properties. Sanitize those properties before the editor sees them;
      // ordinary text must remain unchanged.
      const normalizedKey = key?.toLowerCase();
      if (
        normalizedKey === "url" ||
        normalizedKey === "urls" ||
        normalizedKey === "href" ||
        normalizedKey === "src"
      ) {
        return SanitizationService.sanitizeUrl(value);
      }
      return value;
    }
    if (Array.isArray(value)) {
      return value.map((item) => sanitizeValue(item, key));
    }
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([entryKey, entryValue]) => [
          entryKey,
          sanitizeValue(entryValue, entryKey),
        ]),
      );
    }
    return value;
  };

  return sanitizeValue(blocks) as Block[];
}

function isDuplicateDocumentError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as {
    code?: unknown;
    status?: unknown;
    name?: unknown;
    parameters?: { errors?: Array<{ status?: unknown }> };
  };
  return (
    candidate.code === "CONFLICT" ||
    candidate.status === 409 ||
    candidate.parameters?.errors?.some((entry) => entry.status === 409) === true
  );
}

function validateContent(raw: unknown): raw is {
  title: string;
  content: Block[];
  timestamp: number;
  integrity: string;
} {
  if (!raw || typeof raw !== "object") {return false;}
  const d = raw as Record<string, unknown>;
  return (
    typeof d.title === "string" &&
    Array.isArray(d.content) &&
    typeof d.timestamp === "number" &&
    Number.isFinite(d.timestamp) &&
    Number.isFinite(new Date(d.timestamp).getTime()) &&
    typeof d.integrity === "string" &&
    // Keep the payload within the documents collection's title limit so a
    // valid share never fails only after the user presses Save.
    d.title.length <= 500 &&
    d.content.length <= 1000 &&
    String(d.timestamp).length <= 20
  );
}

export const SharedDocumentView = ({ onBack }: { onBack: () => void }) => {
  const { t, i18n } = useTranslation();

  // The shared-document route is lazy; attach BlockNote's stylesheet only
  // after this route is actually mounted instead of making Vite emit it in
  // the initial HTML stylesheet list.
  useLayoutEffect(() => {
    ensureBlockNoteStyles();
  }, []);
  const [data, setData] = useState<SharedData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [_loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "duplicate"
  >("idle");

  const {
    run: handleSaveToLibrary,
  } = useGuardedAction<void>({
    onStart: () => setSaveState("saving"),
    onSuccess: () => {
      setSaveState("saved");
      toast.success(
        t("app_savedToLibrary", { defaultValue: "Saved to your library!" }),
      );
    },
    onError: (error) => {
      if (isDuplicateDocumentError(error)) {
        setSaveState("duplicate");
        toast.info(
          t("app_sharedAlreadySaved", {
            defaultValue: "This document is already in your library.",
          }),
        );
      } else {
        logger.error("Error saving shared document to library:", error);
        setSaveState("idle");
        toast.error(
          t("app_sharedSaveError", {
            defaultValue: "Failed to save shared document to your library.",
          }),
        );
      }
    },
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const hash = window.location.hash;
        if (!hash.startsWith("#/shared?data=")) {
          if (!cancelled) {
            setError(
              t("app_noSharedData", {
                defaultValue: "No shared data found in URL",
              }),
            );
            setLoading(false);
          }
          return;
        }
        const compressed = hash.replace("#/shared?data=", "");
        if (compressed.length > MAX_SHARE_SIZE) {
          if (!cancelled) {
            setError(
              t("app_shareTooLarge", {
                defaultValue: "Shared document is too large",
              }),
            );
            setLoading(false);
          }
          return;
        }
        const decompressed =
          LZString.decompressFromEncodedURIComponent(compressed);
        if (!decompressed) {
          if (!cancelled) {
            setError(
              t("app_invalidShareLink", {
                defaultValue: "Invalid or corrupted share link",
              }),
            );
            setLoading(false);
          }
          return;
        }
        const parsed = JSON.parse(decompressed);
        if (!validateContent(parsed)) {
          if (!cancelled) {
            setError(
              t("app_invalidShareLink", {
                defaultValue: "Invalid or corrupted share link",
              }),
            );
            setLoading(false);
          }
          return;
        }
        const computedHash = await hashString(
          JSON.stringify({
            title: parsed.title,
            content: parsed.content,
            timestamp: parsed.timestamp,
          }) + APP_SALT,
        );
        if (parsed.integrity !== computedHash) {
          if (!cancelled) {
            setError(
              t("app_invalidShareLink", {
                defaultValue: "Invalid or corrupted share link",
              }),
            );
            setLoading(false);
          }
          return;
        }
        if (!cancelled) {
          setData({
            title: parsed.title,
            content: sanitizeSharedBlocks(parsed.content),
            timestamp: parsed.timestamp,
            integrity: parsed.integrity,
          });
          setLoading(false);
        }
      } catch (e) {
        logger.error("Error parsing shared document:", e);
        if (!cancelled) {
          setError(
            t("app_errorParsingShare", {
              defaultValue: "Error parsing shared document",
            }),
          );
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center">
        <div className="size-16 bg-[var(--danger-soft)] ds-text-danger rounded-full flex items-center justify-center mb-4">
          <FileText className="size-8" />
        </div>
        <h2 className="text-xl font-semibold text-[var(--text-primary)] dark:text-white mb-2">
          {t("app_error")}
        </h2>
        <p className="text-[var(--text-muted)] mb-6">{error}</p>
        <button
          onClick={onBack}
          className="truncate px-4 py-2 bg-[var(--bg-primary)] dark:bg-white text-white dark:text-[var(--text-primary)] rounded-lg font-medium hover:opacity-90 transition-opacity"
        >
          <ArrowLeft className="rtl-flip size-4 inline me-2" />
          {t("app_goBack", { defaultValue: "Go Back" })}
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center h-full">
        <Loader2 className="size-8 animate-spin text-cyan-500 mb-4" />
        <p className="text-[var(--text-muted)] animate-pulse">
          {t("app_loadingSharedDoc", {
            defaultValue: "Loading shared document...",
          })}
        </p>
      </div>
    );
  }

  const handleSaveToLibraryClick = () =>
    handleSaveToLibrary(async () => {
      const db = await initDB();
      await db.documents.insert({
        // The integrity value was verified against the complete share payload
        // before it reached state. Using it as the primary key makes repeated
        // clicks and the same shared link opened in another tab converge on
        // one document instead of creating random duplicates.
        id: data.integrity,
        folderId: "root",
        title: data.title,
        blocks: data.content,
        tags: ["shared"],
        links: [],
        processed: false,
        isPrivate: false,
        isDeleted: false,
        createdAt: new Date(data.timestamp).toISOString(),
        updatedAt: new Date().toISOString(),
      });
    });

  return (
    <div className="flex flex-col h-full bg-white dark:bg-[var(--bg-primary)]">
      <div className="h-16 border-b border-[var(--divider)] dark:border-[var(--divider)] flex items-center justify-between px-6 bg-[var(--bg-secondary)]/50 dark:bg-[var(--bg-primary)]/50 sticky top-0 z-10">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="p-2 hover:bg-[var(--state-hover-bg)] dark:hover:bg-[var(--state-hover-bg)] rounded-lg transition-colors text-[var(--text-muted)]"
          >
            <ArrowLeft className="rtl-flip size-5" />
          </button>
          <div>
            <h1 className="text-lg font-semibold text-[var(--text-primary)] dark:text-white flex items-center gap-2">
              <FileText className="size-5 text-cyan-500" />
              {data.title}
            </h1>
            <p className="text-xs text-[var(--text-muted)]">
              {t("app_sharedOn", { defaultValue: "Shared on" })}{" "}
              {formatDate(data.timestamp, {}, i18n.language)}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleSaveToLibraryClick}
          disabled={saveState !== "idle"}
          aria-busy={saveState === "saving"}
          className="truncate flex items-center gap-2 px-4 py-2 bg-cyan-500 hover:bg-cyan-600 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors shadow-lg shadow-cyan-500/20"
        >
          <Download className="size-4" />
          {saveState === "saving"
            ? t("app_loading", { defaultValue: "Saving…" })
            : saveState === "duplicate"
              ? t("app_sharedAlreadySaved", {
                  defaultValue: "Already in Library",
                })
              : saveState === "saved"
                ? t("app_savedToLibrary", {
                    defaultValue: "Saved to your library!",
                  })
                : t("app_saveToLibrary", { defaultValue: "Save to Library" })}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-4xl mx-auto bg-white dark:bg-[var(--bg-primary)] rounded-2xl shadow-sm border border-[var(--divider)] dark:border-[var(--divider)] overflow-hidden">
          <div className="p-8 blocknote-theme-wrapper" data-theme="light">
            <SharedDocumentEditor content={data.content} />
          </div>
        </div>
      </div>
    </div>
  );
};
