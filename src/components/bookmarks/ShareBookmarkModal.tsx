import React, { useEffect } from "react";
import { X, Share2 } from "lucide-react";
import { Bookmark } from "../../types";
import { useFocusTrap } from "../../hooks/useFocusTrap";

interface ShareBookmarkModalProps {
  sharingBookmark: Bookmark | null;
  shareEmail: string;
  setShareEmail: (_email: string) => void;
  setSharingBookmark: (_bookmark: Bookmark | null) => void;
  handleShare: (_e: React.FormEvent) => void;
  t: (key: string, options?: unknown) => string;
}

export const ShareBookmarkModal = ({
  sharingBookmark,
  shareEmail,
  setShareEmail,
  setSharingBookmark,
  handleShare,
  t,
}: ShareBookmarkModalProps) => {
  // Modal dialog semantics — WCAG 4.1.2 + 2.1.2 (same pattern as
  // BookmarkReaderModal/ConflictResolver). The component only mounts while
  // sharingBookmark is set, so the trap is always active here.
  const dialogRef = useFocusTrap(true);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setSharingBookmark(null);
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [setSharingBookmark]);

  return (
    <div className="ds-modal-overlay z-50 p-4 animate-in fade-in duration-200">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-bookmark-title"
        tabIndex={-1}
        className="w-full max-w-md shadow-2xl overflow-hidden ds-radius-card ds-bg-card ds-border"
      >
        <div className="flex items-center justify-between p-6 ds-divider-b">
          <h3
            id="share-bookmark-title"
            className="text-lg font-medium ds-text-primary line-clamp-2"
          >
            {t("app_shareBookmark")}
          </h3>
          <button
            onClick={() => setSharingBookmark(null)}
            aria-label={t("app_close") || "Close"}
            className="transition-colors"
          >
            <X className="size-5 ds-text-muted" />
          </button>
        </div>
        <form onSubmit={handleShare} className="p-6 flex flex-col gap-4">
          <div>
            <span className="block text-sm font-medium mb-2 ds-text-secondary">
              {t("app_recipientEmail")}
            </span>
            <input
              id="share-email"
              type="email"
              aria-label={t("app_recipientEmail")}
              required
              value={shareEmail}
              onChange={(e) => setShareEmail(e.target.value)}
              placeholder={t("app_recipientEmailPlaceholder")}
              className="w-full px-4 py-2.5 text-sm outline-none ds-radius-button ds-bg-input ds-border-inactive ds-text-primary"
            />
          </div>
          <div className="p-3 mt-2 ds-radius-button ds-bg-secondary ds-border">
            <p className="text-xs mb-1 ds-text-secondary">
              {t("app_preview")}:
            </p>
            <p className="text-sm font-medium truncate ds-text-primary">
              {sharingBookmark?.title}
            </p>
            <p className="text-xs truncate ds-text-muted">
              {sharingBookmark?.url}
            </p>
          </div>
          <div className="flex justify-end gap-3 mt-4">
            <button
              type="button"
              onClick={() => setSharingBookmark(null)}
              className="truncate px-4 py-2 text-sm font-medium transition-colors ds-text-secondary"
            >
              {t("app_cancel")}
            </button>
            <button
              type="submit"
              className="truncate text-white px-4 py-2 text-sm font-medium transition-colors flex items-center gap-2 ds-radius-button ds-bg-accent-primary"
            >
              <Share2 className="size-4" />
              {t("app_sendEmail")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
