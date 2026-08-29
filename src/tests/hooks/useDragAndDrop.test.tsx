import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useDragAndDrop } from "../../hooks/useDragAndDrop";

function createDragEvent(items?: DataTransferItem[], files?: File[]) {
  return {
    preventDefault: vi.fn(),
    dataTransfer: {
      items,
      files,
      dropEffect: "",
    },
  } as unknown as React.DragEvent;
}

function createFile(name: string, type: string): File {
  return new File(["content"], name, { type });
}

describe("useDragAndDrop", () => {
  it("initializes with default state", () => {
    const { result } = renderHook(() => useDragAndDrop(vi.fn()));

    expect(result.current.state).toEqual({
      isDragging: false,
      isOver: false,
      files: [],
    });
  });

  it("sets isOver on drag enter when items are present", () => {
    const { result } = renderHook(() => useDragAndDrop(vi.fn()));
    const item = { kind: "file" } as DataTransferItem;
    const event = createDragEvent([item]);

    act(() => {
      result.current.handlers.onDragEnter(event);
    });

    expect(result.current.state.isOver).toBe(true);
  });

  it("does not set isOver on drag enter when items are absent", () => {
    const { result } = renderHook(() => useDragAndDrop(vi.fn()));
    const event = createDragEvent([]);

    act(() => {
      result.current.handlers.onDragEnter(event);
    });

    expect(result.current.state.isOver).toBe(false);
  });

  it("sets dropEffect to copy on drag over", () => {
    const { result } = renderHook(() => useDragAndDrop(vi.fn()));
    const event = createDragEvent();

    act(() => {
      result.current.handlers.onDragOver(event);
    });

    expect((event as any).dataTransfer.dropEffect).toBe("copy");
  });

  it("clears isOver on drag leave when counter reaches zero", () => {
    const { result } = renderHook(() => useDragAndDrop(vi.fn()));
    const item = { kind: "file" } as DataTransferItem;
    const enterEvent = createDragEvent([item]);
    const leaveEvent = createDragEvent();

    act(() => {
      result.current.handlers.onDragEnter(enterEvent);
    });
    expect(result.current.state.isOver).toBe(true);

    act(() => {
      result.current.handlers.onDragLeave(leaveEvent);
    });
    expect(result.current.state.isOver).toBe(false);
  });

  it("keeps isOver on drag leave when counter is still positive", () => {
    const { result } = renderHook(() => useDragAndDrop(vi.fn()));
    const item = { kind: "file" } as DataTransferItem;
    const enter1 = createDragEvent([item]);
    const enter2 = createDragEvent([item]);
    const leave = createDragEvent();

    act(() => {
      result.current.handlers.onDragEnter(enter1);
      result.current.handlers.onDragEnter(enter2);
    });
    expect(result.current.state.isOver).toBe(true);

    act(() => {
      result.current.handlers.onDragLeave(leave);
    });
    expect(result.current.state.isOver).toBe(true);
  });

  it("calls onDrop with all files when no accepted types", () => {
    const onDrop = vi.fn();
    const { result } = renderHook(() => useDragAndDrop(onDrop));
    const file = createFile("doc.pdf", "application/pdf");
    const event = createDragEvent(undefined, [file]);

    act(() => {
      result.current.handlers.onDrop(event);
    });

    expect(result.current.state.files).toEqual([file]);
    expect(result.current.state.isOver).toBe(false);
    expect(onDrop).toHaveBeenCalledWith([file]);
  });

  it("filters by exact MIME type", () => {
    const onDrop = vi.fn();
    const { result } = renderHook(() =>
      useDragAndDrop(onDrop, ["image/png"]),
    );
    const png = createFile("image.png", "image/png");
    const jpg = createFile("image.jpg", "image/jpeg");
    const event = createDragEvent(undefined, [png, jpg]);

    act(() => {
      result.current.handlers.onDrop(event);
    });

    expect(result.current.state.files).toEqual([png]);
    expect(onDrop).toHaveBeenCalledWith([png]);
  });

  it("filters by wildcard MIME type", () => {
    const onDrop = vi.fn();
    const { result } = renderHook(() =>
      useDragAndDrop(onDrop, ["image/*"]),
    );
    const png = createFile("image.png", "image/png");
    const pdf = createFile("doc.pdf", "application/pdf");
    const event = createDragEvent(undefined, [png, pdf]);

    act(() => {
      result.current.handlers.onDrop(event);
    });

    expect(result.current.state.files).toEqual([png]);
    expect(onDrop).toHaveBeenCalledWith([png]);
  });

  it("filters by extension when provided without dot", () => {
    const onDrop = vi.fn();
    const { result } = renderHook(() =>
      useDragAndDrop(onDrop, ["pdf"]),
    );
    const pdf = createFile("doc.pdf", "application/pdf");
    const txt = createFile("doc.txt", "text/plain");
    const event = createDragEvent(undefined, [pdf, txt]);

    act(() => {
      result.current.handlers.onDrop(event);
    });

    expect(result.current.state.files).toEqual([pdf]);
    expect(onDrop).toHaveBeenCalledWith([pdf]);
  });

  it("filters by extension when provided with leading dot", () => {
    const onDrop = vi.fn();
    const { result } = renderHook(() =>
      useDragAndDrop(onDrop, [".txt"]),
    );
    const pdf = createFile("doc.pdf", "application/pdf");
    const txt = createFile("doc.txt", "text/plain");
    const event = createDragEvent(undefined, [pdf, txt]);

    act(() => {
      result.current.handlers.onDrop(event);
    });

    expect(result.current.state.files).toEqual([txt]);
    expect(onDrop).toHaveBeenCalledWith([txt]);
  });

  it("returns empty array when no files match accepted types", () => {
    const onDrop = vi.fn();
    const { result } = renderHook(() =>
      useDragAndDrop(onDrop, ["image/png"]),
    );
    const pdf = createFile("doc.pdf", "application/pdf");
    const event = createDragEvent(undefined, [pdf]);

    act(() => {
      result.current.handlers.onDrop(event);
    });

    expect(result.current.state.files).toEqual([]);
    expect(onDrop).toHaveBeenCalledWith([]);
  });
});
