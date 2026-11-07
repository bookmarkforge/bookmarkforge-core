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

// P92: KanbanView reads RxDB reactively in uncontrolled mode — mock
// the RxDB React adapter so the smoke tests render without a real provider.
const { mockUseRxCollection, mockUseRxQuery } = vi.hoisted(() => ({
  mockUseRxCollection: vi.fn(() => undefined),
  mockUseRxQuery: vi.fn(() => ({ result: [] })),
}));
vi.mock("../../hooks/useRxDB", () => ({
  useRxCollection: mockUseRxCollection,
  useRxQuery: mockUseRxQuery,
}));

import KanbanView from "../../components/kanban/KanbanView";

describe("KanbanView - Smoke", () => {
  it("renders without crashing with empty columns", () => {
    const { container } = render(<KanbanView columns={[]} />);
    expect(container).toBeDefined();
  });

  it("renders with items", () => {
    const { container } = render(
      <KanbanView
        columns={[
          { id: "1", title: "To Do", items: [{ id: "i1", title: "Task 1" }] },
        ]}
      />,
    );
    expect(container).toBeDefined();
    expect(screen.getByText("Task 1")).toBeDefined();
  });
});
