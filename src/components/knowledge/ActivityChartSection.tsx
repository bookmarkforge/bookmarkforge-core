import {
  ResponsiveContainer,
  AreaChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Area,
} from "recharts";
import { TrendingUp } from "lucide-react";
import { motion, type Variants } from "motion/react";
import { ActivityData } from "./types";

interface Props {
  data: ActivityData[];
  isDark: boolean;
  cardVariants: Variants;
  t: (key: string, opts?: Record<string, string>) => string;
}

export const ActivityChartSection: React.FC<Props> = ({
  data,
  isDark,
  cardVariants,
  t,
}) => (
  <motion.div
    variants={cardVariants}
    className="lg:col-span-2 p-2 md:p-3 rounded-[3rem] shadow-sm relative ds-card"
  >
    <div className="flex items-center justify-between mb-10">
      <div>
        <h2 className="ds-h2 truncate">{t("app_activityHistory")}</h2>
        <p className="ds-label-section mt-1 whitespace-nowrap ds-text-muted">
          {t("app_researchTrend")}
        </p>
      </div>
      <div className="flex items-center gap-2 px-4 py-2 rounded-2xl text-[10px] font-semibold uppercase tracking-wider border whitespace-nowrap ds-bg-accent-soft ds-text-accent ds-border-accent-glow">
        <TrendingUp className="size-3" />
        {t("app_realTime")}
      </div>
    </div>
    <div className="h-[350px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data}>
          <defs>
            <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="5%"
                stopColor="var(--accent-primary)"
                stopOpacity={0.4}
              />
              <stop
                offset="95%"
                stopColor="var(--accent-primary)"
                stopOpacity={0}
              />
            </linearGradient>
          </defs>
          {/* Hex literals below are intentional — recharts SVG attributes cannot accept CSS vars. */}
          <CartesianGrid
            strokeDasharray="3 3"
            stroke={isDark ? "#27272a" : "#f4f4f5"}
            vertical={false}
          />
          <XAxis
            dataKey="date"
            axisLine={false}
            tickLine={false}
            tick={{
              fontSize: 10,
              fontWeight: 800,
              fill: isDark ? "#71717a" : "#a1a1aa",
            }}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{
              fontSize: 10,
              fontWeight: 800,
              fill: isDark ? "#71717a" : "#a1a1aa",
            }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: isDark ? "#18181b" : "#ffffff",
              borderColor: isDark ? "#27272a" : "#e4e4e7",
              borderRadius: "1.5rem",
              fontSize: "12px",
              fontWeight: "900",
              boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
              padding: "12px 16px",
              border: "1px solid " + (isDark ? "#3f3f46" : "#e4e4e7"),
            }}
          />
          <Area
            type="monotone"
            dataKey="count"
            stroke="var(--accent-primary)"
            strokeWidth={5}
            fillOpacity={1}
            fill="url(#colorCount)"
            animationDuration={2000}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  </motion.div>
);
