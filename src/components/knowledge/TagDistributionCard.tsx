import { lazy, Suspense } from "react";
import { motion, type Variants } from "motion/react";
import { EASE_OUT, DURATION_MENU } from "../../constants/motion";
import { TagData } from "./types";

const LazyPieChart = lazy(() => import("./TagDistributionPieChart"));

interface Props {
  data: TagData[];
  totalTags: number;
  cardVariants: Variants;
  t: (key: string) => string;
}

export const TagDistributionCard: React.FC<Props> = ({
  data,
  totalTags,
  cardVariants,
  t,
}) => {
  const maxTagValue = Math.max(0, ...data.map((tag) => tag.value));

  return (
  <motion.div
    variants={cardVariants}
    className="p-2 md:p-3 rounded-[3rem] shadow-sm ds-card"
  >
    <h2 className="ds-h2 mb-10 truncate">{t("app_popularTags")}</h2>
    <div className="h-[280px] relative">
      <Suspense
        fallback={
          <div className="size-full animate-pulse ds-bg-secondary rounded" />
        }
      >
        <LazyPieChart data={data} />
      </Suspense>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="ds-display-numeric">{totalTags}</span>
        <span className="ds-label-section mt-1 whitespace-nowrap ds-text-muted">
          {t("app_categories")}
        </span>
      </div>
    </div>
    <div className="mt-12 space-y-4">
      {data.map((tag, i) => (
        <div
          key={tag.name}
          className="flex items-center justify-between group cursor-default"
        >
          <div className="flex items-center gap-4">
            <div
              className="size-3 rounded-full shadow-lg"
              style={{
                backgroundColor: COLORS[i % COLORS.length],
                boxShadow: `0 0 10px ${COLORS[i % COLORS.length]}44`,
              }}
            />
            <span className="text-sm font-semibold transition-colors ds-text-secondary">
              {tag.name}
            </span>
          </div>
          <div className="h-1.5 w-16 rounded-full overflow-hidden ds-bg-muted">
            <motion.div
              initial={{ scaleX: 0 }}
              animate={{
                scaleX: maxTagValue > 0 ? tag.value / maxTagValue : 0,
              }}
              transition={{
                duration: DURATION_MENU,
                ease: EASE_OUT,
                delay: Math.min(i * 0.04, 0.15),
              }}
              className="h-full w-full origin-left rounded-full"
              style={{ backgroundColor: COLORS[i % COLORS.length] }}
            />
          </div>
          <span className="text-xs font-semibold tabular-nums min-w-[20px] text-end ds-text-muted">
            {tag.value}
          </span>
        </div>
      ))}
    </div>
  </motion.div>
  );
};

const COLORS = [
  "#22d3ee",
  "#0ea5e9",
  "#6366f1",
  "var(--accent-primary)",
  "#ec4899",
];
