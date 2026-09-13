import { describe, test, expect, beforeEach, vi } from "vitest";
import { BackupService } from "../../services/BackupService";
import { settingsService } from "../../services/SettingsService";
import { encryptionService } from "../../services/EncryptionService";
import { initDB } from "../../db/database";
import { COLLECTIONS } from "../../db/database.core";
import { STORAGE_KEYS } from "../../constants/storage-keys";
import { assertNoContentLeak } from "../utils/leakAssertions";

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

// Mirrors BackupService.createBackupData's MAGIC_HEADER (BMF1:) so the
// importBackup format-validation tests exercise the real export format.
const tagBackup = (obj: unknown): string => `BMF1:${JSON.stringify(obj)}`;
vi.mock("../../services/AuditLogService", () => ({
  auditLog: {
    record: vi.fn().mockResolvedValue(undefined),
  },
  rotateAuditSessionId: vi.fn(),
}));
vi.mock("../../utils/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// The daily auto-backup persists a best-effort disk copy through
// DiskBackupService. The real service touches the File System Access API /
// showDirectoryPicker, which is unavailable in jsdom — mock it so the disk
// branch matrix (success / download-blocked / null / failure) is testable.
const mockDiskBackup = vi.hoisted(() => ({
  buildBackupFileName: vi.fn(() => "backup.bmf"),
  writeBackupToDisk: vi.fn(),
}));
vi.mock("../../services/DiskBackupService", () => ({
  diskBackupService: mockDiskBackup,
}));

const { auditLog } = await import("../../services/AuditLogService");
const { logger } = await import("../../utils/logger");

describe("BackupService", () => {
  let mockDb: any;
  let mockCollection: any;
  let mockAnchor: any;
  let localStore: Record<string, string> = {};

  beforeEach(() => {
    vi.clearAllMocks();
    localStore = {};

    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
    vi.stubGlobal("localStorage", {
      getItem: vi.fn((key: string) => localStore[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        localStore[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete localStore[key];
      }),
      clear: vi.fn(() => {
        localStore = {};
      }),
      get length() {
        return Object.keys(localStore).length;
      },
      key: vi.fn((i: number) => Object.keys(localStore)[i] ?? null),
    });

    mockCollection = {
      find: vi.fn().mockReturnValue({
        exec: vi
          .fn()
          .mockResolvedValue([
            { toJSON: () => ({ id: "1", title: "Bookmark 1" }) },
          ]),
      }),
      bulkInsert: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue([]),
      bulkRemove: vi.fn().mockResolvedValue([]),
    };

    mockDb = {
      collections: {
        bookmarks: mockCollection,
      },
      bookmarks: mockCollection,
    };

    (initDB as any).mockResolvedValue(mockDb);
    // Reset mock implementations that might have been changed by other tests
    (settingsService.importSettings as any).mockReset();
    (settingsService.exportSettings as any).mockReset();
    (settingsService.exportSettings as any).mockReturnValue({ theme: "dark" });
    (encryptionService.encryptBinary as any).mockResolvedValue(
      new Uint8Array([1, 2, 3]),
    );

    mockAnchor = {
      href: "",
      download: "",
      click: vi.fn(),
    };
    vi.stubGlobal("document", {
      createElement: vi.fn().mockReturnValue(mockAnchor),
      body: {
        appendChild: vi.fn(),
        removeChild: vi.fn(),
      },
    });

    vi.stubGlobal("URL", {
      createObjectURL: vi.fn().mockReturnValue("blob:url"),
      revokeObjectURL: vi.fn(),
    });

    vi.stubGlobal("window", {
      showSaveFilePicker: undefined,
    });
  });

  describe("exportBackup", () => {
    test("should export database as plaintext JSON file download", async () => {
      await BackupService.exportBackup();

      expect(initDB).toHaveBeenCalled();
      expect(settingsService.exportSettings).toHaveBeenCalled();
      expect(document.createElement).toHaveBeenCalledWith("a");
      expect(mockAnchor.download).toContain("bookmarkforge-backup-");
      expect(mockAnchor.download).toContain(".json");
      expect(mockAnchor.click).toHaveBeenCalled();
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "backup_exported",
          result: "success",
          origin: "BackupService",
          context: expect.objectContaining({ encrypted: "false" }),
        }),
      );
    });

    test("rejects concurrent exports and clears a rejected password buffer", async () => {
      let release!: (value: { blob: Blob }) => void;
      const createBackupData = vi
        .spyOn(BackupService as any, "createBackupData")
        .mockReturnValue(new Promise((resolve) => { release = resolve; }));
      const firstExport = BackupService.exportBackup("first-password");
      const rejectedPassword = new TextEncoder().encode("second-password");

      await expect(BackupService.exportBackup(rejectedPassword)).rejects.toThrow(
        "Backup export already in progress",
      );
      expect(Array.from(rejectedPassword).every((byte) => byte === 0)).toBe(true);
      expect(createBackupData).toHaveBeenCalledTimes(1);

      release({ blob: new Blob(["backup"]) });
      await firstExport;
      createBackupData.mockRestore();
    });

    test("should encrypt data when password is provided", async () => {
      const mockEncryptedData = new Uint8Array([9, 8, 7]);
      (encryptionService.encryptBinary as any).mockResolvedValue(
        mockEncryptedData,
      );

      await BackupService.exportBackup("testpassword123");

      expect(encryptionService.encryptBinary).toHaveBeenCalledWith(
        expect.anything(),
        "testpassword123",
      );
      expect(mockAnchor.download).toContain(".bmf");
      expect(mockAnchor.click).toHaveBeenCalled();
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "backup_exported",
          result: "success",
          origin: "BackupService",
          context: expect.objectContaining({ encrypted: "true" }),
        }),
      );
    });
  });

  describe("createBackupData settings sanitization (L-02/L-03)", () => {
    test("denylista campos sensibles de _app_settings en el backup (L-02)", async () => {
      (settingsService.exportSettings as any).mockReturnValue({
        theme: "dark",
        ollamaUrl: "http://localhost:11434",
        customAiBaseUrl: "https://secret.example.com",
        selectedProvider: "ollama",
      });
      let capturedInput: Uint8Array | undefined;
      (encryptionService.encryptBinary as any).mockImplementationOnce(
        async (input: Uint8Array) => {
          capturedInput = new Uint8Array(input);
          return new Uint8Array([1, 2, 3]);
        },
      );
      await BackupService.createBackupData("test-pass-123");
      expect(capturedInput).toBeDefined();
      const json = new TextDecoder().decode(capturedInput!);
      const parsed = JSON.parse(json.replace(/^BMF1:/, ""));
      expect(parsed._app_settings).toEqual({ theme: "dark" });
      expect(parsed._app_settings.ollamaUrl).toBeUndefined();
      expect(parsed._app_settings.customAiBaseUrl).toBeUndefined();
      expect(parsed._app_settings.selectedProvider).toBeUndefined();
    });

    test("wipes ephemeral password bytes after decoding (L-03)", async () => {
      const bytes = new TextEncoder().encode("test-pass-123");
      await BackupService.createBackupData(bytes);
      expect(Array.from(bytes).every((b) => b === 0)).toBe(true);
    });
  });

  describe("importBackup", () => {
    test("should import plaintext JSON backup data successfully", async () => {
      const mockJson = tagBackup({
        bookmarks: [{ id: "1", title: "Bookmark 1" }],
        _app_settings: { theme: "light" },
      });

      const mockFile = new File([mockJson], "backup.json", {
        type: "application/json",
      });
      mockFile.arrayBuffer = vi
        .fn()
        .mockResolvedValue(new TextEncoder().encode(mockJson).buffer);

      await BackupService.importBackup(mockFile);

      expect(initDB).toHaveBeenCalled();
      expect(mockCollection.bulkInsert).toHaveBeenCalledWith([
        { id: "1", title: "Bookmark 1" },
      ]);
      expect(settingsService.importSettings).toHaveBeenCalledWith({
        theme: "light",
      });
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "backup_imported",
          result: "success",
          origin: "BackupService",
        }),
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("Import complete"),
      );
    });

    test("rejects a concurrent import without starting a second transaction", async () => {
      let resolveRead: ((buffer: ArrayBuffer) => void) | undefined;
      const firstJson = tagBackup({ bookmarks: [] });
      const firstFile = new File([firstJson], "first.json", {
        type: "application/json",
      });
      firstFile.arrayBuffer = vi.fn().mockImplementation(
        () => new Promise<ArrayBuffer>((resolve) => {
          resolveRead = resolve;
        }),
      );
      const secondFile = new File([firstJson], "second.json", {
        type: "application/json",
      });

      const firstImport = BackupService.importBackup(firstFile);
      await expect(BackupService.importBackup(secondFile)).rejects.toThrow(
        "Backup import already in progress",
      );

      resolveRead?.(new TextEncoder().encode(firstJson).buffer);
      await firstImport;
      expect(mockCollection.bulkInsert).toHaveBeenCalledTimes(1);
    });

    test("should decrypt and import encrypted backup data", async () => {
      const mockJson = JSON.stringify({
        bookmarks: [{ id: "2", title: "Bookmark 2" }],
      });
      const mockFile = new File(["encrypteddata"], "backup.bmf", {
        type: "application/octet-stream",
      });
      mockFile.arrayBuffer = vi.fn().mockResolvedValue(new ArrayBuffer(10));

      (encryptionService.decryptBinary as any).mockResolvedValue(
        new TextEncoder().encode(
          tagBackup({
            bookmarks: [{ id: "2", title: "Bookmark 2" }],
          }),
        ),
      );

      await BackupService.importBackup(mockFile, "mypassword");

      expect(encryptionService.decryptBinary).toHaveBeenCalled();
      expect(mockCollection.bulkInsert).toHaveBeenCalledWith([
        { id: "2", title: "Bookmark 2" },
      ]);
    });

    test("should throw error if encrypted backup is uploaded without a password", async () => {
      const mockFile = new File(["encrypteddata"], "backup.bmf", {
        type: "application/octet-stream",
      });
      mockFile.arrayBuffer = vi.fn().mockResolvedValue(new ArrayBuffer(10));

      await expect(BackupService.importBackup(mockFile)).rejects.toThrow(
        "Password required for encrypted backup.",
      );
    });

    test("should fall back to upsert when bulkInsert fails", async () => {
      mockCollection.bulkInsert = vi
        .fn()
        .mockRejectedValue(new Error("Bulk insert failed"));
      const docs = [
        { id: "1", title: "Doc 1" },
        { id: "2", title: "Doc 2" },
      ];
      const mockJson = tagBackup({ bookmarks: docs });
      const mockFile = new File([mockJson], "backup.json", {
        type: "application/json",
      });
      mockFile.arrayBuffer = vi
        .fn()
        .mockResolvedValue(new TextEncoder().encode(mockJson).buffer);

      await BackupService.importBackup(mockFile);

      expect(mockCollection.bulkInsert).toHaveBeenCalledWith(docs);
      expect(mockCollection.upsert).toHaveBeenCalledTimes(2);
      expect(mockCollection.upsert).toHaveBeenCalledWith(docs[0]);
      expect(mockCollection.upsert).toHaveBeenCalledWith(docs[1]);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Bulk insert failed"),
        expect.any(Object),
      );
    });
  });

  describe("runAutoBackup", () => {
    test("should skip if last backup was recent", async () => {
      const recentTime = Date.now() - 1000;
      localStorage.setItem("bmf_last_auto_backup", recentTime.toString());

      const result = await BackupService.runAutoBackup();

      expect(result).toBeNull();
      expect(logger.info).toHaveBeenCalledWith(
        "[AutoBackup] Skipping, last backup was recent",
      );
    });

    test("should create and store backup data", async () => {
      const { secureStorage } = await import("../../services/SecureStorage");
      (globalThis as any).__VAULT_PASSWORD__ = "vault-password";

      const result = await BackupService.runAutoBackup();

      expect(result).not.toBeNull();
      expect(result!.encrypted).toBe(true);
      expect(result!.collections).toContain("bookmarks");
      expect(result!.docCount).toBe(1);
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
      // Legacy single-record copy is removed in favour of the chunked form.
      expect(secureStorage.deleteSecret).toHaveBeenCalledWith("auto_backup_data");
      expect(localStorage.getItem("bmf_last_auto_backup")).not.toBeNull();
      expect(logger.info).toHaveBeenCalledWith(
        "[AutoBackup] Backup saved successfully",
        expect.objectContaining({
          size: expect.any(Number),
          docs: expect.any(Number),
        }),
      );
    });

    test("consumes the password buffer passed to the auto-backup callback", async () => {
      const { securityVault } = await import("../../services/SecurityVault");
      const passwordBytes = new TextEncoder().encode("vault-password");
      (securityVault.withMasterPasswordBytes as any).mockImplementationOnce(
        (_caller: object, fn: (bytes: Uint8Array) => unknown) => fn(passwordBytes),
      );

      const result = await BackupService.runAutoBackup();

      expect(result).not.toBeNull();
      expect(Array.from(passwordBytes).every((byte) => byte === 0)).toBe(true);
    });

    test("skips auto-backup when vault is locked (no password)", async () => {
      const { secureStorage } = await import("../../services/SecureStorage");
      (globalThis as any).__VAULT_PASSWORD__ = null;

      const result = await BackupService.runAutoBackup();

      // When vault is locked, auto-backup is skipped entirely (no plaintext fallback)
      expect(result).toBeNull();
      expect(secureStorage.setSecret).not.toHaveBeenCalledWith(
        "auto_backup_data",
        expect.any(String),
      );
      expect(logger.info).toHaveBeenCalledWith(
        "[AutoBackup] Vault locked, skipping auto-backup",
      );
    });
  });

  describe("getAutoBackupInfo", () => {
    test("should return available info when backup exists", async () => {
      const { secureStorage } = await import("../../services/SecureStorage");
      const metadata = {
        date: "2024-06-01T00:00:00.000Z",
        size: 100,
        encrypted: true,
        collections: ["bookmarks"],
        docCount: 5,
      };
      (secureStorage.getSecret as any).mockResolvedValue(
        JSON.stringify(metadata),
      );
      const backupTime = Date.now() - 3600000;
      localStorage.setItem("bmf_last_auto_backup", backupTime.toString());

      const info = await BackupService.getAutoBackupInfo();

      expect(info.available).toBe(true);
      expect(info.metadata).toEqual(metadata);
      expect(info.age).toBeGreaterThan(0);
    });

    test("should return unavailable when no backup metadata", async () => {
      const { secureStorage } = await import("../../services/SecureStorage");
      (secureStorage.getSecret as any).mockResolvedValue(null);

      const info = await BackupService.getAutoBackupInfo();

      expect(info.available).toBe(false);
      expect(info.metadata).toBeUndefined();
    });
  });

  describe("restoreFromAutoBackup", () => {
    test("should restore from stored auto-backup", async () => {
      const { secureStorage } = await import("../../services/SecureStorage");
      const { securityVault } = await import("../../services/SecurityVault");

      const validData = { bookmarks: [{ id: "1", title: "Restored" }] };
      const jsonBytes = new TextEncoder().encode(tagBackup(validData));
      (encryptionService.decryptBinary as any).mockResolvedValue(jsonBytes);

      (secureStorage.getSecret as any).mockImplementation((key: string) => {
        if (key === "auto_backup_data") return Promise.resolve("AQID");
        if (key === "auto_backup_metadata")
          return Promise.resolve(
            JSON.stringify({
              encrypted: true,
              date: "2024-01-01",
              size: 3,
              collections: ["bookmarks"],
              docCount: 1,
            }),
          );
        return Promise.resolve(null);
      });
      (globalThis as any).__VAULT_PASSWORD__ = "vault-password";

      const success = await BackupService.restoreFromAutoBackup();

      expect(success).toBe(true);
      expect(mockCollection.bulkInsert).toHaveBeenCalledWith([
        { id: "1", title: "Restored" },
      ]);
    });

    test("should return false when no backup data", async () => {
      const { secureStorage } = await import("../../services/SecureStorage");
      (secureStorage.getSecret as any).mockResolvedValue(null);

      const success = await BackupService.restoreFromAutoBackup();

      expect(success).toBe(false);
      expect(mockCollection.upsert).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        "[AutoBackup] No auto-backup available to restore",
      );
    });

    test("decodes base64 auto-backup in chunks", async () => {
      const { secureStorage } = await import("../../services/SecureStorage");
      const textData = tagBackup({ bookmarks: [{ id: "chunked", title: "Chunked" }] });
      const bytes = new TextEncoder().encode(textData);
      const base64 = btoa(String.fromCharCode(...bytes));
      (secureStorage.getSecret as any).mockImplementation((key: string) => {
        if (key === "auto_backup_data") return Promise.resolve(base64);
        if (key === "auto_backup_metadata") {
          return Promise.resolve(JSON.stringify({ encrypted: false }));
        }
        return Promise.resolve(null);
      });

      await expect(BackupService.restoreFromAutoBackup()).resolves.toBe(true);
      expect(mockCollection.bulkInsert).toHaveBeenCalledWith([
        { id: "chunked", title: "Chunked" },
      ]);
    });

    test("should restore unencrypted backup", async () => {
      const { secureStorage } = await import("../../services/SecureStorage");
      const textData = tagBackup({
        bookmarks: [{ id: "2", title: "Plain" }],
      });
      const base64 = btoa(
        String.fromCharCode(
          ...new Uint8Array(new TextEncoder().encode(textData)),
        ),
      );

      (secureStorage.getSecret as any).mockImplementation((key: string) => {
        if (key === "auto_backup_data") return Promise.resolve(base64);
        if (key === "auto_backup_metadata")
          return Promise.resolve(
            JSON.stringify({
              encrypted: false,
              date: "2024-01-01",
              size: base64.length,
              collections: ["bookmarks"],
              docCount: 1,
            }),
          );
        return Promise.resolve(null);
      });

      const success = await BackupService.restoreFromAutoBackup();

      expect(success).toBe(true);
      expect(mockCollection.bulkInsert).toHaveBeenCalledWith([
        { id: "2", title: "Plain" },
      ]);
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("Successfully restored"),
      );
    });
  });

  describe("clearAutoBackup", () => {
    test("should clear stored auto-backup data", async () => {
      const { secureStorage } = await import("../../services/SecureStorage");

      await BackupService.clearAutoBackup();

      expect(secureStorage.deleteSecret).toHaveBeenCalledWith(
        "auto_backup_data",
      );
      expect(secureStorage.deleteSecret).toHaveBeenCalledWith(
        "auto_backup_metadata",
      );
      expect(localStorage.removeItem).toHaveBeenCalledWith(
        "bmf_last_auto_backup",
      );
      expect(logger.info).toHaveBeenCalledWith(
        "[AutoBackup] Auto-backup cleared",
      );
    });

    test("should handle error when clearing auto-backup", async () => {
      const { secureStorage } = await import("../../services/SecureStorage");
      (secureStorage.deleteSecret as any).mockRejectedValue(
        new Error("Storage error"),
      );

      await BackupService.clearAutoBackup();

      expect(localStorage.removeItem).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        "[AutoBackup] Failed to clear auto-backup",
        expect.objectContaining({ error: "Storage error" }),
      );
    });
  });

  describe("exportBackup showSaveFilePicker", () => {
    let origWindow: any;

    beforeEach(() => {
      origWindow = vi.stubGlobal("window", {
        showSaveFilePicker: undefined,
        URL: {
          createObjectURL: vi.fn().mockReturnValue("blob:url"),
          revokeObjectURL: vi.fn(),
        },
        document: {
          createElement: vi.fn().mockReturnValue(mockAnchor),
          body: { appendChild: vi.fn(), removeChild: vi.fn() },
        },
      });
    });

    test("should use showSaveFilePicker when available", async () => {
      const mockWritable = {
        write: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      };
      const mockHandle = {
        createWritable: vi.fn().mockResolvedValue(mockWritable),
      };
      vi.stubGlobal("window", {
        showSaveFilePicker: vi.fn().mockResolvedValue(mockHandle),
        URL: { createObjectURL: vi.fn(), revokeObjectURL: vi.fn() },
        document: {
          createElement: vi.fn(),
          body: { appendChild: vi.fn(), removeChild: vi.fn() },
        },
      });

      await BackupService.exportBackup();

      expect(window.showSaveFilePicker).toHaveBeenCalled();
    });

    test("should silently return when showSaveFilePicker is aborted", async () => {
      const abortError = new Error("User cancelled");
      abortError.name = "AbortError";
      vi.stubGlobal("window", {
        showSaveFilePicker: vi.fn().mockRejectedValue(abortError),
        URL: { createObjectURL: vi.fn(), revokeObjectURL: vi.fn() },
        document: {
          createElement: vi.fn(),
          body: { appendChild: vi.fn(), removeChild: vi.fn() },
        },
      });

      await expect(BackupService.exportBackup()).resolves.toBeUndefined();
    });

    test("should fallback to download when showSaveFilePicker fails", async () => {
      vi.stubGlobal("window", {
        showSaveFilePicker: vi.fn().mockRejectedValue(new Error("API error")),
        URL: {
          createObjectURL: vi.fn().mockReturnValue("blob:url"),
          revokeObjectURL: vi.fn(),
        },
        document: {
          createElement: vi.fn().mockReturnValue(mockAnchor),
          body: { appendChild: vi.fn(), removeChild: vi.fn() },
        },
      });

      await BackupService.exportBackup();

      expect(mockAnchor.click).toHaveBeenCalled();
    });
  });

  describe("importBackup edge cases", () => {
    test("should throw error for invalid backup format", async () => {
      const mockFile = new File(["not json"], "backup.json", {
        type: "application/json",
      });
      mockFile.arrayBuffer = vi
        .fn()
        .mockResolvedValue(new TextEncoder().encode("not json").buffer);

      await expect(BackupService.importBackup(mockFile)).rejects.toThrow();
    });

    test("should throw error when backup data is null", async () => {
      const mockFile = new File(["null"], "backup.json", {
        type: "application/json",
      });
      mockFile.arrayBuffer = vi
        .fn()
        .mockResolvedValue(new TextEncoder().encode("null").buffer);

      await expect(BackupService.importBackup(mockFile)).rejects.toThrow(
        "Invalid or corrupted backup format",
      );
    });

    test("should reject backup with non-existent collection", async () => {
      const mockJson = tagBackup({
        nonexistent_collection: [{ id: "1" }],
      });
      const mockFile = new File([mockJson], "backup.json", {
        type: "application/json",
      });
      mockFile.arrayBuffer = vi
        .fn()
        .mockResolvedValue(new TextEncoder().encode(mockJson).buffer);

      await expect(BackupService.importBackup(mockFile)).rejects.toThrow(
        "Unsupported backup collection: nonexistent_collection",
      );

      expect(mockCollection.bulkInsert).not.toHaveBeenCalled();
    });
  });

  describe("importBackup parse-corruption guard", () => {
    test("throws an opaque message (no payload leak) for malformed JSON", async () => {
      const secret = "very-private-token-DO-NOT-LEAK-9f4b";
      const malformed = `{"_backup_meta":{"formatVersion":2},"bookmarks":[{"id":"x","title":"${secret}"]}`;
      const mockFile = new File([malformed], "backup.json", {
        type: "application/json",
      });
      mockFile.arrayBuffer = vi
        .fn()
        .mockResolvedValue(new TextEncoder().encode(malformed).buffer);

      // The raw V8 SyntaxError must never reach the user/audit log / the
      // returned Error.message: it embeds a fragment of the input, which
      // can include user secrets.
      let rejected: unknown;
      try {
        await BackupService.importBackup(mockFile);
      } catch (err) {
        rejected = err;
      }
      expect(rejected).toBeInstanceOf(Error);
      expect((rejected as Error).message).toBe("Backup file is not valid JSON");
      assertNoContentLeak(
        secret,
        rejected,
        ...((logger.error as any).mock.calls as unknown[][]),
      );
    });

    test("throws the same opaque message for an empty file", async () => {
      const mockFile = new File([""], "backup.json", {
        type: "application/json",
      });
      mockFile.arrayBuffer = vi
        .fn()
        .mockResolvedValue(new TextEncoder().encode("").buffer);

      await expect(BackupService.importBackup(mockFile)).rejects.toThrow(
        "Backup file is not valid JSON",
      );
    });

    test("shape errors still surface verbatim after a successful parse", async () => {
      // Valid JSON, but the envelope fails validateBackupEnvelope: the
      // existing "Invalid or corrupted backup format" message must still
      // reach the user (regression guard for the new helper).
      const mockFile = new File(["42"], "backup.json", {
        type: "application/json",
      });
      mockFile.arrayBuffer = vi
        .fn()
        .mockResolvedValue(new TextEncoder().encode("42").buffer);

      await expect(BackupService.importBackup(mockFile)).rejects.toThrow(
        "Invalid or corrupted backup format",
      );
    });
  });

  describe("runAutoBackup edge cases", () => {
    test("should run backup when last backup is stale", async () => {
      const oldTime = Date.now() - 48 * 60 * 60 * 1000;
      localStorage.setItem("bmf_last_auto_backup", oldTime.toString());
      const { secureStorage } = await import("../../services/SecureStorage");
      (globalThis as any).__VAULT_PASSWORD__ = "vault-password";
      // The chunked write path calls deleteSecret (legacy cleanup) and
      // getSecret (previous chunk count). Reset both so a leftover rejection
      // from another test cannot leak into this one.
      (secureStorage.deleteSecret as any).mockResolvedValue(undefined);
      (secureStorage.getSecret as any).mockResolvedValue(null);

      const result = await BackupService.runAutoBackup();

      expect(result).not.toBeNull();
      expect(secureStorage.setSecret).toHaveBeenCalled();
    });
  });

  describe("restoreFromAutoBackup edge cases", () => {
    test("should throw when vault is locked for encrypted backup", async () => {
      const { secureStorage } = await import("../../services/SecureStorage");
      const { securityVault } = await import("../../services/SecurityVault");

      (secureStorage.getSecret as any).mockImplementation((key: string) => {
        if (key === "auto_backup_data") return Promise.resolve("AQID");
        if (key === "auto_backup_metadata")
          return Promise.resolve(JSON.stringify({ encrypted: true }));
        return Promise.resolve(null);
      });
      (globalThis as any).__VAULT_PASSWORD__ = null;

      const success = await BackupService.restoreFromAutoBackup();

      expect(success).toBe(false);
    });

    test("should handle settings import in restore path", async () => {
      const { secureStorage } = await import("../../services/SecureStorage");
      const { securityVault } = await import("../../services/SecurityVault");

      const validData = {
        _app_settings: { theme: "light" },
        bookmarks: [{ id: "1", title: "Restored" }],
      };
      const jsonBytes = new TextEncoder().encode(JSON.stringify(validData));

      (secureStorage.getSecret as any).mockImplementation((key: string) => {
        if (key === "auto_backup_data")
          return Promise.resolve(
            btoa(String.fromCharCode(...new Uint8Array(jsonBytes))),
          );
        if (key === "auto_backup_metadata") return Promise.resolve(null);
        return Promise.resolve(null);
      });

      (globalThis as any).__VAULT_PASSWORD__ = null;

      const success = await BackupService.restoreFromAutoBackup();

      expect(success).toBe(true);
      expect(mockCollection.bulkInsert).toHaveBeenCalledWith([
        { id: "1", title: "Restored" },
      ]);
    });
  });

  describe("exportBackup failure", () => {
    test("should log failure when exportBackup throws", async () => {
      (encryptionService.encryptBinary as any).mockRejectedValue(
        new Error("Crypto failure"),
      );
      await expect(BackupService.exportBackup("password")).rejects.toThrow(
        "Crypto failure",
      );
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "backup_exported",
          result: "failure",
          origin: "BackupService",
        }),
      );
      expect(logger.error).toHaveBeenCalledWith(
        "Failed to export backup",
        expect.objectContaining({ error: "Crypto failure" }),
      );
    });

    test("should abort early when user cancels plaintext export (confirm=false)", async () => {
      vi.stubGlobal(
        "confirm",
        vi.fn(() => false),
      );
      await BackupService.exportBackup();
      expect(logger.info).toHaveBeenCalledWith(
        "[Backup] Plaintext export cancelled by user",
      );
      expect(document.createElement).not.toHaveBeenCalled();
    });
  });

  describe("importBackup rollback memory guard", () => {
    test("aborts before snapshotting an oversized existing collection", async () => {
      const mockJson = tagBackup({ bookmarks: [{ id: "incoming" }] });
      const mockFile = new File([mockJson], "backup.json", {
        type: "application/json",
      });
      mockFile.arrayBuffer = vi
        .fn()
        .mockResolvedValue(new TextEncoder().encode(mockJson).buffer);
      mockCollection.count = vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue(50_001),
      });

      await expect(BackupService.importBackup(mockFile)).rejects.toThrow(
        /rollback limit is 50000/,
      );
      expect(mockCollection.find).not.toHaveBeenCalled();
      expect(mockCollection.bulkInsert).not.toHaveBeenCalled();
    });
  });

  describe("importBackup partial failure", () => {
    test("should handle partial failures during import", async () => {
      (settingsService.importSettings as any).mockImplementation(() => {
        throw new Error("Settings corrupted");
      });
      const mockJson = tagBackup({
        _app_settings: { theme: "broken" },
        bookmarks: [{ id: "1" }],
      });
      const mockFile = new File([mockJson], "backup.json", {
        type: "application/json",
      });
      mockFile.arrayBuffer = vi
        .fn()
        .mockResolvedValue(new TextEncoder().encode(mockJson).buffer);

      await expect(BackupService.importBackup(mockFile)).rejects.toThrow(
        "Import completed with 1 errors",
      );
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "backup_imported",
          result: "failure",
          origin: "BackupService",
          context: expect.objectContaining({ errorCount: "1" }),
        }),
      );
      expect(logger.warn).toHaveBeenCalledWith(
        "[Backup] Import failed — snapshot restored",
      );
    });
  });

  describe("importBackup rollback atomicity", () => {
    test("restores settings when a later collection write fails", async () => {
      mockCollection.bulkInsert = vi
        .fn()
        .mockRejectedValue(new Error("write interrupted"));
      mockCollection.upsert = vi.fn().mockImplementation((doc: { id?: string }) =>
        doc.id === "new-doc"
          ? Promise.reject(new Error("write interrupted"))
          : Promise.resolve(),
      );
      const mockJson = tagBackup({
        _app_settings: { theme: "light" },
        bookmarks: [{ id: "new-doc" }],
      });
      const mockFile = new File([mockJson], "backup.json", {
        type: "application/json",
      });
      mockFile.arrayBuffer = vi
        .fn()
        .mockResolvedValue(new TextEncoder().encode(mockJson).buffer);

      await expect(BackupService.importBackup(mockFile)).rejects.toThrow(
        "Import completed with 1 errors",
      );
      expect(settingsService.importSettings).toHaveBeenNthCalledWith(1, {
        theme: "light",
      });
      expect(settingsService.importSettings).toHaveBeenNthCalledWith(2, {
        theme: "dark",
      });
      expect(mockCollection.bulkRemove).toHaveBeenCalledWith(["new-doc"]);
    });
  });

  describe("importBackup outer catch", () => {
    test("should handle file read error gracefully", async () => {
      const mockFile = new File(["x"], "backup.bmf", {
        type: "application/octet-stream",
      });
      mockFile.arrayBuffer = vi
        .fn()
        .mockRejectedValue(new Error("File read error"));

      await expect(BackupService.importBackup(mockFile)).rejects.toThrow(
        "File read error",
      );
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "backup_imported",
          result: "failure",
          origin: "BackupService",
        }),
      );
      expect(logger.error).toHaveBeenCalledWith(
        "Failed to import backup",
        expect.objectContaining({ error: "File read error" }),
      );
    });
  });

  describe("blobToBase64 — error paths", () => {
    test("should reject when FileReader.result is not a string", async () => {
      // Forzamos reader.result a ArrayBuffer (no string)
      const origFileReader = globalThis.FileReader;
      vi.stubGlobal(
        "FileReader",
        vi.fn(function MockFileReader() {
          return {
            readAsDataURL: vi.fn(function (this: any) {
              Promise.resolve().then(() => {
                this.result = new ArrayBuffer(8); // no string
                this.onload?.();
              });
            }),
            onload: null,
            onerror: null,
            error: null,
          };
        }),
      );

      // blobToBase64 es privado — se prueba indirectamente via runAutoBackup que necesita el blob en base64
      // To test directly, we mock encryptionService to resolve with a blob
      (encryptionService.encryptBinary as any).mockResolvedValue(
        new Uint8Array([1, 2, 3]),
      );
      (globalThis as any).__VAULT_PASSWORD__ = "vault-password";

      const result = await BackupService.runAutoBackup();

      // blobToBase64 failed → no auto-backup data record (chunked or legacy)
      // is written.
      const { secureStorage } = await import("../../services/SecureStorage");
      const dataCalls = (secureStorage.setSecret as any).mock.calls.filter(
        (c: [string]) => (c[0] as string).startsWith("auto_backup_data"),
      );
      expect(dataCalls).toHaveLength(0);
      // El error se loggea
      expect(logger.error).toHaveBeenCalled();

      vi.stubGlobal("FileReader", origFileReader);
    });
  });

  describe("runAutoBackup too large", () => {
    test("should skip auto-backup when blob exceeds max size", async () => {
      // Fake a >200 MB blob without allocating it: only `size` matters for the
      // guard (the blob is never read once the size check fails).
      const fakeBlob = new Blob(["x"]);
      Object.defineProperty(fakeBlob, "size", { value: 201 * 1024 * 1024 });
      const spy = vi.spyOn(BackupService, "createBackupData").mockResolvedValue({
        blob: fakeBlob,
        metadata: {
          date: "2026-08-16T00:00:00.000Z",
          size: 201 * 1024 * 1024,
          encrypted: true,
          collections: ["bookmarks"],
          docCount: 1,
        },
      } as never);
      (globalThis as any).__VAULT_PASSWORD__ = "vault-password";
      localStorage.setItem(
        "bmf_last_auto_backup",
        (Date.now() - 48 * 60 * 60 * 1000).toString(),
      );

      try {
        const result = await BackupService.runAutoBackup();

        expect(result).toBeNull();
        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringContaining("Backup too large"),
        );
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe("restoreFromAutoBackup rollback memory guard", () => {
    test("aborts before snapshotting an oversized existing collection", async () => {
      const { secureStorage } = await import("../../services/SecureStorage");
      const validData = tagBackup({ bookmarks: [{ id: "incoming" }] });
      const base64 = btoa(
        String.fromCharCode(...new TextEncoder().encode(validData)),
      );
      (secureStorage.getSecret as any).mockImplementation((key: string) => {
        if (key === "auto_backup_data") return Promise.resolve(base64);
        if (key === "auto_backup_metadata") {
          return Promise.resolve(JSON.stringify({ encrypted: false }));
        }
        return Promise.resolve(null);
      });
      mockCollection.count = vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue(50_001),
      });

      await expect(BackupService.restoreFromAutoBackup()).resolves.toBe(false);
      expect(mockCollection.find).not.toHaveBeenCalled();
      expect(mockCollection.bulkInsert).not.toHaveBeenCalled();
    });
  });

  describe("restoreFromAutoBackup failure", () => {
    test("should handle restore error gracefully", async () => {
      const { secureStorage } = await import("../../services/SecureStorage");
      (secureStorage.getSecret as any).mockRejectedValue(
        new Error("IndexedDB error"),
      );

      const result = await BackupService.restoreFromAutoBackup();

      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        "[AutoBackup] Failed to restore from auto-backup",
        expect.objectContaining({ error: "IndexedDB error" }),
      );
    });
  });

  // ============================================================
  // NEW COVERAGE TESTS — RESTORE EDGE CASES
  // ============================================================

  describe("importBackup — datos corruptos", () => {
    test("should reject file > 100 MB", async () => {
      const mockFile = new File([""], "backup.json");
      Object.defineProperty(mockFile, "size", {
        value: 101 * 1024 * 1024,
      });

      await expect(BackupService.importBackup(mockFile)).rejects.toThrow(
        /too large/i,
      );
    });

    test("should reject backup with invalid _app_settings type", async () => {
      const mockJson = JSON.stringify({
        _app_settings: "not-an-object",
        bookmarks: [{ id: "1", title: "Test" }],
      });
      const mockFile = new File([mockJson], "backup.json", {
        type: "application/json",
      });
      mockFile.arrayBuffer = vi
        .fn()
        .mockResolvedValue(new TextEncoder().encode(mockJson).buffer);

      await expect(BackupService.importBackup(mockFile)).rejects.toThrow(
        "Invalid backup settings payload",
      );
      expect(initDB).not.toHaveBeenCalled();
      expect(mockCollection.bulkInsert).not.toHaveBeenCalled();
    });

    test("should reject document without id field", async () => {
      const mockJson = JSON.stringify({
        bookmarks: [{ title: "No ID" }],
      });
      const mockFile = new File([mockJson], "backup.json", {
        type: "application/json",
      });
      mockFile.arrayBuffer = vi
        .fn()
        .mockResolvedValue(new TextEncoder().encode(mockJson).buffer);

      await expect(BackupService.importBackup(mockFile)).rejects.toThrow(
        /errors/,
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Rejected 1 invalid doc"),
      );
    });

    test("should reject document with non-string id", async () => {
      const mockJson = JSON.stringify({
        bookmarks: [{ id: 12345, title: "Numeric ID" }],
      });
      const mockFile = new File([mockJson], "backup.json", {
        type: "application/json",
      });
      mockFile.arrayBuffer = vi
        .fn()
        .mockResolvedValue(new TextEncoder().encode(mockJson).buffer);

      await expect(BackupService.importBackup(mockFile)).rejects.toThrow(
        /errors/,
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Rejected 1 invalid doc"),
      );
    });

    test("should reject document with overly long id (>512 chars)", async () => {
      const longId = "a".repeat(513);
      const mockJson = JSON.stringify({
        bookmarks: [{ id: longId, title: "Too long ID" }],
      });
      const mockFile = new File([mockJson], "backup.json", {
        type: "application/json",
      });
      mockFile.arrayBuffer = vi
        .fn()
        .mockResolvedValue(new TextEncoder().encode(mockJson).buffer);

      await expect(BackupService.importBackup(mockFile)).rejects.toThrow(
        /errors/,
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Rejected 1 invalid doc"),
      );
    });

    test("should reject document with Array as doc", async () => {
      const mockJson = JSON.stringify({
        bookmarks: [["array-item"]],
      });
      const mockFile = new File([mockJson], "backup.json", {
        type: "application/json",
      });
      mockFile.arrayBuffer = vi
        .fn()
        .mockResolvedValue(new TextEncoder().encode(mockJson).buffer);

      await expect(BackupService.importBackup(mockFile)).rejects.toThrow(
        /errors/,
      );
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Rejected 1 invalid doc"),
      );
    });

    test("rejects a known collection with a non-array payload before writing", async () => {
      const mockJson = JSON.stringify({
        bookmarks: "not-an-array",
      });
      const mockFile = new File([mockJson], "backup.json", {
        type: "application/json",
      });
      mockFile.arrayBuffer = vi
        .fn()
        .mockResolvedValue(new TextEncoder().encode(mockJson).buffer);

      await expect(BackupService.importBackup(mockFile)).rejects.toThrow(
        /Invalid backup collection payload: bookmarks/,
      );
      expect(initDB).not.toHaveBeenCalled();
      expect(mockCollection.bulkInsert).not.toHaveBeenCalled();
    });
  });

  describe("importBackup — format and corruption guards", () => {
    test("rejects a truncated JSON file before opening the vault", async () => {
      const truncated = '{"bookmarks":[{"id":"b1"}';
      const mockFile = new File([truncated], "backup.json", {
        type: "application/json",
      });
      mockFile.arrayBuffer = vi
        .fn()
        .mockResolvedValue(new TextEncoder().encode(truncated).buffer);

      await expect(BackupService.importBackup(mockFile)).rejects.toThrow();
      expect(initDB).not.toHaveBeenCalled();
      expect(mockCollection.bulkInsert).not.toHaveBeenCalled();
    });

    test("rejects encrypted payloads without the authenticated BMF1 marker", async () => {
      const plainJson = JSON.stringify({ bookmarks: [{ id: "unmarked" }] });
      (encryptionService.decryptBinary as any).mockResolvedValue(
        new TextEncoder().encode(plainJson),
      );
      const mockFile = new File(["ciphertext"], "backup.bmf", {
        type: "application/octet-stream",
      });
      mockFile.arrayBuffer = vi
        .fn()
        .mockResolvedValue(new ArrayBuffer(10));

      await expect(
        BackupService.importBackup(mockFile, "backup-password"),
      ).rejects.toThrow("Invalid or corrupted encrypted backup format");
      expect(initDB).not.toHaveBeenCalled();
      expect(mockCollection.bulkInsert).not.toHaveBeenCalled();
    });

    test("rejects an unsupported newer backup format before any write", async () => {
      const future = tagBackup({
        _backup_meta: { formatVersion: 999 },
        bookmarks: [{ id: "future" }],
      });
      const mockFile = new File([future], "backup.json", {
        type: "application/json",
      });
      mockFile.arrayBuffer = vi
        .fn()
        .mockResolvedValue(new TextEncoder().encode(future).buffer);

      await expect(BackupService.importBackup(mockFile)).rejects.toThrow(
        /Unsupported backup format version/,
      );
      expect(initDB).not.toHaveBeenCalled();
      expect(mockCollection.bulkInsert).not.toHaveBeenCalled();
    });

    test("accepts the current version emitted by createBackupData", async () => {
      let capturedInput: Uint8Array | undefined;
      (encryptionService.encryptBinary as any).mockImplementationOnce(
        async (input: Uint8Array) => {
          capturedInput = new Uint8Array(input);
          return new Uint8Array([1, 2, 3]);
        },
      );
      await BackupService.createBackupData("current-format-password");

      const exported = new TextDecoder().decode(capturedInput);
      const parsed = JSON.parse(exported.replace(/^BMF1:/, ""));
      expect(parsed._backup_meta).toEqual(
        expect.objectContaining({ formatVersion: 2 }),
      );
    });
  });

  describe("importBackup — empty backup", () => {
    test("should import empty backup (empty object {}) successfully", async () => {
      const mockJson = "{}";
      const mockFile = new File([mockJson], "backup.json", {
        type: "application/json",
      });
      mockFile.arrayBuffer = vi
        .fn()
        .mockResolvedValue(new TextEncoder().encode(mockJson).buffer);

      await BackupService.importBackup(mockFile);

      expect(mockCollection.bulkInsert).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("Import complete"),
      );
    });

    test("should import backup with empty collection (no docs)", async () => {
      mockCollection.find = vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue([]),
      });
      const mockJson = JSON.stringify({ bookmarks: [] });
      const mockFile = new File([mockJson], "backup.json", {
        type: "application/json",
      });
      mockFile.arrayBuffer = vi
        .fn()
        .mockResolvedValue(new TextEncoder().encode(mockJson).buffer);

      await BackupService.importBackup(mockFile);

      expect(mockCollection.bulkInsert).toHaveBeenCalledWith([]);
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("Import complete"),
      );
    });

    test("should import backup with only _app_settings", async () => {
      const mockJson = JSON.stringify({
        _app_settings: { theme: "dark" },
      });
      const mockFile = new File([mockJson], "backup.json", {
        type: "application/json",
      });
      mockFile.arrayBuffer = vi
        .fn()
        .mockResolvedValue(new TextEncoder().encode(mockJson).buffer);

      await BackupService.importBackup(mockFile);

      expect(settingsService.importSettings).toHaveBeenCalledWith({
        theme: "dark",
      });
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("Import complete"),
      );
    });
  });

  describe("restoreFromAutoBackup — edge cases", () => {
    test("should restore flat backup without metadata (null)", async () => {
      const { secureStorage } = await import("../../services/SecureStorage");

      const plainData = JSON.stringify({
        bookmarks: [{ id: "r1", title: "Plain restore" }],
      });
      const base64 = btoa(
        String.fromCharCode(
          ...new Uint8Array(new TextEncoder().encode(plainData)),
        ),
      );

      (secureStorage.getSecret as any).mockImplementation((key: string) => {
        if (key === "auto_backup_data") return Promise.resolve(base64);
        // metadata returns null — triggers plain text restore path
        if (key === "auto_backup_metadata") return Promise.resolve(null);
        return Promise.resolve(null);
      });

      const success = await BackupService.restoreFromAutoBackup();

      expect(success).toBe(true);
      expect(mockCollection.bulkInsert).toHaveBeenCalledWith([
        { id: "r1", title: "Plain restore" },
      ]);
    });
  });

  describe("decryptData — empty password", () => {
    test("should reject empty password with required-password error", async () => {
      const mockFile = new File([new Uint8Array([1, 2, 3])], "backup.bmf", {
        type: "application/octet-stream",
      });
      mockFile.arrayBuffer = vi
        .fn()
        .mockResolvedValue(new ArrayBuffer(3));

      // Empty string is falsy; importBackup's guard clause catches it first
      await expect(BackupService.importBackup(mockFile, "")).rejects.toThrow(
        "Password required for encrypted backup.",
      );
    });

    test("should reject whitespace-only password via decryptData", async () => {
      const mockFile = new File([new Uint8Array([1, 2, 3])], "backup.bmf", {
        type: "application/octet-stream",
      });
      mockFile.arrayBuffer = vi
        .fn()
        .mockResolvedValue(new ArrayBuffer(3));

      // Whitespace-only es truthy, pasa el guard, decryptData rejects it.
      await expect(
        BackupService.importBackup(mockFile, "   "),
      ).rejects.toThrow(/password.*empty/i);
    });
  });

  describe("importBackup — rollback failure", () => {
    test("handles settings rollback failure during collection import failure", async () => {
      // First call: importSettings succeeds during import (for settings in backup)
      // Second call: importSettings throws during rollback
      let callCount = 0;
      (settingsService.importSettings as any).mockImplementation(() => {
        callCount++;
        if (callCount === 2) {
          throw new Error("Settings rollback failed");
        }
      });
      mockCollection.bulkInsert = vi
        .fn()
        .mockRejectedValue(new Error("write failed"));
      mockCollection.upsert = vi.fn().mockRejectedValue(new Error("upsert failed too"));

      const mockJson = tagBackup({
        _app_settings: { theme: "light" },
        bookmarks: [{ id: "new-doc" }],
      });
      const mockFile = new File([mockJson], "backup.json", {
        type: "application/json",
      });
      mockFile.arrayBuffer = vi
        .fn()
        .mockResolvedValue(new TextEncoder().encode(mockJson).buffer);

      await expect(BackupService.importBackup(mockFile)).rejects.toThrow();
      // Rollback error was logged but did not throw
      expect(logger.error).toHaveBeenCalledWith(
        "[Backup] Rollback failed for application settings",
        expect.objectContaining({ error: "Settings rollback failed" }),
      );
    });

    test("handles collection upsert rollback failure during import rollback", async () => {
      mockCollection.bulkInsert = vi
        .fn()
        .mockRejectedValue(new Error("write failed"));
      // The upsert during rollback also fails
      mockCollection.upsert = vi.fn().mockRejectedValue(new Error("rollback upsert failed"));

      const mockJson = tagBackup({
        bookmarks: [{ id: "existing" }, { id: "new-doc" }],
      });
      const mockFile = new File([mockJson], "backup.json", {
        type: "application/json",
      });
      mockFile.arrayBuffer = vi
        .fn()
        .mockResolvedValue(new TextEncoder().encode(mockJson).buffer);

      await expect(BackupService.importBackup(mockFile)).rejects.toThrow();
      // Rollback error for the collection was logged
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("Rollback failed for bookmarks"),
        expect.objectContaining({ error: "rollback upsert failed" }),
      );
    });
  });

  describe("clearAutoBackup — chunked records", () => {
    test("clears chunked backup records in addition to legacy keys", async () => {
      const { secureStorage } = await import("../../services/SecureStorage");
      (secureStorage.getSecret as any).mockImplementation((key: string) => {
        if (key === "auto_backup_chunks") return Promise.resolve("3");
        return Promise.resolve(null);
      });

      await BackupService.clearAutoBackup();

      // Verify all chunked records were deleted
      expect(secureStorage.deleteSecret).toHaveBeenCalledWith("auto_backup_data_0");
      expect(secureStorage.deleteSecret).toHaveBeenCalledWith("auto_backup_data_1");
      expect(secureStorage.deleteSecret).toHaveBeenCalledWith("auto_backup_data_2");
      expect(secureStorage.deleteSecret).toHaveBeenCalledWith("auto_backup_chunks");
      expect(secureStorage.deleteSecret).toHaveBeenCalledWith("auto_backup_data");
      expect(secureStorage.deleteSecret).toHaveBeenCalledWith("auto_backup_metadata");
    });
  });

  describe("readAutoBackupBase64 — corrupted chunk count", () => {
    test("falls back to legacy when chunk count is non-numeric", async () => {
      const { secureStorage } = await import("../../services/SecureStorage");
      (globalThis as any).__VAULT_PASSWORD__ = "vault-password";
      const legacyData = tagBackup({ bookmarks: [{ id: "legacy" }] });
      const base64 = btoa(new TextDecoder().decode(new TextEncoder().encode(legacyData)));
      (secureStorage.getSecret as any).mockImplementation((key: string) => {
        if (key === "auto_backup_chunks") return Promise.resolve("not-a-number");
        if (key === "auto_backup_data") return Promise.resolve(base64);
        if (key === "auto_backup_metadata")
          return Promise.resolve(JSON.stringify({ encrypted: false }));
        return Promise.resolve(null);
      });

      const success = await BackupService.restoreFromAutoBackup();

      expect(success).toBe(true);
      expect(mockCollection.bulkInsert).toHaveBeenCalled();
    });
  });

  describe("P84 — schema-derived backup allow-list", () => {
    const EXCLUDED = new Set(["highlights", "insights"]);
    const LEGACY_COMPAT = ["tags", "prompts", "workflows", "agents", "memories"];

    test("exportBackup exports exactly COLLECTIONS minus the excluded ones", async () => {
      // Build a db whose collections mirror the real schema registry. Because
      // the mockDb is constructed from COLLECTIONS itself, adding a new
      // collection to the schema automatically flows through: it appears in
      // the mock, in the expected list, and (if the derivation is correct) in
      // the exported metadata. Any drift in BackupService fails loudly.
      const fullMockDb: any = { collections: {} };
      for (const name of Object.keys(COLLECTIONS)) {
        fullMockDb.collections[name] = mockCollection;
        fullMockDb[name] = mockCollection;
      }
      (initDB as any).mockResolvedValue(fullMockDb);

      const { metadata } = await BackupService.createBackupData();

      const expected = Object.keys(COLLECTIONS)
        .filter((name) => !EXCLUDED.has(name))
        .sort();
      expect([...metadata.collections].sort()).toEqual(expected);
      expect(metadata.collections).not.toContain("highlights");
      expect(metadata.collections).not.toContain("insights");
    });

    test("importBackup tolera colecciones legacy sin schema (tags/prompts/...)", async () => {
      // These names have no schema today; they must stay accepted so legacy
      // backup files still restore. db[col] is undefined → silent skip, no error.
      const mockJson = tagBackup({
        tags: [{ id: "t1" }],
        prompts: [{ id: "p1" }],
        workflows: [{ id: "w1" }],
        agents: [{ id: "a1" }],
        memories: [{ id: "m1" }],
      });
      const mockFile = new File([mockJson], "backup.json", {
        type: "application/json",
      });
      mockFile.arrayBuffer = vi
        .fn()
        .mockResolvedValue(new TextEncoder().encode(mockJson).buffer);

      await BackupService.importBackup(mockFile);

      expect(mockCollection.bulkInsert).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining("Import complete"),
      );
    });

    test("importBackup rejects excluded collections (highlights) as unknown", async () => {
      // highlights/insights are real collections but deliberately not
      // restorable from backups (derived/regenerable data).
      const mockJson = tagBackup({ highlights: [{ id: "h1" }] });
      const mockFile = new File([mockJson], "backup.json", {
        type: "application/json",
      });
      mockFile.arrayBuffer = vi
        .fn()
        .mockResolvedValue(new TextEncoder().encode(mockJson).buffer);

      await expect(BackupService.importBackup(mockFile)).rejects.toThrow(
        "Unsupported backup collection: highlights",
      );
      expect(mockCollection.bulkInsert).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // BRANCH-COVERAGE EXTENSIONS (v8 report)
  // ============================================================

  describe("getBackupDocumentId / envelope branches", () => {
    test("imports legacy docs identified by _id only", async () => {
      const mockJson = tagBackup({ bookmarks: [{ _id: "legacy-1", title: "T" }] });
      const mockFile = new File([mockJson], "backup.json", {
        type: "application/json",
      });
      mockFile.arrayBuffer = vi
        .fn()
        .mockResolvedValue(new TextEncoder().encode(mockJson).buffer);

      await BackupService.importBackup(mockFile);

      expect(mockCollection.bulkInsert).toHaveBeenCalledWith([
        { _id: "legacy-1", title: "T" },
      ]);
    });

    test("accepts a valid versioned envelope on import", async () => {
      const mockJson = tagBackup({
        _backup_meta: { formatVersion: 2, createdAt: "2026-01-01T00:00:00.000Z" },
        bookmarks: [],
      });
      const mockFile = new File([mockJson], "backup.json", {
        type: "application/json",
      });
      mockFile.arrayBuffer = vi
        .fn()
        .mockResolvedValue(new TextEncoder().encode(mockJson).buffer);

      await BackupService.importBackup(mockFile);

      expect(mockCollection.bulkInsert).toHaveBeenCalledWith([]);
    });
  });

  describe("encryptData / decryptData branches", () => {
    test("exports plaintext with a warning for a whitespace-only password", async () => {
      const { blob } = await BackupService.createBackupData("   ");
      // The blob is plaintext JSON (no BMF1 magic / encryption) and the
      // warning is emitted even though a password was passed.
      expect(blob.type).toBe("application/json");
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Empty password provided"),
      );
    });

    test("logs non-Error decrypt failures as strings", async () => {
      (encryptionService.decryptBinary as any).mockRejectedValue(
        "corrupt payload",
      );
      const mockFile = new File(["ciphertext"], "backup.bmf", {
        type: "application/octet-stream",
      });
      mockFile.arrayBuffer = vi.fn().mockResolvedValue(new ArrayBuffer(10));

      await expect(
        BackupService.importBackup(mockFile, "password"),
      ).rejects.toThrow("Invalid password or corrupted backup file");
      expect(logger.error).toHaveBeenCalledWith(
        "[Backup] Failed to decrypt data",
        expect.objectContaining({ error: "corrupt payload" }),
      );
    });
  });

  describe("createBackupData collection branches", () => {
    test("skips collections without a backing store during export", async () => {
      // A phantom name present in db.collections but with no db[name]
      // accessor must be skipped, not crash the export.
      mockDb.collections = {
        bookmarks: mockCollection,
        phantom: mockCollection,
      };
      delete mockDb.phantom;

      const { metadata } = await BackupService.createBackupData();

      expect(metadata.collections).toEqual(["bookmarks"]);
    });
  });

  describe("exportBackup failure branches", () => {
    test("survives auditLog failures during a successful export", async () => {
      (auditLog.record as any).mockRejectedValue("audit-boom");

      await BackupService.exportBackup();

      expect(logger.warn).toHaveBeenCalledWith("[Backup] auditLog failed", {
        error: "audit-boom",
      });
    });

    test("aborts the partial file and rethrows when the picker write fails", async () => {
      const mockWritable = {
        write: vi.fn().mockRejectedValue(new Error("write failed")),
        close: vi.fn(),
        abort: vi.fn().mockResolvedValue(undefined),
      };
      const mockHandle = {
        createWritable: vi.fn().mockResolvedValue(mockWritable),
      };
      vi.stubGlobal("window", {
        showSaveFilePicker: vi.fn().mockResolvedValue(mockHandle),
        URL: { createObjectURL: vi.fn(), revokeObjectURL: vi.fn() },
        document: {
          createElement: vi.fn(),
          body: { appendChild: vi.fn(), removeChild: vi.fn() },
        },
      });

      await expect(BackupService.exportBackup()).rejects.toThrow(
        "write failed",
      );
      expect(mockWritable.abort).toHaveBeenCalled();
    });

    test("logs non-Error abort failures when tearing down a partial file", async () => {
      const mockWritable = {
        write: vi.fn().mockRejectedValue(new Error("write failed")),
        close: vi.fn(),
        abort: vi.fn().mockRejectedValue("abort-boom"),
      };
      const mockHandle = {
        createWritable: vi.fn().mockResolvedValue(mockWritable),
      };
      vi.stubGlobal("window", {
        showSaveFilePicker: vi.fn().mockResolvedValue(mockHandle),
        URL: { createObjectURL: vi.fn(), revokeObjectURL: vi.fn() },
        document: {
          createElement: vi.fn(),
          body: { appendChild: vi.fn(), removeChild: vi.fn() },
        },
      });

      await expect(BackupService.exportBackup()).rejects.toThrow(
        "write failed",
      );
      expect(logger.warn).toHaveBeenCalledWith(
        "[Backup] Failed to abort partial file",
        expect.objectContaining({ error: "abort-boom" }),
      );
    });

    test("falls back to download when the picker rejects with a non-Error", async () => {
      vi.stubGlobal("window", {
        showSaveFilePicker: vi.fn().mockRejectedValue("api-boom"),
        URL: {
          createObjectURL: vi.fn().mockReturnValue("blob:url"),
          revokeObjectURL: vi.fn(),
        },
        document: {
          createElement: vi.fn().mockReturnValue(mockAnchor),
          body: { appendChild: vi.fn(), removeChild: vi.fn() },
        },
      });

      await BackupService.exportBackup();

      expect(mockAnchor.click).toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("falling back to download link"),
        expect.objectContaining({ error: "api-boom" }),
      );
    });

    test("reports Unknown reason and String() for non-Error export failures", async () => {
      (encryptionService.encryptBinary as any).mockRejectedValue(
        "crypto-boom",
      );

      await expect(BackupService.exportBackup("password")).rejects.toBe(
        "crypto-boom",
      );
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "backup_exported",
          result: "failure",
          context: expect.objectContaining({ reason: "Unknown" }),
        }),
      );
      expect(logger.error).toHaveBeenCalledWith(
        "Failed to export backup",
        expect.objectContaining({ error: "crypto-boom" }),
      );
    });
  });

  describe("importCollectionsData failure branches", () => {
    test("logs non-Error settings import failures", async () => {
      (settingsService.importSettings as any).mockImplementation(() => {
        throw "settings-boom";
      });
      const mockJson = tagBackup({ _app_settings: { theme: "x" } });
      const mockFile = new File([mockJson], "backup.json", {
        type: "application/json",
      });
      mockFile.arrayBuffer = vi
        .fn()
        .mockResolvedValue(new TextEncoder().encode(mockJson).buffer);

      await expect(BackupService.importBackup(mockFile)).rejects.toThrow(
        /errors/,
      );
      expect(logger.error).toHaveBeenCalledWith(
        "Failed to restore settings from backup",
        expect.objectContaining({ error: "settings-boom" }),
      );
    });

    test("logs non-Error bulk insert failures and falls back to upsert", async () => {
      mockCollection.bulkInsert = vi.fn().mockRejectedValue("bulk-boom");
      const mockJson = tagBackup({ bookmarks: [{ id: "1" }] });
      const mockFile = new File([mockJson], "backup.json", {
        type: "application/json",
      });
      mockFile.arrayBuffer = vi
        .fn()
        .mockResolvedValue(new TextEncoder().encode(mockJson).buffer);

      await BackupService.importBackup(mockFile);

      expect(mockCollection.upsert).toHaveBeenCalledWith({ id: "1" });
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Bulk insert failed"),
        expect.objectContaining({ error: "bulk-boom" }),
      );
    });

    test("logs non-Error upsert failures and counts them", async () => {
      mockCollection.bulkInsert = vi.fn().mockRejectedValue(new Error("boom"));
      mockCollection.upsert = vi.fn().mockRejectedValue("upsert-boom");
      const mockJson = tagBackup({ bookmarks: [{ id: "1" }] });
      const mockFile = new File([mockJson], "backup.json", {
        type: "application/json",
      });
      mockFile.arrayBuffer = vi
        .fn()
        .mockResolvedValue(new TextEncoder().encode(mockJson).buffer);

      await expect(BackupService.importBackup(mockFile)).rejects.toThrow(
        /errors/,
      );
      expect(logger.error).toHaveBeenCalledWith(
        "Failed to upsert doc in bookmarks",
        expect.objectContaining({ error: "upsert-boom" }),
      );
    });
  });

  describe("rollback snapshot branches", () => {
    test("aborts when find returns more docs than the rollback limit", async () => {
      const many = Array.from({ length: 50_001 }, (_, i) => ({
        toJSON: () => ({ id: `x${i}` }),
      }));
      mockCollection.find = vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue(many),
      });
      const mockJson = tagBackup({ bookmarks: [{ id: "incoming" }] });
      const mockFile = new File([mockJson], "backup.json", {
        type: "application/json",
      });
      mockFile.arrayBuffer = vi
        .fn()
        .mockResolvedValue(new TextEncoder().encode(mockJson).buffer);

      await expect(BackupService.importBackup(mockFile)).rejects.toThrow(
        /exceeds the rollback limit/,
      );
    });

    test("consumes Uint8Array passwords on import", async () => {
      const mockJson = tagBackup({ bookmarks: [{ id: "1" }] });
      const mockFile = new File([mockJson], "backup.json", {
        type: "application/json",
      });
      mockFile.arrayBuffer = vi
        .fn()
        .mockResolvedValue(new TextEncoder().encode(mockJson).buffer);
      const passwordBytes = new TextEncoder().encode("import-password");

      await BackupService.importBackup(mockFile, passwordBytes);

      expect(Array.from(passwordBytes).every((b) => b === 0)).toBe(true);
      expect(mockCollection.bulkInsert).toHaveBeenCalled();
    });

    test("survives auditLog failures during a successful import", async () => {
      (auditLog.record as any).mockRejectedValue("audit-boom");
      const mockJson = tagBackup({ bookmarks: [] });
      const mockFile = new File([mockJson], "backup.json", {
        type: "application/json",
      });
      mockFile.arrayBuffer = vi
        .fn()
        .mockResolvedValue(new TextEncoder().encode(mockJson).buffer);

      await BackupService.importBackup(mockFile);

      expect(logger.warn).toHaveBeenCalledWith("[Backup] auditLog failed", {
        error: "audit-boom",
      });
    });

    test("logs non-Error settings rollback failures", async () => {
      let callCount = 0;
      (settingsService.importSettings as any).mockImplementation(() => {
        callCount++;
        if (callCount === 2) {throw "rollback-boom";}
      });
      mockCollection.bulkInsert = vi.fn().mockRejectedValue(new Error("x"));
      mockCollection.upsert = vi.fn().mockRejectedValue(new Error("y"));
      const mockJson = tagBackup({
        _app_settings: { theme: "light" },
        bookmarks: [{ id: "new-doc" }],
      });
      const mockFile = new File([mockJson], "backup.json", {
        type: "application/json",
      });
      mockFile.arrayBuffer = vi
        .fn()
        .mockResolvedValue(new TextEncoder().encode(mockJson).buffer);

      await expect(BackupService.importBackup(mockFile)).rejects.toThrow();
      expect(logger.error).toHaveBeenCalledWith(
        "[Backup] Rollback failed for application settings",
        expect.objectContaining({ error: "rollback-boom" }),
      );
    });

    test("reports Unknown reason for non-Error import failures", async () => {
      const mockFile = new File(["x"], "backup.bmf", {
        type: "application/octet-stream",
      });
      mockFile.arrayBuffer = vi.fn().mockRejectedValue("read-boom");

      await expect(BackupService.importBackup(mockFile)).rejects.toBe(
        "read-boom",
      );
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "backup_imported",
          result: "failure",
          context: expect.objectContaining({ reason: "Unknown" }),
        }),
      );
      expect(logger.error).toHaveBeenCalledWith(
        "Failed to import backup",
        expect.objectContaining({ error: "read-boom" }),
      );
    });
  });

  describe("runAutoBackup timestamp and disk-copy branches", () => {
    test("proceeds when the stored auto-backup timestamp is not a number", async () => {
      localStorage.setItem("bmf_last_auto_backup", "not-a-number");
      (globalThis as any).__VAULT_PASSWORD__ = "vault-password";
      const { secureStorage } = await import("../../services/SecureStorage");
      (secureStorage.deleteSecret as any).mockResolvedValue(undefined);
      (secureStorage.getSecret as any).mockResolvedValue(null);

      const result = await BackupService.runAutoBackup();

      expect(result).not.toBeNull();
      expect(secureStorage.setSecret).toHaveBeenCalled();
    });

    test("persists a successful disk copy result", async () => {
      (globalThis as any).__VAULT_PASSWORD__ = "vault-password";
      mockDiskBackup.writeBackupToDisk.mockResolvedValue({
        method: "folder",
        name: "vault-2026-09-05.bmf",
      });

      await BackupService.runAutoBackup();

      expect(mockDiskBackup.writeBackupToDisk).toHaveBeenCalled();
      expect(
        JSON.parse(localStorage.getItem(STORAGE_KEYS.LAST_DISK_BACKUP_RESULT)!),
      ).toEqual(expect.objectContaining({ method: "folder", error: null }));
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "auto_backup_disk",
          result: "success",
          context: { method: "folder" },
        }),
      );
    });

    test("persists a download-blocked disk result with the gesture hint", async () => {
      (globalThis as any).__VAULT_PASSWORD__ = "vault-password";
      mockDiskBackup.writeBackupToDisk.mockResolvedValue({
        method: "download-blocked",
        name: "x.bmf",
      });

      await BackupService.runAutoBackup();

      const saved = JSON.parse(
        localStorage.getItem(STORAGE_KEYS.LAST_DISK_BACKUP_RESULT)!,
      );
      expect(saved.error).toBe("browser requires user gesture (export manually)");
    });

    test("persists a write-failed disk result when the disk write returns null", async () => {
      (globalThis as any).__VAULT_PASSWORD__ = "vault-password";
      mockDiskBackup.writeBackupToDisk.mockResolvedValue(null);

      await BackupService.runAutoBackup();

      const saved = JSON.parse(
        localStorage.getItem(STORAGE_KEYS.LAST_DISK_BACKUP_RESULT)!,
      );
      expect(saved).toEqual(
        expect.objectContaining({ method: null, error: "write failed" }),
      );
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "auto_backup_disk",
          result: "failure",
          context: { method: "none" },
        }),
      );
    });

    test("logs disk copy failures (best-effort, backup still succeeds)", async () => {
      (globalThis as any).__VAULT_PASSWORD__ = "vault-password";
      mockDiskBackup.writeBackupToDisk.mockRejectedValue("disk-boom");

      const result = await BackupService.runAutoBackup();

      expect(result).not.toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        "[AutoBackup] Disk copy failed (best-effort)",
        expect.objectContaining({ error: "disk-boom" }),
      );
    });

    test("survives auditLog failures during the disk copy", async () => {
      (globalThis as any).__VAULT_PASSWORD__ = "vault-password";
      mockDiskBackup.writeBackupToDisk.mockResolvedValue({
        method: "folder",
        name: "x.bmf",
      });
      (auditLog.record as any).mockRejectedValue("audit-boom");

      const result = await BackupService.runAutoBackup();

      expect(result).not.toBeNull();
      expect(logger.warn).toHaveBeenCalledWith("[AutoBackup] auditLog failed", {
        error: "audit-boom",
      });
    });

    test("ignores localStorage failures while persisting the disk result", async () => {
      (globalThis as any).__VAULT_PASSWORD__ = "vault-password";
      mockDiskBackup.writeBackupToDisk.mockResolvedValue({
        method: "folder",
        name: "x.bmf",
      });
      (localStorage.setItem as any).mockImplementation(() => {
        throw new Error("quota exceeded");
      });

      const result = await BackupService.runAutoBackup();

      expect(result).not.toBeNull();
    });
  });

  describe("auto-backup info branches", () => {
    test("returns undefined age when no last-backup timestamp exists", async () => {
      const { secureStorage } = await import("../../services/SecureStorage");
      (secureStorage.getSecret as any).mockResolvedValue(
        JSON.stringify({
          date: "2024-06-01T00:00:00.000Z",
          size: 100,
          encrypted: true,
          collections: ["bookmarks"],
          docCount: 5,
        }),
      );

      const info = await BackupService.getAutoBackupInfo();

      expect(info.available).toBe(true);
      expect(info.age).toBeUndefined();
    });

    test("parses a valid disk backup result", () => {
      localStorage.setItem(
        STORAGE_KEYS.LAST_DISK_BACKUP_RESULT,
        JSON.stringify({ method: "folder", timestamp: 123456, error: null }),
      );
      expect(BackupService.getDiskBackupInfo()).toEqual({
        method: "folder",
        timestamp: 123456,
        error: null,
      });
    });

    test("normalizes invalid disk backup result fields", () => {
      localStorage.setItem(
        STORAGE_KEYS.LAST_DISK_BACKUP_RESULT,
        JSON.stringify({ method: "bogus", timestamp: "x", error: 42 }),
      );
      expect(BackupService.getDiskBackupInfo()).toEqual({
        method: null,
        timestamp: null,
        error: null,
      });
    });

    test("returns empty info without a stored disk result", () => {
      expect(BackupService.getDiskBackupInfo()).toEqual({
        method: null,
        timestamp: null,
        error: null,
      });
    });

    test("tolerates corrupt disk result JSON", () => {
      localStorage.setItem(STORAGE_KEYS.LAST_DISK_BACKUP_RESULT, "not json");
      expect(BackupService.getDiskBackupInfo()).toEqual({
        method: null,
        timestamp: null,
        error: null,
      });
    });
  });

  describe("restoreFromAutoBackup failure branches", () => {
    test("rolls back and reports failure when the auto-restore has errors", async () => {
      const { secureStorage } = await import("../../services/SecureStorage");
      const payload = JSON.stringify({
        _app_settings: { theme: "light" },
        bookmarks: [{ id: "v1" }, { bad: 1 }],
      });
      const base64 = btoa(String.fromCharCode(...new TextEncoder().encode(payload)));
      (secureStorage.getSecret as any).mockImplementation((key: string) => {
        if (key === "auto_backup_data") return Promise.resolve(base64);
        if (key === "auto_backup_metadata")
          return Promise.resolve(JSON.stringify({ encrypted: false }));
        return Promise.resolve(null);
      });

      const success = await BackupService.restoreFromAutoBackup();

      expect(success).toBe(false);
      // Settings rolled back to the pre-restore snapshot (exportSettings).
      expect(settingsService.importSettings).toHaveBeenLastCalledWith({
        theme: "dark",
      });
      // The pre-existing snapshot doc is restored and the import-owned id is
      // removed.
      expect(mockCollection.upsert).toHaveBeenCalledWith({
        id: "1",
        title: "Bookmark 1",
      });
      expect(mockCollection.bulkRemove).toHaveBeenCalledWith(["v1"]);
      expect(logger.warn).toHaveBeenCalledWith(
        "[AutoBackup] Auto-restore failed — snapshot restored",
      );
    });

    test("logs non-Error settings rollback failures in auto-restore", async () => {
      const { secureStorage } = await import("../../services/SecureStorage");
      let callCount = 0;
      (settingsService.importSettings as any).mockImplementation(() => {
        callCount++;
        if (callCount === 2) {throw "rollback-boom";}
      });
      const payload = JSON.stringify({
        _app_settings: { theme: "light" },
        bookmarks: [{ bad: 1 }],
      });
      const base64 = btoa(String.fromCharCode(...new TextEncoder().encode(payload)));
      (secureStorage.getSecret as any).mockImplementation((key: string) => {
        if (key === "auto_backup_data") return Promise.resolve(base64);
        if (key === "auto_backup_metadata")
          return Promise.resolve(JSON.stringify({ encrypted: false }));
        return Promise.resolve(null);
      });

      await BackupService.restoreFromAutoBackup();

      expect(logger.error).toHaveBeenCalledWith(
        "[AutoBackup] Rollback failed for application settings",
        expect.objectContaining({ error: "rollback-boom" }),
      );
    });

    test("logs non-Error rollback upsert failures in auto-restore", async () => {
      const { secureStorage } = await import("../../services/SecureStorage");
      const payload = JSON.stringify({ bookmarks: [{ bad: 1 }] });
      const base64 = btoa(String.fromCharCode(...new TextEncoder().encode(payload)));
      (secureStorage.getSecret as any).mockImplementation((key: string) => {
        if (key === "auto_backup_data") return Promise.resolve(base64);
        if (key === "auto_backup_metadata")
          return Promise.resolve(JSON.stringify({ encrypted: false }));
        return Promise.resolve(null);
      });
      mockCollection.upsert = vi.fn().mockRejectedValue("rb-boom");

      await BackupService.restoreFromAutoBackup();

      expect(logger.error).toHaveBeenCalledWith(
        "[AutoBackup] Rollback failed for bookmarks",
        expect.objectContaining({ error: "rb-boom" }),
      );
    });

    test("logs non-Error failures restoring from auto-backup", async () => {
      const { secureStorage } = await import("../../services/SecureStorage");
      (secureStorage.getSecret as any).mockRejectedValue("idb-boom");

      const success = await BackupService.restoreFromAutoBackup();

      expect(success).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        "[AutoBackup] Failed to restore from auto-backup",
        expect.objectContaining({ error: "idb-boom" }),
      );
    });

    test("rejects corrupt auto-backup base64", async () => {
      const { secureStorage } = await import("../../services/SecureStorage");
      (secureStorage.getSecret as any).mockImplementation((key: string) => {
        if (key === "auto_backup_data") return Promise.resolve("!!!!");
        if (key === "auto_backup_metadata")
          return Promise.resolve(JSON.stringify({ encrypted: false }));
        return Promise.resolve(null);
      });

      const success = await BackupService.restoreFromAutoBackup();

      expect(success).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        "[AutoBackup] Failed to restore from auto-backup",
        expect.anything(),
      );
    });

    test("decodes multi-chunk base64 auto-backups with a yield", async () => {
      const { secureStorage } = await import("../../services/SecureStorage");
      // ~790 KB of payload → >1M base64 chars → two decode chunks + a yield.
      const payload = JSON.stringify({
        bookmarks: [{ id: "big", title: "x".repeat(800_000) }],
      });
      // Spread-args conversion would blow the stack at this size — chunk it.
      const bytes = new TextEncoder().encode(payload);
      let base64 = "";
      for (let i = 0; i < bytes.length; i += 0x8000) {
        base64 += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      base64 = btoa(base64);
      (secureStorage.getSecret as any).mockImplementation((key: string) => {
        if (key === "auto_backup_data") return Promise.resolve(base64);
        if (key === "auto_backup_metadata")
          return Promise.resolve(JSON.stringify({ encrypted: false }));
        return Promise.resolve(null);
      });

      await expect(BackupService.restoreFromAutoBackup()).resolves.toBe(true);
    });

    test("restores from the chunked storage form", async () => {
      const { secureStorage } = await import("../../services/SecureStorage");
      const payload = JSON.stringify({ bookmarks: [{ id: "chunked" }] });
      const base64 = btoa(String.fromCharCode(...new TextEncoder().encode(payload)));
      (secureStorage.getSecret as any).mockImplementation((key: string) => {
        if (key === "auto_backup_chunks") return Promise.resolve("1");
        if (key === "auto_backup_data_0") return Promise.resolve(base64);
        if (key === "auto_backup_metadata")
          return Promise.resolve(JSON.stringify({ encrypted: false }));
        return Promise.resolve(null);
      });

      await expect(BackupService.restoreFromAutoBackup()).resolves.toBe(true);
      expect(mockCollection.bulkInsert).toHaveBeenCalledWith([{ id: "chunked" }]);
    });

    test("rejects a missing chunked record", async () => {
      const { secureStorage } = await import("../../services/SecureStorage");
      const payload = JSON.stringify({ bookmarks: [{ id: "x" }] });
      const base64 = btoa(String.fromCharCode(...new TextEncoder().encode(payload)));
      (secureStorage.getSecret as any).mockImplementation((key: string) => {
        if (key === "auto_backup_chunks") return Promise.resolve("2");
        if (key === "auto_backup_data_0") return Promise.resolve(base64);
        return Promise.resolve(null);
      });

      const success = await BackupService.restoreFromAutoBackup();

      expect(success).toBe(false);
      // The missing chunk surfaces through the outer catch.
      expect(logger.error).toHaveBeenCalledWith(
        "[AutoBackup] Failed to restore from auto-backup",
        expect.objectContaining({ error: "Auto-backup chunk 1 missing" }),
      );
    });
  });

  describe("storage chunk lifecycle branches", () => {
    test("prunes stale chunks from a previous larger backup", async () => {
      const { secureStorage } = await import("../../services/SecureStorage");
      (globalThis as any).__VAULT_PASSWORD__ = "vault-password";
      (secureStorage.deleteSecret as any).mockResolvedValue(undefined);
      (secureStorage.getSecret as any).mockImplementation((key: string) => {
        if (key === "auto_backup_chunks") return Promise.resolve("3");
        return Promise.resolve(null);
      });

      await BackupService.runAutoBackup();

      // New backup has 1 chunk; stale 1..2 are pruned.
      expect(secureStorage.deleteSecret).toHaveBeenCalledWith(
        "auto_backup_data_1",
      );
      expect(secureStorage.deleteSecret).toHaveBeenCalledWith(
        "auto_backup_data_2",
      );
    });

    test("logs non-Error clear failures", async () => {
      const { secureStorage } = await import("../../services/SecureStorage");
      (secureStorage.deleteSecret as any).mockRejectedValue("clear-boom");

      await BackupService.clearAutoBackup();

      expect(logger.error).toHaveBeenCalledWith(
        "[AutoBackup] Failed to clear auto-backup",
        expect.objectContaining({ error: "clear-boom" }),
      );
    });
  });

  describe("blobToBase64 failure branches", () => {
    test("handles readAsDataURL throwing synchronously", async () => {
      const origFileReader = globalThis.FileReader;
      vi.stubGlobal(
        "FileReader",
        vi.fn(function MockFileReader() {
          return {
            readAsDataURL: vi.fn(() => {
              throw "boom";
            }),
            onload: null,
            onerror: null,
            error: null,
          };
        }),
      );
      (globalThis as any).__VAULT_PASSWORD__ = "vault-password";

      const result = await BackupService.runAutoBackup();

      expect(result).toBeNull();
      const { secureStorage } = await import("../../services/SecureStorage");
      const dataCalls = (secureStorage.setSecret as any).mock.calls.filter(
        (c: [string]) => (c[0] as string).startsWith("auto_backup_data"),
      );
      expect(dataCalls).toHaveLength(0);

      vi.stubGlobal("FileReader", origFileReader);
    });

    test("rejects blob reads without a comma separator", async () => {
      const origFileReader = globalThis.FileReader;
      vi.stubGlobal(
        "FileReader",
        vi.fn(function MockFileReader() {
          return {
            readAsDataURL: vi.fn(function (this: any) {
              Promise.resolve().then(() => {
                this.result = "data:audio";
                this.onload?.();
              });
            }),
            onload: null,
            onerror: null,
            error: null,
          };
        }),
      );
      (globalThis as any).__VAULT_PASSWORD__ = "vault-password";

      const result = await BackupService.runAutoBackup();

      expect(result).toBeNull();
      vi.stubGlobal("FileReader", origFileReader);
    });

    test("rejects blob reads whose reader reports a non-Error", async () => {
      const origFileReader = globalThis.FileReader;
      vi.stubGlobal(
        "FileReader",
        vi.fn(function MockFileReader() {
          return {
            readAsDataURL: vi.fn(function (this: any) {
              Promise.resolve().then(() => {
                this.error = "read-boom";
                this.onerror?.();
              });
            }),
            onload: null,
            onerror: null,
            error: null,
          };
        }),
      );
      (globalThis as any).__VAULT_PASSWORD__ = "vault-password";

      const result = await BackupService.runAutoBackup();

      expect(result).toBeNull();
      vi.stubGlobal("FileReader", origFileReader);
    });
  });
});
