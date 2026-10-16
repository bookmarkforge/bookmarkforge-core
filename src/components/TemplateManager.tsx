import { useState } from "react";
import { initDB } from "../container/database";
import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TemplateDocument } from "../db/types";
import { logger } from "../utils/logger";
import { useGuardedDataLoad } from "../hooks/useGuardedDataLoad";
import { useGuardedAction } from "../hooks/useGuardedAction";

export const TemplateManager = ({
  onApply,
}: {
  onApply: (blocks: unknown[]) => void;
}) => {
  const { t } = useTranslation();
  const [templates, setTemplates] = useState<TemplateDocument[]>([]);
  // Mount load: the guard's auto-cancel on unmount replaces the manual
  // `cancelled` flag (a late result after unmount is dropped).
  useGuardedDataLoad<TemplateDocument[]>(
    async (signal) => {
      const db = await initDB();
      if (signal.aborted) {return [];}
      return db.templates.find({ limit: 500 }).exec();
    },
    {
      onSuccess: (allTemplates) => setTemplates(allTemplates),
      onError: (err) =>
        logger.warn("[TemplateManager] Failed to load templates", err),
    },
  );

  const { run: runDelete } = useGuardedAction<TemplateDocument[]>({
    onSuccess: (all) => setTemplates(all),
    onError: (err) =>
      logger.warn("[TemplateManager] Failed to delete template", err),
  });

  const handleDelete = async (id: string) => {
    await runDelete(async () => {
      const db = await initDB();
      await db.templates.findOne(id).remove();
      return db.templates.find({ limit: 500 }).exec();
    });
  };

  const _saveAsTemplate = async (title: string, blocks: unknown[]) => {
    const db = await initDB();
    await db.templates.insert({
      id: crypto.randomUUID(),
      title,
      blocks,
      createdAt: new Date().toISOString(),
    });
    const allTemplates = await db.templates.find({ limit: 500 }).exec();
    setTemplates(allTemplates);
  };

  return (
    <div className="p-4 bg-[var(--bg-primary)] rounded-lg border border-[var(--divider)]">
      <h3 className="text-sm font-medium text-[var(--text-muted)] mb-4">
        {t("app_templates")}
      </h3>
      <div className="space-y-2">
        {templates.map((template) => (
          <div
            key={template.id}
            className="flex items-center justify-between p-2 hover:bg-[var(--state-hover-bg)] rounded"
          >
            <button
              onClick={() => onApply(template.blocks)}
              className="truncate text-sm text-white"
            >
              {template.title}
            </button>
            <button
              onClick={() => void handleDelete(template.id)}
            >
              <Trash2 className="size-4 text-[var(--text-secondary)]" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
