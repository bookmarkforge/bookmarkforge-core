/**
 * Tests for FileSystemService
 * PWA-only: File System Access API
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockShowDirectoryPicker = vi.fn();
Object.defineProperty(window, "showDirectoryPicker", {
  value: mockShowDirectoryPicker,
  writable: true,
  configurable: true,
});

// Mock FileSystemDirectoryHandle
const mockDirHandle = {
  queryPermission: vi.fn(),
  requestPermission: vi.fn(),
  values: vi.fn(),
  getFileHandle: vi.fn(),
  name: "root",
  kind: "directory",
};

import { logger } from "../../utils/logger";

vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import {
  FileSystemService,
  fileSystemService,
} from "../../services/FileSystemService";

describe("FileSystemService", () => {
  let service: FileSystemService;

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "showDirectoryPicker", {
      value: mockShowDirectoryPicker,
      writable: true,
      configurable: true,
    });
    service = new FileSystemService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("isSupported", () => {
    it("should return true if showDirectoryPicker exists", () => {
      expect(service.isSupported()).toBe(true);
    });

    it("should return false if showDirectoryPicker is not available", () => {
      delete (window as any).showDirectoryPicker;
      expect(service.isSupported()).toBe(false);
      Object.defineProperty(window, "showDirectoryPicker", {
        value: mockShowDirectoryPicker,
        writable: true,
        configurable: true,
      });
    });
  });

  describe("isInIframe", () => {
    it("should return false if not in iframe", () => {
      expect(service.isInIframe()).toBe(false);
    });

    it("should return true when window.self differs from window.top", () => {
      const originalTop = window.top;
      try {
        Object.defineProperty(window, "top", {
          value: { location: { href: "https://other.example" } },
          configurable: true,
        });
        expect(service.isInIframe()).toBe(true);
      } finally {
        Object.defineProperty(window, "top", {
          value: originalTop,
          configurable: true,
        });
      }
    });

    it("should return true when accessing window.top throws", () => {
      const originalTop = window.top;
      try {
        Object.defineProperty(window, "top", {
          get: () => {
            throw new Error("cross-origin");
          },
          configurable: true,
        });
        expect(service.isInIframe()).toBe(true);
      } finally {
        Object.defineProperty(window, "top", {
          value: originalTop,
          configurable: true,
        });
      }
    });
  });

  describe("requestDirectoryAccess", () => {
    it("should return false if not supported", async () => {
      delete (window as any).showDirectoryPicker;
      const result = await service.requestDirectoryAccess();
      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        "File System Access API is not supported.",
      );
    });

    it("should return true if showDirectoryPicker works", async () => {
      mockShowDirectoryPicker.mockResolvedValue(mockDirHandle);
      const result = await service.requestDirectoryAccess();
      expect(result).toBe(true);
    });

    it("should reuse permissions if rootHandle already exists", async () => {
      (service as any).rootHandle = mockDirHandle;
      mockDirHandle.queryPermission.mockResolvedValue("granted");

      const result = await service.requestDirectoryAccess();
      expect(result).toBe(true);
      expect(mockDirHandle.queryPermission).toHaveBeenCalled();
    });

    it("should fail if user cancels", async () => {
      mockShowDirectoryPicker.mockRejectedValue(new Error("User cancelled"));
      const result = await service.requestDirectoryAccess();
      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        "Error accessing directory",
        expect.objectContaining({ error: expect.any(Error) }),
      );
    });

    it("should request permission if queryPermission fails", async () => {
      (service as any).rootHandle = mockDirHandle;
      mockDirHandle.queryPermission.mockRejectedValue(
        new Error("permission check failed"),
      );

      mockShowDirectoryPicker.mockResolvedValue(mockDirHandle);
      const result = await service.requestDirectoryAccess();
      expect(result).toBe(true);
      expect(logger.warn).toHaveBeenCalledWith(
        "Error checking/requesting permission, falling back to picker:",
        expect.any(Error),
      );
    });

    it("should return false if requestPermission denied", async () => {
      (service as any).rootHandle = mockDirHandle;
      mockDirHandle.queryPermission.mockResolvedValue("denied" as any);
      mockDirHandle.requestPermission.mockResolvedValue("denied");

      const result = await service.requestDirectoryAccess();
      expect(result).toBe(false);
      expect(mockDirHandle.requestPermission).toHaveBeenCalled();
    });

    it("should request permission when queryPermission returns prompt and requestPermission returns granted", async () => {
      (service as any).rootHandle = mockDirHandle;
      mockDirHandle.queryPermission.mockResolvedValue("prompt" as any);
      mockDirHandle.requestPermission.mockResolvedValue("granted");

      const result = await service.requestDirectoryAccess();
      expect(result).toBe(true);
      expect(mockDirHandle.requestPermission).toHaveBeenCalledWith({ mode: "readwrite" });
    });

    it("should return false when queryPermission returns prompt and requestPermission returns denied", async () => {
      (service as any).rootHandle = mockDirHandle;
      mockDirHandle.queryPermission.mockResolvedValue("prompt" as any);
      mockDirHandle.requestPermission.mockResolvedValue("denied");

      const result = await service.requestDirectoryAccess();
      expect(result).toBe(false);
    });
  });

  describe("readMarkdownFiles", () => {
    it("should throw error if no rootHandle", async () => {
      await expect(service.readMarkdownFiles()).rejects.toThrow(
        "No directory access",
      );
    });

    it("should read .md files from directory", async () => {
      const makeFile = (name: string, content: string) => ({
        kind: "file",
        name,
        getFile: vi
          .fn()
          .mockResolvedValue({ text: vi.fn().mockResolvedValue(content) }),
      });

      const mockValues = vi.fn().mockReturnValue({
        [Symbol.asyncIterator]: () => {
          const files = [
            makeFile("readme.md", "# Hello"),
            makeFile("notes.txt", "not md"),
            makeFile("doc.md", "# Doc"),
          ];
          let idx = 0;
          return {
            next: () =>
              Promise.resolve({
                value: files[idx],
                done: idx++ >= files.length,
              }),
          };
        },
      });

      (service as any).rootHandle = { ...mockDirHandle, values: mockValues };

      const files = await service.readMarkdownFiles();
      expect(files).toHaveLength(2);
      expect(files[0]!.name).toBe("readme.md");
      expect(files[1]!.name).toBe("doc.md");
    });

    it("should handle a directory with only non-markdown files", async () => {
      const mockValues = vi.fn().mockReturnValue({
        [Symbol.asyncIterator]: () => {
          const files = [
            { kind: "file", name: "notes.txt", getFile: vi.fn() },
            { kind: "directory", name: "folder", values: vi.fn() },
          ];
          let idx = 0;
          return {
            next: () =>
              Promise.resolve({
                value: files[idx],
                done: idx++ >= files.length,
              }),
          };
        },
      });

      (service as any).rootHandle = { ...mockDirHandle, values: mockValues };

      const files = await service.readMarkdownFiles();
      expect(files).toHaveLength(0);
    });
  });

  describe("writeMarkdownFile", () => {
    it("should throw error if no rootHandle", async () => {
      await expect(
        service.writeMarkdownFile("test.md", "# content"),
      ).rejects.toThrow("No directory access");
    });

    it("should write file using File System Access API", async () => {
      const mockWritable = {
        write: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      };
      const mockFileHandle = {
        createWritable: vi.fn().mockResolvedValue(mockWritable),
      };
      (service as any).rootHandle = {
        ...mockDirHandle,
        getFileHandle: vi.fn().mockResolvedValue(mockFileHandle),
      };

      await service.writeMarkdownFile("test.md", "# Hello");
      expect(mockFileHandle.createWritable).toHaveBeenCalled();
      expect(mockWritable.write).toHaveBeenCalledWith("# Hello");
      expect(mockWritable.close).toHaveBeenCalled();
    });

    it("should sanitize dangerous file names before writing", async () => {
      const capturedNames: string[] = [];
      const mockWritable = {
        write: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      };
      const mockGetFileHandle = vi.fn().mockImplementation((name: string) => {
        capturedNames.push(name);
        return Promise.resolve({ createWritable: vi.fn().mockResolvedValue(mockWritable) });
      });
      (service as any).rootHandle = {
        ...mockDirHandle,
        getFileHandle: mockGetFileHandle,
      };

      await service.writeMarkdownFile("../../etc/passwd.md", "# content");
      await service.writeMarkdownFile("..hidden", "# content");
      await service.writeMarkdownFile("file\x00name.md", "# content");
      await service.writeMarkdownFile("   ", "# content");

      expect(capturedNames).toEqual(["____etc_passwd.md", "_hidden", "filename.md", "untitled"]);
    });
  });

  describe("readAttachmentFiles", () => {
    it("returns empty list when attachments directory does not exist", async () => {
      (service as any).rootHandle = {
        ...mockDirHandle,
        getDirectoryHandle: vi.fn().mockRejectedValue(new Error("not found")),
      };

      const result = await service.readAttachmentFiles();
      expect(result).toEqual([]);
    });

    it("reads binary files from attachments directory", async () => {
      const fileData = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
      const mockFileHandle = {
        kind: "file",
        name: "image.png",
        getFile: vi.fn().mockResolvedValue({
          size: 5,
          arrayBuffer: vi.fn().mockResolvedValue(fileData.buffer),
        }),
      };
      const mockAttachmentsDir = {
        values: vi.fn().mockReturnValue({
          [Symbol.asyncIterator]: () => {
            const entries = [mockFileHandle];
            let idx = 0;
            return {
              next: () =>
                Promise.resolve({
                  done: idx >= entries.length,
                  value: entries[idx++],
                }),
            };
          },
        }),
      };
      (service as any).rootHandle = {
        ...mockDirHandle,
        getDirectoryHandle: vi.fn().mockResolvedValue(mockAttachmentsDir),
      };

      const result = await service.readAttachmentFiles();
      expect(result).toHaveLength(1);
      expect(result[0]!.name).toBe("image.png");
      expect(result[0]!.bytes).toBeInstanceOf(Uint8Array);
    });

    it("throws when attachment exceeds size limit", async () => {
      const mockFileHandle = {
        kind: "file",
        name: "huge.bin",
        getFile: vi.fn().mockResolvedValue({
          size: 11 * 1024 * 1024, // 11 MB > 10 MB limit
          arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(1)),
        }),
      };
      const mockAttachmentsDir = {
        values: vi.fn().mockReturnValue({
          [Symbol.asyncIterator]: () => {
            const entries = [mockFileHandle];
            let idx = 0;
            return {
              next: () =>
                Promise.resolve({
                  done: idx >= entries.length,
                  value: entries[idx++],
                }),
            };
          },
        }),
      };
      (service as any).rootHandle = {
        ...mockDirHandle,
        getDirectoryHandle: vi.fn().mockResolvedValue(mockAttachmentsDir),
      };

      await expect(service.readAttachmentFiles()).rejects.toThrow(/exceeds/);
    });

    it("skips directory entries in attachments", async () => {
      const mockEntries = [
        { kind: "directory", name: "subdir" },
        {
          kind: "file",
          name: "doc.pdf",
          getFile: vi.fn().mockResolvedValue({
            size: 100,
            arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(100)),
          }),
        },
      ];
      let idx = 0;
      const mockAttachmentsDir = {
        values: vi.fn().mockReturnValue({
          [Symbol.asyncIterator]: () => ({
            next: () =>
              Promise.resolve({
                done: idx >= mockEntries.length,
                value: mockEntries[idx++],
              }),
          }),
        }),
      };
      (service as any).rootHandle = {
        ...mockDirHandle,
        getDirectoryHandle: vi.fn().mockResolvedValue(mockAttachmentsDir),
      };

      const result = await service.readAttachmentFiles();
      expect(result).toHaveLength(1);
      expect(result[0]!.name).toBe("doc.pdf");
    });

    it("throws when rootHandle is null", async () => {
      await expect(service.readAttachmentFiles()).rejects.toThrow(
        "No directory access",
      );
    });
  });

  describe("writeAttachmentFile", () => {
    it("writes bytes to attachments directory with sanitization", async () => {
      const mockWritable = {
        write: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      };
      const mockFileHandle = {
        createWritable: vi.fn().mockResolvedValue(mockWritable),
      };
      const mockAttachmentsDir = {
        getFileHandle: vi.fn().mockResolvedValue(mockFileHandle),
      };
      (service as any).rootHandle = {
        ...mockDirHandle,
        getDirectoryHandle: vi.fn().mockResolvedValue(mockAttachmentsDir),
      };

      const data = new Uint8Array([1, 2, 3]);
      await service.writeAttachmentFile("photo.png", data);

      expect(mockAttachmentsDir.getFileHandle).toHaveBeenCalledWith(
        "photo.png",
        { create: true },
      );
      expect(mockWritable.close).toHaveBeenCalled();
    });

    it("sanitizes dangerous attachment names", async () => {
      const capturedNames: string[] = [];
      const mockWritable = {
        write: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      };
      const mockAttachmentsDir = {
        getFileHandle: vi.fn().mockImplementation((name: string) => {
          capturedNames.push(name);
          return Promise.resolve({
            createWritable: vi.fn().mockResolvedValue(mockWritable),
          });
        }),
      };
      (service as any).rootHandle = {
        ...mockDirHandle,
        getDirectoryHandle: vi.fn().mockResolvedValue(mockAttachmentsDir),
      };

      await service.writeAttachmentFile("../../etc/passwd", new Uint8Array(1));
      await service.writeAttachmentFile("..\\windows\\system32", new Uint8Array(1));

      expect(capturedNames[0]).not.toContain("..");
      expect(capturedNames[1]).not.toContain("..");
    });

    it("throws when rootHandle is null", async () => {
      await expect(
        service.writeAttachmentFile("a.png", new Uint8Array(1)),
      ).rejects.toThrow("No directory access");
    });
  });

  describe("removeAttachmentFile", () => {
    it("removes an attachment file", async () => {
      const mockAttachmentsDir = {
        removeEntry: vi.fn().mockResolvedValue(undefined),
      };
      (service as any).rootHandle = {
        ...mockDirHandle,
        getDirectoryHandle: vi.fn().mockResolvedValue(mockAttachmentsDir),
      };

      await service.removeAttachmentFile("old.png");
      expect(mockAttachmentsDir.removeEntry).toHaveBeenCalledWith("old.png");
    });

    it("does not throw when attachments directory is missing", async () => {
      (service as any).rootHandle = {
        ...mockDirHandle,
        getDirectoryHandle: vi.fn().mockRejectedValue(new Error("not found")),
      };

      await expect(service.removeAttachmentFile("x.png")).resolves.toBeUndefined();
    });

    it("sanitizes name before removal", async () => {
      const capturedNames: string[] = [];
      const mockAttachmentsDir = {
        removeEntry: vi.fn().mockImplementation((name: string) => {
          capturedNames.push(name);
          return Promise.resolve();
        }),
      };
      (service as any).rootHandle = {
        ...mockDirHandle,
        getDirectoryHandle: vi.fn().mockResolvedValue(mockAttachmentsDir),
      };

      await service.removeAttachmentFile("../../evil.md");
      expect(capturedNames[0]).not.toContain("..");
    });

    it("throws when rootHandle is null", async () => {
      await expect(service.removeAttachmentFile("a.png")).rejects.toThrow(
        "No directory access",
      );
    });
  });

  describe("syncFiles", () => {
    it("should sync files with database", async () => {
      const mockDocFind = vi.fn().mockResolvedValue([]);
      const mockBulkInsert = vi.fn();
      const mockDb = {
        documents: {
          find: vi.fn(() => ({ exec: mockDocFind })),
          bulkInsert: mockBulkInsert,
        },
      };

      const makeFile = (name: string, content: string) => ({
        kind: "file",
        name,
        getFile: vi
          .fn()
          .mockResolvedValue({ text: vi.fn().mockResolvedValue(content) }),
      });

      const mockValues = vi.fn().mockReturnValue({
        [Symbol.asyncIterator]: () => {
          const files = [makeFile("new.md", "# New File")];
          let idx = 0;
          return {
            next: () =>
              Promise.resolve({
                value: files[idx],
                done: idx++ >= files.length,
              }),
          };
        },
      });

      (service as any).rootHandle = { ...mockDirHandle, values: mockValues };

      await service.syncFiles(mockDb as any);
      expect(mockBulkInsert).toHaveBeenCalled();
    });

    it("should update existing documents", async () => {
      const existingDoc = {
        title: "existing.md",
        textContent: "old content",
        incrementalPatch: vi.fn(),
      };
      const mockDocFind = vi.fn().mockResolvedValue([existingDoc]);
      const mockBulkInsert = vi.fn();
      const mockDb = {
        documents: {
          find: vi.fn(() => ({ exec: mockDocFind })),
          bulkInsert: mockBulkInsert,
        },
      };

      (mockDb.documents.find as any).mockImplementation((_query: any) => ({
        exec: () => {
          return Promise.resolve([existingDoc]);
        },
      }));

      const makeFile = (name: string, content: string) => ({
        kind: "file",
        name,
        getFile: vi
          .fn()
          .mockResolvedValue({ text: vi.fn().mockResolvedValue(content) }),
      });

      const mockValues = vi.fn().mockReturnValue({
        [Symbol.asyncIterator]: () => {
          const files = [makeFile("existing.md", "# Updated Content")];
          let idx = 0;
          return {
            next: () =>
              Promise.resolve({
                value: files[idx],
                done: idx++ >= files.length,
              }),
          };
        },
      });

      (service as any).rootHandle = { ...mockDirHandle, values: mockValues };

      await service.syncFiles(mockDb as any);
      expect(existingDoc.incrementalPatch).toHaveBeenCalled();
    });

    it("should remove documents no longer on filesystem", async () => {
      const toRemove = {
        title: "deleted.md",
        textContent: "gone",
        remove: vi.fn(),
        incrementalPatch: vi.fn(),
      };
      const mockDocFind = vi.fn().mockResolvedValue([toRemove]);
      const mockBulkInsert = vi.fn();
      const mockDb = {
        documents: {
          find: vi.fn(() => ({ exec: mockDocFind })),
          bulkInsert: mockBulkInsert,
        },
      };

      (mockDb.documents.find as any).mockImplementation(() => ({
        exec: () => Promise.resolve([toRemove]),
      }));

      const mockValues = vi.fn().mockReturnValue({
        [Symbol.asyncIterator]: () => {
          const files: any[] = [];
          let idx = 0;
          return {
            next: () =>
              Promise.resolve({
                value: files[idx],
                done: idx++ >= files.length,
              }),
          };
        },
      });

      (service as any).rootHandle = { ...mockDirHandle, values: mockValues };

      await service.syncFiles(mockDb as any);
      expect(toRemove.remove).toHaveBeenCalled();
    });

    it("should not update documents when content is unchanged", async () => {
      const existingDoc = {
        title: "unchanged.md",
        textContent: "# Same",
        incrementalPatch: vi.fn(),
        remove: vi.fn(),
      };
      const mockDb = {
        documents: {
          find: vi.fn(() => ({
            exec: vi.fn().mockResolvedValue([existingDoc]),
          })),
          bulkInsert: vi.fn(),
        },
      };

      const makeFile = (name: string, content: string) => ({
        kind: "file",
        name,
        getFile: vi
          .fn()
          .mockResolvedValue({ text: vi.fn().mockResolvedValue(content) }),
      });

      const mockValues = vi.fn().mockReturnValue({
        [Symbol.asyncIterator]: () => {
          const files = [makeFile("unchanged.md", "# Same")];
          let idx = 0;
          return {
            next: () =>
              Promise.resolve({
                value: files[idx],
                done: idx++ >= files.length,
              }),
          };
        },
      });

      (service as any).rootHandle = { ...mockDirHandle, values: mockValues };

      await service.syncFiles(mockDb as any);
      expect(existingDoc.incrementalPatch).not.toHaveBeenCalled();
      expect(mockDb.documents.bulkInsert).not.toHaveBeenCalled();
      expect(existingDoc.remove).not.toHaveBeenCalled();
    });

  });
});
