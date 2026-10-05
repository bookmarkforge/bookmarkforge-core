import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => {
    const t = (s: string, opts?: any) =>
      typeof opts === "string" ? opts : opts?.defaultValue || s;
    return { t, i18n: { language: "en" } };
  },
}));

vi.mock("motion/react", async () => {
  const { createMotionMock } = await import("../mocks/motion");
  return createMotionMock();
});

// P92: CalendarView reads RxDB reactively in uncontrolled mode — mock
// the RxDB React adapter so the smoke tests render without a real provider.
const { mockUseRxCollection, mockUseRxQuery } = vi.hoisted(() => ({
  mockUseRxCollection: vi.fn(() => undefined),
  mockUseRxQuery: vi.fn(() => ({ result: [] })),
}));
vi.mock("../../hooks/useRxDB", () => ({
  useRxCollection: mockUseRxCollection,
  useRxQuery: mockUseRxQuery,
}));

import CalendarView from "../../components/calendar/CalendarView";

describe("CalendarView - Smoke", () => {
  it("renders without crashing with empty events", () => {
    const { container } = render(<CalendarView events={[]} />);
    expect(container).toBeDefined();
  });

  it("renders with events", () => {
    // Use a date inside the current month so the event lands in the grid.
    const now = new Date();
    const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    const { container } = render(
      <CalendarView
        events={[{ id: "1", title: "Test Event", date: iso }]}
      />,
    );
    expect(container).toBeDefined();
    expect(screen.getByText("Test Event")).toBeDefined();
  });
});
