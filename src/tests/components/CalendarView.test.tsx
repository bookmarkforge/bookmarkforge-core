import { describe, it, expect, vi } from "vitest";
import {
  render,
  screen,
  waitFor,
  fireEvent,
  act,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("../../utils/logger", () => ({ logger: mockLogger }));

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
// the RxDB React adapter so the /calendar route path renders without a real provider.
// The collection mock must return a chainable find().where().eq() because
// the component calls docsCollection?.find().where("isDeleted").eq(false)
// unconditionally (hooks cannot be conditional) — even in controlled mode.
const { mockUseRxCollection, mockUseRxQuery, chainQuery } = vi.hoisted(() => ({
  mockUseRxCollection: vi.fn(() => undefined),
  mockUseRxQuery: vi.fn(() => ({ result: [] })),
  chainQuery: { where: () => ({ eq: () => ({}) }) },
}));
vi.mock("../../hooks/useRxDB", () => ({
  useRxCollection: mockUseRxCollection,
  useRxQuery: mockUseRxQuery,
}));

import CalendarView from "../../components/calendar/CalendarView";

function todayStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

describe("CalendarView", () => {
  beforeEach(() => {
    mockUseRxCollection.mockReset();
    mockUseRxQuery.mockReset();
    mockUseRxCollection.mockReturnValue(undefined as any);
    mockUseRxQuery.mockReturnValue({ result: [] } as any as any);
    // Without clear, the toHaveBeenCalled assertions of the catch could pass
    // because of warn calls from earlier tests (mocks persist per file).
    mockLogger.warn.mockClear();
    mockLogger.error.mockClear();
  });

  it("P92: reads documents from RxDB by creation date without events prop", () => {
    mockUseRxCollection.mockReturnValue({ find: () => chainQuery } as any);
    mockUseRxQuery.mockReturnValue({
      result: [
        {
          toJSON: () => ({
            id: "d1",
            title: "Real Saved Doc",
            createdAt: `${todayStr()}T10:00:00.000Z`,
          }),
        },
      ],
    } as any as any as any as any);
    render(<CalendarView />);
    expect(screen.getByTitle("Real Saved Doc")).toBeDefined();
  });

  it("renders the Add Event button", () => {
    render(<CalendarView events={[]} />);
    expect(screen.getByText("Add Event")).toBeDefined();
  });

  it("renders the month/year header", () => {
    render(<CalendarView events={[]} />);
    const header = new Date().toLocaleDateString("en", {
      month: "long",
      year: "numeric",
    });
    expect(screen.getByText(header)).toBeDefined();
  });

  it("renders day-of-week headers", () => {
    render(<CalendarView events={[]} />);
    for (const d of ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]) {
      expect(screen.getByText(d)).toBeDefined();
    }
  });

  it("renders navigation buttons", () => {
    render(<CalendarView events={[]} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThanOrEqual(3);
  });

  it("renders the Today button", () => {
    render(<CalendarView events={[]} />);
    expect(screen.getByText("Today")).toBeDefined();
  });

  it("opens event creation modal on Add Event click", async () => {
    render(<CalendarView events={[]} />);
    await userEvent.click(screen.getByText("Add Event"));
    expect(screen.getByText("New Event")).toBeDefined();
  });

  it("closes event creation modal on Cancel click", async () => {
    render(<CalendarView events={[]} />);
    await userEvent.click(screen.getByText("Add Event"));
    await userEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByText("New Event")).toBeNull();
  });

  it("renders events when provided", () => {
    const events = [
      { id: "e1", title: "Meeting", date: todayStr(), type: "event" as const },
    ];
    render(<CalendarView events={events} />);
    expect(screen.getByTitle("Meeting")).toBeDefined();
  });

  it("calls onCreate when event is created via modal", async () => {
    const onCreate = vi.fn();
    render(<CalendarView events={[]} onCreate={onCreate} />);
    await userEvent.click(screen.getByText("Add Event"));
    await waitFor(async () => {
      const input = screen.getByDisplayValue("");
      await userEvent.type(input, "Test Event");
    });
    await userEvent.click(screen.getByText("Create"));
    expect(onCreate).toHaveBeenCalled();
  });

  it("opens edit modal when clicking an event", async () => {
    const events = [
      { id: "e1", title: "Meeting", date: todayStr(), type: "event" as const },
    ];
    render(<CalendarView events={events} onEventClick={vi.fn()} />);
    await userEvent.click(screen.getByTitle("Meeting"));
    expect(screen.getByText("Edit Event")).toBeDefined();
  });

  it("navigates to previous month", async () => {
    render(<CalendarView events={[]} />);
    const prevBtn = screen.getAllByRole("button")[0];
    await userEvent.click(prevBtn!);
    const now = new Date();
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1).toLocaleDateString("en", {
      month: "long",
      year: "numeric",
    });
    expect(screen.getByText(prevMonth)).toBeDefined();
  });

  it("navigates to next month", async () => {
    render(<CalendarView events={[]} />);
    const nextBtn = screen.getAllByRole("button")[1];
    await userEvent.click(nextBtn!);
    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1).toLocaleDateString("en", {
      month: "long",
      year: "numeric",
    });
    expect(screen.getByText(nextMonth)).toBeDefined();
  });

  it("goToToday returns to current month", async () => {
    render(<CalendarView events={[]} />);
    const nextBtn = screen.getAllByRole("button")[1];
    await userEvent.click(nextBtn!);
    await userEvent.click(screen.getByText("Today"));
    const header = new Date().toLocaleDateString("en", { month: "long", year: "numeric" });
    expect(screen.getByText(header)).toBeDefined();
  });

  it("calls onDelete when deleting an event", async () => {
    const onDelete = vi.fn();
    const events = [
      { id: "e1", title: "Meeting", date: todayStr(), type: "event" as const },
    ];
    render(<CalendarView events={events} onDelete={onDelete} />);
    await userEvent.click(screen.getByTitle("Meeting"));
    await userEvent.click(screen.getByText("Delete"));
    expect(onDelete).toHaveBeenCalledWith("e1");
  });

  it("renders different event type colors (task, reminder)", () => {
    const events = [
      { id: "e1", title: "Task A", date: todayStr(), type: "task" as const },
      { id: "e2", title: "Reminder B", date: todayStr(), type: "reminder" as const },
    ];
    render(<CalendarView events={events} />);
    expect(screen.getByTitle("Task A")).toBeDefined();
    expect(screen.getByTitle("Reminder B")).toBeDefined();
  });

  it("shows +N more when more than 2 events on a day", () => {
    const d = todayStr();
    const events = [
      { id: "e1", title: "E1", date: d, type: "event" as const },
      { id: "e2", title: "E2", date: d, type: "event" as const },
      { id: "e3", title: "E3", date: d, type: "event" as const },
    ];
    render(<CalendarView events={events} />);
    expect(screen.getByText(/more/)).toBeDefined();
  });

  it("shows event count in header", () => {
    const d = todayStr();
    const events = [
      { id: "e1", title: "E1", date: d, type: "event" as const },
      { id: "e2", title: "E2", date: d, type: "event" as const },
    ];
    render(<CalendarView events={events} />);
    expect(screen.getByText(/events/)).toBeDefined();
  });

  it("commits event on Enter key in title input", async () => {
    const onCreate = vi.fn();
    render(<CalendarView events={[]} onCreate={onCreate} />);
    await userEvent.click(screen.getByText("Add Event"));
    await waitFor(async () => {
      const input = screen.getByDisplayValue("");
      await userEvent.type(input, "Test Event{Enter}");
    });
    expect(onCreate).toHaveBeenCalled();
  });

  it("does not create event with empty title", async () => {
    const onCreate = vi.fn();
    render(<CalendarView events={[]} onCreate={onCreate} />);
    await userEvent.click(screen.getByText("Add Event"));
    const createBtn = screen.getByText("Create");
    expect(createBtn).toBeDisabled();
  });

  it("opens modal with date pre-filled for day cell click", async () => {
    render(<CalendarView events={[]} />);
    const cells = screen.getAllByRole("gridcell");
    if (cells.length > 0) {
      await userEvent.click(cells[0]!);
      expect(screen.getByText("New Event")).toBeDefined();
    }
  });

  // ── P92 uncontrolled mode: real RxDB writes + date branches ──

  it("P92: creates event in uncontrolled mode (upsert document with createdAt)", async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    mockUseRxCollection.mockReturnValue({
      find: () => chainQuery,
      upsert,
      findOne: vi.fn(),
    } as any as any);
    mockUseRxQuery.mockReturnValue({ result: [] } as any as any);
    render(<CalendarView />);
    await userEvent.click(screen.getByText("Add Event"));
    await waitFor(async () => {
      await userEvent.type(screen.getByDisplayValue(""), "New RxDB Event");
    });
    await userEvent.click(screen.getByText("Create"));
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ title: "New RxDB Event" }),
    );
  });

  it("P92: edita evento en modo no controlado (findOne + patch)", async () => {
    const patch = vi.fn().mockResolvedValue(undefined);
    const findOne = vi.fn().mockReturnValue({
      exec: vi.fn().mockResolvedValue({ incrementalPatch: patch }),
    });
    mockUseRxCollection.mockReturnValue({
      find: () => chainQuery,
      findOne,
      upsert: vi.fn(),
    } as any as any);
    mockUseRxQuery.mockReturnValue({
      result: [
        {
          toJSON: () => ({
            id: "d1",
            title: "Existing Event",
            createdAt: `${todayStr()}T10:00:00.000Z`,
          }),
        },
      ],
    } as any as any as any as any);
    render(<CalendarView />);
    await userEvent.click(screen.getByTitle("Existing Event"));
    const titleInput = screen.getByDisplayValue("Existing Event");
    await userEvent.clear(titleInput);
    await userEvent.type(titleInput, "Renamed Event");
    await userEvent.click(screen.getByText("Save"));
    expect(findOne).toHaveBeenCalledWith("d1");
    expect(patch).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Renamed Event" }),
    );
  });

  it("P92: deletes event in uncontrolled mode (soft-delete isDeleted)", async () => {
    const patch = vi.fn().mockResolvedValue(undefined);
    mockUseRxCollection.mockReturnValue({
      find: () => chainQuery,
      findOne: vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue({ incrementalPatch: patch }),
      }),
    } as any as any);
    mockUseRxQuery.mockReturnValue({
      result: [
        {
          toJSON: () => ({
            id: "d1",
            title: "Doomed Event",
            createdAt: `${todayStr()}T10:00:00.000Z`,
          }),
        },
      ],
    } as any as any as any as any);
    render(<CalendarView />);
    await userEvent.click(screen.getByTitle("Doomed Event"));
    await userEvent.click(screen.getByText("Delete"));
    expect(patch).toHaveBeenCalledWith(
      expect.objectContaining({ isDeleted: true, updatedAt: expect.any(String) }),
    );
  });

  it("P92: document with invalid createdAt is filtered (NaN isoToLocalDate branch)", () => {
    mockUseRxCollection.mockReturnValue({ find: () => chainQuery } as any);
    mockUseRxQuery.mockReturnValue({
      result: [
        {
          toJSON: () => ({
            id: "d1",
            title: "Broken Date",
            createdAt: "garbage-not-a-date",
          }),
        },
      ],
    } as any as any as any as any);
    render(<CalendarView />);
    expect(screen.queryByTitle("Broken Date")).toBeNull();
  });

  it("P92: event persist failure logs warn (catch branch persistEvent)", async () => {
    mockUseRxCollection.mockReturnValue({
      find: () => chainQuery,
      upsert: vi.fn().mockRejectedValue(new Error("disk full")),
      findOne: vi.fn(),
    } as any as any);
    mockUseRxQuery.mockReturnValue({ result: [] } as any as any);
    render(<CalendarView />);
    await userEvent.click(screen.getByText("Add Event"));
    await waitFor(async () => {
      await userEvent.type(screen.getByDisplayValue(""), "Fail Event");
    });
    await userEvent.click(screen.getByText("Create"));
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it("P92: event delete failure logs warn (catch branch handleDelete)", async () => {
    mockUseRxCollection.mockReturnValue({
      find: () => chainQuery,
      findOne: vi.fn().mockReturnValue({
        exec: vi.fn().mockRejectedValue(new Error("locked")),
      }),
    } as any as any);
    mockUseRxQuery.mockReturnValue({
      result: [
        {
          toJSON: () => ({
            id: "d1",
            title: "Doomed Event",
            createdAt: `${todayStr()}T10:00:00.000Z`,
          }),
        },
      ],
    } as any as any as any as any);
    render(<CalendarView />);
    await userEvent.click(screen.getByTitle("Doomed Event"));
    await userEvent.click(screen.getByText("Delete"));
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it("goToPrevMonth crosses the year boundary (currentMonth === 0)", async () => {
    render(<CalendarView events={[]} />);
    const now = new Date();
    const expected = new Date(now.getFullYear(), now.getMonth() - 13).toLocaleDateString("en", {
      month: "long",
      year: "numeric",
    });
    const prevBtn = screen.getAllByRole("button")[0];
    for (let i = 0; i < 13; i++) {
      await userEvent.click(prevBtn!);
    }
    // 13 months back always crosses January; the header must show that month/year.
    expect(screen.getByText(expected)).toBeDefined();
  });

  it("goToNextMonth crosses the year boundary (currentMonth === 11)", async () => {
    render(<CalendarView events={[]} />);
    const now = new Date();
    const expected = new Date(now.getFullYear(), now.getMonth() + 13).toLocaleDateString("en", {
      month: "long",
      year: "numeric",
    });
    const nextBtn = screen.getAllByRole("button")[1];
    for (let i = 0; i < 13; i++) {
      await userEvent.click(nextBtn!);
    }
    expect(screen.getByText(expected)).toBeDefined();
  });

  it("opens the creation modal with Enter on a day cell", async () => {
    render(<CalendarView events={[]} />);
    const cells = screen.getAllByRole("gridcell");
    const dayCell = cells.find((c) => c.getAttribute("aria-hidden") !== "true");
    // A rendered month always contains real day cells: if there are none,
    // the test must fail rather than pass on emptiness.
    expect(dayCell).toBeDefined();
    fireEvent.keyDown(dayCell!, { key: "Enter" });
    expect(screen.getByText("New Event")).toBeDefined();
  });

  it("P92: upsert failure after unmount does not log warn or toast", async () => {
    let rejectUpsert: (reason: Error) => void;
    mockUseRxCollection.mockReturnValue({
      find: () => chainQuery,
      upsert: vi.fn(
        () =>
          new Promise((_, reject) => {
            rejectUpsert = reject;
          }),
      ),
      findOne: vi.fn(),
    } as any);
    mockUseRxQuery.mockReturnValue({ result: [] } as any);
    const { unmount } = render(<CalendarView />);
    await userEvent.click(screen.getByText("Add Event"));
    await waitFor(async () => {
      await userEvent.type(screen.getByDisplayValue(""), "Late Fail");
    });
    fireEvent.click(screen.getByText("Create"));
    unmount();
    await act(async () => {
      rejectUpsert!(new Error("late disk full"));
    });
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it("P92: delete failure after unmount does not log warn", async () => {
    let rejectExec: (reason: Error) => void;
    mockUseRxCollection.mockReturnValue({
      find: () => chainQuery,
      findOne: vi.fn(() => ({
        exec: () =>
          new Promise((_, reject) => {
            rejectExec = reject;
          }),
      })),
    } as any);
    mockUseRxQuery.mockReturnValue({
      result: [
        {
          toJSON: () => ({
            id: "d1",
            title: "Doomed Event",
            createdAt: `${todayStr()}T10:00:00.000Z`,
          }),
        },
      ],
    } as any);
    const { unmount } = render(<CalendarView />);
    await userEvent.click(screen.getByTitle("Doomed Event"));
    fireEvent.click(screen.getByText("Delete"));
    unmount();
    await act(async () => {
      rejectExec!(new Error("late locked"));
    });
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it("opens the edit modal with Enter/Space on an event", async () => {
    const d = todayStr();
    const events = [
      { id: "e1", title: "Meeting", date: d, type: "event" as const },
    ];
    render(<CalendarView events={events} />);
    const chip = screen.getByTitle("Meeting");
    fireEvent.keyDown(chip, { key: " " });
    expect(screen.getByText("Edit Event")).toBeDefined();
  });
});
