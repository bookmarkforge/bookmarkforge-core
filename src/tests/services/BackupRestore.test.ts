import { describe, test, expect, beforeEach, vi } from "vitest";
import { BackupService } from "../../services/BackupService";
import { encryptionService } from "../../services/EncryptionService";
import { settingsService } from "../../services/SettingsService";
import { initDB } from "../../db/database";

vi.mock("../../db/database", () => ({
  initDB: vi.fn(),
}));

vi.mock("../../services/SettingsService", () => ({
  settingsService: {
    exportSettings: vi.fn(),
    importSettings: vi.fn(),
  },
}));

vi.mock("../../services/EncryptionService", () => ({
  encryptionService: {
    encryptBinary: vi.fn(),
    decryptBinary: vi.fn(),
  },
}));

vi.mock("../../services/SecureStorage", () => ({
  secureStorage: {
    setSecret: vi.fn().mockResolvedValue(undefined),
    getSecret: vi.fn(),
    deleteSecret: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../services/SecurityVault", () => ({
  securityVault: {
    registerCaller: vi.fn(),
    withMasterPasswordBytes: vi.fn(
      (_caller: object, fn: (p: Uint8Array | null) => unknown) => {
        const pw = (globalThis as any).__VAULT_PASSWORD__ ?? null;
        return fn(pw ? new TextEncoder().encode(pw as string) : null);
      },
    ),
    onLock: vi.fn(() => () => {}),
    onUnlock: vi.fn(() => () => {}),
  },
}));

describe("BackupRestore", () => {
  let mockDb: any;
  let mockBookmarks: any;
  let mockDocuments: any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();

    mockBookmarks = {
      find: vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue([
          {
            toJSON: () => ({
              id: "b1",
              title: "Test Bookmark",
              url: "https://example.com",
            }),
          },
          {
            toJSON: () => ({
              id: "b2",
              title: "Another Bookmark",
              url: "https://test.org",
            }),
          },
        ]),
      }),
      bulkInsert: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue(undefined),
      bulkRemove: vi.fn().mockResolvedValue(undefined),
    };

    mockDocuments = {
      find: vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue([
          {
            toJSON: () => ({
              id: "d1",
              title: "Test Document",
              content: "hello",
            }),
          },
        ]),
      }),
      bulkInsert: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue(undefined),
      bulkRemove: vi.fn().mockResolvedValue(undefined),
    };

    mockDb = {
      collections: { bookmarks: mockBookmarks, documents: mockDocuments },
      bookmarks: mockBookmarks,
      documents: mockDocuments,
    };

    (initDB as any).mockResolvedValue(mockDb);
    (settingsService.exportSettings as any).mockReturnValue({
      theme: "dark",
      language: "es",
    });
  });

  describe("createBackupData", () => {
    test("generates a valid JSON blob without password", async () => {
      const result = await BackupService.createBackupData();

      expect(result.blob).toBeInstanceOf(Blob);
      expect(result.blob.type).toBe("application/json");
      expect(result.metadata.encrypted).toBe(false);
      expect(result.metadata.collections).toEqual(["bookmarks", "documents"]);
      expect(result.metadata.docCount).toBe(3);

      const text = await result.blob.text();
      const parsed = JSON.parse(text);
      expect(parsed.bookmarks).toHaveLength(2);
      expect(parsed.documents).toHaveLength(1);
      expect(parsed._app_settings).toEqual({ theme: "dark", language: "es" });
    });

    test("generates a binary .bmf blob with password", async () => {
      const fakeCipher = new Uint8Array([16, 32, 64, 128, 255]);
      (encryptionService.encryptBinary as any).mockResolvedValue(fakeCipher);

      const result = await BackupService.createBackupData("strong-password");

      expect(encryptionService.encryptBinary).toHaveBeenCalledWith(
        expect.objectContaining({ length: expect.any(Number) }),
        "strong-password",
      );
      expect(result.blob.type).toBe("application/octet-stream");
      expect(result.metadata.encrypted).toBe(true);
      expect(result.metadata.docCount).toBe(3);
    });
  });

  describe("exportBackup", () => {
    test("calls showSaveFilePicker with .json when no password", async () => {
      const mockWritable = {
        write: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      };
      const mockHandle = {
        createWritable: vi.fn().mockResolvedValue(mockWritable),
      };
      const showSaveFilePicker = vi.fn().mockResolvedValue(mockHandle);
      vi.stubGlobal("window", { showSaveFilePicker });
      vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));

      await BackupService.exportBackup();

      expect(showSaveFilePicker).toHaveBeenCalledTimes(1);
      const options = showSaveFilePicker.mock.calls[0]![0];
      expect(options.suggestedName).toContain(".json");
      expect(options.types[0].accept["application/json"]).toEqual([".json"]);
      expect(mockWritable.write).toHaveBeenCalled();
      expect(mockWritable.close).toHaveBeenCalled();
    });

    test("calls showSaveFilePicker with .bmf when password provided", async () => {
      const mockWritable = {
        write: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      };
      const mockHandle = {
        createWritable: vi.fn().mockResolvedValue(mockWritable),
      };
      const showSaveFilePicker = vi.fn().mockResolvedValue(mockHandle);
      vi.stubGlobal("window", { showSaveFilePicker });

      await BackupService.exportBackup("my-password");

      const options = showSaveFilePicker.mock.calls[0]![0];
      expect(options.suggestedName).toContain(".bmf");
      expect(options.types[0].accept["application/octet-stream"]).toEqual([
        ".bmf",
      ]);
    });
  });

  describe("importBackup", () => {
    test("restores data from a plain JSON file", async () => {
      const data = {
        bookmarks: [{ id: "b3", title: "Imported" }],
        _app_settings: { theme: "light" },
      };
      const json = JSON.stringify(data);
      const file = new File([json], "backup.json", {
        type: "application/json",
      });
      Object.defineProperty(file, "arrayBuffer", {
        value: vi.fn().mockResolvedValue(new TextEncoder().encode(json).buffer),
      });

      await BackupService.importBackup(file);

      expect(mockBookmarks.bulkInsert).toHaveBeenCalledWith([
        { id: "b3", title: "Imported" },
      ]);
      expect(settingsService.importSettings).toHaveBeenCalledWith({
        theme: "light",
      });
    });

    test("decrypts and restores from a .bmf file with correct password", async () => {
      const original = { bookmarks: [{ id: "b4", title: "Encrypted" }] };
      const json = `BMF1:${JSON.stringify(original)}`;
      const jsonBytes = new TextEncoder().encode(json);
      (encryptionService.decryptBinary as any).mockResolvedValue(jsonBytes);

      const file = new File([new Uint8Array([1, 2, 3])], "backup.bmf", {
        type: "application/octet-stream",
      });
      Object.defineProperty(file, "arrayBuffer", {
        value: vi.fn().mockResolvedValue(new ArrayBuffer(3)),
      });
      Object.defineProperty(file, "name", { value: "backup.bmf" });

      await BackupService.importBackup(file, "correct-password");

      expect(encryptionService.decryptBinary).toHaveBeenCalled();
      expect(mockBookmarks.bulkInsert).toHaveBeenCalledWith([
        { id: "b4", title: "Encrypted" },
      ]);
    });

    test("throws error when decrypting with wrong password", async () => {
      (encryptionService.decryptBinary as any).mockRejectedValue(
        new Error("Invalid password or corrupted backup file."),
      );

      const file = new File([new Uint8Array([4, 5, 6])], "backup.bmf", {
        type: "application/octet-stream",
      });
      Object.defineProperty(file, "arrayBuffer", {
        value: vi.fn().mockResolvedValue(new ArrayBuffer(3)),
      });
      Object.defineProperty(file, "name", { value: "backup.bmf" });

      await expect(
        BackupService.importBackup(file, "wrong-password"),
      ).rejects.toThrow(/Invalid password/i);
    });    test("rejects a truncated encrypted payload before touching the database", async () => {
      const truncated = new TextEncoder().encode("BMF1:{\"bookmarks\":[");
      (encryptionService.decryptBinary as any).mockResolvedValue(truncated);
      const file = new File([new Uint8Array([1, 2, 3])], "truncated.bmf", {
        type: "application/octet-stream",
      });
      Object.defineProperty(file, "arrayBuffer", {
        value: vi.fn().mockResolvedValue(new ArrayBuffer(3)),
      });

      await expect(BackupService.importBackup(file, "password")).rejects.toThrow(
        "not valid JSON",
      );
      expect(initDB).not.toHaveBeenCalled();
    });

    test("rejects an oversized backup before reading its contents", async () => {
      const file = new File(["small"], "oversized.json", {
        type: "application/json",
      });
      Object.defineProperty(file, "size", { value: 100 * 1024 * 1024 + 1 });
      const arrayBuffer = vi.fn();
      Object.defineProperty(file, "arrayBuffer", { value: arrayBuffer });

      await expect(BackupService.importBackup(file)).rejects.toThrow(
        "Backup file too large",
      );
      expect(arrayBuffer).not.toHaveBeenCalled();
      expect(initDB).not.toHaveBeenCalled();
    });

    test("rejects a backup containing a non-allowlisted collection", async () => {
      const json = JSON.stringify({
        bookmarks: [{ id: "b1" }],
        unexpected_collection: [{ id: "evil" }],
      });
      const file = new File([json], "unknown.json", { type: "application/json" });
      Object.defineProperty(file, "arrayBuffer", {
        value: vi.fn().mockResolvedValue(new TextEncoder().encode(json).buffer),
      });

      await expect(BackupService.importBackup(file)).rejects.toThrow(
        "Unsupported backup collection: unexpected_collection",
      );
      expect(initDB).not.toHaveBeenCalled();
    });

    test("rejects altered ciphertext and does not attempt a restore", async () => {
      (encryptionService.decryptBinary as any).mockRejectedValue(
        new Error("authentication tag mismatch"),
      );
      const file = new File([new Uint8Array([9, 8, 7, 6])], "altered.bmf", {
        type: "application/octet-stream",
      });
      Object.defineProperty(file, "arrayBuffer", {
        value: vi.fn().mockResolvedValue(new ArrayBuffer(4)),
      });

      await expect(BackupService.importBackup(file, "password")).rejects.toThrow(
        "Invalid password or corrupted backup file",
      );
      expect(initDB).not.toHaveBeenCalled();
    });

    test("throws error on corrupt file", async () => {
      const file = new File(["not-json"], "backup.json", {
        type: "application/json",
      });
      Object.defineProperty(file, "arrayBuffer", {
        value: vi
          .fn()
          .mockResolvedValue(new TextEncoder().encode("not-json").buffer),
      });

      await expect(BackupService.importBackup(file)).rejects.toThrow();
    });
  });


  describe("auto backup lifecycle", () => {
    test("runAutoBackup saves to secureStorage", async () => {
      const { secureStorage } = await import("../../services/SecureStorage");
      (globalThis as any).__VAULT_PASSWORD__ = "vault-key";

      const result = await BackupService.runAutoBackup();

      expect(result).not.toBeNull();
      expect(result!.encrypted).toBe(true);
      expect(secureStorage.setSecret).toHaveBeenCalledWith(
        "auto_backup_data_0",
        expect.any(String),
      );
      expect(secureStorage.setSecret).toHaveBeenCalledWith(
        "auto_backup_chunks",
        "1",
      );
      expect(secureStorage.setSecret).toHaveBeenCalledWith(
        "auto_backup_metadata",
        expect.any(String),
      );
    });

    test("getAutoBackupInfo returns metadata when backup exists", async () => {
      const { secureStorage } = await import("../../services/SecureStorage");
      const meta = {
        date: "2026-06-01T00:00:00.000Z",
        size: 256,
        encrypted: true,
        collections: ["bookmarks"],
        docCount: 2,
      };
      (secureStorage.getSecret as any).mockResolvedValue(JSON.stringify(meta));
      const stamp = Date.now() - 7200000;
      const getItem = vi.fn((key: string) =>
        key === "bmf_last_auto_backup" ? String(stamp) : null,
      );
      vi.stubGlobal("localStorage", {
        getItem,
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
        get length() {
          return 1;
        },
        key: vi.fn(),
      });

      const info = await BackupService.getAutoBackupInfo();

      expect(info.available).toBe(true);
      expect(info.metadata).toEqual(meta);
      expect(info.age).toBeGreaterThan(0);
    });

    test("restoreFromAutoBackup restores data from auto backup", async () => {
      const { secureStorage } = await import("../../services/SecureStorage");
      const { securityVault } = await import("../../services/SecurityVault");

      const backupData = { bookmarks: [{ id: "r1", title: "Restored" }] };
      const jsonBytes = new TextEncoder().encode(`BMF1:${JSON.stringify(backupData)}`);
      (encryptionService.decryptBinary as any).mockResolvedValue(jsonBytes);
      (secureStorage.getSecret as any).mockImplementation((key: string) => {
        if (key === "auto_backup_data")
          return Promise.resolve(btoa(String.fromCharCode(...jsonBytes)));
        if (key === "auto_backup_metadata")
          return Promise.resolve(
            JSON.stringify({
              encrypted: true,
              date: "2026-01-01",
              size: 10,
              collections: ["bookmarks"],
              docCount: 1,
            }),
          );
        return Promise.resolve(null);
      });
      (globalThis as any).__VAULT_PASSWORD__ = "vault-key";

      const success = await BackupService.restoreFromAutoBackup();

      expect(success).toBe(true);
      expect(mockBookmarks.bulkInsert).toHaveBeenCalledWith([
        {
          id: "r1",
          title: "Restored",
        },
      ]);
    });

    test("clearAutoBackup removes all auto backup data", async () => {
      const { secureStorage } = await import("../../services/SecureStorage");

      await BackupService.clearAutoBackup();

      expect(secureStorage.deleteSecret).toHaveBeenCalledWith(
        "auto_backup_data",
      );
      expect(secureStorage.deleteSecret).toHaveBeenCalledWith(
        "auto_backup_metadata",
      );
    });
  });
});
