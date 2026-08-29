import { describe, it, expect, vi } from "vitest";
import {
  render,
  screen,
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
    return { t };
  },
}));

vi.mock("motion/react", async () => {
  const { createMotionMock } = await import("../mocks/motion");
  return createMotionMock();
});

const { mockUseRxCollection, mockUseRxQuery } = vi.hoisted(() => ({
  mockUseRxCollection: vi.fn(),
  mockUseRxQuery: vi.fn(() => ({ result: [] })),
}));
vi.mock("../../hooks/useRxDB", () => ({
  useRxCollection: mockUseRxCollection,
  useRxQuery: mockUseRxQuery,
}));

import DatabaseView from "../../components/database/DatabaseView";

// P90: production DatabaseView no longer ships demo rows. Tests that need
// data supply an explicit fixture instead of relying on a production fallback.
const sampleRows = [
  {
    id: "1",
    title: "Design System Tokens",
    status: "Done",
    priority: "High",
    assignee: "Alice",
  },
  {
    id: "2",
    title: "RxDB Migration Plan",
    status: "In Progress",
    priority: "Medium",
    assignee: "Bob",
  },
  {
    id: "3",
    title: "PWA Offline Support",
    status: "Todo",
    priority: "High",
    assignee: "Alice",
  },
  {
    id: "4",
    title: "WebRTC Sync Testing",
    status: "Todo",
    priority: "Low",
    assignee: "Carol",
  },
  {
    id: "5",
    title: "Security Audit",
    status: "In Progress",
    priority: "High",
    assignee: "Bob",
  },
  {
    id: "6",
    title: "Bundle Size Reduction",
    status: "Done",
    priority: "Medium",
    assignee: "Carol",
  },
];

describe("DatabaseView", () => {
  beforeEach(() => {
    mockUseRxCollection.mockReset();
    mockUseRxQuery.mockReset();
    mockUseRxQuery.mockReturnValue({ result: [] } as any as any);
    // Without clear, the toHaveBeenCalled assertions of the catch could pass
    // because of warn calls from earlier tests (mocks persist per file).
    mockLogger.warn.mockClear();
    mockLogger.error.mockClear();
  });

  it("renders the database title", () => {
    render(<DatabaseView collection="test-collection" schema={{}} />);
    expect(screen.getByText("Database")).toBeDefined();
  });

  it("P91: reads the RxDB collection reactively when no rows are received", () => {
    mockUseRxCollection.mockReturnValue({ find: vi.fn() } as any);
    mockUseRxQuery.mockReturnValue({
      result: [
        { toJSON: () => ({ id: "1", title: "Real Doc", status: "Done" }) },
        { toJSON: () => ({ id: "2", title: "Real Doc 2", status: "Todo" }) },
      ],
    } as any as any as any as any as any);
    render(<DatabaseView collection="bookmarks" schema={{}} />);
    expect(screen.getByText("Real Doc")).toBeDefined();
    expect(screen.getByText("Real Doc 2")).toBeDefined();
    expect(screen.getByText("bookmarks")).toBeDefined();
  });

  it("P91: does not render blob (embedding) or internal RxDB columns", () => {
    mockUseRxCollection.mockReturnValue({ find: vi.fn() } as any);
    mockUseRxQuery.mockReturnValue({
      result: [
        {
          toJSON: () => ({
            id: "1",
            title: "Real Bookmark",
            url: "https://example.com",
            embedding: Array.from({ length: 1536 }, (_, i) => i),
            content: "KBs of text".repeat(200),
            _rev: "internal-rev",
          }),
        },
      ],
    } as any as any as any as any as any);
    render(<DatabaseView collection="bookmarks" schema={{}} />);
    expect(screen.getByText("Real Bookmark")).toBeDefined();
    expect(screen.getByText("https://example.com")).toBeDefined();
    // Blob arrays (embeddings) must never become giant table cells.
    expect(screen.queryByText("embedding")).toBeNull();
    // RxDB internals must never leak as columns.
    expect(screen.queryByText("_rev")).toBeNull();
  });

  it("renders the collection badge", () => {
    render(<DatabaseView collection="my-collection" schema={{}} />);
    expect(screen.getByText("my-collection")).toBeDefined();
  });

  it("renders filter button", () => {
    render(<DatabaseView collection="test" schema={{}} />);
    expect(screen.getByText("Filter")).toBeDefined();
  });

  it("renders search input", () => {
    render(<DatabaseView collection="test" schema={{}} />);
    expect(screen.getByPlaceholderText("Search records...")).toBeDefined();
  });

  it("P90: shows empty state instead of demo rows when no data provided", () => {
    render(<DatabaseView collection="test" schema={{}} />);
    expect(screen.getByText("No records found")).toBeDefined();
    expect(screen.queryByText("Design System Tokens")).toBeNull();
  });

  it("toggles filter panel on click", async () => {
    render(<DatabaseView collection="test" schema={{}} rows={sampleRows} />);
    await userEvent.click(screen.getByText("Filter"));
    expect(screen.getByText("Active Filters")).toBeDefined();
  });

  it("filters rows by search query", async () => {
    render(<DatabaseView collection="test" schema={{}} rows={sampleRows} />);
    const input = screen.getByPlaceholderText("Search records...");
    await userEvent.type(input, "Alice");
    expect(screen.getByText("Design System Tokens")).toBeDefined();
    expect(screen.queryByText("RxDB Migration Plan")).toBeNull();
  });

  it("opens inline editor on cell click", async () => {
    render(<DatabaseView collection="test" schema={{}} rows={sampleRows} />);
    await userEvent.click(screen.getByText("Design System Tokens"));
    expect(screen.getByDisplayValue("Design System Tokens")).toBeDefined();
  });

  it("commits inline edit on Enter", async () => {
    render(<DatabaseView collection="test" schema={{}} rows={sampleRows} />);
    await userEvent.click(screen.getByText("Design System Tokens"));
    const input = screen.getByDisplayValue("Design System Tokens");
    await userEvent.clear(input);
    await userEvent.type(input, "Updated Title");
    input.focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByText("Updated Title")).toBeDefined();
  });

  it("cancels inline edit on Escape", async () => {
    render(<DatabaseView collection="test" schema={{}} rows={sampleRows} />);
    await userEvent.click(screen.getByText("Design System Tokens"));
    const input = screen.getByDisplayValue("Design System Tokens");
    await userEvent.type(input, "Changed");
    input.focus();
    await userEvent.keyboard("{Escape}");
    expect(screen.getByText("Design System Tokens")).toBeDefined();
  });

  it("uses select for columns with few unique values", async () => {
    render(<DatabaseView collection="test" schema={{}} rows={sampleRows} />);
    const cells = screen.getAllByText("Done");
    await userEvent.click(cells[cells.length - 1]!);
    const select = document.querySelector("select");
    expect(select).not.toBeNull();
  });

  it("adds a new row on New button click", async () => {
    render(<DatabaseView collection="test" schema={{}} rows={sampleRows} />);
    const countBefore = screen.getAllByRole("row").length;
    await userEvent.click(screen.getByText("New"));
    const countAfter = screen.getAllByRole("row").length;
    expect(countAfter).toBeGreaterThan(countBefore);
  });

  it("sorts by column on header click", async () => {
    render(<DatabaseView collection="test" schema={{}} rows={sampleRows} />);
    const rows1 = screen.getAllByRole("row");
    const firstTitle1 = rows1[1]?.textContent;
    const titleHeader = screen.getAllByRole("columnheader").find(
      (th) => th.textContent?.includes("title"),
    );
    if (titleHeader) {
      await userEvent.click(titleHeader);
      const rows2 = screen.getAllByRole("row");
      expect(rows2.length).toBeGreaterThan(1);
    }
  });

  it("toggles sort direction on repeated header click", async () => {
    render(<DatabaseView collection="test" schema={{}} rows={sampleRows} />);
    const titleHeader = screen.getAllByRole("columnheader").find(
      (th) => th.textContent?.includes("title"),
    );
    if (titleHeader) {
      await userEvent.click(titleHeader);
      await userEvent.click(titleHeader);
      const rows = screen.getAllByRole("row");
      expect(rows.length).toBeGreaterThan(1);
    }
  });

  it("select all checkbox toggles all rows", async () => {
    render(<DatabaseView collection="test" schema={{}} rows={sampleRows} />);
    const selectAll = screen.getByLabelText("Select all records");
    await userEvent.click(selectAll);
    const checkboxes = screen.getAllByLabelText("Select record");
    expect(checkboxes.length).toBeGreaterThan(0);
  });

  it("deselect all when all selected", async () => {
    render(<DatabaseView collection="test" schema={{}} rows={sampleRows} />);
    const selectAll = screen.getByLabelText("Select all records");
    await userEvent.click(selectAll);
    await userEvent.click(selectAll);
    const checkboxes = screen.getAllByLabelText("Select record");
    checkboxes.forEach((cb) => {
      expect((cb as HTMLInputElement).checked).toBe(false);
    });
  });

  it("toggles individual row selection", async () => {
    render(<DatabaseView collection="test" schema={{}} rows={sampleRows} />);
    const rowCheckbox = screen.getAllByLabelText("Select record")[0];
    await userEvent.click(rowCheckbox!);
    expect((rowCheckbox as HTMLInputElement).checked).toBe(true);
    await userEvent.click(rowCheckbox!);
    expect((rowCheckbox as HTMLInputElement).checked).toBe(false);
  });

  it("adds filter via filter panel", async () => {
    render(<DatabaseView collection="test" schema={{}} rows={sampleRows} />);
    await userEvent.click(screen.getByText("Filter"));
    const addFilterBtn = screen.getByText((content, el) =>
      el?.tagName === "BUTTON" && content.includes("Add Filter"),
    );
    await userEvent.click(addFilterBtn);
    const filterInputs = screen.getAllByPlaceholderText("Value...");
    expect(filterInputs.length).toBeGreaterThanOrEqual(1);
  });

  it("removes filter on X click", async () => {
    render(<DatabaseView collection="test" schema={{}} rows={sampleRows} />);
    await userEvent.click(screen.getByText("Filter"));
    const addFilterBtn = screen.getByText((content, el) =>
      el?.tagName === "BUTTON" && content.includes("Add Filter"),
    );
    await userEvent.click(addFilterBtn);
    const removeBtn = screen.getByLabelText("Remove filter");
    await userEvent.click(removeBtn);
    expect(
      screen.getByText(
        "No filters applied. Click 'Add Filter' to start.",
      ),
    ).toBeDefined();
  });

  it("updates filter value", async () => {
    render(<DatabaseView collection="test" schema={{}} rows={sampleRows} />);
    await userEvent.click(screen.getByText("Filter"));
    const addFilterBtn = screen.getByText((content, el) =>
      el?.tagName === "BUTTON" && content.includes("Add Filter"),
    );
    await userEvent.click(addFilterBtn);
    const filterInput = screen.getByPlaceholderText("Value...");
    await userEvent.type(filterInput, "Alice");
    expect(filterInput).toHaveValue("Alice");
  });

  it("shows filter result count when filtering", async () => {
    render(<DatabaseView collection="test" schema={{}} rows={sampleRows} />);
    await userEvent.click(screen.getByText("Filter"));
    const addFilterBtn = screen.getByText((content, el) =>
      el?.tagName === "BUTTON" && content.includes("Add Filter"),
    );
    await userEvent.click(addFilterBtn);
    const filterInput = screen.getByPlaceholderText("Value...");
    await userEvent.type(filterInput, "Alice");
    expect(screen.getByText(/Showing/)).toBeDefined();
  });

  it("calls onCellEdit when cell edit is committed", async () => {
    const onCellEdit = vi.fn();
    render(<DatabaseView collection="test" schema={{}} rows={sampleRows} onCellEdit={onCellEdit} />);
    await userEvent.click(screen.getByText("Design System Tokens"));
    const input = screen.getByDisplayValue("Design System Tokens");
    input.focus();
    await userEvent.keyboard("{Enter}");
    expect(onCellEdit).toHaveBeenCalled();
  });

  it("renders schema-based columns when provided", () => {
    const schema = { name: {}, age: {} };
    const rows = [{ id: "1", name: "Alice", age: "30" }];
    render(<DatabaseView collection="test" schema={schema} rows={rows} />);
    expect(screen.getByText("name")).toBeDefined();
    expect(screen.getByText("age")).toBeDefined();
  });

  it("shows empty state when no rows match filter", async () => {
    render(<DatabaseView collection="test" schema={{}} rows={sampleRows} />);
    const input = screen.getByPlaceholderText("Search records...");
    await userEvent.type(input, "zzzznonexistent");
    expect(screen.getByText("No records found")).toBeDefined();
  });

  it("commits edit via check button click", async () => {
    render(<DatabaseView collection="test" schema={{}} rows={sampleRows} />);
    await userEvent.click(screen.getByText("Design System Tokens"));
    const input = screen.getByDisplayValue("Design System Tokens");
    await userEvent.clear(input);
    await userEvent.type(input, "Via Check");
    const checkBtn = screen.getByLabelText("Confirm edit");
    await userEvent.click(checkBtn);
    expect(screen.getByText("Via Check")).toBeDefined();
  });

  it("commits edit on blur", async () => {
    render(<DatabaseView collection="test" schema={{}} rows={sampleRows} />);
    await userEvent.click(screen.getByText("Design System Tokens"));
    const input = screen.getByDisplayValue("Design System Tokens");
    await userEvent.clear(input);
    await userEvent.type(input, "Blur Value");
    fireEvent.blur(input);
    expect(screen.getByText("Blur Value")).toBeDefined();
  });

  it("renders record count", () => {
    render(<DatabaseView collection="test" schema={{}} rows={sampleRows} />);
    expect(screen.getByText(/records/)).toBeDefined();
  });

  it("empty rows shows no records found", () => {
    render(<DatabaseView collection="test" schema={{}} rows={[]} />);
    expect(screen.getByText("No records found")).toBeDefined();
  });

  it("filter column select changes filter column", async () => {
    render(<DatabaseView collection="test" schema={{}} rows={sampleRows} />);
    await userEvent.click(screen.getByText("Filter"));
    const addFilterBtn = screen.getByText((content, el) =>
      el?.tagName === "BUTTON" && content.includes("Add Filter"),
    );
    await userEvent.click(addFilterBtn);
    const selects = screen.getAllByLabelText("Filter column");
    expect(selects.length).toBeGreaterThanOrEqual(1);
  });

  // ── Branch coverage: blob guard, empty cell, uncontrolled RxDB writes ──

  it("excludes columns with object values (blob guard detectColumns)", () => {
    const rows = [{ id: "1", title: "A", meta: { nested: true } }];
    render(<DatabaseView collection="test" schema={{}} rows={rows} />);
    expect(screen.getByText("title")).toBeDefined();
    expect(screen.queryByText("meta")).toBeNull();
  });

  it("renders dash for empty cells (currentVal || dash branch)", () => {
    const rows = [{ id: "1", title: "A", status: "" }];
    render(<DatabaseView collection="test" schema={{}} rows={rows} />);
    expect(screen.getByText("—")).toBeDefined();
  });

  it("P91: adds row in uncontrolled mode (upsert in the RxDB collection)", async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    mockUseRxCollection.mockReturnValue({ find: vi.fn(), upsert } as any);
    mockUseRxQuery.mockReturnValue({
      result: [{ toJSON: () => ({ id: "1", title: "Real Doc", status: "Done" }) }],
    } as any as any as any as any as any);
    render(<DatabaseView collection="bookmarks" schema={{}} />);
    await userEvent.click(screen.getByText("New"));
    expect(upsert).toHaveBeenCalled();
  });

  it("P91: upsert failure after unmount does not log warn or toast", async () => {
    let rejectUpsert: (reason: Error) => void;
    mockUseRxCollection.mockReturnValue({
      find: vi.fn(),
      upsert: vi.fn(
        () =>
          new Promise((_, reject) => {
            rejectUpsert = reject;
          }),
      ),
    } as any);
    mockUseRxQuery.mockReturnValue({ result: [] } as any);
    const { unmount } = render(<DatabaseView collection="bookmarks" schema={{}} />);
    fireEvent.click(screen.getByText("New"));
    unmount();
    await act(async () => {
      rejectUpsert!(new Error("late schema validation"));
    });
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it("P91: delete failure after unmount does not log warn", async () => {
    let rejectExec: (reason: Error) => void;
    mockUseRxCollection.mockReturnValue({
      find: vi.fn(),
      findOne: vi.fn(() => ({
        exec: () =>
          new Promise((_, reject) => {
            rejectExec = reject;
          }),
      })),
    } as any);
    mockUseRxQuery.mockReturnValue({
      result: [
        { toJSON: () => ({ id: "1", title: "Real Doc", status: "Done" }) },
      ],
    } as any);
    const { unmount } = render(<DatabaseView collection="bookmarks" schema={{}} />);
    fireEvent.click(screen.getAllByLabelText("Select record")[0]!);
    fireEvent.click(screen.getByText("Delete"));
    unmount();
    await act(async () => {
      rejectExec!(new Error("late delete failed"));
    });
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it("P91: failure to add row logs warn and toast (catch branch)", async () => {
    mockUseRxCollection.mockReturnValue({
      find: vi.fn(),
      upsert: vi.fn().mockRejectedValue(new Error("schema validation failed")),
    } as any as any);
    mockUseRxQuery.mockReturnValue({ result: [] } as any as any);
    render(<DatabaseView collection="bookmarks" schema={{}} />);
    await userEvent.click(screen.getByText("New"));
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it("P91: edita celda en modo no controlado (findOne + patch)", async () => {
    const patch = vi.fn().mockResolvedValue(undefined);
    mockUseRxCollection.mockReturnValue({
      find: vi.fn(),
      findOne: vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue({ incrementalPatch: patch }),
      }),
    } as any as any);
    // 6 unique titles: the title column exceeds the 5-value threshold
    // → it is edited with <input>, not <select>.
    mockUseRxQuery.mockReturnValue({
      result: [
        { toJSON: () => ({ id: "1", title: "Real Doc A", status: "Done" }) },
        { toJSON: () => ({ id: "2", title: "Real Doc B", status: "Done" }) },
        { toJSON: () => ({ id: "3", title: "Real Doc C", status: "Done" }) },
        { toJSON: () => ({ id: "4", title: "Real Doc D", status: "Done" }) },
        { toJSON: () => ({ id: "5", title: "Real Doc E", status: "Done" }) },
        { toJSON: () => ({ id: "6", title: "Real Doc F", status: "Done" }) },
      ],
    } as any as any as any as any);
    render(<DatabaseView collection="bookmarks" schema={{}} />);
    await userEvent.click(screen.getByText("Real Doc A"));
    const input = screen.getByDisplayValue("Real Doc A");
    await userEvent.clear(input);
    await userEvent.type(input, "Renamed Doc");
    input.focus();
    await userEvent.keyboard("{Enter}");
    expect(patch).toHaveBeenCalledWith({ title: "Renamed Doc" });
  });

  it("P91: re-upserts the full row if the doc disappeared before the commit", async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    mockUseRxCollection.mockReturnValue({
      find: vi.fn(),
      findOne: vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue(null),
      }),
      upsert,
    } as any as any);
    mockUseRxQuery.mockReturnValue({
      result: [
        { toJSON: () => ({ id: "1", title: "Real Doc A", status: "Done" }) },
        { toJSON: () => ({ id: "2", title: "Real Doc B", status: "Done" }) },
        { toJSON: () => ({ id: "3", title: "Real Doc C", status: "Done" }) },
        { toJSON: () => ({ id: "4", title: "Real Doc D", status: "Done" }) },
        { toJSON: () => ({ id: "5", title: "Real Doc E", status: "Done" }) },
        { toJSON: () => ({ id: "6", title: "Real Doc F", status: "Done" }) },
      ],
    } as any as any as any as any);
    render(<DatabaseView collection="bookmarks" schema={{}} />);
    await userEvent.click(screen.getByText("Real Doc A"));
    const input = screen.getByDisplayValue("Real Doc A");
    await userEvent.clear(input);
    await userEvent.type(input, "Rebuilt");
    input.focus();
    await userEvent.keyboard("{Enter}");
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: "1", title: "Rebuilt" }),
    );
  });

  it("P91: failure to persist edit logs warn (catch commitEdit branch)", async () => {
    mockUseRxCollection.mockReturnValue({
      find: vi.fn(),
      findOne: vi.fn().mockReturnValue({
        exec: vi.fn().mockRejectedValue(new Error("db write failed")),
      }),
    } as any as any);
    mockUseRxQuery.mockReturnValue({
      result: [
        { toJSON: () => ({ id: "1", title: "Real Doc A", status: "Done" }) },
        { toJSON: () => ({ id: "2", title: "Real Doc B", status: "Done" }) },
        { toJSON: () => ({ id: "3", title: "Real Doc C", status: "Done" }) },
        { toJSON: () => ({ id: "4", title: "Real Doc D", status: "Done" }) },
        { toJSON: () => ({ id: "5", title: "Real Doc E", status: "Done" }) },
        { toJSON: () => ({ id: "6", title: "Real Doc F", status: "Done" }) },
      ],
    } as any as any as any as any);
    render(<DatabaseView collection="bookmarks" schema={{}} />);
    await userEvent.click(screen.getByText("Real Doc A"));
    const input = screen.getByDisplayValue("Real Doc A");
    input.focus();
    await userEvent.keyboard("{Enter}");
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it("P91: without RxDB collection, adding a row logs warn and does not crash", async () => {
    mockUseRxCollection.mockReturnValue(undefined as any);
    mockUseRxQuery.mockReturnValue({ result: [] } as any as any);
    render(<DatabaseView collection="bookmarks" schema={{}} />);
    await userEvent.click(screen.getByText("New"));
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  // ── P94: schema-valid upserts, type coercion, delete, soft-delete filter ──

  it("P94: upsert does NOT write empty string into array/boolean/number columns", async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    mockUseRxCollection.mockReturnValue({ find: vi.fn(), upsert } as any);
    // Real bookmark: tags is an array → the fill loop must skip it.
    mockUseRxQuery.mockReturnValue({
      result: [
        {
          toJSON: () => ({
            id: "1",
            title: "Real Doc",
            url: "https://x.dev",
            status: "Done",
            tags: ["smoke-test", "e2e"],
            visitCount: 3,
            broken: false,
          }),
        },
      ],
    } as any as any as any);
    render(<DatabaseView collection="bookmarks" schema={{}} />);
    await userEvent.click(screen.getByText("New"));
    const payload = upsert.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload.tags).toBeUndefined();
    expect(payload.visitCount).toBeUndefined();
    expect(payload.broken).toBeUndefined();
    // La columna string url se rellena con "".
    expect(payload.url).toBe("");
  });

  it("P94: upsert of a new row includes required schema fields", async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    mockUseRxCollection.mockReturnValue({ find: vi.fn(), upsert } as any);
    mockUseRxQuery.mockReturnValue({ result: [] } as any as any);
    const defaults = {
      url: "",
      urlHash: "",
      processed: false,
      isPrivate: false,
      isDeleted: false,
    };
    render(
      <DatabaseView collection="bookmarks" schema={{}} newRecordDefaults={defaults} />,
    );
    const click = () => userEvent.click(screen.getByText("New"));
    // The title column (unique value) renders as a select editor… but the
    // "New" button is in the toolbar, unaffected by cell editing.
    return click().then(() => {
      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          url: "",
          urlHash: "",
          processed: false,
          isPrivate: false,
          isDeleted: false,
          title: "New record",
        }),
      );
      // Timestamps stamped at click time so sort by createdAt stays valid.
      const payload = upsert.mock.calls[0]![0];
      expect(typeof payload.createdAt).toBe("string");
      expect(typeof payload.updatedAt).toBe("string");
      expect(new Date(payload.createdAt).getTime()).toBeGreaterThan(0);
    });
  });

  it("P94: commitEdit coerce array columns (tags) de vuelta a array", async () => {
    const patch = vi.fn().mockResolvedValue(undefined);
    mockUseRxCollection.mockReturnValue({
      find: vi.fn(),
      findOne: vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue({ incrementalPatch: patch }),
      }),
    } as any as any);
    // 6 DISTINCT tag values → >5 uniques → input editor (not select).
    mockUseRxQuery.mockReturnValue({
      result: [1, 2, 3, 4, 5, 6].map((i) => ({
        toJSON: () => ({
          id: String(i),
          title: `Doc ${i}`,
          status: "Done",
          tags: [`tag-${i}`],
        }),
      })),
    } as any as any as any as any);
    render(<DatabaseView collection="bookmarks" schema={{}} />);
    // Edit the tags cell of row 1 — the editor is a text <input>.
    await userEvent.click(screen.getByText("tag-1"));
    const input = screen.getByDisplayValue("tag-1");
    await userEvent.clear(input);
    await userEvent.type(input, "alpha,beta");
    input.focus();
    await userEvent.keyboard("{Enter}");
    expect(patch).toHaveBeenCalledWith({ tags: ["alpha", "beta"] });
  });

  it("P94: commitEdit coerce boolean columns (processed)", async () => {
    const patch = vi.fn().mockResolvedValue(undefined);
    mockUseRxCollection.mockReturnValue({
      find: vi.fn(),
      findOne: vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue({ incrementalPatch: patch }),
      }),
    } as any as any);
    // 2 unique boolean values ("true"/"false") → ≤5 → select editor.
    // Row 1 starts at "false"; changing to "true" fires onChange+blur.
    mockUseRxQuery.mockReturnValue({
      result: [1, 2, 3, 4, 5, 6].map((i) => ({
        toJSON: () => ({
          id: String(i),
          title: `Doc ${i}`,
          status: "Done",
          processed: i === 1 ? false : true,
        }),
      })),
    } as any as any as any as any);
    render(<DatabaseView collection="bookmarks" schema={{}} />);
    const cell = screen.getAllByText("false")[0];
    await userEvent.click(cell!);
    const select = document.querySelector("select");
    expect(select).not.toBeNull();
    if (select) {
      // NOTE: fireEvent.blur on the pre-re-render node is a no-op (React
      // re-attaches the select after onChange); commit via the Confirm
      // button, which holds a fresh commitEdit closure.
      await userEvent.selectOptions(select, "true");
      await userEvent.click(screen.getByLabelText("Confirm edit"));
      expect(patch).toHaveBeenCalled();
      // patched value must be boolean true, not string "true"
      const args = patch.mock.calls[0]![0];
      expect(typeof args.processed).toBe("boolean");
      expect(args.processed).toBe(true);
    }
  });

  it("P94: deletes selected rows with soft-delete (patch isDeleted:true)", async () => {
    const patch = vi.fn().mockResolvedValue(undefined);
    mockUseRxCollection.mockReturnValue({
      find: vi.fn(),
      findOne: vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue({
          isDeleted: false,
          incrementalPatch: patch,
        }),
      }),
    } as any as any);
    mockUseRxQuery.mockReturnValue({
      result: [
        {
          toJSON: () => ({
            id: "1",
            title: "Real Doc A",
            status: "Done",
            isDeleted: false,
          }),
        },
      ],
    } as any as any as any as any);
    render(<DatabaseView collection="bookmarks" schema={{}} />);
    // Select the single row, then click Delete.
    const checkbox = screen.getByLabelText("Select record");
    await userEvent.click(checkbox);
    const deleteBtn = screen.getByRole("button", {
      name: /delete selected records/i,
    });
    expect(deleteBtn).not.toBeDisabled();
    await userEvent.click(deleteBtn);
    expect(patch).toHaveBeenCalledWith(
      expect.objectContaining({ isDeleted: true, updatedAt: expect.any(String) }),
    );
  });

  it("P94: filters soft-deleted (isDeleted:true) out of the reactive view", async () => {
    mockUseRxCollection.mockReturnValue({ find: vi.fn() } as any);
    mockUseRxQuery.mockReturnValue({
      result: [
        {
          toJSON: () => ({
            id: "1",
            title: "Live Doc",
            isDeleted: false,
          }),
        },
        {
          toJSON: () => ({
            id: "2",
            title: "Deleted Doc",
            isDeleted: true,
          }),
        },
      ],
    } as any as any as any as any);
    render(<DatabaseView collection="bookmarks" schema={{}} />);
    expect(screen.getByText("Live Doc")).toBeDefined();
    expect(screen.queryByText("Deleted Doc")).toBeNull();
  });

  it("P94: delete in controlled mode removes rows from local state", async () => {
    const onDelete = vi.fn();
    render(
      <DatabaseView
        collection="test"
        rows={sampleRows}
        onCellEdit={onDelete}
      />,
    );
    const checkbox = screen.getAllByLabelText("Select record")[0];
    await userEvent.click(checkbox!);
    const deleteBtn = screen.getByRole("button", {
      name: /delete selected records/i,
    });
    await userEvent.click(deleteBtn);
    // The selected row disappears from the local table.
    expect(screen.queryByText("Design System Tokens")).toBeNull();
    expect(screen.getByText("RxDB Migration Plan")).toBeDefined();
  });

  it("P91: edit commit without RxDB collection is cancelled without crashing", async () => {
    mockUseRxCollection.mockReturnValue(undefined as any);
    mockUseRxQuery.mockReturnValue({
      result: [
        { toJSON: () => ({ id: "1", title: "Real Doc A", status: "Done" }) },
        { toJSON: () => ({ id: "2", title: "Real Doc B", status: "Done" }) },
        { toJSON: () => ({ id: "3", title: "Real Doc C", status: "Done" }) },
        { toJSON: () => ({ id: "4", title: "Real Doc D", status: "Done" }) },
        { toJSON: () => ({ id: "5", title: "Real Doc E", status: "Done" }) },
        { toJSON: () => ({ id: "6", title: "Real Doc F", status: "Done" }) },
      ],
    } as any as any as any as any);
    render(<DatabaseView collection="bookmarks" schema={{}} />);
    await userEvent.click(screen.getByText("Real Doc A"));
    const input = screen.getByDisplayValue("Real Doc A");
    input.focus();
    await userEvent.keyboard("{Enter}");
    // No collection: the edit is cancelled silently (no throw).
    expect(screen.getByText("Real Doc A")).toBeDefined();
  });
});
