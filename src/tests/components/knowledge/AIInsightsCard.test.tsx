import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { AIInsightsCard } from "../../../components/knowledge/AIInsightsCard";

describe("AIInsightsCard", () => {
  const mockT = vi.fn((key: string, opts?: Record<string, unknown>) => {
    const map: Record<string, string> = {
      app_aiInsights: "AI Insights",
      app_aiDataSymphony: "Data Symphony",
      app_aiInsight1: `About ${(opts?.topic as string) || "various"}`,
      app_aiInsight2_positive: "Great progress!",
      app_aiInsight2_zero: "No activity",
      app_bookmarksThisWeek: `${opts?.count || 0} this week`,
      app_criticalFocusPoint: "FOCUS",
      app_variousTopics: "various",
    };
    return map[key] || key;
  });
  const variants = { hidden: {}, visible: {} };

  it("renders title and subtitle", () => {
    const { getByText } = render(
      <AIInsightsCard
        topTags={["React"]}
        bookmarksThisWeek={5}
        cardVariants={variants}
        t={mockT}
      />,
    );
    expect(getByText("AI Insights")).toBeTruthy();
    expect(getByText("Data Symphony")).toBeTruthy();
  });

  it("renders insight with top tag", () => {
    const { getByText } = render(
      <AIInsightsCard
        topTags={["React"]}
        bookmarksThisWeek={5}
        cardVariants={variants}
        t={mockT}
      />,
    );
    expect(getByText("About React")).toBeTruthy();
  });

  it("renders alternative text when there are no tags", () => {
    const { getByText } = render(
      <AIInsightsCard
        topTags={[]}
        bookmarksThisWeek={0}
        cardVariants={variants}
        t={mockT}
      />,
    );
    expect(getByText("About various")).toBeTruthy();
  });

  it("shows a positive message when there are bookmarks this week", () => {
    const { getByText } = render(
      <AIInsightsCard
        topTags={["React"]}
        bookmarksThisWeek={5}
        cardVariants={variants}
        t={mockT}
      />,
    );
    expect(getByText("Great progress!")).toBeTruthy();
    expect(getByText("+ 5 this week")).toBeTruthy();
  });

  it("shows an inactivity message when there are no bookmarks", () => {
    const { getByText, queryByText } = render(
      <AIInsightsCard
        topTags={["React"]}
        bookmarksThisWeek={0}
        cardVariants={variants}
        t={mockT}
      />,
    );
    expect(getByText("No activity")).toBeTruthy();
    // Zero-state must NOT render the count badge.
    expect(queryByText(/\d+ this week/)).toBeNull();
  });
});
