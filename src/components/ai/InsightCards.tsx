import React from "react";
import { motion } from "motion/react";
import { Sparkles, ArrowRight, Link as LinkIcon, Calendar } from "lucide-react";
import { Insight } from "../../services/ai/CrossPollinationService";
import { useTranslation } from "react-i18next";
import { formatDate } from "../../utils/localization";

interface InsightCardsProps {
  insights: Insight[];
  onAction: (insight: Insight) => void;
}

const InsightCards: React.FC<InsightCardsProps> = ({ insights, onAction }) => {
  const { t, i18n } = useTranslation();

  if (insights.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest ds-text-muted">
        <Sparkles className="size-4 ds-text-warning" aria-hidden="true" />
        <span>{t("app_aiSuggestions", "AI Suggestions")}</span>
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {insights.map((insight) => (
          <motion.div
            key={insight.id}
            role="button"
            tabIndex={0}
            aria-label={`${insight.title}: ${t("app_exploreConnection", "Explore connection")}`}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            whileHover={{ y: -4 }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onAction(insight);
              }
            }}
            className={`p-6 rounded-3xl shadow-sm hover:shadow-md transition-[transform,box-shadow] duration-200 cursor-pointer group focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-primary)] ${
              insight.type === "suggestion"
                ? "ds-icon-tint-cyan"
                : "ds-badge-warning-soft"
            }`}
            onClick={() => onAction(insight)}
          >
            <div className="flex justify-between items-start mb-4">
              <div
                className={`p-2 rounded-xl ${insight.type === "suggestion" ? "ds-icon-tint-cyan" : "ds-badge-warning-soft"}`}
              >
                {insight.type === "suggestion" ? (
                  <Calendar className="size-5" />
                ) : (
                  <LinkIcon className="size-5" />
                )}
              </div>
              <span
                className="text-[10px] font-bold uppercase tracking-tighter"
                style={
                  insight.type === "suggestion"
                    ? { color: "var(--accent-primary)" }
                    : { color: "var(--color-warning)" }
                }
              >
                {insight.type === "suggestion"
                  ? t("app_weeklyCuration", "Weekly Curation")
                  : formatDate(insight.createdAt, {}, i18n.language)}
              </span>
            </div>

            <h3 className="text-lg font-semibold tracking-tight mb-2 ds-text-primary">
              {insight.title}
            </h3>

            <p className="text-sm line-clamp-3 mb-4 leading-relaxed ds-text-secondary">
              {insight.content}
            </p>

            <div className="flex items-center gap-2 text-xs font-bold group-hover:gap-3 transition-[gap] duration-200 ds-text-warning">
              <span>{t("app_exploreConnection")}</span>
              <ArrowRight className="rtl-flip size-3" />
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
};

export default InsightCards;
