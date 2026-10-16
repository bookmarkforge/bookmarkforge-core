import React from "react";
import { motion, AnimatePresence } from "motion/react";
import { FileText, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { DocumentTemplate } from "../../../services/DocumentTemplateService";

interface TemplateModalProps {
  show: boolean;
  templates: DocumentTemplate[];
  onClose: () => void;
  onCreateFromTemplate: (template: DocumentTemplate) => void;
}

export const TemplateModal: React.FC<TemplateModalProps> = ({
  show,
  templates,
  onClose,
  onCreateFromTemplate,
}) => {
  const { t } = useTranslation();

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-[var(--bg-primary)]/60 z-[500] flex items-center justify-center p-4 font-sans"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 20 }}
            className="bg-white dark:bg-[var(--bg-primary)] border border-[var(--divider)] dark:border-[var(--divider)] rounded-[32px] shadow-2xl max-w-4xl w-full max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 md:p-8 border-b border-[var(--divider)] dark:border-[var(--divider)]/50 flex items-center justify-between bg-[var(--bg-secondary)]/80 dark:bg-[var(--bg-primary)]/50 rounded-t-[32px]">
              <div className="flex items-center gap-3">
                <div className="size-10 rounded-xl ds-bg-success/10 flex items-center justify-center border border-[var(--success-soft-border)]/20">
                  <FileText className="size-5 ds-text-success dark:ds-text-success" />
                </div>
                <h2 className="text-2xl font-semibold text-[var(--text-primary)] dark:text-white tracking-tight">
                  {t("app_templates")}
                </h2>
              </div>
              <button
                onClick={onClose}
                className="p-2.5 hover:bg-[var(--state-hover-bg)] dark:hover:bg-[var(--state-hover-bg)] bg-[var(--bg-secondary)] dark:bg-[var(--bg-primary)]/50 text-[var(--text-muted)] rounded-full transition-colors shadow-sm"
                aria-label={t("app_close", "Close")}
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="p-6 md:p-8 overflow-y-auto custom-scrollbar flex-1 bg-[var(--bg-secondary)]/30 dark:bg-[var(--bg-primary)]/30 rounded-b-[32px]">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {templates.map((template) => (
                  <button
                    key={template.id}
                    onClick={() => onCreateFromTemplate(template)}
                    className="truncate p-5 rounded-2xl bg-white dark:bg-[var(--bg-primary)] border border-[var(--divider)] dark:border-[var(--divider)] hover:border-[var(--success-soft-border)]/40 hover:shadow-xl hover:shadow-emerald-500/5 transition-all text-start group shadow-sm flex flex-col h-full"
                  >
                    <div className="size-12 ds-bg-success-soft dark:ds-bg-success/10 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 group-hover:ds-bg-success-soft dark:group-hover:ds-bg-success/20 transition-all border border-[var(--success-soft-border)] dark:border-[var(--success-soft-border)]/10 shadow-inner">
                      <FileText className="size-6 ds-text-success dark:ds-text-success" />
                    </div>
                    <h3 className="font-semibold text-lg mb-2 text-[var(--text-primary)] dark:text-white tracking-tight">
                      {template.name}
                    </h3>
                    <p className="text-[var(--text-muted)] dark:text-[var(--text-muted)] text-sm font-medium mb-4 flex-1">
                      {template.description}
                    </p>
                    <div className="flex gap-1.5 flex-wrap mt-auto">
                      {template.tags.map((tag) => (
                        <span
                          key={tag}
                          className="text-[10px] font-bold uppercase tracking-wider bg-[var(--bg-secondary)] dark:bg-[var(--bg-card)] text-[var(--text-secondary)] dark:text-[var(--text-muted)] px-2.5 py-1 rounded-md border border-[var(--divider)] dark:border-[var(--divider)]/50"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
