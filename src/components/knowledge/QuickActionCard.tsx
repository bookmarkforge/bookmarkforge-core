import { motion, type Variants } from "motion/react";
import { Zap } from "lucide-react";
import type { TFunction } from "i18next";

interface Props {
  cardVariants: Variants;
  t: TFunction;
  onForceReindex: () => void;
  isReindexing?: boolean;
}

export const QuickActionCard: React.FC<Props> = ({
  cardVariants,
  t,
  onForceReindex,
  isReindexing = false,
}) => (
  <motion.div
    variants={cardVariants}
    className="p-2 md:p-3 rounded-[3rem] shadow-2xl relative overflow-hidden group flex flex-col justify-between ds-bg-inverse ds-text-inverse"
  >
    <div className="absolute top-0 right-0 p-12 opacity-10 group-hover:scale-125 transition-transform duration-1000 rotate-12">
      <Zap className="size-40" aria-hidden="true" />
    </div>
    <div className="relative z-10">
      <h2 className="ds-h2 mb-6">{t("app_readyIntelligence")}</h2>
      <p className="text-sm opacity-60 dark:opacity-70 mb-10 font-bold leading-relaxed">
        {t("app_readyIntelligenceDesc")}
      </p>
    </div>
    <button
      type="button"
      onClick={onForceReindex}
      disabled={isReindexing}
      className="truncate btn-primary w-full py-5 px-8 rounded-2xl shadow-2xl transition-all transform active:scale-95 hover:scale-[1.02] relative z-10 text-sm uppercase tracking-widest disabled:opacity-60"
      aria-label={t("app_forceReindexation")}
      aria-busy={isReindexing}
    >
      {isReindexing ? t("app_reindexing", "Reindexing…") : t("app_forceReindexation")}
    </button>
  </motion.div>
);
