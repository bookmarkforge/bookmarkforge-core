import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { ActivityChartSection } from "../../../components/knowledge/ActivityChartSection";

const mockT = vi.fn((key: string) => {
  const map: Record<string, string> = {
    app_activityHistory: "Activity History",
    app_researchTrend: "Research Trend",
    app_realTime: "Real Time",
  };
  return map[key] || key;
});

const activityData = [
  { date: "2025-01-01", count: 5 },
  { date: "2025-01-02", count: 3 },
  { date: "2025-01-03", count: 8 },
];

describe("ActivityChartSection", () => {
  const variants = { hidden: {}, visible: {} };

  it("renders title", () => {
    const { getByText } = render(
      <ActivityChartSection
        data={activityData}
        isDark={false}
        cardVariants={variants}
        t={mockT}
      />,
    );
    expect(getByText("Activity History")).toBeTruthy();
  });

  it("renders Research Trend subtitle", () => {
    const { getByText } = render(
      <ActivityChartSection
        data={activityData}
        isDark={false}
        cardVariants={variants}
        t={mockT}
      />,
    );
    expect(getByText("Research Trend")).toBeTruthy();
  });

  it("renders Real Time badge", () => {
    const { getByText } = render(
      <ActivityChartSection
        data={activityData}
        isDark={false}
        cardVariants={variants}
        t={mockT}
      />,
    );
    expect(getByText("Real Time")).toBeTruthy();
  });

  it("renders the chart container", () => {
    const { container } = render(
      <ActivityChartSection
        data={activityData}
        isDark={false}
        cardVariants={variants}
        t={mockT}
      />,
    );
    const chartContainer = container.querySelector(".h-\\[350px\\]");
    expect(chartContainer).toBeTruthy();
  });

  it("renders without crashing in dark mode", () => {
    const { getByText } = render(
      <ActivityChartSection
        data={activityData}
        isDark
        cardVariants={variants}
        t={mockT}
      />,
    );
    expect(getByText("Activity History")).toBeTruthy();
    expect(getByText("Research Trend")).toBeTruthy();
  });
});
