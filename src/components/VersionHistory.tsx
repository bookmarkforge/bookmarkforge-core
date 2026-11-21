import { useState, useEffect } from "react";
import { initDB } from "../container/database";
import { History, RotateCcw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatDate } from "../utils/localization";
import type { RxDocument } from "rxdb";
import type { VersionDocType } from "../db/schema";
import { Modal } from "@mantine/core";
import { useGuardedDataLoad } from "../hooks/useGuardedDataLoad";

type VersionDocument = RxDocument<VersionDocType>;

interface Version {
  id: string;
  documentId: string;
  blocks: unknown[];
  createdAt: string;
}

export const VersionHistory = ({
  documentId,
  onRestore,
  onClose,
}: {
  documentId: string;
  onRestore: (blocks: unknown[]) => void;
  onClose: () => void;
}) => {
  const { t, i18n } = useTranslation();
  const [versions, setVersions] = useState<Version[]>([]);
  const [pendingRestore, setPendingRestore] = useState<Version | null>(null);
  // autoLoad: false — the load must reset the list/pendingRestore BEFORE
  // fetching, so switching documents never shows the previous document's
  // versions while the new fetch is in flight (the original effect's
  // setVersions([])/setPendingRestore(null) at start).
  const { load, loading } = useGuardedDataLoad<Version[]>(
    async () => {
      const db = await initDB();
      const docs = await db.versions
        .find({
          selector: { documentId },
          sort: [{ createdAt: "desc" }],
        })
        .exec();
      return docs.map((d: VersionDocument) => d.toJSON() as unknown as Version);
    },
    {
      autoLoad: false,
      onSuccess: (docs) => setVersions(docs),
      onError: () => setVersions([]),
    },
  );

  useEffect(() => {
    setVersions([]);
    setPendingRestore(null);
    void load();
  }, [documentId, load]);

  const handleRestore = (version: Version) => {
    setPendingRestore(version);
  };

  const confirmRestore = () => {
    if (pendingRestore) {
      onRestore(pendingRestore.blocks);
      setPendingRestore(null);
    }
  };

  return (
    <div className="fixed inset-y-0 end-0 w-full sm:w-80 md:w-96 bg-white dark:bg-[var(--bg-primary)] border-l border-[var(--divider)] dark:border-[var(--divider)] shadow-2xl z-50 flex flex-col animate-in slide-in-from-right duration-300">
      <div className="p-4 border-bottom border-[var(--divider)] dark:border-[var(--divider)] flex items-center justify-between">
        <div className="flex items-center gap-2 font-semibold">
          <History className="size-4 text-[var(--text-muted)]" />
          {t("app_versionHistory")}
        </div>
        <button
          onClick={onClose}
          className="p-1 hover:bg-[var(--state-hover-bg)] dark:hover:bg-[var(--state-hover-bg)] rounded-md"
          aria-label={t("app_close", "Close")}
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {loading ? (
          <div className="text-sm text-[var(--text-muted)] animate-pulse">
            {t("app_loadingHistory")}
          </div>
        ) : versions.length === 0 ? (
          <div className="text-sm text-[var(--text-muted)] text-center py-8">
            {t("app_noVersionsYet")}
          </div>
        ) : (
          versions.map((v) => (
            <div
              key={v.id}
              className="p-3 border border-[var(--divider)] dark:border-[var(--divider)] rounded-lg hover:border-blue-500 transition-colors group"
            >
              <div className="text-xs text-[var(--text-muted)] mb-1">
                {formatDate(v.createdAt, {
                  year: "numeric",
                  month: "numeric",
                  day: "numeric",
                  hour: "numeric",
                  minute: "numeric",
                  second: "numeric",
                }, i18n.language)}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">
                  {t("app_savedVersion")}
                </span>
                <button
                  onClick={() => handleRestore(v)}
                  className="p-1.5 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-md opacity-0 group-hover:opacity-100 transition-opacity"
                  title={t("app_restoreThisVersion")}
                >
                  <RotateCcw className="size-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="p-4 text-[10px] text-[var(--text-muted)] text-center border-t border-[var(--divider)] dark:border-[var(--divider)]">
        {t("app_autoSaveNote")}
      </div>
      <Modal
        opened={pendingRestore !== null}
        onClose={() => setPendingRestore(null)}
        title={t("app_confirm", "Confirm")}
        centered
      >
        <p className="text-sm ds-text-secondary mb-5">
          {t("app_confirmRestore")}
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="truncate px-3 py-2 text-sm ds-ghost-btn ds-radius-button"
            onClick={() => setPendingRestore(null)}
          >
            {t("app_cancel", "Cancel")}
          </button>
          <button
            type="button"
            className="truncate px-3 py-2 text-sm ds-radius-button bg-[var(--accent-primary)] text-[var(--text-on-accent)]"
            onClick={confirmRestore}
          >
            {t("app_confirm", "Confirm")}
          </button>
        </div>
      </Modal>
    </div>
  );
};
