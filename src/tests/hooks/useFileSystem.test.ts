
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFileSystem } from "../../hooks/useFileSystem";

function createMockFile(
  name: string,
  content: string,
  type = "text/plain",
): File {
  return new File([content], name, { type });
}

describe("useFileSystem", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("when File System Access API is supported", () => {
    let mockFileHandle: any;
    let mockWritable: any;

    beforeEach(() => {
      mockWritable = {
        write: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      };
      mockFileHandle = {
        getFile: vi.fn().mockResolvedValue(createMockFile("test.txt", "hello")),
        createWritable: vi.fn().mockResolvedValue(mockWritable),
      };
      (window as any).showOpenFilePicker = vi
        .fn()
        .mockResolvedValue([mockFileHandle]);
      (window as any).showSaveFilePicker = vi
        .fn()
        .mockResolvedValue(mockFileHandle);
    });

    afterEach(() => {
      delete (window as any).showOpenFilePicker;
      delete (window as any).showSaveFilePicker;
    });

    it("isSupported is true", () => {
      const { result } = renderHook(() => useFileSystem());
      expect(result.current.isSupported).toBe(true);
    });

    it("openFiles returns files from FilePicker", async () => {
      const { result } = renderHook(() => useFileSystem());
      const files = await act(async () => result.current.openFiles());
      expect(files).toHaveLength(1);
      expect(files[0]!.name).toBe("test.txt");
    });

    it("saveFile writes content via FilePicker", async () => {
      const { result } = renderHook(() => useFileSystem());
      const saved = await act(async () =>
        result.current.saveFile("test content", "output.txt"),
      );
      expect(saved).toBe(true);
      expect(mockWritable.write).toHaveBeenCalledWith("test content");
      expect(mockWritable.close).toHaveBeenCalled();
    });

    it("saveFile handles Blob content", async () => {
      const { result } = renderHook(() => useFileSystem());
      const blob = new Blob(["binary data"], {
        type: "application/octet-stream",
      });
      const saved = await act(async () =>
        result.current.saveFile(blob, "data.bin"),
      );
      expect(saved).toBe(true);
      expect(mockWritable.write).toHaveBeenCalledWith(blob);
    });

    it("handles AbortError gracefully in openFiles", async () => {
      (window as any).showOpenFilePicker = vi
        .fn()
        .mockRejectedValue({ name: "AbortError" });
      const { result } = renderHook(() => useFileSystem());
      const files = await act(async () => result.current.openFiles());
      expect(files).toEqual([]);
    });
  });

  describe("when File System Access API is not supported", () => {
    let createElementSpy: any;

    beforeEach(() => {
      delete (window as any).showOpenFilePicker;
      delete (window as any).showSaveFilePicker;

      createElementSpy = vi.spyOn(document, "createElement");
    });

    afterEach(() => {
      createElementSpy?.mockRestore();
    });

    it("isSupported is false", () => {
      const { result } = renderHook(() => useFileSystem());
      expect(result.current.isSupported).toBe(false);
    });

    it("openFiles falls back to file input", async () => {
      const { result } = renderHook(() => useFileSystem());
      const promise = result.current.openFiles();

      const createCalls = createElementSpy.mock.results.filter(
        (r: any) => r.value.tagName === "INPUT",
      );
      expect(createCalls.length).toBeGreaterThanOrEqual(1);
      const input = createCalls[0].value;

      const file = createMockFile("fallback.txt", "content");
      Object.defineProperty(input, "files", { value: [file] });
      input.dispatchEvent(new Event("change"));

      const files = await promise;
      expect(files).toHaveLength(1);
      expect(files[0]!.name).toBe("fallback.txt");
    });

    it("saveFile falls back to download link", async () => {
      const { result } = renderHook(() => useFileSystem());
      const saved = await act(async () =>
        result.current.saveFile("download content"),
      );
      expect(saved).toBe(true);
    });
  });
});
