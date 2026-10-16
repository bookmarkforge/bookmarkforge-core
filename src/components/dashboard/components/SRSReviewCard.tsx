import React from "react";
import { motion } from "motion/react";
import { Brain, ArrowRight } from "lucide-react";
import { EASE_OUT, DURATION_MENU } from "../../../constants/motion";
import { useTranslation } from "react-i18next";

interface SRSReviewCardProps {
  dueCardsCount: number;
  onStartReview: () => void;
}

export const SRSReviewCard: React.FC<SRSReviewCardProps> = ({
  dueCardsCount,
  onStartReview,
}) => {
  const { t } = useTranslation();

  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: 8 },
        show: {
          opacity: 1,
          y: 0,
          transition: { duration: DURATION_MENU, ease: EASE_OUT },
        },
      }}
      onClick={onStartReview}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onStartReview();
        }
      }}
      role="button"
      className="md:col-span-6 lg:col-span-12 group cursor-pointer p-8 shadow-xl text-start w-full transition-transform hover:scale-[1.02] active:scale-[0.98] ds-radius-card ds-bg-accent-primary ds-shadow-accent"
      tabIndex={0}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4 md:gap-6">
          <div className="size-16 flex items-center justify-center ds-radius-widget bg-[#04121f]">
            <Brain className="size-8 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-semibold tracking-tight mb-1 text-[var(--text-on-accent)] line-clamp-2">
              {t("app_srsDueTitle")}
            </h2>
            <p className="font-medium text-lg text-[var(--text-on-accent)]">
              {t("app_srsDueDesc", { count: dueCardsCount })}
            </p>
          </div>
        </div>
        <div className="hidden md:flex items-center gap-3 px-6 py-3.5 font-bold transition-colors hover:opacity-90 ds-radius-button bg-[#04121f] text-white">
          <span>{t("app_startReview")}</span>
          <ArrowRight className="rtl-flip size-5 group-hover:translate-x-1 transition-transform" />
        </div>
      </div>
    </motion.div>
  );
};
