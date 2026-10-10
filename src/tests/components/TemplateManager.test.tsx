import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { act } from "react";
import userEvent from "@testing-library/user-event";
import React from "react";

const mockExec = vi.fn();
const mockInsert = vi.fn();
const mockRemove = vi.fn();
const mockFindOne = vi.fn();

const mockDb = {
  templates: {
    find: vi.fn(() => ({ exec: mockExec })),
    insert: mockInsert,
    findOne: mockFindOne,
  },
};

vi.mock("../../db/database", () => ({
  initDB: vi.fn().mockResolvedValue(mockDb),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (s: string) => s }),
}));

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("../../utils/logger", () => ({ logger: mockLogger }));

const { TemplateManager } = await import("../../components/TemplateManager");

const flushTemplateLoad = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

const mockTemplates = [
  {
    id: "t1",
    title: "My Template",
    blocks: [{ type: "paragraph" }],
    createdAt: "2025-01-01",
  },
  {
    id: "t2",
    title: "Another",
    blocks: [{ type: "heading" }],
    createdAt: "2025-01-02",
  },
];

describe("TemplateManager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads and renders templates on mount", async () => {
    mockExec.mockResolvedValue(mockTemplates);
    const { getByText, unmount } = render(
      <TemplateManager onApply={vi.fn()} />,
    );
    await flushTemplateLoad();
    expect(getByText("My Template")).toBeTruthy();
    expect(getByText("Another")).toBeTruthy();
    unmount();
  });

  it("calls onApply with blocks when clicked", async () => {
    mockExec.mockResolvedValue(mockTemplates);
    const onApply = vi.fn();
    const { findByText, unmount } = render(
      <TemplateManager onApply={onApply} />,
    );
    await userEvent.click(await findByText("My Template"));
    expect(onApply).toHaveBeenCalledWith([{ type: "paragraph" }]);
    unmount();
  });

  it("deletes template when clicking trash and re-renders", async () => {
    mockExec.mockResolvedValue(mockTemplates);
    mockFindOne.mockReturnValue({ remove: mockRemove });
    const onApply = vi.fn();
    const { getByText, container, unmount } = render(
      <TemplateManager onApply={onApply} />,
    );
    // Wait for templates to render before querying the DOM
    await flushTemplateLoad();
    expect(getByText("My Template")).toBeTruthy();
    // Find the first trash button (button containing an SVG icon)
    const buttons = container.querySelectorAll("button");
    let trashBtn: HTMLButtonElement | null = null;
    for (const btn of buttons) {
      if (btn.querySelector("svg")) {
        trashBtn = btn as HTMLButtonElement;
        break;
      }
    }
    expect(trashBtn).not.toBeNull();
    // After delete, re-render should refresh the list
    mockExec.mockResolvedValue([mockTemplates[0]]);
    await act(async () => {
      fireEvent.click(trashBtn!);
      await vi.waitFor(() => {
        expect(mockFindOne).toHaveBeenCalledWith("t1");
        expect(mockRemove).toHaveBeenCalled();
      });
      await vi.waitFor(() => {
        expect(getByText("My Template")).toBeTruthy();
      });
    });
    unmount();
  });

  it("discards the failed deletion after unmount without warn", async () => {
    let rejectRemove: (reason: Error) => void;
    mockFindOne.mockReturnValue({
      remove: vi.fn(
        () =>
          new Promise((_, reject) => {
            rejectRemove = reject;
          }),
      ),
    });
    mockExec.mockResolvedValue(mockTemplates);
    const onApply = vi.fn();
    const { container, unmount } = render(
      <TemplateManager onApply={onApply} />,
    );
    await flushTemplateLoad();
    const buttons = container.querySelectorAll("button");
    let trashBtn: HTMLButtonElement | null = null;
    for (const btn of buttons) {
      if (btn.querySelector("svg")) {
        trashBtn = btn as HTMLButtonElement;
        break;
      }
    }
    expect(trashBtn).not.toBeNull();
    fireEvent.click(trashBtn!);
    // Flush microtasks so the handler passes initDB and reaches the pending
    // remove() (rejectRemove is assigned there) before we unmount.
    await act(async () => {});
    unmount();
    await act(async () => {
      rejectRemove!(new Error("late remove failed"));
    });
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it("discards templates loaded after unmount", async () => {
    let resolveExec: (value: unknown) => void;
    mockExec.mockReturnValue(
      new Promise((resolve) => {
        resolveExec = resolve;
      }),
    );
    const { unmount } = render(<TemplateManager onApply={vi.fn()} />);
    unmount();
    await act(async () => {
      resolveExec!(mockTemplates);
    });
    // No state update on an unmounted component, and no error logged.
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it("renders empty section without templates", async () => {
    mockExec.mockResolvedValue([]);
    const { getByText, unmount } = render(
      <TemplateManager onApply={vi.fn()} />,
    );
    await flushTemplateLoad();
    expect(getByText("app_templates")).toBeTruthy();
    unmount();
  });
});
