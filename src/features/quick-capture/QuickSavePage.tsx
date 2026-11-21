/**
 * QuickSavePage.tsx — /quick-save: install surface for the BookmarkForge
 * bookmarklet. The draggable `javascript:` link captures the current page
 * (URL, title, selected text) and opens /capture with the payload in the
 * URL fragment — nothing is sent to any server.
 */
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Bookmark, MousePointerClick, Zap } from "lucide-react";
import { buildBookmarkletCode } from "./clipboard";

export const QuickSavePage: React.FC = () => {
  const { t } = useTranslation();
  const bookmarklet = useMemo(
    () => buildBookmarkletCode(window.location.origin),
    [],
  );

  return (
    <div className="max-w-2xl mx-auto p-4 md:p-8 h-full overflow-auto">
      <div className="flex items-center gap-2 mb-6">
        <Zap className="size-5 text-cyan-500" />
        <h1 className="text-xl font-semibold tracking-tight">
          {t("app_quickSaveTitle", "Quick Save")}
        </h1>
      </div>

      <p className="text-sm text-[var(--text-muted)] mb-6">
        {t(
          "app_quickSaveIntro",
          "Drag the button below to your browser's bookmarks bar. On any page, click it to send the URL, title and selected text straight into your encrypted vault.",
        )}
      </p>

      <a
        href={bookmarklet}
        draggable
        data-testid="bookmarklet-button"
        className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-cyan-600 hover:bg-cyan-700 text-white font-semibold transition-colors mb-8 select-none"
      >
        <Bookmark className="size-4" />
        {t("app_quickSaveButton", "Save to BookmarkForge")}
      </a>

      <ol className="space-y-3 text-sm text-[var(--text-primary)] list-decimal list-inside">
        <li>
          {t(
            "app_quickSaveStep1",
            "Drag the button above into your bookmarks bar.",
          )}
        </li>
        <li>
          {t(
            "app_quickSaveStep2",
            "On any webpage, select the text you want to keep (optional), then click the bookmark.",
          )}
        </li>
        <li>
          {t(
            "app_quickSaveStep3",
            "Review and save — the data goes directly into your encrypted vault. Nothing passes through our servers.",
          )}
        </li>
      </ol>

      <div className="mt-8 flex items-start gap-2 p-4 rounded-xl bg-[var(--bg-secondary,#1f2937)]/60 border border-[var(--divider)]">
        <MousePointerClick className="size-4 mt-0.5 shrink-0 text-[var(--text-muted)]" />
        <p className="text-xs text-[var(--text-muted)]">
          {t(
            "app_quickSaveTip",
            "Tip: you can also paste any URL or text anywhere inside the app (Ctrl+V) — it opens quick capture automatically.",
          )}
        </p>
      </div>
    </div>
  );
};
