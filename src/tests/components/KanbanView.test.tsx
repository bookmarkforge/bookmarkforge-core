
import { describe, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
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
    return { t };
  },
}));

vi.mock("motion/react", async () => {
  const { createMotionMock } = await import("../mocks/motion");
  return createMotionMock();
});

// P92: KanbanView reads RxDB reactively in uncontrolled mode — mock
// the RxDB React adapter so the /kanban route path renders without a real provider.
// The collection mock must return a chainable find().where().eq() because
// the component calls docsCollection?.find().where("isDeleted").eq(false)
// unconditionally (hooks cannot be conditional) — even in controlled mode.
const { mockUseRxCollection, mockUseRxQuery, chainQuery } = vi.hoisted(() => {
  const chainQuery = { where: () => ({ eq: () => ({}) }) };
  return {
    mockUseRxCollection: vi.fn<(...args: any[]) => any>(() => undefined),
    mockUseRxQuery: vi.fn<(...args: any[]) => any>(() => ({ result: [] })),
    chainQuery,
  };
});
vi.mock("../../hooks/useRxDB", () => ({
  useRxCollection: mockUseRxCollection,
  useRxQuery: mockUseRxQuery,
}));

import KanbanView from "../../components/kanban/KanbanView";

const mockColumns = [
  {
    id: "1",
    title: "To Do",
    items: [
      { id: "a", title: "Task 1", type: "task" as const },
      { id: "a2", title: "Task 1b", type: "bug" as const, description: "desc here" },
    ],
  },
  {
    id: "2",
    title: "In Progress",
    items: [{ id: "x", title: "WIP Item", type: "feature" as const }],
  },
  {
    id: "3",
    title: "Done",
    items: [
      { id: "b", title: "Task 2", type: "feature" as const },
    ],
  },
];

const emptyColumns = [
  { id: "e1", title: "Empty Col", items: [] },
];

const mixedColumns = [
  { id: "c1", title: "Source", items: [{ id: "t1", title: "Move Me", type: "task" as const }] },
  { id: "c2", title: "Target", items: [] },
];

function getFirstColumnPlusBtn(): HTMLElement {
  return screen.getAllByRole("button").find(
    (btn) => btn.querySelector("svg") && btn.closest('[role="region"]')
  )!;
}

function getPlusBtnForColumn(columnIdx: number): HTMLElement {
  const regions = document.querySelectorAll('[role="region"]');
  return Array.from(regions[columnIdx]!.querySelectorAll('button'))
    .find((btn) => btn.querySelector('svg'))!;
}

describe("KanbanView", () => {
  beforeEach(() => {
    mockUseRxCollection.mockReset();
    mockUseRxQuery.mockReset();
    mockUseRxCollection.mockReturnValue(undefined);
    mockUseRxQuery.mockReturnValue({ result: [] });
    // The logger mock persists across tests in the file: without clear, an
    // `toHaveBeenCalled()` assertion in an error-branch test could
    // pass because of a warn call from an earlier test.
    mockLogger.warn.mockClear();
    mockLogger.error.mockClear();
  });

  it("renders the board title", () => {
    render(<KanbanView columns={mockColumns} />);
    expect(screen.getByText("Kanban Board")).toBeDefined();
  });

  it("renders all columns", () => {
    render(<KanbanView columns={mockColumns} />);
    expect(screen.getByText("To Do")).toBeDefined();
    expect(screen.getByText("In Progress")).toBeDefined();
    expect(screen.getByText("Done")).toBeDefined();
  });

  it("renders items within columns", () => {
    render(<KanbanView columns={mockColumns} />);
    expect(screen.getByText("Task 1")).toBeDefined();
    expect(screen.getByText("Task 2")).toBeDefined();
  });

  it("P92: no demo columns — honest empty state when no data provided", () => {
    render(<KanbanView />);
    expect(screen.getByText("No columns yet")).toBeDefined();
    // Fake CI/CD tasks must never leak into production.
    expect(screen.queryByText("Set up CI/CD pipeline")).toBeNull();
    expect(screen.queryByText("Fix login redirect bug")).toBeNull();
  });

  it("P92: reads documents × folders from RxDB reactively without columns prop", () => {
    mockUseRxCollection.mockReturnValue({ find: () => chainQuery });
    // First useRxQuery call = documents, second = folders.
    mockUseRxQuery
      .mockReturnValueOnce({
        result: [
          {
            toJSON: () => ({
              id: "d1",
              title: "Real Doc A",
              folderId: "f1",
            }),
          },
          {
            toJSON: () => ({
              id: "d2",
              title: "Root Doc",
              folderId: "root",
            }),
          },
        ],
      })
      .mockReturnValueOnce({
        result: [{ toJSON: () => ({ id: "f1", title: "Work" }) }],
      });
    render(<KanbanView />);
    // Folder becomes a column, its document a card.
    expect(screen.getByText("Work")).toBeDefined();
    expect(screen.getByText("Real Doc A")).toBeDefined();
    // Root-level documents land in the honest Unfiled column.
    expect(screen.getByText("Unfiled")).toBeDefined();
    expect(screen.getByText("Root Doc")).toBeDefined();
  });

  it("renders card count in header", () => {
    render(<KanbanView columns={mockColumns} />);
    expect(screen.getByText(/cards/)).toBeDefined();
  });

  it("calls onItemDelete when delete button clicked", async () => {
    const onDelete = vi.fn();
    render(<KanbanView columns={mockColumns} onItemDelete={onDelete} />);
    const deleteBtns = screen.getAllByTitle("Delete");
    await userEvent.click(deleteBtns[0]!);
    expect(onDelete).toHaveBeenCalledWith("a", "1");
  });

  it("adds a new column on Add Column button click", async () => {
    render(<KanbanView columns={mockColumns} />);
    await userEvent.click(screen.getByText("Add Column"));
    expect(screen.getByText("New Column")).toBeDefined();
  });

  it("shows 'No cards' message for empty columns", () => {
    render(<KanbanView columns={emptyColumns} />);
    expect(screen.getByText("No cards")).toBeDefined();
  });

  it("renders card descriptions", () => {
    render(<KanbanView columns={mockColumns} />);
    expect(screen.getByText("desc here")).toBeDefined();
  });

  it("calls onItemClick when card is clicked", async () => {
    const onItemClick = vi.fn();
    render(<KanbanView columns={mockColumns} onItemClick={onItemClick} />);
    await userEvent.click(screen.getByText("Task 1"));
    expect(onItemClick).toHaveBeenCalledWith("a");
  });

  it("calls onItemClick on Enter key", async () => {
    const onItemClick = vi.fn();
    render(<KanbanView columns={mockColumns} onItemClick={onItemClick} />);
    // Cards are now native <button> elements: keyboard activation (Enter) is
    // the browser's built-in behavior, so we focus and press Enter via userEvent.
    const card = screen.getByText("Task 1").closest("button")!;
    card.focus();
    await userEvent.keyboard("{Enter}");
    expect(onItemClick).toHaveBeenCalledWith("a");
  });

  it("calls onItemClick on Space key", async () => {
    const onItemClick = vi.fn();
    render(<KanbanView columns={mockColumns} onItemClick={onItemClick} />);
    const card = screen.getByText("Task 1").closest("button")!;
    card.focus();
    await userEvent.keyboard("{ }");
    expect(onItemClick).toHaveBeenCalledWith("a");
  });

  it("shows type color dots for typed items", () => {
    render(<KanbanView columns={mockColumns} />);
    const dots = document.querySelectorAll(".rounded-full");
    expect(dots.length).toBeGreaterThanOrEqual(2);
  });

  it("drag start sets draggedItem state", () => {
    render(<KanbanView columns={mockColumns} />);
    const card = screen.getByText("Task 1").closest("[data-drag-index]")!;
    fireEvent.dragStart(card);
  });

  it("drag over and drop on same column does not call onItemMove", () => {
    const onItemMove = vi.fn();
    render(<KanbanView columns={mockColumns} onItemMove={onItemMove} />);
    const card = screen.getByText("Task 1").closest("[data-drag-index]")!;
    const fromCol = screen.getByText("To Do").closest("[role='region']")!;
    fireEvent.dragStart(card);
    fireEvent.dragOver(fromCol, { clientY: 100 });
    fireEvent.drop(fromCol, { clientY: 100 });
    expect(onItemMove).not.toHaveBeenCalled();
  });

  it("renders GripVertical icon in column headers", () => {
    render(<KanbanView columns={mockColumns} />);
    const gripIcons = document.querySelectorAll(".cursor-grab");
    expect(gripIcons.length).toBeGreaterThanOrEqual(3);
  });

  it("renders per-column item count badges", () => {
    render(<KanbanView columns={mockColumns} />);
    const badges = document.querySelectorAll(".rounded-full");
    expect(badges.length).toBeGreaterThanOrEqual(3);
  });

  it("renders empty list role for column items", () => {
    render(<KanbanView columns={mockColumns} />);
    const lists = screen.getAllByRole("list");
    expect(lists.length).toBeGreaterThanOrEqual(3);
  });

  // ── Inline add card flow ──

  it("shows inline input when clicking the column +", async () => {
    render(<KanbanView columns={mockColumns} />);
    await userEvent.click(getFirstColumnPlusBtn());
    expect(screen.getByPlaceholderText("Card title...")).toBeDefined();
  });

  it("confirms new card with Check button", async () => {
    render(<KanbanView columns={mockColumns} />);
    await userEvent.click(getFirstColumnPlusBtn());
    const input = screen.getByPlaceholderText("Card title...");
    await userEvent.type(input, "New Kanban Card");
    await userEvent.click(screen.getByLabelText("Confirm"));
    expect(screen.getByText("New Kanban Card")).toBeDefined();
  });

  it("confirma tarjeta con Enter en el input inline", async () => {
    render(<KanbanView columns={mockColumns} />);
    await userEvent.click(getFirstColumnPlusBtn());
    const input = screen.getByPlaceholderText("Card title...");
    await userEvent.type(input, "Enter Card");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("Enter Card")).toBeDefined();
  });

  it("cancels a new card with Escape in the inline input", async () => {
    render(<KanbanView columns={mockColumns} />);
    await userEvent.click(getFirstColumnPlusBtn());
    const input = screen.getByPlaceholderText("Card title...");
    await userEvent.type(input, "Cancel Me");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByPlaceholderText("Card title...")).toBeNull();
    expect(screen.queryByText("Cancel Me")).toBeNull();
  });

  it("cancels new card with X button", async () => {
    render(<KanbanView columns={mockColumns} />);
    await userEvent.click(getFirstColumnPlusBtn());
    const input = screen.getByPlaceholderText("Card title...");
    await userEvent.type(input, "X Cancel");
    await userEvent.click(screen.getByLabelText("Cancel"));
    expect(screen.queryByText("X Cancel")).toBeNull();
  });

  it("disables Confirm button when input is empty", async () => {
    render(<KanbanView columns={mockColumns} />);
    await userEvent.click(getFirstColumnPlusBtn());
    const confirmBtn = screen.getByLabelText("Confirm");
    expect((confirmBtn as HTMLButtonElement).disabled).toBe(true);
  });

  // ── Cross-column drag and drop ──

  it("calls onItemMove when dropping on a different column", () => {
    const onItemMove = vi.fn();
    render(<KanbanView columns={mockColumns} onItemMove={onItemMove} />);
    const card = screen.getByText("Task 1").closest("[data-drag-index]")!;
    const toCol = screen.getByText("In Progress").closest("[role='region']")!;
    // dragOver must fire first to set dropTarget.current via handleDragOver
    const toColList = toCol!.querySelector('[role="list"]')!;
    fireEvent.dragStart(card);
    fireEvent.dragOver(toColList, { clientY: 50 });
    fireEvent.drop(toCol!);
    expect(onItemMove).toHaveBeenCalledWith("a", "1", "2");
  });

  it("drop sin draggedItem no lanza error", () => {
    const onItemMove = vi.fn();
    render(<KanbanView columns={mockColumns} onItemMove={onItemMove} />);
    const toCol = screen.getByText("Done").closest("[role='region']")!;
    // Drop without dragStart should not throw
    expect(() => fireEvent.drop(toCol)).not.toThrow();
    expect(onItemMove).not.toHaveBeenCalled();
  });

  // ── Branch coverage: visual drag + drop target + empty column ──

  it("applies opacity-40 class to the item being dragged", () => {
    render(<KanbanView columns={mockColumns} />);
    const card = screen.getByText("Task 1").closest("[data-drag-index]")!;
    // Before drag: no opacity class
    expect(card.className).not.toContain("opacity-40");
    fireEvent.dragStart(card);
    // After dragStart, draggedItem matches this card → opacity-40
    expect(card.className).toContain("opacity-40");
  });

  it("handleDragOver on empty column does not throw (if-cards guard branch)", () => {
    // Use columns where the first col has items and second is empty
    const mixedCols = [
      { id: "c1", title: "With Items", items: [{ id: "t1", title: "Drag Me", type: "task" as const }] },
      { id: "c2", title: "Empty Col", items: [] },
    ];
    render(<KanbanView columns={mixedCols} />);
    const card = screen.getByText("Drag Me").closest("[data-drag-index]")!;
    const emptyCol = screen.getByText("Empty Col").closest("[role='region']")!;
    const emptyColList = emptyCol!.querySelector('[role="list"]')!;
    // dragOver on empty column should not throw (if (cards) guard)
    fireEvent.dragStart(card);
    expect(() =>
      fireEvent.dragOver(emptyColList, { clientY: 50 })
    ).not.toThrow();
  });

  it("moves item to empty column via drag and drop", () => {
    const onItemMove = vi.fn();
    const mixedCols = [
      { id: "c1", title: "Source", items: [{ id: "t1", title: "Move Me", type: "task" as const }] },
      { id: "c2", title: "Target", items: [] },
    ];
    render(<KanbanView columns={mixedCols} onItemMove={onItemMove} />);
    const card = screen.getByText("Move Me").closest("[data-drag-index]")!;
    const targetCol = screen.getByText("Target").closest("[role='region']")!;
    const targetColList = targetCol!.querySelector('[role="list"]')!;
    fireEvent.dragStart(card);
    fireEvent.dragOver(targetColList, { clientY: 50 });
    fireEvent.drop(targetCol!);
    expect(onItemMove).toHaveBeenCalledWith("t1", "c1", "c2");
  });

  it("drop con draggedItem pero sin dragOver previo no llama onItemMove", () => {
    const onItemMove = vi.fn();
    render(<KanbanView columns={mockColumns} onItemMove={onItemMove} />);
    const card = screen.getByText("Task 1").closest("[data-drag-index]")!;
    const toCol = screen.getByText("In Progress").closest("[role='region']")!;
    // Start drag but skip dragOver → dropTarget.current stays null.
    // Wrap in act() so React processes the setDraggedItem(null) state
    // update synchronously — without act(), the deferred reconciliation
    // can hang under memory pressure when run inside the bounded runner
    // with many files in one Vitest process.
    act(() => {
      fireEvent.dragStart(card);
      fireEvent.drop(toCol);
    });
    // onItemMove should NOT be called because dropTarget.current is null
    expect(onItemMove).not.toHaveBeenCalled();
  });

  // ── P92 uncontrolled mode: real RxDB writes + error branches ──

  it("P92: deletes the card in uncontrolled mode (patch isDeleted)", async () => {
    const patch = vi.fn().mockResolvedValue(undefined);
    const findOne = vi.fn().mockReturnValue({
      exec: vi.fn().mockResolvedValue({ incrementalPatch: patch }),
    });
    mockUseRxCollection.mockReturnValue({ find: () => chainQuery, findOne });
    mockUseRxQuery
      .mockReturnValueOnce({
        result: [
          { toJSON: () => ({ id: "d1", title: "Doc A", folderId: "f1" }) },
        ],
      })
      .mockReturnValueOnce({
        result: [{ toJSON: () => ({ id: "f1", title: "Work" }) }],
      });
    render(<KanbanView />);
    await userEvent.click(screen.getAllByTitle("Delete")[0]!);
    expect(findOne).toHaveBeenCalledWith("d1");
    expect(patch).toHaveBeenCalledWith(
      expect.objectContaining({ isDeleted: true, updatedAt: expect.any(String) }),
    );
  });

  it("P92: delete failure logs warn and toast (catch branch)", async () => {
    mockUseRxCollection.mockReturnValue({
      find: () => chainQuery,
      findOne: vi.fn().mockRejectedValue(new Error("db down")),
    });
    mockUseRxQuery
      .mockReturnValueOnce({
        result: [
          { toJSON: () => ({ id: "d1", title: "Doc A", folderId: "f1" }) },
        ],
      })
      .mockReturnValueOnce({
        result: [{ toJSON: () => ({ id: "f1", title: "Work" }) }],
      });
    render(<KanbanView />);
    await userEvent.click(screen.getAllByTitle("Delete")[0]!);
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it("P92: adds column in uncontrolled mode (upsert folder)", async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    mockUseRxCollection.mockReturnValue({ find: () => chainQuery, upsert });
    mockUseRxQuery
      .mockReturnValueOnce({ result: [] })
      .mockReturnValueOnce({ result: [] });
    render(<KanbanView />);
    await userEvent.click(screen.getByText("Add Column"));
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ title: "New Column" }),
    );
  });

  it("P92: moves a card between columns in uncontrolled mode (patch folderId)", async () => {
    const patch = vi.fn().mockResolvedValue(undefined);
    const findOne = vi.fn().mockReturnValue({
      exec: vi.fn().mockResolvedValue({ incrementalPatch: patch }),
    });
    mockUseRxCollection.mockReturnValue({ find: () => chainQuery, findOne });
    // mockImplementation persistente: el componente vuelve a llamar useRxQuery
    // on every re-render (dragStart changes state), so mockReturnValueOnce
    // would run out and the columns would disappear after the first render.
    const docsResult = [
      { toJSON: () => ({ id: "d1", title: "Doc A", folderId: "f1" }) },
    ];
    const foldersResult = [
      { toJSON: () => ({ id: "f1", title: "Work" }) },
      { toJSON: () => ({ id: "f2", title: "Later" }) },
    ];
    let rxCall = 0;
    mockUseRxQuery.mockImplementation(() => {
      const result = rxCall % 2 === 0 ? docsResult : foldersResult;
      rxCall += 1;
      return { result };
    });
    render(<KanbanView />);
    const card = screen.getByText("Doc A").closest("[data-drag-index]")!;
    const toCol = screen.getByText("Later").closest("[role='region']")!;
    fireEvent.dragStart(card);
    fireEvent.dragOver(toCol!.querySelector('[role="list"]')!, {
      clientY: 50,
    });
    fireEvent.drop(toCol!);
    // handleDrop is async (await findOne().exec()): fireEvent is synchronous,
    // so the assertions must wait for the microtask of the await
    // to flush before doc.incrementalPatch becomes observable.
    await waitFor(() => {
      expect(findOne).toHaveBeenCalledWith("d1");
      expect(patch).toHaveBeenCalledWith({ folderId: "f2" });
    });
  });

  it("P92: adds card in uncontrolled mode (upsert document)", async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    mockUseRxCollection.mockReturnValue({ find: () => chainQuery, upsert });
    // Same as the previous test: the addingTo state causes a re-render that
    // calls useRxQuery again, so the mock must be persistent.
    const foldersResult = [{ toJSON: () => ({ id: "f1", title: "Work" }) }];
    let rxCall = 0;
    mockUseRxQuery.mockImplementation(() => {
      const result = rxCall % 2 === 0 ? [] : foldersResult;
      rxCall += 1;
      return { result };
    });
    render(<KanbanView />);
    await userEvent.click(getPlusBtnForColumn(0));
    await userEvent.type(
      screen.getByPlaceholderText("Card title..."),
      "New Card",
    );
    await userEvent.click(screen.getByLabelText("Confirm"));
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ title: "New Card", folderId: "f1" }),
    );
  });

  it("P92: failure to add column logs warn (catch addColumn branch)", async () => {
    mockUseRxCollection.mockReturnValue({
      find: () => chainQuery,
      upsert: vi.fn().mockRejectedValue(new Error("insert failed")),
    });
    mockUseRxQuery
      .mockReturnValueOnce({ result: [] })
      .mockReturnValueOnce({ result: [] });
    render(<KanbanView />);
    await userEvent.click(screen.getByText("Add Column"));
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it("P92: move failure logs warn (catch branch handleDrop)", async () => {
    mockUseRxCollection.mockReturnValue({
      find: () => chainQuery,
      findOne: vi.fn().mockReturnValue({
        exec: vi.fn().mockRejectedValue(new Error("move failed")),
      }),
    });
    const docsResult = [
      { toJSON: () => ({ id: "d1", title: "Doc A", folderId: "f1" }) },
    ];
    const foldersResult = [
      { toJSON: () => ({ id: "f1", title: "Work" }) },
      { toJSON: () => ({ id: "f2", title: "Later" }) },
    ];
    let rxCall = 0;
    mockUseRxQuery.mockImplementation(() => {
      const result = rxCall % 2 === 0 ? docsResult : foldersResult;
      rxCall += 1;
      return { result };
    });
    render(<KanbanView />);
    const card = screen.getByText("Doc A").closest("[data-drag-index]")!;
    const toCol = screen.getByText("Later").closest("[role='region']")!;
    fireEvent.dragStart(card);
    fireEvent.dragOver(toCol!.querySelector('[role="list"]')!, {
      clientY: 50,
    });
    fireEvent.drop(toCol!);
    await waitFor(() => expect(mockLogger.warn).toHaveBeenCalled());
  });

  it("P92: failure to add card logs warn (catch confirmAddCard branch)", async () => {
    mockUseRxCollection.mockReturnValue({
      find: () => chainQuery,
      upsert: vi.fn().mockRejectedValue(new Error("insert failed")),
    });
    const foldersResult = [{ toJSON: () => ({ id: "f1", title: "Work" }) }];
    let rxCall = 0;
    mockUseRxQuery.mockImplementation(() => {
      const result = rxCall % 2 === 0 ? [] : foldersResult;
      rxCall += 1;
      return { result };
    });
    render(<KanbanView />);
    await userEvent.click(getPlusBtnForColumn(0));
    await userEvent.type(
      screen.getByPlaceholderText("Card title..."),
      "Fail Card",
    );
    await userEvent.click(screen.getByLabelText("Confirm"));
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it("P92: delete failure after unmount does not log warn or toast", async () => {
    let rejectExec: (reason: Error) => void;
    mockUseRxCollection.mockReturnValue({
      find: () => chainQuery,
      findOne: vi.fn(() => ({
        exec: () =>
          new Promise((_, reject) => {
            rejectExec = reject;
          }),
      })),
    });
    mockUseRxQuery
      .mockReturnValueOnce({
        result: [
          { toJSON: () => ({ id: "d1", title: "Doc A", folderId: "f1" }) },
        ],
      })
      .mockReturnValueOnce({
        result: [{ toJSON: () => ({ id: "f1", title: "Work" }) }],
      });
    const { unmount } = render(<KanbanView />);
    fireEvent.click(screen.getAllByTitle("Delete")[0]!);
    unmount();
    await act(async () => {
      rejectExec!(new Error("late db down"));
    });
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it("P92: drop failure after unmount does not log warn", async () => {
    let rejectExec: (reason: Error) => void;
    mockUseRxCollection.mockReturnValue({
      find: () => chainQuery,
      findOne: vi.fn(() => ({
        exec: () =>
          new Promise((_, reject) => {
            rejectExec = reject;
          }),
      })),
    });
    const docsResult = [
      { toJSON: () => ({ id: "d1", title: "Doc A", folderId: "f1" }) },
    ];
    const foldersResult = [
      { toJSON: () => ({ id: "f1", title: "Work" }) },
      { toJSON: () => ({ id: "f2", title: "Later" }) },
    ];
    let rxCall = 0;
    mockUseRxQuery.mockImplementation(() => {
      const result = rxCall % 2 === 0 ? docsResult : foldersResult;
      rxCall += 1;
      return { result };
    });
    const { unmount } = render(<KanbanView />);
    const card = screen.getByText("Doc A").closest("[data-drag-index]")!;
    const toCol = screen.getByText("Later").closest("[role='region']")!;
    fireEvent.dragStart(card);
    fireEvent.dragOver(toCol!.querySelector('[role="list"]')!, {
      clientY: 50,
    });
    fireEvent.drop(toCol!);
    unmount();
    await act(async () => {
      rejectExec!(new Error("late move failed"));
    });
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it("P92: drop on the same column in uncontrolled mode does not touch RxDB (early return)", async () => {
    // El early-return `draggedItem.from === toColId` del modo no controlado
    // must not call findOne or patch (nothing to persist).
    const findOne = vi.fn();
    mockUseRxCollection.mockReturnValue({ find: () => chainQuery, findOne });
    const docsResult = [
      { toJSON: () => ({ id: "d1", title: "Doc A", folderId: "f1" }) },
    ];
    const foldersResult = [{ toJSON: () => ({ id: "f1", title: "Work" }) }];
    let rxCall = 0;
    mockUseRxQuery.mockImplementation(() => {
      const result = rxCall % 2 === 0 ? docsResult : foldersResult;
      rxCall += 1;
      return { result };
    });
    render(<KanbanView />);
    const card = screen.getByText("Doc A").closest("[data-drag-index]")!;
    const fromCol = screen.getByText("Work").closest("[role='region']")!;
    fireEvent.dragStart(card);
    fireEvent.dragOver(fromCol!.querySelector('[role="list"]')!, {
      clientY: 50,
    });
    fireEvent.drop(fromCol!);
    expect(findOne).not.toHaveBeenCalled();
  });
});
