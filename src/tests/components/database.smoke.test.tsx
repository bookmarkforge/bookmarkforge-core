import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => {
    const t = (s: string, opts?: any) =>
      typeof opts === "string" ? opts : opts?.defaultValue || s;
    return { t };
  },
}));

vi.mock("motion/react", async () => {
  const { createMotionMock } = await import("../mocks/motion");
  return createMotionMock();
});

// P91: DatabaseView reads RxDB reactively — mock the RxDB React adapter so the
// uncontrolled (no rows prop) path renders without a real provider.
const { mockUseRxCollection, mockUseRxQuery } = vi.hoisted(() => ({
  mockUseRxCollection: vi.fn(() => undefined),
  mockUseRxQuery: vi.fn(() => ({ result: [] })),
}));
vi.mock("../../hooks/useRxDB", () => ({
  useRxCollection: mockUseRxCollection,
  useRxQuery: mockUseRxQuery,
}));

import DatabaseView from "../../components/database/DatabaseView";

describe("DatabaseView - Smoke", () => {
  it("renders without crashing with required collection prop", () => {
    const { container } = render(<DatabaseView collection="test" />);
    expect(container).toBeDefined();
  });

  it("renders with rows", () => {
    const { container } = render(
      <DatabaseView
        collection="bookmarks"
        rows={[{ id: "1", title: "Row 1" }]}
      />,
    );
    expect(container).toBeDefined();
  });

  it("renders empty state when no data and no rows", () => {
    render(<DatabaseView collection="bookmarks" />);
    expect(screen.getByText("No records found")).toBeDefined();
  });
});
