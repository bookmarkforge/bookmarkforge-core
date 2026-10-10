import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { TagDistributionCard } from "../../../components/knowledge/TagDistributionCard";

const mockT = vi.fn((key: string) => {
  const map: Record<string, string> = {
    app_popularTags: "Popular Tags",
    app_categories: "categories",
  };
  return map[key] || key;
});

const tagData = [
  { name: "React", value: 30 },
  { name: "CSS", value: 20 },
  { name: "JS", value: 15 },
];

describe("TagDistributionCard", () => {
  const variants = { hidden: {}, visible: {} };

  it("renders title", () => {
    const { getByText } = render(
      <TagDistributionCard
        data={tagData}
        totalTags={3}
        cardVariants={variants}
        t={mockT}
      />,
    );
    expect(getByText("Popular Tags")).toBeTruthy();
  });

  it("renders total categories", () => {
    const { getByText } = render(
      <TagDistributionCard
        data={tagData}
        totalTags={3}
        cardVariants={variants}
        t={mockT}
      />,
    );
    expect(getByText("3")).toBeTruthy();
  });

  it("renders the tag names", () => {
    const { getByText } = render(
      <TagDistributionCard
        data={tagData}
        totalTags={3}
        cardVariants={variants}
        t={mockT}
      />,
    );
    expect(getByText("React")).toBeTruthy();
    expect(getByText("CSS")).toBeTruthy();
    expect(getByText("JS")).toBeTruthy();
  });

  it("renders the tag values", () => {
    const { getByText } = render(
      <TagDistributionCard
        data={tagData}
        totalTags={3}
        cardVariants={variants}
        t={mockT}
      />,
    );
    expect(getByText("30")).toBeTruthy();
    expect(getByText("20")).toBeTruthy();
    expect(getByText("15")).toBeTruthy();
  });

  it("renders categories label", () => {
    const { getByText } = render(
      <TagDistributionCard
        data={tagData}
        totalTags={3}
        cardVariants={variants}
        t={mockT}
      />,
    );
    expect(getByText("categories")).toBeTruthy();
  });

  it("does not produce NaN when the values are zero", () => {
    const { container } = render(
      <TagDistributionCard
        data={[{ name: "Empty", value: 0 }]}
        totalTags={0}
        cardVariants={variants}
        t={mockT}
      />,
    );
    expect(container.innerHTML).not.toContain("NaN");
  });

  it("renders empty state with totalTags of 0", () => {
    const { getByText } = render(
      <TagDistributionCard
        data={[]}
        totalTags={0}
        cardVariants={variants}
        t={mockT}
      />,
    );
    expect(getByText("Popular Tags")).toBeTruthy();
    expect(getByText("0")).toBeTruthy();
  });
});
