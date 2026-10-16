import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { SkeletonLoader } from "../../../components/bookmarks/SkeletonLoader";

describe("SkeletonLoader", () => {
  it("renders 5 skeleton rows", () => {
    const { container } = render(<SkeletonLoader />);
    const rows = container.querySelectorAll(".grid.grid-cols-2");
    expect(rows).toHaveLength(5);
  });

  it("renders 7 columns per row", () => {
    const { container } = render(<SkeletonLoader />);
    const firstRow = container.querySelector(".grid");
    expect(firstRow?.children).toHaveLength(7);
  });

  it("has animate-pulse class", () => {
    const { container } = render(<SkeletonLoader />);
    const pulseDivs = container.querySelectorAll(".animate-pulse");
    expect(pulseDivs).toHaveLength(35);
  });
});
