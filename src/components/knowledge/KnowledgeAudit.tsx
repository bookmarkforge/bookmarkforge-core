import { motion } from "motion/react";
import { AlertTriangle } from "lucide-react";
import type { TFunction } from "i18next";
import { CardProps } from "./shared-props";

interface Props extends CardProps {
  t: TFunction;
}

export const KnowledgeAudit: React.FC<Props> = ({ cardVariants, t }) => {
  // Audit feature not available in Core export
  return (
    <motion.div
      variants={cardVariants}
      className="p-6 bg-slate-800/50 rounded-xl border border-slate-700"
    >
      <div className="flex items-center gap-3 mb-4">
        <AlertTriangle className="w-5 h-5 text-amber-500" />
        <h3 className="text-lg font-semibold text-slate-100">
          {t("knowledge_audit_title", { defaultValue: "Knowledge Audit" })}
        </h3>
      </div>
      <p className="text-slate-400">
        {t("knowledge_audit_unavailable", { 
          defaultValue: "Audit feature is not available in the Core export. This feature requires the Pro version." 
        })}
      </p>
    </motion.div>
  );
};
