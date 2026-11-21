import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDragAndDrop } from "../../hooks/useDragAndDrop";

describe("useDragAndDrop", () => {
  // Typed with the hook's callback signature: a bare `vi.fn()` widens to
  // Mock<Procedure | Constructable> and is not assignable to
  // `(files: File[]) => void`.
  let onDropMock: Mock<(files: File[]) => void>;

  beforeEach(() => {
    onDropMock = vi.fn<(files: File[]) => void>();
  });

  it("initializes with default state", () => {
    const { result } = renderHook(() => useDragAndDrop(onDropMock));

    expect(result.current.state.isDragging).toBe(false);
    expect(result.current.state.isOver).toBe(false);
    expect(result.current.state.files).toEqual([]);
  });

  it("handles drag enter", () => {
    const { result } = renderHook(() => useDragAndDrop(onDropMock));
    const event = {
      preventDefault: vi.fn(),
      dataTransfer: { items: [{ length: 1 }] },
    } as unknown as React.DragEvent;

    act(() => {
      result.current.handlers.onDragEnter(event);
    });

    expect(event.preventDefault).toHaveBeenCalled();
    expect(result.current.state.isOver).toBe(true);
  });

  it("handles drag over", () => {
    const { result } = renderHook(() => useDragAndDrop(onDropMock));
    const event = {
      preventDefault: vi.fn(),
      dataTransfer: { dropEffect: "" },
    } as unknown as React.DragEvent;

    act(() => {
      result.current.handlers.onDragOver(event);
    });

    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.dataTransfer.dropEffect).toBe("copy");
  });

  it("handles drag leave", () => {
    const { result } = renderHook(() => useDragAndDrop(onDropMock));
    const event = {
      preventDefault: vi.fn(),
    } as unknown as React.DragEvent;

    // First enter to set isOver to true
    act(() => {
      result.current.handlers.onDragEnter({
        preventDefault: vi.fn(),
        dataTransfer: { items: [{ length: 1 }] },
      } as unknown as React.DragEvent);
    });

    expect(result.current.state.isOver).toBe(true);

    // Then leave
    act(() => {
      result.current.handlers.onDragLeave(event);
    });

    expect(event.preventDefault).toHaveBeenCalled();
    expect(result.current.state.isOver).toBe(false);
  });

  it("handles drop with files", () => {
    const { result } = renderHook(() => useDragAndDrop(onDropMock));
    const file1 = new File(["content1"], "test1.txt", { type: "text/plain" });
    const file2 = new File(["content2"], "test2.txt", { type: "text/plain" });
    const event = {
      preventDefault: vi.fn(),
      dataTransfer: { files: [file1, file2] },
    } as unknown as React.DragEvent;

    act(() => {
      result.current.handlers.onDrop(event);
    });

    expect(event.preventDefault).toHaveBeenCalled();
    expect(result.current.state.isDragging).toBe(false);
    expect(result.current.state.isOver).toBe(false);
    expect(result.current.state.files).toHaveLength(2);
    expect(onDropMock).toHaveBeenCalledWith([file1, file2]);
  });

  it("filters files by accepted types", () => {
    const { result } = renderHook(() => useDragAndDrop(onDropMock, ["image/*", ".pdf"]));
    const imageFile = new File(["content"], "image.png", { type: "image/png" });
    const pdfFile = new File(["content"], "doc.pdf", { type: "application/pdf" });
    const textFile = new File(["content"], "text.txt", { type: "text/plain" });
    const event = {
      preventDefault: vi.fn(),
      dataTransfer: { files: [imageFile, pdfFile, textFile] },
    } as unknown as React.DragEvent;

    act(() => {
      result.current.handlers.onDrop(event);
    });

    expect(result.current.state.files).toHaveLength(2);
    expect(result.current.state.files).toContain(imageFile);
    expect(result.current.state.files).toContain(pdfFile);
    expect(result.current.state.files).not.toContain(textFile);
  });

  it("filters files by extension", () => {
    const { result } = renderHook(() => useDragAndDrop(onDropMock, [".txt", ".md"]));
    const txtFile = new File(["content"], "doc.txt", { type: "text/plain" });
    const mdFile = new File(["content"], "doc.md", { type: "text/markdown" });
    const pdfFile = new File(["content"], "doc.pdf", { type: "application/pdf" });
    const event = {
      preventDefault: vi.fn(),
      dataTransfer: { files: [txtFile, mdFile, pdfFile] },
    } as unknown as React.DragEvent;

    act(() => {
      result.current.handlers.onDrop(event);
    });

    expect(result.current.state.files).toHaveLength(2);
    expect(result.current.state.files).toContain(txtFile);
    expect(result.current.state.files).toContain(mdFile);
    expect(result.current.state.files).not.toContain(pdfFile);
  });

  it("filters files by exact MIME type", () => {
    const { result } = renderHook(() => useDragAndDrop(onDropMock, ["text/plain"]));
    const txtFile = new File(["content"], "doc.txt", { type: "text/plain" });
    const htmlFile = new File(["content"], "doc.html", { type: "text/html" });
    const event = {
      preventDefault: vi.fn(),
      dataTransfer: { files: [txtFile, htmlFile] },
    } as unknown as React.DragEvent;

    act(() => {
      result.current.handlers.onDrop(event);
    });

    expect(result.current.state.files).toHaveLength(1);
    expect(result.current.state.files).toContain(txtFile);
    expect(result.current.state.files).not.toContain(htmlFile);
  });

  it("resets drag counter on drop", () => {
    const { result } = renderHook(() => useDragAndDrop(onDropMock));
    const event = {
      preventDefault: vi.fn(),
      dataTransfer: { files: [] },
    } as unknown as React.DragEvent;

    // Multiple drag enters
    act(() => {
      result.current.handlers.onDragEnter({
        preventDefault: vi.fn(),
        dataTransfer: { items: [{ length: 1 }] },
      } as unknown as React.DragEvent);
      result.current.handlers.onDragEnter({
        preventDefault: vi.fn(),
        dataTransfer: { items: [{ length: 1 }] },
      } as unknown as React.DragEvent);
    });

    expect(result.current.state.isOver).toBe(true);

    // Drop resets everything
    act(() => {
      result.current.handlers.onDrop(event);
    });

    expect(result.current.state.isOver).toBe(false);
    expect(result.current.state.isDragging).toBe(false);
  });

  it("calls onDrop callback with filtered files", () => {
    const { result } = renderHook(() => useDragAndDrop(onDropMock, ["image/*"]));
    const imageFile = new File(["content"], "image.png", { type: "image/png" });
    const textFile = new File(["content"], "text.txt", { type: "text/plain" });
    const event = {
      preventDefault: vi.fn(),
      dataTransfer: { files: [imageFile, textFile] },
    } as unknown as React.DragEvent;

    act(() => {
      result.current.handlers.onDrop(event);
    });

    expect(onDropMock).toHaveBeenCalledWith([imageFile]);
  });

  it("does not filter when no accepted types provided", () => {
    const { result } = renderHook(() => useDragAndDrop(onDropMock));
    const file1 = new File(["content1"], "test1.txt", { type: "text/plain" });
    const file2 = new File(["content2"], "test2.pdf", { type: "application/pdf" });
    const event = {
      preventDefault: vi.fn(),
      dataTransfer: { files: [file1, file2] },
    } as unknown as React.DragEvent;

    act(() => {
      result.current.handlers.onDrop(event);
    });

    expect(result.current.state.files).toHaveLength(2);
    expect(onDropMock).toHaveBeenCalledWith([file1, file2]);
  });
});
