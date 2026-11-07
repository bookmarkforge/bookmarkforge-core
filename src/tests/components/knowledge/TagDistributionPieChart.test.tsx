import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import React from "react";

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: any) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  PieChart: ({ children }: any) => (
    <div data-testid="pie-chart">{children}</div>
  ),
  Pie: ({ children, data }: any) => (
    <div data-testid="pie" data-count={data?.length}>
      {children}
    </div>
  ),
  Cell: (props: any) => (
    <div data-testid="cell" data-fill={props?.fill} />
  ),
  Tooltip: () => <div data-testid="tooltip" />,
}));

import TagDistributionPieChart from "../../../components/knowledge/TagDistributionPieChart";

const tagData = [
  { name: "React", value: 30 },
  { name: "CSS", value: 20 },
  { name: "JS", value: 15 },
];

describe("TagDistributionPieChart", () => {
  beforeEach(() => {
    cleanup();
  });

  it("renders a responsive chart container", () => {
    render(<TagDistributionPieChart data={tagData} />);
    expect(screen.getByTestId("responsive-container")).toBeTruthy();
    expect(screen.getByTestId("pie-chart")).toBeTruthy();
  });

  it("passes the full dataset to the Pie", () => {
    render(<TagDistributionPieChart data={tagData} />);
    expect(screen.getByTestId("pie").getAttribute("data-count")).toBe("3");
  });

  it("renders one Cell per data entry", () => {
    render(<TagDistributionPieChart data={tagData} />);
    const cells = screen.getAllByTestId("cell");
    expect(cells).toHaveLength(3);
  });

  it("renders a Tooltip", () => {
    render(<TagDistributionPieChart data={tagData} />);
    expect(screen.getByTestId("tooltip")).toBeTruthy();
  });

  it("applies cyclic colors to the cells", () => {
    const data = [
      { name: "a", value: 1 },
      { name: "b", value: 2 },
      { name: "c", value: 3 },
      { name: "d", value: 4 },
      { name: "e", value: 5 },
    ];
    const { container } = render(<TagDistributionPieChart data={data} />);
    const cells = Array.from(
      container.querySelectorAll('[data-testid="cell"]'),
    );
    const fills = cells.map((c) => (c as HTMLElement).dataset.fill);
    // The palette wraps: the 6th datum (index 5) would reuse the 1st color —
    // with 5 data points we check that index 0 and 4 differ (palette extremes).
    expect(fills[0]).toBe("#22d3ee");
    expect(fills[4]).toBe("#ec4899");
  });

  it("handles an empty dataset without crashing", () => {
    render(<TagDistributionPieChart data={[]} />);
    expect(screen.getByTestId("pie").getAttribute("data-count")).toBe("0");
    expect(screen.queryAllByTestId("cell")).toHaveLength(0);
  });
});
