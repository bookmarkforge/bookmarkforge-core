import { useState } from "react";
import { generateImage } from "../services/imageService";
import { Image as ImageIcon, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { logger } from "../utils/logger";
import { useGuardedAction } from "../hooks/useGuardedAction";

export const ImageGenerator = ({
  onImageGenerated,
}: {
  onImageGenerated: (imageUrl: string) => void;
}) => {
  const [showPrompt, setShowPrompt] = useState(false);
  const [promptText, setPromptText] = useState("");
  const { t } = useTranslation();
  // blockReentry false: two fast clicks launch two generations and the
  // second invalidates the first (like begin() did) — the late result
  // of the first is discarded.
  const { run: runGenerate, isRunning: loading } = useGuardedAction<string>({
    blockReentry: false,
    onSuccess: (imageUrl) => {
      onImageGenerated(imageUrl);
      setPromptText("");
    },
    onError: (error) => {
      logger.error(error);
      toast.error(t("app_errorGeneratingImage"));
    },
  });

  const handleGenerate = () => {
    if (!promptText.trim()) {return;}
    setShowPrompt(false);
    void runGenerate(() => generateImage(promptText));
  };

  const handleClick = () => {
    setShowPrompt(true);
    setPromptText("");
  };

  return (
    <>
      {showPrompt && (
        <div className="ds-modal-overlay z-[600] p-4">
          <div className="w-full max-w-md shadow-2xl p-6 animate-in zoom-in-95 duration-150 ds-radius-card ds-bg-card ds-border ds-text-primary">
            <h3 className="text-lg font-semibold mb-4 ds-text-primary line-clamp-2">
              {t("generateImage")}
            </h3>
            <textarea
              autoFocus
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleGenerate();
                }
              }}
              placeholder={t("enterImageDescription")}
              rows={3}
              aria-label={t("enterImageDescription")}
              className="w-full px-4 py-3 text-sm outline-none transition-all resize-none mb-4 ds-radius-button ds-bg-input ds-border-inactive ds-text-primary"
            />
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowPrompt(false)}
                data-testid="modal-cancel-btn"
                className="truncate px-4 py-2 text-sm font-semibold transition-colors ds-radius-button ds-bg-secondary ds-text-secondary ds-border-inactive"
              >
                {t("app_cancel", "Cancel")}
              </button>
              <button
                onClick={handleGenerate}
                disabled={loading || !promptText.trim()}
                data-testid="modal-generate-btn"
                className="truncate px-4 py-2 text-sm font-bold transition-colors disabled:opacity-50 ds-radius-button ds-bg-accent-primary ds-text-white"
              >
                {loading ? t("generating") : t("generateImage")}
              </button>
            </div>
          </div>
        </div>
      )}
      <button
        onClick={handleClick}
        disabled={loading}
        className="truncate flex items-center gap-2 px-4 py-2 bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)] rounded-lg hover:bg-[var(--state-hover-bg)] dark:hover:bg-[var(--state-hover-bg)] transition-colors disabled:opacity-50"
        title={t("generateImage")}
      >
        {loading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <ImageIcon className="size-4" />
        )}
        <span>{loading ? t("generating") : t("generateImage")}</span>
      </button>
    </>
  );
};
