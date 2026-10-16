import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import React from "react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (s: string) => s }),
}));

const {
  SuspenseFallback,
  SkeletonList,
  SkeletonCard,
  SkeletonText,
  SkeletonTable,
} = await import("../../components/SuspenseFallback");

describe("SuspenseFallback", () => {
  it("renders spinner and text", () => {
    const { getByText } = render(<SuspenseFallback />);
    expect(getByText("app_loading")).toBeTruthy();
  });
});

describe("SkeletonList", () => {
  it("renders the correct number of items", () => {
    const { container } = render(<SkeletonList count={3} />);
    const items = container.querySelectorAll(".animate-pulse");
    expect(items.length).toBe(3);
  });

  it("renders 5 by default", () => {
    const { container } = render(<SkeletonList />);
    expect(container.querySelectorAll(".animate-pulse").length).toBe(5);
  });
});

describe("SkeletonCard", () => {
  it("renders the correct number of cards", () => {
    const { container } = render(<SkeletonCard count={2} />);
    expect(container.querySelectorAll(".animate-pulse").length).toBe(2);
  });
});

describe("SkeletonText", () => {
  it("renders the correct number of lines", () => {
    const { container } = render(<SkeletonText lines={4} />);
    expect(container.querySelectorAll(".animate-pulse").length).toBe(4);
  });
});

describe("SkeletonTable", () => {
  it("renders header plus rows", () => {
    const { container } = render(<SkeletonTable rows={3} />);
    expect(container.querySelectorAll(".animate-pulse").length).toBe(4);
  });
});
