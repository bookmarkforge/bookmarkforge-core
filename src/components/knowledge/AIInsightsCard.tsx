import { motion, type Variants } from "motion/react";
import { Sparkles, Target, Zap, Brain } from "lucide-react";

interface Props {
  topTags: string[];
  bookmarksThisWeek: number;
  cardVariants: Variants;
  t: (key: string, opts?: Record<string, unknown>) => string;
}

export const AIInsightsCard: React.FC<Props> = ({
  topTags,
  bookmarksThisWeek,
  cardVariants,
  t,
}) => (
  <motion.div
    variants={cardVariants}
    className="lg:col-span-2 p-2 md:p-3 rounded-[3rem] shadow-sm relative overflow-hidden group ds-bg-accent-soft ds-border-accent"
  >
    <div className="absolute -right-20 -top-20 opacity-5 group-hover:scale-110 transition-transform duration-1000">
      <Brain className="size-80" />
    </div>
    <div className="flex items-center gap-5 mb-10">
      <div className="p-4 text-white rounded-[1.5rem] shadow-2xl ds-bg-accent-primary ds-shadow-accent-hero">
        <Sparkles className="size-7" />
      </div>
      <div>
        <h2 className="ds-h2">{t("app_aiInsights")}</h2>
        <p className="ds-label-section mt-1 ds-text-muted">
          {t("app_aiDataSymphony")}
        </p>
      </div>
    </div>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 relative z-10">
      <div className="p-8 rounded-[2.5rem] flex items-start gap-6 hover:shadow-2xl transition-all hover:-translate-y-2 group/card ds-bg-card ds-border">
        <div className="p-3 rounded-2xl shrink-0 group-hover/card:scale-110 transition-transform shadow-inner ds-bg-warning-soft ds-text-warning">
          <Target className="size-6" />
        </div>
        <div>
          <p className="text-base leading-relaxed font-semibold tracking-tight ds-text-primary">
            {t("app_aiInsight1", {
              topic: topTags[0] || t("app_variousTopics"),
            })}
          </p>
          <div className="mt-4 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest ds-text-warning">
            <span className="size-1.5 rounded-full animate-pulse ds-bg-warning" />
            {t("app_criticalFocusPoint")}
          </div>
        </div>
      </div>
      <div className="p-8 rounded-[2.5rem] flex items-start gap-6 hover:shadow-2xl transition-all hover:-translate-y-2 group/card ds-bg-card ds-border">
        <div className="p-3 rounded-2xl shrink-0 group-hover/card:scale-110 transition-transform shadow-inner ds-bg-success-soft ds-text-success">
          <Zap className="size-6" />
        </div>
        <div>
          <p className="text-base leading-relaxed font-semibold tracking-tight ds-text-primary">
            {bookmarksThisWeek > 0
              ? t("app_aiInsight2_positive")
              : t("app_aiInsight2_zero")}
          </p>
          {bookmarksThisWeek > 0 && (
            <div className="mt-4 inline-flex items-center gap-3 px-4 py-1.5 rounded-full ds-bg-success-soft">
              <span className="text-[11px] font-semibold uppercase tracking-widest ds-text-success">
                + {t("app_bookmarksThisWeek", { count: bookmarksThisWeek })}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  </motion.div>
);
