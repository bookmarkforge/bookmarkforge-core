import React from "react";
import { Database, Download, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatDate } from "../../../utils/localization";
import i18n from "../../../i18n";

interface RemoteFile {
  id: string;
  name: string;
  modifiedTime?: string;
}

interface RestoreListProps {
  files: RemoteFile[];
  isLoading: boolean;
  isRestoring: boolean;
  onRestore: (fileId: string, fileName: string) => void;
  t: ReturnType<typeof useTranslation>["t"];
}

export const RestoreList: React.FC<RestoreListProps> = ({
  files,
  isLoading,
  isRestoring,
  onRestore,
  t,
}) => {
  if (files.length === 0) {return null;}

  return (
    <div className="space-y-3 p-5 bg-[var(--bg-secondary)] dark:bg-[var(--bg-primary)]/40 rounded-2xl border border-[var(--divider)] dark:border-[var(--divider)]/80 shadow-inner">
      <h4 className="text-xs font-bold text-[var(--text-secondary)] dark:text-[var(--text-secondary)] flex items-center gap-1.5 uppercase tracking-wider">
        <Database className="size-3.5 text-cyan-500" />{" "}
        {t("restoreFromCloud", "Restore from Cloud")}
      </h4>
      <p className="text-xs text-[var(--text-muted)] leading-relaxed">
        {t(
          "restoreDescription",
          "We found encrypted backups in your cloud. Click one to download and restore your local data.",
        )}
      </p>
      <div className="space-y-2 mt-2 max-h-48 overflow-y-auto custom-scrollbar">
        {isLoading ? (
          <div className="flex items-center justify-center py-6 text-[var(--text-muted)] text-xs gap-2">
            <Loader2 className="size-4 animate-spin text-cyan-500" />
            {t("loadingBackups", "Loading backups from cloud...")}
          </div>
        ) : (
          files.map((file) => (
            <div
              key={file.id}
              className="flex items-center justify-between p-3 bg-white dark:bg-[var(--bg-primary)]/60 border border-[var(--divider)] dark:border-[var(--divider)] rounded-xl hover:border-cyan-500/20 transition-all"
            >
              <div className="space-y-0.5">
                <p className="text-xs font-bold text-[var(--text-secondary)] dark:text-[var(--text-muted)] truncate max-w-xs">
                  {file.name}
                </p>
                <p className="text-[10px] font-medium text-[var(--text-muted)]">
                  {file.modifiedTime
                    ? formatDate(file.modifiedTime, { year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }, i18n.language)
                    : t("unknownDate", "Fecha desconocida")}
                </p>
              </div>
              <button
                onClick={() => onRestore(file.id, file.name)}
                disabled={isRestoring}
                className="truncate px-3.5 py-1.5 bg-[var(--bg-secondary)] hover:bg-cyan-50 dark:bg-[var(--bg-card)] dark:hover:bg-cyan-950/20 border border-[var(--divider)] dark:border-[var(--divider)] text-[var(--text-secondary)] dark:text-cyan-400 hover:text-cyan-600 rounded-lg text-xs font-bold transition-all flex items-center gap-1 hover:scale-105 active:scale-95 disabled:opacity-50"
              >
                <Download className="size-3" /> {t("restore", "Restore")}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
