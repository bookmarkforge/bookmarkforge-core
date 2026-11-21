import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
} from "recharts";
import { TagData } from "./types";

const COLORS = [
  "#22d3ee",
  "#0ea5e9",
  "#6366f1",
  "var(--accent-primary)",
  "#ec4899",
];

export default function TagDistributionPieChart({
  data,
}: {
  data: TagData[];
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={70}
          outerRadius={100}
          paddingAngle={10}
          dataKey="value"
          stroke="none"
        >
          {data.map((_, index) => (
            <Cell
              key={`cell-${index}`}
              fill={COLORS[index % COLORS.length]}
            />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            borderRadius: "1rem",
            fontSize: "12px",
            fontWeight: "900",
            border: "none",
            boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.1)",
          }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
