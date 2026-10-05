import { useState, useEffect } from "react";
import { Link as LinkIcon, FileText, ChevronRight } from "lucide-react";
import { initDB } from "../container/database";
import { useTranslation } from "react-i18next";
import type { DocumentDocument } from "../db/types";
import { useGuardedDataLoad } from "../hooks/useGuardedDataLoad";

interface BacklinksProps {
  documentId: string;
  onSelect: (id: string) => void;
}

export const Backlinks = ({ documentId, onSelect }: BacklinksProps) => {
  const { t } = useTranslation();
  const [links, setLinks] = useState<DocumentDocument[]>([]);
  // autoLoad: false — the effect resets the list BEFORE fetching so a
  // document switch never shows the previous document's backlinks while the
  // new fetch is in flight (the original setLinks([]) at effect start).
  const { load } = useGuardedDataLoad<DocumentDocument[]>(
    async () => {
      const db = await initDB();
      // Find documents where 'links' array contains the current documentId
      return db.documents
        .find({
          selector: {
            links: { $in: [documentId] },
          },
        })
        .exec();
    },
    {
      autoLoad: false,
      onSuccess: (results) => setLinks(results),
      onError: () => setLinks([]),
    },
  );

  useEffect(() => {
    setLinks([]);
    void load();
  }, [documentId, load]);

  if (links.length === 0) {
    return null;
  }

  return (
    <div className="mt-12 pt-8 border-t border-[var(--divider)] dark:border-[var(--divider)]">
      <div className="flex items-center gap-2 mb-6 text-[var(--text-muted)]">
        <LinkIcon className="size-4" />
        <h3 className="text-sm font-semibold uppercase tracking-wider">
          {t("app_backlinks")} ({links.length})
        </h3>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {links.map((doc) => (
          <div
            key={doc.id}
            onClick={() => onSelect(doc.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(doc.id);
              }
            }}
            role="button"
            tabIndex={0}
            className="group flex items-center gap-4 p-4 bg-[var(--bg-secondary)] dark:bg-[var(--bg-primary)]/50 border border-[var(--divider)] dark:border-[var(--divider)] rounded-xl ds-ghost-btn hover:border-cyan-500/50 transition-all cursor-pointer"
          >
            <div className="p-2 bg-white dark:bg-[var(--bg-card)] rounded-lg text-[var(--text-muted)] group-hover:text-cyan-500 transition-colors">
              <FileText className="size-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-[var(--text-primary)] dark:text-[var(--text-accent)] truncate">
                {doc.title}
              </p>
              <p className="text-xs text-[var(--text-muted)] truncate">
                {doc.textContent?.substring(0, 60)}...
              </p>
            </div>
            <ChevronRight className="rtl-flip size-4 text-[var(--text-secondary)] dark:text-[var(--text-secondary)] group-hover:translate-x-1 transition-transform" />
          </div>
        ))}
      </div>
    </div>
  );
};
