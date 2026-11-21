/**
 * WatchedFolderSection.tsx — Settings card for the local watched folder
 * (File System Access API, Chromium). Lets the user pick a folder, see its
 * status, trigger a manual scan and disconnect it.
 */
import React, { useCallback, useEffect, useState } from "react";
import { FolderOpen, FolderSearch, Loader2, RefreshCw, Unlink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  watchedFolderService,
  type WatchedFolderInfo,
  type WatchedFolderScanResult,
} from "../../features/quick-capture/watchedFolder";

export const WatchedFolderSection: React.FC = () => {
  const { t } = useTranslation();
  const [info, setInfo] = useState<WatchedFolderInfo>({
    supported: false,
    configured: false,
  });
  const [busy, setBusy] = useState<"pick" | "scan" | "clear" | null>(null);

  const refresh = useCallback(async () => {
    try {
      setInfo(await watchedFolderService.getInfo());
    } catch {
      setInfo({ supported: false, configured: false });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handlePick = async () => {
    setBusy("pick");
    try {
      const picked = await watchedFolderService.pickFolder();
      if (picked) {
        toast.success(
          t("app_watchedFolderLinked", "Folder linked: {{name}}", {
            name: picked.name,
          }),
        );
      }
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const handleScan = async () => {
    setBusy("scan");
    try {
      const result: WatchedFolderScanResult = await watchedFolderService.scan();
      if (result.imported > 0) {
        toast.success(
          t("app_watchedFolderImported", "Imported {{count}} file(s)", {
            count: result.imported,
          }),
        );
      } else if (result.failed > 0) {
        toast.error(t("app_watchedFolderScanFailed", "Scan finished with errors"));
      } else {
        toast(t("app_watchedFolderNothingNew", "No new files found"));
      }
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const handleClear = async () => {
    setBusy("clear");
    try {
      await watchedFolderService.clearFolder();
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  if (!info.supported) {
    return null;
  }

  return (
    <section className="rounded-xl border border-[var(--divider)] p-4 space-y-3">
      <div className="flex items-center gap-2">
        <FolderSearch className="size-4 text-cyan-500" />
        <h3 className="text-sm font-semibold">
          {t("app_watchedFolderTitle", "Watched folder")}
        </h3>
      </div>
      <p className="text-xs text-[var(--text-muted)]">
        {t(
          "app_watchedFolderDesc",
          "Import new .md, .txt and .html files from a folder on this device into your encrypted vault. Nothing is uploaded.",
        )}
      </p>
      {info.configured ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="inline-flex items-center gap-1.5 text-[var(--text-primary)]">
            <FolderOpen className="size-4" />
            {info.name}
            {info.permission === "prompt" && (
              <span className="text-xs text-amber-500">
                ({t("app_watchedFolderNeedsPermission", "needs permission")})
              </span>
            )}
          </span>
          <button
            onClick={handleScan}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 text-white text-xs font-medium max-w-56"
          >
            {busy === "scan" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            <span className="truncate">{t("app_watchedFolderScan", "Scan now")}</span>
          </button>
          <button
            onClick={handleClear}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--divider)] hover:bg-white/5 disabled:opacity-50 text-xs max-w-56"
          >
            {busy === "clear" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Unlink className="size-3.5" />
            )}
            <span className="truncate">{t("app_watchedFolderRemove", "Remove")}</span>
          </button>
        </div>
      ) : (
        <button
          onClick={handlePick}
          disabled={busy !== null}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 text-white text-xs font-medium max-w-56"
        >
          {busy === "pick" ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <FolderOpen className="size-3.5" />
          )}
          <span className="truncate">{t("app_watchedFolderChoose", "Choose folder")}</span>
        </button>
      )}
    </section>
  );
};
