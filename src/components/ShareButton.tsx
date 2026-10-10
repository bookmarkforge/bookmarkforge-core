import { useState, useRef, useEffect } from "react";
import type { Block } from "@blocknote/core";
import { Check, Loader2, Globe, QrCode, X, Copy } from "lucide-react";
import { toast } from "sonner";
import LZString from "lz-string";
import { useTranslation } from "react-i18next";
import QRCode from "react-qr-code";
import { logger } from "../utils/logger";
import { hashString } from "../utils/crypto-core";
import { useGuardedAction } from "../hooks/useGuardedAction";

interface ShareButtonProps {
  documentId: string;
  title: string;
  content: Block[];
}

export const ShareButton = ({
  documentId: _documentId,
  title,
  content,
}: ShareButtonProps) => {
  const [isCopied, setIsCopied] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const { t } = useTranslation();
  const copyTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const {
    run: runShare,
    isRunning: isSharing,
  } = useGuardedAction<void>({
    onSuccess: () => {
      setShareUrl(generatedUrlRef.current);
      setShowModal(true);
    },
    onError: (error) => {
      logger.error("Failed to generate share link:", error);
      toast.error(
        t("app_shareError", { defaultValue: "Failed to generate share link" }),
      );
    },
  });
  // The share URL is produced inside the operation and read by onSuccess at
  // resolve time (through the ref, so run stays stable across renders).
  const generatedUrlRef = useRef("");
  // Copy keeps its own guard (independent of share): a new share during the
  // 3s "copied" window must not suppress the indicator reset, and clipboard
  // failures stay silent — both match the previous single-guard behavior.
  const { run: runCopy } = useGuardedAction<void>({
    onSuccess: () => {
      setIsCopied(true);
      toast.success(
        t("app_linkCopied", { defaultValue: "Share link copied to clipboard!" }),
      );
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setIsCopied(false), 3000);
    },
  });

  useEffect(() => {
    return () => clearTimeout(copyTimerRef.current);
  }, []);

  const handleShare = () => {
    if (isSharing) {return;}
    void runShare(async () => {
      const APP_SALT = "bookmarkforge-share-v1";
      const payload = {
        title,
        content,
        timestamp: Date.now(),
      };
      const payloadStr = JSON.stringify(payload);
      const integrity = await hashString(payloadStr + APP_SALT);

      const data = { ...payload, integrity };

      const compressed = LZString.compressToEncodedURIComponent(
        JSON.stringify(data),
      );

      // Generate shareable URL (using current origin)
      const generatedUrl = `${window.location.origin}/#/shared?data=${compressed}`;

      // Closing/unmounting invalidates the request; a late hash must not
      // open the modal or surface toasts for a component that is gone
      // (the guard drops onSuccess after unmount/newer request).
      generatedUrlRef.current = generatedUrl;

      // Check URL length (browsers typically support up to 2048 chars)
      if (generatedUrl.length > 2000) {
        toast.warning(
          t("app_shareUrlTooLong", {
            defaultValue:
              "Document is too large to share via URL. Only partial content may be shared.",
          }),
        );
      }
    });
  };

  const copyToClipboard = () => {
    // Clipboard failures are not actionable here; the user can retry copy
    // (no onError → no toast, matching the previous silent catch).
    void runCopy(async () => {
      await navigator.clipboard.writeText(shareUrl);
    });
  };

  return (
    <>
      <button
        onClick={handleShare}
        disabled={isSharing}
        className="truncate flex items-center gap-2 px-3 py-1.5 rounded-lg transition-all text-sm font-medium bg-cyan-50 dark:bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 hover:bg-cyan-100 dark:hover:bg-cyan-500/20"
        title={t("app_shareDocument", { defaultValue: "Share Document" })}
      >
        {isSharing ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <QrCode className="size-4" />
        )}
        <span className="hidden sm:inline">
          {t("app_publish", { defaultValue: "Publish" })}
        </span>
      </button>

      {showModal && (
        <div className="ds-modal-overlay z-50 p-4 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[var(--bg-primary)] rounded-2xl shadow-2xl w-full max-w-sm max-h-[80vh] overflow-y-auto border border-[var(--divider)] dark:border-[var(--divider)] animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between p-4 border-b border-[var(--divider)] dark:border-[var(--divider)] bg-[var(--bg-secondary)]/50 dark:bg-[var(--bg-card)]/50">
              <h3 className="font-semibold text-[var(--text-primary)] dark:text-[var(--text-accent)] flex items-center gap-2 min-w-0 line-clamp-2">
                <Globe className="size-4 text-cyan-500" />
                {t("app_shareDocument", { defaultValue: "Share Document" })}
              </h3>
              <button
                onClick={() => setShowModal(false)}
                className="p-1 rounded-md hover:bg-[var(--state-hover-bg)] dark:hover:bg-[var(--state-hover-bg)] text-[var(--text-muted)] transition-colors"
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="p-6 flex flex-col items-center">
              <div className="bg-white p-4 rounded-xl shadow-inner border border-[var(--divider)] mb-6 transition-transform hover:scale-105 duration-300">
                <QRCode
                  value={shareUrl}
                  size={200}
                  level="L"
                  fgColor={t("app_qrFgColor", "#09090b")}
                  bgColor={t("app_qrBgColor", "#ffffff")}
                />
              </div>

              <p className="text-sm text-center text-[var(--text-muted)] dark:text-[var(--text-muted)] mb-4 leading-relaxed">
                {t("app_scanQrToOpen", {
                  defaultValue:
                    "Scan this QR code with your phone camera to open this document instantly, no internet required.",
                })}
              </p>

              <div className="w-full relative group">
                <input
                  type="text"
                  aria-label={t("app_shareUrl")}
                  readOnly
                  value={shareUrl}
                  className="w-full text-xs font-mono bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)] border border-[var(--divider)] dark:border-[var(--divider)] rounded-lg py-2.5 ps-3 pe-10 text-[var(--text-secondary)] dark:text-[var(--text-secondary)] focus:outline-none focus:ring-2 focus:ring-cyan-500/50 transition-all cursor-text selection:bg-cyan-500/30"
                  onClick={(e) => e.currentTarget.select()}
                />
                <button
                  onClick={copyToClipboard}
                  className="truncate absolute right-1.5 top-1.5 p-1.5 rounded-md hover:bg-[var(--state-hover-bg)] dark:hover:bg-[var(--state-hover-bg)] text-[var(--text-muted)] transition-colors"
                  title={t("app_copyLink", { defaultValue: "Copy link" })}
                >
                  {isCopied ? (
                    <Check className="size-4 ds-text-success" />
                  ) : (
                    <Copy className="size-4" />
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
