import { describe, it, expect, vi, beforeEach } from "vitest";
import { DiskBackupService } from "../../services/DiskBackupService";
import { downloadBlobWithDetection } from "../../utils/download";

vi.mock("../../utils/download", () => ({
  downloadBlobWithDetection: vi.fn().mockResolvedValue({ ok: true, blocked: false }),
}));

const mockedDownloadBlobWithDetection = vi.mocked(downloadBlobWithDetection);

/** Builds a fake FileSystemDirectoryHandle with vi.fn members. */
function makeDirHandle(opts: {
  name?: string;
  permission?: PermissionState;
  entries?: Array<{ kind: string; name: string }>;
}): Record<string, unknown> {
  return {
    name: opts.name ?? "Backups",
    queryPermission: vi.fn().mockResolvedValue(opts.permission ?? "granted"),
    requestPermission: vi.fn().mockResolvedValue(opts.permission ?? "granted"),
    values: vi.fn().mockImplementation(async function* () {
      for (const entry of opts.entries ?? []) {
        yield entry;
      }
    }),
    getFileHandle: vi.fn().mockResolvedValue({
      createWritable: vi.fn().mockResolvedValue({
        write: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    removeEntry: vi.fn().mockResolvedValue(undefined),
  };
}

function stubPicker(handle: unknown): void {
  Object.defineProperty(window, "showDirectoryPicker", {
    value: vi.fn().mockResolvedValue(handle),
    configurable: true,
    writable: true,
  });
}

function stubPickerRejects(error: Error): void {
  Object.defineProperty(window, "showDirectoryPicker", {
    value: vi.fn().mockRejectedValue(error),
    configurable: true,
    writable: true,
  });
}

function stubNoPicker(): void {
  delete (window as unknown as Record<string, unknown>).showDirectoryPicker;
}

/** Empties the persisted-handle store so tests are order-independent. */
async function clearHandleStore(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.open("bmf-disk-backup", 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains("handles")) {
        req.result.createObjectStore("handles");
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction("handles", "readwrite");
      tx.objectStore("handles").clear();
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error ?? new Error("clear failed"));
    };
    req.onerror = () => reject(req.error);
  });
}

describe("DiskBackupService", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    stubNoPicker();
    await clearHandleStore();
  });

  it("isSupported() is false without showDirectoryPicker", () => {
    const service = new DiskBackupService();
    expect(service.isSupported()).toBe(false);
  });

  it("isSupported() is true with showDirectoryPicker", () => {
    stubPicker(makeDirHandle({}));
    const service = new DiskBackupService();
    expect(service.isSupported()).toBe(true);
  });

  it("buildBackupFileName() produces a dated, date-only name", () => {
    const service = new DiskBackupService();
    // Local-time dates: the file is named after the user's local day.
    expect(service.buildBackupFileName(new Date(2026, 7, 16, 10, 0))).toBe(
      "bookmarkforge-backup-2026-08-16.bmf",
    );
    // Same-day runs overwrite (name is date-only, no time component).
    expect(service.buildBackupFileName(new Date(2026, 7, 16, 23, 59))).toBe(
      "bookmarkforge-backup-2026-08-16.bmf",
    );
  });

  it("pickBackupFolder() returns null when unsupported", async () => {
    const service = new DiskBackupService();
    expect(await service.pickBackupFolder()).toBeNull();
  });

  it("pickBackupFolder() returns null when the picker is cancelled", async () => {
    stubPickerRejects(new DOMException("cancelled", "AbortError"));
    const service = new DiskBackupService();
    expect(await service.pickBackupFolder()).toBeNull();
  });

  it("pickBackupFolder() stores the handle in memory and returns the name", async () => {
    stubPicker(makeDirHandle({ name: "My Backups" }));
    const service = new DiskBackupService();
    const result = await service.pickBackupFolder();
    expect(result).toEqual({ name: "My Backups" });
  });

  it("getBackupFolderInfo() reports unsupported browsers", async () => {
    const service = new DiskBackupService();
    expect(await service.getBackupFolderInfo()).toEqual({
      supported: false,
      configured: false,
    });
  });

  it("getBackupFolderInfo() reports not configured after a fresh start", async () => {
    stubPicker(makeDirHandle({}));
    const service = new DiskBackupService();
    expect(await service.getBackupFolderInfo()).toEqual({
      supported: true,
      configured: false,
    });
  });

  it("getBackupFolderInfo() reports the configured folder and permission", async () => {
    stubPicker(makeDirHandle({ name: "Vault", permission: "granted" }));
    const service = new DiskBackupService();
    await service.pickBackupFolder();
    expect(await service.getBackupFolderInfo()).toEqual({
      supported: true,
      configured: true,
      name: "Vault",
      permission: "granted",
    });
  });

  it("drops a corrupted persisted handle (no permission methods)", async () => {
    stubPicker(makeDirHandle({}));
    const service = new DiskBackupService();
    // Simulate a persisted value that lost its handle identity.
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("bmf-disk-backup", 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains("handles")) {
          req.result.createObjectStore("handles");
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("handles", "readwrite");
        tx.objectStore("handles").put({ name: "Broken" }, "backupFolder");
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });
    expect(await service.getBackupFolderInfo()).toEqual({
      supported: true,
      configured: false,
    });
  });

  it("writeBackupToDisk() falls back to a download when unsupported", async () => {
    const service = new DiskBackupService();
    const blob = new Blob(["encrypted"], { type: "application/octet-stream" });
    const result = await service.writeBackupToDisk(blob, "backup.bmf");
    expect(result).toEqual({ method: "download", name: "backup.bmf" });
    expect(mockedDownloadBlobWithDetection).toHaveBeenCalledWith(blob, "backup.bmf");
  });

  it("writeBackupToDisk() falls back to a download when no folder is configured", async () => {
    stubPicker(makeDirHandle({}));
    const service = new DiskBackupService();
    const result = await service.writeBackupToDisk(
      new Blob(["x"]),
      "backup.bmf",
    );
    expect(result?.method).toBe("download");
  });

  it("writeBackupToDisk() writes to the folder when permission is granted", async () => {
    const handle = makeDirHandle({ name: "Vault", permission: "granted" });
    stubPicker(handle);
    const service = new DiskBackupService();
    await service.pickBackupFolder();

    const blob = new Blob(["encrypted"]);
    const result = await service.writeBackupToDisk(
      blob,
      "bookmarkforge-backup-2026-08-16.bmf",
    );

    expect(result).toEqual({ method: "folder", name: "Vault" });
    expect(mockedDownloadBlobWithDetection).not.toHaveBeenCalled();

    const getFileHandle = handle.getFileHandle as ReturnType<typeof vi.fn>;
    expect(getFileHandle).toHaveBeenCalledWith(
      "bookmarkforge-backup-2026-08-16.bmf",
      { create: true },
    );
    const fileHandle = await getFileHandle.mock.results[0]!.value;
    const createWritable = fileHandle.createWritable as ReturnType<typeof vi.fn>;
    expect(createWritable).toHaveBeenCalledTimes(1);
    const writable = await createWritable.mock.results[0]!.value;
    expect(writable.write).toHaveBeenCalledWith(blob);
    expect(writable.close).toHaveBeenCalled();
  });

  it("writeBackupToDisk() degrades to a download when permission is prompt (no prompt from background)", async () => {
    const handle = makeDirHandle({ name: "Vault", permission: "prompt" });
    stubPicker(handle);
    const service = new DiskBackupService();
    await service.pickBackupFolder();

    const result = await service.writeBackupToDisk(
      new Blob(["x"]),
      "backup.bmf",
    );
    expect(result?.method).toBe("download");
    const requestPermission = handle.requestPermission as ReturnType<
      typeof vi.fn
    >;
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("writeBackupToDisk() degrades to a download when permission is denied", async () => {
    const handle = makeDirHandle({ name: "Vault", permission: "denied" });
    stubPicker(handle);
    const service = new DiskBackupService();
    await service.pickBackupFolder();

    const result = await service.writeBackupToDisk(
      new Blob(["x"]),
      "backup.bmf",
    );
    expect(result?.method).toBe("download");
  });

  it("writeBackupToDisk() degrades to a download when the folder write throws", async () => {
    const handle = makeDirHandle({ name: "Vault", permission: "granted" });
    (handle.getFileHandle as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("disk full"),
    );
    stubPicker(handle);
    const service = new DiskBackupService();
    await service.pickBackupFolder();

    const result = await service.writeBackupToDisk(
      new Blob(["x"]),
      "backup.bmf",
    );
    expect(result?.method).toBe("download");
    expect(mockedDownloadBlobWithDetection).toHaveBeenCalled();
  });

  it("prunes only its own old backup files, keeping the newest MAX_BACKUP_FILES", async () => {
    const ourFiles = Array.from({ length: 62 }, (_, i) => {
      const day = String(i + 1).padStart(2, "0");
      return { kind: "file", name: `bookmarkforge-backup-2026-08-${day}.bmf` };
    });
    const foreignFiles = [
      { kind: "file", name: "notes.md" },
      { kind: "file", name: "other-backup.bmf" },
    ];
    const handle = makeDirHandle({
      name: "Vault",
      permission: "granted",
      entries: [...ourFiles, ...foreignFiles],
    });
    stubPicker(handle);
    const service = new DiskBackupService();
    await service.pickBackupFolder();

    await service.writeBackupToDisk(new Blob(["x"]), "today.bmf");

    // 62 ours → keep newest 60 → prune the 2 oldest.
    const removeEntry = handle.removeEntry as ReturnType<typeof vi.fn>;
    expect(removeEntry).toHaveBeenCalledTimes(2);
    expect(removeEntry).toHaveBeenNthCalledWith(
      1,
      "bookmarkforge-backup-2026-08-01.bmf",
    );
    expect(removeEntry).toHaveBeenNthCalledWith(
      2,
      "bookmarkforge-backup-2026-08-02.bmf",
    );
    // Foreign files are never touched.
    expect(removeEntry.mock.calls.flat()).not.toContain("notes.md");
    expect(removeEntry.mock.calls.flat()).not.toContain("other-backup.bmf");
  });

  it("clearBackupFolder() forgets the folder so writes go to Downloads", async () => {
    stubPicker(makeDirHandle({ name: "Vault", permission: "granted" }));
    const service = new DiskBackupService();
    await service.pickBackupFolder();
    expect(service.isSupported()).toBe(true);

    await service.clearBackupFolder();
    const result = await service.writeBackupToDisk(
      new Blob(["x"]),
      "backup.bmf",
    );
    expect(result?.method).toBe("download");
  });
});
