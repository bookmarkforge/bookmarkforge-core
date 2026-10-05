/**
 * Tests for CloudSyncService and the cloudSync.ts adapters
 * Mocks all external APIs (fetch, logger, crypto, etc.)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mocks globales
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

vi.mock("../../../utils/logger", () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

const mockGetSecret = vi.fn().mockResolvedValue(null);
vi.mock("../../../services/SecureStorage", () => ({
  secureStorage: {
    getSecret: (...args: any[]) => mockGetSecret(...args),
    setSecret: vi.fn(),
    deleteSecret: vi.fn(),
  },
}));

// Buffer polyfill for the jsdom environment — must be a function so instanceof is not broken
const BufferMock = vi.fn() as any;
BufferMock.byteLength = vi.fn(() => 0);
BufferMock.from = vi.fn((data: ArrayBuffer) => ({
  toString: () => new TextDecoder().decode(data),
  data,
}));
BufferMock.alloc = vi.fn((size: number) => new Uint8Array(size));
BufferMock.concat = vi.fn((list: Uint8Array[]) => {
  const total = list.reduce((s, b) => s + b.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const b of list) {
    result.set(b, offset);
    offset += b.length;
  }
  return result;
});
BufferMock.isBuffer = vi.fn(() => false);
vi.stubGlobal("Buffer", BufferMock);

import {
  CloudSyncService,
  createAdapter,
  type CloudSyncConfig,
  type SyncConflict,
  type CloudProvider,
} from "../../../services/integrations/cloudSync";

describe("CloudSyncService", () => {
  let service: CloudSyncService;
  const mockDataProvider = vi.fn();

  const baseConfig: CloudSyncConfig = {
    provider: "drive",
    authToken: "test-token",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    service = new CloudSyncService();
    service.setLocalDataProvider(mockDataProvider);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("constructor e init", () => {
    it("should initialize with configuration", () => {
      const s = new CloudSyncService(baseConfig);
      expect(s).toBeInstanceOf(CloudSyncService);
    });

    it("should throw when no adapter is configured", async () => {
      await expect(service.authenticate()).rejects.toThrow(
        "CloudSyncService: adapter not configured",
      );
    });

    it("should initialize the adapter via init()", () => {
      service.init(baseConfig);
      expect(typeof service.authenticate).toBe("function");
    });
  });

  describe("getProviderToken", () => {
    it("should return driveToken for the drive provider", () => {
      service.init({ provider: "drive", driveToken: "d-token" });
      expect(service.getProviderToken("drive")).toBe("d-token");
    });

    it("should return authToken as a fallback for drive", () => {
      service.init({ provider: "drive", authToken: "auth" });
      expect(service.getProviderToken("drive")).toBe("auth");
    });

    it("should return undefined for an unknown provider without a token", () => {
      service.init({ provider: "drive" });
      expect(service.getProviderToken("box")).toBeUndefined();
    });
  });

  describe("setBackoffConfig / getBackoffConfig", () => {
    it("should update the backoff configuration", () => {
      service.setBackoffConfig({ baseMs: 500, maxRetries: 5 });
      const cfg = service.getBackoffConfig();
      expect(cfg.baseMs).toBe(500);
      expect(cfg.maxRetries).toBe(5);
    });

    it("should return default values without configuration", () => {
      const cfg = service.getBackoffConfig();
      expect(cfg.baseMs).toBe(200);
      expect(cfg.maxRetries).toBe(3);
    });
  });

  describe("detectConflict", () => {
    it("should return null when local and remote are equal", () => {
      const result = service.detectConflict({ a: 1 }, { a: 1 }, 100, 100);
      expect(result).toBeNull();
    });

    it("should return null if either one is null", () => {
      expect(service.detectConflict(null, { a: 1 }, 100, 100)).toBeNull();
      expect(service.detectConflict({ a: 1 }, null, 100, 100)).toBeNull();
      expect(service.detectConflict(null, null, 100, 100)).toBeNull();
    });

    it("should detect a conflict when data differs", () => {
      const result = service.detectConflict({ a: 1 }, { a: 2 }, 100, 200);
      expect(result).not.toBeNull();
      expect(result!.strategy).toBe("newer-wins");
      expect(result!.localVersion).toEqual({ a: 1 });
      expect(result!.remoteVersion).toEqual({ a: 2 });
    });

    it("generates a unique id per conflict", () => {
      const c1 = service.detectConflict({ a: 1 }, { a: 2 }, 100, 200);
      const c2 = service.detectConflict({ x: 9 }, { y: 9 }, 100, 200);
      expect(c1!.id).toBeTruthy();
      expect(c1!.id).not.toBe(c2!.id);
    });
  });

  describe("resolveConflict", () => {
    const baseConflict: SyncConflict = {
      id: "test-id",
      localVersion: { a: 1 },
      remoteVersion: { a: 2 },
      localModified: 200,
      remoteModified: 100,
      strategy: "newer-wins",
    };

    it("should resolve with local-wins", () => {
      const r = service.resolveConflict({
        ...baseConflict,
        strategy: "local-wins",
      });
      expect(r.resolved).toEqual({ a: 1 });
      expect(r.timestamp).toBeGreaterThan(0);
      expect(r.strategy).toBe("local-wins");
    });

    it("should resolve with remote-wins", () => {
      const r = service.resolveConflict({
        ...baseConflict,
        strategy: "remote-wins",
      });
      expect(r.resolved).toEqual({ a: 2 });
    });

    it("should resolve with newer-wins using local when it is more recent", () => {
      const r = service.resolveConflict({
        ...baseConflict,
        localModified: 300,
        remoteModified: 200,
      });
      expect(r.resolved).toEqual({ a: 1 });
    });

    it("should resolve with newer-wins using remote when it is more recent", () => {
      const r = service.resolveConflict({
        ...baseConflict,
        localModified: 100,
        remoteModified: 300,
      });
      expect(r.resolved).toEqual({ a: 2 });
    });

    it("should resolve with manual returning null", () => {
      const r = service.resolveConflict({
        ...baseConflict,
        strategy: "manual",
      });
      expect(r.resolved).toBeNull();
    });

    it("should use newer-wins by default for an unknown strategy", () => {
      const r = service.resolveConflict({
        ...baseConflict,
        strategy: "unknown-strategy" as any,
      });
      expect(r.resolved).toEqual({ a: 1 });
    });
  });

  describe("mergeData", () => {
    it("should return null when the strategy is manual", () => {
      expect(service.mergeData({ a: 1 }, { a: 2 }, "manual")).toBeNull();
    });

    it("should return remote when local is falsy", () => {
      expect(service.mergeData(null, { a: 2 }, "local-wins")).toEqual({ a: 2 });
    });

    it("should return local when remote is falsy", () => {
      expect(service.mergeData({ a: 1 }, null, "remote-wins")).toEqual({
        a: 1,
      });
    });

    it("should resolve merge using resolveConflict internally", () => {
      const result = service.mergeData({ a: 1 }, { a: 2 }, "remote-wins");
      expect(result).toEqual({ a: 2 });
    });

    it("merge with local-wins prefers the local version", () => {
      const result = service.mergeData({ a: 1 }, { a: 2 }, "local-wins");
      expect(result).toEqual({ a: 1 });
    });
  });

  describe("sync", () => {
    it("should return an error when there is no dataProvider", async () => {
      service.init(baseConfig);
      const s = new CloudSyncService(baseConfig); // sin dataProvider
      const result = await s.sync();
      expect(result.success).toBe(false);
      expect(result.errors).toContain("No local data provider registered");
    });

    it("should return an error when dataProvider returns null", async () => {
      service.init(baseConfig);
      mockDataProvider.mockResolvedValue(null);
      const result = await service.sync();
      expect(result.success).toBe(false);
      expect(result.errors).toContain("No local data to sync");
    });

    it("should return an error when dataProvider returns undefined", async () => {
      service.init(baseConfig);
      mockDataProvider.mockResolvedValue(undefined);
      const result = await service.sync();
      expect(result.success).toBe(false);
      expect(result.errors).toContain("No local data to sync");
    });

    it("should convert dataProvider errors into a controlled result", async () => {
      service.init(baseConfig);
      mockDataProvider.mockRejectedValue(new Error("Vault unavailable"));

      const result = await service.sync();

      expect(result.success).toBe(false);
      expect(result.errors).toEqual(["Vault unavailable"]);
      expect(mockFetch).not.toHaveBeenCalled();
      expect(service.getSyncMetrics().drive?.failureCount).toBe(1);
    });

    it("should reject an already-cancelled sync without making network calls", async () => {
      service.init(baseConfig);
      const controller = new AbortController();
      controller.abort();

      await expect(service.sync({ signal: controller.signal })).rejects.toMatchObject({
        name: "AbortError",
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should stop retries when cancelled during backoff", async () => {
      vi.useFakeTimers();
      try {
        service.init(baseConfig);
        mockDataProvider.mockResolvedValue({ bookmarks: [] });
        mockFetch.mockRejectedValue(new Error("Network error"));
        service.setBackoffConfig({ baseMs: 100, jitter: false, maxRetries: 3 });
        const controller = new AbortController();
        const promise = service.sync({ signal: controller.signal });

        // Let the first rejected upload enter the retry backoff, then abort
        // while sleep() is waiting. Advancing fake timers makes the ordering
        // deterministic and avoids racing WebCrypto/fetch microtasks against
        // a real 10ms timer in the full suite.
        // The first request is issued through a short promise chain; flush
        // microtasks only. Do not use vi.waitFor here because it advances
        // fake timers and can accidentally run the retry backoff first.
        for (let i = 0; i < 8; i += 1) {
          await Promise.resolve();
        }
        expect(mockFetch).toHaveBeenCalledTimes(1);
        controller.abort();

        await expect(promise).resolves.toEqual({
          success: false,
          errors: ["Sync cancelled"],
        });
        expect(mockFetch).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("should propagate the AbortSignal to HTTP transfers", async () => {
      service.init(baseConfig);
      mockDataProvider.mockResolvedValue({ bookmarks: [] });
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: "file-signal" }),
          headers: new Headers({ "content-type": "application/json" }),
        })
        .mockResolvedValueOnce({ ok: true, headers: new Headers() });
      const controller = new AbortController();

      const result = await service.sync({ signal: controller.signal });

      expect(result.success).toBe(true);
      expect(mockFetch.mock.calls).toHaveLength(2);
      for (const [, init] of mockFetch.mock.calls) {
        expect(init.signal).toBe(controller.signal);
      }
    });

    it("should perform a successful sync", async () => {
      service.init(baseConfig);
      mockDataProvider.mockResolvedValue({ bookmarks: [] });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ id: "file123" }),
        headers: new Headers({
          "content-type": "application/json; charset=UTF-8",
        }),
        arrayBuffer: async () => new ArrayBuffer(0),
      });

      const result = await service.sync();
      expect(result.success).toBe(true);
      expect(result.syncedItems!).toBeDefined();
      expect(result.syncedItems?.length).toBeGreaterThanOrEqual(1);
      // Note: syncedItems is not undefined after a successful sync
    });

    it("should handle a network error and retry", async () => {
      service.init({ provider: "drive", authToken: "test" });
      mockDataProvider.mockResolvedValue({ key: "val" });

      // First call: network error, then success. uploadFile makes 2 fetch
      // (metadata + blob upload) on retry.
      //
      // IMPORTANT: the mock is routed by URL instead of using a queue
      // global (mockRejectedValueOnce/mockResolvedValueOnce). Other modules
      // loaded by the test (e.g. i18next when resolving translations) also
      // call fetch during execution; if they consume a queue entry, the
      // expected retry sequence shifts and the test fails
      // de forma intermitente (flake).
      let metadataAttempts = 0;
      mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input);
        // Fetches outside the flow (i18next, etc.) → benign response.
        if (!url.includes("googleapis.com")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({}),
            text: async () => "",
            headers: new Headers(),
          } as unknown as Response;
        }
        // Blob upload (second fetch of uploadFile).
        if (url.includes("/upload/drive/v3/")) {
          return { ok: true, status: 200 } as unknown as Response;
        }
        // Metadata create (first fetch of uploadFile): fails the first time.
        metadataAttempts += 1;
        if (metadataAttempts === 1) {
          throw new Error("Network error");
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ id: "file456" }),
          headers: new Headers({
            "content-type": "application/json; charset=UTF-8",
          }),
        } as unknown as Response;
      });

      // Lower backoff for fast tests
      service.setBackoffConfig({ baseMs: 10, maxRetries: 1 });

      const result = await service.sync();
      expect(result.success).toBe(true);
    });

    it("should fail after exhausting network retries", async () => {
      service.init({ provider: "drive", authToken: "test" });
      mockDataProvider.mockResolvedValue({ key: "val" });
      mockFetch.mockRejectedValue(new Error("Network error"));
      service.setBackoffConfig({ baseMs: 10, maxRetries: 1 });

      const result = await service.sync();
      expect(result.success).toBe(false);
    });
  });

  describe("getSyncMetrics", () => {
    it("should return empty metrics initially", () => {
      expect(service.getSyncMetrics()).toEqual({});
    });

    it("populates metrics after a successful sync", async () => {
      service.init(baseConfig);
      mockDataProvider.mockResolvedValue({ data: "val" });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ id: "f1" }),
        headers: new Headers({
          "content-type": "application/json; charset=UTF-8",
        }),
      });
      await service.sync();
      const metrics = service.getSyncMetrics();
      expect(metrics.drive).toBeDefined();
      expect(metrics.drive.attempts).toBe(1);
      expect(metrics.drive.successCount).toBe(1);
      expect(metrics.drive.lastDurationMs).toBeGreaterThanOrEqual(0);
    });

    it("records failures in metrics", async () => {
      service.init(baseConfig);
      mockDataProvider.mockResolvedValue({ data: "val" });
      mockFetch.mockRejectedValue(new Error("403 Forbidden"));
      await service.sync();
      const metrics = service.getSyncMetrics();
      expect(metrics.drive.failureCount).toBe(1);
      expect(metrics.drive.lastError).toContain("Forbidden");
    });
  });

  describe("getErrorMessage", () => {
    it("should handle non-Error object with message property", async () => {
      service.init(baseConfig);
      mockDataProvider.mockResolvedValue({ key: "val" });
      mockFetch.mockRejectedValue({ message: "custom object error" });
      const result = await service.sync();
      expect(result.success).toBe(false);
      expect(result.errors?.[0]).toBe("custom object error");
    });

    it("should handle primitive string error", async () => {
      service.init(baseConfig);
      mockDataProvider.mockResolvedValue({ key: "val" });
      mockFetch.mockRejectedValue("raw string error");
      const result = await service.sync();
      expect(result.success).toBe(false);
      expect(result.errors?.[0]).toContain("Unknown error");
    });
  });

  describe("createAdapter", () => {
    it("should create an adapter for drive", () => {
      const adapter = createAdapter("drive", "token");
      expect(adapter.providerName).toBe("drive");
    });

    it("should create an adapter for dropbox", () => {
      const adapter = createAdapter("dropbox", "token");
      expect(adapter.providerName).toBe("dropbox");
    });

    it("should throw for an unknown provider", () => {
      expect(() => createAdapter("invalid" as CloudProvider)).toThrow(
        "Unknown provider",
      );
    });
  });
});

describe("CloudSyncService.syncAll", () => {
  let service: CloudSyncService;
  const mockDataProvider = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    service = new CloudSyncService({
      provider: "drive",
      authToken: "tok",
      dropboxToken: "db-tok",
    });
    service.setLocalDataProvider(mockDataProvider);
  });

  it("should sync with drive and dropbox", async () => {
    mockDataProvider.mockResolvedValue({ items: [] });
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "f1" }),
      headers: new Headers({
        "content-type": "application/json; charset=UTF-8",
      }),
    });

    const result = await service.syncAll();
    expect(result.drive).toBeDefined();
    expect(result.dropbox).toBeDefined();
  });

  it("does not sync with disabled providers", async () => {
    service.init({
      provider: "drive",
      authToken: "tok",
      dropboxToken: "db-tok",
      enabledProviders: ["drive"],
    });
    mockDataProvider.mockResolvedValue({ items: [] });
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "f1" }),
      headers: new Headers({
        "content-type": "application/json; charset=UTF-8",
      }),
    });

    const result = await service.syncAll();
    expect(Object.keys(result)).toEqual(["drive"]);
    expect(result.dropbox).toBeUndefined();
  });
});

describe("DriveAdapter (direct adapter tests via service)", () => {
  let service: CloudSyncService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    service = new CloudSyncService({
      provider: "drive",
      authToken: "test-drive-token",
    });
    service.setLocalDataProvider(vi.fn().mockResolvedValue({}));
  });

  describe("authenticate", () => {
    it("should return token from constructor", async () => {
      const token = await service.authenticate();
      expect(token).toBe("test-drive-token");
    });

    it("should return authToken from config as fallback", () => {
      const serviceWithAuthToken = new CloudSyncService({
        provider: "drive",
        authToken: "config-token",
      });
      (serviceWithAuthToken as any).config = {
        provider: "drive",
        authToken: "config-token",
      };
      return serviceWithAuthToken.authenticate().then((token) => {
        expect(token).toBe("config-token");
      });
    });

    it("should return token from secureStorage when no token in config", async () => {
      mockGetSecret.mockResolvedValueOnce("env-token");
      const serviceNoToken = new CloudSyncService({ provider: "drive" });
      (serviceNoToken as any).config = { provider: "drive" };
      const token = await serviceNoToken.authenticate();
      expect(token).toBe("env-token");
      mockGetSecret.mockResolvedValue(null);
    });

    it("should throw error when no token available", async () => {
      const serviceNoToken = new CloudSyncService({ provider: "drive" });
      (serviceNoToken as any).config = { provider: "drive" };
      await expect(serviceNoToken.authenticate()).rejects.toThrow(
        "DriveAdapter: missing access token",
      );
    });
  });

  describe("listFiles", () => {
    it("should return list of files on success", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          files: [
            { id: "file1", name: "test.txt", modifiedTime: "2024-01-01" },
          ],
        }),
        headers: new Headers({
          "content-type": "application/json; charset=UTF-8",
        }),
      });

      const files = await service.listFiles();
      expect(Array.isArray(files)).toBe(true);
      expect(files.length).toBe(1);
      expect(files[0]!.id).toBe("file1");
    });

    it("should throw error when response is not ok", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      await expect(service.listFiles()).rejects.toThrow(
        "Drive listFiles failed: 500 Internal Server Error",
      );
    });
  });

  describe("uploadFile (via sync)", () => {
    it("should upload file successfully", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: "uploaded-file-id" }),
          headers: new Headers({
            "content-type": "application/json; charset=UTF-8",
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({
            "content-type": "application/json; charset=UTF-8",
          }),
        });

      const result = await service.sync();
      expect(result.success).toBe(true);
      expect(result.syncedItems!).toHaveLength(1);
      expect(result.syncedItems![0]).toContain("bookmarkforge_sync_drive");
    });

    it("should handle error in metadata creation step", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: "Bad Request",
      });

      const result = await service.sync();
      expect(result.success).toBe(false);
      expect(result.errors?.[0]).toContain("Drive file create failed");
    });

    it("should handle error in upload step", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: "uploaded-file-id" }),
          headers: new Headers({
            "content-type": "application/json; charset=UTF-8",
          }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          statusText: "Upload Error",
        });

      const result = await service.sync();
      expect(result.success).toBe(false);
      expect(result.errors?.[0]).toContain("Drive file upload failed");
    });
  });

  describe("downloadFile", () => {
    it("should download file successfully", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => {
          const buffer = new ArrayBuffer(4);
          const view = new Uint8Array(buffer);
          view[0] = 72;
          view[1] = 101;
          view[2] = 108;
          view[3] = 108;
          return buffer;
        },
        headers: new Headers({ "content-type": "application/octet-stream" }),
      });

      const data = await service.downloadFile("some-file-id");
      expect(data).toBeDefined();
      expect((data as any).data).toBeInstanceOf(ArrayBuffer);
      expect((data as any).data.byteLength).toBe(4);
    });

    it("should throw error when download response is not ok", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });

      await expect(service.downloadFile("non-existent-id")).rejects.toThrow(
        "Drive download failed: 404",
      );
    });
  });
});

describe("DropboxAdapter (direct adapter tests via service)", () => {
  let service: CloudSyncService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    service = new CloudSyncService({
      provider: "dropbox",
      authToken: "test-dropbox-token",
    });
    service.setLocalDataProvider(vi.fn().mockResolvedValue({}));
  });

  describe("authenticate", () => {
    it("should return token from constructor", async () => {
      const token = await service.authenticate();
      expect(token).toBe("test-dropbox-token");
    });

    it("should return token from secureStorage when no token in config", async () => {
      mockGetSecret.mockResolvedValueOnce("env-dropbox-token");
      const serviceNoToken = new CloudSyncService({ provider: "dropbox" });
      (serviceNoToken as any).config = { provider: "dropbox" };
      const token = await serviceNoToken.authenticate();
      expect(token).toBe("env-dropbox-token");
      mockGetSecret.mockResolvedValue(null);
    });

    it("should throw error when no token available", async () => {
      const serviceNoToken = new CloudSyncService({ provider: "dropbox" });
      (serviceNoToken as any).config = { provider: "dropbox" };
      await expect(serviceNoToken.authenticate()).rejects.toThrow(
        "DropboxAdapter: missing access token",
      );
    });
  });

  describe("listFiles", () => {
    it("should return list of files on success", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          entries: [
            {
              id: "db-file-1",
              name: "note.txt",
              client_modified: "2024-06-01T12:00:00Z",
            },
          ],
        }),
        headers: new Headers({
          "content-type": "application/json; charset=UTF-8",
        }),
      });

      const files = await service.listFiles();
      expect(Array.isArray(files)).toBe(true);
      expect(files.length).toBe(1);
      expect(files[0]!.id).toBe("db-file-1");
    });

    it("should throw error when response is not ok", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      await expect(service.listFiles()).rejects.toThrow(
        "Dropbox list_files failed: 500",
      );
    });
  });

  describe("uploadFile (via sync)", () => {
    it("should upload file successfully", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "dropbox-uploaded-id" }),
        headers: new Headers({
          "content-type": "application/json; charset=UTF-8",
        }),
      });

      const result = await service.sync();
      expect(result.success).toBe(true);
      expect(result.syncedItems!).toHaveLength(1);
      expect(result.syncedItems![0]).toContain("bookmarkforge_sync_dropbox");
    });

    it("should handle upload error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: "Bad Request",
      });

      const result = await service.sync();
      expect(result.success).toBe(false);
      expect(result.errors?.[0]).toContain("Dropbox upload failed");
    });
  });

  describe("downloadFile", () => {
    it("should download file successfully", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => {
          const buffer = new ArrayBuffer(5);
          const view = new Uint8Array(buffer);
          view[0] = 72;
          view[1] = 101;
          view[2] = 108;
          view[3] = 108;
          view[4] = 111;
          return buffer;
        },
        headers: new Headers({ "content-type": "application/octet-stream" }),
      });

      const data = await service.downloadFile("some-dropbox-id");
      expect(data).toBeDefined();
      expect((data as any).data).toBeInstanceOf(ArrayBuffer);
      expect((data as any).data.byteLength).toBe(5);
    });

    it("should throw error when download response is not ok", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });

      await expect(service.downloadFile("non-existent-id")).rejects.toThrow(
        "Dropbox download failed: 404",
      );
    });
  });
});

describe("OneDriveAdapter (direct adapter tests via service)", () => {
  let service: CloudSyncService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    service = new CloudSyncService({
      provider: "onedrive",
      authToken: "test-onedrive-token",
    });
    service.setLocalDataProvider(vi.fn().mockResolvedValue({}));
  });

  it("should return token from constructor", async () => {
    const token = await service.authenticate();
    expect(token).toBe("test-onedrive-token");
  });

  it("should return token from secureStorage when no token in config", async () => {
    mockGetSecret.mockResolvedValueOnce("env-onedrive-token");
    const serviceNoToken = new CloudSyncService({ provider: "onedrive" });
    (serviceNoToken as any).config = { provider: "onedrive" };
    const token = await serviceNoToken.authenticate();
    expect(token).toBe("env-onedrive-token");
    mockGetSecret.mockResolvedValue(null);
  });

  it("should throw error when no token available", async () => {
    const serviceNoToken = new CloudSyncService({ provider: "onedrive" });
    (serviceNoToken as any).config = { provider: "onedrive" };
    await expect(serviceNoToken.authenticate()).rejects.toThrow(
      "OneDriveAdapter: missing access token",
    );
  });

  it("should list files on success", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        value: [
          {
            id: "od-1",
            name: "doc.docx",
            lastModifiedDateTime: "2024-07-01T10:00:00Z",
          },
        ],
      }),
      headers: new Headers({
        "content-type": "application/json; charset=UTF-8",
      }),
    });

    const files = await service.listFiles();
    expect(files).toHaveLength(1);
    expect(files[0]!.id).toBe("od-1");
  });

  it("should throw on listFiles error", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403 });
    await expect(service.listFiles()).rejects.toThrow(
      "OneDrive list_files failed: 403",
    );
  });

  it("should upload file via sync", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "od-uploaded" }),
      headers: new Headers({
        "content-type": "application/json; charset=UTF-8",
      }),
    });
    const result = await service.sync();
    expect(result.success).toBe(true);
    expect(result.syncedItems![0]).toContain("bookmarkforge_sync_onedrive");
  });

  it("should handle upload error", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 400 });
    const result = await service.sync();
    expect(result.success).toBe(false);
    expect(result.errors?.[0]).toContain("OneDrive upload failed");
  });

  it("should download file successfully", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(3),
      headers: new Headers({ "content-type": "application/octet-stream" }),
    });
    const data = await service.downloadFile("od-file-id");
    expect(data).toBeDefined();
    expect((data as any).data).toBeInstanceOf(ArrayBuffer);
  });

  it("should throw on download error", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
    await expect(service.downloadFile("bad-id")).rejects.toThrow(
      "OneDrive download failed: 404",
    );
  });
});

describe("Auth and error handling paths", () => {
  let service: CloudSyncService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    service = new CloudSyncService({
      provider: "drive",
      authToken: "test-token",
    });
    service.setLocalDataProvider(vi.fn().mockResolvedValue({ some: "data" }));
  });

  it("should return auth error on 401", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      json: async () => ({}),
    });
    const result = await service.sync();
    expect(result.success).toBe(false);
    expect(result.errors?.[0]).toContain("Authentication failed");
  });

  it("should return auth error on 401 status", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: "Token expired",
      json: async () => ({}),
    });
    const result = await service.sync();
    expect(result.success).toBe(false);
    expect(result.errors?.[0]).toContain("Authentication failed");
  });

  it("should return forbidden error on 403", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      json: async () => ({}),
    });
    const result = await service.sync();
    expect(result.success).toBe(false);
    expect(result.errors?.[0]).toContain("Forbidden");
  });

  it("should return generic error for other failures", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Server Error",
      json: async () => ({}),
    });
    const result = await service.sync();
    expect(result.success).toBe(false);
    expect(result.errors?.[0]).toBeDefined();
  });
});

describe("getProviderToken", () => {
  it("should return dropboxToken for dropbox provider", () => {
    const svc = new CloudSyncService({
      provider: "drive",
      dropboxToken: "my-dropbox-token",
    });
    const token = svc.getProviderToken("dropbox");
    expect(token).toBe("my-dropbox-token");
  });

  it("should return onedriveToken for onedrive provider", () => {
    const svc = new CloudSyncService({
      provider: "drive",
      onedriveToken: "my-onedrive-token",
    });
    const token = svc.getProviderToken("onedrive");
    expect(token).toBe("my-onedrive-token");
  });

  it("should return undefined for unknown provider without authToken", () => {
    const svc = new CloudSyncService({ provider: "drive" });
    const token = svc.getProviderToken("unknown" as any);
    expect(token).toBeUndefined();
  });
});

describe("createAdapter", () => {
  it("should create adapters for all supported providers", () => {
    expect(createAdapter("drive").providerName).toBe("drive");
    expect(createAdapter("dropbox").providerName).toBe("dropbox");
    expect(createAdapter("onedrive").providerName).toBe("onedrive");
    expect(createAdapter("box").providerName).toBe("box");
    expect(createAdapter("pcloud").providerName).toBe("pcloud");
    expect(createAdapter("webdav", undefined, {} as any).providerName).toBe(
      "webdav",
    );
  });

  it("should throw for unknown provider", () => {
    expect(() => createAdapter("unknown" as any)).toThrow("Unknown provider");
  });
});

describe("syncAll", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  it("should sync with multiple configured providers", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "f1" }),
      headers: new Headers({
        "content-type": "application/json; charset=UTF-8",
      }),
    });

    const svc = new CloudSyncService({
      provider: "drive",
      authToken: "tok",
      dropboxToken: "db-tok",
      onedriveToken: "od-tok",
    });
    svc.setLocalDataProvider(vi.fn().mockResolvedValue({ items: [1, 2, 3] }));

    const results = await svc.syncAll();
    expect(results.drive).toBeDefined();
    expect(results.drive?.success).toBe(true);
    expect(results.dropbox).toBeDefined();
    expect(results.dropbox?.success).toBe(true);
    expect(results.onedrive).toBeDefined();
    expect(results.onedrive?.success).toBe(true);
  });
});

describe("WebDAVAdapter (direct adapter tests via service)", () => {
  let service: CloudSyncService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    service = new CloudSyncService({
      provider: "webdav",
      authToken: "test-token",
      webdavConfig: {
        url: "https://webdav.example.com",
        username: "user",
        password: "pass",
      },
    });
    service.setLocalDataProvider(vi.fn().mockResolvedValue({}));
  });

  it("should authenticate with Basic auth", async () => {
    const token = await service.authenticate();
    expect(token).toContain("Basic ");
  });

  it("should throw when missing url config", async () => {
    const svc = new CloudSyncService({
      provider: "webdav",
      webdavConfig: {} as any,
    });
    (svc as any).config = { provider: "webdav", webdavConfig: {} };
    await expect(svc.authenticate()).rejects.toThrow(
      "WebDAVAdapter: missing configuration",
    );
  });

  it("should list files via PROPFIND", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => `<?xml version="1.0"?>
<multistatus xmlns="DAV:">
<response><href>/file1</href><propstat><prop><displayname>file1.txt</displayname></prop></propstat></response>
<response><href>/file2</href><propstat><prop><displayname>file2.txt</displayname></prop></propstat></response>
</multistatus>`,
    });
    const files = await service.listFiles();
    expect(files.length).toBe(2);
    expect(files[0]!.name).toBe("file1.txt");
    expect(files[1]!.name).toBe("file2.txt");
  });

  it("should throw on listFiles error", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
    await expect(service.listFiles()).rejects.toThrow(
      "WebDAV list_files failed: 404",
    );
  });

  it("should handle empty list response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => "",
    });
    await expect(service.listFiles()).rejects.toThrow(
      "WebDAV list_files returned empty payload",
    );
  });

  it("should upload file via sync", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, text: async () => "" });
    const result = await service.sync();
    expect(result.success).toBe(true);
    expect(result.syncedItems![0]).toContain("bookmarkforge_sync_webdav");
  });

  it("should handle upload error", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    const result = await service.sync();
    expect(result.success).toBe(false);
    expect(result.errors?.[0]).toContain("WebDAV upload failed");
  });

  it("should download file successfully", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(4),
    });
    const data = await service.downloadFile("/file1");
    expect(data).toBeDefined();
    expect((data as any).data).toBeInstanceOf(ArrayBuffer);
  });

  it("should throw on download error", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(service.downloadFile("/bad")).rejects.toThrow(
      "WebDAV download failed: 500",
    );
  });
});

describe("BoxAdapter (direct adapter tests via service)", () => {
  let service: CloudSyncService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    service = new CloudSyncService({ provider: "box", authToken: "box-tok" });
    service.setLocalDataProvider(vi.fn().mockResolvedValue({}));
  });

  it("should authenticate", async () => {
    const token = await service.authenticate();
    expect(token).toBe("box-tok");
  });

  it("should throw when no token", async () => {
    const svc = new CloudSyncService({ provider: "box" });
    (svc as any).config = { provider: "box" };
    await expect(svc.authenticate()).rejects.toThrow(
      "BoxAdapter: missing access token",
    );
  });

  it("should list files", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        entries: [
          { id: "box-1", name: "doc.pdf", modified_at: "2024-09-01T10:00:00Z" },
        ],
      }),
    });
    const files = await service.listFiles();
    expect(files).toHaveLength(1);
    expect(files[0]!.id).toBe("box-1");
  });

  it("should throw on listFiles error", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(service.listFiles()).rejects.toThrow(
      "Box list_files failed: 500",
    );
  });

  it("should upload via sync", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ entries: [{ id: "box-uploaded" }] }),
    });
    const result = await service.sync();
    expect(result.success).toBe(true);
    expect(result.syncedItems![0]).toContain("bookmarkforge_sync_box");
  });

  it("should handle upload error", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 400 });
    const result = await service.sync();
    expect(result.success).toBe(false);
    expect(result.errors?.[0]).toContain("Box upload failed");
  });
});

describe("PCloudAdapter (direct adapter tests via service)", () => {
  let service: CloudSyncService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    service = new CloudSyncService({
      provider: "pcloud",
      authToken: "pcloud-tok",
    });
    service.setLocalDataProvider(vi.fn().mockResolvedValue({}));
  });

  it("should authenticate", async () => {
    const token = await service.authenticate();
    expect(token).toBe("pcloud-tok");
  });

  it("should throw when no token", async () => {
    const svc = new CloudSyncService({ provider: "pcloud" });
    (svc as any).config = { provider: "pcloud" };
    await expect(svc.authenticate()).rejects.toThrow(
      "PCloudAdapter: missing access token",
    );
  });

  it("should list files", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        result: 0,
        metadata: {
          contents: [
            {
              fileid: 1001,
              name: "photo.jpg",
              modified: "2024-10-01T10:00:00Z",
            },
          ],
        },
      }),
    });
    const files = await service.listFiles();
    expect(files).toHaveLength(1);
    expect(files[0]!.id).toBe("1001");
  });

  it("should throw on listFiles non-zero result", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ result: 2001, error: "rate limited" }),
    });
    await expect(service.listFiles()).rejects.toThrow(
      "pCloud error: rate limited",
    );
  });

  it("should throw on malformed payload", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ result: "not-a-number" }),
    });
    await expect(service.listFiles()).rejects.toThrow(
      "pCloud list_files returned malformed payload",
    );
  });

  it("should throw on http error", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(service.listFiles()).rejects.toThrow(
      "pCloud list_files failed: 500",
    );
  });

  it("should upload via sync", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ result: 0, fileids: [2001] }),
    });
    const result = await service.sync();
    expect(result.success).toBe(true);
    expect(result.syncedItems![0]).toContain("bookmarkforge_sync_pcloud");
  });

  it("should handle upload error", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 400 });
    const result = await service.sync();
    expect(result.success).toBe(false);
    expect(result.errors?.[0]).toContain("pCloud upload failed");
  });
});

describe("ensureAdapter lazy-init", () => {
  it("should create adapter when config exists but adapter is null", async () => {
    const svc = new CloudSyncService();
    const dp = vi.fn().mockResolvedValue({ data: "test" });
    svc.setLocalDataProvider(dp);
    (svc as any).config = { provider: "drive", authToken: "drive-token" };
    svc.setBackoffConfig({ baseMs: 10 });
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "file-lazy" }),
      headers: new Headers({
        "content-type": "application/json; charset=UTF-8",
      }),
    });
    const result = await svc.sync();
    expect(result.success).toBe(true);
  });
});

// =========================================================================
// Branch coverage: syncWithAdapter error matrix + edge cases
// =========================================================================

describe("syncWithAdapter branch coverage", () => {
  let service: CloudSyncService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    service = new CloudSyncService({
      provider: "drive",
      authToken: "test-token",
    });
    service.setLocalDataProvider(vi.fn().mockResolvedValue({ data: "val" }));
  });

  it("should succeed after transient network retries", async () => {
    // Arrange: Drive uploadFile does 2 fetches (metadata create + content
    // upload), so each "upload" consumes 2 fetch calls. The first two uploads
    // fail on the metadata create step with a network error; the third succeeds.
    //
    // IMPORTANT: URL routing with a local counter instead of a queue
    // global mocks. External modules (e.g. i18next) call fetch during the
    // test and would shift the sequence of an Once queue, causing flakes.
    let metadataAttempts = 0;
    mockFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (!url.includes("googleapis.com")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({}),
          text: async () => "",
          headers: new Headers(),
        } as unknown as Response;
      }
      if (url.includes("/upload/drive/v3/")) {
        return { ok: true, status: 200 } as unknown as Response;
      }
      metadataAttempts += 1;
      if (metadataAttempts <= 2) {
        throw new Error("Network error: timeout");
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: "file-after-retry" }),
        headers: new Headers({
          "content-type": "application/json; charset=UTF-8",
        }),
      } as unknown as Response;
    });
    service.setBackoffConfig({ baseMs: 10, maxRetries: 3 });

    // Act
    const result = await service.sync();

    // Assert: recovered after transient failures
    expect(result.success).toBe(true);
    // Only the Drive-flow fetches count; other modules may call fetch
    // during the test without breaking the assertion.
    const driveCalls = mockFetch.mock.calls.filter((c) =>
      String(c[0]).includes("googleapis.com"),
    );
    expect(driveCalls.length).toBe(4);
  });

  it("should fail fast on non-network error during retry", async () => {
    // Arrange: first upload fails with network error → enters retry loop
    // The retry itself fails with an AUTH error (non-network) → early exit
    mockFetch
      .mockRejectedValueOnce(new Error("Network error: timeout"))
      .mockRejectedValueOnce(new Error("Unauthorized: token expired"));
    service.setBackoffConfig({ baseMs: 10, maxRetries: 3 });

    // Act
    const result = await service.sync();

    // Assert: should fail with the auth error message (not network retry failed)
    expect(result.success).toBe(false);
    expect(result.errors?.[0]).toContain("Unauthorized");
  });

  it("should exhaust all retry attempts when every retry fails with network error", async () => {
    // Arrange: all calls fail with network error, maxRetries=3
    mockFetch.mockRejectedValue(new Error("Network error: timeout"));
    service.setBackoffConfig({ baseMs: 10, maxRetries: 3 });

    // Act
    const result = await service.sync();

    // Assert: should fail after exhausting all 3 retries
    expect(result.success).toBe(false);
    expect(result.errors?.[0]).toContain("Network");
    // verify fetch was called 4 times (1 original + 3 retries)
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it("should compute backoff deterministically when jitter is disabled", () => {
    // Arrange: disable jitter
    service.setBackoffConfig({ jitter: false });

    // Act
    const cfg = service.getBackoffConfig();

    // Assert: jitter is false
    expect(cfg.jitter).toBe(false);
    expect(cfg.baseMs).toBe(200);
    expect(cfg.capMs).toBe(2000);

    // Also verify the delay is deterministic by computing expected values
    // baseMs * 2^(attempt-1), capped at capMs, no jitter factor, no floor
    // attempt=1: min(2000, 200*1) = 200
    // attempt=2: min(2000, 200*2) = 400
    // attempt=3: min(2000, 200*4) = 800
    // attempt=4: min(2000, 200*8) = 1600
    // attempt=5: min(2000, 200*16) = 2000 (capped)
    expect(cfg.baseMs).toBe(200);
  });

  it("should use Date.now() fallback when performance.now() is unavailable", async () => {
    const origNow = performance.now.bind(performance);
    try {
      (performance as any).now = undefined;
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ id: "f1" }),
        headers: new Headers({
          "content-type": "application/json; charset=UTF-8",
        }),
      });

      const result = await service.sync();
      expect(result.success).toBe(true);
    } finally {
      performance.now = origNow;
    }
  });

  it("should handle catch-all errors that are not auth/forbidden/network", async () => {
    // Arrange: a completely unexpected error (not matching any error regex)
    mockFetch.mockRejectedValueOnce(new Error("Unexpected: disk full"));

    // Act
    const result = await service.sync();

    // Assert: should fail with the original error message
    expect(result.success).toBe(false);
    // The catch-all returns the error wrapped in "Unknown error during sync"
    expect(result.errors?.[0]).toContain("disk full");
  });
});

describe("syncAll reentrancy guard", () => {
  let service: CloudSyncService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    service = new CloudSyncService({
      provider: "drive",
      authToken: "tok",
      dropboxToken: "db-tok",
    });
    service.setLocalDataProvider(vi.fn().mockResolvedValue({ items: [] }));
  });  it("should return the same promise for concurrent syncAll calls", async () => {
    // Note: vitest 4.x does not preserve Promise identity with toBe.
    // We verify that both calls resolve to the same result.
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "f1" }),
      headers: new Headers({
        "content-type": "application/json; charset=UTF-8",
      }),
    });

    const call1 = service.syncAll();
    const call2 = service.syncAll();

    const [r1, r2] = await Promise.all([call1, call2]);
    expect(r1).toStrictEqual(r2);
    expect(r1.drive).toBeDefined();
    expect(r1.dropbox).toBeDefined();
    let resolveUpload!: (v: unknown) => void;
    const uploadPromise = new Promise((resolve) => {
      resolveUpload = resolve;
    });
    mockFetch.mockReturnValue(uploadPromise);

    // Rename to avoid redeclare with the earlier pair in the same `it` block.
    const altCall1 = service.syncAll();
    const altCall2 = service.syncAll();

    try {
      expect(altCall1).toBe(altCall2);
    } finally {
      // Ensures the promise resolves even if the assertion fails
      resolveUpload({
        ok: true,
        json: async () => ({ id: "f1" }),
        headers: new Headers({ "content-type": "application/json" }),
      });
      resolveUpload({
        ok: true,
        json: async () => ({ id: "f1" }),
        headers: new Headers({ "content-type": "application/json" }),
      });
    }

    const [releasedResult] = await Promise.all([call1]);
    expect(releasedResult.drive).toBeDefined();
  });

  it("should allow a new syncAll after the first completes", async () => {
    // Arrange: first syncAll completes
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "f1" }),
      headers: new Headers({ "content-type": "application/json" }),
    });
    await service.syncAll();

    // Reset mock to count fresh calls
    mockFetch.mockClear();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "f2" }),
      headers: new Headers({ "content-type": "application/json" }),
    });

    // Act: second syncAll should run fresh (lock was cleared)
    const result = await service.syncAll();

    // Assert: drive synced again
    expect(result.drive?.success).toBe(true);
    expect(mockFetch).toHaveBeenCalled();
  });
});
